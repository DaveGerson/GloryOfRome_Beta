import type {
  NoAttemptEvidence,
  NoAttemptSelectionResult,
} from '../../playerView/noAttemptResponse';
import { validateNoAttemptSelection } from '../../playerView/noAttemptResponse';
import { GEMINI_FLASH, generateStructured, type GeminiClient } from '../core/geminiService';
import { NoAttemptEvidenceSelectionSchema } from '../core/schemas';
import { zNoAttemptEvidenceSelection } from '../core/zodSchemas';
import { stripActorsFromNoAttemptEvidenceSelection, type NoAttemptEvidenceSelectionInterchange } from '../core/actorsBoundary';
import { buildNoAttemptEvidenceSelectionPrompt } from '../prompts/noAttemptResponse';

function projectSelectionResult(result: NoAttemptSelectionResult): NoAttemptSelectionResult {
  if (result.kind === 'no_answer') return result;
  return {
    kind: 'answer',
    evidence: result.evidence.map(({ id, source, text }) => ({ id, source, text })),
  };
}

export async function selectNoAttemptEvidence(
  ai: GeminiClient,
  question: string,
  evidence: readonly NoAttemptEvidence[],
  isMockMode = false,
): Promise<NoAttemptSelectionResult> {
  if (evidence.length === 0) return { kind: 'no_answer', reason: 'no_evidence' };
  if (isMockMode) {
    return projectSelectionResult(validateNoAttemptSelection({
      decision: 'answer',
      evidenceIds: [evidence[0].id],
    }, evidence));
  }

  try {
    const { systemInstruction, prompt } = buildNoAttemptEvidenceSelectionPrompt(question, evidence);
    const rawSelection = await generateStructured<NoAttemptEvidenceSelectionInterchange>(ai, {
      callName: 'noAttemptEvidenceSelection',
      model: GEMINI_FLASH,
      systemInstruction,
      prompt,
      responseSchema: NoAttemptEvidenceSelectionSchema,
      zodSchema: zNoAttemptEvidenceSelection,
    });
    // Actors-attribution parse boundary (D42): strip the interchange-only
    // `actors` sibling before this reaches selection validation/downstream use.
    const selection = stripActorsFromNoAttemptEvidenceSelection(rawSelection);
    return projectSelectionResult(validateNoAttemptSelection(selection, evidence));
  } catch {
    return { kind: 'no_answer', reason: 'selector_failure' };
  }
}
