/**
 * @vitest-environment jsdom
 *
 * tests/uiPrefs.test.ts
 *
 * DESIGN_DECISIONS.md D32/D33 - persistence/uiPrefs.ts's two availability
 * toggles (GM console, GM Intervention), both defaulting TRUE so existing
 * behavior is unchanged until a player visits the configuration menu.
 * Mirrors tests/pacing.test.ts / tests/onboarding.test.ts's
 * beforeEach/afterEach and throwing-storage conventions exactly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getGmConsoleEnabled,
  setGmConsoleEnabled,
  getGmInterventionEnabled,
  setGmInterventionEnabled,
} from '../persistence/uiPrefs';

describe('persistence/uiPrefs: gmConsoleEnabled / gmInterventionEnabled', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('both default to TRUE before anything has been stored (zero behavior change out of the box)', () => {
    expect(getGmConsoleEnabled()).toBe(true);
    expect(getGmInterventionEnabled()).toBe(true);
  });

  it('round-trips false then true for gmConsoleEnabled', () => {
    setGmConsoleEnabled(false);
    expect(getGmConsoleEnabled()).toBe(false);
    setGmConsoleEnabled(true);
    expect(getGmConsoleEnabled()).toBe(true);
  });

  it('round-trips false then true for gmInterventionEnabled', () => {
    setGmInterventionEnabled(false);
    expect(getGmInterventionEnabled()).toBe(false);
    setGmInterventionEnabled(true);
    expect(getGmInterventionEnabled()).toBe(true);
  });

  it('falls back to the TRUE default when the stored value is corrupted (neither "0" nor "1")', () => {
    localStorage.setItem('gloryOfRome:gmConsoleEnabled', 'yes');
    expect(getGmConsoleEnabled()).toBe(true);
    localStorage.setItem('gloryOfRome:gmInterventionEnabled', '');
    expect(getGmInterventionEnabled()).toBe(true);
  });

  it('never throws and reads as TRUE when localStorage.getItem throws (e.g. private mode SecurityError)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });

    expect(() => getGmConsoleEnabled()).not.toThrow();
    expect(getGmConsoleEnabled()).toBe(true);
    expect(() => getGmInterventionEnabled()).not.toThrow();
    expect(getGmInterventionEnabled()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => setGmConsoleEnabled(false)).not.toThrow();
    expect(() => setGmInterventionEnabled(false)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('neither setter touches the save bundle key', () => {
    setGmConsoleEnabled(false);
    setGmInterventionEnabled(false);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
  });
});
