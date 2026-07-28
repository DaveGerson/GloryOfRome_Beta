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
  scriptedFailure,
  scriptedJsonArray,
  threadFromSave,
  waitForApp,
} from './harness';
import {
  scriptAdjudication,
  scriptAssessmentIdle,
  scriptNarration,
  scriptNpcMind,
  scriptRelationshipDeltas,
  scriptSimulationState,
  scriptStoryRelevance,
  PLAYER_ID,
} from './fixtures';
import { deserializeTurnSubmission } from '../../playerInput/turnSubmission';
import { loadGame } from '../../persistence/saveGame';
import { PRIVATE_INTENT_ACKNOWLEDGEMENT } from '../../playerView/noAttemptResponse';

afterEach(() => clearAppGeminiScript());

function clientForTurn(
  seed: JourneyRunner,
  turn: number,
  label: string,
  options: {
    relationshipFailure?: Error;
    narration?: string;
    includeAssessment?: boolean;
    includePlayerPresentation?: boolean;
    includeRelationshipUpdates?: boolean;
    includeAmbition?: boolean;
    adjudication?: Parameters<typeof scriptAdjudication>[1];
  } = {},
): ScriptedClient {
  const spotlight = label.includes('/failure') || label.includes('/retry');
  const ambition = options.includeAmbition ?? label.includes('/retry');
  return new ScriptedClient({
    storyRelevance: spotlight
      ? scriptStoryRelevance(
        [{ entity_id: 'maximinus_thrax', reason: 'The general watches the imperial court from the edge of the public audience.' }],
        [{ entity_id: 'maximinus_thrax', intent: 'Judge whether the Emperor is building a durable coalition.', continuity: 'new' }],
      )
      : scriptStoryRelevance(),
    ...(options.includeAssessment === false ? {} : { assessment: scriptAssessmentIdle() }),
    ...(spotlight ? {
      npcMind: scriptNpcMind({
        entity_id: 'maximinus_thrax',
        chosen_action: 'Watch the public audience without intervening.',
        method: 'Rely on visible conduct and public reports only.',
        private_reasoning: 'The Emperor reveals priorities through whom he receives.',
      }),
    } : {}),
    adjudication: scriptAdjudication(turn, options.adjudication),
    simulationState: scriptSimulationState(seed.thread.simulationState),
    ...(options.includePlayerPresentation === false ? {} : {
      monologue: 'I intend to judge only what is before me, and keep counsel with myself.',
      narration: scriptNarration(options.narration ?? 'The Emperor hears the petitions of Rome.', [
        'Consult Julia Mamaea',
        'Address the Senate',
        'Inspect the Guard',
      ]),
    }),
    ...(options.includeRelationshipUpdates === false
      ? {}
      : { relationshipUpdates: scriptRelationshipDeltas([]) }),
    relationshipObservations: options.relationshipFailure
      ? scriptedFailure(options.relationshipFailure)
      : scriptedJsonArray([]),
    ...(ambition ? {
      ambition: {
        apparent_ambition: 'Appears to be balancing senatorial legitimacy against praetorian power.',
        confidence: 'low',
      },
    } : {}),
  }, label);
}

interface SelectorBoundaryCall {
  question: string;
  evidence: Array<{ id: string; source: string; text: string }>;
  prompt: string;
  systemInstruction: string;
}

function installClientWithEvidenceSelection(
  client: ScriptedClient,
  selectedEvidenceText: string,
  selectorCalls: SelectorBoundaryCall[],
): void {
  const models = client.ai.models as unknown as {
    generateContent: (params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }) => Promise<{ text?: string }>;
  };
  const generateContent = models.generateContent.bind(models);
  models.generateContent = async params => {
    const systemInstruction = String(params.config?.systemInstruction ?? '');
    if (!systemInstruction.includes('No-Attempt Evidence Selector')) {
      return generateContent(params);
    }
    const [questionBlock, evidenceBlock] = params.contents
      .replace('QUESTION:\n', '')
      .split('\n\nOFFERED EVIDENCE:\n');
    const question = JSON.parse(questionBlock) as string;
    const evidence = JSON.parse(evidenceBlock) as Array<{ id: string; source: string; text: string }>;
    selectorCalls.push({ question, evidence, prompt: params.contents, systemInstruction });
    const selected = evidence.find(item => item.text === selectedEvidenceText);
    if (!selected) throw new Error(`journey selector did not receive evidence text: ${selectedEvidenceText}`);
    return { text: JSON.stringify({ decision: 'answer', evidenceIds: [selected.id] }) };
  };
  installAppGeminiScript(client);
}

describe('journey: structured player input through the real App transaction', () => {
  it('moves Chat to Structured, canonicalizes ordered recipients, and retries the exact frozen turn once', async () => {
    const seed = new JourneyRunner({ name: 'structuredInput/mixed' });
    // The structured submission runs as committed turn 3, exercising App's
    // real periodic ambition-inference cadence after its durable commit.
    seed.thread.turnNumber = 2;
    const chatClient = clientForTurn(seed, 2, 'structuredInput/chat');
    installAppGeminiScript(chatClient);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    const expectedChat = 'Hear the petitions of Rome.';
    const unsentChatDraft = 'Keep this separate chat draft untouched.';
    const privateIntent = 'PRIVATE_INTENT_SENTINEL: preserve room to bargain.';
    const question = 'QUESTION_SENTINEL: which faction is watching the doors?';
    let reloaded: Awaited<ReturnType<typeof mountJourneyAppFromAutosave>> | null = null;

    try {
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), expectedChat);
      await appClick(appButton(app.container, 'Send message'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(3));
      chatClient.expectCallSequence([
        'storyRelevance', 'assessment', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipUpdates', 'relationshipObservations',
      ]);

      // Drafts are mode-local: author chat text, switch mode, and retain it.
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), unsentChatDraft);
      await appClick(appButton(app.container, 'Structured'));

      const recipient = appControl<HTMLSelectElement>(app.container, 'Recipient 1');
      const visibleOptions = Array.from(recipient.options).map(option => option.textContent?.trim());
      expect(visibleOptions).toEqual([
        'Select a recipient',
        'Julia Mamaea',
        'Maximinus Thrax',
        'Military Cabal',
        'Praetorian Guard',
        'Roman Senate',
        'Senatorial Party',
        'Someone else…',
      ]);
      expect(visibleOptions).not.toContain('Gaius Pontius Magnus');
      expect(visibleOptions).not.toContain('Lycinia Stolo');

      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Action 1'), 'Address the Senate in open session.');
      await appClick(appButton(app.container, 'Add action row'));
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Action 2'), 'Inspect the Praetorian watch roster.');
      const juliaValue = Array.from(recipient.options).find(option => option.textContent === 'Julia Mamaea')!.value;
      await appSetValue(recipient, juliaValue);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Message or order 1'), 'Meet me in the library at dusk.');
      await appClick(appButton(app.container, 'Add message or order row'));
      const secondRecipient = appControl<HTMLSelectElement>(app.container, 'Recipient 2');
      const customValue = Array.from(secondRecipient.options).find(option => option.textContent?.startsWith('Someone else'))!.value;
      await appSetValue(secondRecipient, customValue);
      await appSetValue(appControl<HTMLInputElement>(app.container, 'Custom recipient 2'), 'The captain at the eastern gate');
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Message or order 2'), 'Double the watch without public alarm.');
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private Intent'), privateIntent);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Question / Context'), question);

      // Drafts are separate only within this mounted session. Refresh/reload
      // deliberately does not persist either draft (the settled MVP contract).
      await appClick(appButton(app.container, 'Chat'));
      expect(appControl<HTMLTextAreaElement>(app.container, 'Chat input').value).toBe(unsentChatDraft);
      await appClick(appButton(app.container, 'Structured'));
      expect(appControl<HTMLTextAreaElement>(app.container, 'Action 1').value).toBe('Address the Senate in open session.');
      expect(appControl<HTMLTextAreaElement>(app.container, 'Private Intent').value).toBe(privateIntent);

      // Fail at the final provider call, after the whole real turn pipeline ran.
      const failed = clientForTurn(seed, 3, 'structuredInput/failure', {
        relationshipFailure: new Error('deliberate relationship provider failure'),
      });
      installAppGeminiScript(failed);
      const expectedConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(app.container.textContent).toContain('Your draft has been restored'));
      expectedConsole.mockRestore();
      expect(loadThreadState().turnNumber).toBe(3);
      expect(loadThreadState().turnHistory).toHaveLength(1);
      expect(appControl<HTMLTextAreaElement>(app.container, 'Action 1').value).toBe('Address the Senate in open session.');
      expect(appControl<HTMLTextAreaElement>(app.container, 'Private Intent').value).toBe(privateIntent);
      failed.expectCallSequence([
        'storyRelevance', 'assessment', 'npcMind', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipUpdates', 'relationshipObservations',
      ]);

      const retried = clientForTurn(seed, 3, 'structuredInput/retry');
      installAppGeminiScript(retried);
      await appClick(appButton(app.container, 'Retry the last action'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(4));
      await waitForApp(() => expect(loadThreadState().inferredAmbition).toMatchObject({ asOfTurn: 3 }));
      retried.expectCallSequence([
        'storyRelevance', 'assessment', 'npcMind', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipUpdates', 'relationshipObservations', 'ambition',
      ]);

      const loaded = loadThreadState();
      expect(loaded.turnHistory).toHaveLength(2);
      expect(loaded.messages.filter(message => message.sender === 'player')).toHaveLength(2);
      const submission = deserializeTurnSubmission(loaded.turnHistory[1].playerIntent);
      expect(submission).toEqual({
        version: 1,
        kind: 'structured',
        actions: ['Address the Senate in open session.', 'Inspect the Praetorian watch roster.'],
        messagesOrOrders: [
          { recipient: { kind: 'known_entity', entityId: 'julia_mamaea', displayName: 'Julia Mamaea' }, command: 'Meet me in the library at dusk.' },
          { recipient: { kind: 'free_text', text: 'The captain at the eastern gate' }, command: 'Double the watch without public alarm.' },
        ],
        privateIntent,
        questionOrContext: question,
      });

      // The retry crossed the same provider boundary with byte-identical prompts.
      expect(retried.calls.slice(0, failed.calls.length)).toEqual(failed.calls);
      for (const kind of [
        'storyRelevance', 'assessment', 'npcMind', 'simulationState',
        'relationshipUpdates', 'relationshipObservations', 'ambition',
      ] as const) {
        const externalPrompt = retried.promptsFor(kind).join('\n');
        expect(externalPrompt).not.toContain(privateIntent);
        expect(externalPrompt).not.toContain(question);
      }
      for (const kind of ['narration', 'monologue'] as const) {
        const playerOwnedPrompt = retried.promptsFor(kind).join('\n');
        expect(playerOwnedPrompt).toContain(privateIntent);
        expect(playerOwnedPrompt).toContain(question);
      }
      expect(retried.promptsFor('adjudication').join('\n')).not.toContain(privateIntent);
      expect(retried.promptsFor('adjudication').join('\n')).toContain(question);

      const playerPerceivedOutputs = JSON.stringify({
        messages: loaded.messages.filter(message => message.sender !== 'player'),
        reports: loaded.reports,
        knowledge: loaded.knowledge,
        suggestedActions: loaded.suggestedActions,
        currentEvents: loaded.currentEvents,
        adjudication: loaded.turnHistory[1].adjudication,
      });
      expect(playerPerceivedOutputs).not.toContain(privateIntent);
      expect(playerPerceivedOutputs).not.toContain(question);

      // Player history keeps Private Intent collapsed; GM history renders it complete.
      const playerDisclosure = Array.from(app.container.querySelectorAll('details')).find(details =>
        details.querySelector('summary')?.textContent === 'Private Intent');
      expect(playerDisclosure).toBeDefined();
      expect(playerDisclosure!.open).toBe(false);
      const { act } = await import('react');
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true })));
      await waitForApp(() => expect(app.container.textContent).toContain('GM Log'));
      await appClick(appButton(app.container, 'GM Log'));
      await waitForApp(() => expect(app.container.textContent).toContain(privateIntent));

      // Capture the exact real autosave, tear down the original tree, and let
      // a fresh App consume that same envelope through loadGame/GAME_LOADED.
      const exactAutosave = structuredClone(loadGame());
      expect(exactAutosave?.version).toBe(1);
      expect(localStorage.getItem('gloryOfRome:composerMode')).toBe('structured');
      await app.unmount();
      reloaded = await mountJourneyAppFromAutosave();
      expect(loadGame()).toEqual(exactAutosave);
      expect(appControl<HTMLTextAreaElement>(reloaded.container, 'Action 1').value).toBe('');

      const reloadedState = loadThreadState();
      expect(reloadedState.turnNumber).toBe(4);
      expect(reloadedState.turnHistory).toHaveLength(2);
      expect(reloadedState.messages.filter(message => message.sender === 'player')).toHaveLength(2);
      expect(deserializeTurnSubmission(reloadedState.turnHistory[1].playerIntent)).toEqual(submission);
      const reloadedDisclosure = Array.from(reloaded.container.querySelectorAll('details')).find(details =>
        details.querySelector('summary')?.textContent === 'Private Intent');
      expect(reloadedDisclosure).toBeDefined();
      expect(reloadedDisclosure!.open).toBe(false);

      await appClick(appButton(reloaded.container, 'Chat'));
      expect(appControl<HTMLTextAreaElement>(reloaded.container, 'Chat input').value).toBe('');
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
    }
  });

  it('commits question-only, private-only, and observable mixed responses atomically across save and reload', async () => {
    const seed = new JourneyRunner({ name: 'structuredInput/question-only' });
    const hiddenWorld = 'HIDDEN_WORLD_SENTINEL: the eastern governor has already rebelled.';
    const hiddenEntity = 'HIDDEN_ENTITY_SENTINEL: Magnus commands an unseen midnight cohort.';
    const hiddenConversation = 'PRIVATE_CONVERSATION_SENTINEL: Magnus promised Thrax the palace keys.';
    const hiddenTruth = 'SECRET_TRUTH_POISON_SENTINEL: the palace prefect forged the roster.';
    const gmPrivatePoison = 'GM_PRIVATE_POISON_SENTINEL: the selector must never receive this.';
    const rawDeltaPoison = 'RAW_DELTA_POISON_SENTINEL: hidden mechanics must not become response prose.';
    seed.thread.worldState.political_climate = hiddenWorld;
    seed.entity('gaius_pontius_magnus').current_state_narrative = hiddenEntity;
    seed.entity('gaius_pontius_magnus').short_term_goals = [hiddenEntity];
    seed.entity('gaius_pontius_magnus').secret_truth = {
      actually_alive: true,
      hidden_since_turn: 1,
      motive: hiddenTruth,
    };
    seed.thread.turnHistory.push({
      turnNumber: 1,
      playerIntent: 'Receive the ordinary public petitions.',
      adjudication: scriptAdjudication(1, { gm_private: [`[Secret Meeting] ${hiddenConversation}`] }),
      narration: 'The public audience concluded without incident.',
    });
    seed.thread.turnNumber = 2;
    const selectedEvidence = "Maximinus Thrax's independent preparations grows.";
    const answer = `What you can currently tell:\n- Via your network: ${selectedEvidence}`;
    const question = 'What can I tell from the empty benches?';
    const selectorCalls: SelectorBoundaryCall[] = [];
    let reloaded: Awaited<ReturnType<typeof mountJourneyAppFromAutosave>> | null = null;
    const poisonedPlayerAction = 'POISONED_PLAYER_ACTION: the avatar investigates without permission.';
    const poisonedPlayerDelta = 'POISONED_PLAYER_DELTA: the fabricated investigation creates an artifact.';
    const poisoned = clientForTurn(seed, 2, 'structuredInput/question-only/poisoned', {
      includeAssessment: false,
      narration: answer,
      adjudication: {
        entityActions: [
          {
            id: 'maximinus_thrax',
            intent: 'recruit',
            target: 'legio_iv_italica',
            notes: 'Thrax independently sounds out the cohorts.',
          },
        ],
        deltas: [
          {
            type: 'resource',
            key: `${PLAYER_ID}:forbidden_question_artifact`,
            delta: 1,
            reason: poisonedPlayerDelta,
          },
          {
            type: 'resource',
            key: 'maximinus_thrax:independent_preparations',
            delta: 1,
            reason: 'Thrax advances his own preparations without the player acting.',
          },
        ],
        headlines: [poisonedPlayerAction, 'Thrax quietly strengthens his camp.'],
      },
    });
    installAppGeminiScript(poisoned);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    try {
      await appClick(appButton(app.container, 'Structured'));
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Question / Context'), question);
      const expectedConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(app.container.textContent).toContain('Your draft has been restored'));
      expectedConsole.mockRestore();

      const failedState = loadThreadState();
      expect(failedState.turnNumber).toBe(2);
      expect(failedState.turnHistory).toHaveLength(1);
      expect(failedState.entities.find(entity => entity.entity_id === PLAYER_ID)?.resources)
        .not.toHaveProperty('forbidden_question_artifact');
      expect(failedState.entities.find(entity => entity.entity_id === 'maximinus_thrax')?.resources)
        .not.toHaveProperty('independent_preparations');
      expect(app.container.textContent).not.toContain(poisonedPlayerAction);
      expect(app.container.textContent).not.toContain(poisonedPlayerDelta);
      expect(poisoned.calls.map(call => call.kind)).toEqual(['storyRelevance', 'adjudication']);

      const client = clientForTurn(seed, 2, 'structuredInput/question-only/conforming', {
        includeAssessment: false,
        includePlayerPresentation: false,
        includeRelationshipUpdates: false,
        adjudication: {
          entityActions: [{
            id: 'maximinus_thrax',
            intent: 'recruit',
            target: 'legio_iv_italica',
            notes: 'Thrax independently sounds out the cohorts.',
          }],
          deltas: [{
            type: 'resource',
            key: 'maximinus_thrax:independent_preparations',
            delta: 1,
            reason: rawDeltaPoison,
          }],
          headlines: ['Thrax quietly strengthens his camp.'],
          gm_private: [gmPrivatePoison],
        },
      });
      installClientWithEvidenceSelection(client, selectedEvidence, selectorCalls);
      await appClick(appButton(app.container, 'Retry the last action'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(3));

      const loaded = loadThreadState();
      const entry = loaded.turnHistory.at(-1)!;
      expect(app.container.textContent).toContain(answer);
      client.expectCallSequence([
        'storyRelevance', 'adjudication', 'simulationState', 'relationshipObservations',
      ]);
      expect(selectorCalls).toHaveLength(1);
      expect(selectorCalls[0].question).toBe(question);
      expect(selectorCalls[0].evidence).toContainEqual(expect.objectContaining({ text: selectedEvidence }));
      expect(selectorCalls[0].prompt).not.toContain(hiddenWorld);
      expect(selectorCalls[0].prompt).not.toContain(hiddenEntity);
      expect(selectorCalls[0].prompt).not.toContain(hiddenConversation);
      expect(selectorCalls[0].prompt).not.toContain(hiddenTruth);
      expect(selectorCalls[0].prompt).not.toContain(gmPrivatePoison);
      expect(selectorCalls[0].prompt).not.toContain(rawDeltaPoison);
      expect(client.promptsFor('storyRelevance').join('\n')).toContain(hiddenWorld);
      expect(client.promptsFor('adjudication').join('\n')).toContain(hiddenEntity);
      expect(loaded.turnHistory[0].adjudication.gm_private).toContain(`[Secret Meeting] ${hiddenConversation}`);
      expect(client.calls.some(call => call.kind === 'assessment')).toBe(false);
      expect(client.calls.some(call => call.kind === 'npcMind')).toBe(false);
      expect(client.calls.some(call => call.kind === 'privateConversation')).toBe(false);
      expect(entry.resolutionTrace).toBeUndefined();
      expect(entry.mortalityTrace).toBeUndefined();
      expect(entry.adjudication.entityActions).toEqual([
        expect.objectContaining({ id: 'maximinus_thrax', intent: 'recruit' }),
      ]);
      expect(entry.adjudication.deltas).toEqual([
        expect.objectContaining({
          type: 'resource',
          key: 'maximinus_thrax:independent_preparations',
        }),
      ]);
      expect(loaded.entities.find(entity => entity.entity_id === PLAYER_ID)?.resources)
        .not.toHaveProperty('forbidden_question_artifact');
      expect(loaded.entities.find(entity => entity.entity_id === 'maximinus_thrax')?.resources)
        .toHaveProperty('independent_preparations', 1);
      expect(loaded.reports).toEqual([]);
      expect(loaded.truthLedger).toEqual([]);
      expect(loaded.knowledge).toEqual([
        expect.objectContaining({
          subject: 'maximinus_thrax',
          claim: expect.stringContaining('independent preparations'),
        }),
      ]);
      expect(JSON.stringify(loaded.knowledge)).not.toContain('forbidden_question_artifact');
      expect(JSON.stringify(loaded.knowledge)).not.toContain(poisonedPlayerDelta);
      expect(entry).not.toHaveProperty('resolutionTrace');
      expect(entry).not.toHaveProperty('mortalityTrace');
      expect(entry.rawCalls?.map(call => call.callName)).not.toContain('actionAssessment');
      const playerPerceivedOutputs = JSON.stringify({
        narration: entry.narration,
        messages: loaded.messages,
        reports: loaded.reports,
        knowledge: loaded.knowledge,
        suggestedActions: loaded.suggestedActions,
        currentEvents: loaded.currentEvents,
      });
      expect(playerPerceivedOutputs).not.toContain(hiddenWorld);
      expect(playerPerceivedOutputs).not.toContain(hiddenEntity);
      expect(playerPerceivedOutputs).not.toContain(hiddenConversation);

      const privateIntent = 'PRIVATE_SEQUENCE_SENTINEL: wait until the Senate divides.';
      const monologuesBeforePrivate = loaded.messages.filter(message => message.sender === 'player_monologue').length;
      const privateRunner = new JourneyRunner({
        name: 'structuredInput/private-only',
        thread: threadFromSave(loadThreadState()),
      });
      const privateClient = clientForTurn(privateRunner, 3, 'structuredInput/private-only', {
        includeAssessment: false,
        includePlayerPresentation: false,
        includeRelationshipUpdates: false,
        includeAmbition: true,
      });
      installAppGeminiScript(privateClient);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private Intent'), privateIntent);
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(4));
      await waitForApp(() => expect(privateClient.calls.some(call => call.kind === 'ambition')).toBe(true));

      const afterPrivate = loadThreadState();
      privateClient.expectCallSequence([
        'storyRelevance', 'adjudication', 'simulationState', 'relationshipObservations', 'ambition',
      ]);
      expect(selectorCalls).toHaveLength(1);
      expect(afterPrivate.turnHistory.at(-1)?.narration).toBe(PRIVATE_INTENT_ACKNOWLEDGEMENT);
      expect(afterPrivate.messages.filter(message => message.sender === 'gm').at(-1)?.text)
        .toBe(PRIVATE_INTENT_ACKNOWLEDGEMENT);
      expect(afterPrivate.messages.filter(message => message.sender === 'player_monologue')).toHaveLength(monologuesBeforePrivate);
      expect(privateClient.calls.flatMap(call => [call.prompt, call.systemInstruction]).join('\n'))
        .not.toContain(privateIntent);

      const mixedAction = 'Address the Senate and ask the western benches to name their absent members.';
      const mixedQuestion = 'Which senators answer publicly?';
      const mixedPrivateIntent = 'PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED';
      const mixedNarration = 'The western benches answer in public, each senator naming the colleagues they expected to attend.';
      const mixedMonologue = 'I intend to judge only what is before me, and keep counsel with myself.';
      const mixedRunner = new JourneyRunner({
        name: 'structuredInput/observable-mixed',
        thread: threadFromSave(loadThreadState()),
      });
      const mixedClient = clientForTurn(mixedRunner, 4, 'structuredInput/observable-mixed', {
        narration: mixedNarration,
      });
      installAppGeminiScript(mixedClient);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Action 1'), mixedAction);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Question / Context'), mixedQuestion);
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Private Intent'), mixedPrivateIntent);
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(5));

      const afterMixed = loadThreadState();
      mixedClient.expectCallSequence([
        'storyRelevance', 'assessment', 'adjudication', 'simulationState',
        'monologue', 'narration', 'relationshipUpdates', 'relationshipObservations',
      ]);
      expect(selectorCalls).toHaveLength(1);
      expect(afterMixed.turnHistory.at(-1)?.narration).toBe(mixedNarration);
      expect(afterMixed.messages.filter(message => message.sender === 'gm').at(-1)?.text).toBe(mixedNarration);
      expect(afterMixed.messages.filter(message => message.sender === 'player_monologue').at(-1)?.text).toBe(mixedMonologue);
      expect(mixedClient.promptsFor('narration').join('\n')).toContain(mixedPrivateIntent);
      expect(mixedClient.promptsFor('monologue').join('\n')).toContain(mixedPrivateIntent);
      expect(mixedClient.promptsFor('adjudication').join('\n')).not.toContain(mixedPrivateIntent);
      expect(mixedClient.promptsFor('adjudication').join('\n')).toContain(mixedQuestion);
      for (const kind of [
        'storyRelevance', 'assessment', 'simulationState',
        'relationshipUpdates', 'relationshipObservations',
      ] as const) {
        expect(mixedClient.promptsFor(kind).join('\n')).not.toContain(mixedPrivateIntent);
      }

      const finalResponses = [answer, PRIVATE_INTENT_ACKNOWLEDGEMENT, mixedNarration];
      expect(afterMixed.turnHistory.slice(-3).map(historyEntry => historyEntry.narration)).toEqual(finalResponses);
      expect(afterMixed.messages.filter(message => message.sender === 'gm').slice(-3).map(message => message.text))
        .toEqual(finalResponses);
      const playerVisibleResponseText = afterMixed.messages
        .filter(message => message.sender !== 'player')
        .map(message => message.text)
        .join('\n');
      for (const forbidden of [
        hiddenEntity,
        hiddenConversation,
        hiddenTruth,
        gmPrivatePoison,
        rawDeltaPoison,
        poisonedPlayerAction,
        poisonedPlayerDelta,
        'gm_private',
        'secret_truth',
        'resolutionTrace',
        'mortalityTrace',
        'outcome_tier',
      ]) {
        expect(playerVisibleResponseText).not.toContain(forbidden);
      }

      const playerDisclosure = Array.from(app.container.querySelectorAll('details')).find(details =>
        details.querySelector('summary')?.textContent === 'Private Intent');
      expect(playerDisclosure).toBeDefined();
      expect(playerDisclosure!.open).toBe(false);
      const { act } = await import('react');
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'G',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })));
      await waitForApp(() => expect(app.container.textContent).toContain('GM Log'));
      await appClick(appButton(app.container, 'GM Log'));
      await waitForApp(() => expect(app.container.textContent).toContain(privateIntent));
      expect(app.container.textContent).toContain(mixedPrivateIntent);

      const exactAutosave = structuredClone(loadGame());
      expect(exactAutosave?.version).toBe(1);
      await app.unmount();
      reloaded = await mountJourneyAppFromAutosave();
      expect(loadGame()).toEqual(exactAutosave);
      const reloadedState = loadThreadState();
      expect(reloadedState.turnNumber).toBe(5);
      expect(reloadedState.turnHistory.slice(-3).map(historyEntry => historyEntry.narration)).toEqual(finalResponses);
      expect(reloadedState.messages.filter(message => message.sender === 'gm').slice(-3).map(message => message.text))
        .toEqual(finalResponses);
      for (const response of finalResponses) {
        expect(reloaded.container.textContent).toContain(response);
      }
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
    }
  });
});
