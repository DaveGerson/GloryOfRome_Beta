// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JourneyRunner,
  ScriptedClient,
  appButton,
  appClick,
  appControl,
  appSetValue,
  buildSaveStateFromThread,
  clearAppGeminiScript,
  installAppGeminiScript,
  loadThreadState,
  mountJourneyApp,
  scriptedJsonArray,
  waitForApp,
} from './harness';
import {
  rumorDelta,
  scriptAdjudication,
  scriptAssessmentIdle,
  scriptNarration,
  scriptRelationshipDeltas,
  scriptSimulationState,
  scriptStoryRelevance,
} from './fixtures';
import { loadGame } from '../../persistence/saveGame';

const MAGNUS = 'gaius_pontius_magnus';
const SENATE = 'roman_senate';
const CLAIM = 'Gaius Pontius Magnus publicly rebuked the Roman Senate beneath the Curia steps.';
const SECRET = 'PRESUMED_DEAD_SECRET_SENTINEL';
const REPORT_ID = 'report_1_1700000000000_1';

afterEach(() => clearAppGeminiScript());

function personaeTab(container: HTMLElement): HTMLButtonElement {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'));
  expect(tab, 'Dramatis Personae tab').toBeDefined();
  return tab!;
}

describe('journey: relationship observations discover a previously hidden character', () => {
  it('reveals identity only from cited evidence, renders provenance only, and survives v1 save/reload', async () => {
    const seed = new JourneyRunner({ name: 'relationshipObservations/discovery' });
    seed.entity(MAGNUS).secret_truth = {
      actually_alive: true,
      hidden_since_turn: 0,
      motive: SECRET,
    };
    const client = new ScriptedClient({
      storyRelevance: scriptStoryRelevance(),
      assessment: scriptAssessmentIdle(),
      adjudication: scriptAdjudication(1, {
        deltas: [rumorDelta(MAGNUS, CLAIM, 0.8, { isTrue: true, topic: 'loyalty' })],
        headlines: ['A senatorial rebuke becomes the talk of the Forum.'],
      }),
      simulationState: scriptSimulationState(seed.thread.simulationState),
      monologue: 'A named senator has stepped into the light; I will remember only what was witnessed.',
      narration: scriptNarration('A public report reaches the palace from the Curia steps.', [
        'Ask the Senate for its account',
        'Summon the witnesses',
        'Wait for corroboration',
      ]),
      relationshipUpdates: scriptRelationshipDeltas([]),
      relationshipObservations: scriptedJsonArray([{
        evidenceId: REPORT_ID,
        participantIds: [MAGNUS, SENATE],
        excerpt: CLAIM,
      }]),
    }, 'relationshipObservations/discovery');
    installAppGeminiScript(client);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    let reloaded: Awaited<ReturnType<typeof mountJourneyApp>> | null = null;
    try {
      expect(app.container.textContent).not.toContain('Gaius Pontius Magnus');
      await appClick(appButton(app.container, 'Structured'));
      expect(Array.from(appControl<HTMLSelectElement>(app.container, 'Recipient 1').options)
        .map(option => option.textContent)).not.toContain('Gaius Pontius Magnus');
      await appClick(appButton(app.container, 'Chat'));

      const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), 'Receive the public dispatches from the Forum.');
      await appClick(appButton(app.container, 'Send message'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      clock.mockRestore();

      const loaded = loadThreadState();
      expect(loadGame()?.version).toBe(1);
      const knowledge = loaded.knowledge;
      expect(knowledge).toBeDefined();
      if (!knowledge) throw new Error('Committed relationship observation was not persisted.');
      const observation = knowledge.find(claim => claim.topic === 'relationship-observation');
      expect(observation).toMatchObject({
        subject: MAGNUS,
        claim: CLAIM,
        firstLearnedTurn: 1,
        updates: [{ turn: 1, source: 'rumor', text: CLAIM }],
        relationshipObservation: { evidenceId: REPORT_ID, participantIds: [MAGNUS, SENATE] },
      });
      expect(knowledge.filter(claim => claim.topic === 'relationship-observation')).toHaveLength(1);
      expect(JSON.stringify(knowledge)).not.toContain(SECRET);
      expect(JSON.stringify(observation)).not.toMatch(/secret_truth|actually_alive|trust_level|respect_level|goal|belief|confidence|score/i);

      // The cited observation is now the sole discovery gate for composer and Personae.
      await appClick(appButton(app.container, 'Structured'));
      expect(Array.from(appControl<HTMLSelectElement>(app.container, 'Recipient 1').options)
        .map(option => option.textContent)).toContain('Gaius Pontius Magnus');
      await appClick(personaeTab(app.container));
      await waitForApp(() => expect(app.container.textContent).toContain(CLAIM));
      expect(app.container.textContent).toContain('rumor');
      expect(app.container.textContent).toContain('Turn 1');
      expect(app.container.textContent).toContain('Observation timeline');
      expect(app.container.textContent).not.toContain(SECRET);
      expect(app.container.textContent).not.toContain('Restoration of the Republic');

      // Real App autosave -> loadGame -> a fresh App's real GAME_LOADED reducer path.
      await app.unmount();
      reloaded = await mountJourneyApp(loaded);
      await appClick(personaeTab(reloaded.container));
      await waitForApp(() => expect(reloaded!.container.textContent).toContain(CLAIM));
      expect(reloaded.container.textContent).toContain('Observation timeline');
      expect(reloaded.container.textContent).not.toContain(SECRET);

      const observationCall = client.calls.find(call => call.kind === 'relationshipObservations');
      expect(observationCall?.prompt).toContain(CLAIM);
      expect(observationCall?.prompt).toContain('Gaius Pontius Magnus');
      expect(observationCall?.prompt).not.toContain(SECRET);
      expect(observationCall?.prompt).not.toContain('Restoration of the Republic');
      expect(client.unconsumed()).toEqual([]);
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
    }
  });
});
