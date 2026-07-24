import { describe, expect, it } from 'vitest';
import {
  assertNoInventedPlayerVisibleAction,
  assertPlayerVisibleAdjudicationSafe,
  assertPlayerVisibleTextSafe,
} from '../ai/core/playerBoundary';
import type { Adjudication, Entity } from '../types';

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
    ['humanized outcome label', 'Outcome tier: critical failure.'],
    ['hyphenated outcome label', 'Outcome-tier: critical-success.'],
    ['humanized fate label', 'Fate band: presumed dead.'],
    ['roll-total disclosure', 'The roll total was 7.'],
    ['margin disclosure', 'The margin was -3 after modifiers.'],
    ['case and default-ignorable humanized label', 'OuTcOmE\u200d TiEr: CrItIcAl\u2060 FaIlUrE.'],
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

describe('no-attempt player ownership boundary', () => {
  const player: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    position: 'Emperor',
  };

  it.each([
    'Gaius Testus signs the decree.',
    'The Emperor votes with the optimates.',
    'You meet the legate at dawn.',
    'The player refuses the petition.',
    'The avatar flees the Forum.',
    'I sign the decree.',
    'I vote with the optimates.',
    'I meet the legate at dawn.',
    'I refuse the petition.',
    'I flee the Forum.',
    'The decree is signed by you.',
  ])('fails closed on an unowned player-subject predicate: %s', prose => {
    let thrown: unknown;
    try {
      assertNoInventedPlayerVisibleAction(prose, player, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AI output violated the player action boundary.');
    expect((thrown as Error).message).not.toContain(prose);
  });

  it.each([
    'Gaius Testus does not sign the decree.',
    'You never vote on the motion.',
    'I do not meet the legate.',
    'The decree is not signed by you.',
    'Without the player acting, the Senate adjourns.',
    'You see empty benches in the Curia.',
    'Gaius Testus knows the consul is absent.',
    'I believe the vote will fail.',
    'You intend to question the messenger later.',
    'I wonder whether the legions remain loyal.',
    'You are uneasy.',
    'I must tread carefully among the wolves of the Senate.',
  ])('allows an explicit non-action, observation, cognition, state, or intention: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  it('does not constrain player-attributed action prose when an observable attempt exists', () => {
    expect(() => assertNoInventedPlayerVisibleAction('I sign the decree.', player, true)).not.toThrow();
  });
});
