/**
 * persistence/readingPrefs.ts
 *
 * Reading, motion and keyboard preferences (ROADMAP_UPLEVEL_2026-09.md P5,
 * UI_SYSTEMS_CURRENT_AND_FUTURE.md 12.3): how large the chronicle reads,
 * whether anything moves that need not, whether the narration streams in
 * or arrives whole, whether single-key shortcuts are live, and whether the
 * player's own dossier head is folded. Device/browser preferences in exactly
 * the mold of persistence/uiPrefs.ts - never save state, never campaign data
 * (D17), and every one of them is set only from the configuration menu (D43)
 * except the dossier fold, which is the fold control itself.
 *
 * Guarded like every sibling: any localStorage call can throw (private mode
 * `SecurityError`, storage disabled, quota) and must never crash the game.
 * A stored value outside a preference's closed list reads back as that
 * preference's default, so a stale or hand-edited key is harmless.
 */

/** How large the reading surfaces are drawn: the chronicle, the registers and the tablet. */
export type ReadingScale = 'standard' | 'large' | 'larger';
export const READING_SCALES: readonly ReadingScale[] = ['standard', 'large', 'larger'];

/**
 * `'device'` follows `prefers-reduced-motion`; `'reduced'` stills the client
 * whatever the device says. There is deliberately no "force motion on": a
 * device that asks for reduced motion is always obeyed.
 */
export type MotionPreference = 'device' | 'reduced';
export const MOTION_PREFERENCES: readonly MotionPreference[] = ['device', 'reduced'];

/** Whether the week's narration streams in as it is written, or appears whole once committed. */
export type NarrationReveal = 'stream' | 'whole';
export const NARRATION_REVEALS: readonly NarrationReveal[] = ['stream', 'whole'];

/**
 * WCAG 2.1.4 (character key shortcuts): the single-key shortcuts (1-7, `/`,
 * `?`) must be able to be turned off. Ctrl/Cmd+K is a modifier chord and is
 * never affected.
 */
export type ShortcutPreference = 'on' | 'off';
export const SHORTCUT_PREFERENCES: readonly ShortcutPreference[] = ['on', 'off'];

export const DEFAULT_READING_SCALE: ReadingScale = 'standard';
export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'device';
export const DEFAULT_NARRATION_REVEAL: NarrationReveal = 'stream';
export const DEFAULT_SHORTCUT_PREFERENCE: ShortcutPreference = 'on';

export const READING_SCALE_KEY = 'gloryOfRome:readingScale';
export const MOTION_PREFERENCE_KEY = 'gloryOfRome:motion';
const NARRATION_REVEAL_KEY = 'gloryOfRome:narrationReveal';
const SHORTCUT_PREFERENCE_KEY = 'gloryOfRome:shortcuts';
const DOSSIER_FOLDED_KEY = 'gloryOfRome:dossierFolded';

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  } catch (e) {
    console.warn(`readingPrefs(${key}): localStorage.getItem failed`, e);
    return fallback;
  }
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`readingPrefs(${key}): localStorage.setItem failed`, e);
  }
}

export function getReadingScale(): ReadingScale {
  return readEnum(READING_SCALE_KEY, READING_SCALES, DEFAULT_READING_SCALE);
}
export function setReadingScale(scale: ReadingScale): void {
  writeValue(READING_SCALE_KEY, scale);
}

export function getMotionPreference(): MotionPreference {
  return readEnum(MOTION_PREFERENCE_KEY, MOTION_PREFERENCES, DEFAULT_MOTION_PREFERENCE);
}
export function setMotionPreference(motion: MotionPreference): void {
  writeValue(MOTION_PREFERENCE_KEY, motion);
}

export function getNarrationReveal(): NarrationReveal {
  return readEnum(NARRATION_REVEAL_KEY, NARRATION_REVEALS, DEFAULT_NARRATION_REVEAL);
}
export function setNarrationReveal(reveal: NarrationReveal): void {
  writeValue(NARRATION_REVEAL_KEY, reveal);
}

export function getShortcutPreference(): ShortcutPreference {
  return readEnum(SHORTCUT_PREFERENCE_KEY, SHORTCUT_PREFERENCES, DEFAULT_SHORTCUT_PREFERENCE);
}
export function setShortcutPreference(shortcuts: ShortcutPreference): void {
  writeValue(SHORTCUT_PREFERENCE_KEY, shortcuts);
}

/** Whether the player's own dossier head atop the side panel is folded to its name line. Default: open. */
export function getDossierFolded(): boolean {
  return readEnum(DOSSIER_FOLDED_KEY, ['1', '0'] as const, '0') === '1';
}
export function setDossierFolded(folded: boolean): void {
  writeValue(DOSSIER_FOLDED_KEY, folded ? '1' : '0');
}

/**
 * Paints the two document-level preferences onto `<html>` as data
 * attributes, which design/shell.css keys its reading scale and its
 * reduced-motion override off. The defaults are the ABSENCE of the
 * attribute, so a device that never chose anything renders byte-identically
 * to before these preferences existed. index.html seeds the same attributes
 * before first paint from the same keys, so a large-type reader never sees
 * a frame of small type.
 */
export function applyReadingPrefsToDocument(
  root: HTMLElement,
  prefs: { readingScale: ReadingScale; motion: MotionPreference },
): void {
  if (prefs.readingScale === DEFAULT_READING_SCALE) root.removeAttribute('data-gor-reading');
  else root.setAttribute('data-gor-reading', prefs.readingScale);
  if (prefs.motion === DEFAULT_MOTION_PREFERENCE) root.removeAttribute('data-gor-motion');
  else root.setAttribute('data-gor-motion', prefs.motion);
}

/**
 * True when nothing should move that need not: the player chose "Still" in
 * the configuration menu, or the device asks for reduced motion. For the
 * few motions JavaScript drives itself (smooth scrolling), which the CSS
 * override cannot reach.
 */
export function motionIsReduced(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): boolean {
  if (root?.getAttribute('data-gor-motion') === 'reduced') return true;
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
