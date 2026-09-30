/**
 * tests/journeys/composure.journey.ts
 *
 * D50 across the REAL turn pipeline: "roll, then model".
 *  - Turn 1: Julia Mamaea stands in the palace with the Emperor, and a burn
 *    she takes there is witnessed - so she is present in the week's
 *    narration. She bears an inward mark and keeps a secret faith; each gets
 *    one composure d20 from the turn's generator, straight after the (here
 *    absent) action and mortality rolls. Scripted: the mark FRAYS, the faith
 *    HOLDS. The narrator is told the fraying mark by name - never its
 *    account - and nothing at all of the faith. The narration's signs are
 *    screened: the one for the fraying mark stands and lands on Julia's card
 *    as a sign seen, figure and sentence only; the one for the faith that
 *    held is dropped. The seed replays the composure draws.
 *  - Turn 2: nobody is present - nobody rolls.
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner } from './harness';
import { scriptAdjudication, scriptNarration } from './fixtures';
import { signsSeenOf } from '../../knowledge/store';
import { replayTurnDraws } from '../../ai/core/turnReplay';
import { tabChangeCountsFor } from '../../hooks/usePlayerPerception';
import type { EventDelta } from '../../types';

const JULIA = 'julia_mamaea'; // on the Palatine with the Emperor; cunning 8, paranoia 7
const MARK_NAME = 'JULIA_INWARD_MARK_SENTINEL';
const MARK_ACCOUNT = 'JULIA_MARK_ACCOUNT_SENTINEL: she wakes before dawn, listening for the Guard.';
const SIGN = 'Her voice caught when the Guard was named.';

describe('journey: composure (D50)', () => {
  it('rolls the composure of the figures present, tells the narrator only what frayed or broke, and keeps a sign as a sign', async () => {
    const runner = new JourneyRunner({ name: 'composure' });
    runner.thread.entities = runner.thread.entities.map(entity => entity.entity_id === JULIA
      ? { ...entity, conditions: [{ id: 'dread_of_the_guard', name: MARK_NAME, description: MARK_ACCOUNT, outward: false, severity: 'serious', since_turn: 0 }] }
      : entity);

    const burn: EventDelta = {
      type: 'condition', key: `${JULIA}:burned_hand`, delta: 0, reason: 'A brazier overturned in the audience hall.',
      condition: { change: 'add', name: 'a burned hand', description: 'Bandaged from wrist to knuckle.', outward: true, severity: 'light' },
    };
    const t1 = await runner.runTurn({
      intent: 'Sit with my mother and plan the week in the palace.',
      // Julia's modifiers: +1.5 for her mark (cunning), +2 for her secret
      // faith (cunning and paranoia). Mark: 5 + 1.5 vs serious 10 -> frays.
      // Faith: 18 + 2 vs religion 9 -> holds.
      composureRolls: [5, 18],
      script: {
        adjudication: scriptAdjudication(1, { deltas: [burn], headlines: ['A brazier overturns in the palace.'] }),
        narration: {
          ...scriptNarration('The hall smells of scorched cloth. Julia Mamaea binds her hand and does not look at the door.', [
            'Summon the physician', 'Question the Guard', 'Keep your mother close',
          ]),
          signs: [
            { entity: JULIA, handle: 'c1', sign: SIGN },
            // No such cue: the faith held, so the narrator was given no handle for it.
            { entity: JULIA, handle: 'c2', sign: 'She murmured a prayer under her breath.' },
          ],
        },
      },
    });

    // The rolls: GM-side, one per hidden subject, in record order.
    expect(t1.entry.composureRolls).toEqual([{
      entityId: JULIA, entityName: 'Julia Mamaea',
      rolls: [
        expect.objectContaining({ subjectKind: 'mark', subjectId: 'dread_of_the_guard', roll: 5, modifier: 1.5, difficulty: 10, tier: 'frays' }),
        expect.objectContaining({ subjectKind: 'tie', subjectId: 'circle_of_origen', roll: 18, modifier: 2, difficulty: 9, tier: 'holds' }),
      ],
    }]);
    // The turn's one seed replays them, after everything else it drew.
    const replay = replayTurnDraws(t1.entry);
    expect(replay.allMatch).toBe(true);
    expect(replay.draws.map(draw => draw.label)).toEqual([
      `Composure · Julia Mamaea · ${MARK_NAME}`,
      'Composure · Julia Mamaea · the circle of Origen',
    ]);

    // The narrator: what frayed, by name and tier, under an opaque handle;
    // what showed outwardly; never the mark's account, never the faith that held.
    const narrationPrompt = t1.client.promptsFor('narration')[0];
    expect(narrationPrompt).toContain('COMPOSURE OF THE FIGURES AT HAND');
    expect(narrationPrompt).toContain(`- handle "c1": "Julia Mamaea" (entity "${JULIA}") - frays - a mark borne inwardly: "${MARK_NAME}" (serious)`);
    expect(narrationPrompt).toContain('MARKS THAT SHOW ON THE FIGURES AT HAND');
    expect(narrationPrompt).toContain('"a burned hand (light)"');
    for (const hidden of [MARK_ACCOUNT, 'circle of Origen', 'circle_of_origen', 'dread_of_the_guard', '"c2"']) {
      expect(narrationPrompt).not.toContain(hidden);
    }

    // The signs: the fraying mark's stands, GM-side with its subject; the
    // player keeps only the figure and the sentence.
    expect(t1.entry.composureSigns).toEqual([{ entityId: JULIA, subject: 'dread_of_the_guard', sign: SIGN }]);
    expect(signsSeenOf(t1.knowledge, JULIA)).toEqual([{ text: SIGN, turn: 1 }]);
    const signClaims = JSON.stringify(t1.knowledge.filter(claim => claim.claimKey.startsWith('sign:')));
    for (const hidden of [MARK_NAME, MARK_ACCOUNT, 'dread_of_the_guard', 'Origen', 'prayer']) {
      expect(signClaims).not.toContain(hidden);
    }
    // The Personae coin counts the sign the committed week brought.
    expect(tabChangeCountsFor(t1.digest, t1.knowledge, t1.entry).get('dramatis_personae')).toBe(1);

    // --- Turn 2: nobody present, nobody rolls --------------------------------
    const t2 = await runner.runTurn({ intent: 'Read the dispatches alone.' });
    expect(t2.entry.composureRolls).toBeUndefined();
    expect(t2.entry.composureSigns).toBeUndefined();
    expect(t2.client.promptsFor('narration')[0]).not.toContain('COMPOSURE OF THE FIGURES AT HAND');
    expect(signsSeenOf(t2.knowledge, JULIA)).toEqual([{ text: SIGN, turn: 1 }]);
  });
});
