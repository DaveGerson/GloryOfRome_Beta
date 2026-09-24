/**
 * persistence/crossTab.ts
 *
 * Detection (not resolution) for roadmaps/BACKLOG.md B7: the autosave is a
 * single `localStorage` slot, so two tabs playing the same browser profile
 * are last-writer-wins - each tab's autosave silently overwrites the other's
 * campaign. This module only REPORTS that another tab wrote or cleared the
 * slot; what to do about it (a "this reign was continued in another tab"
 * notice, a read-only lock, an offer to reload) is the UI's decision.
 *
 * It relies on the standard `storage` event, which browsers fire on every
 * OTHER same-origin document whose storage area changed - never on the tab
 * that made the write. So every event this module sees is, by construction,
 * a foreign write; no tab id or heartbeat bookkeeping is needed.
 *
 * Never throws: an absent `window` (SSR, workers), a `localStorage` that
 * throws on access (private mode), or an unparseable foreign blob all
 * degrade to "no subscription" or a summary with null fields.
 */

import { SAVE_KEY } from './saveGame';

export interface ForeignSaveWrite {
  /** 'written': another tab stored a save. 'cleared': it removed the slot (or cleared all storage). */
  kind: 'written' | 'cleared';
  /** The foreign save's `savedAt`, when its blob is readable. */
  savedAt: string | null;
  /** The foreign save's `state.turnNumber`, when its blob is readable. */
  turnNumber: number | null;
}

/** The subset of `Window` this module touches - injectable for tests. */
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export interface SubscribeOptions {
  /** Defaults to `window` when it exists. */
  target?: StorageEventTarget | null;
  /**
   * Only events on this storage area count (a `sessionStorage` change with
   * the same key must not). Defaults to `localStorage` when accessible;
   * `null` disables the check.
   */
  storageArea?: Storage | null;
}

function defaultTarget(): StorageEventTarget | null {
  return typeof window === 'undefined' ? null : window;
}

function defaultStorageArea(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Best-effort summary of a foreign blob. Deliberately NOT the full
 * `validateSaveBlob` gate: this is a notification, never a load - a caller
 * that wants to adopt the foreign reign calls `loadGame()` itself.
 */
export function summarizeForeignSave(raw: string): Pick<ForeignSaveWrite, 'savedAt' | 'turnNumber'> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { savedAt: null, turnNumber: null };
    const envelope = parsed as Record<string, unknown>;
    const savedAt = typeof envelope['savedAt'] === 'string' ? envelope['savedAt'] : null;
    const state = envelope['state'];
    const turn = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['turnNumber'] : undefined;
    const turnNumber = typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 ? turn : null;
    return { savedAt, turnNumber };
  } catch {
    return { savedAt: null, turnNumber: null };
  }
}

/**
 * Calls `onForeignWrite` whenever ANOTHER tab/window of this origin writes
 * or clears the autosave slot. Returns an unsubscribe function (idempotent;
 * a no-op when there was nothing to subscribe to). Exceptions thrown by the
 * callback are caught and logged so a faulty listener cannot break the
 * browser's event dispatch.
 */
export function subscribeToForeignSaveWrites(
  onForeignWrite: (write: ForeignSaveWrite) => void,
  options: SubscribeOptions = {},
): () => void {
  const target = options.target === undefined ? defaultTarget() : options.target;
  if (!target) return () => {};
  const storageArea = options.storageArea === undefined ? defaultStorageArea() : options.storageArea;

  const listener = (event: StorageEvent): void => {
    // `key === null` is a foreign `storage.clear()`, which also wipes the slot.
    if (event.key !== null && event.key !== SAVE_KEY) return;
    if (storageArea && event.storageArea && event.storageArea !== storageArea) return;

    const write: ForeignSaveWrite =
      event.key === null || event.newValue === null
        ? { kind: 'cleared', savedAt: null, turnNumber: null }
        : { kind: 'written', ...summarizeForeignSave(event.newValue) };

    try {
      onForeignWrite(write);
    } catch (e) {
      console.warn('subscribeToForeignSaveWrites: listener threw', e);
    }
  };

  target.addEventListener('storage', listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    target.removeEventListener('storage', listener);
  };
}
