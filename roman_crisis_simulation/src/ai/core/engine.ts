import { Entity, WorldState, Adjudication, Report, EventDelta, Relationship } from '../../types';

// NOTE: The turn-adjudication prompt (formerly `compileContext` here) has
// moved to `ai/prompts/adjudication.ts::buildAdjudicationPrompt`, and its
// `getEntityBrief` helper to `ai/prompts/fragments.ts`, as part of
// centralizing all prompt text under ai/prompts/ (see
// ai/prompts/README.md). This file stays pure state-transition logic - see
// ROADMAP_6_MAINTAINABILITY.md's note that `engine.ts` is "pure and
// testable" and should stay that way.

/**
 * The free-text death-phrase heuristic, used only when a 'status' delta
 * omits the structured `new_status` field (a legacy/pre-MAINT-P0.2 delta,
 * or a turn where the model forgot to set it). Matches common death
 * phrasings while suppressing false positives from nearby
 * survival/negation wording (e.g. "nearly died but survived"). Extracted
 * from applyDeltas' inline 'status' case so it has exactly one
 * implementation.
 */
export function legacyReasonIndicatesDeath(reason: string): boolean {
    const text = reason.toLowerCase();
    const indicatesDeath = /\b(dead|died|killed|slain|slaughtered|assassinated|perished|executed)\b/.test(text);
    const indicatesSurvival = /\b(surviv\w*|recovers?|recovered|escape[sd]?|avoid(?:s|ed|ing)?|spared|rescued|saved|did ?n'?t die|no one (?:died|was killed))\b/.test(text);
    return indicatesDeath && !indicatesSurvival;
}

/**
 * True if a 'status' EventDelta represents a claimed death - either via the
 * structured `new_status === 'dead'` field (preferred, MAINT-P0.2), or (for
 * legacy deltas that omit it) `legacyReasonIndicatesDeath`'s free-text
 * matching. This is the EXACT rule `applyDeltas`' 'status' case uses to
 * decide whether an entity dies, exported so
 * `ai/core/mortality.ts`'s death-claim scan (DESIGN_DECISIONS.md D2/D3)
 * reuses the identical detection instead of re-implementing the regex.
 */
export function isDeathClaimDelta(delta: EventDelta): boolean {
    if (delta.type !== 'status') return false;
    if (delta.new_status) return delta.new_status === 'dead';
    return legacyReasonIndicatesDeath(delta.reason);
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
                        const validStatuses: Entity['status'][] = ['alive', 'dead', 'exiled', 'missing'];

                        if (delta.new_status && validStatuses.includes(delta.new_status)) {
                            // STRUCTURED PATH (preferred, MAINT-P0.2): the model set the
                            // enum field explicitly. This wins regardless of how 'reason'
                            // happens to be phrased - e.g. new_status:'dead' alongside a
                            // reason like "He miraculously survived" still results in
                            // death, because 'reason' is narrative/display text only and
                            // is never parsed for control flow when the structured field
                            // is present.
                            entity.status = delta.new_status;
                        } else {
                            // LEGACY FALLBACK (pre-MAINT-P0.2, kept as-is): no structured
                            // 'new_status' was supplied - either an older mock/save that
                            // predates the enum field, or the model omitted it. Fall back
                            // to free-text parsing of 'reason'.
                            //
                            // STOPGAP (full enum redesign tracked separately): the AI's free-text
                            // 'reason' is matched against natural death phrasings ("has died", "was
                            // killed", "slain", etc.), not just the literal substring "dead". To avoid
                            // false-positive kills on phrasing like "nearly died but survived", any
                            // survival/negation wording nearby suppresses the death match. See
                            // `legacyReasonIndicatesDeath` above (also reused by
                            // ai/core/mortality.ts's death-claim detection).
                            const newStatus = delta.reason.toLowerCase();
                            if (legacyReasonIndicatesDeath(delta.reason)) entity.status = 'dead';
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

                        // STRUCTURED PATH (preferred, MAINT-P0.2): applied after the
                        // status handling above (structured or legacy) so a single delta
                        // can carry both a status change and a location change (e.g.
                        // fleeing into exile). Only exact, known region names are
                        // accepted - unlike the legacy fuzzy substring match above, this
                        // is a direct lookup since the model is expected to echo a real
                        // region name. An unrecognized region leaves location unchanged.
                        if (delta.new_location) {
                            const validLocations = Object.keys(currentWorldState.regions);
                            if (validLocations.includes(delta.new_location)) {
                                entity.location = delta.new_location;
                            }
                        }

                        // GM-PRIVATE secret-survival state (DESIGN_DECISIONS.md D3).
                        // CODE-GENERATED ONLY - this field is never requested from the
                        // model (see types.ts's EventDelta.secret_truth); only
                        // ai/core/mortality.ts::processMortality attaches it, when a
                        // validated NPC death resolves to "presumed dead" on the fate
                        // table. Copying it here (alongside status/location) keeps a
                        // single application point for everything a 'status' delta can
                        // carry.
                        if (delta.secret_truth) {
                            entity.secret_truth = delta.secret_truth;
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