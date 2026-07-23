/**
 * @vitest-environment jsdom
 *
 * tests/apiKey.test.ts
 *
 * DESIGN_DECISIONS.md D34 - persistence/apiKey.ts's localStorage round-trip
 * and the pure `resolveApiKey` priority chain. Mirrors tests/pacing.test.ts
 * / tests/onboarding.test.ts's beforeEach/afterEach and throwing-storage
 * conventions exactly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiKey, setApiKey, clearApiKey, resolveApiKey } from '../persistence/apiKey';

describe('resolveApiKey (pure priority chain)', () => {
  it('returns the user key when both a user key and a dev key are set (user priority)', () => {
    expect(resolveApiKey('AIzaUserKey', 'AIzaDevKey')).toBe('AIzaUserKey');
  });

  it('falls back to the dev key when the user key is undefined, null, or empty', () => {
    expect(resolveApiKey(undefined, 'AIzaDevKey')).toBe('AIzaDevKey');
    expect(resolveApiKey(null, 'AIzaDevKey')).toBe('AIzaDevKey');
    expect(resolveApiKey('', 'AIzaDevKey')).toBe('AIzaDevKey');
  });

  it('returns null (never a sentinel string) when both are absent', () => {
    expect(resolveApiKey(undefined, undefined)).toBeNull();
    expect(resolveApiKey(null, null)).toBeNull();
    expect(resolveApiKey('', '')).toBeNull();
  });

  it('treats a whitespace-only user key as absent, falling through to the dev key', () => {
    expect(resolveApiKey('   ', 'AIzaDevKey')).toBe('AIzaDevKey');
  });

  it('returns the user key when the dev key is empty but the user key is set', () => {
    expect(resolveApiKey('AIzaUserKey', '')).toBe('AIzaUserKey');
  });
});

describe('persistence/apiKey: localStorage round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns null before anything has been stored', () => {
    expect(getApiKey()).toBeNull();
  });

  it('round-trips a key: setApiKey then getApiKey, then clearApiKey resets to null', () => {
    setApiKey('AIzaSyTestKeyValue');
    expect(getApiKey()).toBe('AIzaSyTestKeyValue');
    clearApiKey();
    expect(getApiKey()).toBeNull();
  });

  it('reads a corrupt/empty stored value as null, never as an empty string', () => {
    localStorage.setItem('gloryOfRome:apiKey', '');
    expect(getApiKey()).toBeNull();
  });

  it('never throws and reads as null when localStorage.getItem throws (e.g. private mode SecurityError)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });

    expect(() => getApiKey()).not.toThrow();
    expect(getApiKey()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => setApiKey('AIzaSyTestKeyValue')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('lives under its own key, never inside the save bundle (the key must never enter the save blob)', () => {
    setApiKey('AIzaSyTestKeyValue');
    expect(localStorage.getItem('gloryOfRome:apiKey')).toBe('AIzaSyTestKeyValue');
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
  });
});
