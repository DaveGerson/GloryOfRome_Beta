/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveGame, SAVE_KEY } from '../persistence/saveGame';
import { subscribeToForeignSaveWrites, summarizeForeignSave, type ForeignSaveWrite } from '../persistence/crossTab';
import { makeLegacySaveState as makeState } from './factories';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('persistence/crossTab subscribeToForeignSaveWrites', () => {
  function fire(init: StorageEventInit) {
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, ...init }));
  }

  it('reports a foreign write of the autosave slot with a summary of the foreign reign', () => {
    const seen: ForeignSaveWrite[] = [];
    const unsubscribe = subscribeToForeignSaveWrites(write => seen.push(write));
    fire({
      key: SAVE_KEY,
      oldValue: null,
      newValue: JSON.stringify({ version: 1, savedAt: '2026-02-02T00:00:00.000Z', state: { turnNumber: 9 } }),
    });
    unsubscribe();
    expect(seen).toEqual([{ kind: 'written', savedAt: '2026-02-02T00:00:00.000Z', turnNumber: 9 }]);
  });

  it('reports a foreign removal or storage.clear() as cleared', () => {
    const seen: ForeignSaveWrite[] = [];
    const unsubscribe = subscribeToForeignSaveWrites(write => seen.push(write));
    fire({ key: SAVE_KEY, oldValue: '{}', newValue: null });
    fire({ key: null });
    unsubscribe();
    expect(seen.map(w => w.kind)).toEqual(['cleared', 'cleared']);
  });

  it('ignores other keys and other storage areas', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToForeignSaveWrites(cb);
    fire({ key: 'gloryOfRome:settings', newValue: '{}' });
    fire({ key: SAVE_KEY, newValue: '{}', storageArea: sessionStorage });
    unsubscribe();
    expect(cb).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe, and unsubscribe is idempotent', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToForeignSaveWrites(cb);
    unsubscribe();
    unsubscribe();
    fire({ key: SAVE_KEY, newValue: '{}' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire for this tab\'s own saveGame (storage events are foreign-only)', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToForeignSaveWrites(cb);
    expect(saveGame(makeState()).ok).toBe(true);
    unsubscribe();
    expect(cb).not.toHaveBeenCalled();
  });

  it('isolates a throwing listener', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribe = subscribeToForeignSaveWrites(() => { throw new Error('bad listener'); });
    expect(() => fire({ key: SAVE_KEY, newValue: '{}' })).not.toThrow();
    unsubscribe();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('is a safe no-op without an event target', () => {
    const unsubscribe = subscribeToForeignSaveWrites(vi.fn(), { target: null });
    expect(() => unsubscribe()).not.toThrow();
  });

  it('works against an injected target and storage area', () => {
    const listeners: Array<(e: StorageEvent) => void> = [];
    const target = {
      addEventListener: (_: 'storage', l: (e: StorageEvent) => void) => listeners.push(l),
      removeEventListener: (_: 'storage', l: (e: StorageEvent) => void) => listeners.splice(listeners.indexOf(l), 1),
    };
    const cb = vi.fn();
    const unsubscribe = subscribeToForeignSaveWrites(cb, { target, storageArea: null });
    expect(listeners).toHaveLength(1);
    listeners[0]!({ key: SAVE_KEY, newValue: 'not json', storageArea: null } as StorageEvent);
    expect(cb).toHaveBeenCalledWith({ kind: 'written', savedAt: null, turnNumber: null });
    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  it('summarizeForeignSave tolerates garbage', () => {
    expect(summarizeForeignSave('null')).toEqual({ savedAt: null, turnNumber: null });
    expect(summarizeForeignSave('{"savedAt":5,"state":{"turnNumber":-1}}')).toEqual({ savedAt: null, turnNumber: null });
    expect(summarizeForeignSave('{"savedAt":"t","state":{"turnNumber":3}}')).toEqual({ savedAt: 't', turnNumber: 3 });
  });
});
