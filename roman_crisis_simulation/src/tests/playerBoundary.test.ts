import { describe, expect, it } from 'vitest';
import {
  assertNoInventedPlayerAction,
  assertNoInventedPlayerVisibleAction,
  assertPlayerVisibleAdjudicationSafe,
  assertPlayerVisibleTextSafe,
  createPlayerVisibleStreamGate,
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
    ['action modifier', 'The action modifier was +3.'],
    ['em-dash outcome label', 'Outcome tier — critical success.'],
    ['en-dash outcome label', 'Outcome tier – critical failure.'],
    ['sentence-separated outcome label', 'Outcome tier. Critical failure.'],
    ['resolution-tier label', 'Resolution tier: critical failure.'],
    ['check-tier label', 'Check tier: partial success.'],
    ['result-tier label', 'Result-tier: critical success.'],
    ['humanized fate variant', 'Fate band — survives with loss.'],
    ['explicit check total', 'The check total was 12.'],
  ])('rejects %s without reflecting provider content', (_label, poison) => {
    const error = boundaryError(poison);
    expect(error.message).toBe('AI output violated the player-visible mechanics boundary.');
    expect(error.message).not.toContain(poison);
  });

  it.each([
    'It was a critical success.',
    'It was a partial success.',
    'It was a critical failure.',
    'Critical success.',
    'Survives with loss.',
    'It was presumed dead.',
    'It was gravely wounded.',
    'The Senate fell silent. It was a critical success. The consul departed.',
    'The messenger paused. Presumed dead. No body was recovered.',
  ])('rejects a standalone humanized hidden tier: %s', poison => {
    const error = boundaryError(poison);
    expect(error.message).toBe('AI output violated the player-visible mechanics boundary.');
    expect(error.message).not.toContain(poison);
  });

  it.each([
    '- It was a critical success.',
    '* “It was a partial success.”',
    '+ "It was a critical failure."',
    '(Presumed dead.)',
    '**It was gravely wounded.**',
    '_Survives with loss._',
    '`Critical success.`',
    'The Curia quieted. **“It was a partial success.”** Debate resumed.',
    '> Critical success.',
    '>   It was a partial success.',
    '> > It was a critical failure.',
    '>>> **“It was gravely wounded.”**',
    '>   (Presumed dead.)',
  ])('rejects a standalone hidden tier inside common presentation wrappers: %s', poison => {
    const error = boundaryError(poison);
    expect(error.message).toBe('AI output violated the player-visible mechanics boundary.');
    expect(error.message).not.toContain(poison);
  });

  it('blocks a wrapped tier sentence before cumulative streamed prose is released', () => {
    const gate = createPlayerVisibleStreamGate();
    expect(gate.push('The Senate falls silent.')).toBe('The Senate falls silent.');
    expect(() => gate.push('The Senate falls silent.\n- “It was a critical success.”'))
      .toThrow('AI output violated the player-visible mechanics boundary.');
  });

  it('blocks a multiply quoted Markdown tier before cumulative streamed prose is released', () => {
    const gate = createPlayerVisibleStreamGate();
    expect(gate.push('The Senate falls silent.')).toBe('The Senate falls silent.');
    expect(() => gate.push('The Senate falls silent.\n> > **“It was a partial success.”**'))
      .toThrow('AI output violated the player-visible mechanics boundary.');
  });

  it.each([
    '20 soldiers die before dawn.',
    'Soldiers die in 20 days if the fever holds.',
    'The die is cast; Rome awaits Caesar.',
    'Roll the wagons 20 miles before dusk.',
    'After the ambush, the missing envoy is presumed dead.',
    'The action modifier was a senator whose speech changed the debate.',
    'The check total was debated by the accountants.',
    'The outcome tier. Critical debate followed in the Curia.',
    'The speech was a critical success with the crowd, and the Senate adjourned.',
    'The levy was only a partial success because three cohorts never arrived.',
    'The campaign was a critical failure of logistics, not courage.',
    'The vote was a success.',
    'The campaign ended in failure.',
    '- **The levy was a partial success because three cohorts never arrived.**',
    '“The speech was a critical success with the crowd, and the Senate adjourned.”',
    '> The campaign was a critical success because the grain convoy arrived.',
    '>>> **“The levy was a partial success because three cohorts never arrived.”**',
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
    'At dawn you sign the decree.',
    'A messenger reports that you sign the decree.',
    'You see the courier and dispatch guards.',
    'You do not sign but dispatch spies.',
    'You\'ll dispatch spies.',
    'Your guards arrest the envoy.',
    'Before sunrise I summon the Senate.',
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
    'I don\'t sign the decree.',
    'You see the courier and wonder who sent him.',
    'At dawn you see empty benches in the Curia.',
    'A messenger reports that you know the consul is absent.',
    'Your position is precarious.',
  ])('allows an explicit non-action, observation, cognition, state, or intention: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  it('does not constrain player-attributed action prose when an observable attempt exists', () => {
    expect(() => assertNoInventedPlayerVisibleAction('I sign the decree.', player, true)).not.toThrow();
  });

  it.each(['player_1', 'GAIUS TESTUS', 'the emperor', 'avatar'])(
    'rejects a no-attempt remove_entities entry targeting player alias %s',
    removed => {
      expect(() => assertNoInventedPlayerVisibleAction({ remove_entities: [removed] }, player, false))
        .toThrow('player action boundary');
    },
  );

  it('allows an NPC-authored rumor about the player because rumor ownership follows origin, not subject key', () => {
    const adjudication: Adjudication = {
      turn: 7,
      entityActions: [],
      deltas: [{
        type: 'rumor',
        key: 'PLAYER-1',
        delta: 0.6,
        reason: 'Aulus claims the emperor is losing the Senate.',
        is_true: false,
        origin_id: 'npc_a',
        topic: 'senate-support',
      }],
      headlines: ['A hostile rumor spreads.'],
      gm_private: [],
    };

    expect(() => assertNoInventedPlayerAction(adjudication, player, false)).not.toThrow();
  });

  it.each([
    ['normalized player origin', {
      type: 'rumor', key: 'npc_a', delta: 0.6, reason: 'A claim spreads.', is_true: false, origin_id: 'PLAYER-1', topic: 'loyalty',
    }],
    ['player-attributed prose with omitted origin', {
      type: 'rumor', key: 'npc_a', delta: 0.6, reason: 'At dawn Gaius Testus spreads a claim.', is_true: false, topic: 'loyalty',
    }],
  ] satisfies Array<[string, Adjudication['deltas'][number]]>)(
    'rejects a no-attempt rumor with %s',
    (_label, delta) => {
      const adjudication: Adjudication = {
        turn: 7,
        entityActions: [],
        deltas: [delta],
        headlines: ['A claim spreads.'],
        gm_private: [],
      };
      expect(() => assertNoInventedPlayerAction(adjudication, player, false))
        .toThrow('player action boundary');
    },
  );

  // DEBT HAS TEETH (ai/prompts/adjudication.ts): the adjudicator is
  // INSTRUCTED to raise an indebted player's dependency_level toward a
  // creditor via a 'relation' delta keyed under the player. That is the
  // world pressing ON the player, not an act BY the player - it must never
  // invalidate a no-attempt turn, or debt turns question-only submissions
  // into a deterministic reject-retry loop.
  it.each([
    ['an explicit non-player origin', 'npc_crassus'],
    ['no recorded origin', undefined],
  ])('allows a world-driven dependency_level rise keyed under the indebted player with %s', (_label, origin) => {
    const adjudication: Adjudication = {
      turn: 7,
      entityActions: [],
      deltas: [{
        type: 'relation',
        key: 'player_1:npc_crassus:dependency_level',
        delta: 2,
        reason: 'Mounting arrears leave the palace beholden to Crassus.',
        ...(origin === undefined ? {} : { origin_id: origin }),
      }],
      headlines: ['Creditors circle the Palatine.'],
      gm_private: [],
    };

    expect(() => assertNoInventedPlayerAction(adjudication, player, false)).not.toThrow();
  });

  it.each([
    ['a dependency_level delta the provider originates from the player', {
      type: 'relation', key: 'player_1:npc_crassus:dependency_level', delta: -2, reason: 'The debt is quietly restructured.', origin_id: 'player_1',
    }],
    ['a trust_level delta keyed under the player - their own opinions stay player-owned', {
      type: 'relation', key: 'player_1:npc_crassus:trust_level', delta: 2, reason: 'A new opinion forms.',
    }],
    ['a resource delta keyed under the player - expenditure is player agency', {
      type: 'resource', key: 'player_1:denarii', delta: -200, reason: 'Gold changes hands.',
    }],
  ] satisfies Array<[string, Adjudication['deltas'][number]]>)(
    'still rejects a no-attempt turn carrying %s',
    (_label, delta) => {
      const adjudication: Adjudication = {
        turn: 7,
        entityActions: [],
        deltas: [delta],
        headlines: ['The week advances.'],
        gm_private: [],
      };
      expect(() => assertNoInventedPlayerAction(adjudication, player, false))
        .toThrow('player action boundary');
    },
  );

  it('still rejects a no-attempt entityAction bearing the player id', () => {
    const adjudication: Adjudication = {
      turn: 7,
      entityActions: [{ id: 'player_1', intent: 'negotiate', target: 'npc_crassus', notes: 'A quiet accommodation is sought.' }],
      deltas: [],
      headlines: ['The week advances.'],
      gm_private: [],
    };
    expect(() => assertNoInventedPlayerAction(adjudication, player, false))
      .toThrow('player action boundary');
  });
});

describe('no-attempt title-collision prose boundary', () => {
  // A SHARED title ('Senator') is a class of officeholders, not a name -
  // third-party prose styling someone ELSE by the player's title must not
  // read as the player acting.
  const senatorPlayer: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    position: 'Senator',
  };
  // 'Emperor' is a singular office - prose subjecthood legitimately keeps it.
  const emperorPlayer: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    position: 'Emperor',
  };

  it('allows a headline styling a third party by the player\'s shared title', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      'The Senator Gaius Pontius withdraws to his estate.', senatorPlayer, false,
    )).not.toThrow();
  });

  it('still rejects the player acting by name even though their shared title no longer matches prose', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      'Gaius Testus withdraws to his estate.', senatorPlayer, false,
    )).toThrow('player action boundary');
  });

  it('still treats a shared title as the player inside identity slots', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      { remove_entities: ['the senator'] }, senatorPlayer, false,
    )).toThrow('player action boundary');
  });

  it('allows a possessive condition of the player\'s unique title - the world pressing ON the player', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      { major_ongoing_crisis: 'The Emperor\'s grip weakens.' }, emperorPlayer, false,
    )).not.toThrow();
  });

  it('allows the second-person form of the same possessive condition', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      'Your grip weakens.', emperorPlayer, false,
    )).not.toThrow();
  });

  it.each([
    ['a possessive player agent acting through their instrument', 'The Emperor\'s guards arrest the envoy.'],
    ['a possessive contraction concealing a continuous player action', 'The Emperor\'s marching on Rome.'],
    ['a possessed instrument acting transitively on an object', 'The Emperor\'s army weakens the walls of Ravenna.'],
    ['the unique title acting directly', 'The Emperor votes with the optimates.'],
  ])('still rejects %s', (_label, prose) => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, emperorPlayer, false))
      .toThrow('player action boundary');
  });

  // Subordinate-clause laundering: a possessed phrase is classified by its
  // FIRST clause only. A trailing "as/while/when/because/though/although"
  // clause must not launder the head's real action into an inert
  // circumstance just because the trailing clause happens to end in a
  // recognized intransitive condition verb.
  it.each([
    'Your agents burn the granary as the resistance weakens.',
    'The Emperor\'s guards seize the envoy as his influence grows.',
    'Your guards arrest the envoy as the resistance weakens.',
  ])('rejects a subordinate-clause-laundered possessive action: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, emperorPlayer, false))
      .toThrow('player action boundary');
  });

  it.each([
    'Your grip weakens as the Senate turns against you.',
    'Your influence wanes while the legions grumble.',
    'The Emperor\'s grip weakens as the winter drags on.',
  ])('allows a genuine possessive condition even with a trailing subordinate clause: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, emperorPlayer, false)).not.toThrow();
  });

  // Subordinator-at-index-0: when the possessed phrase's HEAD word is a
  // subordinator (natural prose reaches this because wordNormalized turns
  // hyphens into spaces: "as-yet-unnamed" -> "as yet unnamed"), truncating
  // at it erases the entire phrase, and an empty phrase must not read as
  // inert - that would turn an unknown predicate into a pass, inverting the
  // helper's fail-closed contract. Each row was rejected before the
  // subordinator truncation existed and must stay rejected.
  it.each([
    'Your as-yet-unnamed heir seizes the treasury.',
    'Your though-battered cohorts storm the gate.',
    'Your while-you-slept agents poison the wine.',
    'Your although-loyal guards murder the consul.',
    'Your because-of-Rome legions sack the city.',
    'Gaius Testus\'s as-yet-unknown agents burn the granary.',
  ])('rejects a subordinator-headed possessed phrase concealing a player action: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, emperorPlayer, false))
      .toThrow('player action boundary');
  });

  it.each([
    'Your health fails.',
    'Your scheme collapses.',
    'Your standing declines.',
    'Your reputation suffers.',
    'Your alliance shatters.',
    'The Emperor\'s bid for the consulship failed.',
  ])('allows an additional intransitive condition verb: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, emperorPlayer, false)).not.toThrow();
  });
});
