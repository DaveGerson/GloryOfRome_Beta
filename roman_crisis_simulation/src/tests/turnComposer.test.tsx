/**
 * @vitest-environment jsdom
 *
 * Contract tests for the independent Chat / Structured composer. Deliberately
 * uses only React 19 act() and react-dom: the repository has no testing-library
 * dependency, and this lane must not add one.
 */
import React, { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { TurnComposer, type TurnComposerProps } from '../components/TurnComposer';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { TURN_SUBMISSION_PREFIX } from '../playerInput/turnSubmission';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPIENT_OPTIONS: readonly KnownRecipientOption[] = [
  { entityId: 'julia_domna', displayName: 'Julia Domna' },
  { entityId: 'cassius_dio', displayName: 'Cassius Dio' },
];
const HIDDEN_NAME_SENTINEL = 'THE_HIDDEN_OMNISCIENT_NAME';

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  localStorage.clear();
  vi.restoreAllMocks();
});

function defaultProps(overrides: Partial<TurnComposerProps> = {}): TurnComposerProps {
  return {
    chatDraft: '',
    structuredDraft: emptyStructuredDraft(),
    recipientOptions: RECIPIENT_OPTIONS,
    suggestedActions: [],
    disabled: false,
    isProcessing: false,
    onChatDraftChange: () => {},
    onStructuredDraftChange: () => {},
    onSubmit: () => {},
    ...overrides,
  };
}

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));

  return {
    container,
    rerender: async (next: React.ReactElement) => {
      await act(async () => root.render(next));
    },
  };
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    candidate => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
  );
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

function byAriaLabel<T extends Element>(container: HTMLElement, label: string): T {
  const control = container.querySelector(`[aria-label="${label}"]`);
  expect(control, `control with aria-label="${label}"`).not.toBeNull();
  return control as T;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  expect(descriptor?.set).toBeTypeOf('function');
  await act(async () => {
    descriptor!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    }));
  });
}

async function keyDown(
  element: HTMLElement,
  init: KeyboardEventInit,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => element.dispatchEvent(event));
  return event;
}

describe('components/TurnComposer', () => {
  it('defaults visibly to Chat and exposes an accessible, correctly ordered Structured form', async () => {
    const { container } = await mount(<TurnComposer {...defaultProps()} />);
    const chatMode = buttonNamed(container, 'Chat');
    const structuredMode = buttonNamed(container, 'Structured');

    expect(chatMode.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('textarea[aria-label="Chat input"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/20,000 characters remaining/i);

    await click(structuredMode);

    expect(structuredMode.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('gloryOfRome:composerMode')).toBe('structured');
    for (const label of ['Actions', 'Messages / Orders', 'Private Intent', 'Question / Context']) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toMatch(/private[^.]*avatar/i);
    expect(container.textContent).toMatch(/question[^.]*does not[^.]*autonomous action/i);

    const action = byAriaLabel<HTMLTextAreaElement>(container, 'Action 1');
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const command = byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1');
    const privateIntent = byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent');
    const question = byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context');
    const addAction = buttonNamed(container, 'Add action row');
    const addMessage = buttonNamed(container, 'Add message or order row');
    const submit = buttonNamed(container, 'Submit turn');

    expect(action.value).toBe('');
    expect(recipient.value).toBe('');
    expect(command.value).toBe('');

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled])',
    ));
    expect(submit.disabled).toBe(true);
    const ordered = [action, addAction, recipient, command, addMessage, privateIntent, question]
      .map(control => focusable.indexOf(control));
    expect(ordered.every(index => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('builds every recipient selector only from safe options plus placeholder/custom, and discards custom text when a known recipient is selected', async () => {
    let latestDraft = emptyStructuredDraft();
    const collisionOptions: readonly KnownRecipientOption[] = [
      ...RECIPIENT_OPTIONS,
      { entityId: '__custom_recipient__', displayName: 'Collision-proof known recipient' },
    ];

    function Harness() {
      const [draft, setDraft] = useState(emptyStructuredDraft());
      latestDraft = draft;
      return (
        <TurnComposer
          {...defaultProps()}
          structuredDraft={draft}
          recipientOptions={collisionOptions}
          onStructuredDraftChange={setDraft}
        />
      );
    }

    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    await click(buttonNamed(container, 'Add message or order row'));

    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      const options = Array.from(select.options);
      expect(options.map(option => option.textContent)).toEqual([
        expect.stringMatching(/select|choose/i),
        'Julia Domna',
        'Cassius Dio',
        'Collision-proof known recipient',
        'Someone else…',
      ]);
      expect(options[0].value).toBe('');
      expect(options[0].disabled).toBe(false);
    }
    expect(container.textContent).not.toContain(HIDDEN_NAME_SENTINEL);

    const collisionOption = Array.from(selects[1].options).find(
      option => option.textContent === 'Collision-proof known recipient',
    )!;
    expect(collisionOption.value).toMatch(/^known:/);
    await setValue(selects[1], collisionOption.value);
    expect(latestDraft.messagesOrOrders[1].recipient).toEqual({
      kind: 'known_entity', entityId: '__custom_recipient__',
    });

    const customOption = Array.from(selects[0].options).find(
      option => option.textContent === 'Someone else…',
    )!;
    await setValue(selects[0], customOption.value);

    const customRecipient = byAriaLabel<HTMLInputElement>(container, 'Custom recipient 1');
    expect(customRecipient.autocomplete).toBe('off');
    await setValue(customRecipient, 'An unnamed dockmaster');
    expect(latestDraft.messagesOrOrders[0].recipient).toEqual({
      kind: 'free_text',
      text: 'An unnamed dockmaster',
    });

    const knownOption = Array.from(selects[0].options).find(
      option => option.textContent === 'Julia Domna',
    )!;
    await setValue(selects[0], knownOption.value);

    expect(container.querySelector('[aria-label="Custom recipient 1"]')).toBeNull();
    expect(latestDraft.messagesOrOrders[0].recipient).toEqual({
      kind: 'known_entity',
      entityId: 'julia_domna',
    });
    expect(JSON.stringify(latestDraft)).not.toContain('An unnamed dockmaster');
    expect(container.textContent).not.toContain(HIDDEN_NAME_SENTINEL);
  });

  it('lets a selected recipient with no command return to a valid blank row', async () => {
    let latestDraft = emptyStructuredDraft();

    function Harness() {
      const [draft, setDraft] = useState(emptyStructuredDraft());
      latestDraft = draft;
      return (
        <TurnComposer
          {...defaultProps()}
          structuredDraft={draft}
          onStructuredDraftChange={setDraft}
        />
      );
    }

    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));

    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const placeholder = recipient.options[0];
    const knownRecipient = Array.from(recipient.options).find(
      option => option.textContent === 'Julia Domna',
    )!;

    await setValue(recipient, knownRecipient.value);
    expect(latestDraft.messagesOrOrders[0]).toEqual({
      recipient: { kind: 'known_entity', entityId: 'julia_domna' },
      command: '',
    });

    expect(placeholder.disabled).toBe(false);
    await setValue(recipient, placeholder.value);

    expect(recipient.value).toBe('');
    expect(latestDraft.messagesOrOrders[0]).toEqual({ recipient: null, command: '' });
  });

  it('adds repeatable action and message/order rows and locks form actions while processing', async () => {
    function Harness({ disabled = false, isProcessing = false }) {
      const [draft, setDraft] = useState(emptyStructuredDraft());
      return (
        <TurnComposer
          {...defaultProps()}
          structuredDraft={draft}
          disabled={disabled}
          isProcessing={isProcessing}
          onStructuredDraftChange={setDraft}
        />
      );
    }

    const { container, rerender } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));

    await click(buttonNamed(container, 'Add action row'));
    await click(buttonNamed(container, 'Add message or order row'));
    expect(container.querySelectorAll('textarea[aria-label^="Action "]')).toHaveLength(2);
    expect(container.querySelectorAll('select[aria-label^="Recipient "]')).toHaveLength(2);

    await rerender(<Harness disabled isProcessing />);

    const formControls = Array.from(container.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement
    >('input, textarea, select, button')).filter(
      control => control.textContent?.trim() !== 'Chat' && control.textContent?.trim() !== 'Structured',
    );
    expect(formControls.length).toBeGreaterThan(0);
    expect(formControls.every(control => control.disabled)).toBe(true);
  });

  it('reports the exact 20,000-character Chat boundary, associates the error, and blocks over-limit submission without truncation', async () => {
    const onSubmit = vi.fn();
    const exact = 'x'.repeat(20_000);
    const { container, rerender } = await mount(
      <TurnComposer {...defaultProps({ chatDraft: exact, onSubmit })} />,
    );

    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    const exactStatus = container.querySelector<HTMLElement>('[role="status"]');
    expect(exactStatus?.textContent).toMatch(/0 characters remaining/i);
    expect(input.getAttribute('aria-describedby')).toBe(exactStatus?.id);
    expect(buttonNamed(container, 'Send message').disabled).toBe(false);

    const over = `${exact}x`;
    await rerender(<TurnComposer {...defaultProps({ chatDraft: over, onSubmit })} />);

    const overInput = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(overInput.value).toHaveLength(20_001);
    expect(error?.textContent).toMatch(/1 character over limit/i);
    expect(overInput.getAttribute('aria-invalid')).toBe('true');
    expect(overInput.getAttribute('aria-describedby')).toBe(error?.id);
    expect(buttonNamed(container, 'Send message').disabled).toBe(true);

    await keyDown(overInput, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses the canonical artifact boundary for trimmed, reserved, and structured submissions without truncation', async () => {
    const onSubmit = vi.fn();
    const reserved = `${TURN_SUBMISSION_PREFIX}not JSON`;
    const { container, rerender } = await mount(
      <TurnComposer {...defaultProps({ chatDraft: `  ${reserved}  ` , onSubmit })} />,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      `${(20_000 - (TURN_SUBMISSION_PREFIX.length + JSON.stringify({ version: 1, kind: 'freeform', text: reserved }).length)).toLocaleString('en-US')} characters remaining`,
    );

    const oversizedStructured: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      actions: ['x'.repeat(20_000)],
    };
    await click(buttonNamed(container, 'Structured'));
    await rerender(<TurnComposer {...defaultProps({ structuredDraft: oversizedStructured, onSubmit })} />);
    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toMatch(/character.*over limit/i);
    expect(buttonNamed(container, 'Submit turn').disabled).toBe(true);
    await click(buttonNamed(container, 'Submit turn'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1').value).toHaveLength(20_000);
  });

  it('keeps an over-limit structured draft editable until its canonical artifact is valid again', async () => {
    const oversized: StructuredTurnDraft = { ...emptyStructuredDraft(), actions: ['x'.repeat(20_000)] };
    function Harness() {
      const [draft, setDraft] = useState(oversized);
      return <TurnComposer {...defaultProps({ structuredDraft: draft, onStructuredDraftChange: setDraft })} />;
    }
    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    const action = byAriaLabel<HTMLTextAreaElement>(container, 'Action 1');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(action.disabled).toBe(false);
    expect(action.getAttribute('aria-invalid')).toBe('true');
    expect(action.getAttribute('aria-describedby')).toBe(error?.id);
    expect(buttonNamed(container, 'Submit turn').disabled).toBe(true);
    await setValue(action, 'Address the Senate');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(buttonNamed(container, 'Submit turn').disabled).toBe(false);
  });

  it('preserves an authored command when clearing its recipient and leaves submission truthfully blocked', async () => {
    const authored: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'julia_domna' }, command: 'Bring the ledger.' }],
    };
    function Harness() {
      const [draft, setDraft] = useState(authored);
      return <TurnComposer {...defaultProps({ structuredDraft: draft, onStructuredDraftChange: setDraft })} />;
    }
    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const command = byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1');

    await setValue(recipient, '');

    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(command.value).toBe('Bring the ledger.');
    expect(recipient.value).toBe('');
    expect(error?.textContent).toMatch(/recipient and command are both required/i);
    expect(recipient.disabled).toBe(false);
    expect(command.disabled).toBe(false);
    expect(buttonNamed(container, 'Submit turn').disabled).toBe(true);
  });

  it('blocks invalid structured submission while leaving the transient row editable', async () => {
    const invalid: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'julia_domna' }, command: '' }],
    };
    const { container } = await mount(<TurnComposer {...defaultProps({ structuredDraft: invalid })} />);
    await click(buttonNamed(container, 'Structured'));
    const command = byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1');
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(error?.textContent).toMatch(/recipient and command are both required/i);
    expect(error?.textContent).not.toMatch(/characters remaining/i);
    expect(command.disabled).toBe(false);
    expect(recipient.disabled).toBe(false);
    expect(command.getAttribute('aria-invalid')).toBe('true');
    expect(recipient.getAttribute('aria-invalid')).toBeNull();
    expect(command.getAttribute('aria-describedby')).toBe(error?.id);
    expect(recipient.getAttribute('aria-describedby')).toBeNull();
    expect(buttonNamed(container, 'Submit turn').disabled).toBe(true);
  });

  it('keeps structured validation reasons visible and associated for stale recipients', async () => {
    const stale: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'not-present' }, command: 'Wait.' }],
    };
    const { container } = await mount(<TurnComposer {...defaultProps({ structuredDraft: stale })} />);
    await click(buttonNamed(container, 'Structured'));
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(error?.textContent).toMatch(/selected recipient is unavailable/i);
    expect(error?.textContent).not.toMatch(/characters remaining/i);
    expect(recipient.disabled).toBe(false);
    expect(recipient.getAttribute('aria-invalid')).toBe('true');
    expect(recipient.getAttribute('aria-describedby')).toBe(error?.id);
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1').getAttribute('aria-invalid')).toBeNull();
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1').getAttribute('aria-describedby')).toBeNull();
  });

  it('associates a blank custom recipient with both recipient controls, not its valid command', async () => {
    const invalid: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      messagesOrOrders: [{ recipient: { kind: 'free_text', text: '   ' }, command: 'Wait.' }],
    };
    const { container } = await mount(<TurnComposer {...defaultProps({ structuredDraft: invalid })} />);
    await click(buttonNamed(container, 'Structured'));
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const customRecipient = byAriaLabel<HTMLInputElement>(container, 'Custom recipient 1');
    const command = byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(recipient.getAttribute('aria-describedby')).toBe(error?.id);
    expect(customRecipient.getAttribute('aria-describedby')).toBe(error?.id);
    expect(command.getAttribute('aria-invalid')).toBeNull();
    expect(command.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders the public stage-specific processing label with an accessible live status', async () => {
    const { container } = await mount(
      <TurnComposer {...defaultProps({ isProcessing: true, turnStage: 'relationship_updates' })} />,
    );
    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toMatch(/loyalties quietly shift/i);
  });

  it('keeps Chat Enter/Shift+Enter behavior while Structured uses newline Enter and Ctrl/Cmd+Enter submission', async () => {
    const submissions: Array<string | StructuredTurnDraft> = [];
    const changedDrafts: StructuredTurnDraft[] = [];
    const structuredDraft: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      actions: ['Hold court'],
    };
    const { container } = await mount(
      <TurnComposer
        {...defaultProps({
          chatDraft: 'Speak to the guard',
          structuredDraft,
          onStructuredDraftChange: (draft: StructuredTurnDraft) => changedDrafts.push(draft),
          onSubmit: (input: string | StructuredTurnDraft) => submissions.push(input),
        })}
      />,
    );

    const chat = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    const shifted = await keyDown(chat, { key: 'Enter', shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(submissions).toEqual([]);

    const entered = await keyDown(chat, { key: 'Enter' });
    expect(entered.defaultPrevented).toBe(true);
    expect(submissions).toEqual(['Speak to the guard']);

    await click(buttonNamed(container, 'Structured'));
    const action = byAriaLabel<HTMLTextAreaElement>(container, 'Action 1');
    const plainEnter = await keyDown(action, { key: 'Enter' });
    expect(plainEnter.defaultPrevented).toBe(false);
    await setValue(action, 'Hold court\nThen wait');
    expect(changedDrafts.at(-1)?.actions[0]).toBe('Hold court\nThen wait');

    const ctrlEnter = await keyDown(action, { key: 'Enter', ctrlKey: true });
    const metaEnter = await keyDown(action, { key: 'Enter', metaKey: true });
    expect(ctrlEnter.defaultPrevented).toBe(true);
    expect(metaEnter.defaultPrevented).toBe(true);
    expect(submissions.slice(1)).toEqual([structuredDraft, structuredDraft]);
  });

  it('preserves independent controlled drafts while switching modes', async () => {
    let latestChat = 'Chat draft survives';
    let latestStructured: StructuredTurnDraft = {
      ...emptyStructuredDraft(),
      actions: ['Structured draft survives'],
    };

    function Harness() {
      const [chatDraft, setChatDraft] = useState(latestChat);
      const [structuredDraft, setStructuredDraft] = useState(latestStructured);
      latestChat = chatDraft;
      latestStructured = structuredDraft;
      return (
        <TurnComposer
          {...defaultProps()}
          chatDraft={chatDraft}
          structuredDraft={structuredDraft}
          onChatDraftChange={setChatDraft}
          onStructuredDraftChange={setStructuredDraft}
        />
      );
    }

    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    const action = byAriaLabel<HTMLTextAreaElement>(container, 'Action 1');
    expect(action.value).toBe('Structured draft survives');
    await setValue(action, 'Structured draft edited');

    await click(buttonNamed(container, 'Chat'));
    const chat = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    expect(chat.value).toBe('Chat draft survives');
    await setValue(chat, 'Chat draft edited');

    await click(buttonNamed(container, 'Structured'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1').value)
      .toBe('Structured draft edited');
    expect(latestChat).toBe('Chat draft edited');
    expect(latestStructured.actions).toEqual(['Structured draft edited']);
  });

  it('can clear only the submitted draft on success and accept the exact prior draft on failure restoration', async () => {
    const priorStructured: StructuredTurnDraft = {
      actions: ['Secure the granaries\nwithout bloodshed'],
      messagesOrOrders: [{
        recipient: { kind: 'free_text', text: 'The night watch captain' },
        command: 'Seal the eastern gate.\nAdmit only grain carts.',
      }],
      privateIntent: 'Learn who profits.',
      questionOrContext: 'The guard rotation changed yesterday.',
    };
    const submitted: Array<string | StructuredTurnDraft> = [];
    let restoreStructured: (draft: StructuredTurnDraft) => void = () => {};

    function Harness() {
      const [chatDraft, setChatDraft] = useState('Chat remains untouched');
      const [structuredDraft, setStructuredDraft] = useState(priorStructured);
      restoreStructured = setStructuredDraft;
      return (
        <TurnComposer
          {...defaultProps()}
          chatDraft={chatDraft}
          structuredDraft={structuredDraft}
          onChatDraftChange={setChatDraft}
          onStructuredDraftChange={setStructuredDraft}
          onSubmit={(input: string | StructuredTurnDraft) => {
            submitted.push(input);
            if (typeof input === 'string') setChatDraft('');
            else setStructuredDraft(emptyStructuredDraft());
          }}
        />
      );
    }

    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    await keyDown(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), {
      key: 'Enter',
      ctrlKey: true,
    });

    expect(submitted).toEqual([priorStructured]);
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1').value).toBe('');
    await click(buttonNamed(container, 'Chat'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value)
      .toBe('Chat remains untouched');

    await act(async () => restoreStructured(priorStructured));
    await click(buttonNamed(container, 'Structured'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1').value)
      .toBe('Secure the granaries\nwithout bloodshed');
    expect(byAriaLabel<HTMLInputElement>(container, 'Custom recipient 1').value)
      .toBe('The night watch captain');
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1').value)
      .toBe('Seal the eastern gate.\nAdmit only grain carts.');
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent').value)
      .toBe('Learn who profits.');
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context').value)
      .toBe('The guard rotation changed yesterday.');
  });

  it('appends two suggested pills as action rows without submitting, switching modes, or removing either pill', async () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [draft, setDraft] = useState(emptyStructuredDraft());
      return (
        <TurnComposer
          {...defaultProps({
            structuredDraft: draft,
            suggestedActions: ['Address the Senate', 'Write to Lucius'],
            onStructuredDraftChange: setDraft,
            onSubmit,
          })}
        />
      );
    }

    const { container } = await mount(<Harness />);
    await click(buttonNamed(container, 'Structured'));
    await click(buttonNamed(container, 'Address the Senate'));
    await click(buttonNamed(container, 'Write to Lucius'));

    const actions = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label^="Action "]'),
      textarea => textarea.value,
    );
    expect(actions).toEqual(['Address the Senate', 'Write to Lucius']);
    expect(buttonNamed(container, 'Address the Senate')).not.toBeNull();
    expect(buttonNamed(container, 'Write to Lucius')).not.toBeNull();
    expect(buttonNamed(container, 'Structured').getAttribute('aria-pressed')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
