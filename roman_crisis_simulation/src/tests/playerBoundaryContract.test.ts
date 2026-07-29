/**
 * TDD RED SUITE - declaration-primary player boundary, Task 2 of the
 * actors-attribution refactor (ai/core/playerBoundary.ts).
 *
 * THE CONTRACT (spec: docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md):
 * every interchange prose field arrives with a declared `actors: string[]`
 * (entity ids whose ACTIONS the text narrates; mention != actor; empty =
 * pure description - see tests/actorsAttribution.test.ts, Task 1). On a
 * no-attempt turn the gate decides per FIELD:
 *
 *   1. DECLARED  - `actors` includes the player (via samePlayerIdentity)
 *                  -> redact that field. Pure data; the prose is never parsed.
 *   2. TRIPWIRE  - `actors` does NOT include the player, but a sentence
 *                  OPENS with a player subject (proseSubjectAliases + you/I)
 *                  whose head verb is not in the curated non-action
 *                  allowlists -> redact (the declaration lied or erred).
 *                  FLAT scan: no subordinator splitting, no possessive
 *                  phrase classification, no anaphora scopes, no
 *                  passive-agent scans - all of that machinery is DELETED.
 *   3. MECHANICS - playerOwnsDelta / assertNoPlayerRemoval / the
 *                  hidden-mechanics half are UNTOUCHED (pinned below).
 *
 * SUCCESSOR SIGNATURES - Task 2 pins these EXACTLY; the implementer builds
 * them, and ai/core/turn.ts / ai/mocks.ts (Task 4) call them:
 *
 *   // NEW pure classifiers
 *   export function actorsIncludePlayer(
 *     actors: readonly string[], player: PlayerIdentity): boolean;
 *   export function tripwireFlagsPlayerConduct(
 *     text: string, player: PlayerIdentity): boolean;
 *
 *   // KEPT SHELLS, made declaration-aware. Churn is ONE optional trailing
 *   // parameter each - every existing 3-/4-arg call keeps compiling and
 *   // means "no declaration available" (tripwire-only).
 *   export function assertNoInventedPlayerVisibleAction(
 *     value: unknown, player: PlayerIdentity, hasObservableAttempt: boolean,
 *     actors?: readonly string[]): void;
 *   export function redactInventedPlayerProseFromValue<T>(
 *     value: T, player: PlayerIdentity, hasObservableAttempt: boolean,
 *     surface: string, actors?: readonly string[]): PlayerProseRedactionResult<T>;
 *
 *   // The adjudication shell keeps its name and arity; its parameter WIDENS
 *   // to accept the attributed interchange shape (actorsBoundary.ts's
 *   // AdjudicationInterchange: {text, actors} headline items, `actors`
 *   // siblings on deltas/entityActions), because Task 4 defers the actors
 *   // strip to the commit boundary so the gate sees declarations. Bare
 *   // committed Adjudications stay accepted (tripwire-only).
 *   export function redactInventedPlayerProse(
 *     adjudication: AdjudicationInterchange | Adjudication,
 *     player: PlayerIdentity, hasObservableAttempt: boolean): PlayerProseRedaction[];
 *
 * REDACTION POLICY (pinned by the shell tests below):
 *   - Declared-player field -> the WHOLE field is redacted. The declaration
 *     is field-granular; there is no per-sentence signal to be finer with.
 *     Value shell returns '' for the field; the adjudication shell applies
 *     the existing surface policy (emptied headline DROPPED, reason/notes ->
 *     the existing 'Something shifts, unremarked.' placeholder).
 *   - Tripwire hit -> sentence-level, reusing the existing plumbing: flagged
 *     sentences removed, clean sentences survive, `original` records the
 *     full pre-redaction field text, notes render via
 *     playerProseRedactionNotes with the '[Boundary]' tag - all unchanged.
 *   - The value shell's `actors` declares the actors for THE ONE PROSE FIELD
 *     passed as `value`: callers pass the field's text (narration payload
 *     text, monologue text, simulationState.major_ongoing_crisis), never a
 *     whole structured object, when declaring. Structured values without a
 *     declaration keep the legacy traversal, rewired to the tripwire.
 *
 * IMPLEMENTER NOTES:
 *   - MODAL: the existing MODAL_NON_ACTION_PREDICATE only clears modal +
 *     perception/cognition/be. The contract pins 'You could seize the
 *     granary.' as tripwire-SILENT (a hypothetical/suggestion, not an
 *     accomplished act), so the tripwire's modal handling must widen to
 *     clear at least can/could/may/might/must/should + any verb. will/would
 *     ("You'll dispatch spies") is deliberately UNPINNED here - decide it
 *     during implementation and record the choice.
 *   - Owner-REJECTED design: a bare /^You \\w+/ tripwire. Legal no-attempt
 *     narration lives in that register ('You wait', 'You receive a letter');
 *     the curated allowlists are what make the tripwire viable.
 *
 * RED SIGNALS: missing exports fail the guarded toBeDefined lookups (the
 * actorsAttribution.test.ts pattern); behavioral tests against existing
 * exports fail on assertions. Tests explicitly marked [REGRESSION PIN] are
 * GREEN BY DESIGN - they duplicate behavior the rewrite must not break
 * (mechanics, B7-gap survival, observable-attempt inertness) and only have
 * teeth if they pass before AND after.
 */
import { describe, expect, it } from 'vitest';
import * as boundary from '../ai/core/playerBoundary';
import {
  assertNoInventedPlayerVisibleAction,
  assertNoPlayerRemoval,
  containsInventedPlayerProse,
  playerOwnsDelta,
  playerProseRedactionNotes,
  samePlayerIdentity,
} from '../ai/core/playerBoundary';
import type {
  PlayerIdentity,
  PlayerProseRedaction,
  PlayerProseRedactionResult,
} from '../ai/core/playerBoundary';
import type { EventDelta } from '../types';

// --- Successor shapes (structural views used until the implementation lands) --

type ActorsIncludePlayer = (actors: readonly string[], player: PlayerIdentity) => boolean;
type TripwireFlagsPlayerConduct = (text: string, player: PlayerIdentity) => boolean;
type DeclarationAwareValueRedactor = <T>(
  value: T,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
  surface: string,
  actors?: readonly string[],
) => PlayerProseRedactionResult<T>;
type DeclarationAwareAssert = (
  value: unknown,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
  actors?: readonly string[],
) => void;

/**
 * Local structural view of the attributed interchange adjudication. The real
 * signature should be typed with actorsBoundary.ts's AdjudicationInterchange;
 * a structural mirror here keeps this suite decoupled from zod inference
 * details while pinning exactly the fields the shell must consume.
 */
interface AttributedHeadline {
  text: string;
  actors: string[];
}
interface AttributedAdjudication {
  turn: number;
  entityActions: Array<{ id: string; intent: string; target: string; notes: string; actors: string[] }>;
  deltas: Array<{ type: string; key: string; delta: number; reason: string; actors: string[] }>;
  headlines: AttributedHeadline[];
  gm_private: string[];
}
type AttributedAdjudicationRedactor = (
  adjudication: AttributedAdjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
) => PlayerProseRedaction[];

/**
 * Guarded export lookup, the actorsAttribution.test.ts pattern: a missing
 * export fails the toBeDefined assertion - this suite's red signal - rather
 * than an import error; behavioral assertions bite once it exists.
 */
function boundaryExport<T>(name: string): T {
  const value = (boundary as unknown as Record<string, unknown>)[name];
  expect(value, `ai/core/playerBoundary.ts must export ${name} (declaration-gate contract)`).toBeDefined();
  return value as T;
}

// --- Fixtures ---------------------------------------------------------------

const player: PlayerIdentity = {
  entity_id: 'player_1',
  name: 'Gaius Testus',
  position: 'Emperor',
};

// 'Senator' is in SHARED_TITLE_POSITIONS - a class of officeholders.
const senatorPlayer: PlayerIdentity = {
  entity_id: 'player_1',
  name: 'Gaius Testus',
  position: 'Senator',
};

// The two B7 gap sentences - the star cases of the refactor. Under the old
// grammar both were DOCUMENTED accepted gaps (DECLARED GAP 1 and the
// possessive passive-agent gap in tests/playerBoundary.test.ts). Under the
// contract they are closed BY DECLARATION: a truthful player declaration
// redacts them; a rival declaration passes them. The flat tripwire stays
// silent on both by design (no clause decomposition, no passive scan).
const B7_GAP_ANAPHORA = 'Your grip weakens because he burned the granary.';
const B7_GAP_PASSIVE = 'The granary was burned by your agents.';

const RIVAL_ID = 'gaius_pontius';

// The existing placeholder + tag, pinned so the rewrite preserves them.
const REDACTION_PLACEHOLDER = 'Something shifts, unremarked.';

function attributedAdjudication(): AttributedAdjudication {
  return {
    turn: 7,
    entityActions: [
      {
        id: 'npc_aulus', intent: 'observe', target: 'npc_pontius',
        notes: 'Aulus watches the Palatine gates through the night.', actors: ['npc_aulus'],
      },
      {
        // Declared-player notes on an NPC-id action: prose violation only -
        // the action's id slot stays npc-owned, so the structural gate is
        // not implicated and the field is REDACTED, not thrown on.
        id: 'npc_pontius', intent: 'intrigue', target: 'player_1',
        notes: 'The Emperor dissolves the Senate by decree.', actors: ['player_1'],
      },
    ],
    deltas: [
      {
        // Undeclared (actors: []) but the second sentence is tripwire
        // register - the lie audit fires and only that sentence goes.
        type: 'resource', key: 'npc_aulus:denarii', delta: -5,
        reason: 'Bribes drain the war chest. You seize the treasury.', actors: [],
      },
      {
        type: 'status', key: 'npc_pontius', delta: 0,
        reason: 'Pontius keeps to his estate.', actors: ['npc_pontius'],
      },
      {
        // Declared-player with INERT prose: the data check alone redacts.
        type: 'relation', key: 'npc_aulus:npc_pontius:trust_level', delta: 1,
        reason: 'Old debts are remembered in the Subura.', actors: ['player_1'],
      },
    ],
    headlines: [
      { text: 'Gaius Testus marches on Rome.', actors: ['player_1'] },
      { text: 'Grain runs short in the city markets.', actors: [] },
    ],
    gm_private: [],
  };
}

/**
 * Calls the adjudication shell on the ATTRIBUTED interchange shape. The
 * current implementation only understands the bare committed shape and
 * throws a TypeError on {text, actors} headline items; converting that
 * throw into a null return lets the capability be asserted as a guarded
 * expectation (the red signal) instead of an unhandled error.
 */
function redactAttributedAdjudication(
  adjudication: AttributedAdjudication,
  hasObservableAttempt: boolean,
): PlayerProseRedaction[] | null {
  const redact = boundaryExport<AttributedAdjudicationRedactor>('redactInventedPlayerProse');
  try {
    return redact(adjudication, player, hasObservableAttempt);
  } catch {
    return null;
  }
}

// --- 1. actorsIncludePlayer: the declared check is pure data ----------------

describe('actorsIncludePlayer - declared check, pure data', () => {
  it('matches the player entity id, including slot-normalized forms', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['player_1'], player)).toBe(true);
    expect(actorsIncludePlayer(['PLAYER-1'], player)).toBe(true);
  });

  it('matches the player display name case-insensitively', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['Gaius Testus'], player)).toBe(true);
    expect(actorsIncludePlayer(['GAIUS TESTUS'], player)).toBe(true);
  });

  it('matches the player position, with or without a leading article', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['Emperor'], player)).toBe(true);
    expect(actorsIncludePlayer(['the emperor'], player)).toBe(true);
  });

  it("matches the generic 'you'/'player'/'avatar' slot aliases", () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['you'], player)).toBe(true);
    expect(actorsIncludePlayer(['player'], player)).toBe(true);
    expect(actorsIncludePlayer(['avatar'], player)).toBe(true);
  });

  it('matches when ANY member of a mixed declaration is the player', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['npc_aulus', 'player_1'], player)).toBe(true);
  });

  it('returns false for rivals and for an empty declaration', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer([RIVAL_ID], player)).toBe(false);
    expect(actorsIncludePlayer(['npc_aulus', 'npc_crassus'], player)).toBe(false);
    expect(actorsIncludePlayer([], player)).toBe(false);
  });

  // An actors[] entry is an IDENTITY SLOT: it names exactly one entity, so
  // even a SHARED title written there denotes the player and fails closed -
  // mirror samePlayerIdentity, NOT proseSubjectAliases (which excludes
  // shared titles because prose can style third parties with them).
  it('treats a shared-title actors entry as the player - identity slots mirror samePlayerIdentity', () => {
    const actorsIncludePlayer = boundaryExport<ActorsIncludePlayer>('actorsIncludePlayer');
    expect(actorsIncludePlayer(['the senator'], senatorPlayer)).toBe(true);
    expect(actorsIncludePlayer(['Senator'], senatorPlayer)).toBe(true);
    expect(actorsIncludePlayer([RIVAL_ID], senatorPlayer)).toBe(false);
  });
});

// --- 2. tripwireFlagsPlayerConduct: TRUE on the dominant lie register -------

describe('tripwireFlagsPlayerConduct - flags sentence-initial player conduct', () => {
  it.each([
    'You seize the treasury.',
    'You burn the granary tonight.',
    'I march on Rome.',
    // Player-name-initial conduct.
    'Gaius Testus signs the decree.',
    // The player's UNIQUE title is a prose-subject alias (not shared).
    'The Emperor votes with the optimates.',
    // Mid-text sentences: the scan runs per sentence after . ! ? and newlines.
    'The Senate convenes. You seize the treasury.',
    'A hush falls over the Curia! You burn the granary.',
    'Will no one act? I march on Rome.',
    'The week turns.\nYou dissolve the Senate.',
    // Ported from the retired precedence suite: a possessive in OBJECT
    // position must not distract from the sentence-initial subject.
    'You burned your granary.',
    'Gaius Testus burned his granary.',
    // MODAL ruling (Task 2 IMPLEMENTER NOTES): will/would are NOT widened -
    // a bare future verb still authors player conduct.
    'You will dispatch spies tonight.',
    // PRESENTATION WRAPPERS are transparent to the anchor match, exactly as
    // the hidden-mechanics half already treats them transparent (review
    // finding, fd51774): a provider that wraps invented conduct in a
    // blockquote, a list bullet, Markdown emphasis, or a quote must not
    // bypass the gate by formatting alone.
    '"You seize the treasury."',
    '“You seize the treasury.”',
    '**You seize the treasury.**',
    '- You seize the treasury.',
    '> You seize the treasury.',
    '(You seize the treasury.)',
    // Regression pin: this fired even before the wrapper strip, but only by
    // accident of the '.' split (the leading "1." itself splits the
    // sentence, leaving a clean "You seize the treasury" span) - it must
    // keep firing by DESIGN now that the wrapper strip runs unconditionally.
    '1. You seize the treasury.',
  ])('fires on: %s', prose => {
    const tripwire = boundaryExport<TripwireFlagsPlayerConduct>('tripwireFlagsPlayerConduct');
    expect(tripwire(prose, player)).toBe(true);
  });
});

// --- 3. tripwireFlagsPlayerConduct: FALSE on the legal no-attempt register --

describe('tripwireFlagsPlayerConduct - the legal no-attempt register stays silent', () => {
  it.each([
    // Receptive / waiting - the register a no-attempt turn is written in.
    'You wait.',
    // The presentation-wrapper strip must not OVER-trigger: a legal
    // no-attempt sentence wrapped in a list bullet stays exactly as silent
    // as its unwrapped form.
    '- You wait.',
    'You receive a letter.',
    // Perception and cognition.
    'You learn of the mutiny.',
    // Continuous state.
    'You are gaining favor.',
    // Explicitly empty act.
    'You do nothing this week.',
    // Feeling.
    "You feel the Senate's eyes upon you.",
    // Negations, plus the contraction normalization that survives the rewrite.
    'You do not sign.',
    "You don't sign the decree.",
    // Modal non-action: an unaccomplished hypothetical, the suggestion
    // register ("you could...") - see the MODAL entry under IMPLEMENTER
    // NOTES in the header; the modal allowlist widens to clear it.
    'You could seize the granary.',
    // MODAL ruling (Task 2 IMPLEMENTER NOTES): can/could/may/might/must/
    // should widen to clear ANY verb - a hypothetical/suggestion, not an
    // accomplished act.
    'You should tread carefully.',
    // Auxiliary stripping + inchoative state.
    'You have grown poorer.',
    // Copular + adjectival state.
    'You are unable to attend.',
    // The kept contemplative idiom.
    'I must tread carefully among the wolves of the Senate.',
    // Third-person rival prose: not the player's subject aliases.
    'Gaius Pontius burns the granary.',
    // Oblique first person in OBJECT position is not a subject.
    'The Senate warned me of the vote.',
  ])('stays silent on: %s', prose => {
    const tripwire = boundaryExport<TripwireFlagsPlayerConduct>('tripwireFlagsPlayerConduct');
    expect(tripwire(prose, player)).toBe(false);
  });

  // FLAT-SCAN BOUNDS. Each of these narrates (or can narrate) player conduct,
  // but NOT through a sentence-initial player subject - and the machinery
  // that used to chase them (possessive phrase classification, subordinate
  // clauses, passive-agent scanning, mid-sentence subject scans) is DELETED.
  // They are DECLARATION territory now: a truthful `actors` declaration
  // redacts them, a lying rival declaration is the accepted residual risk
  // (worst case one contradictory sentence on screen - an immersion blemish,
  // never state corruption; see the spec's risk acceptance).
  it.each([
    // B7 gap 1: possessive determiner subject + anaphoric subordinate clause.
    B7_GAP_ANAPHORA,
    // B7 gap 2: possessive passive agent.
    B7_GAP_PASSIVE,
    // Possessive player agent - the old possessedPhrasePredicate register.
    'Your guards arrest the envoy.',
    // Mid-sentence subject after an adverbial opener.
    'At dawn you sign the decree.',
  ])('stays silent on declaration-territory prose: %s', prose => {
    const tripwire = boundaryExport<TripwireFlagsPlayerConduct>('tripwireFlagsPlayerConduct');
    expect(tripwire(prose, player)).toBe(false);
  });

  // Shared titles are excluded from prose subjecthood (proseSubjectAliases):
  // 'The Senator ...' can style ANY officeholder, so it must not read as a
  // Senator player acting - ported from the title-collision suite.
  it('never treats a shared title as a prose subject', () => {
    const tripwire = boundaryExport<TripwireFlagsPlayerConduct>('tripwireFlagsPlayerConduct');
    expect(tripwire('The Senator Gaius Pontius withdraws to his estate.', senatorPlayer)).toBe(false);
    expect(tripwire('The Senator rises to speak.', senatorPlayer)).toBe(false);
    // The same player acting by NAME still fires.
    expect(tripwire('Gaius Testus withdraws to his estate.', senatorPlayer)).toBe(true);
  });
});

// --- 4. Declaration-aware value shell ---------------------------------------

describe('redactInventedPlayerProseFromValue - declaration-aware successor (optional trailing actors)', () => {
  it('redacts the whole field when the declaration names the player - pure data, no grammar', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const original = 'The court rises at dawn and the week turns quietly.';
    const result = redact(original, player, false, 'narration', ['player_1']);
    expect(result.value).toBe('');
    expect(result.redactions).toEqual([{ surface: 'narration', original }]);
  });

  it('redacts on a display-name declaration - aliasing via samePlayerIdentity', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const original = 'The council rises at dawn.';
    const result = redact(original, player, false, 'monologue', ['Gaius Testus']);
    expect(result.value).toBe('');
    expect(result.redactions).toEqual([{ surface: 'monologue', original }]);
  });

  it('is pure data: a declared-player field is redacted even when its prose is allowlisted', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const original = 'You wait for word from the north.';
    const result = redact(original, player, false, 'narration', ['player_1']);
    expect(result.value).toBe('');
    expect(result.redactions).toEqual([{ surface: 'narration', original }]);
  });

  // [REGRESSION PIN - green today and after]: the old grammar also passed
  // this sentence (DECLARED GAP 1); the contract keeps it legal when a RIVAL
  // is declared, and closes it when the player is (tested above).
  it('[REGRESSION PIN] leaves a rival-declared B7 gap-1 field untouched', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const result = redact(B7_GAP_ANAPHORA, player, false, 'narration', [RIVAL_ID]);
    expect(result.value).toBe(B7_GAP_ANAPHORA);
    expect(result.redactions).toHaveLength(0);
  });

  it('[REGRESSION PIN] leaves a rival-declared B7 gap-2 field untouched', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const result = redact(B7_GAP_PASSIVE, player, false, 'narration', [RIVAL_ID]);
    expect(result.value).toBe(B7_GAP_PASSIVE);
    expect(result.redactions).toHaveLength(0);
  });

  // RESIDUAL-RISK ACCEPTANCE (owner-approved): possessive-agent conduct in a
  // rival-declared field is a register the flat tripwire cannot see. The old
  // grammar caught this sentence; the contract trades that catch for the
  // declaration's coverage of BOTH B7 gaps and the deletion of ~1,000 lines
  // of clause grammar. Worst case: one contradictory sentence on screen.
  it('leaves rival-declared possessive-conduct prose untouched - declaration decides now', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const prose = 'Your guards arrest the envoy.';
    const result = redact(prose, player, false, 'narration', [RIVAL_ID]);
    expect(result.value).toBe(prose);
    expect(result.redactions).toHaveLength(0);
  });

  it('leaves an undeclared mid-sentence-subject field untouched - beyond the flat tripwire', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const prose = 'At dawn you sign the decree.';
    const result = redact(prose, player, false, 'narration', []);
    expect(result.value).toBe(prose);
    expect(result.redactions).toHaveLength(0);
  });

  it('[REGRESSION PIN] removes only the flagged sentence on an undeclared tripwire hit', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const text = 'The Senate convenes at dawn. You seize the treasury. The markets stay calm.';
    const result = redact(text, player, false, 'narration', []);
    expect(result.value).toBe('The Senate convenes at dawn. The markets stay calm.');
    expect(result.redactions).toEqual([{ surface: 'narration', original: text }]);
  });

  it('[REGRESSION PIN] redacts a rival-declared field whose text flagrantly narrates the player - the tripwire audits lies', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const lie = 'You seize the treasury.';
    const result = redact(lie, player, false, 'narration', [RIVAL_ID]);
    expect(result.value).toBe('');
    expect(result.redactions).toEqual([{ surface: 'narration', original: lie }]);
  });

  it('[REGRESSION PIN] touches nothing on an observable-attempt turn, declaration or not', () => {
    const redact = boundaryExport<DeclarationAwareValueRedactor>('redactInventedPlayerProseFromValue');
    const prose = 'You seize the treasury.';
    const result = redact(prose, player, true, 'narration', ['player_1']);
    expect(result.value).toBe(prose);
    expect(result.redactions).toHaveLength(0);
  });
});

// --- 5. Declaration-aware adjudication shell --------------------------------

describe('redactInventedPlayerProse - accepts the attributed interchange adjudication (pre-strip)', () => {
  it('redacts declared-player and tripwire-flagged fields in place with the existing surface policy', () => {
    const adjudication = attributedAdjudication();
    const redactions = redactAttributedAdjudication(adjudication, false);
    expect(
      redactions,
      'redactInventedPlayerProse must accept the ATTRIBUTED interchange adjudication '
      + '({text, actors} headlines, actors siblings on deltas/entityActions) without throwing',
    ).not.toBeNull();
    if (!redactions) return;

    // Declared-player headline DROPPED; the world headline survives.
    expect(adjudication.headlines.map(headline => headline.text))
      .toEqual(['Grain runs short in the city markets.']);
    // Rival-declared notes untouched; declared-player notes -> placeholder.
    expect(adjudication.entityActions[0].notes).toBe('Aulus watches the Palatine gates through the night.');
    expect(adjudication.entityActions[1].notes).toBe(REDACTION_PLACEHOLDER);
    // Tripwire hit keeps the clean sentence; rival-declared reason untouched;
    // declared-player INERT reason -> placeholder (pure data).
    expect(adjudication.deltas[0].reason).toBe('Bribes drain the war chest.');
    expect(adjudication.deltas[1].reason).toBe('Pontius keeps to his estate.');
    expect(adjudication.deltas[2].reason).toBe(REDACTION_PLACEHOLDER);

    expect(redactions).toHaveLength(4);
    expect(redactions.map(redaction => redaction.surface).sort()).toEqual([
      'deltas[0].reason',
      'deltas[2].reason',
      'entityActions[1].notes',
      'headlines[0]',
    ]);
    expect(redactions.find(redaction => redaction.surface === 'headlines[0]')?.original)
      .toBe('Gaius Testus marches on Rome.');

    // The player-facing redaction-note behavior is preserved verbatim.
    const notes = playerProseRedactionNotes(redactions);
    expect(notes).toHaveLength(4);
    expect(notes.every(note => note.startsWith('[Boundary]'))).toBe(true);
    expect(notes.some(note => note.includes('"Gaius Testus marches on Rome."'))).toBe(true);
  });

  it('[REGRESSION PIN] touches nothing on an observable-attempt turn', () => {
    const adjudication = attributedAdjudication();
    const before = JSON.parse(JSON.stringify(adjudication));
    const redactions = redactAttributedAdjudication(adjudication, true);
    expect(redactions).toEqual([]);
    expect(adjudication).toEqual(before);
  });
});

// --- 6. Declaration-aware fail-closed validator -----------------------------

describe('assertNoInventedPlayerVisibleAction - declaration-aware successor (optional trailing actors)', () => {
  it('throws on a no-attempt declared-player field even when the prose is inert', () => {
    const assertVisible = boundaryExport<DeclarationAwareAssert>('assertNoInventedPlayerVisibleAction');
    expect(() => assertVisible('The court rises at dawn.', player, false, ['player_1']))
      .toThrow('player action boundary');
  });

  it('[REGRESSION PIN] stays silent for a rival-declared B7 gap field', () => {
    const assertVisible = boundaryExport<DeclarationAwareAssert>('assertNoInventedPlayerVisibleAction');
    expect(() => assertVisible(B7_GAP_ANAPHORA, player, false, [RIVAL_ID])).not.toThrow();
    expect(() => assertVisible(B7_GAP_PASSIVE, player, false, [RIVAL_ID])).not.toThrow();
  });

  it('[REGRESSION PIN] stays silent on an observable-attempt turn regardless of declaration', () => {
    const assertVisible = boundaryExport<DeclarationAwareAssert>('assertNoInventedPlayerVisibleAction');
    expect(() => assertVisible('You seize the treasury.', player, true, ['player_1'])).not.toThrow();
  });

  it('[REGRESSION PIN] still throws on the undeclared tripwire register', () => {
    expect(() => assertNoInventedPlayerVisibleAction('You seize the treasury.', player, false))
      .toThrow('player action boundary');
  });

  it('[REGRESSION PIN] still throws on a no-attempt player removal - the structural check survives the rewrite', () => {
    expect(() => assertNoInventedPlayerVisibleAction({ remove_entities: ['GAIUS TESTUS'] }, player, false))
      .toThrow('player action boundary');
  });
});

// --- 7. Retired clause grammar: the flat gate no longer parses these --------

describe('retired clause grammar - registers the flat gate deliberately no longer catches', () => {
  // Every sentence below THROWS under the current grammar and must NOT under
  // the rewrite: the machinery that caught it is deleted, and the register is
  // owned by the declaration. Each row names its deleted mechanism.
  it.each([
    // splitSubordinateClauses + subordinate-clause classification.
    'Your grip weakens because you burned the granary.',
    // possessedPhrasePredicate / possessedHeadPredicate.
    'Your guards arrest the envoy.',
    // and/but subject inheritance in containsPlayerAttributedAction.
    'You see the courier and dispatch guards.',
    'You do not sign but dispatch spies.',
    // passive-agent scanning (passiveAgentPattern + oblique 'me').
    'The granary was burned by me.',
    'The decree is signed by you.',
    // Mid-sentence subject scan (earliestPlayerSubject over the whole clause).
    'At dawn you sign the decree.',
    // 'that'-clause part split.
    'A messenger reports that you sign the decree.',
  ])('no longer throws on: %s', prose => {
    expect(() => assertNoInventedPlayerVisibleAction(prose, player, false)).not.toThrow();
  });

  it('containsInventedPlayerProse narrows to the tripwire - possessive conduct no longer flagged', () => {
    expect(containsInventedPlayerProse('Your guards arrest the envoy.', player)).toBe(false);
  });

  it('[REGRESSION PIN] containsInventedPlayerProse still flags the tripwire register', () => {
    expect(containsInventedPlayerProse('You seize the treasury.', player)).toBe(true);
  });
});

// --- 8. Mechanics regression pins [GREEN BY DESIGN] -------------------------

describe('mechanics regression pins [GREEN BY DESIGN - must stay green through the rewrite]', () => {
  it('playerOwnsDelta: rumor ownership follows origin, not subject key', () => {
    const npcRumorAboutPlayer = {
      type: 'rumor', key: 'PLAYER-1', delta: 0.6,
      reason: 'Aulus claims the emperor is losing the Senate.',
      is_true: false, origin_id: 'npc_aulus', topic: 'senate-support',
    } as EventDelta;
    expect(playerOwnsDelta(npcRumorAboutPlayer, player)).toBe(false);
    expect(playerOwnsDelta({ ...npcRumorAboutPlayer, origin_id: 'PLAYER-1' } as EventDelta, player)).toBe(true);
  });

  it('playerOwnsDelta: world-driven dependency_level keyed under the player follows origin (DEBT HAS TEETH)', () => {
    const worldDependency = {
      type: 'relation', key: 'player_1:npc_crassus:dependency_level', delta: 2,
      reason: 'Mounting arrears leave the palace beholden to Crassus.', origin_id: 'npc_crassus',
    } as EventDelta;
    expect(playerOwnsDelta(worldDependency, player)).toBe(false);
    expect(playerOwnsDelta({ ...worldDependency, origin_id: 'player_1' } as EventDelta, player)).toBe(true);
  });

  it('playerOwnsDelta: every other delta type stays owned by its key root', () => {
    const playerTrust = {
      type: 'relation', key: 'player_1:npc_crassus:trust_level', delta: 2, reason: 'A new opinion forms.',
    } as EventDelta;
    const npcResource = {
      type: 'resource', key: 'npc_aulus:denarii', delta: -5, reason: 'Bribes drain the war chest.',
    } as EventDelta;
    expect(playerOwnsDelta(playerTrust, player)).toBe(true);
    expect(playerOwnsDelta(npcResource, player)).toBe(false);
  });

  it('assertNoPlayerRemoval: rejects a no-attempt player removal by any alias, at any depth', () => {
    expect(() => assertNoPlayerRemoval({ remove_entities: ['GAIUS TESTUS'] }, player, false))
      .toThrow('player action boundary');
    expect(() => assertNoPlayerRemoval({ nested: [{ remove_entities: ['the emperor'] }] }, player, false))
      .toThrow('player action boundary');
  });

  it('assertNoPlayerRemoval: allows rival removals and observable-attempt turns', () => {
    expect(() => assertNoPlayerRemoval({ remove_entities: ['npc_aulus'] }, player, false)).not.toThrow();
    expect(() => assertNoPlayerRemoval({ remove_entities: ['player_1'] }, player, true)).not.toThrow();
  });

  it('samePlayerIdentity: identity slots keep matching shared titles and normalized ids', () => {
    expect(samePlayerIdentity('the senator', senatorPlayer)).toBe(true);
    expect(samePlayerIdentity('PLAYER-1', player)).toBe(true);
    expect(samePlayerIdentity(RIVAL_ID, player)).toBe(false);
  });

  it('playerProseRedactionNotes: the GM-console note format is preserved verbatim', () => {
    const notes = playerProseRedactionNotes([
      { surface: 'headlines[1]', original: 'You seize the treasury.' },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].startsWith('[Boundary]')).toBe(true);
    expect(notes[0]).toContain('headlines[1]');
    expect(notes[0]).toContain('"You seize the treasury."');
  });
});
