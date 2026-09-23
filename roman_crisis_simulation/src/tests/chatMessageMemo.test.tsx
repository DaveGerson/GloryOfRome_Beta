/**
 * @vitest-environment jsdom
 *
 * components/Chat.tsx's ChatMessage is memoised: App re-renders on every
 * streamed narration chunk, and the committed transcript must not re-parse
 * itself each time. Observed through the one parse every player bubble does
 * (`deserializeTurnSubmission`), spied via a pass-through module mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Message } from '../types';

const parseSpy = vi.hoisted(() => vi.fn());
vi.mock('../playerInput/turnSubmission', async importOriginal => {
  const actual = await importOriginal<typeof import('../playerInput/turnSubmission')>();
  return {
    ...actual,
    deserializeTurnSubmission: (...args: Parameters<typeof actual.deserializeTurnSubmission>) => {
      parseSpy(...args);
      return actual.deserializeTurnSubmission(...args);
    },
  };
});

import { ChatMessage } from '../components/Chat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Transcript: React.FC<{ messages: Message[]; chunk: string }> = ({ messages, chunk }) => (
  <div>
    {messages.map((message, index) => <ChatMessage key={index} message={message} />)}
    <span data-chunk>{chunk}</span>
  </div>
);

describe('ChatMessage memoisation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    parseSpy.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('does not re-render committed messages when only the live stream changes', () => {
    const messages: Message[] = [
      { sender: 'player', text: 'I write to the Senate.' },
      { sender: 'gm', text: 'The Senate hears you.' },
      { sender: 'player', text: 'I wait.' },
    ];
    act(() => root.render(<Transcript messages={messages} chunk="" />));
    const afterMount = parseSpy.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    for (const chunk of ['The', 'The chron', 'The chronicler writes']) {
      act(() => root.render(<Transcript messages={messages} chunk={chunk} />));
    }
    expect(parseSpy.mock.calls.length).toBe(afterMount);
    expect(host.textContent).toContain('The chronicler writes');
  });

  it('still renders a message that actually changed', () => {
    const first: Message = { sender: 'player', text: 'First draft.' };
    act(() => root.render(<Transcript messages={[first]} chunk="" />));
    const before = parseSpy.mock.calls.length;
    act(() => root.render(<Transcript messages={[{ sender: 'player', text: 'Second draft.' }]} chunk="" />));
    expect(parseSpy.mock.calls.length).toBeGreaterThan(before);
    expect(host.textContent).toContain('Second draft.');
    expect(host.textContent).not.toContain('First draft.');
  });
});
