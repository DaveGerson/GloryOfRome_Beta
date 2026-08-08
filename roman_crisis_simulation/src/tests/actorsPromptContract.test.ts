/**
 * TDD RED SUITE - actors-attribution contract, Task 3 (prompt TEACHING only).
 *
 * Tasks 1/2 (commits 8093f13/d309d9f) made every prose-bearing provider
 * interchange schema require `actors: string[]` - entity ids whose ACTIONS
 * the sibling text narrates (schemas.ts's ACTORS_DESCRIPTION, ~line 15).
 * A schema field description alone is weak teaching: the PROMPTS that feed
 * those calls must state the same contract in their instruction text. This
 * suite pins that teaching. It intentionally FAILS today - no prompt
 * carries the contract yet - and it asserts on the REAL prompt builders
 * with minimal fixtures (no snapshots, no model calls).
 *
 * THE CONTRACT each prose-feeding prompt must state:
 *   A. attribution semantic - actors = the entity ids whose ACTIONS the
 *      text narrates;
 *   B. mention != actor     - merely MENTIONING an entity (object, victim,
 *      bystander) does not make it an actor;
 *   C. empty = description  - an empty array means pure world/state
 *      description with no one's actions narrated.
 * Plus the load-bearing no-attempt rule (schema-side counterpart of the
 * code gate built in a parallel task): on a turn with NO observable player
 * attempt, the player's id must NOT appear in any `actors` list, and no
 * prose may narrate player conduct.
 *
 * SURFACE -> WHERE THE INSTRUCTION SHOULD LAND (implementer's map):
 *   adjudication         ai/prompts/adjudication.ts::buildAdjudicationSystemInstruction
 *                        (add an ACTORS ATTRIBUTION principle near the OUTPUT
 *                        line, ~127; extend the NO-ATTEMPT TURNS principle,
 *                        ~line 86, with the actors-list exclusion)
 *   simulation-state     ai/prompts/intelligence.ts::buildSimulationStateUpdatePrompt
 *                        systemInstruction (~280-291) - covers the top-level
 *                        `actors` for major_ongoing_crisis
 *   no-attempt selector  ai/prompts/noAttemptResponse.ts::SYSTEM_INSTRUCTION
 *                        (~4-9) - this surface is no-attempt BY CONSTRUCTION,
 *                        so it must also carry the player-exclusion rule
 *   narration            ai/prompts/narration.ts::buildNarrationPrompt
 *                        systemInstruction (~174-188); no-attempt branch of
 *                        playerTurnInstruction (~167)
 *   player monologue     ai/prompts/narration.ts::buildPlayerMonologuePrompt
 *                        systemInstruction (~228-238)
 * (narration/monologue are not yet wired to structured output - their
 * schemas exist as NarrationPayloadSchema/PlayerMonologuePayloadSchema -
 * but their prompt text can already teach the contract.)
 *
 * ANCHOR SUBSTRINGS (asserted case-insensitively; chosen so the tests
 * survive wording tweaks that keep the semantic tokens, and so the
 * implementer can satisfy them by echoing schemas.ts's ACTORS_DESCRIPTION
 * verbatim - the recommended implementation is to export that constant and
 * interpolate it):
 *   Rule A: 'whose actions' - the semantic core; any faithful statement
 *           names actors as those whose ACTIONS are narrated.
 *           'narrat'        - stem of narrates/narrated/narration, tying
 *           actors to what the text NARRATES, not what it contains.
 *   Rule B: 'merely mention' - the canonical mention!=actor token (stem
 *           covers mentioning/mentioned); 'actor' - the rule must be
 *           phrased in actor terms, not just "mention".
 *   Rule C: 'empty' - the invariant token of the empty-array rule;
 *           'description' - from "pure world/state description" (note:
 *           'describe' does NOT match it, so narration's existing
 *           "Describe the ..." task line cannot false-satisfy it).
 * All six anchors were verified ABSENT from every prompt builder and from
 * the mock fixtures today (grep over ai/prompts/*.ts, tests/mockData.ts),
 * so each rule test is genuinely red.
 *
 * NO-ATTEMPT assertions are LINE-scoped co-occurrence checks (some single
 * prompt line contains 'player' + 'actors' + 'not'/'never'): prompts here
 * are line-structured (one principle per line), and line scoping prevents
 * a 'player' on one line plus an 'actors' on another from false-passing.
 * ('entityActions' does not contain the substring 'actors', so the existing
 * NO-ATTEMPT TURNS principle cannot false-satisfy the check.)
 *
 * WIRING GAPS - CLOSED (commit 8d14c91): buildSimulationStateUpdatePrompt(
 * adjudication, oldState, hasObservableAttempt) and buildPlayerMonologuePrompt(
 * player, headlines, intents, hasObservableAttempt) are now threaded with the
 * flag from ai/core/turn.ts's `narrationSubmission.hasObservableAttempt` at
 * both call sites (getUpdatedSimulationState / getPlayerMonologue in
 * ai/tools/intelligence.ts), so both surfaces state the turn-conditional
 * player-exclusion rule below.
 *
 * Negative controls: builders whose response schemas carry NO actors field
 * (assessment - ActionAssessmentSchema; NPC mind - NpcMindDecisionSchema)
 * must NOT be burdened with the contract text. These pass today and keep
 * the implementer from blanket-pasting the paragraph into every prompt.
 */
import { describe, expect, it } from 'vitest';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildSimulationStateUpdatePrompt } from '../ai/prompts/intelligence';
import { buildNoAttemptEvidenceSelectionPrompt } from '../ai/prompts/noAttemptResponse';
import { buildNarrationPrompt, buildPlayerMonologuePrompt } from '../ai/prompts/narration';
import { buildActionAssessmentPrompt } from '../ai/prompts/assessment';
import { buildNpcMindPrompt, type NpcMindPromptInput } from '../ai/prompts/npcMind';
import { buildAdjudicationPromptInput, makeEntity } from './factories';
import type { NoAttemptEvidence } from '../playerView/noAttemptResponse';
import type { AdjudicationSubmissionProjection } from '../playerInput/turnSubmission';
import type { Adjudication, Entity, SimulationState } from '../types';

// --- Helpers ---------------------------------------------------------------

interface BuiltPrompt {
  systemInstruction: string;
  prompt: string;
}

/** The contract may land in either half; assert over both. */
function fullText(built: BuiltPrompt): string {
  return `${built.systemInstruction}\n${built.prompt}`;
}

/** A token, or a list of acceptable alternatives (any-of). */
type TokenSpec = string | readonly string[];

/**
 * LINE-scoped co-occurrence: true when some single line of the text
 * contains every token spec (case-insensitive). See the header for why
 * line scope (one principle per line; no cross-line false positives).
 */
function hasLineWith(text: string, ...tokens: TokenSpec[]): boolean {
  return text
    .toLowerCase()
    .split(/\r?\n/)
    .some(line =>
      tokens.every(token =>
        Array.isArray(token) ? token.some(alt => line.includes(alt)) : line.includes(token as string),
      ),
    );
}

// --- Fixtures (shapes copied from tests/promptDataBoundary.test.ts) --------

const SIM_STATE: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
};

function buildAdjudication(submission: AdjudicationSubmissionProjection): BuiltPrompt {
  return buildAdjudicationPrompt(buildAdjudicationPromptInput({ submission }));
}

function makePlayer(): Entity {
  return makeEntity({
    position: 'Senator',
    location: 'The Curia',
    current_state_narrative: 'A cautious senator.',
  });
}

/** Committed-shape adjudication (actors are interchange-only and already stripped). */
const ADJUDICATION_FIXTURE: Adjudication = {
  turn: 3,
  entityActions: [],
  deltas: [
    { type: 'resource', key: 'npc_a:denarii', delta: -50, reason: 'Bribes paid to the pay clerks.' },
  ],
  headlines: ['Maximinus Thrax courts the Danube legions.'],
  gm_private: [],
};

const EVIDENCE: NoAttemptEvidence[] = [
  { id: 'ev-1', source: 'self', text: 'The granaries stand empty of guards.' },
];

// --- The three contract rules and their anchors (rationale in header) ------

const CONTRACT_RULES: Array<{ rule: string; anchors: string[] }> = [
  {
    rule: 'the attribution semantic: actors = whose ACTIONS the text narrates',
    anchors: ['whose actions', 'narrat'],
  },
  {
    rule: 'the mention != actor rule: merely mentioning an entity does not make it an actor',
    anchors: ['merely mention', 'actor'],
  },
  {
    rule: 'the empty = description rule: empty array means pure world/state description',
    anchors: ['empty', 'description'],
  },
];

// Every prompt that feeds a schema carrying `actors` (an ordinary attempt
// turn - the contract teaching must be unconditional).
const CONTRACT_SURFACES: Array<{ surface: string; build: () => BuiltPrompt }> = [
  {
    surface: 'adjudication (headlines/delta reasons/entityAction notes)',
    build: () => buildAdjudication({ observableAttempt: 'Hold court', questionOrContext: null }),
  },
  {
    surface: 'simulation-state update (top-level actors over major_ongoing_crisis)',
    build: () => buildSimulationStateUpdatePrompt(ADJUDICATION_FIXTURE, SIM_STATE),
  },
  {
    surface: 'no-attempt evidence selection',
    build: () => buildNoAttemptEvidenceSelectionPrompt('What do the granaries hold?', EVIDENCE),
  },
  {
    surface: 'narration (NarrationPayloadSchema, prompt-taught ahead of wiring)',
    build: () => buildNarrationPrompt(
      'A succession crisis.',
      makePlayer(),
      { context: 'Hold court', hasObservableAttempt: true },
      [{ text: 'The Curia stirred.', source: 'public' }],
    ),
  },
  {
    surface: 'player monologue (PlayerMonologuePayloadSchema, prompt-taught ahead of wiring)',
    build: () => buildPlayerMonologuePrompt(makePlayer(), ['The city was quiet.'], ['Hold court']),
  },
];

describe.each(CONTRACT_SURFACES)('$surface: prompt teaches the actors-attribution contract', ({ surface, build }) => {
  it.each(CONTRACT_RULES)('states $rule', ({ anchors }) => {
    const full = fullText(build()).toLowerCase();
    for (const anchor of anchors) {
      expect(
        full.includes(anchor),
        `${surface}: prompt must carry the anchor "${anchor}" (case-insensitive) - the actors contract is not taught`,
      ).toBe(true);
    }
  });
});

// --- The load-bearing no-attempt rule --------------------------------------
//
// On a turn with NO observable player attempt, the player's id must NOT
// appear in any `actors` list, and no prose may narrate player conduct.
// Asserted on every builder below, including the two once-wiring-gapped
// surfaces (simulation-state update, player monologue) now that
// hasObservableAttempt is threaded into both (commit 8d14c91).

describe('no-attempt turns: the prompt bars the player id from every actors list', () => {
  it('adjudication (observableAttempt null): states the player id never appears in any actors list', () => {
    const full = fullText(buildAdjudication({ observableAttempt: null, questionOrContext: 'What news of the legions?' }));

    // Already taught (pinned so it can never regress): the prose half -
    // "no headline or 'reason' prose may show the player performing an act"
    // (NO-ATTEMPT TURNS principle, ai/prompts/adjudication.ts ~86).
    expect(
      hasLineWith(full, 'prose', 'player', 'perform'),
      'adjudication: the existing no-attempt prose rule (no prose may show the player performing an act) has regressed',
    ).toBe(true);

    // RED: the actors half is missing - no line ties the player to an
    // actors-list exclusion.
    expect(
      hasLineWith(full, 'player', 'actors', ['never', 'not']),
      "adjudication: no line states the player's id must not appear in any 'actors' list on a no-attempt turn",
    ).toBe(true);
  });

  it('narration (hasObservableAttempt false): states the player id never appears in any actors list', () => {
    const full = fullText(buildNarrationPrompt(
      'A succession crisis.',
      makePlayer(),
      { context: 'What news of the legions?', hasObservableAttempt: false },
      [{ text: 'The Curia stirred.', source: 'public' }],
    ));

    // Already taught (pinned): the no-invented-action half of the prose rule
    // ("do not invent an action or immediate consequence", narration.ts ~167).
    expect(
      hasLineWith(full, 'not', 'invent', 'action'),
      'narration: the existing no-attempt line (do not invent an action) has regressed',
    ).toBe(true);

    // RED: the actors half is missing.
    expect(
      hasLineWith(full, 'player', 'actors', ['never', 'not']),
      "narration: no line states the player's id must not appear in any 'actors' list on a no-attempt turn",
    ).toBe(true);
  });

  it('no-attempt evidence selection (no-attempt BY CONSTRUCTION): states the player id never appears in the actors list', () => {
    const full = fullText(buildNoAttemptEvidenceSelectionPrompt('What do the granaries hold?', EVIDENCE));

    // RED: this surface only ever runs on question-only (no-attempt) turns,
    // so the exclusion must be stated unconditionally.
    expect(
      hasLineWith(full, 'player', 'actors', ['never', 'not']),
      "no-attempt selector: no line states the player's id must not appear in the 'actors' list",
    ).toBe(true);
  });

  // WIRING GAPS - CLOSED. `hasObservableAttempt` is now threaded from
  // turn.ts's `narrationSubmission.hasObservableAttempt` through
  // getUpdatedSimulationState/getPlayerMonologue (ai/tools/intelligence.ts)
  // into these two builders (default `true` so every pre-existing call site,
  // including the unconditional CONTRACT_SURFACES ones above, keeps
  // rendering an ordinary-attempt-turn prompt byte-for-byte as before).
  it('simulation-state update (hasObservableAttempt false): states the player id never appears in the actors list', () => {
    const full = fullText(buildSimulationStateUpdatePrompt(ADJUDICATION_FIXTURE, SIM_STATE, false));

    expect(
      hasLineWith(full, 'player', 'actors', ['never', 'not']),
      "simulation-state update: no line states the player's id must not appear in the top-level 'actors' list on a no-attempt turn",
    ).toBe(true);
  });

  it('player monologue (hasObservableAttempt false): states the player id never appears in the actors list', () => {
    const full = fullText(buildPlayerMonologuePrompt(makePlayer(), ['The city was quiet.'], ['Hold court'], false));

    expect(
      hasLineWith(full, 'player', 'actors', ['never', 'not']),
      "player monologue: no line states the player's id must not appear in any 'actors' list on a no-attempt turn",
    ).toBe(true);
  });
});

// --- Negative controls ------------------------------------------------------
//
// Surfaces whose response schemas carry NO actors declaration must not be
// burdened with the contract paragraph. Green today; they pin the boundary
// so the implementation is targeted, not a blanket paste. Only the two
// distinctive anchors are forbidden ('empty'/'actor'/'narrat'/'description'
// are too generic to ban).

describe('negative control: actor-less schema surfaces stay unburdened', () => {
  const FORBIDDEN_ANCHORS = ['whose actions', 'merely mention'];

  it('action assessment (ActionAssessmentSchema has no actors) carries no contract text', () => {
    const full = fullText(buildActionAssessmentPrompt({
      playerIntent: 'I address the Senate.',
      playerBrief: 'entity_id: player_1\nname: Gaius Testus',
      worldSummary: 'Year 235, week 7.',
      npcEntities: [],
    })).toLowerCase();
    for (const anchor of FORBIDDEN_ANCHORS) {
      expect(full.includes(anchor), `assessment prompt must NOT carry "${anchor}"`).toBe(false);
    }
  });

  it('NPC mind (NpcMindDecisionSchema has no actors) carries no contract text', () => {
    const input: NpcMindPromptInput = {
      self: { ...makePlayer(), entity_id: 'npc_test', name: 'Test NPC', position: 'Praetor' },
      perceivedChanges: [],
      publicHeadlines: [],
      worldSummary: 'Year 235, Week 4.',
      turnNumber: 4,
    };
    const full = fullText(buildNpcMindPrompt(input)).toLowerCase();
    for (const anchor of FORBIDDEN_ANCHORS) {
      expect(full.includes(anchor), `npc-mind prompt must NOT carry "${anchor}"`).toBe(false);
    }
  });
});
