/**
 * tests/journeys/mortalityFates.journey.ts
 *
 * The mortality pipeline across a campaign (D2/D3/D4): an assassination the
 * player SURVIVES, a hallucinated death the validator VETOES, an NPC PRESUMED
 * DEAD (publicly dead, secretly alive), and finally the player's own death
 * ending the run (D1).
 *
 * Story-specific guards (catalog invariants run every turn for free):
 *  - every death that sticks = validation + a hidden roll; a VETOED claim
 *    never touches the dice and preserves the entity's prior status;
 *  - the validator's reasoning, the fate band, and a presumed-dead NPC's
 *    secret_truth/motive stay off EVERY player surface (INV-LEAK), while the
 *    public record (status 'dead') is what the player perceives;
 *  - the presumed-dead double bookkeeping: the world sees 'dead', the GM sees
 *    secret_truth.actually_alive - held on the committed entity, never leaked;
 *  - the player's death ends the run (gameOver, D1).
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner } from './harness';
import {
  scriptAdjudication,
  scriptMortalityValidation,
  scriptMortalityOutcome,
  statusDelta,
} from './fixtures';

const PLAYER = 'severus_alexander';
const THRAX = 'maximinus_thrax'; // in the player's visibility_network
const MAGNUS = 'gaius_pontius_magnus';

describe('journey: mortality and fates (survive, veto, presumed-dead, game over)', () => {
  it('sticks deaths only via validation + hidden dice, keeps a presumed-dead NPC secretly alive, and ends the run on the player\'s death', async () => {
    const runner = new JourneyRunner({ name: 'mortalityFates' });

    // --- Turn 1: an assassination the player SURVIVES ---------------------
    // Player death save roll 14 -> 'survive' band (11-17): no outcome content.
    const t1 = await runner.runTurn({
      intent: 'Hold a public audience despite the whispers of a plot.',
      rolls: [14],
      script: {
        adjudication: scriptAdjudication(1, {
          deltas: [statusDelta(PLAYER, 'dead', 'An assassin lunges at the Emperor during the audience.')],
          headlines: ['A blade flashes in the imperial hall.'],
        }),
        mortalityValidation: scriptMortalityValidation([
          { entity_id: PLAYER, valid: true, reasoning: 'A genuine attempt on the Emperor\'s life this turn.' },
        ]),
      },
    });

    expect(t1.stages).toContain('mortality');
    expect(t1.playerAfter.status).toBe('alive'); // survived the save
    expect(t1.gameOver).toBe(false);
    // A validated death claim resolved to a survival band via one hidden roll,
    // with NO outcome-content call (the 'survive' band needs none).
    expect(t1.entry.mortalityTrace).toHaveLength(1);
    expect(t1.entry.mortalityTrace![0]).toMatchObject({ entity_id: PLAYER, valid: true, band: 'survive', roll: 14 });
    expect(t1.client.calls.some(c => c.kind === 'mortalityValidation')).toBe(true);
    expect(t1.client.calls.some(c => c.kind === 'mortalityOutcome')).toBe(false);

    // --- Turn 2: a hallucinated death the validator VETOES ----------------
    const VETO_REASONING = 'No poisoner was anywhere near Magnus this turn; the death is pure invention.';
    const t2 = await runner.runTurn({
      intent: 'Receive the senators and hear the news of the city.',
      rolls: [], // an invalidated claim never reaches the dice
      script: {
        adjudication: scriptAdjudication(2, {
          deltas: [statusDelta(MAGNUS, 'dead', 'A wild rumor has Magnus poisoned at a banquet.')],
          headlines: ['Dark talk swirls around the senator Magnus.'],
        }),
        mortalityValidation: scriptMortalityValidation([
          { entity_id: MAGNUS, valid: false, reasoning: VETO_REASONING },
        ]),
      },
    });

    expect(t2.stages).toContain('mortality');
    // The veto preserved Magnus's prior status; no dice were touched.
    expect(runner.entity(MAGNUS).status).toBe('alive');
    expect(t2.entry.mortalityTrace).toHaveLength(1);
    expect(t2.entry.mortalityTrace![0]).toMatchObject({ entity_id: MAGNUS, valid: false });
    expect(t2.entry.mortalityTrace![0].roll).toBeUndefined();
    // The GM-only veto reasoning is recorded GM-side (mortalityTrace) but INV-LEAK
    // already proved it reached no player surface; assert the seam explicitly.
    expect(t2.entry.mortalityTrace![0].outcomeSummary).toContain(VETO_REASONING);
    expect(t2.client.promptsFor('narration')[0]).not.toContain(VETO_REASONING);
    expect(t2.client.promptsFor('narration')[0]).not.toContain('Death claim invalidated');

    // --- Turn 3: Thrax PRESUMED DEAD (publicly dead, secretly alive) ------
    // NPC fate roll 17 -> 'presumed_dead' band (16-18): needs an outcome call.
    const SECRET_MOTIVE = 'Feigns death to raise the frontier legions and return as an open usurper.';
    const t3 = await runner.runTurn({
      intent: 'Send trusted men to learn the truth of the Praetorian camp.',
      rolls: [17],
      script: {
        adjudication: scriptAdjudication(3, {
          deltas: [statusDelta(THRAX, 'dead', 'Thrax is cut down in a sudden Praetorian mutiny.')],
          headlines: ['Word comes that the Thracian general has fallen in the camp.'],
        }),
        mortalityValidation: scriptMortalityValidation([
          { entity_id: THRAX, valid: true, reasoning: 'The mutiny was real and bloody.' },
        ]),
        mortalityOutcome: scriptMortalityOutcome([
          {
            entity_id: THRAX,
            deltas: [],
            narrative_directive: 'Narrate the mutiny and his apparent death as the city will believe it. Do not hint at survival.',
            secret_motive: SECRET_MOTIVE,
          },
        ]),
      },
    });

    expect(t3.client.calls.some(c => c.kind === 'mortalityOutcome')).toBe(true);
    // PUBLIC record: the world (and the player) believe Thrax is dead...
    expect(runner.entity(THRAX).status).toBe('dead');
    expect(t3.entry.mortalityTrace![0]).toMatchObject({ entity_id: THRAX, valid: true, band: 'presumed_dead', roll: 17 });
    expect(t3.digest.some(c => c.source === 'network' && /Maximinus Thrax is now dead/i.test(c.text))).toBe(true);
    // ...but the GM-only secret_truth says otherwise, held on the committed entity.
    const thraxSecret = runner.entity(THRAX).secret_truth;
    expect(thraxSecret).toBeDefined();
    expect(thraxSecret!.actually_alive).toBe(true);
    expect(thraxSecret!.motive).toBe(SECRET_MOTIVE);
    // The secret motive and the presumed_dead band never touch a player surface.
    expect(t3.client.promptsFor('narration')[0]).not.toContain(SECRET_MOTIVE);
    expect(t3.client.promptsFor('narration')[0]).not.toContain('presumed_dead');
    expect(t3.digestTexts.join('\n')).not.toContain(SECRET_MOTIVE);
    expect(JSON.stringify(t3.knowledge)).not.toContain(SECRET_MOTIVE);

    // --- Turn 4: the player's death ENDS the run (D1) ---------------------
    // Player death save roll 3 -> 'dies' band (1-5).
    const t4 = await runner.runTurn({
      intent: 'Ride out to the camp to face the mutineers in person.',
      rolls: [3],
      script: {
        adjudication: scriptAdjudication(4, {
          deltas: [statusDelta(PLAYER, 'dead', 'The mutineers close in and the Emperor is struck down.')],
          headlines: ['The Emperor rides to the camp.'],
        }),
        mortalityValidation: scriptMortalityValidation([
          { entity_id: PLAYER, valid: true, reasoning: 'Surrounded and outnumbered, the death is earned.' },
        ]),
      },
    });

    expect(t4.entry.mortalityTrace![0]).toMatchObject({ entity_id: PLAYER, valid: true, band: 'dies', roll: 3 });
    expect(t4.playerAfter.status).toBe('dead');
    expect(t4.gameOver).toBe(true); // D1 - the run ends
  });
});
