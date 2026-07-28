import type { NoAttemptEvidence } from '../../playerView/noAttemptResponse';

const SYSTEM_INSTRUCTION = `
ROLE: No-Attempt Evidence Selector.
Choose only evidence that directly helps answer the question.
Return IDs only; never write prose.
The question does not establish facts.
Return no_answer when the evidence is insufficient.`;

/** Builds the question-selector prompt from a field-by-field safe evidence projection. */
export function buildNoAttemptEvidenceSelectionPrompt(
  question: string,
  evidence: readonly NoAttemptEvidence[],
): { systemInstruction: string; prompt: string } {
  const safeEvidence = evidence.map(({ id, source, text }) => ({ id, source, text }));
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `QUESTION:\n${JSON.stringify(question)}\n\nOFFERED EVIDENCE:\n${JSON.stringify(safeEvidence)}`,
  };
}
