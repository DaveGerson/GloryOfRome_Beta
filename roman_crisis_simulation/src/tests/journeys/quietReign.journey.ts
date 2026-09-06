/**
 * tests/journeys/quietReign.journey.ts
 *
 * A quiet reign: three turns of ordinary governance through the REAL
 * runNewTurn pipeline, no deaths, one consequential oration in the middle.
 *
 * Story-specific guards (the six catalog invariants run every turn for free
 * - see tests/journeys/harness.ts):
 *  - treasury + directional relationship ACCUMULATE across turns (ground
 *    truth threaded turn-over-turn) - the relationship accumulates as GROUND
 *    TRUTH ONLY (runner.rel(...) assertions), while the player's perceived
 *    digest withholds relation mechanics entirely (buildPlayerPerceivedDigest);
 *  - a non-consequential turn rolls NO dice; the consequential oration rolls
 *    EXACTLY one, and its pre-decided TIER (not the model) reaches the
 *    adjudication prompt and the GM resolutionTrace - never a player surface;
 *  - an OFF-NETWORK senator's finances (and their whole scheme) commit as
 *    ground truth yet stay invisible in the player's perceived digest and
 *    knowledge store for the entire journey (D5 asymmetry across a campaign,
 *    not one delta).
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner, scriptedJsonArray } from './harness';
import {
  scriptAdjudication,
  scriptAssessmentConsequential,
  resourceDelta,
  relationDelta,
} from './fixtures';

const PLAYER = 'severus_alexander';
const SENATE = 'roman_senate';
const MAGNUS = 'gaius_pontius_magnus'; // at The Curia, NOT in the player's visibility_network -> off-network

/**
 * D46: the steward closes the player's books every week AFTER the
 * adjudication commits - estate yields in, wages out - so the treasury
 * moves by the scripted delta PLUS the week's booked net. The lines ride
 * the history entry; summing them here keeps the journey honest about the
 * arithmetic without hard-coding the pay tables.
 */
const weekNet = (entry: { ledger?: Array<{ key: string; amount: number }> }): number =>
  (entry.ledger ?? []).filter(line => line.key === 'denarii').reduce((sum, line) => sum + line.amount, 0);

describe('journey: a quiet reign (3 turns of ordinary governance)', () => {
  it('accumulates treasury/relationships, rolls dice only when consequential, and keeps an off-network senator invisible all journey', async () => {
    const runner = new JourneyRunner({ name: 'quietReign' });

    // Baseline ground truth from the real scenario.
    expect(runner.player().resources.denarii).toBe(50000);
    expect(runner.entity(MAGNUS).resources.denarii).toBe(250000);
    expect(runner.rel(SENATE, PLAYER)?.trust_level).toBe(6);

    // --- Turn 1: hold court (non-consequential) ---------------------------
    const t1 = await runner.runTurn({
      intent: 'Hold court on the Palatine and hear the petitions of the city.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(1, {
          deltas: [
            resourceDelta(PLAYER, 'denarii', 2000, 'Tax receipts arrive from the provinces.'),
            // Off-network senator quietly moves money - ground truth commits, player cannot see it.
            resourceDelta(MAGNUS, 'denarii', -5000, 'Magnus quietly funds a bloc of loyal senators.'),
            relationDelta(SENATE, PLAYER, 'trust_level', 2, 'The Conscript Fathers warm to the young Emperor.'),
          ],
          headlines: ['The Emperor holds court; the business of the city proceeds quietly.'],
        }),
        relationshipObservations: scriptedJsonArray([{
          evidenceId: 'player-submission',
          participantIds: [PLAYER, SENATE],
          excerpt: 'Hold court on the Palatine and hear the petitions of the city.',
        }]),
      },
    });

    // No dice on a non-consequential turn.
    expect(t1.entry.resolutionTrace).toBeUndefined();
    expect(t1.entry.mortalityTrace).toBeUndefined();
    // Exactly the mandatory stages fired - no minds, no private meeting, no mortality.
    expect(t1.stages).toEqual([
      'story_relevance', 'adjudication', 'simulation_state', 'monologue', 'narration',
    ]);

    // Ground truth committed for BOTH the player and the off-network senator.
    // The Emperor's week closes at a loss: two estates yield less than a
    // Praetorian household and three agents cost (D46 ledger) - the
    // scripted tax receipts land on top of that booked net.
    expect(t1.entry.ledger?.map(line => line.kind)).toEqual(expect.arrayContaining(['income', 'upkeep']));
    expect(weekNet(t1.entry)).toBeLessThan(0);
    expect(runner.player().resources.denarii).toBe(52000 + weekNet(t1.entry));
    // The ledger is the PLAYER's alone (D5/D6): the senator's purse moves by
    // the scripted delta and nothing else.
    expect(runner.entity(MAGNUS).resources.denarii).toBe(245000);
    expect(runner.rel(SENATE, PLAYER)?.trust_level).toBe(8);

    // The player PERCEIVES their own gain ('self')...
    expect(t1.digest.some(c => c.source === 'self' && /denarii grows/i.test(c.text))).toBe(true);
    // ...but production's player digest (buildPlayerPerceivedDigest) withholds relation
    // mechanics from player intelligence - another mind's warming is never directly legible;
    // this now asserts what production actually produces.
    expect(t1.digest.every(c => c.deltaType !== 'relation')).toBe(true);
    expect(t1.digestTexts.join('\n')).not.toMatch(/Senate/i);
    // ...and NEVER the off-network senator's move (invisible in digest AND knowledge store).
    expect(t1.digestTexts.join('\n')).not.toContain('Gaius Pontius');
    expect(JSON.stringify(t1.knowledge)).not.toContain('Gaius Pontius');

    // The player's own submission still yields a relationship-observation
    // knowledge claim (D29/D30's observation wiring), independent of the
    // withheld relation-mechanic delta above.
    expect(t1.knowledge).toContainEqual(expect.objectContaining({
      claim: 'Hold court on the Palatine and hear the petitions of the city.',
      topic: 'relationship-observation',
      relationshipObservation: expect.objectContaining({ evidenceId: 'turn:1:player-submission' }),
    }));

    // --- Turn 2: a consequential oration ----------------------------------
    // total = roll(13) + oratory(7) + personality(oratory->ambition 5, +0) + opposition(0) = 20; margin = 20-14 = 6 -> 'success'.
    const t2 = await runner.runTurn({
      intent: 'Deliver a rousing oration to the Senate to shore up their loyalty.',
      rolls: [13],
      script: {
        assessment: scriptAssessmentConsequential({
          category: 'oratory persuasion',
          skill: 'oratory',
          difficulty: 14,
          rationale: 'A bold public appeal with the whole Curia watching.',
        }),
        adjudication: scriptAdjudication(2, {
          // +1 keeps the running trust below the engine's -10..10 clamp so the
          // accumulation reads cleanly turn-over-turn (6 -> 8 -> 9).
          deltas: [relationDelta(SENATE, PLAYER, 'trust_level', 1, 'The oration lands; the Curia applauds.')],
          headlines: ['The Emperor addresses the Senate to warm applause.'],
        }),
      },
    });

    // Exactly one roll, and its pre-decided outcome is recorded GM-side only.
    expect(t2.entry.resolutionTrace).toBeDefined();
    expect(t2.entry.resolutionTrace!.roll).toBe(13);
    expect(t2.entry.resolutionTrace!.tier).toBe('success');
    // The pre-decided TIER (code's, not the model's) reached the adjudication
    // prompt - the pre-decided-outcome contract (code decides, model narrates).
    const adjPrompt = t2.client.promptsFor('adjudication')[0];
    expect(adjPrompt).toContain('PLAYER ACTION OUTCOME');
    expect(adjPrompt).toContain('SUCCESS');
    expect(adjPrompt).toContain('oratory persuasion');
    // A [Resolution] GM note exists on the committed entry (INV-LEAK already
    // proved it did not reach any player surface).
    expect(t2.entry.adjudication.gm_private.some(n => n.startsWith('[Resolution]'))).toBe(true);

    expect(runner.rel(SENATE, PLAYER)?.trust_level).toBe(9);

    // --- Turn 3: a quiet close (non-consequential) ------------------------
    const t3 = await runner.runTurn({
      intent: 'Review the treasury accounts and retire early.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(3, {
          deltas: [
            resourceDelta(PLAYER, 'denarii', 1000, 'A frugal week; the accounts hold.'),
            resourceDelta(MAGNUS, 'denarii', -3000, 'Magnus keeps buying quiet loyalty in the Curia.'),
          ],
          headlines: ['A quiet week closes over the seven hills.'],
        }),
      },
    });

    expect(t3.entry.resolutionTrace).toBeUndefined();

    // Final accumulated ground truth across the whole reign: three scripted
    // receipts and three weekly closings, every one of them booked on its
    // own history entry (a quiet week with no scripted coin still pays wages).
    expect(weekNet(t2.entry)).toBe(weekNet(t1.entry));
    expect(runner.player().resources.denarii).toBe(53000 + weekNet(t1.entry) + weekNet(t2.entry) + weekNet(t3.entry));
    expect(runner.entity(MAGNUS).resources.denarii).toBe(242000);
    expect(runner.rel(SENATE, PLAYER)?.trust_level).toBe(9);

    // The off-network senator stayed invisible in the digest EVERY turn while
    // his finances and his whole scheme moved as ground truth.
    for (const outcome of runner.outcomes) {
      expect(outcome.digestTexts.join('\n')).not.toContain('Gaius Pontius');
    }
    expect(runner.entity(MAGNUS).active_scheme?.name).toBe('Restoration of the Republic'); // still ground truth
  });
});
