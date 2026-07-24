import {
  TURN_SUBMISSION_VERSION,
  type KnownRecipientOption,
  type MessageOrOrder,
  type MessageOrOrderDraft,
  type MessageRecipient,
  type StructuredTurnDraft,
  type TurnSubmission,
} from '../types';

export const TURN_SUBMISSION_PREFIX = `GOR_TURN_SUBMISSION/${TURN_SUBMISSION_VERSION}\n`;
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

type StructuredSubmission = Extract<TurnSubmission, { kind: 'structured' }>;
type ValidationResult =
  | { ok: true; submission: TurnSubmission }
  | { ok: false; issues: TurnSubmissionIssue[] };

const issue = (field: string, message: string): ValidationResult => ({
  ok: false,
  issues: [{ field, message }],
});

const trim = (value: string): string => value.trim();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function formatRecipientForAi(recipient: MessageRecipient): string {
  return recipient.kind === 'known_entity'
    ? `${recipient.displayName} [${recipient.entityId}]`
    : recipient.text;
}

function formatRecipientForPlayerHistory(recipient: MessageRecipient): string {
  return recipient.kind === 'known_entity' ? recipient.displayName : recipient.text;
}

function canonicalizeRecipient(recipient: MessageRecipient): MessageRecipient {
  return recipient.kind === 'known_entity'
    ? { kind: 'known_entity', entityId: recipient.entityId, displayName: recipient.displayName }
    : { kind: 'free_text', text: recipient.text };
}

function canonicalizeSubmission(submission: TurnSubmission): TurnSubmission {
  if (submission.kind === 'freeform') {
    return { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text: submission.text };
  }
  return {
    version: TURN_SUBMISSION_VERSION,
    kind: 'structured',
    ...(submission.actions !== undefined ? { actions: [...submission.actions] } : {}),
    ...(submission.messagesOrOrders !== undefined ? {
      messagesOrOrders: submission.messagesOrOrders.map(({ recipient, command }) => ({
        recipient: canonicalizeRecipient(recipient), command,
      })),
    } : {}),
    ...(submission.privateIntent !== undefined ? { privateIntent: submission.privateIntent } : {}),
    ...(submission.questionOrContext !== undefined ? { questionOrContext: submission.questionOrContext } : {}),
  };
}

function observableLines(submission: TurnSubmission): string[] {
  if (submission.kind === 'freeform') return [submission.text];
  return [
    ...(submission.actions ?? []),
    ...(submission.messagesOrOrders ?? []).map(
      ({ recipient, command }) => `To: ${formatRecipientForAi(recipient)}\n${command}`,
    ),
  ];
}

function normalizeStructuredDraft(
  draft: StructuredTurnDraft,
  context: { knownRecipients: readonly KnownRecipientOption[] },
): ValidationResult {
  const actions = draft.actions.map(trim).filter(Boolean);
  const messagesOrOrders: MessageOrOrder[] = [];

  for (let index = 0; index < draft.messagesOrOrders.length; index += 1) {
    const row = draft.messagesOrOrders[index];
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

  const privateIntent = trim(draft.privateIntent ?? '');
  const questionOrContext = trim(draft.questionOrContext ?? '');
  if (!actions.length && !messagesOrOrders.length && !privateIntent && !questionOrContext) {
    return issue('submission', 'Enter at least one turn detail.');
  }

  const submission: StructuredSubmission = {
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

function toStructuredDraft(draft: Exclude<TurnSubmission, { kind: 'freeform' }> | StructuredTurnDraft): StructuredTurnDraft | null {
  if (!Array.isArray(draft.actions) || !Array.isArray(draft.messagesOrOrders)
    || typeof draft.privateIntent !== 'string' || typeof draft.questionOrContext !== 'string') {
    if ('kind' in draft && draft.kind === 'structured' && draft.version === TURN_SUBMISSION_VERSION) {
      return {
        actions: Array.isArray(draft.actions) ? [...draft.actions] as string[] : [],
        messagesOrOrders: Array.isArray(draft.messagesOrOrders) ? [...draft.messagesOrOrders] as MessageOrOrderDraft[] : [],
        privateIntent: typeof draft.privateIntent === 'string' ? draft.privateIntent : '',
        questionOrContext: typeof draft.questionOrContext === 'string' ? draft.questionOrContext : '',
      };
    }
  }
  return draft as StructuredTurnDraft;
}

function decodeWireRecipient(value: unknown): { draft: MessageOrOrderDraft['recipient']; knownRecipient?: KnownRecipientOption } | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'known_entity' && typeof value.entityId === 'string' && typeof value.displayName === 'string') {
    return {
      draft: { kind: 'known_entity', entityId: value.entityId },
      knownRecipient: { entityId: value.entityId, displayName: value.displayName },
    };
  }
  if (value.kind === 'free_text' && typeof value.text === 'string') {
    return { draft: { kind: 'free_text', text: value.text } };
  }
  return null;
}

function decodeWireStructuredDraft(raw: Record<string, unknown>): {
  draft: StructuredTurnDraft;
  knownRecipients: KnownRecipientOption[];
} | null {
  if ((raw.actions !== undefined && (!Array.isArray(raw.actions) || !raw.actions.every((value) => typeof value === 'string')))
    || (raw.messagesOrOrders !== undefined && !Array.isArray(raw.messagesOrOrders))
    || (raw.privateIntent !== undefined && typeof raw.privateIntent !== 'string')
    || (raw.questionOrContext !== undefined && typeof raw.questionOrContext !== 'string')) return null;

  const knownRecipients: KnownRecipientOption[] = [];
  const messagesOrOrders: MessageOrOrderDraft[] = [];
  for (const row of raw.messagesOrOrders ?? []) {
    if (!isRecord(row) || typeof row.command !== 'string') return null;
    const recipient = decodeWireRecipient(row.recipient);
    if (!recipient) return null;
    messagesOrOrders.push({ recipient: recipient.draft, command: row.command });
    if (recipient.knownRecipient) knownRecipients.push(recipient.knownRecipient);
  }
  return {
    draft: {
      actions: (raw.actions ?? []) as string[],
      messagesOrOrders,
      privateIntent: (raw.privateIntent ?? '') as string,
      questionOrContext: (raw.questionOrContext ?? '') as string,
    },
    knownRecipients,
  };
}

function decodeWireSubmission(value: unknown): TurnSubmission | null {
  if (!isRecord(value) || value.version !== TURN_SUBMISSION_VERSION || typeof value.kind !== 'string') return null;
  if (value.kind === 'freeform') {
    if (typeof value.text !== 'string') return null;
    const result = validateAndNormalizeTurnSubmission(
      { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text: value.text },
      { knownRecipients: [] },
    );
    return result.ok ? result.submission : null;
  }
  if (value.kind !== 'structured') return null;
  const decoded = decodeWireStructuredDraft(value);
  if (!decoded) return null;
  const result = normalizeStructuredDraft(decoded.draft, { knownRecipients: decoded.knownRecipients });
  return result.ok ? result.submission : null;
}

export function serializeTurnSubmission(submission: TurnSubmission): string {
  const canonical = canonicalizeSubmission(submission);
  if (canonical.kind === 'structured' || canonical.text.startsWith(TURN_SUBMISSION_PREFIX)) {
    return TURN_SUBMISSION_PREFIX + JSON.stringify(canonical);
  }
  return canonical.text;
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

  const structured = toStructuredDraft(draft as Exclude<TurnSubmission, { kind: 'freeform' }> | StructuredTurnDraft);
  return structured
    ? normalizeStructuredDraft(structured, context)
    : issue('submission', 'Unsupported structured submission.');
}

export function deserializeTurnSubmission(text: string): TurnSubmission | null {
  if (typeof text !== 'string' || text.length > MAX_TURN_SUBMISSION_CHARACTERS) return null;
  if (!text.startsWith(TURN_SUBMISSION_PREFIX)) {
    return trim(text) ? { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text } : null;
  }
  try {
    const submission = decodeWireSubmission(JSON.parse(text.slice(TURN_SUBMISSION_PREFIX.length)));
    return submission && serializeTurnSubmission(submission) === text ? submission : null;
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
        recipient: formatRecipientForPlayerHistory(recipient), command,
      })),
    } : {}),
    ...(submission.privateIntent ? { privateIntent: submission.privateIntent } : {}),
    ...(submission.questionOrContext ? { questionOrContext: submission.questionOrContext } : {}),
  };
}
