/**
 * `ai/core/turnReplay.ts` — the Fixtures pane's "Strike the mould again".
 *
 * The plaque has always claimed the recorded seed "replays this turn's rolls
 * in draw order". These tests are what make that claim checkable: each entry
 * below is built by ACTUALLY drawing from `createSeededRng(seed)`, so a
 * faithful record is faithful by construction and a tampered one is tampered
 * in exactly one place.
 *
 * Per D4 every value here is a hidden roll: GM-console-only, never rendered
 * on a player surface.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import { replayTurnDraws } from '../ai/core/turnReplay';
import type { ActionResolutionEvent, MortalityEvent, TurnHistoryEntry } from '../types';

const SEED = 0x5EEDF00D;

/** The draws the seed genuinely produces, in the documented order. */
function drawsFrom(seed: number, count: number): number[] {
  const rng = createSeededRng(seed);
  return Array.from({ length: count }, () => rollD20(rng));
}

function resolutionTrace(roll: number): ActionResolutionEvent {
  return {
    assessment: {
      is_consequential: true,
      action_category: 'oratory',
      relevant_skill: 'oratory',
      difficulty: 12,
      opposing_entity_id: null,
      rationale: 'Addressed the Senate.',
    },
    roll,
    total: roll + 4,
    margin: roll + 4 - 12,
    tier: 'success',
  };
}

function mortalityEvent(name: string, roll: number | undefined, valid = true): MortalityEvent {
  return {
    entity_id: name.toLowerCase(),
    entity_name: name,
    claim: 'Struck down in the forum.',
    valid,
    ...(roll === undefined ? {} : { roll, band: 'dies' }),
    outcomeSummary: valid ? 'Died as claimed.' : 'Claim rejected — never reached the dice.',
  };
}

function entry(overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return {
    turnNumber: 4,
    playerIntent: 'Address the Senate',
    adjudication: { turn: 4, entityActions: [], deltas: [], headlines: [], gm_private: [] },
    turnSeed: SEED,
    ...overrides,
  };
}

describe('replayTurnDraws', () => {
  it('re-draws every roll and finds the mould holding on a faithful record', () => {
    const [action, first, second] = drawsFrom(SEED, 3);
    const result = replayTurnDraws(entry({
      resolutionTrace: resolutionTrace(action),
      mortalityTrace: [mortalityEvent('Gaius', first), mortalityEvent('Livia', second)],
    }));

    expect(result.verifiable).toBe(true);
    expect(result.allMatch).toBe(true);
    expect(result.draws).toEqual([
      { label: 'Action · oratory', recorded: action, redrawn: action, matches: true },
      { label: 'Mortality · Gaius', recorded: first, redrawn: first, matches: true },
      { label: 'Mortality · Livia', recorded: second, redrawn: second, matches: true },
    ]);
  });

  it('marks exactly the tampered draw as a mismatch and leaves the rest standing', () => {
    const [action, first, second] = drawsFrom(SEED, 3);
    // Tamper with the MIDDLE draw only: the third must still line up, which
    // is what proves the replay is positional rather than a bulk re-roll.
    const tampered = first === 20 ? 1 : first + 1;
    const result = replayTurnDraws(entry({
      resolutionTrace: resolutionTrace(action),
      mortalityTrace: [mortalityEvent('Gaius', tampered), mortalityEvent('Livia', second)],
    }));

    expect(result.verifiable).toBe(true);
    expect(result.allMatch).toBe(false);
    expect(result.draws.map(draw => draw.matches)).toEqual([true, false, true]);
    expect(result.draws[1]).toEqual({
      label: 'Mortality · Gaius', recorded: tampered, redrawn: first, matches: false,
    });
  });

  it('starts at the first mortality roll when the action was not consequential', () => {
    // No resolutionTrace means no action roll was ever made, so the FIRST
    // draw off the generator belongs to the first mortality claim.
    const [first, second] = drawsFrom(SEED, 2);
    const result = replayTurnDraws(entry({
      mortalityTrace: [mortalityEvent('Gaius', first), mortalityEvent('Livia', second)],
    }));

    expect(result.allMatch).toBe(true);
    expect(result.draws.map(draw => draw.label)).toEqual(['Mortality · Gaius', 'Mortality · Livia']);
  });

  it('lets an invalidated claim consume no draw, so every later draw stays aligned', () => {
    const [first, second] = drawsFrom(SEED, 2);
    const result = replayTurnDraws(entry({
      mortalityTrace: [
        mortalityEvent('Gaius', first),
        // Rejected by the validation call: never reached the dice.
        mortalityEvent('Phantom', undefined, false),
        mortalityEvent('Livia', second),
      ],
    }));

    expect(result.draws).toHaveLength(2);
    expect(result.draws.map(draw => draw.label)).toEqual(['Mortality · Gaius', 'Mortality · Livia']);
    expect(result.allMatch).toBe(true);
  });

  it('reports a seedless turn as unverifiable rather than as a mismatch', () => {
    const result = replayTurnDraws(entry({
      turnSeed: undefined,
      mortalityTrace: [mortalityEvent('Gaius', 13)],
    }));

    expect(result.verifiable).toBe(false);
    expect(result.draws).toEqual([]);
    // Nothing was checked, so nothing may be claimed to hold.
    expect(result.allMatch).toBe(false);
  });

  it('is vacuously satisfied by a seeded turn that drew no dice', () => {
    const result = replayTurnDraws(entry());
    expect(result.verifiable).toBe(true);
    expect(result.draws).toEqual([]);
    expect(result.allMatch).toBe(true);
  });
});
