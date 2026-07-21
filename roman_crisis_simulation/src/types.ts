
// Enums
export enum GameState {
  SETUP,
  AWAITING_PLAYER_INPUT,
  PROCESSING,
  AWAITING_EVENT_CHOICE,
  /**
   * The run has ended (D1: survival-only — ONLY player death ends a run;
   * exile/missing are survivable and keep the game playable). Terminal:
   * input locked, EpilogueScreen shown.
   */
  GAME_OVER,
}

/**
 * Represents a single message in the chat interface.
 */
export interface Message {
    /**
     * 'ribbon' is a decorative week-advance divider written into the stream
     * when a turn commits (rendered as a TurnRibbon, not a speech bubble).
     * Additive and optional in practice - old saves without ribbons load
     * unchanged (save-compat per PR #3 invariant 6).
     */
    sender: 'player' | 'gm' | 'player_monologue' | 'ribbon';
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
  /**
   * GM-PRIVATE. Set by the mortality pipeline (ai/core/mortality.ts) when
   * this entity's PUBLIC `status` is 'dead' but the NPC fate table
   * (DESIGN_DECISIONS.md D3) rolled "presumed dead": the world and the
   * player believe they are dead, but they are secretly alive in hiding and
   * may be dramatically reintroduced later (a 'status' delta with
   * new_status:'alive') as a nemesis. This MUST NEVER reach any
   * player-facing surface - not narration, not entity briefs shown to the
   * player, not suggested actions. Only the GM console and the
   * adjudicator's GM-secret prompt fragment
   * (ai/prompts/fragments.ts::buildSecretSurvivorsBlock) may read it. See
   * the sanitization in ai/prompts/narration.ts for the enforcement point.
   */
  secret_truth?: {
    actually_alive: true;
    hidden_since_turn: number;
    motive: string;
  };
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

/**
 * 'world' (D6/Phase 2): changes a top-level WorldState macro field —
 * key is 'economic_stability' or 'political_climate', reason is the new
 * string value. Previously no delta type could touch these, so the Header
 * meters could never change.
 */
export const EventDeltaTypeEnum = ['resource', 'relation', 'region', 'status', 'rumor', 'scheme', 'add_region', 'remove_region', 'faction', 'world'] as const;
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
    /**
     * Narrative/display text only - what happened, in prose, for the report
     * log. NOT parsed for control flow. For 'status' deltas, the actual
     * life/freedom state change and movement are carried by the structured
     * `new_status`/`new_location` fields below; `reason` must not be relied
     * upon to determine engine behavior.
     */
    reason: string;
    /**
     * 'status' deltas only: the entity's new life/freedom status. The model
     * MUST set this whenever an entity's status changes (dies, is exiled,
     * goes missing, or returns to alive) - this is the authoritative signal
     * the engine acts on, not `reason`'s prose.
     */
    new_status?: 'alive' | 'dead' | 'exiled' | 'missing';
    /**
     * 'status' deltas only: the entity's new location (a region name), when
     * the status delta represents the entity moving. Optional - only set
     * when movement occurs.
     */
    new_location?: string;
    /**
     * 'status' deltas only, CODE-GENERATED ONLY - never requested from the
     * model, never part of any Gemini responseSchema/zod input schema.
     * Attached exclusively by ai/core/mortality.ts::processMortality when a
     * validated NPC death resolves to "presumed dead" on the fate table
     * (DESIGN_DECISIONS.md D3); ai/core/engine.ts's 'status' case copies it
     * onto the entity as `Entity.secret_truth` when the delta is applied.
     * See the leak-prevention notes on `Entity.secret_truth` above.
     */
    secret_truth?: Entity['secret_truth'];
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
 * A record of a single raw call made to the Gemini API through
 * ai/core/geminiService.ts. Captured so every prompt/response pair is
 * inspectable after the fact (debugging, replay, eval) instead of being
 * lost the moment a turn completes. One record is pushed per model
 * round-trip - including a schema-repair retry, which shows up as its own
 * entry with the same `callName`.
 */
export interface RawCallRecord {
  callName: string;
  model: string;
  latencyMs: number;
  attempts: number; // number of network attempts (retries) this round-trip took
  promptChars: number;
  rawResponse: string; // capped at ~20k chars, see geminiService.ts
  validated: boolean; // true if JSON parsing (and zod validation, if requested) succeeded
  /**
   * The full prompt text as sent (capped at MAX_CAPTURED_PROMPT_CHARS, see
   * geminiService.ts). Session-side capture for the GM console and
   * eval/tuning export only - never rendered on a player-facing surface
   * (D4/D5), and never written into the persisted save blob (saves stay
   * lean per DESIGN_DECISIONS.md D18; persistence/saveGame.ts strips it on
   * serialize). Optional: records loaded from older saves lack it.
   */
  promptText?: string;
  /** The call's system instruction, if any - same caps, visibility, and persistence rules as `promptText`. */
  systemInstruction?: string;
}

/**
 * One entity's trip through the mortality pipeline this turn
 * (DESIGN_DECISIONS.md D2/D3/D4) - produced by
 * ai/core/mortality.ts::processMortality and appended to the turn's
 * history entry so the GM console can inspect/tune rolls. Per D4, rolls
 * are NEVER shown to the player - this trace is GM-console-only ground
 * truth, same as `Adjudication.gm_private`.
 */
export interface MortalityEvent {
  entity_id: string;
  entity_name: string;
  /** The original claimed cause of death (the death delta's `reason`, captured before mortality rewrote it). */
  claim: string;
  /** Whether the second, independent validation call dispositioned this claim as real (vs. hallucination/overreach). */
  valid: boolean;
  /** The hidden d20 roll, present only when `valid` (an invalidated claim never reaches the dice). Never shown to the player. */
  roll?: number;
  /** The resolved table band (e.g. 'dies', 'survive_with_loss', 'presumed_dead') - see ai/core/resolution.ts. */
  band?: string;
  /** One-line GM-facing summary of what actually happened / the narration directive used. */
  outcomeSummary: string;
}

/**
 * One turn's trip through the `ai/core/resolution.ts` "resolution layer"
 * action-resolution pipeline (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) -
 * produced by `ai/core/turn.ts` when the assessment call
 * (`ai/tools/assessment.ts::getActionAssessment`) flags the player's action
 * as consequential, and appended to the turn's history entry so the GM
 * console can inspect/tune rolls. Per DESIGN_DECISIONS.md D4, rolls are
 * NEVER shown to the player - this trace is GM-console-only ground truth,
 * same as `MortalityEvent`/`Adjudication.gm_private`. Entirely absent on
 * turns where the assessment call found the action non-consequential (no
 * roll is made, no trace is recorded).
 *
 * `assessment`'s shape mirrors `ai/tools/assessment.ts`'s `ActionAssessment`
 * - kept as an inline duplicate here (rather than an import) so types.ts
 * stays import-free, the same convention `MortalityEvent` below follows for
 * the mortality pipeline's own result shapes. Keep the two in sync if
 * either changes.
 */
export interface ActionResolutionEvent {
  assessment: {
    is_consequential: boolean;
    action_category: string;
    relevant_skill: 'oratory' | 'strategy' | 'intrigue' | null;
    difficulty: number;
    opposing_entity_id: string | null;
    rationale: string;
  };
  /** The hidden d20 roll (`ai/core/resolution.ts::rollD20`) - never shown to the player (D4). */
  roll: number;
  /** roll + relevant skill value + personality modifier + opposition modifier. */
  total: number;
  /** total - difficulty; the value the tier bands (`ai/core/resolution.ts::ACTION_RESOLUTION_TIER_THRESHOLDS`) are drawn from. */
  margin: number;
  /** The resolved outcome tier - see `ai/core/resolution.ts::resolveAction`. */
  tier: 'critical_failure' | 'failure' | 'partial_success' | 'success' | 'critical_success';
  /**
   * The 32-bit seed of the dedicated seeded generator
   * (`ai/core/resolution.ts::createSeededRng`) whose first draw produced
   * `roll` - present only for resolutions that run OUTSIDE a turn and so
   * carry their own seed (player-triggered investigations,
   * `ai/tools/intelligence.ts::getInvestigationResult`). A turn's own
   * action roll instead draws from the per-turn generator whose seed is the
   * history entry's `turnSeed`. An investigation's trace is returned to the
   * caller but not yet persisted or surfaced anywhere - its intended home
   * is the Phase 4B dossier store (roadmaps/ROADMAP_PHASE_4.md). Per D4 it
   * must never reach a player-facing surface either way.
   */
  seed?: number;
}

/**
 * An entry for the Game Master's turn history log.
 */
export interface TurnHistoryEntry {
  turnNumber: number;
  playerIntent: string;
  adjudication: Adjudication;
  narration?: string; // Optional narrated text
  /**
   * Deep copy of the full entity roster as of this turn's commit - the
   * dominant per-turn share of the save blob. Present only on the most
   * recent KEEP_FULL_SNAPSHOTS entries (state/gameReducer.ts): each turn
   * commit drops it from entries older than that window. Saves written
   * while the field was required carry it on every entry, so both shapes
   * load; every consumer must tolerate its absence on older entries.
   */
  postTurnEntities?: Entity[];
  rawCalls?: RawCallRecord[]; // Raw prompt/response capture for every AI call made this turn
  mortalityTrace?: MortalityEvent[]; // Every death claim this turn went through processMortality, see MortalityEvent
  resolutionTrace?: ActionResolutionEvent; // The player action's trip through the resolution layer this turn (if consequential), see ActionResolutionEvent
  /**
   * The 32-bit seed of this turn's roll generator
   * (`ai/core/resolution.ts::createSeededRng`). Every hidden roll the turn
   * made draws from that one generator in a fixed order - the player
   * action's resolution roll first (when consequential), then each
   * mortality roll in claim order - so the recorded seed replays the
   * turn's dice exactly. Optional: entries persisted before this field
   * existed (and mock-mode turns) simply lack it. Per DESIGN_DECISIONS.md
   * D4 it is GM-console-only, never rendered on any player-facing surface.
   */
  turnSeed?: number;
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
