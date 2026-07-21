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
import { sanitizeAdjudicationForNarration } from '../ai/prompts/narration';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { getMockInitialState } from './mockData';
import { Adjudication, Entity, EventDelta, Report, TruthLedgerEntry, WorldState } from '../types';

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
      storyRelevance: { spotlight_entities: [] },
      metaNarrative: 'A succession crisis.',
    });
    expect(systemInstruction).toContain("'is_true'");
    expect(systemInstruction).toContain("'origin_id'");
    // D11: true or false, always - the prompt must forbid an unknown class.
    expect(systemInstruction).toContain('never omit it');
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
});
