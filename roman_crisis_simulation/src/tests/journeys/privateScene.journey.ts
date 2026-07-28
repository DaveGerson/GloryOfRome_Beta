// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  JourneyRunner,
  ScriptedClient,
  type MountedJourneyApp,
  type TurnScript,
  appButton,
  appClick,
  appControl,
  appSetValue,
  buildSaveStateFromThread,
  clearAppGeminiScript,
  clearSave,
  installAppGeminiScript,
  mountJourneyApp,
  mountJourneyAppFromAutosave,
  scriptedJsonArray,
  waitForApp,
} from './harness';
import {
  scriptAdjudication,
  scriptAssessmentIdle,
  scriptNarration,
  scriptPrivateSceneResponse,
  scriptSimulationState,
  scriptStoryRelevance,
} from './fixtures';
import { loadGame } from '../../persistence/saveGame';
import type { KnowledgeClaim } from '../../knowledge/store';

const NETWORK_NPC = 'maximinus_thrax';
const COLOCATED_NPC = 'julia_mamaea';
const INACCESSIBLE_NPC = 'gaius_pontius_magnus';
const FIRST_OPENING = 'Tell me whether the Rhine legions remain loyal.';
const FIRST_CLAIM = 'The Rhine legions are content and loyal.';
const FIRST_HIDDEN = 'FIRST_HIDDEN_INTENT: exploit the unpaid Rhine legions against the emperor.';
const FIRST_MECHANICS = 'FIRST_MECHANICS_SENTINEL: keep the private leverage off every player surface.';
const FIRST_LAST_WORD = 'I will judge the legions by what they do.';
const REFUSAL_OPENING = 'Mother, grant me a private accounting of the palace.';
const REFUSAL_RESPONSE = 'No. This audience is over.';
const REFUSAL_HIDDEN = 'REFUSAL_HIDDEN_INTENT: conceal the palace correspondence.';
const REFUSAL_MECHANICS = 'REFUSAL_MECHANICS_SENTINEL: GM inspection only.';
const REFUSAL_LAST_WORD = 'Then I will inspect the correspondence myself.';

afterEach(() => {
  clearAppGeminiScript();
  clearSave();
});

function knownInaccessibleClaim(): KnowledgeClaim {
  return {
    id: 'known-inaccessible-gaius',
    subject: INACCESSIBLE_NPC,
    claim: 'Gaius Pontius Magnus is known to the imperial household.',
    topic: 'identity',
    claimKey: `investigation:${INACCESSIBLE_NPC}:beliefs`,
    firstLearnedTurn: 1,
    updates: [{
      turn: 1,
      source: 'spy',
      text: 'Gaius Pontius Magnus is known to the imperial household.',
    }],
  };
}

function privateSceneResponses() {
  return [1, 2, 3, 4, 5, 6].map(exchange => scriptPrivateSceneResponse({
    exchange,
    npcUtterance: exchange === 1 ? FIRST_CLAIM : `Maximinus answers exchange ${exchange} without yielding.`,
    speechActKind: exchange === 1 ? 'claim' : 'refusal',
    sincerity: 'Deliberately deceptive.',
    hiddenIntent: FIRST_HIDDEN,
    plannedFollowThrough: [FIRST_MECHANICS],
  }));
}

function journeyClient(simulationState: JourneyRunner['thread']['simulationState']): ScriptedClient {
  return new ScriptedClient({
    privateScene: [
      ...privateSceneResponses(),
      scriptPrivateSceneResponse({
        exchange: 1,
        disposition: 'refused',
        npcUtterance: REFUSAL_RESPONSE,
        speechActKind: 'refusal',
        sincerity: 'Final but evasive.',
        hiddenIntent: REFUSAL_HIDDEN,
        plannedFollowThrough: [REFUSAL_MECHANICS],
      }),
    ],
    storyRelevance: [scriptStoryRelevance(), scriptStoryRelevance()],
    assessment: [scriptAssessmentIdle(), scriptAssessmentIdle()],
    adjudication: [
      scriptAdjudication(1, { headlines: ['The first private audience casts a shadow over the week.'] }),
      scriptAdjudication(2, { headlines: ['The refused audience leaves the palace watchful.'] }),
    ],
    simulationState: [scriptSimulationState(simulationState), scriptSimulationState(simulationState)],
    monologue: [
      'Maximinus speaks smoothly, but his certainty is not proof.',
      'A refusal is information, even when it settles nothing by itself.',
    ],
    narration: [
      scriptNarration('The week proceeds without establishing the general\'s private claim as fact.', [
        'Review the Rhine dispatches', 'Consult the Senate', 'Watch the palace correspondence',
      ]),
      scriptNarration('The next week closes with both private audiences recorded and no claim promoted by fiat.', [
        'Question another witness', 'Review the treasury', 'Wait for firmer evidence',
      ]),
    ],
    relationshipObservations: [scriptedJsonArray([]), scriptedJsonArray([])],
  } satisfies TurnScript, 'privateScene/e2e');
}

async function openPrivateScene(app: MountedJourneyApp): Promise<void> {
  await appClick(appButton(app.container, 'Private scene'));
  await waitForApp(() => expect(app.container.querySelector('[aria-label="Private scene"]')).not.toBeNull());
}

async function submitMacroTurn(app: MountedJourneyApp, intent: string, expectedTurn: number): Promise<void> {
  await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), intent);
  await appClick(appButton(app.container, 'Send message'));
  await waitForApp(() => expect(loadGame()?.state.turnNumber).toBe(expectedTurn));
}

function privateSceneCallCount(client: ScriptedClient): number {
  return client.calls.filter(call => call.kind === 'privateScene').length;
}

describe('journey: player private scenes across audience, reload, and macro-turn boundaries', () => {
  it('keeps access, lifecycle, consequence, truth, save, and audience partitions intact end to end', async () => {
    clearSave();
    const seed = new JourneyRunner({ name: 'privateScene/seed' });
    seed.thread.knowledge = [knownInaccessibleClaim()];
    const client = journeyClient(seed.thread.simulationState);
    installAppGeminiScript(client);

    let app: MountedJourneyApp | null = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    try {
      await openPrivateScene(app);
      const target = appControl<HTMLSelectElement>(app.container, 'Private-scene target');
      const eligibleIds = Array.from(target.options).map(option => option.value);
      expect(eligibleIds).toContain(COLOCATED_NPC);
      expect(eligibleIds).toContain(NETWORK_NPC);
      expect(eligibleIds).not.toContain(INACCESSIBLE_NPC);

      await appSetValue(target, NETWORK_NPC);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private-scene opening'), FIRST_OPENING);
      await appClick(appButton(app.container, 'Send invitation'));
      await waitForApp(() => expect(loadGame()?.state.privateScenes?.[0]?.npcResponseCount).toBe(1));

      const activeBeforeReload = structuredClone(loadGame()!.state.privateScenes![0]);
      expect(activeBeforeReload.status).toBe('active');
      expect(activeBeforeReload.transcript.map(line => line.text)).toEqual([FIRST_OPENING, FIRST_CLAIM]);
      expect(loadGame()!.state.truthLedger).toEqual([]);
      expect(app.container.textContent).toContain(FIRST_CLAIM);
      expect(app.container.textContent).not.toContain(FIRST_HIDDEN);
      expect(app.container.textContent).not.toContain(FIRST_MECHANICS);

      await app.unmount();
      app = await mountJourneyAppFromAutosave();
      await openPrivateScene(app);
      expect(loadGame()!.state.privateScenes![0]).toEqual(activeBeforeReload);
      expect(app.container.textContent).toContain('1/6 replies');
      expect(appControl<HTMLElement>(app.container, 'Private-scene transcript').textContent).toContain(FIRST_OPENING);
      expect(appControl<HTMLElement>(app.container, 'Private-scene transcript').textContent).toContain(FIRST_CLAIM);

      for (let exchange = 2; exchange <= 6; exchange += 1) {
        await appSetValue(
          appControl<HTMLTextAreaElement>(app.container, 'Private-scene reply'),
          `Player reply ${exchange}`,
        );
        await appClick(appButton(app.container, 'Send reply'));
        await waitForApp(() => expect(loadGame()!.state.privateScenes![0].npcResponseCount).toBe(exchange));
      }
      expect(loadGame()!.state.privateScenes![0]).toMatchObject({
        status: 'awaiting_last_word',
        closureReason: 'response_limit',
        npcResponseCount: 6,
      });

      const callsBeforeLastWord = privateSceneCallCount(client);
      expect(callsBeforeLastWord).toBe(6);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private-scene last word'), FIRST_LAST_WORD);
      await appClick(appButton(app.container, 'Leave last word'));
      await waitForApp(() => expect(loadGame()!.state.privateScenes![0].status).toBe('closed'));
      expect(privateSceneCallCount(client)).toBe(callsBeforeLastWord);
      expect(loadGame()!.state.truthLedger).toEqual([]);
      expect(app.container.textContent).not.toContain(FIRST_HIDDEN);
      expect(app.container.textContent).not.toContain(FIRST_MECHANICS);

      await appClick(appControl<HTMLButtonElement>(app.container, 'Close private scene'));
      await submitMacroTurn(app, 'Compare the private audience with the public dispatches.', 2);

      const firstMacroPrompt = client.promptsFor('adjudication')[0];
      expect(firstMacroPrompt.match(/PRIVATE SCENE OUTCOME \(GM-private context/g)).toHaveLength(1);
      expect(firstMacroPrompt).toContain(FIRST_CLAIM);
      expect(firstMacroPrompt).toContain(FIRST_HIDDEN);
      expect(firstMacroPrompt).toContain(FIRST_LAST_WORD);
      expect(firstMacroPrompt).not.toContain(FIRST_OPENING);
      expect(firstMacroPrompt).not.toContain('Player reply 2');
      expect(loadGame()!.state.privateScenes![0]).toMatchObject({
        consequenceStatus: 'consumed',
        consumedByTurn: 2,
      });
      expect(loadGame()!.state.truthLedger).toEqual([]);

      await waitForApp(() => expect(appButton(app!.container, 'Private scene').disabled).toBe(false));
      await openPrivateScene(app);
      await appSetValue(appControl<HTMLSelectElement>(app.container, 'Private-scene target'), COLOCATED_NPC);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private-scene opening'), REFUSAL_OPENING);
      await appClick(appButton(app.container, 'Send invitation'));
      await waitForApp(() => expect(loadGame()!.state.privateScenes![1]).toMatchObject({
        status: 'awaiting_last_word', closureReason: 'refused', npcResponseCount: 1,
      }));

      const callsBeforeRefusalLastWord = privateSceneCallCount(client);
      expect(callsBeforeRefusalLastWord).toBe(7);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private-scene last word'), REFUSAL_LAST_WORD);
      await appClick(appButton(app.container, 'Leave last word'));
      await waitForApp(() => expect(loadGame()!.state.privateScenes![1].status).toBe('closed'));
      expect(privateSceneCallCount(client)).toBe(callsBeforeRefusalLastWord);

      await app.unmount();
      app = await mountJourneyAppFromAutosave();
      await openPrivateScene(app);
      expect(app.container.textContent).toContain(REFUSAL_RESPONSE);
      expect(app.container.textContent).toContain(REFUSAL_LAST_WORD);
      expect(app.container.textContent).toContain('You have already held a private scene this turn.');
      expect(app.container.querySelector('[aria-label="Private-scene opening"]')).toBeNull();
      for (const forbidden of [FIRST_HIDDEN, FIRST_MECHANICS, REFUSAL_HIDDEN, REFUSAL_MECHANICS, 'npcPrivate']) {
        expect(app.container.textContent).not.toContain(forbidden);
      }

      await appClick(appControl<HTMLButtonElement>(app.container, 'Close private scene'));
      const gmToggle = app.container.querySelector<HTMLInputElement>('#gm-console-toggle')!;
      if (!gmToggle.checked) await appClick(gmToggle);
      await appClick(appButton(app.container, 'GM Log'));
      await appClick(appButton(app.container, 'private'));
      const gmLedger = appControl<HTMLElement>(app.container, 'Private scene GM ledger');
      expect(gmLedger.textContent).toContain('NPC private intent — GM only');
      expect(gmLedger.textContent).toContain(FIRST_HIDDEN);
      expect(gmLedger.textContent).toContain(FIRST_MECHANICS);
      expect(gmLedger.textContent).toContain(REFUSAL_HIDDEN);
      expect(gmLedger.textContent).toContain(REFUSAL_MECHANICS);
      expect(gmLedger.textContent).toContain('consumed');
      expect(gmLedger.textContent).toContain('pending');
      await appClick(appControl<HTMLButtonElement>(app.container, 'Close Game Master screen'));

      await submitMacroTurn(app, 'Let the refused audience inform the next week, and nothing more.', 3);
      const secondMacroPrompt = client.promptsFor('adjudication')[1];
      expect(secondMacroPrompt.match(/PRIVATE SCENE OUTCOME \(GM-private context/g)).toHaveLength(1);
      expect(secondMacroPrompt).toContain(REFUSAL_RESPONSE);
      expect(secondMacroPrompt).toContain(REFUSAL_HIDDEN);
      expect(secondMacroPrompt).toContain(REFUSAL_LAST_WORD);
      expect(secondMacroPrompt).not.toContain(FIRST_CLAIM);
      expect(secondMacroPrompt).not.toContain(FIRST_HIDDEN);
      expect(secondMacroPrompt).not.toContain(FIRST_LAST_WORD);
      expect(loadGame()!.state.privateScenes).toEqual([
        expect.objectContaining({ consequenceStatus: 'consumed', consumedByTurn: 2 }),
        expect.objectContaining({ consequenceStatus: 'consumed', consumedByTurn: 3 }),
      ]);
      expect(loadGame()!.state.truthLedger).toEqual([]);
      expect(privateSceneCallCount(client)).toBe(7);
      client.expectCallSequence([
        'privateScene', 'privateScene', 'privateScene', 'privateScene', 'privateScene', 'privateScene',
        'storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration', 'relationshipObservations',
        'privateScene',
        'storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration', 'relationshipObservations',
      ]);
    } finally {
      if (app && document.body.contains(app.container)) await app.unmount();
    }
  });
});
