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
import {
  computeTurnKnowledge,
  computeInvestigationKnowledge,
  type RelationshipObservationsInput,
} from '../knowledge/commit';
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

function makeRelationshipObservations(
  evidenceId: string,
  text: string,
  source: 'self' | 'rumor' = 'self'
): RelationshipObservationsInput {
  return {
    evidence: [{ id: evidenceId, source, text }],
    drafts: [{
      evidenceId,
      participantIds: ['severus_alexander', 'lucius'],
      excerpt: text,
    }],
    entities: [
      { entity_id: 'severus_alexander', name: 'Severus Alexander' },
      { entity_id: 'lucius', name: 'Senator Lucius' },
    ],
    knownEntityIds: ['severus_alexander', 'lucius'],
  };
}

describe('knowledge/commit computeTurnKnowledge', () => {
  it('optionally commits validated relationship observations with the authoritative turn', () => {
    const report = makeReport({
      id: 'report_99_1',
      claim: 'Senator Lucius defended Severus Alexander before the Curia.',
    });
    const relationshipObservations = {
      evidence: [{
        id: report.id,
        source: 'rumor' as const,
        text: report.claim,
      }],
      drafts: [{
        evidenceId: 'report_99_1',
        participantIds: ['severus_alexander', 'lucius'],
        excerpt: 'Senator Lucius defended Severus Alexander before the Curia.',
      }],
      entities: [
        { entity_id: 'severus_alexander', name: 'Severus Alexander' },
        { entity_id: 'lucius', name: 'Senator Lucius' },
      ],
      knownEntityIds: ['severus_alexander'],
    };

    const store = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [],
      reportsBefore: [report],
      reportsAfter: [report],
      relationshipObservations,
      turnNumber: 5,
    });

    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      claimKey: 'relationship-observation:5:0',
      firstLearnedTurn: 5,
      updates: [{ turn: 5, source: 'rumor' }],
      relationshipObservation: {
        evidenceId: 'report_99_1',
        participantIds: ['severus_alexander', 'lucius'],
      },
    });
  });

  it('commits the player digest, new report, and validated observation under one authoritative turn without duplicating an evidence id on retry', () => {
    const report = makeReport({ id: 'report_atomic', turn: 99 });
    const relationshipObservations = {
      evidence: [{
        id: report.id,
        source: 'rumor' as const,
        text: report.claim,
      }],
      drafts: [{
        evidenceId: report.id,
        participantIds: ['severus_alexander', 'maximinus_thrax'],
        excerpt: report.claim,
      }],
      entities: [
        { entity_id: 'severus_alexander', name: 'Severus Alexander' },
        { entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' },
      ],
      knownEntityIds: ['severus_alexander', 'maximinus_thrax'],
    };
    const committed = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [makeChange()],
      reportsBefore: [],
      reportsAfter: [report],
      relationshipObservations,
      turnNumber: 5,
    });
    const retried = computeTurnKnowledge({
      prev: committed,
      perceivedChanges: [],
      reportsBefore: [report],
      reportsAfter: [report],
      relationshipObservations,
      turnNumber: 5,
    });

    expect(committed).toHaveLength(3);
    expect(committed.every(claim => claim.firstLearnedTurn === 5)).toBe(true);
    expect(committed.flatMap(claim => claim.updates).every(update => update.turn === 5)).toBe(true);
    expect(retried).toBe(committed);
    expect(retried.filter(claim => claim.relationshipObservation?.evidenceId === report.id)).toHaveLength(1);
  });

  it('retains distinct local observations across successful turns even when the builder-local id repeats', () => {
    const first = computeTurnKnowledge({
      prev: [],
      perceivedChanges: [],
      reportsBefore: [],
      reportsAfter: [],
      relationshipObservations: makeRelationshipObservations(
        'player-submission',
        'Severus publicly supported Senator Lucius before the Curia.'
      ),
      turnNumber: 1,
    });
    const second = computeTurnKnowledge({
      prev: first,
      perceivedChanges: [],
      reportsBefore: [],
      reportsAfter: [],
      relationshipObservations: makeRelationshipObservations(
        'player-submission',
        'Severus publicly denounced Senator Lucius before the Curia.'
      ),
      turnNumber: 2,
    });

    expect(second.map(claim => claim.claim)).toEqual([
      'Severus publicly supported Senator Lucius before the Curia.',
      'Severus publicly denounced Senator Lucius before the Curia.',
    ]);
    expect(second.map(claim => claim.relationshipObservation?.evidenceId)).toEqual([
      'turn:1:player-submission',
      'turn:2:player-submission',
    ]);
  });

  it('deduplicates the same local observation when the same authoritative turn retries', () => {
    const relationshipObservations = makeRelationshipObservations(
      'player-submission',
      'Severus publicly supported Senator Lucius before the Curia.'
    );
    const first = computeTurnKnowledge({
      prev: [], perceivedChanges: [], reportsBefore: [], reportsAfter: [],
      relationshipObservations, turnNumber: 4,
    });
    const retried = computeTurnKnowledge({
      prev: first, perceivedChanges: [], reportsBefore: [], reportsAfter: [],
      relationshipObservations, turnNumber: 4,
    });

    expect(retried).toBe(first);
    expect(retried).toHaveLength(1);
    expect(retried[0].relationshipObservation?.evidenceId).toBe('turn:4:player-submission');
  });

  it('keeps report evidence ids global so a replay remains one observation across turns', () => {
    const report = makeReport({ id: 'report_global_replay' });
    const relationshipObservations = makeRelationshipObservations(report.id, report.claim, 'rumor');
    const first = computeTurnKnowledge({
      prev: [], perceivedChanges: [], reportsBefore: [], reportsAfter: [report],
      relationshipObservations, turnNumber: 4,
    });
    const replayed = computeTurnKnowledge({
      prev: first, perceivedChanges: [], reportsBefore: [report], reportsAfter: [report],
      relationshipObservations, turnNumber: 5,
    });

    expect(replayed.filter(claim => claim.relationshipObservation)).toHaveLength(1);
    expect(replayed.find(claim => claim.relationshipObservation)?.relationshipObservation?.evidenceId)
      .toBe(report.id);
  });

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
      // D29 report key now carries the topic; an un-topiced fixture Report
      // defaults to 'general'.
      'report:maximinus_thrax:general:rumor',
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
  it('optionally commits a relationship observation alongside the bought reveal without mutating prev', () => {
    const prev: KnowledgeClaim[] = [];
    const relationshipObservations = {
      evidence: [{
        id: 'investigation_6_lucius',
        source: 'spy' as const,
        text: 'Senator Lucius paid the Praetorian prefect after leaving your audience.',
      }],
      drafts: [{
        evidenceId: 'investigation_6_lucius',
        participantIds: ['severus_alexander', 'lucius'],
        excerpt: 'Senator Lucius paid the Praetorian prefect after leaving your audience.',
      }],
      entities: [
        { entity_id: 'severus_alexander', name: 'Severus Alexander' },
        { entity_id: 'lucius', name: 'Senator Lucius' },
      ],
      knownEntityIds: ['severus_alexander'],
    };

    const store = computeInvestigationKnowledge({
      prev,
      targetId: 'lucius',
      kind: 'secrets',
      reportText: 'Senator Lucius paid the Praetorian prefect after leaving your audience.',
      relationshipObservations,
      turnNumber: 6,
    });

    expect(prev).toEqual([]);
    expect(store).toHaveLength(2);
    const observation = store.find(claim => claim.relationshipObservation);
    expect(observation).toMatchObject({
      claimKey: 'relationship-observation:6:0',
      firstLearnedTurn: 6,
      updates: [{ turn: 6, source: 'spy' }],
    });
  });

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
