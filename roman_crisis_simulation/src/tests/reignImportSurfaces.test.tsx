/**
 * @vitest-environment jsdom
 *
 * The two player-facing homes of the reign import route (spec:
 * docs/superpowers/specs/2026-08-05-reign-export-import-design.md):
 *
 *  - CharacterSelection: "Restore from a copy" — a hidden JSON-only file
 *    input behind a visible button. With a saved reign, choosing a file
 *    swaps in the Abandon-style confirm (crimson sentence + danger button +
 *    "Keep my reign") BEFORE anything is applied; without one it applies
 *    at once. The import function itself never asks — consent precedes it.
 *  - SettingsMenu: export ("Take a copy of the reign") only where a save
 *    exists to copy (D45's zero-state spirit — an affordance only where it
 *    can act), import always — a fresh device is exactly where a restore
 *    matters — and neither lives inside the DEV-gated Workshop: both ship
 *    to players.
 *
 * The contract these tests set (the spec leaves prop names open):
 *  - CharacterSelection gains `onImportReign?: (fileText: string) =>
 *    ImportResult` — App wires it to persistence/saveGame.ts's
 *    importSaveBlob. The component owns the confirm, the in-fiction failure
 *    notice, and the reload-on-ok; the callback owns the slot.
 *  - SettingsMenu gains `hasSavedReign: boolean`, `onExportReign: () =>
 *    void` (App wires downloadTheReign), and the same `onImportReign`.
 *
 * On failure the surface states the spec's lead for the reason, then "Your
 * current reign is untouched." — and it must not touch storage itself:
 * importSaveBlob already guarantees the slot on failure, so these tests pin
 * that the UI adds no write (or clear) of its own around it.
 *
 * jsdom note: Location is LegacyUnforgeable in jsdom 25 — `reload` is a
 * non-configurable own property, so the spec's vi.spyOn/defineProperty
 * suggestion cannot land. Vitest's jsdom environment re-exposes `location`
 * as a configurable global (and globalThis IS window there), so
 * vi.stubGlobal swaps the whole binding: both `location.reload()` and
 * `window.location.reload()` resolve to the stub, and no test navigates.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library; waits are tick-budget, never
 * wall-clock; assertions are scoped by what the screen says, not by
 * counting roles.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import CharacterSelection, { type SavedGameSummary } from '../components/CharacterSelection';
import SettingsMenu from '../components/SettingsMenu';
import type { ImportResult } from '../persistence/saveGame';
import type { PacingPosture } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVE_KEY = 'gloryOfRome:autosave';

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** See the file header — the whole `location` binding is swapped, never navigated. */
function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

/**
 * The confirm's danger button carries the design system's danger variant
 * (the exact Start anew pattern). Its label is veto-queue copy, so it is
 * located by class, not text — and until Start anew's own confirm is opened
 * it is the only danger button on the screen, which this asserts so an
 * ambiguous locator can never silently click the wrong thing.
 */
function dangerButton(container: HTMLElement): HTMLButtonElement {
  const buttons = container.querySelectorAll<HTMLButtonElement>('button.gor-btn-danger');
  expect(buttons, 'exactly one danger button (the overwrite confirm)').toHaveLength(1);
  return buttons[0];
}

/** Tick-budget wait — the same pattern as characterSelectionStrictMode.test.tsx. */
async function waitFor(assertion: () => void, attempts = 50): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

/**
 * Plants a File on the hidden input and fires the change the picker would.
 * The array carries `item` too, so the component may read `files[0]` or
 * `files.item(0)` — the test does not care which.
 */
async function chooseReignFile(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, 'the hidden reign file input').not.toBeNull();
  const file = new File([text], 'gor-reign-week4.json', { type: 'application/json' });
  const fileList = Object.assign([file], { item: (index: number) => [file][index] ?? null });
  Object.defineProperty(input!, 'files', { configurable: true, value: fileList });
  await act(async () => {
    input!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const OK_IMPORT: ImportResult = { ok: true, turnNumber: 4, characterName: 'Severus Alexander' };

const SAVED: SavedGameSummary = {
  characterName: 'Severus Alexander',
  turnNumber: 4,
  savedAt: '2026-08-05T12:00:00.000Z',
};

/** A realistic slot value whose only job is to be byte-identical afterwards. */
const SLOT_SENTINEL = JSON.stringify({
  version: 1,
  savedAt: '2026-08-05T12:00:00.000Z',
  state: { turnNumber: 4 },
});

/** The spec's failure leads — every one ends "Your current reign is untouched." */
const FAILURE_LEADS = [
  ['unreadable', 'This scroll could not be read as a reign.'],
  ['not_a_reign', 'This scroll could not be read as a reign.'],
  ['version_mismatch', 'This copy was written for another age of the Republic.'],
  ['storage_failed', 'This device would not take the writing down.'],
] as const;

function selectionProps() {
  return {
    onSelectCharacter: vi.fn(),
    onCreateCharacter: vi.fn(async () => {}),
  };
}

describe('CharacterSelection — "Restore from a copy"', () => {
  it('offers the restore affordance with a JSON-only file scroll, save or no save', async () => {
    const container = await mount(
      <CharacterSelection {...selectionProps()} onImportReign={vi.fn(() => OK_IMPORT)} />,
    );

    expect(container.textContent).toContain('Restore from a copy');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.getAttribute('accept')).toBe('application/json');
  });

  it('applies a chosen copy at once when no reign is at stake, and reloads on ok', async () => {
    const reload = stubReload();
    const onImportReign = vi.fn(() => OK_IMPORT);
    const blob = '{"version":1,"savedAt":"2026-08-05T12:00:00.000Z","state":{}}';
    const container = await mount(
      <CharacterSelection {...selectionProps()} onImportReign={onImportReign} />,
    );

    await chooseReignFile(container, blob);

    // No reign on the device, so there is nothing to confirm over — the copy
    // goes straight through, verbatim.
    await waitFor(() => expect(onImportReign).toHaveBeenCalledTimes(1));
    expect(container.textContent).not.toContain('Keep my reign');
    expect(onImportReign).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('gates the overwrite behind the Abandon-style confirm when a reign exists', async () => {
    const reload = stubReload();
    const onImportReign = vi.fn(() => OK_IMPORT);
    const blob = '{"version":1,"savedAt":"2026-08-05T12:00:00.000Z","state":{}}';
    const container = await mount(
      <CharacterSelection
        {...selectionProps()}
        savedGame={SAVED}
        onContinue={vi.fn()}
        onStartAnew={vi.fn()}
        onImportReign={onImportReign}
      />,
    );

    await chooseReignFile(container, blob);

    // The confirm swaps in BEFORE anything is applied (spec: consent
    // precedes importSaveBlob — the function never asks).
    await waitFor(() => expect(container.textContent).toContain('Keep my reign'));
    expect(onImportReign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await click(dangerButton(container));

    await waitFor(() => expect(onImportReign).toHaveBeenCalledTimes(1));
    expect(onImportReign).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('"Keep my reign" stands down: no import, no reload, the slot untouched', async () => {
    const reload = stubReload();
    const onImportReign = vi.fn(() => OK_IMPORT);
    const onStartAnew = vi.fn();
    localStorage.setItem(SAVE_KEY, SLOT_SENTINEL);
    const container = await mount(
      <CharacterSelection
        {...selectionProps()}
        savedGame={SAVED}
        onContinue={vi.fn()}
        onStartAnew={onStartAnew}
        onImportReign={onImportReign}
      />,
    );

    await chooseReignFile(container, '{"version":1}');
    await waitFor(() => expect(container.textContent).toContain('Keep my reign'));

    await click(buttonNamed(container, 'Keep my reign'));

    // Back to the resting card, nothing applied, nothing cleared: declining
    // the overwrite must not have routed through Start anew's abandon.
    expect(container.textContent).not.toContain('Keep my reign');
    expect(container.textContent).toContain('Start anew');
    expect(onImportReign).not.toHaveBeenCalled();
    expect(onStartAnew).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(SAVE_KEY)).toBe(SLOT_SENTINEL);
  });

  it('treats a scroll the device itself cannot read as unreadable - a notice, never an unhandled rejection', async () => {
    // FileReader is swapped for one whose read always errors. The failure
    // must land on the same in-fiction notice as a parse refusal, and the
    // import callback must never see text that was never read.
    class RefusingFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error = new DOMException('The requested file could not be read.', 'NotReadableError');
      readAsText(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', RefusingFileReader);
    const reload = stubReload();
    const onImportReign = vi.fn(() => OK_IMPORT);
    const container = await mount(
      <CharacterSelection {...selectionProps()} onImportReign={onImportReign} />,
    );

    await chooseReignFile(container, 'never actually read');

    await waitFor(() =>
      expect(container.textContent).toContain('This scroll could not be read as a reign.'));
    expect(container.textContent).toContain('Your current reign is untouched.');
    expect(onImportReign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a failed import speaks each reason in-fiction, never reloads, never writes', async () => {
    const reload = stubReload();
    for (const [reason, lead] of FAILURE_LEADS) {
      localStorage.setItem(SAVE_KEY, SLOT_SENTINEL);
      const onImportReign = vi.fn((): ImportResult => ({ ok: false, reason }));
      const container = await mount(
        <CharacterSelection {...selectionProps()} onImportReign={onImportReign} />,
      );

      await chooseReignFile(container, '{"version":1}');

      await waitFor(() => expect(container.textContent).toContain(lead));
      expect(container.textContent).toContain('Your current reign is untouched.');
      expect(reload).not.toHaveBeenCalled();
      // The UI adds no write of its own around the refused import.
      expect(localStorage.getItem(SAVE_KEY)).toBe(SLOT_SENTINEL);
    }
  });
});

function settingsProps(overrides: Record<string, unknown> = {}) {
  return {
    onClose: vi.fn(),
    apiKey: null,
    onSaveApiKey: vi.fn(),
    onClearApiKey: vi.fn(),
    pacingPosture: 'balanced' as PacingPosture,
    onSetPacingPosture: vi.fn(),
    isNox: false,
    onSetIsNox: vi.fn(),
    gmConsoleEnabled: false,
    onSetGmConsoleEnabled: vi.fn(),
    gmInterventionEnabled: false,
    onSetGmInterventionEnabled: vi.fn(),
    narrationVoiceMode: 'off' as const,
    onSetNarrationVoiceMode: vi.fn(),
    isMockMode: false,
    onSetIsMockMode: vi.fn(),
    gmConsoleOpen: false,
    onSetGmConsoleOpen: vi.fn(),
    // The contract this TDD pass sets — see the file header.
    hasSavedReign: true,
    onExportReign: vi.fn(),
    onImportReign: vi.fn(() => OK_IMPORT),
    ...overrides,
  };
}

describe('SettingsMenu — the reign register', () => {
  it('offers "Take a copy of the reign" only where a reign exists to copy', async () => {
    const onExportReign = vi.fn();
    const container = await mount(<SettingsMenu {...settingsProps({ onExportReign })} />);

    expect(container.textContent).toContain('Take a copy of the reign');
    await click(buttonNamed(container, 'Take a copy of the reign'));
    expect(onExportReign).toHaveBeenCalledTimes(1);

    // D45's zero-state spirit: with nothing to copy, no export — but the
    // import stays, because a device with no reign is exactly where a
    // restore matters.
    const bare = await mount(<SettingsMenu {...settingsProps({ hasSavedReign: false })} />);
    expect(bare.textContent).not.toContain('Take a copy of the reign');
    expect(bare.textContent).toContain('Restore from a copy');
  });

  it('keeps both reign controls outside the DEV-gated Workshop', async () => {
    const container = await mount(<SettingsMenu {...settingsProps()} />);

    // Both controls are on the menu…
    expect(container.textContent).toContain('Take a copy of the reign');
    expect(container.textContent).toContain('Restore from a copy');

    // …and neither sits inside the Workshop well. Vitest runs as a dev
    // build, so the gated section IS rendered here — if this guard fails,
    // the Workshop moved, not the feature.
    const workshop = container.querySelector('[aria-labelledby="settings-workshop"]');
    expect(workshop, 'the DEV-gated Workshop section').not.toBeNull();
    expect(workshop!.textContent).not.toContain('Take a copy of the reign');
    expect(workshop!.textContent).not.toContain('Restore from a copy');
  });

  it('holds the import control while the world is busy, leaving export live', async () => {
    // App passes interactionLocked while a domain mutation or turn is in
    // flight: a confirmed restore mid-turn could be silently un-done by the
    // in-flight save landing after a cancelled reload.
    const container = await mount(<SettingsMenu {...settingsProps({ interactionLocked: true })} />);

    expect(buttonNamed(container, 'Restore from a copy').disabled).toBe(true);
    // Export is a read and races nothing - it stays pressable.
    expect(buttonNamed(container, 'Take a copy of the reign').disabled).toBe(false);

    // B7a 1d — the lock reaches INTO a staged confirm. The picker cannot be
    // opened under the lock, but the lock can ARRIVE while a confirm is up
    // (the menu stays open across a turn starting), so the confirm is staged
    // here directly on the hidden input: Replace — the write — holds, while
    // "Keep my reign" stays free, because backing out races nothing.
    await chooseReignFile(container, '{"version":1}');
    await waitFor(() => expect(container.textContent).toContain('Keep my reign'));
    expect(buttonNamed(container, 'Replace').disabled).toBe(true);
    expect(buttonNamed(container, 'Keep my reign').disabled).toBe(false);
  });

  it('confirms before overwriting from Settings, and reloads on ok', async () => {
    const reload = stubReload();
    const onImportReign = vi.fn(() => OK_IMPORT);
    const blob = '{"version":1,"savedAt":"2026-08-05T12:00:00.000Z","state":{}}';
    const container = await mount(<SettingsMenu {...settingsProps({ onImportReign })} />);

    await chooseReignFile(container, blob);

    await waitFor(() => expect(container.textContent).toContain('Keep my reign'));
    expect(onImportReign).not.toHaveBeenCalled();

    await click(dangerButton(container));

    await waitFor(() => expect(onImportReign).toHaveBeenCalledTimes(1));
    expect(onImportReign).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('a failed Settings import shows the in-fiction notice, never reloads, never writes', async () => {
    const reload = stubReload();
    const onImportReign = vi.fn((): ImportResult => ({ ok: false, reason: 'unreadable' }));
    localStorage.setItem(SAVE_KEY, SLOT_SENTINEL);
    // No saved reign, so no confirm stands between the choice and the
    // refusal — the shortest honest path to the failure surface.
    const container = await mount(
      <SettingsMenu {...settingsProps({ hasSavedReign: false, onImportReign })} />,
    );

    await chooseReignFile(container, 'not even json');

    await waitFor(() =>
      expect(container.textContent).toContain('This scroll could not be read as a reign.'));
    expect(container.textContent).toContain('Your current reign is untouched.');
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(SAVE_KEY)).toBe(SLOT_SENTINEL);
  });
});
