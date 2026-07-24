import {
  TURN_SUBMISSION_VERSION,
  type KnownRecipientOption,
  type MessageOrOrder,
  type MessageOrOrderDraft,
  type MessageRecipient,
  type StructuredTurnDraft,
  type TurnSubmission,
} from '../types';

export const TURN_SUBMISSION_PREFIX = 'GOR_TURN_SUBMISSION/1\n';
export const MAX_TURN_SUBMISSION_CHARACTERS = 20_000;

export interface TurnSubmissionIssue {
  field: string;
  message: string;
}

export interface PlayerSubmissionHistory {
  kind: TurnSubmission['kind'];
  text?: string;
  actions?: readonly string[];
  messagesOrOrders?: readonly { recipient: string; command: string }[];
  privateIntent?: string;
  questionOrContext?: string;
}

type ValidationResult =
  | { ok: true; submission: TurnSubmission }
  | { ok: false; issues: TurnSubmissionIssue[] };

const issue = (field: string, message: string): ValidationResult => ({
  ok: false,
  issues: [{ field, message }],
});

const trim = (value: string): string => value.trim();

function asStructuredDraft(
  draft: TurnSubmission | StructuredTurnDraft,
): StructuredTurnDraft | null {
  if ('kind' in draft && draft.kind === 'freeform') return null;

  const structured = draft as Partial<StructuredTurnDraft> & Partial<TurnSubmission>;
  if ('kind' in structured && (structured.kind !== 'structured' || structured.version !== TURN_SUBMISSION_VERSION)) {
    return null;
  }
  if (!Array.isArray(structured.actions) || !Array.isArray(structured.messagesOrOrders)
    || typeof structured.privateIntent !== 'string' || typeof structured.questionOrContext !== 'string') {
    if ('kind' in structured) {
      return {
        actions: Array.isArray(structured.actions) ? [...structured.actions] as string[] : [],
        messagesOrOrders: Array.isArray(structured.messagesOrOrders)
          ? [...structured.messagesOrOrders] as MessageOrOrderDraft[] : [],
        privateIntent: typeof structured.privateIntent === 'string' ? structured.privateIntent : '',
        questionOrContext: typeof structured.questionOrContext === 'string' ? structured.questionOrContext : '',
      };
    }
  }
  return structured as StructuredTurnDraft;
}

function formatRecipient(recipient: MessageRecipient, includeId: boolean): string {
  return recipient.kind === 'known_entity'
    ? includeId ? `${recipient.displayName} [${recipient.entityId}]` : recipient.displayName
    : recipient.text;
}

function observableLines(submission: TurnSubmission): string[] {
  if (submission.kind === 'freeform') return [submission.text];
  return [
    ...(submission.actions ?? []),
    ...(submission.messagesOrOrders ?? []).map(
      ({ recipient, command }) => `To: ${formatRecipient(recipient, true)}\n${command}`,
    ),
  ];
}

export function serializeTurnSubmission(submission: TurnSubmission): string {
  if (submission.kind === 'structured' || submission.text.startsWith(TURN_SUBMISSION_PREFIX)) {
    return TURN_SUBMISSION_PREFIX + JSON.stringify(submission);
  }
  return submission.text;
}

export function validateAndNormalizeTurnSubmission(
  draft: TurnSubmission | StructuredTurnDraft,
  context: { knownRecipients: readonly KnownRecipientOption[] },
): ValidationResult {
  if ('kind' in draft && draft.kind === 'freeform') {
    if (draft.version !== TURN_SUBMISSION_VERSION || typeof draft.text !== 'string') {
      return issue('submission', 'Unsupported freeform submission.');
    }
    const text = trim(draft.text);
    if (!text) return issue('text', 'Enter a turn submission.');
    const submission: TurnSubmission = { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text };
    return serializeTurnSubmission(submission).length <= MAX_TURN_SUBMISSION_CHARACTERS
      ? { ok: true, submission }
      : issue('submission', 'Turn submission exceeds 20,000 characters.');
  }

  const structured = asStructuredDraft(draft);
  if (!structured) return issue('submission', 'Unsupported structured submission.');
  const actions = structured.actions.map(trim).filter(Boolean);
  const messagesOrOrders: MessageOrOrder[] = [];

  for (let index = 0; index < structured.messagesOrOrders.length; index += 1) {
    const row = structured.messagesOrOrders[index];
    const command = typeof row?.command === 'string' ? trim(row.command) : '';
    const recipientDraft = row?.recipient;
    const hasRecipient = recipientDraft !== null && recipientDraft !== undefined;
    if (!hasRecipient && !command) continue;
    if (!hasRecipient || !command) return issue(`messagesOrOrders.${index}`, 'Recipient and command are both required.');

    let recipient: MessageRecipient;
    if (recipientDraft.kind === 'known_entity') {
      const option = context.knownRecipients.find((candidate) => candidate.entityId === recipientDraft.entityId);
      if (!option) return issue(`messagesOrOrders.${index}.recipient`, 'Selected recipient is unavailable.');
      recipient = { kind: 'known_entity', entityId: option.entityId, displayName: option.displayName };
    } else if (recipientDraft.kind === 'free_text') {
      const text = typeof recipientDraft.text === 'string' ? trim(recipientDraft.text) : '';
      if (!text) return issue(`messagesOrOrders.${index}.recipient`, 'Enter a recipient.');
      recipient = { kind: 'free_text', text };
    } else {
      return issue(`messagesOrOrders.${index}.recipient`, 'Unsupported recipient.');
    }
    messagesOrOrders.push({ recipient, command });
  }

  const privateIntent = trim(structured.privateIntent ?? '');
  const questionOrContext = trim(structured.questionOrContext ?? '');
  if (!actions.length && !messagesOrOrders.length && !privateIntent && !questionOrContext) {
    return issue('submission', 'Enter at least one turn detail.');
  }

  const submission: Extract<TurnSubmission, { kind: 'structured' }> = {
    version: TURN_SUBMISSION_VERSION,
    kind: 'structured',
    ...(actions.length ? { actions } : {}),
    ...(messagesOrOrders.length ? { messagesOrOrders } : {}),
    ...(privateIntent ? { privateIntent } : {}),
    ...(questionOrContext ? { questionOrContext } : {}),
  };
  return serializeTurnSubmission(submission).length <= MAX_TURN_SUBMISSION_CHARACTERS
    ? { ok: true, submission }
    : issue('submission', 'Turn submission exceeds 20,000 characters.');
}

export function deserializeTurnSubmission(text: string): TurnSubmission | null {
  if (typeof text !== 'string' || text.length > MAX_TURN_SUBMISSION_CHARACTERS) return null;
  if (!text.startsWith(TURN_SUBMISSION_PREFIX)) {
    return trim(text) ? { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text } : null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(TURN_SUBMISSION_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;
    if (raw.version !== TURN_SUBMISSION_VERSION || (raw.kind !== 'freeform' && raw.kind !== 'structured')) return null;
    if (raw.kind === 'freeform') {
      if (typeof raw.text !== 'string') return null;
      const result = validateAndNormalizeTurnSubmission(raw as TurnSubmission, { knownRecipients: [] });
      return result.ok && serializeTurnSubmission(result.submission) === text ? result.submission : null;
    }
    if ((raw.actions !== undefined && (!Array.isArray(raw.actions) || !raw.actions.every((value) => typeof value === 'string')))
      || (raw.messagesOrOrders !== undefined && !Array.isArray(raw.messagesOrOrders))
      || (raw.privateIntent !== undefined && typeof raw.privateIntent !== 'string')
      || (raw.questionOrContext !== undefined && typeof raw.questionOrContext !== 'string')) return null;
    const rows = (raw.messagesOrOrders ?? []) as MessageOrOrder[];
    const knownRecipients: KnownRecipientOption[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.command !== 'string' || !row.recipient || typeof row.recipient !== 'object') return null;
      if (row.recipient.kind === 'known_entity') {
        if (typeof row.recipient.entityId !== 'string' || typeof row.recipient.displayName !== 'string') return null;
        knownRecipients.push({ entityId: row.recipient.entityId, displayName: row.recipient.displayName });
      } else if (row.recipient.kind !== 'free_text' || typeof row.recipient.text !== 'string') return null;
    }
    const result = validateAndNormalizeTurnSubmission({
      actions: (raw.actions ?? []) as string[],
      messagesOrOrders: rows.map(({ recipient, command }) => ({
        recipient: recipient.kind === 'known_entity'
          ? { kind: 'known_entity', entityId: recipient.entityId }
          : { kind: 'free_text', text: recipient.text },
        command,
      })),
      privateIntent: (raw.privateIntent ?? '') as string,
      questionOrContext: (raw.questionOrContext ?? '') as string,
    }, { knownRecipients });
    return result.ok && serializeTurnSubmission(result.submission) === text ? result.submission : null;
  } catch {
    return null;
  }
}

export function projectForResolution(submission: TurnSubmission): string | null {
  const lines = observableLines(submission);
  return lines.length ? lines.join('\n\n') : null;
}

export function projectForAdjudication(submission: TurnSubmission): {
  observableAttempt: string | null;
  privateIntent: string | null;
  questionOrContext: string | null;
} {
  return submission.kind === 'freeform'
    ? { observableAttempt: submission.text, privateIntent: null, questionOrContext: null }
    : {
        observableAttempt: projectForResolution(submission),
        privateIntent: submission.privateIntent ?? null,
        questionOrContext: submission.questionOrContext ?? null,
      };
}

export function projectForPlayerOwnedAi(submission: TurnSubmission): string {
  if (submission.kind === 'freeform') return submission.text;
  return [
    projectForResolution(submission),
    submission.privateIntent ? `Private intent:\n${submission.privateIntent}` : null,
    submission.questionOrContext ? `Question or context:\n${submission.questionOrContext}` : null,
  ].filter((value): value is string => value !== null).join('\n\n');
}

export function projectForExternalInference(submission: TurnSubmission): string | null {
  return projectForResolution(submission);
}

export function projectForPlayerHistory(submission: TurnSubmission): PlayerSubmissionHistory {
  if (submission.kind === 'freeform') return { kind: 'freeform', text: submission.text };
  return {
    kind: 'structured',
    ...(submission.actions?.length ? { actions: submission.actions } : {}),
    ...(submission.messagesOrOrders?.length ? {
      messagesOrOrders: submission.messagesOrOrders.map(({ recipient, command }) => ({
        recipient: formatRecipient(recipient, false), command,
      })),
    } : {}),
    ...(submission.privateIntent ? { privateIntent: submission.privateIntent } : {}),
    ...(submission.questionOrContext ? { questionOrContext: submission.questionOrContext } : {}),
  };
}
