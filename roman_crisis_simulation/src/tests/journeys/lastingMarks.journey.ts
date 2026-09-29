/**
 * tests/journeys/lastingMarks.journey.ts
 *
 * D48 across a campaign: the narration is the game's state.
 *  - Turn 1: the Emperor survives an attempt on his life WITH A LOSS - the
 *    outcome call's loss is a condition (a knife scar) and a removed hard
 *    asset (denarii), both committed as validated deltas; the band itself is
 *    recorded nowhere but the GM trace, and no "none was authored" note
 *    fires. The player learns of both in their own dispatches.
 *  - Turn 2: the adjudicator now weighs the scar (it rides the PLAYER
 *    CHARACTER block) and the narration is told of it. Julia Mamaea, in the
 *    same hall, takes an outward burn the player witnesses and an inward
 *    mark (nightmares) the player never learns of - INV-LEAK forbids its
 *    account on every player surface.
 *  - Turn 3: her burn heals; the player sees it go, and Personae's read
 *    model no longer lists it.
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner } from './harness';
import {
  scriptAdjudication,
  scriptMortalityValidation,
  scriptMortalityOutcome,
  resourceDelta,
  statusDelta,
} from './fixtures';
import { perceivedConditionsOf } from '../../knowledge/store';
import type { EventDelta } from '../../types';

const PLAYER = 'severus_alexander';
const JULIA = 'julia_mamaea'; // on the Palatine with the Emperor

const NIGHTMARES = 'She dreams of the camp fires and wakes with a knife in her hand.';

function conditionDelta(key: string, condition: EventDelta['condition'], reason: string): EventDelta {
  return { type: 'condition', key, delta: 0, reason, condition };
}

describe('journey: lasting marks (D48)', () => {
  it('commits a loss band\'s loss as a condition and a removed asset, weighs the mark after, and keeps an inward mark its bearer\'s alone', async () => {
    const runner = new JourneyRunner({ name: 'lastingMarks' });
    const denariiBefore = runner.entity(PLAYER).resources.denarii as number;

    // --- Turn 1: survives with a loss (roll 8 -> survive_with_loss) --------
    const t1 = await runner.runTurn({
      intent: 'Walk among the petitioners in the atrium without the Guard.',
      rolls: [8],
      script: {
        adjudication: scriptAdjudication(1, {
          deltas: [statusDelta(PLAYER, 'dead', 'A petitioner draws a blade on the Emperor in the atrium.')],
          headlines: ['A blade is drawn in the imperial atrium.'],
        }),
        mortalityValidation: scriptMortalityValidation([
          { entity_id: PLAYER, valid: true, reasoning: 'A real attempt, close and unguarded.' },
        ]),
        mortalityOutcome: scriptMortalityOutcome([{
          entity_id: PLAYER,
          deltas: [
            conditionDelta(`${PLAYER}:knife_scar`, { change: 'add', name: 'a knife scar', description: 'A pale seam along the left forearm.', outward: true, severity: 'serious' }, 'The blade opened his arm before the guards arrived.'),
            resourceDelta(PLAYER, 'denarii', -2000, 'Gold pressed on the physicians and the silent.'),
          ],
          narrative_directive: 'He lives, his arm laid open; the price of silence is paid in gold.',
        }]),
      },
    });

    expect(t1.entry.mortalityTrace![0]).toMatchObject({ entity_id: PLAYER, valid: true, band: 'survive_with_loss', roll: 8 });
    expect(t1.playerAfter.status).toBe('alive');
    expect(t1.playerAfter.conditions).toEqual([
      { id: 'knife_scar', name: 'a knife scar', description: 'A pale seam along the left forearm.', outward: true, severity: 'serious', since_turn: 1 },
    ]);
    expect(t1.playerAfter.resources.denarii).toBe(denariiBefore - 2000);
    // The loss was authored, so the tuning note stays quiet; the band is a
    // GM trace, never a state on the entity.
    expect(t1.entry.adjudication.gm_private.some(note => note.includes('none was authored'))).toBe(false);
    expect(JSON.stringify(t1.playerAfter)).not.toContain('survive_with_loss');
    expect(t1.digestTexts).toContain('You bear a new mark: a knife scar.');
    expect(t1.digestTexts).toContain('Your denarii dwindles.');

    // --- Turn 2: the mark is weighed; Julia's two marks -------------------
    const t2 = await runner.runTurn({
      intent: 'Sit with my mother and plan the week in the palace.',
      script: {
        adjudication: scriptAdjudication(2, {
          deltas: [
            conditionDelta(`${JULIA}:burned_hand`, { change: 'add', name: 'a burned hand', description: 'Bandaged from wrist to knuckle.', outward: true, severity: 'light' }, 'A brazier overturned in the audience hall.'),
            conditionDelta(`${JULIA}:nightmares`, { change: 'add', name: 'nightmares', description: NIGHTMARES, outward: false, severity: 'serious' }, 'The attempt on her son follows her into sleep.'),
          ],
          headlines: ['A brazier overturns in the palace.'],
        }),
      },
    });

    const adjudicationPrompt = t2.client.promptsFor('adjudication')[0];
    expect(adjudicationPrompt).toContain("Lasting marks the player bears (weigh them when resolving the player's attempt): a knife scar (handle 'knife_scar'; serious; outward");
    expect(t2.client.promptsFor('narration')[0]).toContain('LASTING MARKS THE PLAYER BEARS');
    expect(runner.entity(JULIA).conditions?.map(mark => mark.id)).toEqual(['burned_hand', 'nightmares']);
    expect(t2.digestTexts).toContain('Julia Mamaea now bears a mark: a burned hand.');
    expect(t2.digestTexts.join('\n')).not.toMatch(/nightmares/i);
    expect(perceivedConditionsOf(t2.knowledge, JULIA).map(mark => mark.name)).toEqual(['a burned hand']);
    expect(JSON.stringify(t2.knowledge)).not.toContain(NIGHTMARES);

    // --- Turn 3: the burn heals, in the player's sight ----------------------
    const t3 = await runner.runTurn({
      intent: 'Hold court on the Palatine.',
      script: {
        adjudication: scriptAdjudication(3, {
          deltas: [conditionDelta(`${JULIA}:burned_hand`, { change: 'heal' }, 'The bandages come off.')],
        }),
      },
    });

    expect(t3.digestTexts).toContain('Julia Mamaea no longer shows a burned hand.');
    expect(perceivedConditionsOf(t3.knowledge, JULIA)).toEqual([]);
    expect(runner.entity(JULIA).conditions?.map(mark => mark.id)).toEqual(['nightmares']);
  });
});
