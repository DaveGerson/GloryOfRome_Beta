import {
  TURN_SUBMISSION_VERSION,
  type KnownRecipientOption,
  type MessageOrOrder,
  type MessageRecipient,
  type StructuredTurnDraft,
  type TurnSubmission,
} from '../types';

const TURN_SUBMISSION_NAMESPACE = 'GOR_TURN_SUBMISSION/';

export const TURN_SUBMISSION_PREFIX = `${TURN_SUBMISSION_NAMESPACE}${TURN_SUBMISSION_VERSION}\n`;
export const MAX_TURN_SUBMISSION_CHARACTERS = 20_000;

export interface AdjudicationSubmissionProjection {
  observableAttempt: string | null;
  privateIntent: string | null;
  questionOrContext: string | null;
}

/** Player-owned material for narration, with action presence carried as data. */
export interface NarrationSubmissionProjection {
  context: string;
  hasObservableAttempt: boolean;
}

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
type RecipientResult =
  | { ok: true; recipient: MessageRecipient }
  | { ok: false; message: string };

interface StructuredFields {
  actions: readonly unknown[];
  messagesOrOrders: readonly unknown[];
  privateIntent: string;
  questionOrContext: string;
}

type RecipientNormalizer = (value: unknown) => RecipientResult;

const issue = (field: string, message: string): ValidationResult => ({
  ok: false,
  issues: [{ field, message }],
});

const recipientIssue = (message: string): RecipientResult => ({ ok: false, message });
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

function encodeCanonicalSubmission(submission: TurnSubmission): string {
  if (submission.kind === 'structured' || submission.text.startsWith(TURN_SUBMISSION_NAMESPACE)) {
    return TURN_SUBMISSION_PREFIX + JSON.stringify(submission);
  }
  return submission.text;
}

function enforceArtifactLimit(submission: TurnSubmission): ValidationResult {
  return encodeCanonicalSubmission(submission).length <= MAX_TURN_SUBMISSION_CHARACTERS
    ? { ok: true, submission }
    : issue('submission', 'Turn submission exceeds 20,000 characters.');
}

function normalizeFreeform(text: string): ValidationResult {
  const normalizedText = trim(text);
  if (!normalizedText) return issue('text', 'Enter a turn submission.');
  return enforceArtifactLimit({
    version: TURN_SUBMISSION_VERSION,
    kind: 'freeform',
    text: normalizedText,
  });
}

function readStructuredFields(
  value: Record<string, unknown>,
  allowMissingFields: boolean,
): StructuredFields | null {
  const actions = allowMissingFields && value.actions === undefined ? [] : value.actions;
  const messagesOrOrders = allowMissingFields && value.messagesOrOrders === undefined
    ? []
    : value.messagesOrOrders;
  const privateIntent = allowMissingFields && value.privateIntent === undefined
    ? ''
    : value.privateIntent;
  const questionOrContext = allowMissingFields && value.questionOrContext === undefined
    ? ''
    : value.questionOrContext;

  if (!Array.isArray(actions)
    || !Array.isArray(messagesOrOrders)
    || typeof privateIntent !== 'string'
    || typeof questionOrContext !== 'string') {
    return null;
  }
  return { actions, messagesOrOrders, privateIntent, questionOrContext };
}

function normalizeStructuredFields(
  fields: StructuredFields,
  normalizeRecipient: RecipientNormalizer,
  allowBlankDraftRows: boolean,
): ValidationResult {
  const actions: string[] = [];
  for (let index = 0; index < fields.actions.length; index += 1) {
    const action = fields.actions[index];
    if (typeof action !== 'string') {
      return issue(`actions.${index}`, 'Action must be text.');
    }
    const normalizedAction = trim(action);
    if (normalizedAction) actions.push(normalizedAction);
  }

  const messagesOrOrders: MessageOrOrder[] = [];
  for (let index = 0; index < fields.messagesOrOrders.length; index += 1) {
    const row = fields.messagesOrOrders[index];
    if (!isRecord(row) || typeof row.command !== 'string') {
      return issue(`messagesOrOrders.${index}`, 'Message or order is malformed.');
    }

    const command = trim(row.command);
    const hasRecipient = row.recipient !== null && row.recipient !== undefined;
    if (!hasRecipient && !command && allowBlankDraftRows) continue;
    if (!hasRecipient || !command) {
      return issue(`messagesOrOrders.${index}`, 'Recipient and command are both required.');
    }

    const recipient = normalizeRecipient(row.recipient);
    if (!recipient.ok) {
      return issue(`messagesOrOrders.${index}.recipient`, recipient.message);
    }
    messagesOrOrders.push({ recipient: recipient.recipient, command });
  }

  const privateIntent = trim(fields.privateIntent);
  const questionOrContext = trim(fields.questionOrContext);
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
  return enforceArtifactLimit(submission);
}

function normalizeRecipientFromKnownOptions(
  value: unknown,
  knownRecipients: readonly KnownRecipientOption[],
  requireDisplayName: boolean,
): RecipientResult {
  return normalizeRecipient(value, (knownEntity) => {
    if (typeof knownEntity.entityId !== 'string'
      || (requireDisplayName && typeof knownEntity.displayName !== 'string')) {
      return recipientIssue('Unsupported recipient.');
    }
    const option = knownRecipients.find((candidate) =>
      candidate !== null
      && typeof candidate === 'object'
      && typeof candidate.entityId === 'string'
      && typeof candidate.displayName === 'string'
      && candidate.entityId === knownEntity.entityId);
    if (!option) return recipientIssue('Selected recipient is unavailable.');
    const displayName = trim(option.displayName);
    if (!trim(option.entityId) || !displayName) {
      return recipientIssue('Selected recipient is unavailable.');
    }
    return {
      ok: true,
      recipient: { kind: 'known_entity', entityId: option.entityId, displayName },
    };
  });
}

function normalizeRecipient(
  value: unknown,
  normalizeKnownEntity: (value: Record<string, unknown>) => RecipientResult,
): RecipientResult {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return recipientIssue('Unsupported recipient.');
  }

  if (value.kind === 'free_text' && typeof value.text === 'string') {
    const text = trim(value.text);
    return text
      ? { ok: true, recipient: { kind: 'free_text', text } }
      : recipientIssue('Enter a recipient.');
  }
  if (value.kind === 'known_entity') return normalizeKnownEntity(value);
  return recipientIssue('Unsupported recipient.');
}

function normalizeSelfContainedRecipient(value: unknown): RecipientResult {
  return normalizeRecipient(value, (knownEntity) => {
    if (typeof knownEntity.entityId !== 'string'
      || typeof knownEntity.displayName !== 'string') {
      return recipientIssue('Unsupported recipient.');
    }
    const entityId = knownEntity.entityId;
    const displayName = trim(knownEntity.displayName);
    return trim(entityId) && displayName
      ? { ok: true, recipient: { kind: 'known_entity', entityId, displayName } }
      : recipientIssue('Unsupported recipient.');
  });
}

function normalizeVersionedSubmission(
  value: Record<string, unknown>,
  normalizeRecipientValue: RecipientNormalizer,
): ValidationResult {
  if (value.version !== TURN_SUBMISSION_VERSION) {
    return issue('submission', 'Unsupported turn submission version.');
  }
  if (value.kind === 'freeform') {
    return typeof value.text === 'string'
      ? normalizeFreeform(value.text)
      : issue('submission', 'Unsupported freeform submission.');
  }
  if (value.kind !== 'structured') {
    return issue('submission', 'Unsupported turn submission kind.');
  }

  const fields = readStructuredFields(value, true);
  return fields
    ? normalizeStructuredFields(fields, normalizeRecipientValue, false)
    : issue('submission', 'Unsupported structured submission.');
}

function normalizeSelfContainedSubmission(value: unknown): ValidationResult {
  return isRecord(value)
    ? normalizeVersionedSubmission(value, normalizeSelfContainedRecipient)
    : issue('submission', 'Unsupported turn submission.');
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

export function serializeTurnSubmission(submission: TurnSubmission): string {
  const result = normalizeSelfContainedSubmission(submission);
  if (!result.ok) {
    const details = result.issues.map(({ field, message }) => `${field}: ${message}`).join('; ');
    throw new TypeError(`Cannot serialize invalid turn submission (${details})`);
  }
  return encodeCanonicalSubmission(result.submission);
}

export function validateAndNormalizeTurnSubmission(
  draft: TurnSubmission | StructuredTurnDraft,
  context: { knownRecipients: readonly KnownRecipientOption[] },
): ValidationResult {
  if (!isRecord(draft) || !context || !Array.isArray(context.knownRecipients)) {
    return issue('submission', 'Unsupported turn submission.');
  }

  if ('kind' in draft || 'version' in draft) {
    return normalizeVersionedSubmission(
      draft,
      (recipient) => normalizeRecipientFromKnownOptions(
        recipient,
        context.knownRecipients,
        true,
      ),
    );
  }

  const fields = readStructuredFields(draft, false);
  return fields
    ? normalizeStructuredFields(
        fields,
        (recipient) => normalizeRecipientFromKnownOptions(
          recipient,
          context.knownRecipients,
          false,
        ),
        true,
      )
    : issue('submission', 'Unsupported structured submission.');
}

export function deserializeTurnSubmission(text: string): TurnSubmission | null {
  if (typeof text !== 'string') return null;

  if (text.startsWith(TURN_SUBMISSION_PREFIX)) {
    if (text.length > MAX_TURN_SUBMISSION_CHARACTERS) return null;
    try {
      const result = normalizeSelfContainedSubmission(
        JSON.parse(text.slice(TURN_SUBMISSION_PREFIX.length)),
      );
      return result.ok && encodeCanonicalSubmission(result.submission) === text
        ? result.submission
        : null;
    } catch {
      return null;
    }
  }

  if (isReservedTurnSubmissionArtifact(text)) return null;
  const result = normalizeFreeform(text);
  return result.ok ? result.submission : null;
}

/** True when text occupies the serialization-owned artifact namespace. */
export function isReservedTurnSubmissionArtifact(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(TURN_SUBMISSION_NAMESPACE);
}

/**
 * Routes legacy strings and typed input through the one canonical boundary,
 * so every runtime consumer sees the same normalization and size limits.
 */
export function normalizeTurnSubmissionInput(submission: TurnSubmission | string): TurnSubmission {
  const candidate: TurnSubmission = typeof submission === 'string'
    ? { version: TURN_SUBMISSION_VERSION, kind: 'freeform', text: submission }
    : submission;
  const normalized = deserializeTurnSubmission(serializeTurnSubmission(candidate));
  if (!normalized) throw new TypeError('Cannot normalize invalid turn submission.');
  return normalized;
}

export function projectForResolution(submission: TurnSubmission): string | null {
  const lines = observableLines(submission);
  return lines.length ? lines.join('\n\n') : null;
}

export function projectForAdjudication(submission: TurnSubmission): AdjudicationSubmissionProjection {
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

/**
 * Keeps the player-owned prose available to narration while making the
 * observable-action boundary explicit. Consumers must not infer an action
 * from private intent or question text.
 */
export function projectForNarration(submission: TurnSubmission): NarrationSubmissionProjection {
  return {
    context: projectForPlayerOwnedAi(submission),
    hasObservableAttempt: projectForResolution(submission) !== null,
  };
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
