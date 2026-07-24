import type { PlayerSafeEvidence, RelationshipObservationDraft } from '../../knowledge/store';
import {
  evidenceContainsExactEntityName,
  hasDuplicateEvidenceIds,
  validateRelationshipObservationDrafts,
} from '../../knowledge/relationships';
import { GEMINI_FLASH, generateStructured, type GeminiClient } from '../core/geminiService';
import { RelationshipObservationsSchema } from '../core/schemas';
import { zRelationshipObservations } from '../core/zodSchemas';
import { buildRelationshipObservationsPrompt } from '../prompts/relationshipObservations';

/** Runs the selector over data already projected by the composition root.
 * Mock play takes the same strict boundary but deterministically validates
 * an empty selection instead of making a network request. */
export async function getRelationshipObservations(
  ai: GeminiClient,
  evidence: PlayerSafeEvidence[],
  entities: Array<{ entity_id: string; name: string }>,
  knownEntityIds: string[] = entities.map(entity => entity.entity_id),
  isMockMode = false,
): Promise<RelationshipObservationDraft[]> {
  if (hasDuplicateEvidenceIds(evidence)) {
    throw new Error('duplicate evidence id at relationship observation boundary');
  }
  const knownIds = new Set(knownEntityIds);
  const promptEntities = entities
    .filter(entity => knownIds.has(entity.entity_id)
      || evidence.some(item => evidenceContainsExactEntityName(item.text, entity.name)))
    .map(entity => ({ entity_id: entity.entity_id, name: entity.name }));
  const drafts = isMockMode
    ? zRelationshipObservations.parse([])
    : await (async () => {
      const { systemInstruction, prompt } = buildRelationshipObservationsPrompt(evidence, promptEntities);
      return generateStructured<RelationshipObservationDraft[]>(ai, {
        callName: 'relationshipObservations',
        model: GEMINI_FLASH,
        systemInstruction,
        prompt,
        responseSchema: RelationshipObservationsSchema,
        zodSchema: zRelationshipObservations,
      });
    })();
  const accepted = validateRelationshipObservationDrafts({
    drafts,
    evidence,
    entities,
    knownEntityIds,
  });
  if (drafts.length > 0 && accepted.length !== drafts.length) {
    throw new Error('relationship observation semantic validation rejected provider selection');
  }
  return accepted;
}
