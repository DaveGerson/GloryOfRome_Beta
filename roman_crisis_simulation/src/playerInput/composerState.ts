import { TURN_SUBMISSION_VERSION, type KnownRecipientOption, type MessageOrOrderDraft, type StructuredTurnDraft } from '../types';
import { MAX_TURN_SUBMISSION_CHARACTERS, canonicalArtifactForTurnSubmission } from './turnSubmission';

const blankMessageOrOrder = (): MessageOrOrderDraft => ({ recipient: null, command: '' });

export function emptyStructuredDraft(): StructuredTurnDraft {
  return {
    actions: [''],
    messagesOrOrders: [blankMessageOrOrder()],
    privateIntent: '',
    questionOrContext: '',
  };
}

export function appendSuggestedAction(
  draft: StructuredTurnDraft,
  action: string,
): StructuredTurnDraft {
  const actions = draft.actions.length === 1 && draft.actions[0] === ''
    ? [action]
    : [...draft.actions, action];
  return { ...draft, actions };
}

export function addMessageOrOrderRow(draft: StructuredTurnDraft): StructuredTurnDraft {
  return {
    ...draft,
    messagesOrOrders: [...draft.messagesOrOrders, blankMessageOrOrder()],
  };
}

export function addActionRow(draft: StructuredTurnDraft): StructuredTurnDraft {
  return { ...draft, actions: [...draft.actions, ''] };
}

export function updateActionRow(draft: StructuredTurnDraft, index: number, value: string): StructuredTurnDraft {
  return { ...draft, actions: draft.actions.map((action, rowIndex) => rowIndex === index ? value : action) };
}

function updateMessageOrOrderRow(
  draft: StructuredTurnDraft,
  index: number,
  row: MessageOrOrderDraft,
): StructuredTurnDraft {
  return { ...draft, messagesOrOrders: draft.messagesOrOrders.map((current, rowIndex) => rowIndex === index ? row : current) };
}

export function selectMessageRecipient(draft: StructuredTurnDraft, index: number, value: string): StructuredTurnDraft {
  const row = draft.messagesOrOrders[index];
  if (!row) return draft;
  if (!value) return updateMessageOrOrderRow(draft, index, blankMessageOrOrder());
  return updateMessageOrOrderRow(draft, index, {
    recipient: value === '__custom_recipient__'
      ? { kind: 'free_text', text: '' }
      : { kind: 'known_entity', entityId: value },
    command: row.command,
  });
}

export function updateCustomRecipient(draft: StructuredTurnDraft, index: number, text: string): StructuredTurnDraft {
  const row = draft.messagesOrOrders[index];
  return !row ? draft : updateMessageOrOrderRow(draft, index, {
    ...row,
    recipient: { kind: 'free_text', text },
  });
}

export function updateMessageCommand(draft: StructuredTurnDraft, index: number, command: string): StructuredTurnDraft {
  const row = draft.messagesOrOrders[index];
  return !row ? draft : updateMessageOrOrderRow(draft, index, { ...row, command });
}

export function updatePrivateIntent(draft: StructuredTurnDraft, privateIntent: string): StructuredTurnDraft {
  return { ...draft, privateIntent };
}

export function updateQuestionOrContext(draft: StructuredTurnDraft, questionOrContext: string): StructuredTurnDraft {
  return { ...draft, questionOrContext };
}

export function canonicalArtifactStatus(
  input: string | StructuredTurnDraft,
  recipientOptions: readonly KnownRecipientOption[],
): { ok: true; characterCount: number; overLimit: boolean } | { ok: false; characterCount: 0; overLimit: false } {
  const draft = typeof input === 'string'
    ? { version: TURN_SUBMISSION_VERSION, kind: 'freeform' as const, text: input }
    : input;
  const result = canonicalArtifactForTurnSubmission(draft, { knownRecipients: recipientOptions });
  return result.ok
    ? { ok: true, characterCount: result.artifact.length, overLimit: result.artifact.length > MAX_TURN_SUBMISSION_CHARACTERS }
    : { ok: false, characterCount: 0, overLimit: false };
}
