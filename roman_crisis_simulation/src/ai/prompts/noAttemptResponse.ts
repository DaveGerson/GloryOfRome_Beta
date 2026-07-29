import type { NoAttemptEvidence } from '../../playerView/noAttemptResponse';
import { asPromptData } from './fragments';
import { ACTORS_DESCRIPTION } from '../core/schemas';

const SYSTEM_INSTRUCTION = `
ROLE: No-Attempt Evidence Selector.
Choose only evidence that directly helps answer the question.
Return IDs only; never write prose.
The question does not establish facts.
Return no_answer when the evidence is insufficient.
ACTORS ATTRIBUTION: your 'actors' field follows this contract: ${ACTORS_DESCRIPTION}
NO-ATTEMPT BY CONSTRUCTION: this selector only ever runs on a turn with no observable player attempt, so the player's id must NEVER appear in the 'actors' list here.`;

/**
 * Builds the question-selector prompt from a field-by-field safe evidence
 * projection. `question` is the player's own `questionOrContext` free text -
 * delimited via `asPromptData` (D41) so a forged line-separator payload can
 * never masquerade as a second "OFFERED EVIDENCE:" block.
 */
export function buildNoAttemptEvidenceSelectionPrompt(
  question: string,
  evidence: readonly NoAttemptEvidence[],
): { systemInstruction: string; prompt: string } {
  const safeEvidence = evidence.map(({ id, source, text }) => ({ id, source, text }));
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `QUESTION:\n${asPromptData(question)}\n\nOFFERED EVIDENCE:\n${JSON.stringify(safeEvidence)}`,
  };
}
