/**
 * @vitest-environment jsdom
 *
 * Keyboard and screen-reader contracts for the surfaces whose controls swap
 * under the player's hand, and for the small live/described regions around
 * them. A button that unmounts while focused drops focus to <body>; inside a
 * gor-dialog that also silences its Escape and Tab trap. Each confirm below
 * must hand focus to the SAFE answer when it appears, and back home when it is
 * declined.
 *
 * Plain React 19 act() + react-dom, matching tests/tablistContract.test.tsx -
 * no testing-library in this repository.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SettingsMenu from '../components/SettingsMenu';
import CharacterSelection, { type SavedGameSummary } from '../components/CharacterSelection';
import type { PacingPosture } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

async function press(button: HTMLButtonElement): Promise<void> {
  button.focus();
  await act(async () => button.click());
}

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

async function chooseReignFile(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], 'gor-reign.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: Object.assign([file], { item: () => file }) });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function settingsProps(overrides: Record<string, unknown> = {}) {
  return {
    onClose: vi.fn(), apiKey: null, onSaveApiKey: vi.fn(), onClearApiKey: vi.fn(),
    pacingPosture: 'balanced' as PacingPosture, onSetPacingPosture: vi.fn(),
    isNox: false, onSetIsNox: vi.fn(),
    gmConsoleEnabled: false, onSetGmConsoleEnabled: vi.fn(),
    gmInterventionEnabled: false, onSetGmInterventionEnabled: vi.fn(),
    narrationVoiceMode: 'off' as const, onSetNarrationVoiceMode: vi.fn(),
    isMockMode: false, onSetIsMockMode: vi.fn(), gmConsoleOpen: false, onSetGmConsoleOpen: vi.fn(),
    hasSavedReign: true, onExportReign: vi.fn(), onImportReign: vi.fn(() => ({ ok: true as const, turnNumber: 4, characterName: 'Severus' })),
    ...overrides,
  };
}

const SAVED: SavedGameSummary = { characterName: 'Severus Alexander', turnNumber: 4, savedAt: '2026-08-05T12:00:00.000Z' };

describe('SettingsMenu', () => {
  it('moves focus onto "Keep my reign" when a copy is staged, and back onto "Restore from a copy" when declined', async () => {
    const container = await mount(<SettingsMenu {...settingsProps()} />);
    buttonNamed(container, 'Restore from a copy').focus();

    await chooseReignFile(container, '{}');
    await waitFor(() => expect(document.activeElement).toBe(buttonNamed(container, 'Keep my reign')));

    await press(buttonNamed(container, 'Keep my reign'));
    expect(document.activeElement).toBe(buttonNamed(container, 'Restore from a copy'));
  });

  it('announces a saved key through a status region that exists before the save', async () => {
    const container = await mount(<SettingsMenu {...settingsProps()} />);
    const regions = () => Array.from(container.querySelectorAll('[role="status"]'));
    expect(regions().length).toBeGreaterThan(0);

    const input = container.querySelector<HTMLInputElement>('[aria-label="Gemini API key"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'AIza-test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press(buttonNamed(container, 'Save'));
    expect(regions().some(region => region.textContent?.includes('Saved to this device.'))).toBe(true);
  });
});

describe('CharacterSelection', () => {
  it('Start anew hands focus to "Keep my reign", and declining hands it back', async () => {
    const container = await mount(<CharacterSelection onSelectCharacter={vi.fn()} onCreateCharacter={vi.fn(async () => {})} savedGame={SAVED} onStartAnew={vi.fn()} />);
    await press(buttonNamed(container, 'Start anew'));
    expect(document.activeElement).toBe(buttonNamed(container, 'Keep my reign'));
    await press(buttonNamed(container, 'Keep my reign'));
    expect(document.activeElement).toBe(buttonNamed(container, 'Start anew'));
  });

  it('a staged copy puts focus on "Keep my reign", never on the destructive answer', async () => {
    const container = await mount(<CharacterSelection onSelectCharacter={vi.fn()} onCreateCharacter={vi.fn(async () => {})} savedGame={SAVED} onImportReign={vi.fn(() => ({ ok: true as const, turnNumber: 4, characterName: 'S' }))} />);
    buttonNamed(container, 'Restore from a copy').focus();
    await chooseReignFile(container, '{}');
    await waitFor(() => expect(document.activeElement).toBe(buttonNamed(container, 'Keep my reign')));
  });

  it('"Back to the destinies" returns focus to the card that opened the form', async () => {
    const container = await mount(<CharacterSelection onSelectCharacter={vi.fn()} onCreateCharacter={vi.fn(async () => {})} />);
    const createOwn = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Create Your Own'))!;
    await press(createOwn());
    await press(buttonNamed(container, '‹ Back to the destinies'));
    expect(document.activeElement).toBe(createOwn());
  });
});
