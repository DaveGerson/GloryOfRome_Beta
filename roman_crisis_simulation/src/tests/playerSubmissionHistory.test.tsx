/**
 * @vitest-environment jsdom
 *
 * Player transcript contract for canonical turn submissions. The committed
 * Message remains plaintext, but Chat must parse that plaintext through the
 * public submission projection instead of exposing the storage envelope.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { ChatMessage } from '../components/Chat';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { TurnSubmission } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
});

async function renderPlayerMessage(text: string): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<ChatMessage message={{ sender: 'player', text }} />);
  });
  return container;
}

const structuredSubmission: TurnSubmission = {
  version: 1,
  kind: 'structured',
  actions: ['Address the Senate', 'Inspect the grain ledgers'],
  messagesOrOrders: [
    {
      recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
      command: 'Meet me at dusk',
    },
    {
      recipient: { kind: 'free_text', text: 'the night watch' },
      command: 'Keep the eastern gate open',
    },
  ],
  privateIntent: 'PRIVATE_HISTORY_SENTINEL_BACK_CLODIUS',
  questionOrContext: 'What can I infer from the empty benches?',
};

describe('player submission history', () => {
  it('renders every authored field while keeping Private Intent collapsed and implementation IDs hidden', async () => {
    const artifact = serializeTurnSubmission(structuredSubmission);
    const container = await renderPlayerMessage(artifact);

    expect(container.textContent).not.toContain('GOR_TURN_SUBMISSION/1');
    expect(container.textContent).not.toContain('"entityId"');
    expect(container.textContent).not.toContain('[lucius]');
    for (const text of [
      'Actions',
      'Address the Senate',
      'Inspect the grain ledgers',
      'Messages / Orders',
      'Lucius',
      'Meet me at dusk',
      'the night watch',
      'Keep the eastern gate open',
      'Question / Context',
      'What can I infer from the empty benches?',
    ]) {
      expect(container.textContent).toContain(text);
    }

    const privateDisclosure = container.querySelector('details');
    expect(privateDisclosure).not.toBeNull();
    expect(privateDisclosure!.open).toBe(false);
    expect(privateDisclosure!.querySelector('summary')?.textContent).toMatch(/Private Intent/i);
    expect(privateDisclosure!.textContent).toContain('PRIVATE_HISTORY_SENTINEL_BACK_CLODIUS');
  });

  it('keeps legacy plaintext as one ordinary player bubble', async () => {
    const container = await renderPlayerMessage('I **warn** the Senate');
    const bubble = container.querySelector('.gor-msg-player');

    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe('I warn the Senate');
    expect(bubble!.querySelector('strong')?.textContent).toBe('warn');
    expect(bubble!.textContent).not.toContain('**');
    expect(bubble!.textContent).not.toContain('GOR_TURN_SUBMISSION/');
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('Actions');
    expect(container.textContent).not.toContain('Messages / Orders');
    expect(container.textContent).not.toContain('Private Intent');
  });

  it('renders enveloped reserved-prefix freeform as authored text but fail-closes malformed and future artifacts', async () => {
    const authored = 'GOR_TURN_SUBMISSION/not-an-artifact\nI **warn** the Senate';
    const validContainer = await renderPlayerMessage(serializeTurnSubmission({ version: 1, kind: 'freeform', text: authored }));
    const validBubble = validContainer.querySelector('.gor-msg-player');
    expect(validBubble).not.toBeNull();
    expect(validBubble!.textContent).toBe('GOR_TURN_SUBMISSION/not-an-artifact\nI warn the Senate');
    expect(validBubble!.querySelector('strong')?.textContent).toBe('warn');
    expect(validBubble!.textContent).not.toContain('**');
    expect(validContainer.textContent).not.toContain('"kind"');

    const malformed = await renderPlayerMessage('GOR_TURN_SUBMISSION/1\n{poisoned');
    expect(malformed.textContent).toContain('Invalid turn submission artifact.');
    expect(malformed.textContent).not.toContain('GOR_TURN_SUBMISSION/');
    expect(malformed.textContent).not.toContain('{poisoned');

    const future = await renderPlayerMessage('GOR_TURN_SUBMISSION/99\n{"private":"never show"}');
    expect(future.textContent).toContain('Invalid turn submission artifact.');
    expect(future.textContent).not.toContain('GOR_TURN_SUBMISSION/');
    expect(future.textContent).not.toContain('"private"');
    expect(future.textContent).not.toContain('never show');
  });
});
