
import { Type } from "@google/genai";
import { EntityActionIntentEnum, EventDeltaTypeEnum } from '../../types';

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
        key: { type: Type.STRING, description: "Identifier for what is changing. For 'relation', use 'entity_a_id:entity_b_id:attribute' (e.g., trust_level, perceived_threat) — the delta changes entity_a's perception of entity_b ONLY; if a change is mutual, emit a second delta with the ids reversed. For 'resource', use 'entity_id:resource_name'. For 'scheme' or 'faction', this is the entity_id. For region changes, use the region's name." },
        delta: { type: Type.NUMBER, description: "The numerical change to apply. For status, scheme, region, add_region, remove_region, and faction this is ignored. For rumors, this should be a float from 0.0 to 1.0 representing credibility." },
        reason: { type: Type.STRING, description: "A short narrative description of why the change occurred. For 'status' or 'rumor' types, this contains the new status or the rumor text. For 'scheme', this is a JSON string of the complete, updated scheme object. For 'add_region', this is a JSON string of the new RegionState object. For 'faction', this is the entity_id of the new faction, or 'null' if they become unaligned." },
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

export const RelationshipDeltasSchema = {
    type: Type.OBJECT,
    properties: {
        deltas: {
            type: Type.ARRAY,
            items: EventDeltaSchema,
            description: "A list of 'relation' type deltas to apply."
        }
    },
    required: ['deltas']
};

export const ConversationSimulationSchema = {
    type: Type.OBJECT,
    properties: {
        dialogueSnippet: { 
            type: Type.STRING, 
            description: "A short, third-person summary of the conversation for the GM Log (e.g., 'Maximinus and Pontius met in secret. Maximinus offered support in exchange for future concessions. Pontius agreed.')." 
        },
        deltas: { 
            type: Type.ARRAY, 
            items: EventDeltaSchema, 
            description: "A small set of EventDeltas resulting from the conversation (e.g., relationship changes, new secrets)." 
        }
    },
    required: ['dialogueSnippet', 'deltas']
};
