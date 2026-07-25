/**
 * @vitest-environment jsdom
 *
 * The GM-private truth ledger (DESIGN_DECISIONS.md D11): the engine must
 * always know what is a lie. Covers the schema pair's new rumor fields
 * (is_true/origin_id), the prompt/schema lockstep, the engine's ledger
 * write site (ai/core/engine.ts's rumor case) including the assumed-true
 * fallback for undispositioned rumors, the ledger's bound, and the
 * narration-sanitization guarantee that the disposition never reaches the
 * one player-facing prompt that serializes deltas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDeltas,
  applyAdjudication,
  appendTruthLedgerEntries,
  MAX_TRUTH_LEDGER_ENTRIES,
} from '../ai/core/engine';
import { zEventDelta, zAdjudication } from '../ai/core/zodSchemas';
import { AdjudicationSchema } from '../ai/core/schemas';
import { sanitizeAdjudicationForNarration, buildNarrationPrompt } from '../ai/prompts/narration';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildMortalityOutcomePrompt } from '../ai/prompts/mortality';
import { buildPrivateConversationPrompt, buildSimulationStateUpdatePrompt } from '../ai/prompts/intelligence';
import { REDACTED_SCHEME_REASON } from '../ai/prompts/fragments';
import { getMockInitialState } from './mockData';
import { Adjudication, Entity, EventDelta, Report, SimulationState, TruthLedgerEntry, WorldState } from '../types';

const deepCopy = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

const baseAdjudication: Adjudication = {
  turn: 4,
  entityActions: [],
  deltas: [],
  headlines: [],
  gm_private: [],
};

function rumorDelta(overrides: Partial<EventDelta> = {}): EventDelta {
  return {
    type: 'rumor',
    key: 'severus_alexander',
    delta: 0.7,
    reason: 'The Emperor is said to be bargaining with the Germans.',
    ...overrides,
  };
}

// A 'scheme' delta's `reason` is the full active_scheme JSON - name, goal,
// and ordered steps - which is GM-private under D28. These sentinels let a
// test prove none of that JSON survives into a player-output-bound prompt.
const SCHEME_NAME = 'The Poisoned Chalice';
const SCHEME_GOAL = 'Depose the Emperor before Saturnalia';
const SCHEME_STEP = 'Bribe the imperial cupbearer';
function schemeDelta(overrides: Partial<EventDelta> = {}): EventDelta {
  return {
    type: 'scheme',
    key: 'severus_alexander',
    delta: 0,
    reason: JSON.stringify({
      name: SCHEME_NAME,
      overall_goal: SCHEME_GOAL,
      steps: [{ objective: SCHEME_STEP, status: 'in_progress' }],
    }),
    ...overrides,
  };
}

describe('schema pair: rumor truth fields (is_true/origin_id)', () => {
  it('zEventDelta accepts and preserves a fully dispositioned rumor delta', () => {
    const parsed = zEventDelta.parse(rumorDelta({ is_true: false, origin_id: 'maximinus_thrax' }));
    expect(parsed.is_true).toBe(false);
    expect(parsed.origin_id).toBe('maximinus_thrax');
  });

  it('zEventDelta accepts null and absent dispositions (defensive path for the engine fallback)', () => {
    expect(zEventDelta.parse(rumorDelta()).is_true).toBeUndefined();
    const withNulls = zEventDelta.parse(rumorDelta({ is_true: null as unknown as boolean, origin_id: null as unknown as string }));
    expect(withNulls.is_true).toBeNull();
    expect(withNulls.origin_id).toBeNull();
  });

  it('zEventDelta rejects a non-boolean truth disposition', () => {
    expect(() => zEventDelta.parse(rumorDelta({ is_true: 'yes' as unknown as boolean }))).toThrow();
  });

  it('zAdjudication carries rumor deltas with the new fields end to end', () => {
    const adjudication = {
      ...deepCopy(baseAdjudication),
      deltas: [rumorDelta({ is_true: true, origin_id: 'gaius_pontius_magnus' })],
    };
    const parsed = zAdjudication.parse(adjudication);
    expect(parsed.deltas[0].is_true).toBe(true);
    expect(parsed.deltas[0].origin_id).toBe('gaius_pontius_magnus');
  });

  it('the Gemini EventDelta schema declares both fields (zod/Gemini lockstep)', () => {
    const deltaProperties = (AdjudicationSchema.properties.deltas.items as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(deltaProperties)).toContain('is_true');
    expect(Object.keys(deltaProperties)).toContain('origin_id');
  });

  it('pins the schema descriptions\' load-bearing semantics: world-truth ruling, never unset, never reaches the player', () => {
    const deltaProperties = (AdjudicationSchema.properties.deltas.items as {
      properties: Record<string, { description?: string }>;
    }).properties;

    const isTrueDescription = deltaProperties.is_true.description ?? '';
    // The ruling follows world-truth alone - a fabrication that happens to
    // be true is still true; authorship never changes the ruling.
    expect(isTrueDescription).toContain('Ruled STRICTLY by world-truth');
    expect(isTrueDescription).toContain('a fabrication that happens to be true is still true');
    expect(isTrueDescription).toContain('authorship never changes the ruling');
    // The helpful planted-lie example survives, grounded in the claim (not authorship).
    expect(isTrueDescription).toContain('a planted lie is false because its claim is false');
    // Always ruled, never unset; GM-private, never player-facing.
    expect(isTrueDescription).toContain('never leave it unset');
    expect(isTrueDescription).toContain('GM-PRIVATE');
    expect(isTrueDescription).toContain('This never reaches the player');

    const originIdDescription = deltaProperties.origin_id.description ?? '';
    expect(originIdDescription).toContain('GM-PRIVATE');
    expect(originIdDescription).toContain('This never reaches the player');
  });

  it('the adjudication prompt demands both fields on every rumor (prompt/schema lockstep)', () => {
    const { entities, worldState } = getMockInitialState();
    const player = entities[0];
    const { systemInstruction } = buildAdjudicationPrompt({
      worldState,
      simulationState: {
        imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
        plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
      },
      playerEntity: player,
      npcEntities: entities.slice(1),
      history: [],
      playerIntent: 'Hold court',
      gmInterventionText: '',
      storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
      metaNarrative: 'A succession crisis.',
    });
    expect(systemInstruction).toContain("'is_true'");
    expect(systemInstruction).toContain("'origin_id'");
    // D11: true or false, always - the prompt must forbid an unknown class.
    expect(systemInstruction).toContain('never omit it');
  });
});

describe('D11 lockstep: every other delta-producing prompt demands truth dispositions on rumor deltas', () => {
  it('the mortality OUTCOME prompt demands is_true/origin_id, and rules presumed_dead death-rumors FALSE (the world-truth is that they live)', () => {
    const { systemInstruction } = buildMortalityOutcomePrompt({
      candidates: [{
        entity_id: 'gaius_pontius_magnus',
        name: 'Gaius Pontius Magnus',
        isPlayer: false,
        band: 'presumed_dead',
        cause: 'Cut down in the Curia.',
        entityBrief: 'Gaius Pontius Magnus - Senator - The Curia',
      }],
    });

    // The same GM-private bookkeeping demand the adjudication prompt makes -
    // outcome-authored rumor deltas flow through the SAME engine rumor case
    // and must never land as assumed-true by omission.
    expect(systemInstruction).toContain("'is_true'");
    expect(systemInstruction).toContain('ALWAYS set');
    expect(systemInstruction).toContain('never omit it');
    expect(systemInstruction).toContain("'origin_id'");
    expect(systemInstruction).toContain('GM-private ledger data');
    // The presumed_dead band's world-truth ruling: the engine sets
    // secret_truth.actually_alive, so a rumor asserting the death is FALSE -
    // it must never be ledgered assumed-true the same turn the engine knows
    // the entity lives.
    expect(systemInstruction).toContain("'is_true' FALSE");
    expect(systemInstruction).toContain('the world-truth is that they live');
  });

  it('the private-conversation prompt demands is_true/origin_id on any rumor delta it returns', () => {
    const { entities } = getMockInitialState();
    const adjudication = deepCopy(baseAdjudication);
    const { systemInstruction } = buildPrivateConversationPrompt(entities[1], entities[2], adjudication);

    expect(systemInstruction).toContain("'is_true'");
    expect(systemInstruction).toContain('ALWAYS set');
    expect(systemInstruction).toContain('never omit it');
    expect(systemInstruction).toContain("'origin_id'");
    expect(systemInstruction).toContain('GM-private ledger data');
    // World-truth ruling, consistent with the schema description's wording.
    expect(systemInstruction).toContain('Authorship never changes the ruling');
  });

  it('the private-conversation prompt demands topic (+ stance for follow-ups) on any rumor delta (D29 lockstep)', () => {
    const { entities } = getMockInitialState();
    const adjudication = deepCopy(baseAdjudication);
    const { systemInstruction } = buildPrivateConversationPrompt(entities[1], entities[2], adjudication);

    // Without a topic a conversation rumor defaults to 'general' and
    // re-merges with unrelated claims - the flat-list over-merge D29 fixed.
    // The prompt must demand a topic on every rumor, mirroring the
    // adjudication prompt's rumor rule.
    expect(systemInstruction).toContain("'topic'");
    expect(systemInstruction).toContain('ALWAYS set');
    expect(systemInstruction).toContain('reuses the SAME topic');
    // topic is a neutral, player-safe label - never a truth hint.
    expect(systemInstruction).toContain('never hint at whether the claim is true');
    // Counterplay follow-ups carry a stance toward the claim they continue.
    expect(systemInstruction).toContain("'stance'");
    expect(systemInstruction).toContain('corroborates');
    expect(systemInstruction).toContain('contradicts');
  });
});

describe('engine: the truth ledger write site (ai/core/engine.ts rumor case)', () => {
  let entities: Entity[];
  let worldState: WorldState;
  let reports: Report[];

  beforeEach(() => {
    const initial = getMockInitialState();
    entities = initial.entities;
    worldState = initial.worldState;
    reports = [];
  });

  it('records a TRUE rumor with its origin, linked to the Report the player saw', () => {
    const adjudication = deepCopy(baseAdjudication);
    adjudication.deltas.push(rumorDelta({ is_true: true, origin_id: 'gaius_pontius_magnus', delta: 0.4 }));

    const { updatedReports, updatedTruthLedger } = applyAdjudication(adjudication, entities, worldState, reports);

    expect(updatedTruthLedger).toHaveLength(1);
    const entry = updatedTruthLedger[0];
    expect(entry.isTrue).toBe(true);
    expect(entry.assumed).toBeUndefined();
    expect(entry.originId).toBe('gaius_pontius_magnus');
    expect(entry.turn).toBe(4);
    expect(entry.aboutId).toBe('severus_alexander');
    expect(entry.claim).toBe('The Emperor is said to be bargaining with the Germans.');
    // The link the GM console's true-vs-believed view leans on.
    expect(updatedReports).toHaveLength(1);
    expect(entry.reportId).toBe(updatedReports[0].id);
    expect(updatedReports[0].credibility).toBe(0.4);
  });

  it('records a FALSE rumor (a knowing lie), and an organic one without an origin', () => {
    const adjudication = deepCopy(baseAdjudication);
    adjudication.deltas.push(rumorDelta({ is_true: false, origin_id: 'maximinus_thrax' }));
    adjudication.deltas.push(rumorDelta({ key: 'The Suburra', reason: 'Grain stores run low.', is_true: true }));

    const { updatedTruthLedger } = applyAdjudication(adjudication, entities, worldState, reports);

    expect(updatedTruthLedger).toHaveLength(2);
    expect(updatedTruthLedger[0].isTrue).toBe(false);
    expect(updatedTruthLedger[0].originId).toBe('maximinus_thrax');
    expect(updatedTruthLedger[1].isTrue).toBe(true);
    expect(updatedTruthLedger[1].originId).toBeUndefined();
    // Two rumors applied in the same call still get distinct report/ledger
    // ids, so each ledger entry's reportId resolves unambiguously.
    expect(updatedTruthLedger[0].id).not.toBe(updatedTruthLedger[1].id);
    expect(updatedTruthLedger[0].reportId).not.toBe(updatedTruthLedger[1].reportId);
  });

  it('treats an empty-string origin_id as organic', () => {
    const { newTruthLedgerEntries } = applyDeltas([rumorDelta({ is_true: false, origin_id: '' })], entities, worldState, 4);
    expect(newTruthLedgerEntries[0].originId).toBeUndefined();
  });

  it('falls back to assumed-true when the model omits the disposition - never silently inventing a lie', () => {
    const { newTruthLedgerEntries } = applyDeltas([rumorDelta()], entities, worldState, 4);
    expect(newTruthLedgerEntries).toHaveLength(1);
    expect(newTruthLedgerEntries[0].isTrue).toBe(true);
    expect(newTruthLedgerEntries[0].assumed).toBe(true);
  });

  it('treats a null disposition (nullable schema field) the same as an omitted one', () => {
    const { newTruthLedgerEntries } = applyDeltas(
      [rumorDelta({ is_true: null as unknown as boolean })], entities, worldState, 4
    );
    expect(newTruthLedgerEntries[0].isTrue).toBe(true);
    expect(newTruthLedgerEntries[0].assumed).toBe(true);
  });

  it('does not flag assumed on an explicit false disposition', () => {
    const { newTruthLedgerEntries } = applyDeltas([rumorDelta({ is_true: false })], entities, worldState, 4);
    expect(newTruthLedgerEntries[0].isTrue).toBe(false);
    expect(newTruthLedgerEntries[0].assumed).toBeUndefined();
  });

  it('writes no ledger entries for non-rumor deltas', () => {
    const { newTruthLedgerEntries } = applyDeltas(
      [{ type: 'resource', key: 'severus_alexander:denarii', delta: -100, reason: 'Bribes' }],
      entities, worldState, 4
    );
    expect(newTruthLedgerEntries).toHaveLength(0);
  });

  it('appends onto the existing ledger through applyAdjudication', () => {
    const existing: TruthLedgerEntry[] = [
      { id: 'truth_old', turn: 1, claim: 'An old claim', aboutId: 'x', isTrue: true, reportId: 'report_old' },
    ];
    const adjudication = deepCopy(baseAdjudication);
    adjudication.deltas.push(rumorDelta({ is_true: false }));

    const { updatedTruthLedger } = applyAdjudication(adjudication, entities, worldState, reports, existing);

    expect(updatedTruthLedger).toHaveLength(2);
    expect(updatedTruthLedger[0]).toEqual(existing[0]);
    expect(updatedTruthLedger[1].isTrue).toBe(false);
    // The input ledger is not mutated.
    expect(existing).toHaveLength(1);
  });

  it(`caps the ledger at MAX_TRUTH_LEDGER_ENTRIES (${MAX_TRUTH_LEDGER_ENTRIES}), dropping the oldest`, () => {
    const full: TruthLedgerEntry[] = Array.from({ length: MAX_TRUTH_LEDGER_ENTRIES }, (_, i) => ({
      id: `truth_old_${i}`, turn: i, claim: `Claim ${i}`, aboutId: 'x', isTrue: true, reportId: `report_old_${i}`,
    }));
    const adjudication = deepCopy(baseAdjudication);
    adjudication.deltas.push(rumorDelta({ is_true: false }));

    const { updatedTruthLedger } = applyAdjudication(adjudication, entities, worldState, reports, full);

    expect(updatedTruthLedger).toHaveLength(MAX_TRUTH_LEDGER_ENTRIES);
    // The oldest entry fell off, the newest landed at the end.
    expect(updatedTruthLedger[0].id).toBe('truth_old_1');
    expect(updatedTruthLedger[updatedTruthLedger.length - 1].isTrue).toBe(false);
  });

  it('appendTruthLedgerEntries returns the same reference when nothing is appended', () => {
    const current: TruthLedgerEntry[] = [
      { id: 'truth_a', turn: 1, claim: 'A', aboutId: 'x', isTrue: true, reportId: 'r_a' },
    ];
    expect(appendTruthLedgerEntries(current, [])).toBe(current);
  });
});

describe('leak prevention: dispositions never reach the player-facing narration prompt', () => {
  it('sanitizeAdjudicationForNarration strips is_true and origin_id from every delta', () => {
    const adjudication: Adjudication = {
      ...deepCopy(baseAdjudication),
      deltas: [
        rumorDelta({ is_true: false, origin_id: 'maximinus_thrax' }),
        { type: 'resource', key: 'severus_alexander:denarii', delta: -100, reason: 'Bribes' },
      ],
      gm_private: ['A GM-only note'],
    };

    const sanitized = sanitizeAdjudicationForNarration(adjudication);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('is_true');
    expect(serialized).not.toContain('origin_id');
    expect(serialized).not.toContain('gm_private');
    // The rumor itself still reaches the narrator exactly as before -
    // claim, key, and credibility intact.
    expect(sanitized.deltas[0].reason).toBe('The Emperor is said to be bargaining with the Germans.');
    expect(sanitized.deltas[0].delta).toBe(0.7);
  });

  it('buildNarrationPrompt accepts only player-perceived text/source fields', () => {
    const { entities } = getMockInitialState();
    const player = entities[0];
    const { systemInstruction, prompt } = buildNarrationPrompt(
      'A succession crisis.', player, 'Hold court', [
        { text: 'Rumor reaches you: "The Emperor bargains with the Germans."', source: 'network' },
        { text: 'Gaius Pontius Magnus is now dead.', source: 'witnessed' },
      ], []
    );
    const built = systemInstruction + prompt;

    for (const forbidden of ['is_true', 'origin_id', 'gm_private', 'secret_truth', 'actually_alive', 'presumed_dead']) {
      expect(built).not.toContain(forbidden);
    }
    expect(prompt).toContain('The Emperor bargains with the Germans.');
    expect(prompt).toContain('Gaius Pontius Magnus is now dead.');
  });
});

describe("D28: a scheme's nature never reaches a player-output-bound prompt", () => {
  it('sanitizeAdjudicationForNarration redacts a scheme delta reason - name/goal/steps never survive, other deltas untouched', () => {
    const adjudication: Adjudication = {
      ...deepCopy(baseAdjudication),
      deltas: [
        schemeDelta(),
        { type: 'resource', key: 'severus_alexander:denarii', delta: -100, reason: 'Bribes' },
      ],
    };

    const sanitized = sanitizeAdjudicationForNarration(adjudication);
    const serialized = JSON.stringify(sanitized);

    // The full active_scheme JSON is GM-private (D28): none of its name,
    // goal, or steps may survive into this player-facing prompt's deltas.
    expect(serialized).not.toContain(SCHEME_NAME);
    expect(serialized).not.toContain(SCHEME_GOAL);
    expect(serialized).not.toContain(SCHEME_STEP);
    // The scheme delta still rides through - as an opaque 'something afoot'
    // marker, so the narrator learns only THAT a private design shifted.
    expect(sanitized.deltas[0].type).toBe('scheme');
    expect(sanitized.deltas[0].reason).toBe(REDACTED_SCHEME_REASON);
    // A non-scheme delta keeps its prose reason exactly as before.
    expect(sanitized.deltas[1].reason).toBe('Bribes');
  });

  it('buildNarrationPrompt carries only the opaque perceived scheme line', () => {
    const { entities } = getMockInitialState();
    const player = entities[0];
    const { systemInstruction, prompt } = buildNarrationPrompt(
      'A succession crisis.', player, 'Hold court', [
        { text: 'You sense Maximinus is plotting something.', source: 'network' },
      ], []
    );
    const built = systemInstruction + prompt;

    expect(built).not.toContain(SCHEME_NAME);
    expect(built).not.toContain(SCHEME_GOAL);
    expect(built).not.toContain(SCHEME_STEP);
    expect(prompt).toContain('You sense Maximinus is plotting something.');
  });

  it('buildSimulationStateUpdatePrompt: the Key Deltas line redacts a scheme reason (its output renders in WorldStateTab)', () => {
    const oldState: SimulationState = {
      imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
      plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
    };
    const adjudication: Adjudication = {
      ...deepCopy(baseAdjudication),
      deltas: [
        schemeDelta(),
        { type: 'resource', key: 'severus_alexander:denarii', delta: -100, reason: 'Bribes for the guards.' },
      ],
      headlines: ['The city holds its breath.'],
    };

    const { prompt } = buildSimulationStateUpdatePrompt(adjudication, oldState);

    // This call's OUTPUT renders in WorldStateTab (D5), so its serialized
    // deltas are player-output-bound: the scheme's nature stays withheld.
    expect(prompt).not.toContain(SCHEME_NAME);
    expect(prompt).not.toContain(SCHEME_GOAL);
    expect(prompt).not.toContain(SCHEME_STEP);
    expect(prompt).toContain(REDACTED_SCHEME_REASON);
    // A non-scheme delta's prose reason is unaffected.
    expect(prompt).toContain('Bribes for the guards.');
  });
});
