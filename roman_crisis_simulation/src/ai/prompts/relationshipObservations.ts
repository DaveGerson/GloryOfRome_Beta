import type { PlayerSafeEvidence } from '../../knowledge/store';
import { asPromptData } from './fragments';

const SYSTEM_INSTRUCTION = `
ROLE: Relationship Observation Selector.
Select only meaningful, explicit observations already present in the supplied player-safe evidence. Return a JSON array. Each item must contain exactly evidenceId, participantIds, and excerpt. The excerpt must be copied exactly from one evidence item. participantIds must be exact ids from the directory.
Do not interpret sentiment, direction, trust, motives, scores, confidence, or relationship state. Do not author or attribute quotations. Return [] when no meaningful observation is present.`;

/**
 * Builds the privacy-minimized selector prompt, copying fields one by one.
 * `evidence[].text` (PlayerSafeEvidence.text) can carry player-authored
 * content - delimited via `asPromptData` (D41) so a forged line-separator
 * payload can never masquerade as a second "ENTITY DIRECTORY:" block.
 */
export function buildRelationshipObservationsPrompt(
  evidence: PlayerSafeEvidence[],
  entities: Array<{ entity_id: string; name: string }>
): { systemInstruction: string; prompt: string } {
  const safeEvidence = evidence.map(item => ({ id: item.id, source: item.source, text: item.text }));
  const directory = entities.map(entity => ({ entity_id: entity.entity_id, name: entity.name }));
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `PLAYER-SAFE EVIDENCE:\n${asPromptData(safeEvidence)}\n\nENTITY DIRECTORY:\n${JSON.stringify(directory)}`,
  };
}
