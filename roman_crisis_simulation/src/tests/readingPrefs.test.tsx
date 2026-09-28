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
import SettingsMenu from '../components/SettingsMenu';
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

  it('describes the choice in force under every control, and ties the note to it', () => {
    const view = renderReading({ readingScale: 'large', motion: 'reduced', narrationReveal: 'whole', shortcuts: 'off' });
    const text = view.host.textContent ?? '';
    expect(text).toContain(READING_SETTINGS_COPY.textSizeNote.large);
    expect(text).toContain(READING_SETTINGS_COPY.motionNote.reduced);
    expect(text).toContain(READING_SETTINGS_COPY.narrationNote.whole);
    expect(text).toContain(READING_SETTINGS_COPY.shortcutNote.off);
    const sizeGroup = view.host.querySelector('[role="radiogroup"][aria-label="Text size"]')!;
    const noteId = sizeGroup.getAttribute('aria-describedby')!;
    expect(view.host.querySelector(`#${noteId}`)?.textContent).toBe(READING_SETTINGS_COPY.textSizeNote.large);
    expect(radio(view.host, 'Text size', 'Large').getAttribute('aria-checked')).toBe('true');
    view.cleanup();
  });

  it('sends each choice to its handler', () => {
    const view = renderReading();
    act(() => radio(view.host, 'Text size', 'Larger').click());
    act(() => radio(view.host, 'Motion', 'Still').click());
    act(() => radio(view.host, 'Narration', 'Whole').click());
    act(() => radio(view.host, 'Single-key shortcuts', 'Off').click());
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
