/**
 * tests/journeys/openAndSecretTies.journey.ts
 *
 * D49 across a campaign: affiliations are openly professed or kept secret.
 * The base cast carries both - the Emperor (the player) keeps the state cult
 * openly and a private devotion secretly; his mother keeps a quiet sympathy
 * for the circle of Origen.
 *  - Turn 1: his mother's mind runs. It sees its OWN secret tie and the
 *    Emperor's OPEN one - never his secret (INV-LEAK now scans every
 *    NPC-facing prompt for the player's secret ties). Far away, Thrax
 *    secretly takes up a tie no one sees; in the Curia, Magnus openly
 *    becomes a booster of the triumph - public knowledge.
 *  - Turn 2: in the Emperor's own hall his mother is seen at a secret rite -
 *    witnessed, so it becomes knowledge the player holds.
 *  - Turn 3: Magnus exposes the Emperor's secret devotion - the world acting
 *    on the player on a turn he merely held court; the tie is public now.
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner } from './harness';
import {
  scriptAdjudication,
  scriptNpcMind,
  scriptStoryRelevance,
} from './fixtures';
import { knownAffiliationsOf } from '../../knowledge/store';
import type { EventDelta } from '../../types';

const PLAYER = 'severus_alexander';
const JULIA = 'julia_mamaea';
const THRAX = 'maximinus_thrax';
const MAGNUS = 'gaius_pontius_magnus';

function affiliationDelta(key: string, affiliation: EventDelta['affiliation'], reason: string, extra: Partial<EventDelta> = {}): EventDelta {
  return { type: 'affiliation', key, delta: 0, reason, affiliation, ...extra };
}

describe('journey: ties openly professed and kept secret (D49)', () => {
  it('keeps a secret tie its holder\'s alone until witnessed or exposed, and makes an open one public knowledge', async () => {
    const runner = new JourneyRunner({ name: 'openAndSecretTies' });

    // --- Turn 1: a mind's view; one secret tie far away, one open ----------
    const t1 = await runner.runTurn({
      intent: 'Receive my mother in the atrium and speak of the Guard.',
      script: {
        storyRelevance: scriptStoryRelevance(
          [{ entity_id: JULIA, reason: 'The regent weighs her son\'s danger.' }],
          [{ entity_id: JULIA, intent: 'Keep the Guard from the general', continuity: 'new' }],
        ),
        npcMind: scriptNpcMind({
          entity_id: JULIA,
          chosen_action: 'Counsel patience and a donative.',
          method: 'Softly, over the evening meal.',
          private_reasoning: 'He must not see how frightened I am.',
        }),
        adjudication: scriptAdjudication(1, {
          deltas: [
            affiliationDelta(`${THRAX}:guard_conspirators`, { change: 'join', name: 'the Guard\'s conspirators', kind: 'faction', public: false }, 'Thrax swears himself to the plotters in the camp.'),
            affiliationDelta(`${MAGNUS}:boosters_of_the_triumph`, { change: 'join', name: 'the boosters of the triumph', kind: 'cause', public: true }, 'Magnus declares for a triumph on the Rhine.'),
          ],
        }),
      },
    });

    const mind = t1.client.promptsFor('npcMind')[0];
    expect(mind).toContain('Your ties: the circle of Origen (religion; KEPT SECRET');
    expect(mind).toContain('openly of the gods of the Roman state (religion)');
    expect(mind).not.toContain('the sages of his private lararium');
    // The adjudicator, the omniscient GM, sees the player's secret - marked.
    expect(t1.client.promptsFor('adjudication')[0]).toContain("the sages of his private lararium (handle 'sages_of_his_private_lararium'; religion; SECRET");
    expect(runner.entity(THRAX).affiliations?.map(tie => [tie.id, tie.public])).toEqual([
      ['cause_of_the_frontier_legions', true],
      ['guard_conspirators', false],
    ]);
    expect(t1.digestTexts).toContain('Gaius Pontius Magnus is now openly of the boosters of the triumph.');
    expect(t1.digest.find(change => change.deltaType === 'affiliation')?.source).toBe('public');
    expect(t1.digestTexts.join('\n')).not.toContain('conspirators');

    // --- Turn 2: a secret rite in the Emperor's own hall -------------------
    const t2 = await runner.runTurn({
      intent: 'Keep vigil in the palace tonight.',
      script: {
        adjudication: scriptAdjudication(2, {
          deltas: [
            affiliationDelta(`${JULIA}:mysteries_of_isis`, { change: 'join', name: 'the mysteries of Isis', kind: 'cult', public: false }, 'By lamplight the regent is initiated in a palace chamber.'),
          ],
        }),
      },
    });

    expect(t2.digestTexts).toContain('You glimpse Julia Mamaea among the mysteries of Isis, in secret.');
    expect(t2.digest[0].source).toBe('witnessed');
    expect(knownAffiliationsOf(t2.knowledge, JULIA)).toEqual([
      { id: 'mysteries_of_isis', name: 'the mysteries of Isis', kind: 'cult', public: false, member: true },
    ]);
    // Her older secret, never witnessed, is still not the player's to know.
    expect(JSON.stringify(t2.knowledge)).not.toContain('circle of Origen');

    // --- Turn 3: the player's own secret is exposed ------------------------
    const t3 = await runner.runTurn({
      intent: 'Hold court on the Palatine.',
      script: {
        adjudication: scriptAdjudication(3, {
          deltas: [
            affiliationDelta(`${PLAYER}:sages_of_his_private_lararium`, { change: 'expose' }, 'Magnus reads to the Senate a list of the images in the Emperor\'s chapel.', { origin_id: MAGNUS }),
          ],
          headlines: ['A senator names the images in the Emperor\'s private chapel.'],
        }),
      },
    });

    expect(t3.playerAfter.affiliations?.find(tie => tie.id === 'sages_of_his_private_lararium')?.public).toBe(true);
    expect(t3.digestTexts).toContain('Your hidden tie to the sages of his private lararium stands exposed.');
  });
});
