// @vitest-environment jsdom
/**
 * tests/journeys/saveReload.journey.ts
 *
 * A save-reload-continue campaign proving MID-JOURNEY persistence round-trips
 * through the REAL seam (persistence/saveGame.ts against jsdom localStorage):
 * a 4-turn playthrough is run twice with byte-identical scripts and dice -
 * once straight through (the control), once autosaved after turn 2, reloaded
 * from real localStorage, and played on - and the two campaigns must end
 * mechanically identical.
 *
 * Story-specific guards (catalog invariants run every turn for free):
 *  - the D11 truth ledger, the D21 knowledge store, and the 4C.3 Director
 *    intents survive the envelope round-trip (they are the mid-campaign state
 *    a reload must not lose);
 *  - a consequential roll AND a planted rumor both fall AFTER the save point,
 *    so the resumed campaign reproduces the exact hidden dice and the exact
 *    ground-truth divergence a never-reloaded run produced;
 *  - equivalenceSnapshot equality across entities/world/sim/ledger/knowledge/
 *    intents/reports/narrations/headlines after two further full-pipeline turns.
 */

import { afterEach, describe, it, expect } from 'vitest';
import {
  JourneyRunner,
  ScriptedClient,
  JourneyTurnDef,
  appButton,
  appClick,
  appControl,
  appSetValue,
  buildSaveStateFromThread,
  clearAppGeminiScript,
  equivalenceSnapshot,
  installAppGeminiScript,
  saveThread,
  loadThreadState,
  mountJourneyApp,
  mountJourneyAppFromAutosave,
  scriptedJsonArray,
  threadFromSave,
  waitForApp,
  clearSave,
} from './harness';
import {
  scriptAdjudication,
  scriptStoryRelevance,
  scriptAssessmentConsequential,
  scriptAssessmentIdle,
  scriptNarration,
  scriptSimulationState,
  resourceDelta,
  relationDelta,
  rumorDelta,
} from './fixtures';
import { createInitialGameState, gameReducer } from '../../state/gameReducer';
import { deserializeTurnSubmission } from '../../playerInput/turnSubmission';
import { loadGame } from '../../persistence/saveGame';

const PLAYER = 'severus_alexander';
const SENATE = 'roman_senate';
const THRAX = 'maximinus_thrax';

afterEach(() => clearAppGeminiScript());

/**
 * The one fixed, deterministic script for turn N (1-4). Both the control run
 * and the resumed run play these EXACT defs, so any divergence is a real
 * persistence bug rather than a scripting difference.
 */
function defForTurn(n: number): JourneyTurnDef {
  switch (n) {
    case 1:
      return {
        intent: 'Open the treasury books and settle the quarter\'s accounts.',
        rolls: [],
        script: {
          adjudication: scriptAdjudication(1, {
            deltas: [resourceDelta(PLAYER, 'denarii', 3000, 'The quarter closes in surplus.')],
            headlines: ['The imperial accounts are settled for the quarter.'],
          }),
        },
      };
    case 2:
      return {
        intent: 'Have my agents spread word that the Rhine legions go unpaid.',
        rolls: [],
        script: {
          // A rumor -> a Report + a GM-only ledger entry, both of which must
          // survive the save taken right after this turn.
          adjudication: scriptAdjudication(2, {
            deltas: [
              rumorDelta(THRAX, 'The Rhine legions grumble, months unpaid, and eye their general coldly.', 0.5, {
                isTrue: true,
                originId: PLAYER,
                topic: 'loyalty',
              }),
              relationDelta(SENATE, PLAYER, 'trust_level', 1, 'The Senate approves the Emperor\'s prudence.'),
            ],
            // A committed Director intent - part of the mid-campaign state the reload must carry.
            headlines: ['Talk of unpaid legions drifts through the forum.'],
          }),
          storyRelevance: scriptStoryRelevance([], []),
        },
      };
    case 3:
      // A consequential turn AFTER the save point: its hidden roll must
      // reproduce exactly in the resumed campaign.
      return {
        intent: 'Face down the Praetorian prefects and demand a fresh oath of loyalty.',
        rolls: [12],
        script: {
          assessment: scriptAssessmentConsequential({
            category: 'strategy of intimidation',
            skill: 'strategy',
            difficulty: 15,
            opposingEntityId: 'praetorian_guard',
            rationale: 'A tense confrontation with the men who could unmake him.',
          }),
          adjudication: scriptAdjudication(3, {
            deltas: [resourceDelta(PLAYER, 'denarii', -500, 'A donative to steady the Guard\'s temper.')],
            headlines: ['The Emperor confronts the Praetorian prefects.'],
          }),
        },
      };
    case 4:
      return {
        intent: 'Retire to the palace library and let the week settle.',
        rolls: [],
        script: {
          adjudication: scriptAdjudication(4, {
            deltas: [relationDelta(SENATE, PLAYER, 'trust_level', 1, 'Steady governance reassures the Curia.')],
            headlines: ['A quiet week closes.'],
          }),
        },
      };
    default:
      throw new Error(`no script for turn ${n}`);
  }
}

describe('journey: a save-reload-continue campaign (mid-journey persistence round-trips)', () => {
  it('resumes from a real localStorage autosave into a mechanically identical world', async () => {
    clearSave();

    // --- Control: 4 turns straight through --------------------------------
    const control = new JourneyRunner({ name: 'saveReload/control' });
    for (let n = 1; n <= 4; n++) await control.runTurn(defForTurn(n));
    expect(control.thread.turnNumber).toBe(5);

    // --- Resumed: 2 turns, autosave, reload, 2 more turns -----------------
    const first = new JourneyRunner({ name: 'saveReload/first-half' });
    await first.runTurn(defForTurn(1));
    await first.runTurn(defForTurn(2));

    // The mid-campaign state we are about to persist.
    expect(first.thread.turnNumber).toBe(3);
    expect(first.thread.truthLedger).toHaveLength(1); // the T2 rumor's ledger entry
    expect(first.thread.knowledge.length).toBeGreaterThan(0);

    // Persist + reload through the REAL saveGame/loadGame seam.
    saveThread(first.thread);
    const loaded = loadThreadState();

    // The envelope round-tripped the mid-campaign slices a reload must not lose.
    expect(loaded.turnNumber).toBe(3);
    expect(loaded.truthLedger).toHaveLength(1);
    expect(loaded.truthLedger![0].isTrue).toBe(true);
    expect(loaded.truthLedger![0].originId).toBe(PLAYER);
    expect((loaded.knowledge ?? []).length).toBe(first.thread.knowledge.length);

    const resumed = new JourneyRunner({ name: 'saveReload/resumed', thread: threadFromSave(loaded) });
    await resumed.runTurn(defForTurn(3));
    await resumed.runTurn(defForTurn(4));

    // The consequential turn's hidden roll reproduced exactly after the reload.
    const controlRoll = control.outcomes[2].entry.resolutionTrace?.roll;
    const resumedRoll = resumed.outcomes[0].entry.resolutionTrace?.roll;
    expect(controlRoll).toBe(12);
    expect(resumedRoll).toBe(12);

    // The whole campaign is mechanically identical, reload or no reload.
    expect(equivalenceSnapshot(resumed.thread)).toEqual(equivalenceSnapshot(control.thread));

    clearSave();
  });

  it('round-trips structured history and relationship observations through App save, loadGame, and GAME_LOADED', async () => {
    const seed = new JourneyRunner({ name: 'saveReload/phase6-slices' });
    const excerpt = 'Severus Alexander entrusts Julia Mamaea with the palace correspondence.';
    const privateIntent = 'Keep the correspondence beyond the Praetorian prefects.';
    const client = new ScriptedClient({
      storyRelevance: scriptStoryRelevance(),
      assessment: scriptAssessmentIdle(),
      adjudication: scriptAdjudication(1),
      simulationState: scriptSimulationState(seed.thread.simulationState),
      monologue: 'My mother can carry this burden, but the Guard need not know it.',
      narration: scriptNarration('Julia Mamaea accepts the sealed correspondence.', [
        'Await her reply',
        'Consult the Senate',
        'Review the palace watch',
      ]),
      relationshipObservations: scriptedJsonArray([{
        evidenceId: 'player-submission',
        participantIds: [PLAYER, 'julia_mamaea'],
        excerpt,
      }]),
    }, 'saveReload/phase6-slices');
    installAppGeminiScript(client);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    let reloaded: Awaited<ReturnType<typeof mountJourneyApp>> | null = null;
    try {
      await appClick(appButton(app.container, 'Structured'));
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Action 1'), excerpt);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private Intent'), privateIntent);
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));

      // This state was assembled by App's private buildSaveState callback and
      // persisted by its real saveGame transaction, not by this test.
      const loaded = loadThreadState();
      expect(deserializeTurnSubmission(loaded.turnHistory[0].playerIntent)).toMatchObject({
        kind: 'structured',
        actions: [excerpt],
        privateIntent,
      });
      expect(loaded.knowledge).toContainEqual(expect.objectContaining({
        claim: excerpt,
        relationshipObservation: {
          evidenceId: 'turn:1:player-submission',
          participantIds: [PLAYER, 'julia_mamaea'],
        },
      }));

      const reduced = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded });
      expect(reduced.turnHistory).toEqual(loaded.turnHistory);
      expect(reduced.knowledge).toEqual(loaded.knowledge);
      expect(reduced.turnNumber).toBe(2);
      client.expectCallSequence([
        'storyRelevance', 'assessment', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipObservations',
      ]);

      const exactAutosave = structuredClone(loadGame());
      await app.unmount();
      reloaded = await mountJourneyAppFromAutosave();
      expect(loadGame()).toEqual(exactAutosave);
      expect(reloaded.container.textContent).toContain(excerpt);
      const disclosure = Array.from(reloaded.container.querySelectorAll('details')).find(details =>
        details.querySelector('summary')?.textContent === 'Private Intent');
      expect(disclosure).toBeDefined();
      expect(disclosure!.open).toBe(false);
      expect(disclosure!.textContent).toContain(privateIntent);
      expect(client.unconsumed()).toEqual([]);
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
    }
  });
});
