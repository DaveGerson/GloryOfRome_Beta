import { Entity, WorldState, Adjudication, Report, StoryRelevance, EventDelta, SimulationState, Relationship } from '../../types';

function getEntityBrief(entity: Entity): string {
    const relationships = Object.values(entity.relationships)
        .filter(r => r) // Filter out null or undefined relationships
        .map(r => `${r.entity_id}(T:${r.trust_level}, R:${r.respect_level ?? 0}, Th:${r.perceived_threat ?? 0}, A:${r.ideological_alignment ?? 0}, D:${r.dependency_level ?? 0})`).join(', ');
    const personality = entity.personality ? `Personality(A:${entity.personality.ambition}, P:${entity.personality.paranoia}, L:${entity.personality.loyalty}, C:${entity.personality.cunning}, H:${entity.personality.honor})` : '';
    const beliefs = entity.beliefs ? `Beliefs: ${entity.beliefs.join('; ')}` : '';
    const scheme = entity.active_scheme ? `Active Scheme: ${JSON.stringify(entity.active_scheme)}` : '';
    return `${entity.name} (${entity.position || entity.entity_type}) [Status: ${entity.status}, Location: ${entity.location}] Goals: ${entity.short_term_goals.join(', ')}. ${scheme}. ${personality}. ${beliefs}. Relationships: ${relationships}`;
}

export function compileContext(
    worldState: WorldState,
    simulationState: SimulationState,
    playerEntity: Entity,
    npcEntities: Entity[],
    history: string[],
    playerIntent: string,
    gmInterventionText: string,
    storyRelevance: StoryRelevance,
    metaNarrative: string
): string {
    const worldSummary = `Year: ${worldState.year}, Week: ${worldState.week}. Political Climate: ${worldState.political_climate}. Economic Stability: ${worldState.economic_stability}.`;

    const spotlightIds = new Set(storyRelevance.spotlight_entities.map(s => s.entity_id));
    const spotlightNpcs = npcEntities.filter(e => spotlightIds.has(e.entity_id) && e.status === 'alive');
    const otherNpcs = npcEntities.filter(e => !spotlightIds.has(e.entity_id) && e.status === 'alive');

    const spotlightBlock = spotlightNpcs.length > 0 ? `
SPOTLIGHT NPCS (Proactive Simulation):
These entities are central to this turn's events. You MUST generate proactive actions for them based on their 'Active Scheme'.
${spotlightNpcs.map(getEntityBrief).join('\n')}
` : 'No spotlight NPCs this turn.';

    const otherNpcsBlock = otherNpcs.length > 0 ? `
OTHER NPCS (Reactive Simulation):
These entities should primarily react to the player's action or the actions of spotlight NPCs. They only act independently if strongly motivated.
${otherNpcs.map(getEntityBrief).join('\n')}
` : '';

    const interventionBlock = gmInterventionText && gmInterventionText.trim() ? `
GM INTERVENTION:
The following directive MUST be taken into account. This represents an external event or a guiding hand from the Fates.
${gmInterventionText.trim()}
` : '';

    const storyEvolutionParts = [];
    if (storyRelevance.add_entity_suggestion) {
        storyEvolutionParts.push(`Add Entity: ${storyRelevance.add_entity_suggestion.description} Reason: ${storyRelevance.add_entity_suggestion.reason}`);
    }
    if (storyRelevance.remove_entity_suggestion) {
        storyEvolutionParts.push(`Remove Entity: ${storyRelevance.remove_entity_suggestion.entity_id}. Reason: ${storyRelevance.remove_entity_suggestion.reason}`);
    }
    if (storyRelevance.add_location_suggestion) {
        storyEvolutionParts.push(`Add Location: ${storyRelevance.add_location_suggestion.name} (${storyRelevance.add_location_suggestion.description}). Reason: ${storyRelevance.add_location_suggestion.reason}`);
    }
    if (storyRelevance.remove_location_suggestion) {
        storyEvolutionParts.push(`Remove Location: ${storyRelevance.remove_location_suggestion.name}. Reason: ${storyRelevance.remove_location_suggestion.reason}`);
    }
    const storyEvolutionBlock = storyEvolutionParts.length > 0 ? `
STORY EVOLUTION SUGGESTIONS:
The storyteller suggests the following changes to the world this turn. You MUST strongly consider implementing them.
${storyEvolutionParts.join('\n')}
` : '';

    const metaNarrativeBlock = metaNarrative ? `
META-NARRATIVE THEME:
The story should adhere to the following theme: "${metaNarrative}"
This should guide the tone, character actions, and outcomes to be consistent with this genre or style.
` : '';

    const metaStateBlock = `
**META-NARRATIVE STATE:**
This is the undeniable high-level truth of the world right now. All of your decisions MUST be consistent with this state.
${JSON.stringify(simulationState, null, 2)}
`;


    return `
ROLE: Roman Crisis Adjudicator & Simulation Engine
You are a meticulous simulation engine. Your task is to perform a two-phase adjudication for the turn.

${metaNarrativeBlock}

${metaStateBlock}

---
**PHASE 1: PROACTIVE NPC SIMULATION**
First, review the 'SPOTLIGHT NPCS'. These characters are actively pursuing their own agendas this turn. Based on their 'Active Scheme', personality, and goals, determine what actions they take *independently* of the player. These are their secret moves and plans for the week.

**PHASE 2: PLAYER ACTION ADJUDICATION & REACTION**
Next, consider the player's action. Adjudicate the outcome of this action and determine how all NPCs (both Spotlight and Other) react to it and to the events of Phase 1.

The final JSON output should be a single, unified adjudication combining both phases into a coherent narrative of the turn.
---

WORLD SUMMARY:
${worldSummary}
Regions: ${JSON.stringify(worldState.regions, null, 2)}

RECENT HISTORY (max 6 items):
${history.length > 0 ? history.join('\n') : "No recent events of note."}

--- TURN SIMULATION INPUTS ---

${spotlightBlock}

${otherNpcsBlock}

PLAYER CHARACTER:
Name: ${playerEntity.name} (ID: ${playerEntity.entity_id})
Action this turn: "${playerIntent}"
This action is an INPUT. Do NOT generate an action for the player in your output. Your task is to determine the consequences and NPC reactions to this action.

${interventionBlock}

${storyEvolutionBlock}

--- SIMULATION RULES & OUTPUT ---

PRINCIPLES:
- NARRATIVE DRIVE: Your primary goal is to create a dynamic, consequential story. Actions should have significant reactions, pushing the scenario towards climactic moments. Avoid static or "no change" outcomes. The world is on a knife's edge; reflect this in the adjudication.
- PERSONALITY & RELATIONSHIP DRIVEN AI: All NPC actions MUST be driven by their personality, relationships, and goals.
    - An honorable character (high honor) should avoid treachery. A paranoid character (high paranoia) might misinterpret neutral actions as hostile. Ambitious characters will take risks.
    - A character with high 'perceived_threat' from another should act defensively or preemptively against them.
    - A character with high 'respect_level' for another may hesitate to act against them or may treat them with deference, even if trust is low. Conversely, low respect can lead to dismissive or contemptuous actions.
    - Use 'ideological_alignment' to determine natural allies and enemies.
    - Use 'dependency_level' to see who might be easily coerced or who an entity might protect.
- DYNAMIC SCHEMES: An entity's actions must advance their 'active_scheme'. If a scheme is completed, failed, or becomes irrelevant, you MUST generate a completely new, plausible, multi-step 'active_scheme'. Update it using a 'scheme' delta. The 'key' is the entity's ID, delta is 0, and 'reason' is a JSON STRING of the complete, new scheme object.
- FLUID ALLIANCES: Factions are not permanent. Entities can be persuaded, coerced, or inspired to change their allegiance. If an event would logically cause an entity to switch sides, create a 'faction' delta. Major political shifts can also depose a faction leader or dissolve a faction entirely via 'status' or 'remove_entities' deltas.
- DYNAMIC RESOURCES: You can create new, specific resources for entities (e.g., 'blackmail_on_senator_x'). New resources are created via 'resource' deltas. The 'key' must be 'entity_id:resource_name' where resource_name is snake_case (4-20 characters). The 'reason' should explain what this resource represents.
- DYNAMIC CAST & LOCATIONS: The world is not static. Implement storyteller suggestions for adding/removing entities and locations.
    - To add an entity, use the 'add_entities' field.
    - To remove an entity, use the 'remove_entities' field.
    - To add/remove a location, create an 'add_region'/'remove_region' delta. Before removing a location, you MUST relocate any entities there using 'status' deltas.
- RELATIONSHIP DELTAS: To modify a relationship, create a 'relation' delta. The 'key' MUST specify the attribute: 'entity_a_id:entity_b_id:attribute'. Valid attributes are 'trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'. The 'delta' is the amount to change.
- Spotlight NPCs MUST take at least one proactive action to advance their scheme.
- All NPCs can react. The player's action can be the catalyst for the turn.
- Introduce 0-2 rumors per turn via 'rumor' deltas. A rumor's 'delta' field is its credibility (0.0 to 1.0).

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;
}


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

                    [entityAId, entityBId].forEach((id, index) => {
                        const entity = updatedEntities.find(e => e.entity_id === id);
                        if (entity) {
                            const otherId = index === 0 ? entityBId : entityAId;
                            if (!entity.relationships[otherId]) {
                                entity.relationships[otherId] = { entity_id: otherId, relationship_type: 'acquaintance', trust_level: 0, recent_interactions: [] };
                            }
                            
                            const rel = entity.relationships[otherId];
                            
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
                    });
                    break;
                }
                 case 'status': {
                    const entity = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entity) {
                        const newStatus = delta.reason.toLowerCase();
                        if (newStatus.includes('dead')) entity.status = 'dead';
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