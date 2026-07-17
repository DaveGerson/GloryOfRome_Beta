import { Entity, WorldState, Adjudication, Report, EventDelta, Relationship } from '../../types';

// NOTE: The turn-adjudication prompt (formerly `compileContext` here) has
// moved to `ai/prompts/adjudication.ts::buildAdjudicationPrompt`, and its
// `getEntityBrief` helper to `ai/prompts/fragments.ts`, as part of
// centralizing all prompt text under ai/prompts/ (see
// ai/prompts/README.md). This file stays pure state-transition logic - see
// ROADMAP_6_MAINTAINABILITY.md's note that `engine.ts` is "pure and
// testable" and should stay that way.

/**
 * Applies a list of deltas to the current game state.
 * This is a pure function that returns new state objects.
 */
export function applyDeltas(
    deltas: EventDelta[],
    currentEntities: Entity[],
    currentWorldState: WorldState,
    turnNumber: number
): { updatedEntities: Entity[], updatedWorldState: WorldState, newReports: Report[] } {
    const updatedEntities: Entity[] = JSON.parse(JSON.stringify(currentEntities));
    const updatedWorldState: WorldState = JSON.parse(JSON.stringify(currentWorldState));
    const newReports: Report[] = [];

    deltas.forEach(delta => {
        try {
            switch(delta.type) {
                case 'resource': {
                    const [entityId, resourceName] = delta.key.split(':');
                    const entity = updatedEntities.find(e => e.entity_id === entityId);
                    if (entity) {
                        const currentVal = (entity.resources[resourceName] as number) || 0;
                        entity.resources[resourceName] = currentVal + delta.delta;
                    }
                    break;
                }
                case 'relation': {
                    const parts = delta.key.split(':');
                    if (parts.length < 2) break; // Invalid key

                    const [entityAId, entityBId, attribute = 'trust_level'] = parts;
                    // Type assertion to ensure we are only working with valid relationship properties
                    const attr = attribute as keyof Omit<Relationship, 'entity_id' | 'relationship_type' | 'recent_interactions'>;
                    
                    const validAttributes = ['trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'];
                    if (!validAttributes.includes(attr)) break;

                    // Directional semantics: the key 'A:B:attribute' changes A's
                    // perception of B only. Relationships are asymmetric by design
                    // (A can trust B while B despises A), and attributes like
                    // perceived_threat are inherently one-sided. Mutual changes
                    // require two deltas, one per direction — the schema/prompt
                    // instruct the model accordingly.
                    const entity = updatedEntities.find(e => e.entity_id === entityAId);
                    if (entity) {
                        if (!entity.relationships[entityBId]) {
                            entity.relationships[entityBId] = { entity_id: entityBId, relationship_type: 'acquaintance', trust_level: 0, recent_interactions: [] };
                        }

                        const rel = entity.relationships[entityBId];

                        // Initialize attribute if it doesn't exist
                        if (rel[attr] === undefined) {
                            (rel as any)[attr] = 0;
                        }

                        if (typeof (rel as any)[attr] === 'number') {
                            (rel as any)[attr] += delta.delta;

                            // Clamping logic
                            if (attr === 'trust_level' || attr === 'ideological_alignment' || attr === 'respect_level') {
                                (rel as any)[attr] = Math.max(-10, Math.min(10, (rel as any)[attr]));
                            } else if (attr === 'perceived_threat' || attr === 'dependency_level') {
                                (rel as any)[attr] = Math.max(0, Math.min(10, (rel as any)[attr]));
                            }
                        }

                        if (!rel.recent_interactions.some(interaction => interaction.endsWith(delta.reason))) {
                            rel.recent_interactions.push(`Turn ${turnNumber}: ${delta.reason}`);
                        }
                    }
                    break;
                }
                 case 'status': {
                    const entity = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entity) {
                        const newStatus = delta.reason.toLowerCase();
                        // STOPGAP (full enum redesign tracked separately): the AI's free-text
                        // 'reason' is matched against natural death phrasings ("has died", "was
                        // killed", "slain", etc.), not just the literal substring "dead". To avoid
                        // false-positive kills on phrasing like "nearly died but survived", any
                        // survival/negation wording nearby suppresses the death match.
                        const indicatesDeath = /\b(dead|died|killed|slain|slaughtered|assassinated|perished|executed)\b/.test(newStatus);
                        const indicatesSurvival = /\b(surviv\w*|recovers?|recovered|escape[sd]?|avoid(?:s|ed|ing)?|spared|rescued|saved|did ?n'?t die|no one (?:died|was killed))\b/.test(newStatus);
                        if (indicatesDeath && !indicatesSurvival) entity.status = 'dead';
                        else if (newStatus.includes('exiled')) entity.status = 'exiled';
                        else if (newStatus.includes('missing')) entity.status = 'missing';
                        else if (newStatus.includes('moves to')) {
                            const location = newStatus.replace('moves to ', '').trim();
                            const validLocations = Object.keys(currentWorldState.regions);
                            // A simple check to see if the location is valid before assigning
                            if (validLocations.some(vl => location.toLowerCase().includes(vl.toLowerCase()))) {
                                entity.location = validLocations.find(vl => location.toLowerCase().includes(vl.toLowerCase())) || entity.location;
                            }
                        }
                    }
                    break;
                }
                case 'region': {
                    const [regionName, property] = delta.key.split(':');
                    if(updatedWorldState.regions[regionName] && property === 'stability') {
                        updatedWorldState.regions[regionName].stability = delta.reason;
                    }
                    break;
                }
                case 'rumor': {
                    const newReport: Report = {
                        id: `report_${turnNumber}_${Date.now()}`,
                        turn: turnNumber,
                        source: 'rumor',
                        about: delta.key, // entity or region id
                        claim: delta.reason,
                        credibility: Math.max(0.0, Math.min(1.0, delta.delta))
                    };
                    newReports.push(newReport);
                    break;
                }
                case 'scheme': {
                    const entity = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entity) {
                        try {
                            entity.active_scheme = JSON.parse(delta.reason);
                        } catch (e) {
                            console.error(`Failed to parse scheme JSON for ${delta.key}:`, delta.reason);
                        }
                    }
                    break;
                }
                case 'add_region': {
                    try {
                        const newRegionState = JSON.parse(delta.reason);
                        updatedWorldState.regions[delta.key] = newRegionState;
                    } catch (e) {
                        console.error(`Failed to parse RegionState JSON for ${delta.key}:`, delta.reason);
                    }
                    break;
                }
                case 'remove_region': {
                    if (updatedWorldState.regions[delta.key]) {
                        delete updatedWorldState.regions[delta.key];
                    }
                    break;
                }
                case 'faction': {
                    const entityToMove = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entityToMove) {
                        const oldFactionId = entityToMove.faction_id;
                        const newFactionId = delta.reason === 'null' ? undefined : delta.reason;

                        // Remove from old faction's member list
                        if (oldFactionId) {
                            const oldFaction = updatedEntities.find(e => e.entity_id === oldFactionId);
                            if (oldFaction && oldFaction.faction_members) {
                                oldFaction.faction_members = oldFaction.faction_members.filter(id => id !== entityToMove.entity_id);
                            }
                        }

                        // Add to new faction's member list and update entity's faction_id
                        entityToMove.faction_id = newFactionId;
                        if (newFactionId) {
                            const newFaction = updatedEntities.find(e => e.entity_id === newFactionId);
                            if (newFaction && newFaction.faction_members) {
                                if (!newFaction.faction_members.includes(entityToMove.entity_id)) {
                                    newFaction.faction_members.push(entityToMove.entity_id);
                                }
                            }
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error("Error applying delta:", delta, e);
        }
    });

    return { updatedEntities, updatedWorldState, newReports };
}


export function applyAdjudication(
    adjudication: Adjudication,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    currentReports: Report[]
): { updatedEntities: Entity[], updatedWorldState: WorldState, updatedReports: Report[] } {
    
    let { updatedEntities: entitiesAfterDeltas, updatedWorldState, newReports } = applyDeltas(adjudication.deltas, currentEntities, currentWorldState, adjudication.turn);
    const updatedReports = [...currentReports, ...newReports];

    // Handle non-delta updates like memories
    adjudication.headlines.forEach(headline => {
        entitiesAfterDeltas.forEach(entity => {
            if (headline.toLowerCase().includes(entity.name.toLowerCase())) {
                entity.memories.push({
                    turn: adjudication.turn,
                    event_description: headline,
                    emotional_impact: "Notable",
                    involved_entities: [] 
                });
            }
        });
    });

    // Handle entity additions and removals
    if (adjudication.remove_entities && adjudication.remove_entities.length > 0) {
        const idsToRemove = new Set(adjudication.remove_entities);
        entitiesAfterDeltas = entitiesAfterDeltas.filter(e => !idsToRemove.has(e.entity_id));
        
        // Clean up dangling relationships
        entitiesAfterDeltas.forEach(entity => {
            for (const removedId of idsToRemove) {
                if (entity.relationships[removedId]) {
                    delete entity.relationships[removedId];
                }
            }
        });
    }

    if (adjudication.add_entities && adjudication.add_entities.length > 0) {
        entitiesAfterDeltas.push(...adjudication.add_entities);
    }

    return { updatedEntities: entitiesAfterDeltas, updatedWorldState, updatedReports };
}