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

  // CHANGED (prose/structural split): a rumor whose ORIGIN is not the player
  // carries no player-owned mechanical change - only its `reason` prose reads
  // as the player acting. That is a narrative blemish, redacted from the
  // player-visible surface rather than failing the turn; see
  // tests/playerProseRedaction.test.ts for the redaction contract.
  it('no longer fails the turn on a non-player-originated rumor whose prose reads as the player acting', () => {
    const adjudication: Adjudication = {
      turn: 7,
      entityActions: [],
      deltas: [{
        type: 'rumor', key: 'npc_a', delta: 0.6, reason: 'At dawn Gaius Testus spreads a claim.', is_true: false, topic: 'loyalty',
      }],
      headlines: ['A claim spreads.'],
      gm_private: [],
    };

    expect(() => assertNoInventedPlayerAction(adjudication, player, false)).not.toThrow();
  });

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

/**
 * A possessed phrase must never contain an UNEXAMINED span. Truncating at a
 * subordinator and classifying only the head clause is inherently fail-OPEN:
 * the discarded tail can carry the player's action outright ("... because you
 * burned the granary"), and, symmetrically, a tail that happens to end in an
 * intransitive condition verb can launder a head that really is an action.
 * Every clause of the phrase must be classified, and any clause yielding a
 * player subject with a non-allowed predicate must fail closed.
 */
describe('no-attempt subordinate-clause classification boundary', () => {
  const player: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    position: 'Emperor',
  };

  function expectRejected(prose: string): void {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false))
      .toThrow('player action boundary');
  }

  it.each([
    // The head is a genuine condition; the DISCARDED tail carries the action.
    'Your grip weakens because you burned the granary.',
    'Your grip weakens because you murdered the consul.',
    'Your health fails because you poisoned the wine.',
    'Your influence collapses when you sack the city.',
    'Your standing falters though you seize the treasury.',
    'Your grip loosens although you storm the gate.',
    'Your resolve hardens because your legions sack the city.',
    'Your position weakens when your assassins strike the consul.',
    // A third-person possessor makes the tail's subject pronoun anaphoric to
    // the player: "Gaius Testus's grip ... because HE burned" is the player.
    'Gaius Testus\'s grip weakens because he burned the granary.',
    'Gaius Testus\'s health fails when he murders the consul.',
  ])('rejects a player action laundered into a comma-less subordinate clause: %s', expectRejected);

  // The comma form already routes each part through the normal subject and
  // predicate check upstream. It must stay rejecting: the comma-less form is
  // meant to converge ON this behaviour, not to drag it open.
  it('keeps the comma form of subordinate-clause laundering rejected', () => {
    expectRejected('Your grip weakens, because you burned the granary.');
  });

  // A third-person possessor is an antecedent for its WHOLE possessed phrase:
  // a subordinate clause can point back at the player with a pronoun subject,
  // a possessive determiner, or a passive agent.
  it.each([
    'Gaius Testus\'s grip weakens because she burned the granary.',
    'Gaius Testus\'s grip weakens because they burned the granary.',
    'Gaius Testus\'s grip weakens because his legions sacked the city.',
    'Gaius Testus\'s grip weakens because the granary was burned by him.',
  ])('rejects an anaphoric subordinate clause of a third-person possessive: %s', expectRejected);

  // DECLARED GAP 1. A SECOND-person possessive has no third-person antecedent
  // of its own: in "your grip weakens because he burned the granary" the player
  // is addressed as "you" throughout, so "he" is a rival. Binding third-person
  // forms here would only over-reject ordinary world prose about other
  // characters, on a surface that is validated every turn.
  //
  // The gap is wider than pronoun SUBJECTS. It equally covers:
  //  - third-person possessive DETERMINERS in the subordinate clause
  //    ("... because their legions sacked the city"), and
  //  - one-level-deeper possessives, where the possessed head is itself a
  //    third-person referent the tail can point back at ("Your general's grip
  //    weakens because his guards burned the granary"). The enclosing
  //    determiner is second-person, so no anaphoric scope is opened for the
  //    inner possessor either.
  // All of these are accepted BY DESIGN. Third-person prose about rivals is
  // the overwhelming majority of world narration; binding it to the player
  // would reject a large share of legitimate turns. Closing this gap requires
  // real antecedent resolution, not a wider alias set.
  it.each([
    // Pronoun subjects.
    'Your grip weakens because he burned the granary.',
    'Your grip weakens because she burned the granary.',
    'Your grip weakens because they burned the granary.',
    // Possessive determiners.
    'Your grip weakens because his legions sacked the city.',
    'Your grip weakens because her legions sacked the city.',
    'Your grip weakens because their legions sacked the city.',
    // One-level-deeper possessives.
    "Your general's grip weakens because his guards burned the granary.",
    "Your general's grip weakens because their guards burned the granary.",
  ])('allows a third-person subordinate reference under a second-person possessive: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  it.each([
    // The head clause is the action; the tail is the laundering condition.
    'Your agents burn the granary as the resistance weakens.',
    'Your assassins strike because you commanded it.',
    'Your guards suffer heavy casualties.',
  ])('rejects a head-clause action carrying a laundering tail: %s', expectRejected);

  // The subordinator set omitted the commonest English subordinators, so any
  // phrase using one kept its whole tail inside the head clause and was
  // laundered by the tail's trailing condition verb. Classifying every clause
  // makes widening the set safe.
  it.each([
    'Your agents burn the granary since the resistance weakens.',
    'Your agents burn the granary after the resistance weakens.',
    'Your agents burn the granary before the resistance weakens.',
    'Your agents burn the granary if the resistance weakens.',
    'Your agents burn the granary unless the resistance weakens.',
    'Your agents burn the granary once the resistance weakens.',
    'Your agents burn the granary until the resistance weakens.',
    'Your agents burn the granary whereas the resistance weakens.',
  ])('rejects laundering through a widened subordinator: %s', expectRejected);

  // wordNormalized turns hyphens into spaces, so a compound modifier presents
  // a subordinator as the phrase's HEAD word. That is not a clause boundary -
  // absorbing it keeps the noun phrase classifiable instead of erasing it.
  it.each([
    'Your as-yet-unnamed heir seizes the treasury.',
    'Your though-battered cohorts storm the gate.',
    'Your while-you-slept agents poison the wine.',
    'Your although-loyal guards murder the consul.',
    'Your because-of-Rome legions sack the city.',
    'Gaius Testus\'s as-yet-unknown agents burn the granary.',
  ])('rejects a subordinator-headed possessed phrase concealing an action: %s', expectRejected);

  // Head-position subordinator AND a real trailing clause: absorbing the head
  // word must not re-admit the whole-phrase suffix scan, or the trailing
  // clause's condition verb launders the action all over again.
  it.each([
    'Your as-yet-unnamed agents burn the granary as the resistance weakens.',
    'Your though-battered cohorts storm the gate while the Senate falters.',
  ])('rejects a subordinator-headed phrase with a real trailing clause: %s', expectRejected);

  // A subordinator directly behind a possessive SEVERS that possessive from
  // its possession, so neither fragment can be classified. The severed span
  // fails closed rather than splitting into two individually inert halves.
  it.each([
    'Your grip weakens because your as-yet-unnamed agents burned the granary.',
    'Your influence wanes although your though-battered cohorts storm the gate.',
    'Your grip weakens because Gaius Testus\'s as-yet-unnamed agents burned the granary.',
    'Your agents burn the granary the as the resistance weakens.',
  ])('rejects a subordinator that severs a possessive from its possession: %s', expectRejected);

  // Plain articles do not carry a player link, so a subordinator behind one
  // must stay an ordinary clause boundary instead of over-rejecting prose.
  it('allows an article-headed compound modifier in an inert clause', () => {
    expect(() => assertNoInventedPlayerVisibleAction(
      'You see the as-yet-unnamed courier.', player, false,
    )).not.toThrow();
  });

  it.each([
    // "you" is the OBJECT of the subordinate clause, not its actor.
    'Your grip weakens because the Senate abandoned you.',
    'Your grip weakens as the Senate turns against you.',
    // Bare possessive conditions - the world pressing on the player.
    'Your health fails.',
    'Your influence collapses further.',
    'Your standing declines.',
    'Your reputation suffers.',
    'Your alliance shatters.',
    'Your grip on the senate weakens.',
    // Subordinators used as ordinary nouns, idioms, or third-party clauses.
    'The while passed quietly in the forum.',
    'Your standing endures as such.',
    'Your grip weakens as the winter drags on.',
    'Your influence wanes while the legions grumble.',
    'The Emperor\'s grip weakens as the winter drags on.',
    // Widened subordinators must stay transparent to third-party clauses.
    'Your grip weakens after the harvest fails.',
    'Your influence wanes since the legions grumble.',
  ])('allows a possessive condition whose every clause is inert: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });
});

/**
 * A clause can name the player TWICE in different grammatical roles: once as a
 * possessive determiner and once as an explicit subject. Classifying only the
 * possessive - the first determiner ANYWHERE in the clause, including one in
 * OBJECT position - and returning as soon as it proves inert leaves the
 * explicit subject unexamined. That is fail-OPEN in both directions:
 *
 *  - an object-position possessive absorbs the classifier ("you burned YOUR
 *    granary": "granary" is a bare noun, so the clause reads inert and the
 *    subject "you burned ..." is never reached), and
 *  - a trailing possessive CONDITION launders a real head action ("You seize
 *    the treasury though your standing declines").
 *
 * Both roles must be classified and either one may fail the clause.
 */
describe('no-attempt possessive/subject clause precedence boundary', () => {
  const player: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    position: 'Emperor',
  };

  const SUBORDINATORS = [
    'as', 'while', 'when', 'because', 'though', 'although',
    'since', 'after', 'before', 'if', 'unless', 'whereas', 'once', 'until',
  ];

  function expectRejected(prose: unknown): void {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false))
      .toThrow('player action boundary');
  }

  // HOLE-A: the subordinate clause's OBJECT carries the possessive determiner,
  // so the determiner match binds "your <noun>" - an inert bare noun - and the
  // clause's real second-person subject is never examined.
  it.each([
    'Your grip weakens because you burned your granary.',
    'Your grip weakens because you seized your treasury.',
    'Your grip weakens because you poisoned your wine.',
    'Your grip weakens because you murdered your rival.',
    'Your grip weakens because you sacked your city.',
    'Your grip weakens because your legions sacked your city.',
    'Your health fails because you poisoned your wine.',
    'Your influence collapses when you sack your city.',
    'Your standing falters though you seize your treasury.',
  ])('rejects an object-position possessive absorbing the clause subject: %s', expectRejected);

  it.each(SUBORDINATORS)(
    'rejects an object-position possessive through the widened subordinator %s',
    subordinator => {
      expectRejected(`Your grip weakens ${subordinator} you burned your granary.`);
    },
  );

  // The same shape under a THIRD-person possessor, where the tail's subject is
  // anaphoric to the player and the object determiner is third-person too.
  it.each([
    "Gaius Testus's grip weakens because he burned her granary.",
    "Gaius Testus's grip weakens because he burned his granary.",
    "Gaius Testus's grip weakens because he sacked their city.",
    "The Emperor's grip weakens because he seized his treasury.",
    "The Emperor's grip weakens because his legions sacked their city.",
    "The player's grip weakens because she poisoned his wine.",
    "The avatar's grip weakens because they murdered their rival.",
  ])('rejects an anaphoric clause whose object carries the possessive: %s', expectRejected);

  // HOLE-B: the head clause is an explicit player action; the TRAILING clause
  // is a possessive condition. The possessive match reaches into that tail,
  // proves it inert, and launders the head.
  const CONDITION_TAILS: Array<[string, string, string]> = [
    ['You seize the treasury', 'standing', 'declines'],
    ['You burn the granary', 'health', 'fails'],
    ['You murder the consul', 'alliance', 'shatters'],
    ['You sack the city', 'reputation', 'suffers'],
    ['You poison the wine', 'scheme', 'collapses'],
  ];

  it.each(
    SUBORDINATORS.flatMap(subordinator => CONDITION_TAILS.map(
      ([action, noun, verb]) => `${action} ${subordinator} your ${noun} ${verb}.`,
    )),
  )('rejects a head action laundered by a trailing possessive condition: %s', expectRejected);

  it('rejects the third-person form of a trailing-condition laundered action', () => {
    expectRejected("Gaius Testus's guards seize the treasury though his standing declines.");
  });

  // The precedence bug also exists with no subordinate clause at all: a bare
  // top-level sentence whose object carries the possessive determiner.
  it.each([
    'You burned your granary.',
    'You seized your treasury.',
    'You poisoned your wine.',
    'You murdered your rival.',
    'I burned your granary.',
    'Gaius Testus burned his granary.',
    'The Emperor seized his treasury.',
  ])('rejects a bare player action whose object carries a possessive: %s', expectRejected);

  // The same short-circuit at top level: a quoted player action followed by a
  // possessive condition. The condition is matched first and reads inert.
  it.each([
    'The herald cried "you burned the granary" as your grip weakens.',
    'The herald cried "you burned your granary" as your grip weakens.',
  ])('rejects a quoted player action trailed by a possessive condition: %s', expectRejected);

  // Every player-visible payload shape reaches the same classifier.
  it.each([
    ['narration string', 'Your grip weakens because you burned your granary.'],
    ['mid-paragraph narration', 'The Curia stirred. Your grip weakens because you seized your treasury. The session closed.'],
    ['major_ongoing_crisis', { major_ongoing_crisis: 'Your grip weakens because you burned your granary.' }],
    ['headlines[]', { headlines: ['The week advances.', 'Your grip weakens because you poisoned your wine.'] }],
    ['entityActions[].notes', {
      entityActions: [{
        id: 'npc_a', intent: 'observe', target: 'npc_b',
        notes: 'Your grip weakens because you murdered your rival.',
      }],
    }],
    ['deltas[].reason', {
      deltas: [{
        type: 'resource', key: 'npc_a:denarii', delta: -5,
        reason: 'Your grip weakens because you sacked your city.',
      }],
    }],
    ['headlines[] carrying a trailing-condition laundered action', {
      headlines: ['You seize the treasury though your standing declines.'],
    }],
  ])('rejects an object-position possessive carried by %s', (_label, payload) => {
    expectRejected(payload);
  });

  // Oblique first-person forms can only ever be a passive AGENT, and 'i'
  // covered the subject position alone - so "was burned by me" named the
  // player as agent and passed at every earlier version.
  it.each([
    'The granary was burned by me.',
    'The decree was signed by me.',
    'Your grip weakens because the granary was burned by me.',
  ])('rejects an oblique first-person passive agent: %s', expectRejected);

  // Possessive passive agents are a KNOWN, symmetric gap: the passive scan
  // rejects on a bare alias match with no predicate classification, so
  // admitting 'my' would reject every third party merely related to the player
  // ("sealed by my predecessor") on the monologue surface, whose prompt
  // mandates first-person prose about rivals. The second-person form is not
  // caught either, so a first-person-only rule buys nothing. Closing this
  // needs the possessive passive handled for ALL persons at once.
  it.each([
    'The granary was burned by my agents.',
    'The granary was burned by your agents.',
    'The treaty was sealed by my predecessor.',
  ])('documents the unclosed possessive passive-agent gap: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  it.each([
    'The granary was not burned by me.',
    'The decree was never signed by me.',
    // Oblique forms in ordinary OBJECT position are not agents.
    'The Senate warned me of the vote.',
    'The courier brought me the tablets.',
  ])('still allows a negated or object-position oblique first person: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  // The fix must not turn an inert possessive into a rejection just because a
  // player alias also appears in a non-subject role somewhere in the clause.
  it.each([
    'Your grip weakens because the Senate abandoned you.',
    'Your grip weakens because the mob shouted at you.',
    'Your health fails.',
    'Your standing declines.',
    'Your scheme collapses.',
    'Your reputation suffers.',
    'Your alliance shatters.',
    'Your influence collapses further.',
    'Your grip on the senate weakens.',
    'You see the as-yet-unnamed courier.',
    'Your standing endures as such.',
    'Your grip weakens as the winter drags on.',
  ])('still allows an inert clause naming the player in both roles: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });
});
