/**
 * persistence/settings.ts
 *
 * ROADMAP_PHASE_4.md 4D item 1 (DESIGN_DECISIONS.md D23) - the pacing
 * posture, a device/browser USER PREFERENCE. Deliberately kept OUT of
 * `SaveGameState` (persistence/saveGame.ts), exactly like
 * persistence/onboarding.ts: how eagerly the Fates tighten a slack story is
 * a preference of the human at the keyboard, not campaign state - it
 * survives `clearSave()`/`Start Anew`, and the SAME save loaded on another
 * device intentionally uses THAT device's preference.
 *
 * D23 bound: this module stores ONE enum string and nothing else. No
 * tension scalar, accumulator, or threshold state may live here or anywhere
 * else code-side - pacing is the adjudicator's own judgment; this setting
 * only tunes the posture line in its prompt (ai/prompts/adjudication.ts).
 *
 * Guarded exactly like persistence/onboarding.ts's storage access: any
 * localStorage call can throw (private/incognito `SecurityError`, storage
 * disabled entirely, quota edge cases) and must never crash the game -
 * worst case the posture reads as the 'balanced' default (or a change
 * isn't persisted), which is harmless.
 */

import { PacingPosture, PacingPostureEnum } from '../types';

const PACING_POSTURE_KEY = 'gloryOfRome:pacingPosture';

export const DEFAULT_PACING_POSTURE: PacingPosture = 'balanced';

/**
 * The device's stored pacing posture; DEFAULT_PACING_POSTURE ('balanced')
 * when unset, unreadable, or holding a value outside the enum (a corrupted
 * or future-version key must never leak an arbitrary string into a prompt).
 */
export function getPacingPosture(): PacingPosture {
  try {
    const stored = localStorage.getItem(PACING_POSTURE_KEY);
    return stored !== null && (PacingPostureEnum as readonly string[]).includes(stored)
      ? (stored as PacingPosture)
      : DEFAULT_PACING_POSTURE;
  } catch (e) {
    console.warn('getPacingPosture: localStorage.getItem failed', e);
    return DEFAULT_PACING_POSTURE;
  }
}

/**
 * Persists the pacing posture for this device/browser. Takes effect from
 * the NEXT turn - App.tsx's executeTurn re-reads the stored value at the
 * start of every turn rather than capturing it.
 */
export function setPacingPosture(posture: PacingPosture): void {
  try {
    localStorage.setItem(PACING_POSTURE_KEY, posture);
  } catch (e) {
    console.warn('setPacingPosture: localStorage.setItem failed', e);
  }
}
