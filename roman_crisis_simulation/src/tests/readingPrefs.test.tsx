/**
 * @vitest-environment jsdom
 *
 * tests/readingPrefs.test.tsx
 *
 * The Reading register (ROADMAP_UPLEVEL_2026-09.md P5): text size, motion,
 * how the narration arrives, and the single-key shortcuts WCAG 2.1.4 says a
 * player must be able to turn off.
 *
 *  - persistence/readingPrefs.ts: defaults, round trips, a stale value
 *    falling back, storage that throws never crashing;
 *  - the <html> attributes: absent by default (a device that never chose
 *    renders exactly as before), painted by the hook, cleared on return;
 *  - motionIsReduced: the player's "Still" OR the device's own request;
 *  - the Settings register: one visible note per control, describing the
 *    choice in force (D43), each change reaching its handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyReadingPrefsToDocument,
  getDossierFolded, setDossierFolded,
  getMotionPreference, setMotionPreference,
  getNarrationReveal, setNarrationReveal,
  getReadingScale, setReadingScale,
  getShortcutPreference, setShortcutPreference,
  motionIsReduced,
  MOTION_PREFERENCE_KEY, READING_SCALE_KEY,
} from '../persistence/readingPrefs';
import { useReadingPrefs } from '../hooks/useReadingPrefs';
import { ReadingSettings, READING_SETTINGS_COPY, type ReadingSettingsProps } from '../components/ReadingSettings';
import SettingsMenu, { LIGHTING_COPY } from '../components/SettingsMenu';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute('data-gor-reading');
  html().removeAttribute('data-gor-motion');
});

afterEach(() => {
  localStorage.clear();
  html().removeAttribute('data-gor-reading');
  html().removeAttribute('data-gor-motion');
  vi.restoreAllMocks();
});

describe('persistence/readingPrefs', () => {
  it('defaults to the client as it always was: standard size, the device decides motion, streaming, keys on, dossier open', () => {
    expect(getReadingScale()).toBe('standard');
    expect(getMotionPreference()).toBe('device');
    expect(getNarrationReveal()).toBe('stream');
    expect(getShortcutPreference()).toBe('on');
    expect(getDossierFolded()).toBe(false);
  });

  it('round-trips every preference', () => {
    setReadingScale('larger');
    setMotionPreference('reduced');
    setNarrationReveal('whole');
    setShortcutPreference('off');
    setDossierFolded(true);
    expect(getReadingScale()).toBe('larger');
    expect(getMotionPreference()).toBe('reduced');
    expect(getNarrationReveal()).toBe('whole');
    expect(getShortcutPreference()).toBe('off');
    expect(getDossierFolded()).toBe(true);
    setDossierFolded(false);
    expect(getDossierFolded()).toBe(false);
  });

  it('reads a stale or hand-edited value as the default, never as an arbitrary string', () => {
    localStorage.setItem(READING_SCALE_KEY, 'enormous');
    localStorage.setItem(MOTION_PREFERENCE_KEY, 'wild');
    localStorage.setItem('gloryOfRome:narrationReveal', '');
    localStorage.setItem('gloryOfRome:shortcuts', 'yes');
    localStorage.setItem('gloryOfRome:dossierFolded', 'true');
    expect(getReadingScale()).toBe('standard');
    expect(getMotionPreference()).toBe('device');
    expect(getNarrationReveal()).toBe('stream');
    expect(getShortcutPreference()).toBe('on');
    expect(getDossierFolded()).toBe(false);
  });

  it('never throws when storage refuses to read or write (private mode, quota)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(getReadingScale()).toBe('standard');
    expect(getDossierFolded()).toBe(false);
    expect(() => setReadingScale('large')).not.toThrow();
    expect(() => setDossierFolded(true)).not.toThrow();
  });
});

describe('the <html> attributes', () => {
  it('are absent at the defaults and present otherwise', () => {
    applyReadingPrefsToDocument(html(), { readingScale: 'large', motion: 'reduced' });
    expect(html().getAttribute('data-gor-reading')).toBe('large');
    expect(html().getAttribute('data-gor-motion')).toBe('reduced');
    applyReadingPrefsToDocument(html(), { readingScale: 'standard', motion: 'device' });
    expect(html().hasAttribute('data-gor-reading')).toBe(false);
    expect(html().hasAttribute('data-gor-motion')).toBe(false);
  });

  it('are painted by the hook from storage on mount, and follow each change', () => {
    setReadingScale('larger');
    const hook = renderHook(() => useReadingPrefs(), undefined);
    expect(html().getAttribute('data-gor-reading')).toBe('larger');
    expect(html().hasAttribute('data-gor-motion')).toBe(false);

    act(() => hook.current.handleSetMotion('reduced'));
    expect(html().getAttribute('data-gor-motion')).toBe('reduced');
    expect(getMotionPreference()).toBe('reduced');

    act(() => hook.current.handleSetReadingScale('standard'));
    expect(html().hasAttribute('data-gor-reading')).toBe(false);
    expect(getReadingScale()).toBe('standard');

    act(() => hook.current.handleSetNarrationReveal('whole'));
    act(() => hook.current.handleSetShortcuts('off'));
    expect(hook.current.narrationReveal).toBe('whole');
    expect(hook.current.shortcuts).toBe('off');
    expect(getNarrationReveal()).toBe('whole');
    expect(getShortcutPreference()).toBe('off');
    hook.unmount();
  });
});

describe('motionIsReduced', () => {
  it('is true when the player chose Still, whatever the device says', () => {
    html().setAttribute('data-gor-motion', 'reduced');
    expect(motionIsReduced()).toBe(true);
  });

  it('follows the device when the player left it to the device', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    expect(motionIsReduced()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    matchMedia.mockReturnValue({ matches: false });
    expect(motionIsReduced()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('Settings → Reading', () => {
  function renderReading(overrides: Partial<ReadingSettingsProps> = {}) {
    const props: ReadingSettingsProps = {
      readingScale: 'standard', onSetReadingScale: vi.fn(),
      motion: 'device', onSetMotion: vi.fn(),
      narrationReveal: 'stream', onSetNarrationReveal: vi.fn(),
      shortcuts: 'on', onSetShortcuts: vi.fn(),
      ...overrides,
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ReadingSettings {...props} />));
    return { host, props, cleanup: () => { act(() => root.unmount()); host.remove(); } };
  }
  const radio = (host: HTMLElement, group: string, label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)]
      .find(button => button.textContent === label)!;
  /** A switch found by its visible label - which must also be its whole accessible name. */
  const switchNamed = (host: HTMLElement, label: string) => {
    const found = [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')]
      .find(input => input.closest('label')?.textContent === label);
    expect(found, `switch "${label}"`).toBeDefined();
    return found!;
  };
  const noteOf = (host: HTMLElement, control: Element) =>
    host.querySelector(`#${control.getAttribute('aria-describedby')}`)?.textContent;

  it('sizes text with a radio group, and describes the size in force', () => {
    const view = renderReading({ readingScale: 'large' });
    const sizeGroup = view.host.querySelector('[role="radiogroup"][aria-label="Text size"]')!;
    expect(noteOf(view.host, sizeGroup)).toBe(READING_SETTINGS_COPY.textSizeNote.large);
    expect(radio(view.host, 'Text size', 'Large').getAttribute('aria-checked')).toBe('true');
    view.cleanup();
  });

  it('makes each on/off preference a switch named for what it does, with its note as its description', () => {
    const on = renderReading({ motion: 'reduced', narrationReveal: 'stream', shortcuts: 'on' });
    const motion = switchNamed(on.host, READING_SETTINGS_COPY.reduceMotion);
    const words = switchNamed(on.host, READING_SETTINGS_COPY.wordByWord);
    const keys = switchNamed(on.host, READING_SETTINGS_COPY.singleKeys);
    expect([motion.checked, words.checked, keys.checked]).toEqual([true, true, true]);
    expect(noteOf(on.host, motion)).toBe(READING_SETTINGS_COPY.reduceMotionNote.on);
    expect(noteOf(on.host, words)).toBe(READING_SETTINGS_COPY.wordByWordNote.on);
    expect(noteOf(on.host, keys)).toMatch(/1–7 open the side panel's tabs/);
    on.cleanup();

    const off = renderReading({ motion: 'device', narrationReveal: 'whole', shortcuts: 'off' });
    expect(switchNamed(off.host, READING_SETTINGS_COPY.reduceMotion).checked).toBe(false);
    expect(noteOf(off.host, switchNamed(off.host, READING_SETTINGS_COPY.reduceMotion))).toBe(READING_SETTINGS_COPY.reduceMotionNote.off);
    expect(noteOf(off.host, switchNamed(off.host, READING_SETTINGS_COPY.wordByWord))).toBe(READING_SETTINGS_COPY.wordByWordNote.off);
    expect(noteOf(off.host, switchNamed(off.host, READING_SETTINGS_COPY.singleKeys))).toMatch(/Single keys do nothing/);
    off.cleanup();
  });

  it('names the palette chord the way the platform does', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)');
    const mac = renderReading();
    expect(noteOf(mac.host, switchNamed(mac.host, READING_SETTINGS_COPY.singleKeys))).toContain('⌘K always opens them');
    mac.cleanup();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const pc = renderReading();
    expect(noteOf(pc.host, switchNamed(pc.host, READING_SETTINGS_COPY.singleKeys))).toContain('Ctrl+K always opens them');
    pc.cleanup();
  });

  it('shares no label with any other control in the menu - "As written" belongs to Voice style alone', () => {
    const view = renderReading();
    expect(view.host.textContent).not.toContain('As written');
    view.cleanup();
  });

  it('sends each choice to its handler, in the stored vocabulary', () => {
    const view = renderReading();
    act(() => radio(view.host, 'Text size', 'Larger').click());
    act(() => switchNamed(view.host, READING_SETTINGS_COPY.reduceMotion).click());
    act(() => switchNamed(view.host, READING_SETTINGS_COPY.wordByWord).click());
    act(() => switchNamed(view.host, READING_SETTINGS_COPY.singleKeys).click());
    expect(view.props.onSetReadingScale).toHaveBeenCalledWith('larger');
    expect(view.props.onSetMotion).toHaveBeenCalledWith('reduced');
    expect(view.props.onSetNarrationReveal).toHaveBeenCalledWith('whole');
    expect(view.props.onSetShortcuts).toHaveBeenCalledWith('off');
    view.cleanup();
  });

  it('is a register of the configuration menu when the menu is given it, and absent otherwise', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const base = {
      onClose: vi.fn(), apiKey: null, onSaveApiKey: vi.fn(), onClearApiKey: vi.fn(),
      pacingPosture: 'balanced' as const, onSetPacingPosture: vi.fn(), isNox: false, onSetIsNox: vi.fn(),
      gmConsoleEnabled: true, onSetGmConsoleEnabled: vi.fn(), gmInterventionEnabled: true, onSetGmInterventionEnabled: vi.fn(),
      narrationVoiceMode: 'off' as const, onSetNarrationVoiceMode: vi.fn(),
      isMockMode: false, onSetIsMockMode: vi.fn(), gmConsoleOpen: false, onSetGmConsoleOpen: vi.fn(),
      hasSavedReign: false, onExportReign: vi.fn(),
      narrators: [], narratorId: 'dramatic-reader', onSetNarrator: vi.fn(), onSetNarratorCharacter: vi.fn(), onSetVoiceStyle: vi.fn(),
    };
    act(() => root.render(<SettingsMenu {...base} />));
    expect(host.querySelector('#settings-reading')).toBeNull();
    act(() => root.render(<SettingsMenu {...base} reading={{
      readingScale: 'standard', onSetReadingScale: vi.fn(), motion: 'device', onSetMotion: vi.fn(),
      narrationReveal: 'stream', onSetNarrationReveal: vi.fn(), shortcuts: 'on', onSetShortcuts: vi.fn(),
    }} />));
    expect(host.querySelector('#settings-reading')?.textContent).toBe(READING_SETTINGS_COPY.heading);
    act(() => root.unmount());
    host.remove();
  });
});

describe('Settings → Lighting: follow the device, or always one skin', () => {
  const base = {
    onClose: vi.fn(), apiKey: null, onSaveApiKey: vi.fn(), onClearApiKey: vi.fn(),
    pacingPosture: 'balanced' as const, onSetPacingPosture: vi.fn(), isNox: false, onSetIsNox: vi.fn(),
    gmConsoleEnabled: true, onSetGmConsoleEnabled: vi.fn(), gmInterventionEnabled: true, onSetGmInterventionEnabled: vi.fn(),
    narrationVoiceMode: 'off' as const, onSetNarrationVoiceMode: vi.fn(),
    isMockMode: false, onSetIsMockMode: vi.fn(), gmConsoleOpen: false, onSetGmConsoleOpen: vi.fn(),
    hasSavedReign: false, onExportReign: vi.fn(),
    narrators: [], narratorId: 'dramatic-reader', onSetNarrator: vi.fn(), onSetNarratorCharacter: vi.fn(), onSetVoiceStyle: vi.fn(),
  };
  const lightingButtons = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLButtonElement>('[aria-label^="Lighting"] button')];

  it('offers Device, LVX and NOX; Device is chosen while nothing is stored, and choosing it clears the choice', () => {
    const onSetLightingChoice = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<SettingsMenu {...base} lightingChoice={null} onSetLightingChoice={onSetLightingChoice} />));
    expect(lightingButtons(host).map(b => b.textContent)).toEqual(['◐ Device', '☼ LVX', '☾ NOX']);
    expect(lightingButtons(host)[0].getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain(LIGHTING_COPY.device);
    act(() => lightingButtons(host)[2].click());
    expect(onSetLightingChoice).toHaveBeenLastCalledWith('nox');

    act(() => root.render(<SettingsMenu {...base} isNox lightingChoice="nox" onSetLightingChoice={onSetLightingChoice} />));
    expect(lightingButtons(host)[2].getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain(LIGHTING_COPY.chosen);
    act(() => lightingButtons(host)[0].click());
    expect(onSetLightingChoice).toHaveBeenLastCalledWith(null);
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the two-way control for a surface that predates the choice', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<SettingsMenu {...base} />));
    expect(lightingButtons(host).map(b => b.textContent)).toEqual(['☼ LVX', '☾ NOX']);
    act(() => root.unmount());
    host.remove();
  });
});

// The stylesheet half of the Reading register cannot be measured in jsdom
// (no layout, no zoom), so its contract is pinned in the source instead:
// what the text size reaches, and that a dialog taller than the window
// scrolls rather than clipping - a fate has no close control.
describe('the reading stylesheet contract', () => {
  const shell = readFileSync(resolve(__dirname, '../design/shell.css'), 'utf8');
  const zoomRule = shell.slice(0, shell.indexOf('{zoom:var(--reading-zoom)}'));
  const zoomSelectors = zoomRule.slice(zoomRule.lastIndexOf('}') + 1);

  it('scales everything the player reads, and nothing that is chrome', () => {
    for (const surface of [
      'section[data-screen-label="Chat"]>[role="log"]>*', '.gor-panel-body>*', '.gor-dossier-head',
      '.gor-event-body', '.gor-event-choices', '.gor-private-scene [role="log"]>*', '.gor-narration-log-entry',
    ]) {
      expect(zoomSelectors, surface).toContain(`html[data-gor-reading] ${surface}`);
    }
    for (const chrome of ['.gor-masthead', '.gor-panel-tabs', '.gor-btn', '.gor-dialog-head']) {
      expect(zoomSelectors, chrome).not.toContain(chrome);
    }
  });

  it('lets a tall dialog scroll from its top instead of being cut off at both ends', () => {
    expect(shell).toMatch(/\.gor-dialog-backdrop\{overflow-y:auto;[^}]*place-items:center;place-items:safe center\}/);
  });

  it('draws a fate\'s reading parts with the classes the scale reaches', async () => {
    const { default: EventModal } = await import('../components/EventModal');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<EventModal
      event={{
        id: 'e', title: 'A fate', description: 'The Guard waits.', trigger: () => false,
        options: [{ text: 'Pay them', description: 'Coin buys time.', deltas: [] }],
      }}
      onChoose={vi.fn()}
    />));
    expect(host.querySelector('.gor-event-body')?.textContent).toBe('The Guard waits.');
    expect(host.querySelector('.gor-event-choices .gor-event-choice')).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
