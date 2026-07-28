
import { Type } from "@google/genai";
import { EntityActionIntentEnum, EventDeltaTypeEnum, NpcIntentContinuityEnum } from '../../types';

/** Strict selector output for perception-safe relationship observations. */
export const RelationshipObservationsSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            evidenceId: { type: Type.STRING },
            participantIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            excerpt: { type: Type.STRING, minLength: 1, description: 'A non-empty exact substring of the cited evidence.' },
        },
        required: ['evidenceId', 'participantIds', 'excerpt'],
    },
};

/** Strict evidence-ID selector for question-only no-attempt responses. */
export const NoAttemptEvidenceSelectionSchema = {
    type: Type.OBJECT,
    properties: {
        decision: { type: Type.STRING, enum: ['answer', 'no_answer'] },
        evidenceIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            maxItems: 5,
        },
    },
    required: ['decision', 'evidenceIds'],
};

const EntityActionSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.STRING, description: "The ID of the entity taking the action." },
        intent: { type: Type.STRING, enum: EntityActionIntentEnum, description: "The specific action being taken." },
        target: { type: Type.STRING, nullable: true, description: "The ID of the target entity or region, if any." },
        notes: { type: Type.STRING, description: "A brief description of the action's specifics or rationale." },
    },
    required: ['id', 'intent', 'notes'],
};

const EventDeltaSchema = {
    type: Type.OBJECT,
    properties: {
        type: { type: Type.STRING, enum: EventDeltaTypeEnum, description: "The type of state change." },
        key: { type: Type.STRING, description: "Identifier for what is changing. For 'relation', use 'entity_a_id:entity_b_id:attribute' (e.g., trust_level, perceived_threat) — the delta changes entity_a's perception of entity_b ONLY; if a change is mutual, emit a second delta with the ids reversed. For 'resource', use 'entity_id:resource_name'. For 'scheme' or 'faction', this is the entity_id. For region changes, use the region's name. For 'world', use 'economic_stability' or 'political_climate' — no other keys are recognized." },
        delta: { type: Type.NUMBER, description: "The numerical change to apply. For status, scheme, region, add_region, remove_region, and faction this is ignored. For rumors, this should be a float from 0.0 to 1.0 representing credibility." },
        reason: { type: Type.STRING, description: "A short NARRATIVE description of why the change occurred, for display only - it is never parsed to decide game state. For 'rumor' types, this contains the rumor text. For 'scheme', this is a JSON string of the complete, updated scheme object. For 'add_region', this is a JSON string of the new RegionState object. For 'faction', this is the entity_id of the new faction, or 'null' if they become unaligned. For 'status' types, this is still the narrative explanation (e.g. 'Struck down by an assassin's blade in the forum') - the actual status/location change for 'status' deltas MUST be set via new_status/new_location below, not inferred from this text. For 'world' types, this IS the new value itself — the short string to assign to the WorldState field named in 'key' (e.g. 'Failing', 'Openly Hostile')." },
        new_status: { type: Type.STRING, enum: ['alive', 'dead', 'exiled', 'missing'], nullable: true, description: "REQUIRED for 'status' type deltas whenever an entity's life or freedom status changes (dies, is exiled, goes missing, or is restored to alive) - set this to the entity's new status. Omit/null for all other delta types." },
        new_location: { type: Type.STRING, nullable: true, description: "Optional, 'status' type deltas only: set this to the (existing) region name the entity has moved to, when the status change involves relocation (e.g. fleeing into exile, going missing in a specific region). Omit/null if the entity's location does not change." },
        is_true: { type: Type.BOOLEAN, nullable: true, description: "REQUIRED for 'rumor' type deltas, GM-PRIVATE: whether the rumor's claim is ACTUALLY TRUE in the simulation's reality. You define reality - rule true or false on EVERY rumor, never leave it unset. Independent of 'delta' (credibility): a false rumor can sound highly credible, a true one implausible. Ruled STRICTLY by world-truth: a fabrication that happens to be true is still true, a deliberately spread truth is still true - authorship never changes the ruling (a planted lie is false because its claim is false, not because it was planted). Omit/null for all other delta types. This never reaches the player." },
        origin_id: { type: Type.STRING, nullable: true, description: "'rumor' type deltas only, GM-PRIVATE: the entity_id of whoever started or spreads the rumor - the PLAYER's entity_id when their action planted or spread it, the planting NPC's when a scheme did. Omit/null ONLY when the rumor is organic with no single attributable source. Omit/null for all other delta types. This never reaches the player." },
        topic: { type: Type.STRING, nullable: true, description: "REQUIRED for 'rumor' type deltas, NOT private: a short lowercase hyphenated slug naming WHAT about the subject the rumor concerns (e.g. 'health', 'tribute', 'succession-plot', 'legion-loyalty'). Distinct matters about the same subject MUST get DISTINCT topics so they stay separate claims; a follow-up about the SAME matter reuses the SAME topic (and key). This is a neutral category label, never a statement of the rumor's truth. Omit/null for all other delta types." },
        stance: { type: Type.STRING, enum: ['corroborates', 'contradicts'], nullable: true, description: "'rumor' type deltas only, NOT private: only on a COUNTERPLAY follow-up that reuses an existing rumor's key AND topic - set 'corroborates' if the follow-up backs the running claim, 'contradicts' if it refutes it. Omit/null on a first emission or an ordinary restatement. Independent of truth: refuting a true rumor or backing a false one are both allowed." },
    },
    required: ['type', 'key', 'delta', 'reason'],
};


// --- Sub-schemas for the Entity object ---
const PersonalityTraitsSchema = {
    type: Type.OBJECT,
    properties: {
        ambition: { type: Type.NUMBER },
        paranoia: { type: Type.NUMBER },
        loyalty: { type: Type.NUMBER },
        cunning: { type: Type.NUMBER },
        honor: { type: Type.NUMBER },
    },
    required: ['ambition', 'paranoia', 'loyalty', 'cunning', 'honor']
};

const RelationshipSchema = {
    type: Type.OBJECT,
    properties: {
        entity_id: { type: Type.STRING },
        relationship_type: { type: Type.STRING },
        trust_level: { type: Type.NUMBER },
        respect_level: { type: Type.NUMBER, nullable: true, description: "Range -10 to 10. How much this entity respects the other's skills, power, or position." },
        perceived_threat: { type: Type.NUMBER, nullable: true, description: "Range 0-10. How threatening this entity is perceived to be." },
        ideological_alignment: { type: Type.NUMBER, nullable: true, description: "Range -10 to 10. How aligned their beliefs are." },
        dependency_level: { type: Type.NUMBER, nullable: true, description: "Range 0-10. How much the parent entity depends on this one." },
        recent_interactions: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['entity_id', 'relationship_type', 'trust_level', 'recent_interactions']
};

const MemorySchema = {
    type: Type.OBJECT,
    properties: {
        turn: { type: Type.NUMBER },
        event_description: { type: Type.STRING },
        emotional_impact: { type: Type.STRING },
        involved_entities: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['turn', 'event_description', 'emotional_impact', 'involved_entities']
};

const SchemeStepSchema = {
    type: Type.OBJECT,
    properties: {
        objective: { type: Type.STRING },
        status: { type: Type.STRING, enum: ['pending', 'in_progress', 'completed', 'failed'] }
    },
    required: ['objective', 'status']
};

const SchemeSchema = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING },
        overall_goal: { type: Type.STRING },
        steps: { type: Type.ARRAY, items: SchemeStepSchema }
    },
    required: ['name', 'overall_goal', 'steps']
};

export const EntitySchema = {
    type: Type.OBJECT,
    properties: {
        entity_id: { type: Type.STRING },
        name: { type: Type.STRING },
        entity_type: { type: Type.STRING, enum: ['individual', 'group', 'faction'] },
        status: { type: Type.STRING, enum: ['alive', 'dead', 'exiled', 'missing'] },
        position: { type: Type.STRING, nullable: true },
        // 4C.5 narrative flavor - OPTIONAL (never in `required` below, for
        // save/legacy compatibility); mirrors types.ts's Entity.voice/epithet
        // and zEntity in ai/core/zodSchemas.ts - keep all three in lockstep.
        voice: { type: Type.STRING, nullable: true, description: "OPTIONAL narrative flavor: a COMPACT speech-style directive for how this character talks and thinks (e.g. \"clipped soldier's Latin, contempt for senatorial flourish\"). One short clause or two; for a collective entity (faction, guard, mob) a group voice is fine." },
        epithet: { type: Type.STRING, nullable: true, description: "OPTIONAL narrative flavor: a SHORT public byname the street knows this character by (e.g. \"the Thracian\"). A few words, without the character's name itself." },
        location: { type: Type.STRING },
        personality: { ...PersonalityTraitsSchema, nullable: true },
        faction_id: { type: Type.STRING, nullable: true },
        size: { type: Type.NUMBER, nullable: true },
        faction_members: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
        relationships: {
            type: Type.OBJECT,
            properties: {
                'severus_alexander': { ...RelationshipSchema, nullable: true, description: "Optional: Relationship with Severus Alexander" },
                'maximinus_thrax': { ...RelationshipSchema, nullable: true, description: "Optional: Relationship with Maximinus Thrax" },
            },
            additionalProperties: RelationshipSchema,
            description: "A record of relationships. The key is the entity_id."
        },
        memories: { type: Type.ARRAY, items: MemorySchema },
        resources: {
            type: Type.OBJECT,
            properties: {
                denarii: { type: Type.NUMBER, nullable: true },
                investigations: { type: Type.NUMBER, nullable: true },
                deep_analyses: { type: Type.NUMBER, nullable: true },
            },
            additionalProperties: { oneOf: [{ type: Type.STRING }, { type: Type.NUMBER }, { type: Type.ARRAY, items: { type: Type.STRING } }] },
            description: "A record of resources. The key is the resource name (e.g., 'denarii', 'legion_support', 'blackmail_material'). Values can be numbers, strings, or arrays of strings."
        },
        visibility_network: { type: Type.ARRAY, items: { type: Type.STRING } },
        current_state_narrative: { type: Type.STRING },
        short_term_goals: { type: Type.ARRAY, items: { type: Type.STRING } },
        long_term_ambitions: { type: Type.ARRAY, items: { type: Type.STRING } },
        beliefs: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
        secrets: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
        skills: {
            type: Type.OBJECT,
            properties: {
                oratory: { type: Type.NUMBER, nullable: true },
                strategy: { type: Type.NUMBER, nullable: true },
                intrigue: { type: Type.NUMBER, nullable: true },
            },
            additionalProperties: { type: Type.NUMBER },
            nullable: true,
            description: "A record of skills (e.g. 'oratory', 'strategy')."
        },
        active_scheme: { ...SchemeSchema, nullable: true },
    },
    required: ['entity_id', 'name', 'entity_type', 'status', 'location', 'relationships', 'memories', 'resources', 'visibility_network', 'current_state_narrative', 'short_term_goals', 'long_term_ambitions']
};


const RegionStateSchema = {
    type: Type.OBJECT,
    properties: {
        stability: { type: Type.STRING },
        controlling_faction: { type: Type.STRING, nullable: true },
        current_events: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['stability', 'controlling_faction', 'current_events']
};

const WorldStateSchema = {
    type: Type.OBJECT,
    properties: {
        year: { type: Type.NUMBER },
        week: { type: Type.NUMBER },
        economic_stability: { type: Type.STRING },
        political_climate: { type: Type.STRING },
        regions: {
            type: Type.OBJECT,
            properties: {
                'Palatine Hill': { ...RegionStateSchema, nullable: true },
                'The Curia': { ...RegionStateSchema, nullable: true },
            },
            additionalProperties: RegionStateSchema,
            description: "A dictionary of regions, where the key is the region name."
        }
    },
    required: ['year', 'week', 'economic_stability', 'political_climate', 'regions']
};

export const InitialWorldSchema = {
    type: Type.OBJECT,
    properties: {
        worldState: WorldStateSchema,
        entities: { type: Type.ARRAY, items: EntitySchema },
        playerCharacterId: { type: Type.STRING, description: "The entity_id of the player's character within the entities array." }
    },
    required: ['worldState', 'entities', 'playerCharacterId']
};

export const EntityStubSchema = {
    type: Type.OBJECT,
    properties: {
        entity_id: { type: Type.STRING },
        name: { type: Type.STRING },
        entity_type: { type: Type.STRING, enum: ['individual', 'group', 'faction'] },
        position: { type: Type.STRING, description: "Position or title." },
        brief_description: { type: Type.STRING }
    },
    required: ['entity_id', 'name', 'entity_type', 'position', 'brief_description']
};

export const ScenarioStructureSchema = {
    type: Type.OBJECT,
    properties: {
        worldState: WorldStateSchema,
        playerStub: EntityStubSchema,
        npcStubs: { type: Type.ARRAY, items: EntityStubSchema }
    },
    required: ['worldState', 'playerStub', 'npcStubs']
};

export const EntityListSchema = {
    type: Type.OBJECT,
    properties: {
        entities: { type: Type.ARRAY, items: EntitySchema }
    },
    required: ['entities']
};


export const AdjudicationSchema = {
    type: Type.OBJECT,
    properties: {
        turn: { type: Type.NUMBER },
        entityActions: { type: Type.ARRAY, items: EntityActionSchema, description: "Actions decided upon by all major entities this turn." },
        deltas: { type: Type.ARRAY, items: EventDeltaSchema, description: "The specific, atomic state changes that result from all actions." },
        headlines: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A few major, publicly known events that occurred this turn." },
        gm_private: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Private notes or secret events for the GM's eyes only." },
        add_entities: { 
            type: Type.ARRAY, 
            items: EntitySchema,
            nullable: true, 
            description: "A list of new FULL ENTITY objects to add to the simulation. Must match the structure of existing entities." 
        },
        remove_entities: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }, 
            nullable: true, 
            description: "A list of entity_ids to remove from the simulation." 
        }
    },
    required: ['turn', 'entityActions', 'deltas', 'headlines', 'gm_private'],
};

export const StoryRelevanceSchema = {
    type: Type.OBJECT,
    properties: {
        spotlight_entities: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    entity_id: { type: Type.STRING },
                    reason: { type: Type.STRING }
                },
                required: ['entity_id', 'reason']
            }
        },
        spotlight_intents: {
            type: Type.ARRAY,
            description: "Exactly one persistent intent per spotlight entity, matched by entity_id. GM-private direction: this never reaches the player.",
            items: {
                type: Type.OBJECT,
                properties: {
                    entity_id: { type: Type.STRING, description: "The spotlight entity this intent belongs to - must match a spotlight_entities entry." },
                    intent: { type: Type.STRING, description: "ONE LINE: what this character is trying to accomplish next." },
                    continuity: { type: Type.STRING, enum: NpcIntentContinuityEnum, description: "'continue' if this carries the character's previous intent forward, 'pivot' if it redirects/abandons the previous intent, 'new' if the character had no previous intent on record." },
                },
                required: ['entity_id', 'intent', 'continuity']
            }
        },
        add_entity_suggestion: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                description: { type: Type.STRING, description: "A detailed description of the new entity to be created." },
                reason: { type: Type.STRING, description: "Why this entity should be added now." }
            },
            required: ['description', 'reason']
        },
        remove_entity_suggestion: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                entity_id: { type: Type.STRING, description: "The ID of the entity to remove." },
                reason: { type: Type.STRING, description: "Why this entity should be removed now." }
            },
            required: ['entity_id', 'reason']
        },
        add_location_suggestion: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                name: { type: Type.STRING, description: "The name of the new location." },
                description: { type: Type.STRING, description: "A brief description of the new location." },
                reason: { type: Type.STRING, description: "Why this location should be added now." }
            },
            required: ['name', 'description', 'reason']
        },
        remove_location_suggestion: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                name: { type: Type.STRING, description: "The name of the location to remove." },
                reason: { type: Type.STRING, description: "Why this location should be removed now." }
            },
            required: ['name', 'reason']
        }
    },
    required: ['spotlight_entities', 'spotlight_intents']
};

export const SimulationStateSchema = {
    type: Type.OBJECT,
    properties: {
        imperial_status: { type: Type.STRING, enum: ['Stable', 'Contested', 'Vacant'] },
        senate_status: { type: Type.STRING, enum: ['Ascendant', 'Functional', 'Deposed', 'Irrelevant'] },
        military_status: { type: Type.STRING, enum: ['Loyal', 'Divided', 'Rebellious'] },
        plebeian_mood: { type: Type.STRING, enum: ['Content', 'Uneasy', 'Rioting'] },
        major_ongoing_crisis: { type: Type.STRING, nullable: true },
    },
    required: ['imperial_status', 'senate_status', 'military_status', 'plebeian_mood', 'major_ongoing_crisis']
};

// --- Mortality pipeline (ai/core/mortality.ts, DESIGN_DECISIONS.md D2/D3) --

/** The mortality VALIDATION call's Gemini response schema (ai/core/mortality.ts). */
export const MortalityValidationSchema = {
    type: Type.OBJECT,
    properties: {
        dispositions: {
            type: Type.ARRAY,
            description: "Exactly one disposition per death-claim candidate, matched by entity_id.",
            items: {
                type: Type.OBJECT,
                properties: {
                    entity_id: { type: Type.STRING },
                    valid: { type: Type.BOOLEAN, description: "True if this death is real and earned given the turn's events; false if hallucinated/unsupported melodrama." },
                    reasoning: { type: Type.STRING, description: "Short (1-2 sentence) justification, for the GM only - never shown to the player." },
                },
                required: ['entity_id', 'valid', 'reasoning'],
            },
        },
    },
    required: ['dispositions'],
};

/** The mortality OUTCOME call's Gemini response schema (ai/core/mortality.ts). */
export const MortalityOutcomeSchema = {
    type: Type.OBJECT,
    properties: {
        outcomes: {
            type: Type.ARRAY,
            description: "Exactly one outcome entry per candidate, matched by entity_id.",
            items: {
                type: Type.OBJECT,
                properties: {
                    entity_id: { type: Type.STRING },
                    deltas: { type: Type.ARRAY, items: EventDeltaSchema, description: "Loss/boon/wounding SIDE-EFFECT deltas only - never a 'status' delta, that has already been decided." },
                    narrative_directive: { type: Type.STRING, description: "One line steering the narrator on exactly how to narrate this outcome." },
                    secret_motive: { type: Type.STRING, nullable: true, description: "'presumed_dead' candidates only: why they're hiding and what they might want if they return. Omit/null otherwise." },
                },
                required: ['entity_id', 'deltas', 'narrative_directive'],
            },
        },
    },
    required: ['outcomes'],
};

// --- NPC minds (ai/tools/npcMind.ts, ROADMAP_PHASE_4.md 4C item 4, D10/D22) --

/**
 * The per-spotlight mind call's Gemini response schema (ai/tools/npcMind.ts,
 * ai/prompts/npcMind.ts). Mirrors `zNpcMindDecision` in
 * ai/core/zodSchemas.ts and `NpcMindDecision` in types.ts; keep all three in
 * lockstep. The whole object is GM-private (D4/D5) - `private_reasoning` in
 * particular never reaches the adjudication prompt or any player surface.
 */
export const NpcMindDecisionSchema = {
    type: Type.OBJECT,
    properties: {
        entity_id: { type: Type.STRING, description: "Your own entity_id, exactly as given in your brief." },
        chosen_action: { type: Type.STRING, description: "ONE concrete act you take this week, in prose - a single decisive move, not a list of options." },
        method: { type: Type.STRING, description: "HOW you carry the act out, briefly - the means, the timing, the cover." },
        private_reasoning: { type: Type.STRING, description: "Your true, first-person thinking behind the move - the honest why, including anything you would never say aloud. No one in the world ever hears this." },
        scheme_adjustment: { type: Type.STRING, nullable: true, description: "OPTIONAL: if this week's events shift your active scheme in your own mind (a step completed, failed, or redirected), one line on how. Omit/null if your scheme stands unchanged." },
    },
    required: ['entity_id', 'chosen_action', 'method', 'private_reasoning'],
};

// --- Resolution layer: action assessment (ai/tools/assessment.ts, ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) --

/** The action-assessment call's Gemini response schema (ai/tools/assessment.ts). */
export const ActionAssessmentSchema = {
    type: Type.OBJECT,
    properties: {
        is_consequential: { type: Type.BOOLEAN, description: "True if the player's action carries real risk/uncertainty/opposition warranting a hidden dice roll; false for questions, idle conversation, or pure information requests." },
        action_category: { type: Type.STRING, description: "A short free-text label for the kind of action (e.g. 'oratory persuasion', 'intrigue/scheme', 'treachery'). GM-only classification, never shown to the player." },
        relevant_skill: { type: Type.STRING, enum: ['oratory', 'strategy', 'intrigue'], nullable: true, description: "The single most load-bearing skill for this action, or null if none clearly applies (always null when is_consequential is false)." },
        difficulty: { type: Type.NUMBER, description: "Target difficulty from 5 (trivial) to 25 (nearly impossible), before the player's own skill/personality are factored in." },
        opposing_entity_id: { type: Type.STRING, nullable: true, description: "The exact entity_id of the specific NPC this action opposes/targets, or null if none." },
        rationale: { type: Type.STRING, description: "Short (1-2 sentence) GM-only justification - never shown to the player." },
    },
    required: ['is_consequential', 'action_category', 'relevant_skill', 'difficulty', 'opposing_entity_id', 'rationale'],
};

/**
 * Investigation results have a `reportData` string-list shape for every
 * subject: a list of findings for 'secrets'/'beliefs', and for 'scheme' a
 * list of partial CLUES (D28 - a scheme investigation returns fragments that
 * hint at the plot, never the whole Scheme; its nature is earned across
 * several investigations, not dumped by one). `subject` no longer switches the
 * shape - kept in the signature for call-site symmetry with the prompt
 * builder. Mirrors the inline schema previously built per-call inside
 * `intelligence.ts::getInvestigationResult`.
 */
export function buildInvestigationResultSchema(subject: 'secrets' | 'beliefs' | 'scheme') {
    void subject;
    return {
        type: Type.OBJECT,
        properties: {
            reportData: { type: Type.ARRAY, items: { type: Type.STRING } },
            report: { type: Type.STRING, description: "The narrative intelligence report summarizing the findings." },
            consequences: { type: Type.STRING, nullable: true, description: "Negative consequences of the investigation. If none, return null." }
        },
        required: ['reportData', 'report', 'consequences']
    };
}

/**
 * The Gemini response schema for player-driven character creation
 * (ai/tools/characterCreator.ts::createCharacter). Reuses `RelationshipSchema`
 * and `SchemeSchema` from above rather than re-declaring them a third time
 * (previously hand-copied here) - see ROADMAP_6_MAINTAINABILITY.md's note
 * that the Scheme/Relationship JSON schema was "hand-copied across
 * schemas.ts, characterCreator.ts, and intelligence.ts". This schema's
 * `required` list and relationship key set intentionally differ from the
 * main `EntitySchema` above (new characters must ship with an
 * `active_scheme`/`personality`/`beliefs`/`secrets`/`skills` up front,
 * seeded against the *initial* named cast, whereas mid-game `add_entities`
 * are looser) - so it stays a distinct schema rather than being merged.
 */
export const CharacterCreationEntitySchema = {
    type: Type.OBJECT,
    properties: {
        entity_id: { type: Type.STRING, description: "A unique snake_case version of the character's name." },
        name: { type: Type.STRING, description: "The character's full name." },
        entity_type: { type: Type.STRING, description: "Should be 'individual'." },
        status: { type: Type.STRING, description: "Should be 'alive'." },
        position: { type: Type.STRING, description: "The character's job or title." },
        // 4C.5 narrative flavor - optional here as everywhere (never in
        // `required`), but the character-creation prompt asks for both.
        voice: { type: Type.STRING, nullable: true, description: "A COMPACT speech-style directive for how this character talks and thinks (e.g. \"clipped soldier's Latin, contempt for senatorial flourish\"). One short clause or two." },
        epithet: { type: Type.STRING, nullable: true, description: "A SHORT public byname the street knows this character by (e.g. \"the Thracian\"). A few words, without the character's name itself." },
        location: { type: Type.STRING, description: "The character's starting location from this list: Palatine Hill, The Curia, Praetorian Camp, The Suburra." },
        faction_id: { type: Type.STRING, description: "Optional. Assign to 'senatorial_party' or 'military_cabal' if appropriate, otherwise omit." },
        personality: PersonalityTraitsSchema,
        beliefs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 2-3 core beliefs or ideologies." },
        secrets: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-2 hidden secrets or fears." },
        skills: {
            type: Type.OBJECT,
            properties: {
                oratory: { type: Type.NUMBER },
                administration: { type: Type.NUMBER },
                strategy: { type: Type.NUMBER },
                intrigue: { type: Type.NUMBER },
            },
            description: "A rating of skills from 1-10."
        },
        current_state_narrative: { type: Type.STRING, description: "A rich, third-person description of the character." },
        short_term_goals: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-3 immediate goals." },
        long_term_ambitions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-2 long-term ambitions." },
        active_scheme: SchemeSchema,
        resources: {
            type: Type.OBJECT,
            properties: {
                denarii: { type: Type.NUMBER, nullable: true },
                deep_analyses: { type: Type.NUMBER, nullable: true },
                investigations: { type: Type.NUMBER, nullable: true }
            },
            additionalProperties: { oneOf: [{ type: Type.STRING }, { type: Type.NUMBER }, { type: Type.ARRAY, items: { type: Type.STRING } }] },
            description: "Starting resources. Include denarii, deep_analyses, and investigations. Be creative with additional thematic resources."
        },
        relationships: {
            type: Type.OBJECT,
            description: "Initial relationships with existing entities. The key must be the entity_id.",
            properties: {
                "severus_alexander": RelationshipSchema,
                "maximinus_thrax": RelationshipSchema,
                "praetorian_guard": RelationshipSchema,
                "roman_senate": RelationshipSchema,
                "julia_mamaea": RelationshipSchema,
                "senatorial_party": RelationshipSchema,
                "military_cabal": RelationshipSchema
            }
        },
        visibility_network: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of entity_ids the character knows about." },
        memories: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Should be an empty array." }
    },
    required: ['entity_id', 'name', 'entity_type', 'status', 'position', 'location', 'personality', 'beliefs', 'secrets', 'skills', 'current_state_narrative', 'short_term_goals', 'long_term_ambitions', 'active_scheme', 'resources', 'relationships', 'visibility_network', 'memories']
};

// --- Offline eval judge (eval/judge.ts, DESIGN_DECISIONS.md D18) -----------

/** One judged axis: an integer score 1 (worst) to 5 (best) plus a short rationale. */
const EvalJudgeAxisScoreSchema = {
    type: Type.OBJECT,
    properties: {
        score: { type: Type.NUMBER, description: "Integer score from 1 (worst) to 5 (best) on this axis." },
        rationale: { type: Type.STRING, description: "Short justification citing specifics from the turn under review." },
    },
    required: ['score', 'rationale'],
};

/**
 * The offline eval judge call's Gemini response schema (eval/judge.ts,
 * ai/prompts/evalJudge.ts). Exactly five fixed axes - mirrors
 * `zEvalJudgeVerdict` in ai/core/zodSchemas.ts; keep the two in lockstep.
 * `character_richness` is the 4C richness axis (D10/D16): continuity of
 * self over plot convenience. Eval tooling only: this call is never made
 * from app code.
 */
export const EvalJudgeVerdictSchema = {
    type: Type.OBJECT,
    properties: {
        consequence_density: EvalJudgeAxisScoreSchema,
        sim_state_consistency: EvalJudgeAxisScoreSchema,
        schema_validity: EvalJudgeAxisScoreSchema,
        information_asymmetry: EvalJudgeAxisScoreSchema,
        character_richness: EvalJudgeAxisScoreSchema,
    },
    required: ['consequence_density', 'sim_state_consistency', 'schema_validity', 'information_asymmetry', 'character_richness'],
};
