import type { PlayerSafeEvidence, RelationshipObservationDraft } from '../../knowledge/store';
import { hasDuplicateEvidenceIds } from '../../knowledge/relationships';
import { GEMINI_FLASH, generateStructured, type GeminiClient } from '../core/geminiService';
import { RelationshipObservationsSchema } from '../core/schemas';
import { zRelationshipObservations } from '../core/zodSchemas';
import { buildRelationshipObservationsPrompt } from '../prompts/relationshipObservations';

/** Runs the selector over data already projected by the composition root. */
export function getRelationshipObservations(
  ai: GeminiClient,
  evidence: PlayerSafeEvidence[],
  entities: Array<{ entity_id: string; name: string }>
): Promise<RelationshipObservationDraft[]> {
  if (hasDuplicateEvidenceIds(evidence)) {
    return Promise.reject(new Error('duplicate evidence id at relationship observation boundary'));
  }
  const { systemInstruction, prompt } = buildRelationshipObservationsPrompt(evidence, entities);
  return generateStructured<RelationshipObservationDraft[]>(ai, {
    callName: 'relationshipObservations',
    model: GEMINI_FLASH,
    systemInstruction,
    prompt,
    responseSchema: RelationshipObservationsSchema,
    zodSchema: zRelationshipObservations,
  });
}
