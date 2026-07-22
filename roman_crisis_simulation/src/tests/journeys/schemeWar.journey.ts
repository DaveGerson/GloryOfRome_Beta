/**
 * tests/journeys/schemeWar.journey.ts
 *
 * A scheme-and-rumor journey exercising the Phase-4 machinery the unit suite
 * proves only in isolation, threaded through a real multi-turn playthrough:
 * the truth ledger vs. believed-world divergence, an NPC MIND evolving its
 * own scheme (D30), D28 perception of a scheme as only "something afoot", and
 * the paid-investigation CLUE GATE that earns a scheme's nature instead of
 * dumping it.
 *
 * Story-specific guards (catalog invariants run every turn for free):
 *  - a planted rumor lives ONLY as a sub-1.0, source-attributed Report + a
 *    GM-only truth-ledger entry; no entity's real resources/status move to
 *    match it, and its is_true/origin_id never reach a player surface;
 *  - one spotlight fires the npc_minds stage but NOT the private conversation;
 *  - the spotlight's mind evolves ITS OWN active_scheme (ground truth), which
 *    the player perceives only as "You sense X is plotting something" - never
 *    the scheme's name or steps;
 *  - the D28 clue gate: proximity awareness never advances the nature count,
 *    ONE paid scheme investigation is insufficient, and the nature is revealed
 *    only after SCHEME_CLUES_TO_REVEAL paid clues accrete - earned, not dumped;
 *  - an investigation rolls a HIDDEN die code-side and the failure-consequence
 *    contract is code-enforced (scripted null -> substituted default).
 */

import { describe, it, expect } from 'vitest';
import { JourneyRunner, runScriptedInvestigation } from './harness';
import { SCHEME_CLUES_TO_REVEAL } from '../../knowledge/store';
import {
  scriptAdjudication,
  scriptStoryRelevance,
  scriptNpcMind,
  scriptInvestigation,
  rumorDelta,
  relationDelta,
} from './fixtures';

const PLAYER = 'severus_alexander';
const THRAX = 'maximinus_thrax'; // in the player's visibility_network -> scheme perceptible as 'something afoot'

describe('journey: a war of schemes and rumors (minds + planting + the clue gate)', () => {
  it('plants a rumor that never becomes ground truth, evolves a mind-owned scheme, and earns its nature only through accreted paid clues', async () => {
    const runner = new JourneyRunner({ name: 'schemeWar' });

    const thraxLegionSupportBefore = runner.entity(THRAX).resources.legion_support;
    const thraxSchemeName = runner.entity(THRAX).active_scheme!.name; // "The Eagle's Rise"

    // --- Turn 1: plant a FALSE rumor about Thrax --------------------------
    const RUMOR = 'Maximinus Thrax has secretly bought the Senate\'s silence with Rhine gold.';
    const t1 = await runner.runTurn({
      intent: 'Have my agents whisper in the Suburra that Thrax has already bought the Senate.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(1, {
          deltas: [
            // A lie the player plants: GM-private truth disposition says it is false and who started it.
            rumorDelta(THRAX, RUMOR, 0.4, { isTrue: false, originId: PLAYER, topic: 'loyalty' }),
          ],
          headlines: ['Whispers cross the Suburra about the Thracian general.'],
        }),
      },
    });

    // The rumor lives ONLY as a sub-1.0, source-attributed Report...
    expect(runner.thread.reports).toHaveLength(1);
    const report = runner.thread.reports[0];
    expect(report.source).toBe('rumor');
    expect(report.about).toBe(THRAX);
    expect(report.credibility).toBeCloseTo(0.4);
    expect(report.claim).toBe(RUMOR);
    // ...plus a GM-ONLY truth-ledger entry carrying its actual falsity + origin.
    expect(runner.thread.truthLedger).toHaveLength(1);
    const ledger = runner.thread.truthLedger[0];
    expect(ledger.isTrue).toBe(false);
    expect(ledger.originId).toBe(PLAYER);
    expect(ledger.aboutId).toBe(THRAX);
    // The player perceives it AS a rumor, never as fact.
    expect(t1.digest.some(c => c.source === 'public' && /^Rumor reaches you/.test(c.text))).toBe(true);
    // NO ground truth moved to match the lie: Thrax is untouched.
    expect(runner.entity(THRAX).status).toBe('alive');
    expect(runner.entity(THRAX).resources.legion_support).toBe(thraxLegionSupportBefore);

    // --- Turn 2: summon Thrax; his mind runs and evolves his own scheme ---
    const ADJUSTMENT = 'The Guard is nearly mine; I now move to cut the boy emperor off from his mother.';
    const t2 = await runner.runTurn({
      intent: 'Summon Maximinus Thrax to the Palatine and take the measure of the man.',
      rolls: [],
      script: {
        storyRelevance: scriptStoryRelevance(
          [{ entity_id: THRAX, reason: 'The general is the gravest threat in the city.' }],
          [{ entity_id: THRAX, intent: 'Consolidate the Praetorian Guard before striking', continuity: 'continue' }]
        ),
        npcMind: scriptNpcMind({
          entity_id: THRAX,
          chosen_action: 'Answer the summons, but spend the audience gauging the boy\'s weakness.',
          method: 'Cold courtesy over a soldier\'s contempt.',
          private_reasoning: 'The purple is one push away. Let the child think me tamed.',
          scheme_adjustment: ADJUSTMENT,
        }),
        adjudication: scriptAdjudication(2, {
          entityActions: [{ id: THRAX, intent: 'recruit', target: 'praetorian_guard', notes: 'Thrax works the barracks between audiences.' }],
          deltas: [relationDelta(PLAYER, THRAX, 'perceived_threat', 1, 'The measure of the man unsettles the young Emperor.')],
          headlines: ['The Thracian general answers the imperial summons.'],
        }),
      },
    });

    // One spotlight: the npc_minds stage fires, the private conversation does NOT.
    expect(t2.stages).toContain('npc_minds');
    expect(t2.stages).not.toContain('private_conversation');
    expect(t2.stages).not.toContain('mortality');

    // The mind evolved ITS OWN scheme (ground truth): a step was appended, the
    // scheme keeps its identity (D30 - owned by the mind, not the adjudicator).
    const evolved = runner.entity(THRAX).active_scheme!;
    expect(evolved.name).toBe(thraxSchemeName);
    expect(evolved.steps).toHaveLength(4);
    expect(evolved.steps[evolved.steps.length - 1].objective).toBe(ADJUSTMENT);

    // The player perceives ONLY that a design is afoot - never its name/steps.
    expect(t2.digest.some(c => c.source === 'network' && /plotting something/i.test(c.text))).toBe(true);
    expect(t2.digestTexts.join('\n')).not.toContain(thraxSchemeName);
    expect(t2.digestTexts.join('\n')).not.toContain(ADJUSTMENT);
    // Belt-and-suspenders on the enforcement seam (INV-LEAK already asserts it):
    expect(t2.client.promptsFor('narration')[0]).not.toContain(thraxSchemeName);

    // The knowledge store opened a scheme-discovery claim from mere proximity -
    // AWARENESS only, zero paid nature-clues (D28/D30: proximity never advances).
    const schemeClaimAfterT2 = t2.knowledge.find(c => c.claimKey === `scheme:${THRAX}`);
    expect(schemeClaimAfterT2).toBeDefined();
    expect(schemeClaimAfterT2!.schemeDiscovery).toMatchObject({ clues: 0, revealed: false });
    expect(schemeClaimAfterT2!.schemeDiscovery!.nature).toBeUndefined();

    // --- The clue gate: paid investigations earn the nature, one at a time -
    // The distinctive "nature" reading the player buys must NOT be stored
    // while the scheme is unrevealed - only the accreting count advances.
    const NATURE_READING = 'Your agents confirm the general means to turn the Rhine legions against the throne and take the purple by the sword.';

    // Investigation #1: a FAILED probe (forced low roll) - proves the hidden
    // die AND the code-enforced failure consequence, and still earns one clue.
    const inv1 = await runScriptedInvestigation(runner, {
      targetId: THRAX,
      subject: 'scheme',
      isRisky: true,
      roll: 8, // total = 8 + intrigue(4) - 0.5 - 3 = 8.5; margin = 8.5 - 14 = -5.5 -> 'failure'
      response: scriptInvestigation({
        reportData: ['Camp gossip, half-heard', 'A quartermaster\'s uneasy silence'],
        report: NATURE_READING,
        consequences: null, // the model ignored the directive; code MUST substitute one on a failure tier
      }),
    });
    expect(inv1.tier).toBe('failure');
    expect(inv1.roll).toBe(8);
    expect(inv1.consequences).toBe('Your agent was spotted and is now being watched, reducing their effectiveness.');
    let sd = inv1.knowledge.find(c => c.claimKey === `scheme:${THRAX}`)!.schemeDiscovery!;
    expect(sd).toMatchObject({ clues: 1, revealed: false });
    expect(sd.nature).toBeUndefined();
    // The bought nature reading is NOT stored while unrevealed (never dumped).
    expect(JSON.stringify(inv1.knowledge)).not.toContain('take the purple by the sword');

    // Investigation #2: still below the threshold - the nature stays hidden.
    const inv2 = await runScriptedInvestigation(runner, {
      targetId: THRAX,
      subject: 'scheme',
      isRisky: true,
      roll: 20, // succeeds - no consequence
      response: scriptInvestigation({
        reportData: ['A second thread of the design'],
        report: NATURE_READING,
        consequences: null,
      }),
    });
    expect(inv2.consequences).toBeNull(); // a success tier is always null
    sd = inv2.knowledge.find(c => c.claimKey === `scheme:${THRAX}`)!.schemeDiscovery!;
    expect(sd).toMatchObject({ clues: 2, revealed: false });
    expect(sd.nature).toBeUndefined();
    expect(JSON.stringify(inv2.knowledge)).not.toContain('take the purple by the sword');

    // Investigation #3: the threshold is reached - the nature is EARNED now.
    expect(SCHEME_CLUES_TO_REVEAL).toBe(3);
    const inv3 = await runScriptedInvestigation(runner, {
      targetId: THRAX,
      subject: 'scheme',
      isRisky: true,
      roll: 20,
      response: scriptInvestigation({
        reportData: ['The design, entire'],
        report: NATURE_READING,
        consequences: null,
      }),
    });
    sd = inv3.knowledge.find(c => c.claimKey === `scheme:${THRAX}`)!.schemeDiscovery!;
    expect(sd.clues).toBe(3);
    expect(sd.revealed).toBe(true);
    expect(sd.nature).toBe(NATURE_READING); // earned across three paid clues, not from any single one
  });
});
