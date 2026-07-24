import { TURN_SUBMISSION_VERSION, type KnownRecipientOption, type MessageOrOrderDraft, type StructuredTurnDraft } from '../types';
import { MAX_TURN_SUBMISSION_CHARACTERS, canonicalArtifactForTurnSubmission } from './turnSubmission';

const blankMessageOrOrder = (): MessageOrOrderDraft => ({ recipient: null, command: '' });
const CUSTOM_RECIPIENT_SELECT_VALUE = 'custom';
const KNOWN_RECIPIENT_SELECT_PREFIX = 'known:';

export function encodeKnownRecipientSelectValue(entityId: string): string {
  return `${KNOWN_RECIPIENT_SELECT_PREFIX}${encodeURIComponent(entityId)}`;
}

export function decodeRecipientSelectValue(value: string):
  | { kind: 'blank' }
  | { kind: 'custom' }
  | { kind: 'known'; entityId: string }
  | null {
  if (!value) return { kind: 'blank' };
  if (value === CUSTOM_RECIPIENT_SELECT_VALUE) return { kind: 'custom' };
  if (!value.startsWith(KNOWN_RECIPIENT_SELECT_PREFIX)) return null;
  try {
    const entityId = decodeURIComponent(value.slice(KNOWN_RECIPIENT_SELECT_PREFIX.length));
    return entityId ? { kind: 'known', entityId } : null;
  } catch {
    return null;
  }
}

export const customRecipientSelectValue = (): string => CUSTOM_RECIPIENT_SELECT_VALUE;

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
  const selection = decodeRecipientSelectValue(value);
  if (!selection || selection.kind === 'blank') return updateMessageOrOrderRow(draft, index, blankMessageOrOrder());
  return updateMessageOrOrderRow(draft, index, {
    recipient: selection.kind === 'custom'
      ? { kind: 'free_text', text: '' }
      : { kind: 'known_entity', entityId: selection.entityId },
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
): { ok: true; characterCount: number; remainingCharacters: number; excessCharacters: number; overLimit: boolean }
  | { ok: false; characterCount: null; remainingCharacters: null; excessCharacters: 0; overLimit: false; issues: readonly { field: string; message: string }[] } {
  const draft = typeof input === 'string'
    ? { version: TURN_SUBMISSION_VERSION, kind: 'freeform' as const, text: input }
    : input;
  const result = canonicalArtifactForTurnSubmission(draft, { knownRecipients: recipientOptions });
  return result.ok
    ? {
      ok: true,
      characterCount: result.artifact.length,
      remainingCharacters: Math.max(0, MAX_TURN_SUBMISSION_CHARACTERS - result.artifact.length),
      excessCharacters: Math.max(0, result.artifact.length - MAX_TURN_SUBMISSION_CHARACTERS),
      overLimit: result.artifact.length > MAX_TURN_SUBMISSION_CHARACTERS,
    }
    : {
      ok: false,
      characterCount: null,
      remainingCharacters: null,
      excessCharacters: 0,
      overLimit: false,
      issues: result.issues,
    };
}
