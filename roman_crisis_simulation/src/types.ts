
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
  /**
   * NARRATIVE FLAVOR (ROADMAP_PHASE_4.md 4C item 5, D10): a compact
   * speech-style directive for how this character talks and thinks (e.g.
   * "clipped soldier's Latin, contempt for senatorial flourish"). For a
   * collective entity (faction, guard, mob) a group voice is fine. NOT
   * GM-private - it is texture, not secret state - but by design it feeds
   * only the character's OWN mind prompt (ai/prompts/npcMind.ts) and the
   * narration prompt's bounded voice-cast block (ai/prompts/narration.ts);
   * it stays OUT of the omniscient adjudicator briefs
   * (ai/prompts/fragments.ts::getEntityBrief) to save context. OPTIONAL for
   * save compatibility: legacy entities/saves without it must load and flow
   * through every prompt builder emitting nothing (never "undefined").
   */
  voice?: string;
  /**
   * NARRATIVE FLAVOR (4C.5): a short public byname (e.g. "the Thracian").
   * Public texture - how the street speaks of them - so unlike `voice` it
   * MAY ride wherever the name does, including the adjudicator briefs
   * (fragments.ts::getEntityBrief carries the epithet only, one token of
   * flavor). OPTIONAL for save compatibility, same rule as `voice`.
   */
  epithet?: string;
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
    /**
     * 'rumor' deltas only, GM-PRIVATE (DESIGN_DECISIONS.md D11 - same
     * handling class as `secret_truth`): whether the rumor's claim is
     * actually true in the simulation's reality. The adjudicator is
     * required by its prompt to rule true or false on EVERY rumor delta -
     * there is no "unknown" class; the GM defines reality. Optional in the
     * type only as a defensive matter: when the model omits it despite the
     * prompt, ai/core/engine.ts records the ledger entry with
     * `isTrue: true` and `assumed: true` rather than silently inventing a
     * lie. This field must NEVER reach a player-facing surface - it is
     * stripped before the narration prompt (ai/prompts/narration.ts) and
     * may render only in GameMasterScreen.
     */
    is_true?: boolean;
    /**
     * 'rumor' deltas only, GM-PRIVATE (same handling class as
     * `secret_truth`/`is_true` above): the entity_id of whoever originated
     * or is spreading the rumor. Omitted/empty when the rumor is organic
     * (no single attributable source). Renders only in GameMasterScreen.
     */
    origin_id?: string;
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
 * GM-PRIVATE truth-ledger record (DESIGN_DECISIONS.md D11): the engine's
 * own bookkeeping of what every sourced claim's actual truth is, so a
 * falsehood is only ever presented knowingly and trackably. One entry is
 * written per rumor delta by ai/core/engine.ts, alongside the Report the
 * player sees (`reportId` links the two). This is the same handling class
 * as `Entity.secret_truth`: it may be read ONLY by GameMasterScreen (the
 * true-vs-believed view, D7) and code under ai/ - never by any
 * player-facing surface.
 */
export interface TruthLedgerEntry {
    id: string;
    turn: number;
    claim: string;
    /** The entity or region id the claim is about (the rumor delta's key). */
    aboutId: string;
    /** Who originated/spreads the claim; absent when organic/unattributable. */
    originId?: string;
    /** The claim's ACTUAL truth in the simulation's reality (D11: always ruled, never unknown). */
    isTrue: boolean;
    /** The id of the Report the player saw for this claim. */
    reportId: string;
    /**
     * Set when the adjudicator omitted the truth disposition despite the
     * prompt demanding one - `isTrue` then defaults to true (the engine
     * never invents a lie on its own) and this flag lets the GM console
     * surface the failure for tuning.
     */
    assumed?: boolean;
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
  /**
   * Entity ids selected as this turn's perceiving NPCs (bounded by
   * MAX_PERCEIVING_NPCS - perception/npcPerception.ts), the viewers whose
   * perception-grounded memories were stamped at commit. The per-NPC
   * digests themselves are NEVER persisted (save-size bounding): the GM
   * console re-derives them from this id list plus the entry's deltas and
   * entity snapshot. Optional: entries persisted before the field existed
   * lack it, and entries older than the snapshot window drop it alongside
   * `postTurnEntities` (state/gameReducer.ts) - the derivation needs the
   * snapshot, so the ids alone would be dead save weight. Per
   * DESIGN_DECISIONS.md D4/D5 this is GM-side simulation data - rendered
   * only in the GM console, never player-facing.
   */
  perceivingNpcIds?: string[];
  /**
   * The Director's per-spotlight persistent intents for this turn (4C.3),
   * as committed - the same bounded list fed into this turn's adjudicator
   * and persisted on the reducer's `npcIntents` slice for the NEXT turn's
   * Director input. Optional: entries persisted before the field existed
   * (and turns where the Director named no spotlight intents) simply lack
   * it. GM-PRIVATE (D4/D5) like the rest of an entry's simulation data -
   * rendered only in the GM console, never player-facing.
   */
  npcIntents?: NpcIntent[];
  /**
   * The per-spotlight mind decisions this turn (ROADMAP_PHASE_4.md 4C item
   * 4) - at most MAX_MINDS_PER_TURN entries (ai/prompts/npcMind.ts), as fed
   * to the adjudicator (minus `private_reasoning`, which only the GM console
   * ever renders). Optional: entries persisted before minds existed (and
   * turns with no mind-eligible spotlight) simply lack it, and entries older
   * than the snapshot window drop it alongside `postTurnEntities`/
   * `perceivingNpcIds` (state/gameReducer.ts) so the save stays bounded.
   * GM-PRIVATE (D4/D5): rendered only in the GM console, never
   * player-facing.
   */
  npcMindResults?: NpcMindDecision[];
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

/**
 * The Director's continuity ruling on a spotlight intent (ROADMAP_PHASE_4.md
 * 4C item 3): 'continue' carries the character's previous intent forward,
 * 'pivot' redirects it because events made it obsolete or opened something
 * better, 'new' means the character had no previous intent on record.
 */
export const NpcIntentContinuityEnum = ['continue', 'pivot', 'new'] as const;
export type NpcIntentContinuity = typeof NpcIntentContinuityEnum[number];

/**
 * One spotlight NPC's persistent intent, emitted by the Director
 * (storyRelevance call) each turn and persisted at turn commit so the NEXT
 * turn's Director judges continuity against it - the 4C.3 continuity loop.
 * GM-PRIVATE per DESIGN_DECISIONS.md D4/D5: intents are simulation
 * direction, never player knowledge - they may render only in
 * GameMasterScreen and feed only prompts under ai/.
 */
export interface NpcIntent {
  entity_id: string;
  /** ONE LINE: what this character is trying to accomplish next. */
  intent: string;
  continuity: NpcIntentContinuity;
}

/**
 * One spotlight NPC's mind decision (ROADMAP_PHASE_4.md 4C item 4, D10/D22):
 * the structured output of that character's own per-turn mind call
 * (ai/prompts/npcMind.ts / ai/tools/npcMind.ts), decided from the
 * character's BOUNDED knowledge only. GM-PRIVATE per DESIGN_DECISIONS.md
 * D4/D5, same handling class as `gm_private`/`NpcIntent`: mind decisions -
 * and especially `private_reasoning` - may render only in GameMasterScreen
 * and feed only prompts under ai/, never any player-facing surface. The
 * adjudication prompt receives entity_id/chosen_action/method ONLY - never
 * `private_reasoning` (ai/prompts/fragments.ts::buildNpcMindDecisionsBlock).
 */
export interface NpcMindDecision {
  entity_id: string;
  /** ONE concrete act the character takes this turn, in prose. */
  chosen_action: string;
  /** HOW the character goes about it - brief. */
  method: string;
  /** The character's true, first-person thinking behind the move. GM-private even among GM data: never fed back into the adjudicator. */
  private_reasoning: string;
  /** Optional: how the character's active scheme shifts in their own mind this turn. Absent/null when the scheme stands unchanged. */
  scheme_adjustment?: string | null;
}

export interface StoryRelevance {
  spotlight_entities: SpotlightEntity[];
  /** Per-spotlight persistent intents (4C.3) - see NpcIntent above. */
  spotlight_intents: NpcIntent[];
  add_entity_suggestion?: { description: string; reason: string; };
  remove_entity_suggestion?: { entity_id: string; reason: string; };
  add_location_suggestion?: { name: string; description: string; reason: string; };
  remove_location_suggestion?: { name: string; reason: string; };
}

/**
 * The pacing-posture preference (ROADMAP_PHASE_4.md 4D item 1, D23): how
 * eagerly the adjudicator's PACING JUDGMENT principle steps in when the
 * story slackens. 'restrained' intervenes rarely and lets long quiets
 * stand; 'balanced' is the default contract as written; 'dramatic'
 * tolerates fewer slack turns and tightens sooner. A device-level USER
 * PREFERENCE persisted in localStorage (persistence/settings.ts), NEVER
 * part of the save bundle. D23 bound: this enum tunes ONE line of prompt
 * wording (ai/prompts/adjudication.ts) and nothing else - no code-side
 * tension scalar, accumulator, or threshold machinery exists anywhere;
 * pacing itself is the adjudicator's own intentional judgment.
 */
export const PacingPostureEnum = ['restrained', 'balanced', 'dramatic'] as const;
export type PacingPosture = typeof PacingPostureEnum[number];

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
