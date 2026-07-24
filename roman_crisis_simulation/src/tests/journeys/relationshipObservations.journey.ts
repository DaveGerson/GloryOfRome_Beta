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
  mountJourneyAppFromAutosave,
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
const PRESUMED_DEAD = 'lycinia_stolo';
const PLAYER = 'severus_alexander';
const SENATE = 'roman_senate';
const CLAIM = 'Gaius Pontius Magnus publicly rebuked the Roman Senate beneath the Curia steps.';
const REPORT_ID = 'report_1_1700000000000_1';
const DEAD_POISON = [
  'PRESUMED_DEAD_SECRET_MOTIVE_SENTINEL',
  'PRESUMED_DEAD_CURRENT_STATE_SENTINEL',
  'PRESUMED_DEAD_SHORT_GOAL_SENTINEL',
  'PRESUMED_DEAD_LONG_GOAL_SENTINEL',
  'PRESUMED_DEAD_SCHEME_NAME_SENTINEL',
  'PRESUMED_DEAD_SCHEME_GOAL_SENTINEL',
  'PRESUMED_DEAD_SCHEME_STEP_SENTINEL',
  'PRESUMED_DEAD_RELATIONSHIP_TYPE_SENTINEL',
  'PRESUMED_DEAD_RECENT_INTERACTION_SENTINEL',
  'PRESUMED_DEAD_BELIEF_SENTINEL',
  'PRESUMED_DEAD_ENTITY_SECRET_SENTINEL',
  '9101', '9202', '9303', '9404', '9505', '9606',
] as const;

afterEach(() => clearAppGeminiScript());

function personaeTab(container: HTMLElement): HTMLButtonElement {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'));
  expect(tab, 'Dramatis Personae tab').toBeDefined();
  return tab!;
}

function expectNoDeadPoison(value: unknown, label: string): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const sentinel of DEAD_POISON) {
    expect(serialized, `${label} leaked ${sentinel}`).not.toContain(sentinel);
  }
}

describe('journey: relationship observations discover a previously hidden character', () => {
  it('reveals identity only from cited evidence, renders provenance only, and survives v1 save/reload', async () => {
    const seed = new JourneyRunner({ name: 'relationshipObservations/discovery' });
    const deadActor = seed.entity(PRESUMED_DEAD);
    deadActor.status = 'dead';
    deadActor.secret_truth = {
      actually_alive: true,
      hidden_since_turn: 0,
      motive: DEAD_POISON[0],
    };
    deadActor.current_state_narrative = DEAD_POISON[1];
    deadActor.short_term_goals = [DEAD_POISON[2]];
    deadActor.long_term_ambitions = [DEAD_POISON[3]];
    deadActor.active_scheme = {
      name: DEAD_POISON[4],
      overall_goal: DEAD_POISON[5],
      steps: [{ objective: DEAD_POISON[6], status: 'in_progress' }],
    };
    deadActor.relationships[PLAYER] = {
      entity_id: PLAYER,
      relationship_type: DEAD_POISON[7],
      trust_level: 9101,
      respect_level: 9202,
      perceived_threat: 9303,
      ideological_alignment: 9404,
      dependency_level: 9505,
      recent_interactions: [DEAD_POISON[8]],
    };
    deadActor.personality = { ambition: 7, paranoia: 8, loyalty: 9606, cunning: 9, honor: 1 };
    deadActor.beliefs = [DEAD_POISON[9]];
    deadActor.secrets = [DEAD_POISON[10]];
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
      expect(app.container.textContent).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(app.container.textContent, 'initial Personae DOM');
      await appClick(appButton(app.container, 'Structured'));
      const initialRecipients = Array.from(appControl<HTMLSelectElement>(app.container, 'Recipient 1').options)
        .map(option => option.textContent);
      expect(initialRecipients).not.toContain('Gaius Pontius Magnus');
      expect(initialRecipients).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(initialRecipients, 'initial recipient options');
      await appClick(appButton(app.container, 'Chat'));

      const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), 'Receive the public dispatches from the Forum.');
      await appClick(appButton(app.container, 'Send message'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      clock.mockRestore();

      const loaded = loadThreadState();
      expect(loadGame()?.version).toBe(1);
      client.expectCallSequence([
        'storyRelevance', 'assessment', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipUpdates', 'relationshipObservations',
      ]);
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
      expectNoDeadPoison(knowledge, 'committed knowledge');
      expect(JSON.stringify(observation)).not.toMatch(/secret_truth|actually_alive|trust_level|respect_level|goal|belief|confidence|score/i);

      // The cited observation is now the sole discovery gate for composer and Personae.
      await appClick(appButton(app.container, 'Structured'));
      const discoveredRecipients = Array.from(appControl<HTMLSelectElement>(app.container, 'Recipient 1').options)
        .map(option => option.textContent);
      expect(discoveredRecipients).toContain('Gaius Pontius Magnus');
      expect(discoveredRecipients).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(discoveredRecipients, 'post-discovery recipient options');
      await appClick(personaeTab(app.container));
      await waitForApp(() => expect(app.container.textContent).toContain(CLAIM));
      expect(app.container.textContent).toContain('rumor');
      expect(app.container.textContent).toContain('Turn 1');
      expect(app.container.textContent).toContain('Observation timeline');
      expect(app.container.textContent).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(app.container.textContent, 'post-discovery Personae DOM');
      expect(app.container.textContent).not.toContain('Restoration of the Republic');

      // Real App autosave -> loadGame -> a fresh App's real GAME_LOADED reducer path.
      const exactAutosave = structuredClone(loadGame());
      await app.unmount();
      reloaded = await mountJourneyAppFromAutosave();
      expect(loadGame()).toEqual(exactAutosave);
      const reloadedObservation = (loadThreadState().knowledge ?? [])
        .find(claim => claim.topic === 'relationship-observation');
      expect(reloadedObservation).toMatchObject({
        subject: MAGNUS,
        claim: CLAIM,
        updates: [{ turn: 1, source: 'rumor', text: CLAIM }],
        relationshipObservation: { evidenceId: REPORT_ID, participantIds: [MAGNUS, SENATE] },
      });
      await appClick(personaeTab(reloaded.container));
      await waitForApp(() => expect(reloaded!.container.textContent).toContain(CLAIM));
      expect(reloaded.container.textContent).toContain('Observation timeline');
      expect(reloaded.container.textContent).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(reloaded.container.textContent, 'reloaded Personae DOM');

      await appClick(appButton(reloaded.container, 'Structured'));
      const reloadedRecipients = Array.from(appControl<HTMLSelectElement>(reloaded.container, 'Recipient 1').options)
        .map(option => option.textContent);
      expect(reloadedRecipients).toContain('Gaius Pontius Magnus');
      expect(reloadedRecipients).not.toContain('Lycinia Stolo');
      expectNoDeadPoison(reloadedRecipients, 'reloaded recipient options');

      const observationCall = client.calls.find(call => call.kind === 'relationshipObservations');
      expect(observationCall?.prompt).toContain(CLAIM);
      expect(observationCall?.prompt).toContain('Gaius Pontius Magnus');
      expectNoDeadPoison(observationCall?.prompt ?? '', 'relationship selector prompt');
      expect(observationCall?.prompt).not.toContain('Restoration of the Republic');
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
    }
  });
});
