import { describe, expect, it } from 'vitest';
import {
  assertPlayerVisibleAdjudicationSafe,
  assertPlayerVisibleTextSafe,
} from '../ai/core/playerBoundary';
import type { Adjudication } from '../types';

function boundaryError(text: string): Error {
  let thrown: unknown;
  try {
    assertPlayerVisibleTextSafe(text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  return thrown as Error;
}

describe('player-visible mechanics boundary', () => {
  it.each([
    ['NFKC full-width tier token', 'ｃｒｉｔｉｃａｌ＿ｓｕｃｃｅｓｓ'],
    ['default-ignorable insertion', 'critical\u200d_success'],
    ['case and terminal punctuation', 'CRITICAL_SUCCESS!'],
    ['standard NdX notation', 'The hidden check uses 1d20.'],
    ['explicit die result', 'The die rolled 20.'],
  ])('rejects %s without reflecting provider content', (_label, poison) => {
    const error = boundaryError(poison);
    expect(error.message).toBe('AI output violated the player-visible mechanics boundary.');
    expect(error.message).not.toContain(poison);
  });

  it.each([
    '20 soldiers die before dawn.',
    'Soldiers die in 20 days if the fever holds.',
    'The die is cast; Rome awaits Caesar.',
    'Roll the wagons 20 miles before dusk.',
    'After the ambush, the missing envoy is presumed dead.',
  ])('accepts ordinary casualty or Roman-idiom prose: %s', prose => {
    expect(() => assertPlayerVisibleTextSafe(prose)).not.toThrow();
  });

  it('keeps raw mechanics legal in GM-only notes and private scheme state', () => {
    const adjudication: Adjudication = {
      turn: 7,
      entityActions: [],
      deltas: [{
        type: 'scheme',
        key: 'npc_a',
        delta: 0,
        reason: JSON.stringify({ name: 'critical_success', overall_goal: 'Roll 20', steps: [] }),
      }],
      headlines: ['The camps remain watchful.'],
      gm_private: ['critical_success after roll 20'],
    };

    expect(() => assertPlayerVisibleAdjudicationSafe(adjudication)).not.toThrow();
  });
});
