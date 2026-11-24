import { describe, expect, it } from 'vitest';
import {
  deriveSchemeBoard,
  evaluateDeductionHypothesis,
} from '../knowledge/schemeDeduction';
import {
  ingestInvestigationReveal,
  ingestSchemeClue,
  SCHEME_CLUES_TO_REVEAL,
  type KnowledgeClaim,
} from '../knowledge/store';
import { ingestRelationshipObservations } from '../knowledge/relationships';
import { makeEntity, makeKnowledgeClaim } from './factories';

describe('3B: D28 Clue-Driven Scheme Deduction Board', () => {
  it('progresses leads through whisper -> trail -> unmasked strictly from knowledge and never leaks raw active_scheme or secrets', () => {
    const poisonedEntity = makeEntity({
      entity_id: 'maximinus_thrax',
      name: 'Maximinus Thrax',
      position: 'Praefectus Tironibus',
      secrets: ['SECRET_NEVER_SHOWN_SENTINEL'],
      active_scheme: {
        name: 'SECRET_PLOT_NAME_SENTINEL',
        overall_goal: 'SECRET_PLOT_GOAL_SENTINEL',
        steps: [{ objective: 'SECRET_STEP_SENTINEL', status: 'in_progress' }],
      },
    });
    const accomplice = makeEntity({
      entity_id: 'vitalianus',
      name: 'Vitalianus',
      position: 'Praetorian Tribune',
    });

    // 1. Proximity awareness only -> 'whisper', 0 clues, nature hidden, general check stays disconnected.
    let knowledge: KnowledgeClaim[] = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax',
      turn: 2,
      source: 'witnessed',
      text: 'Thrax meets armed messengers past midnight.',
      advancesNature: false,
    });

    let board = deriveSchemeBoard(knowledge, [poisonedEntity, accomplice], 'player_1');
    expect(board.leads).toHaveLength(1);
    expect(board.leads[0].stage).toBe('whisper');
    expect(board.leads[0].clueCount).toBe(0);
    expect(board.leads[0].revealed).toBe(false);
    expect(board.leads[0].nature).toBeUndefined();
    expect(evaluateDeductionHypothesis(board, 'maximinus_thrax').connected).toBe(false);
    expect(JSON.stringify(board)).not.toContain('SENTINEL');

    // 2. Gather clues + validated relationship observations linking Vitalianus across turns 4 and 6 -> 'trail'.
    knowledge = ingestSchemeClue(knowledge, {
      schemerId: 'maximinus_thrax',
      turn: 3,
      source: 'spy',
      text: 'Donatives leave the Rhineland chest unrecorded.',
      natureHint: 'Bribery among the northern cohorts.',
      advancesNature: true,
    });
    const obsTurn4 = 'Maximinus Thrax relies closely on Vitalianus.';
    knowledge = ingestRelationshipObservations(knowledge, {
      turn: 4,
      evidence: [{ id: 'ev_t4', source: 'spy', text: obsTurn4 }],
      drafts: [{ evidenceId: 'ev_t4', participantIds: ['maximinus_thrax', 'vitalianus'], excerpt: obsTurn4 }],
      entities: [poisonedEntity, accomplice],
      knownEntityIds: ['maximinus_thrax', 'vitalianus'],
    });
    const obsTurn6 = 'Vitalianus dispatched orders alongside Maximinus Thrax.';
    knowledge = ingestRelationshipObservations(knowledge, {
      turn: 6,
      evidence: [{ id: 'ev_t6', source: 'rumor', text: obsTurn6 }],
      drafts: [{ evidenceId: 'ev_t6', participantIds: ['maximinus_thrax', 'vitalianus'], excerpt: obsTurn6 }],
      entities: [poisonedEntity, accomplice],
      knownEntityIds: ['maximinus_thrax', 'vitalianus'],
    });

    board = deriveSchemeBoard(knowledge, [poisonedEntity, accomplice], 'player_1');
    expect(board.leads[0].stage).toBe('trail');
    expect(board.leads[0].clueCount).toBe(1);
    expect(board.leads[0].linkedFigures.map(f => f.entityId)).toEqual(['vitalianus']);

    const hypothesis = evaluateDeductionHypothesis(board, 'maximinus_thrax', 'vitalianus');
    expect(hypothesis.connected).toBe(true);
    expect(hypothesis.supportingTurns).toEqual([4, 6]);

    // 3. Remaining paid clues unmask nature once threshold is reached, using honest attribution (never "Confirmed").
    for (let i = 1; i < SCHEME_CLUES_TO_REVEAL; i++) {
      knowledge = ingestSchemeClue(knowledge, {
        schemerId: 'maximinus_thrax',
        turn: 4 + i,
        source: 'spy',
        text: `Cipher ledger clue ${i}.`,
        natureHint: 'A coordinated acclamation along the Rhine.',
        advancesNature: true,
      });
    }

    board = deriveSchemeBoard(knowledge, [poisonedEntity, accomplice], 'player_1');
    expect(board.unmaskedCount).toBe(1);
    expect(board.leads[0].stage).toBe('unmasked');
    expect(board.leads[0].revealed).toBe(true);
    expect(board.leads[0].nature).toBe('A coordinated acclamation along the Rhine.');
    const unmaskedCheck = evaluateDeductionHypothesis(board, 'maximinus_thrax');
    expect(unmaskedCheck.connected).toBe(true);
    expect(unmaskedCheck.summary).not.toContain('Confirmed');
    expect(JSON.stringify(board)).not.toContain('SENTINEL');
  });

  it('excludes unrelated beliefs/secrets claims and non-scheme edges from timeline and edge counts', () => {
    const thrax = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });
    let knowledge: KnowledgeClaim[] = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax',
      turn: 3,
      source: 'spy',
      text: 'Private paymasters met behind the baths.',
      natureHint: 'Bribery.',
      advancesNature: true,
    });
    // Add an unrelated beliefs investigation reveal and an unrelated secrets claim with edges.
    knowledge = ingestInvestigationReveal(knowledge, {
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      text: 'UNRELATED_BELIEFS_TEXT',
      items: ['Disciplinarian'],
      turn: 4,
    });
    const schemeId = knowledge.find(c => c.claimKey === 'scheme:maximinus_thrax')!.id;
    knowledge = [
      ...knowledge,
      makeKnowledgeClaim({
        id: 'unrelated_secret_claim',
        subject: 'maximinus_thrax',
        claimKey: 'investigation:maximinus_thrax:secrets',
        firstLearnedTurn: 5,
        updates: [{ turn: 5, source: 'spy', text: 'UNRELATED_SECRET_EDGE_TEXT' }],
        edges: [{ type: 'corroborates', to: 'non_scheme_belief_claim' }],
      }),
      makeKnowledgeClaim({
        id: 'scheme_corroborator',
        subject: 'maximinus_thrax',
        topic: 'conspiracy',
        claimKey: 'report:maximinus_thrax:conspiracy',
        firstLearnedTurn: 6,
        updates: [{ turn: 6, source: 'rumor', text: 'Tribune heard whispers of the Rhine chest.' }],
        edges: [{ type: 'corroborates', to: schemeId }],
      }),
    ];

    const board = deriveSchemeBoard(knowledge, [thrax], 'player_1');
    const lead = board.leads[0];
    const timelineTexts = lead.evidenceTimeline.map(i => i.text).join(' ');
    expect(timelineTexts).not.toContain('UNRELATED_BELIEFS_TEXT');
    expect(timelineTexts).not.toContain('UNRELATED_SECRET_EDGE_TEXT');
    expect(timelineTexts).toContain('Tribune heard whispers of the Rhine chest.');
    expect(lead.corroborationCount).toBe(1);
    expect(lead.contradictionCount).toBe(0);
  });
});
