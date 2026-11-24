import { describe, expect, it } from 'vitest';
import {
  deriveSchemeBoard,
  evaluateDeductionHypothesis,
} from '../knowledge/schemeDeduction';
import {
  ingestSchemeClue,
  SCHEME_CLUES_TO_REVEAL,
  type KnowledgeClaim,
} from '../knowledge/store';
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

    // 1. Proximity awareness only -> 'whisper', 0 clues, nature hidden.
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
    expect(JSON.stringify(board)).not.toContain('SENTINEL');

    // 2. Gather clues + an observation linking Vitalianus -> 'trail'.
    knowledge = ingestSchemeClue(knowledge, {
      schemerId: 'maximinus_thrax',
      turn: 3,
      source: 'spy',
      text: 'Donatives leave the Rhineland chest unrecorded.',
      natureHint: 'Bribery among the northern cohorts.',
      advancesNature: true,
    });
    knowledge = [
      ...knowledge,
      makeKnowledgeClaim({
        id: 'claim_obs_1',
        subject: 'maximinus_thrax',
        claimKey: 'investigation:maximinus_thrax:beliefs',
        firstLearnedTurn: 4,
        updates: [{ turn: 4, source: 'spy', text: 'Thrax relies closely on Vitalianus.' }],
        relationshipObservation: {
          evidenceId: 'ev1',
          participantIds: ['maximinus_thrax', 'vitalianus'],
        },
      }),
    ];

    board = deriveSchemeBoard(knowledge, [poisonedEntity, accomplice], 'player_1');
    expect(board.leads[0].stage).toBe('trail');
    expect(board.leads[0].clueCount).toBe(1);
    expect(board.leads[0].linkedFigures.map(f => f.entityId)).toEqual(['vitalianus']);

    const hypothesis = evaluateDeductionHypothesis(board, 'maximinus_thrax', 'vitalianus');
    expect(hypothesis.connected).toBe(true);
    expect(hypothesis.supportingTurns).toEqual([4]);

    // 3. Remaining paid clues unmask nature once threshold is reached.
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
    expect(JSON.stringify(board)).not.toContain('SENTINEL');
  });
});
