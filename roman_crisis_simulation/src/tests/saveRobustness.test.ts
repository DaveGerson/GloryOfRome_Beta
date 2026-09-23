/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveGame,
  loadGame,
  importSaveBlob,
  isQuotaExceededError,
  SAVE_KEY,
  SAVE_VERSION,
} from '../persistence/saveGame';
import {
  FIRST_SAVE_VERSION,
  SAVE_MIGRATIONS,
  migrateSaveEnvelope,
  missingMigrationSteps,
  type SaveMigrationRegistry,
} from '../persistence/saveMigrations';
import { makeLegacySaveState as makeState } from './factories';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('persistence/saveMigrations', () => {
  const base = { version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: { turnNumber: 2, entities: [] } };

  it('has a registered step for every version below SAVE_VERSION (the chain has no holes)', () => {
    expect(missingMigrationSteps(SAVE_VERSION)).toEqual([]);
    expect(FIRST_SAVE_VERSION).toBeLessThanOrEqual(SAVE_VERSION);
  });

  it('returns a current-version envelope untouched (same reference)', () => {
    const outcome = migrateSaveEnvelope(base, 1);
    expect(outcome).toEqual({ ok: true, envelope: base, migratedFrom: null });
    expect(outcome.ok && outcome.envelope).toBe(base);
  });

  it('applies each step in order and stamps the target version, without mutating the input', () => {
    const registry: SaveMigrationRegistry = {
      1: state => ({ ...state, addedInV2: true }),
      2: state => ({ ...state, turnNumber: (state['turnNumber'] as number) * 10 }),
    };
    const input = structuredClone(base);
    const outcome = migrateSaveEnvelope(input, 3, registry);
    expect(outcome).toEqual({
      ok: true,
      migratedFrom: 1,
      envelope: { version: 3, savedAt: base.savedAt, state: { turnNumber: 20, entities: [], addedInV2: true } },
    });
    expect(input).toEqual(base);
  });

  it('refuses newer, non-integer, pre-history and hole-in-chain versions as version_mismatch', () => {
    const registry: SaveMigrationRegistry = { 2: s => s };
    expect(migrateSaveEnvelope({ ...base, version: 4 }, 3, registry)).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(migrateSaveEnvelope({ ...base, version: 1.5 }, 3, registry)).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(migrateSaveEnvelope({ ...base, version: 0 }, 3, registry)).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(migrateSaveEnvelope({ ...base, version: 1 }, 3, registry)).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(missingMigrationSteps(3, registry)).toEqual([1]);
  });

  it('does not treat inherited Object.prototype keys as migration steps', () => {
    // `constructor` etc. are not numeric, but guard the lookup regardless.
    expect(migrateSaveEnvelope({ ...base, version: 1 }, 2, Object.create({ 1: () => ({}) }))).toEqual({
      ok: false,
      reason: 'version_mismatch',
    });
  });

  it('reports migration_failed when a step throws or returns a non-object', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing: SaveMigrationRegistry = { 1: () => { throw new Error('boom'); } };
    const bogus: SaveMigrationRegistry = { 1: () => [] as unknown as Record<string, unknown> };
    expect(migrateSaveEnvelope(base, 2, throwing)).toEqual({ ok: false, reason: 'migration_failed' });
    expect(migrateSaveEnvelope(base, 2, bogus)).toEqual({ ok: false, reason: 'migration_failed' });
  });

  it('the live registry is frozen so a stray write cannot register a step at runtime', () => {
    expect(Object.isFrozen(SAVE_MIGRATIONS)).toBe(true);
  });
});

describe('persistence/saveGame backward compatibility', () => {
  it('loads a literal v1 blob (as written by every shipped build) byte-identically', () => {
    const blob = JSON.stringify({ version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: makeState({ turnNumber: 7 }) });
    localStorage.setItem(SAVE_KEY, blob);
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(JSON.stringify(loaded)).toBe(blob);
  });

  it('still refuses an envelope with no version field, exactly as before', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(SAVE_KEY, JSON.stringify({ savedAt: 'x', state: makeState() }));
    expect(loadGame()).toBeNull();
    expect(importSaveBlob(JSON.stringify({ savedAt: 'x', state: makeState() }))).toEqual({ ok: false, reason: 'not_a_reign' });
  });

  it('import stores a current-version file verbatim', () => {
    const blob = `{"version":${SAVE_VERSION},"savedAt":"x","state":{"entities":[],"turnNumber":3}}`;
    expect(importSaveBlob(blob)).toEqual({ ok: true, turnNumber: 3, characterName: 'Unknown' });
    expect(localStorage.getItem(SAVE_KEY)).toBe(blob);
  });
});

describe('persistence/saveGame quota handling', () => {
  it('classifies every browser spelling of a full quota', () => {
    expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError({ name: 'Error', code: 22 })).toBe(true);
    expect(isQuotaExceededError({ name: 'Error', code: 1014 })).toBe(true);
    expect(isQuotaExceededError(new DOMException('denied', 'SecurityError'))).toBe(false);
    expect(isQuotaExceededError(new Error('x'))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError('QuotaExceededError')).toBe(false);
  });

  it('reports storage_unavailable (not quota) when storage is disabled', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(saveGame(makeState())).toEqual({ ok: false, reason: 'storage_unavailable' });
  });

  it('reports build_failed without touching storage when the state cannot be serialized', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const state = makeState();
    (state as unknown as Record<string, unknown>)['metaNarrative'] = BigInt(1);
    expect(saveGame(state)).toEqual({ ok: false, reason: 'build_failed' });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('succeeds via the stripped retry after a quota error and reports ok', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      calls++;
      if (calls === 1) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, key, value);
    });
    expect(saveGame(makeState())).toEqual({ ok: true });
  });
});
