import type { PlayerSafeEvidence, RelationshipObservationDraft } from '../../knowledge/store';
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
