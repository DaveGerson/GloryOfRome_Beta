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
  scriptedFailure,
  scriptedJsonArray,
  waitForApp,
} from './harness';
import {
  scriptAdjudication,
  scriptAssessmentIdle,
  scriptNarration,
  scriptRelationshipDeltas,
  scriptSimulationState,
  scriptStoryRelevance,
} from './fixtures';
import { deserializeTurnSubmission } from '../../playerInput/turnSubmission';

afterEach(() => clearAppGeminiScript());

function clientForTurn(
  seed: JourneyRunner,
  turn: number,
  label: string,
  options: { relationshipFailure?: Error; narration?: string; includeAssessment?: boolean } = {},
): ScriptedClient {
  return new ScriptedClient({
    storyRelevance: scriptStoryRelevance(),
    ...(options.includeAssessment === false ? {} : { assessment: scriptAssessmentIdle() }),
    adjudication: scriptAdjudication(turn),
    simulationState: scriptSimulationState(seed.thread.simulationState),
    monologue: 'I will judge only what is before me, and keep counsel with myself.',
    narration: scriptNarration(options.narration ?? 'The Emperor hears the petitions of Rome.', [
      'Consult Julia Mamaea',
      'Address the Senate',
      'Inspect the Guard',
    ]),
    relationshipUpdates: scriptRelationshipDeltas([]),
    relationshipObservations: options.relationshipFailure
      ? scriptedFailure(options.relationshipFailure)
      : scriptedJsonArray([]),
  }, label);
}

describe('journey: structured player input through the real App transaction', () => {
  it('moves Chat to Structured, canonicalizes ordered recipients, and retries the exact frozen turn once', async () => {
    const seed = new JourneyRunner({ name: 'structuredInput/mixed' });
    const chatClient = clientForTurn(seed, 1, 'structuredInput/chat');
    installAppGeminiScript(chatClient);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    const expectedChat = 'Hear the petitions of Rome.';
    const unsentChatDraft = 'Keep this separate chat draft untouched.';
    const privateIntent = 'PRIVATE_INTENT_SENTINEL: preserve room to bargain.';
    const question = 'QUESTION_SENTINEL: which faction is watching the doors?';

    try {
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), expectedChat);
      await appClick(appButton(app.container, 'Send message'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      expect(chatClient.unconsumed()).toEqual([]);

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

      // Fail at the final provider call, after the whole real turn pipeline ran.
      const failed = clientForTurn(seed, 2, 'structuredInput/failure', {
        relationshipFailure: new Error('deliberate relationship provider failure'),
      });
      installAppGeminiScript(failed);
      const expectedConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(app.container.textContent).toContain('Your draft has been restored'));
      expectedConsole.mockRestore();
      expect(loadThreadState().turnNumber).toBe(2);
      expect(loadThreadState().turnHistory).toHaveLength(1);
      expect(appControl<HTMLTextAreaElement>(app.container, 'Action 1').value).toBe('Address the Senate in open session.');
      expect(appControl<HTMLTextAreaElement>(app.container, 'Private Intent').value).toBe(privateIntent);

      const retried = clientForTurn(seed, 2, 'structuredInput/retry');
      installAppGeminiScript(retried);
      await appClick(appButton(app.container, 'Retry the last action'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(3));

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
      expect(retried.calls).toEqual(failed.calls);
      for (const kind of ['storyRelevance', 'assessment', 'relationshipUpdates', 'relationshipObservations'] as const) {
        const externalPrompt = retried.promptsFor(kind).join('\n');
        expect(externalPrompt).not.toContain(privateIntent);
        expect(externalPrompt).not.toContain(question);
      }

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

      await appClick(appButton(app.container, 'Chat'));
      expect(appControl<HTMLTextAreaElement>(app.container, 'Chat input').value).toBe(unsentChatDraft);
    } finally {
      await app.unmount();
    }
  });

  it('answers a question from the avatar viewpoint without assessing or fabricating an action', async () => {
    const seed = new JourneyRunner({ name: 'structuredInput/question-only' });
    const answer = 'From the imperial dais, you can see the senatorial benches are unusually sparse; nothing beyond that is established.';
    const client = clientForTurn(seed, 1, 'structuredInput/question-only', {
      includeAssessment: false,
      narration: answer,
    });
    installAppGeminiScript(client);
    const app = await mountJourneyApp(buildSaveStateFromThread(seed.thread));
    try {
      await appClick(appButton(app.container, 'Structured'));
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Question / Context'), 'What can I tell from the empty benches?');
      await appClick(appButton(app.container, 'Submit turn'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));

      const loaded = loadThreadState();
      const entry = loaded.turnHistory[0];
      expect(app.container.textContent).toContain(answer);
      expect(client.calls.some(call => call.kind === 'assessment')).toBe(false);
      expect(client.calls.some(call => call.kind === 'npcMind')).toBe(false);
      expect(entry.resolutionTrace).toBeUndefined();
      expect(entry.mortalityTrace).toBeUndefined();
      expect(entry.adjudication.deltas).toEqual([]);
      expect(loaded.reports).toEqual([]);
      expect(loaded.truthLedger).toEqual([]);
      expect(loaded.knowledge).toEqual([]);
      expect(entry).not.toHaveProperty('resolutionTrace');
      expect(entry).not.toHaveProperty('mortalityTrace');
      expect(entry.rawCalls?.map(call => call.callName)).not.toContain('actionAssessment');
    } finally {
      await app.unmount();
    }
  });
});
