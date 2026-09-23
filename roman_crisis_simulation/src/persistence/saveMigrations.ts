/**
 * persistence/saveMigrations.ts
 *
 * The explicit upgrade path for persisted save envelopes. Before this file,
 * `SAVE_VERSION` was a bare gate: anything that was not exactly the current
 * version was discarded as `version_mismatch`, so the first genuinely
 * incompatible `SaveGameState` change would have silently erased every
 * player's campaign. Additive, optional fields never needed a bump (see the
 * long "Optional so `SAVE_VERSION` stays at 1" notes in saveGame.ts) and
 * still don't - this registry exists for the change that cannot be additive.
 *
 * HOW TO BUMP THE SAVE VERSION
 *   1. Make the incompatible change to `SaveGameState` (saveGame.ts).
 *   2. Bump `SAVE_VERSION` there from N to N + 1.
 *   3. Register `SAVE_MIGRATIONS[N]`: a PURE function taking a version-N
 *      `state` object and returning the version-(N+1) `state`. It must not
 *      read storage, the clock, or the network, and must tolerate the loose
 *      shapes `looksLikeSaveGame` admits (interior fields can be anything a
 *      hand-edited save carries).
 *   4. Add a fixture test: a literal vN blob in, the expected vN+1 state out.
 *   The `persistence/saveMigrations` tests assert the chain from 1 to
 *   `SAVE_VERSION` has no holes, so step 3 cannot be forgotten silently.
 *
 * This module deliberately does NOT import saveGame.ts (saveGame imports
 * it); the target version is always passed in.
 */

/** Upgrades the `state` of a version-N envelope to version N + 1. Pure. */
export type SaveMigration = (state: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version a migration upgrades FROM (N -> N + 1). */
export type SaveMigrationRegistry = Readonly<Record<number, SaveMigration>>;

/** The oldest version any build of the game ever wrote. */
export const FIRST_SAVE_VERSION = 1;

/**
 * The live registry. Empty while `SAVE_VERSION` is 1: every save ever
 * written is already current, so `migrateSaveEnvelope` returns it untouched
 * (same object reference - existing saves load byte-identically).
 */
export const SAVE_MIGRATIONS: SaveMigrationRegistry = Object.freeze({});

/** The minimal envelope shape `looksLikeSaveGame` has already vouched for. */
export interface MigratableEnvelope {
  version: number;
  savedAt: string;
  state: object;
}

export type MigrationOutcome<E extends MigratableEnvelope> =
  | { ok: true; envelope: E; migratedFrom: number | null }
  | { ok: false; reason: 'version_mismatch' | 'migration_failed' };

/**
 * Brings `envelope` up to `targetVersion` by applying each registered step
 * in order. Never throws.
 *
 *  - version === target: returned as-is (`migratedFrom: null`).
 *  - version newer than target, non-integer, below FIRST_SAVE_VERSION, or
 *    with a hole in the chain: `version_mismatch` (a newer build's save, or
 *    one this build has no path for - never guess at it).
 *  - a migration step throws or returns a non-object: `migration_failed`.
 *
 * The returned envelope is a fresh object carrying `version: targetVersion`
 * whenever any step ran; the input is never mutated (steps receive a
 * shallow copy of the state).
 */
export function migrateSaveEnvelope<E extends MigratableEnvelope>(
  envelope: E,
  targetVersion: number,
  migrations: SaveMigrationRegistry = SAVE_MIGRATIONS,
): MigrationOutcome<E> {
  const from = envelope.version;
  if (from === targetVersion) return { ok: true, envelope, migratedFrom: null };
  if (!Number.isInteger(from) || from < FIRST_SAVE_VERSION || from > targetVersion) {
    return { ok: false, reason: 'version_mismatch' };
  }

  let state = { ...envelope.state } as Record<string, unknown>;
  for (let version = from; version < targetVersion; version++) {
    const step = Object.prototype.hasOwnProperty.call(migrations, version) ? migrations[version] : undefined;
    if (typeof step !== 'function') return { ok: false, reason: 'version_mismatch' };
    try {
      const next: unknown = step(state);
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        return { ok: false, reason: 'migration_failed' };
      }
      state = next as Record<string, unknown>;
    } catch (e) {
      console.warn(`migrateSaveEnvelope: migration v${version} -> v${version + 1} threw`, e);
      return { ok: false, reason: 'migration_failed' };
    }
  }

  return {
    ok: true,
    envelope: { ...envelope, version: targetVersion, state } as E,
    migratedFrom: from,
  };
}

/**
 * The versions in [FIRST_SAVE_VERSION, targetVersion) that have NO
 * registered step. Empty means every save this game ever wrote can be
 * upgraded. Exists for the chain-completeness test.
 */
export function missingMigrationSteps(
  targetVersion: number,
  migrations: SaveMigrationRegistry = SAVE_MIGRATIONS,
): number[] {
  const missing: number[] = [];
  for (let version = FIRST_SAVE_VERSION; version < targetVersion; version++) {
    if (typeof migrations[version] !== 'function') missing.push(version);
  }
  return missing;
}
