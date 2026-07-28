import type { KnowledgeClaim, KnowledgeSource } from '../knowledge/store';

export const MAX_NO_ATTEMPT_EVIDENCE = 60;
export const MAX_NO_ATTEMPT_SELECTION = 5;
export const NO_ATTEMPT_NO_ANSWER = 'Nothing in your current observations answers that yet.';
export const PRIVATE_INTENT_ACKNOWLEDGEMENT =
  'Your private intent is noted. No action is taken on your behalf.';

export interface NoAttemptEvidence {
  id: string;
  source: KnowledgeSource;
  text: string;
}

export interface NoAttemptEvidenceSelection {
  decision: 'answer' | 'no_answer';
  evidenceIds: string[];
}

export type NoAttemptSelectionResult =
  | { kind: 'answer'; evidence: NoAttemptEvidence[] }
  | {
      kind: 'no_answer';
      reason: 'no_evidence' | 'model_no_answer' | 'invalid_selection' | 'selector_failure';
    };

interface OrderedKnowledgeUpdate {
  source: KnowledgeSource;
  text: string;
  turn: number;
  claimIndex: number;
  updateIndex: number;
}

const SOURCE_LABELS: Record<KnowledgeSource, string> = {
  self: 'From your own experience',
  witnessed: 'You witnessed',
  network: 'Via your network',
  public: 'Common knowledge',
  scout: 'From a scout',
  spy: 'From a spy',
  merchant: 'From a merchant',
  messenger: 'From a messenger',
  rumor: 'Rumor',
};

const invalidSelection = (): NoAttemptSelectionResult => ({
  kind: 'no_answer',
  reason: 'invalid_selection',
});

export function buildNoAttemptEvidence(
  knowledge: readonly KnowledgeClaim[],
): NoAttemptEvidence[] {
  const updates: OrderedKnowledgeUpdate[] = [];
  knowledge.forEach((claim, claimIndex) => {
    claim.updates.forEach((update, updateIndex) => {
      updates.push({
        source: update.source,
        text: update.text,
        turn: update.turn,
        claimIndex,
        updateIndex,
      });
    });
  });

  updates.sort((left, right) =>
    right.turn - left.turn
    || left.claimIndex - right.claimIndex
    || left.updateIndex - right.updateIndex);

  const seen = new Set<string>();
  const selected: OrderedKnowledgeUpdate[] = [];
  for (const update of updates) {
    const duplicateKey = `${update.source}\u0000${update.text}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    selected.push(update);
    if (selected.length === MAX_NO_ATTEMPT_EVIDENCE) break;
  }

  return selected.map((update, index) => ({
    id: `evidence-${index + 1}`,
    source: update.source,
    text: update.text,
  }));
}

export function validateNoAttemptSelection(
  selection: NoAttemptEvidenceSelection,
  evidence: readonly NoAttemptEvidence[],
): NoAttemptSelectionResult {
  if (evidence.length === 0) return { kind: 'no_answer', reason: 'no_evidence' };
  if (!selection || typeof selection !== 'object' || !Array.isArray(selection.evidenceIds)) {
    return invalidSelection();
  }

  const selectedIds = selection.evidenceIds;
  if (selection.decision === 'no_answer') {
    return selectedIds.length === 0
      ? { kind: 'no_answer', reason: 'model_no_answer' }
      : invalidSelection();
  }
  if (selection.decision !== 'answer'
    || selectedIds.length === 0
    || selectedIds.length > MAX_NO_ATTEMPT_SELECTION) {
    return invalidSelection();
  }

  const offeredIds = new Set(evidence.map(({ id }) => id));
  const uniqueSelectedIds = new Set<string>();
  for (const id of selectedIds) {
    if (typeof id !== 'string' || uniqueSelectedIds.has(id) || !offeredIds.has(id)) {
      return invalidSelection();
    }
    uniqueSelectedIds.add(id);
  }

  return {
    kind: 'answer',
    evidence: evidence.filter(({ id }) => uniqueSelectedIds.has(id)),
  };
}

export function renderNoAttemptResponse(result: NoAttemptSelectionResult): string {
  if (result.kind === 'no_answer') return NO_ATTEMPT_NO_ANSWER;
  const lines = result.evidence.map(
    ({ source, text }) => `- ${SOURCE_LABELS[source]}: ${text}`,
  );
  return `What you can currently tell:\n${lines.join('\n')}`;
}
