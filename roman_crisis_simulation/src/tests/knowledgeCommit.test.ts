/**
 * Pure unit tests for knowledge/commit.ts - the exact turn-commit /
 * investigation-commit knowledge glue App.tsx delegates to (executeTurn and
 * handleInvestigationOutcome). Pins the two rules the glue owns:
 *  - NEW reports are identified by id against the pre-turn report log
 *    (never by array position), so nothing already ingested re-ingests;
 *  - EVERY committed update is stamped with the App's authoritative turn
 *    counter, never a model-authored turn field (a Report's own `turn`
 *    descends from the model-echoed `adjudication.turn`).
 */
import { describe, it, expect } from 'vitest';
import { computeTurnKnowledge, computeInvestigationKnowledge } from '../knowledge/commit';
import type { KnowledgeClaim } from '../knowledge/store';
import type { PerceivedChange } from '../perception/visibility';
import type { Report } from '../types';

function makeChange(overrides: Partial<PerceivedChange> = {}): PerceivedChange {
  return {
    text: 'Your denarii dwindles.',
    source: 'self',
    tabs: ['resources'],
    subject: 'severus_alexander',
    deltaType: 'resource',
    deltaKey: 'severus_alexander:denarii',
    ...overrides,
  };
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report_2_1',
    turn: 2,
    source: 'rumor',
    about: 'maximinus_thrax',
    claim: 'Thrax courts the Rhine legions',
    credibility: 0.6,
    ...overrides,
  };
}

describe('knowledge/commit computeTurnKnowledge', () => {
  it('ingests the perceived digest and this turn\'s new reports into one store', () => {
    const store = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [makeChange()],
      reportsBefore: [],
      reportsAfter: [makeReport()],
      turnNumber: 2,
    });

    expect(store).toHaveLength(2);
    expect(store.map(c => c.claimKey).sort()).toEqual([
      'digest:resource:severus_alexander:denarii',
      'report:maximinus_thrax:rumor',
    ]);
  });

  it('ingests ONLY reports absent from the pre-turn log, matched by id - not by array position', () => {
    const oldReport = makeReport({ id: 'report_2_1', turn: 2 });
    const newReport = makeReport({ id: 'report_3_1', turn: 3, claim: 'The legions now openly cheer Thrax', credibility: 0.8 });

    const afterFirstTurn = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [],
      reportsBefore: [],
      reportsAfter: [oldReport],
      turnNumber: 2,
    });
    // The turn's report log arrives REORDERED (new one first) - position
    // must not matter, only ids absent from the pre-turn log ingest.
    const afterSecondTurn = computeTurnKnowledge({
      prev: afterFirstTurn,
      perceivedChanges: [],
      reportsBefore: [oldReport],
      reportsAfter: [newReport, oldReport],
      turnNumber: 3,
    });

    expect(afterSecondTurn).toHaveLength(1);
    const claim = afterSecondTurn[0];
    // One update per turn - the old report did NOT re-ingest on turn 3.
    expect(claim.updates).toHaveLength(2);
    expect(claim.updates.map(u => u.text)).toEqual([
      'Thrax courts the Rhine legions',
      'The legions now openly cheer Thrax',
    ]);
  });

  it('stamps EVERY update with the authoritative turn number, never the report\'s model-echoed turn field', () => {
    // A model that mislabels its turn: the Report claims turn 99 while the
    // App is committing turn 5. The claim timeline must follow the App.
    const mislabeled = makeReport({ id: 'report_x', turn: 99 });

    const store = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [makeChange()],
      reportsBefore: [],
      reportsAfter: [mislabeled],
      turnNumber: 5,
    });

    for (const claim of store) {
      expect(claim.firstLearnedTurn).toBe(5);
      expect(claim.updates.every(u => u.turn === 5)).toBe(true);
    }
  });

  it('returns the prev store reference when nothing ingests', () => {
    const report = makeReport();
    const prev: KnowledgeClaim[] = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [],
      reportsBefore: [],
      reportsAfter: [report],
      turnNumber: 2,
    });

    const next = computeTurnKnowledge({
      prev,
      perceivedChanges: [],
      reportsBefore: [report],
      reportsAfter: [report],
      turnNumber: 3,
    });
    expect(next).toBe(prev);
  });

  it('never mutates the prev store or the report logs', () => {
    const prev = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [],
      reportsBefore: [],
      reportsAfter: [makeReport()],
      turnNumber: 2,
    });
    const prevSnapshot = JSON.parse(JSON.stringify(prev));
    const reportsBefore = [makeReport()];
    const reportsAfter = [makeReport(), makeReport({ id: 'report_4_1', turn: 4, claim: 'A fresh claim' })];

    computeTurnKnowledge({ prev, perceivedChanges: [makeChange()], reportsBefore, reportsAfter, turnNumber: 4 });

    expect(prev).toEqual(prevSnapshot);
    expect(reportsBefore).toHaveLength(1);
    expect(reportsAfter).toHaveLength(2);
  });
});

describe('knowledge/commit computeInvestigationKnowledge', () => {
  it('ingests the bought reveal as a spy-sourced claim stamped with the authoritative turn', () => {
    const store = computeInvestigationKnowledge({
      prev: [],
      targetId: 'maximinus_thrax',
      kind: 'secrets',
      reportText: 'He hides a pact with the Rhine legions.',
      turnNumber: 6,
    });

    expect(store).toHaveLength(1);
    const claim = store[0];
    expect(claim.claimKey).toBe('investigation:maximinus_thrax:secrets');
    expect(claim.subject).toBe('maximinus_thrax');
    expect(claim.firstLearnedTurn).toBe(6);
    expect(claim.updates).toEqual([
      { turn: 6, source: 'spy', text: 'He hides a pact with the Rhine legions.' },
    ]);
  });

  it('re-buying the same target + kind appends a freshly stamped update on the same claim (D14)', () => {
    const first = computeInvestigationKnowledge({
      prev: [],
      targetId: 'maximinus_thrax',
      kind: 'scheme',
      reportText: 'He plans to march on Rome.',
      turnNumber: 4,
    });
    const second = computeInvestigationKnowledge({
      prev: first,
      targetId: 'maximinus_thrax',
      kind: 'scheme',
      reportText: 'The march is set for the spring thaw.',
      turnNumber: 9,
    });

    expect(second).toHaveLength(1);
    expect(second[0].firstLearnedTurn).toBe(4);
    expect(second[0].updates.map(u => u.turn)).toEqual([4, 9]);
  });
});
