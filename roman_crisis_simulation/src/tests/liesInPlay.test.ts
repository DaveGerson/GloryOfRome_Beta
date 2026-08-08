/**
 * @vitest-environment jsdom
 *
 * Lies in play (DESIGN_DECISIONS.md D19, with D11/D21): planting rumors -
 * true or false, by the player or by a scheming NPC - resolves through the
 * existing freeform-action loop, and planted lies are game objects others
 * counter in later turns. This stage is the adjudicator-side contract only:
 * no new player verbs, no verification spend (D20 - later stage).
 *
 * Covers: the adjudication prompt's planting + counterplay contract and its
 * never-reveal clause (prompt/schema lockstep, same style as
 * truthLedger.test.ts); the mock-mode player-planted rumor flowing into the
 * truth ledger with player authorship and into the knowledge store via its
 * Report; counterplay follow-ups continuing a claim's update timeline at
 * the knowledge-store level (D21); and the eval judge naming planted-rumor
 * leakage on its information-asymmetry axis.
 */
import { describe, it, expect } from 'vitest';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildEvalJudgePrompt } from '../ai/prompts/evalJudge';
import { mockRunNewTurn } from '../ai/mocks';
import { ingestReports } from '../knowledge/store';
import { computeTurnKnowledge } from '../knowledge/commit';
import { getMockInitialState } from './mockData';
import { buildAdjudicationPromptInput, makeSimulationState } from './factories';
import { Adjudication, Report, TruthLedgerEntry } from '../types';

function buildSystemInstruction(): string {
  const { systemInstruction } = buildAdjudicationPrompt(buildAdjudicationPromptInput({
    submission: {
      observableAttempt: 'Spread word that Thrax steals from his own men',
      questionOrContext: null,
    },
  }));
  return systemInstruction;
}

describe('adjudication prompt: the lies-in-play contract (D19, prompt/schema lockstep)', () => {
  it('carries the player-planting rule: rumor delta, real truth ruling, player origin, tier-governed landing', () => {
    const systemInstruction = buildSystemInstruction();
    expect(systemInstruction).toContain('PLANTED RUMORS & COUNTERPLAY');
    expect(systemInstruction).toContain('PLAYER PLANTING');
    // The plant resolves as a rumor delta whose origin is the player...
    expect(systemInstruction).toContain("'origin_id' is the PLAYER'S entity_id");
    // ...whose is_true is the claim's ACTUAL truth, not the planter's belief...
    expect(systemInstruction).toContain('not whether the player believes it');
    // ...and the resolution tier governs how well the plant lands.
    expect(systemInstruction).toContain('HOW WELL the plant lands');
  });

  it('carries the NPC-planting rule in service of active_scheme, ruled strictly by world-truth', () => {
    const systemInstruction = buildSystemInstruction();
    expect(systemInstruction).toContain('NPC PLANTING');
    expect(systemInstruction).toContain("in service of their 'active_scheme'");
    // World-truth rules the disposition, never authorship: a weaponized
    // truth stays true, and even a fabrication that happens to be true is
    // ruled true.
    expect(systemInstruction).toContain('a weaponized truth is still true');
    expect(systemInstruction).toContain('a fabrication that happens to be true is still true');
    expect(systemInstruction).toContain('authorship never changes the ruling');
  });

  it('the organic 0-2 rumor budget never suppresses a mandated plant or counterplay follow-up', () => {
    const systemInstruction = buildSystemInstruction();
    expect(systemInstruction).toContain('ORGANIC rumors only');
    expect(systemInstruction).toContain('never suppressed to stay within the budget');
  });

  it('carries the counterplay rule: follow-ups about the SAME subject, and the mill has no access to truth (D11/D21)', () => {
    const systemInstruction = buildSystemInstruction();
    expect(systemInstruction).toContain('COUNTERPLAY:');
    expect(systemInstruction).toContain('corroborates, mutates, or refutes');
    // Follow-ups continue the claim's timeline: same subject, same 'key'
    // (the knowledge store's report channel matches on about+source).
    expect(systemInstruction).toContain("reusing the original rumor's 'key'");
    // Only the ledger knows the truth - the mill can be wrong both ways.
    expect(systemInstruction).toContain('no special access to truth');
    expect(systemInstruction).toContain('refuting a true rumor and corroborating a false one are both allowed');
  });

  it('carries the never-reveal clause for player-visible wording (D5/D11 hard invariant)', () => {
    const systemInstruction = buildSystemInstruction();
    expect(systemInstruction).toContain('NEVER REVEAL');
    expect(systemInstruction).toContain("state a rumor's truth status or that it was planted");
    expect(systemInstruction).toContain('read exactly like any other rumor');
  });
});

describe('mock mode: the player-planted rumor path is exercisable offline', () => {
  const runMockTurn = (turnNumber: number, currentReports: Report[] = [], currentLedger: TruthLedgerEntry[] = []) => {
    const { entities, worldState } = getMockInitialState();
    return mockRunNewTurn(
      'Plant a rumor about Thrax', entities[0], turnNumber, entities, worldState,
      currentReports, '', 'A succession crisis.', makeSimulationState(), currentLedger
    );
  };

  it('threads a NON-EMPTY prior campaign ledger through the mock turn: prior entries preserved, this turn\'s appended', async () => {
    const { entities } = getMockInitialState();
    const priorLedger: TruthLedgerEntry[] = [
      { id: 'truth_prior', turn: 2, claim: 'An older lie', aboutId: 'severus_alexander', isTrue: false, originId: 'maximinus_thrax', reportId: 'report_prior' },
    ];

    const result = await runMockTurn(4, [], priorLedger);

    // The prior campaign entry survives verbatim at the head of the ledger -
    // the mock turn's result must accrete onto the campaign ledger, never
    // replace it with only this turn's entries.
    expect(result.updatedTruthLedger.length).toBeGreaterThan(priorLedger.length);
    expect(result.updatedTruthLedger[0]).toEqual(priorLedger[0]);
    // Everything appended after it is this turn's own (turn-4) output,
    // including the player's plant.
    const appended = result.updatedTruthLedger.slice(1);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended.every(entry => entry.turn === 4)).toBe(true);
    expect(appended.some(entry => entry.originId === entities[0].entity_id)).toBe(true);
    // The input ledger was never mutated.
    expect(priorLedger).toHaveLength(1);
  });

  it('records the planted lie in the truth ledger with the PLAYER as origin, explicitly false (never assumed)', async () => {
    const { entities } = getMockInitialState();
    const player = entities[0];
    const result = await runMockTurn(4);

    const planted = result.updatedTruthLedger.filter(entry => entry.originId === player.entity_id);
    expect(planted).toHaveLength(1);
    expect(planted[0].isTrue).toBe(false);
    expect(planted[0].assumed).toBeUndefined();
    expect(planted[0].aboutId).toBe('maximinus_thrax');
    expect(planted[0].turn).toBe(4);
  });

  it('emits the linked player-visible Report carrying no truth data, alongside a leak-free player surface', async () => {
    const { entities } = getMockInitialState();
    const result = await runMockTurn(4);

    const entry = result.updatedTruthLedger.find(e => e.originId === entities[0].entity_id)!;
    const report = result.updatedReports.find(r => r.id === entry.reportId);
    expect(report).toBeDefined();
    expect(report!.claim).toBe(entry.claim);
    expect(report!.source).toBe('rumor');
    // Player-visible surfaces never carry the GM-private disposition keys.
    const playerVisible = JSON.stringify({ reports: result.updatedReports, headlines: result.headlines, narration: result.narration });
    expect(playerVisible).not.toContain('is_true');
    expect(playerVisible).not.toContain('origin_id');
  });

  it('flows into the knowledge store via its Report, and a second mock turn continues the SAME claim timeline (D21)', async () => {
    const first = await runMockTurn(4);
    let store = ingestReports([], first.updatedReports);

    const plantedClaim = store.find(c => c.claimKey === 'report:maximinus_thrax:legion-pay:rumor');
    expect(plantedClaim).toBeDefined();
    expect(plantedClaim!.subject).toBe('maximinus_thrax');
    expect(plantedClaim!.firstLearnedTurn).toBe(4);
    expect(plantedClaim!.updates).toHaveLength(1);
    // The store holds only what the player believes - never truth data.
    const serialized = JSON.stringify(store);
    for (const key of ['is_true', 'origin_id', 'isTrue', 'originId', 'assumed']) {
      expect(serialized).not.toContain(key);
    }

    // Turn 5 re-reports about the same subject through the same channel:
    // committed through the SAME glue App.tsx uses (knowledge/commit.ts),
    // which ingests only the NEW reports (matched by id) - the existing
    // claim accretes an update instead of forking.
    const second = await runMockTurn(5, first.updatedReports);
    store = computeTurnKnowledge({
      prev: store,
      perceivedChanges: [],
      reportsBefore: first.updatedReports,
      reportsAfter: second.updatedReports,
      turnNumber: 5,
    });

    const continued = store.find(c => c.claimKey === 'report:maximinus_thrax:legion-pay:rumor')!;
    expect(continued.firstLearnedTurn).toBe(4); // frozen at first arrival
    expect(continued.updates).toHaveLength(2);
    expect(continued.updates[1].turn).toBe(5);
  });
});

describe('knowledge store: counterplay follow-ups continue the claim timeline (D19/D21)', () => {
  function report(overrides: Partial<Report>): Report {
    return {
      id: 'report_x', turn: 1, source: 'rumor', about: 'maximinus_thrax',
      claim: 'Thrax skims the legions\' pay', credibility: 0.5,
      ...overrides,
    };
  }

  it('a corroboration and then a refutation about the same subject+source land as updates on the planted claim, not new claims', () => {
    let store = ingestReports([], [report({ id: 'report_3_1', turn: 3 })]);
    store = ingestReports(store, [report({
      id: 'report_5_1', turn: 5, credibility: 0.7,
      claim: 'Veterans now swear they saw the pay chests leave camp under Thrax\'s seal',
    })]);
    store = ingestReports(store, [report({
      id: 'report_8_1', turn: 8, credibility: 0.6,
      claim: 'The legions\' ledgers were shown clean; the pay-skimming talk is dismissed as slander',
    })]);

    expect(store).toHaveLength(1);
    const claim = store[0];
    expect(claim.claim).toBe('Thrax skims the legions\' pay'); // frozen origin
    expect(claim.firstLearnedTurn).toBe(3);
    expect(claim.updates.map(u => u.turn)).toEqual([3, 5, 8]);
    // The refutation is just another sourced update with its own credibility
    // - the store records belief evolution, never a truth ruling (D11).
    expect(claim.updates[2].credibility).toBe(0.6);
  });

  it('a refutation from a DIFFERENT source family opens a separate claim (matching-rule boundary, unchanged)', () => {
    const first = ingestReports([], [report({ id: 'report_3_1', turn: 3 })]);
    const second = ingestReports(first, [report({ id: 'report_5_1', turn: 5, source: 'spy', claim: 'Your own agent finds no missing pay' })]);
    expect(second).toHaveLength(2);
  });
});

describe('eval judge: planted-rumor leakage joins the information-asymmetry axis', () => {
  it('names planted-rumor leakage as a violation while keeping exactly the five axes', () => {
    const adjudication: Adjudication = { turn: 3, entityActions: [], deltas: [], headlines: [], gm_private: [] };
    const { systemInstruction } = buildEvalJudgePrompt({
      turnNumber: 3,
      playerIntent: 'Spread a rumor',
      adjudication,
      narration: null,
    });

    for (const axis of ['consequence_density', 'sim_state_consistency', 'schema_validity', 'information_asymmetry', 'character_richness']) {
      expect(systemInstruction).toContain(axis);
    }
    expect(systemInstruction).toContain('Planted-rumor leakage');
    expect(systemInstruction).toContain("reveals a rumor's truth status or that it was planted");
    // EXACTLY five axes (character_richness closed the 4C pending item) -
    // the leakage clause remains a clarification of axis 4, never an axis.
    expect(systemInstruction).toContain('EXACTLY these five axes');
    expect(systemInstruction).not.toMatch(/^6\./m);
  });
});
