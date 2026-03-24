
// Enums
export enum GameState {
  SETUP,
  AWAITING_PLAYER_INPUT,
  PROCESSING,
  AWAITING_EVENT_CHOICE,
}

/**
 * Represents a single message in the chat interface.
 */
export interface Message {
    sender: 'player' | 'gm' | 'player_monologue';
    text: string;
}

/**
 * Represents a selectable character option in the setup screen.
 */
export interface PlayerCharacterOption {
    name: string;
    entity_id: string;
    description: string;
    difficulty: string;
}

// Data Models based on the Technical Design Document

/**
 * Represents the personality of an individual entity.
 * Ranges are from 1 to 10.
 */
export interface PersonalityTraits {
  ambition: number;
  paranoia: number;
  loyalty: number;
  cunning: number;
  honor: number;
}

/**
 * Describes the relationship between two entities.
 */
export interface Relationship {
  entity_id: string;
  relationship_type: string; // e.g., family, ally, rival, subordinate
  trust_level: number; // Range: -10 to 10
  respect_level?: number; // Range: -10 to 10. How much this entity respects the other's skills or position.
  perceived_threat?: number; // Range: 0 to 10. How much of a threat they are perceived to be.
  ideological_alignment?: number; // Range: -10 to 10. How closely their beliefs align.
  dependency_level?: number; // Range: 0 to 10. How much this entity depends on the target.
  recent_interactions: string[];
}

/**
 * A memory of a past event.
 */
export interface Memory {
  turn: number;
  event_description: string;
  emotional_impact: string;
  involved_entities: string[];
}

/**
 * A single step within a character's multi-step plan.
 */
export interface SchemeStep {
  objective: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/**
 * A multi-step plan or scheme an entity is actively pursuing.
 */
export interface Scheme {
  name: string;
  overall_goal: string;
  steps: SchemeStep[];
}


/**
 * Represents an entity in the game world, which can be an individual, group, or faction.
 */
export interface Entity {
  entity_id: string;
  name: string;
  entity_type: 'individual' | 'group' | 'faction';
  status: 'alive' | 'dead' | 'exiled' | 'missing';
  position?: string;
  location: string;
  personality?: PersonalityTraits;
  faction_id?: string;
  size?: number;
  culture?: Record<string, string[]>;
  faction_members?: string[];
  relationships: Record<string, Relationship>;
  memories: Memory[];
  resources: Record<string, number | string | string[]>;
  visibility_network: string[];
  current_state_narrative: string;
  short_term_goals: string[];
  long_term_ambitions: string[];
  beliefs?: string[];
  secrets?: string[];
  skills?: Record<string, number>;
  active_scheme?: Scheme;
}

/**
 * A lightweight representation of an entity used during world generation.
 */
export interface EntityStub {
    entity_id: string;
    name: string;
    entity_type: 'individual' | 'group' | 'faction';
    position: string;
    brief_description: string;
}

/**
 * Describes the state of a geographical region.
 */
export interface RegionState {
    stability: string;
    controlling_faction: string | null;
    current_events: string[];
}


/**
 * Represents the overall state of the game world.
 */
export interface WorldState {
  year: number;
  week: number;
  economic_stability: string;
  political_climate: string;
  regions: Record<string, RegionState>;
  [key: string]: any;
}

export const EntityActionIntentEnum = [
    'appease_troops', 'suppress_revolt', 'negotiate', 'fortify', 'raid', 'assassinate',
    'tax_raise', 'pay_arrears', 'propaganda', 'march', 'siege', 'recruit', 'intrigue'
] as const;

export type EntityActionIntent = typeof EntityActionIntentEnum[number];

export const EventDeltaTypeEnum = ['resource', 'relation', 'region', 'status', 'rumor', 'scheme', 'add_region', 'remove_region', 'faction'] as const;
export type EventDeltaType = typeof EventDeltaTypeEnum[number];

export const ReportSourceEnum = ['scout', 'spy', 'merchant', 'messenger', 'rumor'] as const;
export type ReportSource = typeof ReportSourceEnum[number];

/**
 * An action chosen for an actor, as determined by the adjudication model.
 */
export interface EntityAction {
    id: string; // entity_id
    intent: EntityActionIntent;
    target?: string | null;
    notes: string;
}

/**
 * A single, atomic change to the game state.
 */
export interface EventDelta {
    type: EventDeltaType;
    key: string;
    delta: number;
    reason: string;
}

/**
 * An observation or piece of intelligence with a certain credibility.
 * Rumors from EventDeltas are converted into these.
 */
export interface Report {
    id: string;
    turn: number;
    source: ReportSource;
    about: string; // entity or region id
    claim: string;
    credibility: number; // 0.0 to 1.0
}

/**
 * The complete JSON output from the single-shot adjudication call.
 */
export interface Adjudication {
    turn: number;
    entityActions: EntityAction[];
    deltas: EventDelta[];
    headlines: string[];
    gm_private: string[];
    add_entities?: Entity[];
    remove_entities?: string[]; // Array of entity_ids to remove
}

/**
 * The result of an investigation action.
 */
export interface InvestigationResult {
    target_id: string;
    report: string;
    consequences: string | null;
}

/**
 * An entry for the Game Master's turn history log.
 */
export interface TurnHistoryEntry {
  turnNumber: number;
  playerIntent: string;
  adjudication: Adjudication;
  narration?: string; // Optional narrated text
  postTurnEntities: Entity[];
}

export interface SpotlightEntity {
  entity_id: string;
  reason: string;
}

export interface StoryRelevance {
  spotlight_entities: SpotlightEntity[];
  add_entity_suggestion?: { description: string; reason: string; };
  remove_entity_suggestion?: { entity_id: string; reason: string; };
  add_location_suggestion?: { name: string; description: string; reason: string; };
  remove_location_suggestion?: { name: string; reason: string; };
}

/**
 * A choice a player can make in response to an event.
 */
export interface PlayerEventChoice {
  text: string;
  description: string;
  deltas: EventDelta[];
}

/**
 * A dynamic event that can be triggered by game state conditions.
 */
export interface GameEvent {
  id: string;
  title: string;
  description: string;
  trigger: (worldState: WorldState, entities: Entity[], player: Entity | null) => boolean;
  options: PlayerEventChoice[];
}

/**
 * An entry for the player's log of triggered events and their choices.
 */
export interface EventHistoryEntry {
  eventId: string;
  eventTitle: string;
  choiceText: string;
  turnNumber: number;
}

/**
 * A meta-entity that tracks the high-level narrative state of the
 * simulation.
 */
export interface SimulationState {
  imperial_status: 'Stable' | 'Contested' | 'Vacant';
  senate_status: 'Ascendant' | 'Functional' | 'Deposed' | 'Irrelevant';
  military_status: 'Loyal' | 'Divided' | 'Rebellious';
  plebeian_mood: 'Content' | 'Uneasy' | 'Rioting';
  major_ongoing_crisis: string | null; // e.g., "Civil War" or "Succession Crisis"
}
