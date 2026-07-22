/**
 * ai/core/resolution.ts
 *
 * Deterministic, code-side outcome resolution - the mechanical spine of the
 * Phase 3 "resolution layer" (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4: "a
 * deterministic resolution layer... the LLM narrates a pre-decided
 * result"). Mortality (DESIGN_DECISIONS.md D2/D3/D4, `resolvePlayerDeathSave`/
 * `resolveNpcFate` below) was this module's FIRST consumer and its behavior
 * is UNCHANGED by everything added below - `resolveAction` and its modifier
 * helpers are a second, general-purpose consumer living alongside it, not a
 * replacement. Do not change `PLAYER_DEATH_SAVE_TABLE`/`NPC_FATE_TABLE` or
 * either `resolve*` mortality function's behavior when extending this file.
 *
 * `resolveAction` (ai/core/turn.ts's per-turn action resolution, and
 * ai/tools/intelligence.ts's investigation rolls) is the generalized
 * skill/trait/relationship-weighted check the mortality pipeline was always
 * meant to be a template for: a d20 roll plus modifiers compared against a
 * difficulty, producing one of five coarse outcome tiers. Coarse
 * deliberately - per ROADMAP_0_MASTER_PLAN.md Phase 3 item 4, tiers stay
 * broad so the model retains room to invent *how* an outcome plays out.
 *
 * Every `resolve*` function below is a PURE function over an
 * already-rolled value, so every band is exhaustively unit-testable
 * without touching randomness. Only `rollD20` (via its default source) and
 * `generateSeed` touch `Math.random`. The
 * modifier helpers (`derivePersonalityModifier`, `deriveOppositionModifier`,
 * `deriveInvestigationDifficulty`) are ALSO pure - they turn game state
 * (personality traits, a directional relationship, a target's profile)
 * into a plain number, deliberately kept separate from `resolveAction`
 * itself so each piece of the formula is independently testable.
 *
 * Per DESIGN_DECISIONS.md D4, rolls are NEVER shown to the player - only
 * narration conveys the outcome (via the `defaultDirective`/model-authored
 * narrative directive, see ai/prompts/mortality.ts, or the tier-guidance
 * text in ai/prompts/adjudication.ts / ai/prompts/intelligence.ts for the
 * action-resolution consumers). Rolls ARE recorded for the GM console (see
 * `MortalityEvent`/`ActionResolutionEvent` in types.ts).
 */

import { Entity, PersonalityTraits, Relationship } from '../../types';

// --- Seeded randomness ---------------------------------------------------

/**
 * A random source: returns a float in [0, 1), `Math.random`-compatible.
 * Roll-producing entry points accept one so a caller can supply a seeded
 * generator (`createSeededRng`) and make every draw it feeds replayable
 * from a single recorded seed.
 */
export type Rng = () => number;

/**
 * Creates a deterministic PRNG (mulberry32) over a 32-bit seed: the same
 * seed always yields the same sequence, on every platform, with no
 * dependencies. Statistical quality is ample for d20 rolls - the property
 * that matters is reproducibility: a recorded seed replays every draw made
 * from its generator, in order.
 */
export function createSeededRng(seed: number): Rng {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draws a fresh 32-bit unsigned seed for `createSeededRng`. `Math.random`
 * is an acceptable entropy source here: the seed's job is to be RECORDED
 * (so the draws made from its generator can be replayed), not to be
 * unpredictable.
 */
export function generateSeed(): number {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * Rolls a d20 (1-20 inclusive) from the given random source. Without an
 * `rng` it draws from `Math.random` - a non-reproducible roll. Pass a
 * `createSeededRng` generator to make the roll replayable: ai/core/turn.ts
 * threads one per-turn generator through every roll a turn makes (recording
 * its seed on the turn's history entry), and ai/tools/intelligence.ts gives
 * each investigation its own (recording it on the investigation's
 * resolution trace). Per DESIGN_DECISIONS.md D4, the roll - and any seed
 * behind it - is never shown to the player either way.
 */
export function rollD20(rng: Rng = Math.random): number {
    return Math.floor(rng() * 20) + 1;
}

function assertValidRoll(fnName: string, roll: number): void {
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
        throw new Error(`${fnName}: roll must be an integer 1-20, got ${roll}`);
    }
}

// --- Player death save (DESIGN_DECISIONS.md D2) -------------------------

/**
 * Upper bound (inclusive) of each player death-save band on a d20. Named
 * and exported so tuning the table is a one-line change instead of a
 * magic-number hunt through `resolvePlayerDeathSave`.
 *
 * Per D2: 1-5 dies, 6-10 survives with a real loss, 11-17 survives clean,
 * 18-20 survives with a boon.
 */
export const PLAYER_DEATH_SAVE_TABLE = {
    DIES_MAX: 5,
    SURVIVE_WITH_LOSS_MAX: 10,
    SURVIVE_MAX: 17,
    SURVIVE_WITH_BOON_MAX: 20,
} as const;

export type PlayerDeathSaveBand = 'dies' | 'survive_with_loss' | 'survive' | 'survive_with_boon';

export interface PlayerDeathSaveOutcome {
    roll: number;
    band: PlayerDeathSaveBand;
    /** True only for the 'dies' band - the run ends. */
    dies: boolean;
    /** True if a concrete loss delta (resource/relationship/exposed scheme) must be applied. */
    needsLoss: boolean;
    /** True if a concrete boon delta must be applied. */
    needsBoon: boolean;
    /**
     * True if this band's concrete content (deltas and/or narrative
     * steering) is rich enough to warrant the mortality OUTCOME model call
     * (ai/prompts/mortality.ts::buildMortalityOutcomePrompt). False bands
     * use `defaultDirective` and no extra deltas - see
     * ai/core/mortality.ts::processMortality.
     */
    needsOutcomeContent: boolean;
    /** Short GM-console label describing this band. */
    label: string;
    /** Narrative steering used verbatim when needsOutcomeContent is false (and as a defensive fallback otherwise). */
    defaultDirective: string;
}

/** Resolves an already-rolled d20 against the player death-save table (D2). */
export function resolvePlayerDeathSave(roll: number): PlayerDeathSaveOutcome {
    assertValidRoll('resolvePlayerDeathSave', roll);

    if (roll <= PLAYER_DEATH_SAVE_TABLE.DIES_MAX) {
        return {
            roll,
            band: 'dies',
            dies: true,
            needsLoss: false,
            needsBoon: false,
            needsOutcomeContent: false,
            label: 'Death save failed - the run ends.',
            defaultDirective: 'Narrate this death plainly and finally. There is no ambiguity and no last-minute rescue.',
        };
    }
    if (roll <= PLAYER_DEATH_SAVE_TABLE.SURVIVE_WITH_LOSS_MAX) {
        return {
            roll,
            band: 'survive_with_loss',
            dies: false,
            needsLoss: true,
            needsBoon: false,
            needsOutcomeContent: true,
            label: 'Survives, but suffers a real loss.',
            defaultDirective: 'Narrate a harrowing survival that costs them something concrete and lasting.',
        };
    }
    if (roll <= PLAYER_DEATH_SAVE_TABLE.SURVIVE_MAX) {
        return {
            roll,
            band: 'survive',
            dies: false,
            needsLoss: false,
            needsBoon: false,
            needsOutcomeContent: false,
            label: 'Survives - narration explains the escape.',
            defaultDirective: 'Narrate a tense but clean escape from death - no lasting cost, no windfall.',
        };
    }
    return {
        roll,
        band: 'survive_with_boon',
        dies: false,
        needsLoss: false,
        needsBoon: true,
        needsOutcomeContent: true,
        label: 'Survives and gains a boon.',
        defaultDirective: 'Narrate a survival so dramatic or fortunate that it turns to their clear advantage.',
    };
}

// --- NPC fate table (DESIGN_DECISIONS.md D3) ----------------------------

/**
 * Upper bound (inclusive) of each NPC fate-table band on a d20. A
 * deliberately different system from the player's death save (D3): 1-12
 * confirmed dead, 13-15 gravely wounded, 16-18 presumed dead (secretly
 * alive), 19-20 escapes openly.
 */
export const NPC_FATE_TABLE = {
    CONFIRMED_DEAD_MAX: 12,
    GRAVELY_WOUNDED_MAX: 15,
    PRESUMED_DEAD_MAX: 18,
    ESCAPES_OPENLY_MAX: 20,
} as const;

export type NpcFateBand = 'confirmed_dead' | 'gravely_wounded' | 'presumed_dead' | 'escapes_openly';

export interface NpcFateOutcome {
    roll: number;
    band: NpcFateBand;
    /** What the world/player believe happened - the authoritative value for the status delta's `new_status`. */
    publicStatus: 'dead' | 'alive';
    /**
     * True ONLY for 'presumed_dead': `publicStatus` is 'dead' (the world
     * believes it) but the entity is secretly alive in hiding and may
     * return as a nemesis. Drives `Entity.secret_truth` - see types.ts and
     * ai/core/mortality.ts.
     */
    secretlyAlive: boolean;
    /** True if a concrete loss delta (weakening) must be applied. */
    needsLoss: boolean;
    /** NPC fate table has no boon band (D3) - always false; kept for shape parity with PlayerDeathSaveOutcome. */
    needsBoon: boolean;
    /** True if this band's content warrants the mortality OUTCOME model call - see PlayerDeathSaveOutcome's field of the same name. */
    needsOutcomeContent: boolean;
    label: string;
    defaultDirective: string;
}

/** Resolves an already-rolled d20 against the NPC fate table (D3). */
export function resolveNpcFate(roll: number): NpcFateOutcome {
    assertValidRoll('resolveNpcFate', roll);

    if (roll <= NPC_FATE_TABLE.CONFIRMED_DEAD_MAX) {
        return {
            roll,
            band: 'confirmed_dead',
            publicStatus: 'dead',
            secretlyAlive: false,
            needsLoss: false,
            needsBoon: false,
            needsOutcomeContent: false,
            label: 'Confirmed dead.',
            defaultDirective: 'Narrate this death as confirmed and final.',
        };
    }
    if (roll <= NPC_FATE_TABLE.GRAVELY_WOUNDED_MAX) {
        return {
            roll,
            band: 'gravely_wounded',
            publicStatus: 'alive',
            secretlyAlive: false,
            needsLoss: true,
            needsBoon: false,
            needsOutcomeContent: true,
            label: 'Gravely wounded - survives publicly, weakened.',
            defaultDirective: 'Narrate a survival that leaves them visibly, publicly weakened.',
        };
    }
    if (roll <= NPC_FATE_TABLE.PRESUMED_DEAD_MAX) {
        return {
            roll,
            band: 'presumed_dead',
            publicStatus: 'dead',
            secretlyAlive: true,
            needsLoss: false,
            needsBoon: false,
            needsOutcomeContent: true,
            label: 'Presumed dead - the world believes it, but they are secretly alive in hiding.',
            defaultDirective: 'Narrate their apparent death as the world will believe it. Do NOT hint at survival.',
        };
    }
    return {
        roll,
        band: 'escapes_openly',
        publicStatus: 'alive',
        secretlyAlive: false,
        needsLoss: false,
        needsBoon: false,
        needsOutcomeContent: true,
        label: 'Escapes openly - survives visibly, the attempt is known.',
        defaultDirective: 'Narrate a visible, witnessed escape - everyone present now knows an attempt was made on their life.',
    };
}

// --- General action resolution (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) ---
//
// The general-purpose consumer `resolvePlayerDeathSave`/`resolveNpcFate`
// above were built to anticipate: roll a d20, add modifiers, compare to a
// difficulty, land in one of five coarse tiers. Two call sites feed this:
//  - ai/core/turn.ts: the player's assessed-consequential action each turn
//    (ai/tools/assessment.ts decides IF a roll happens at all).
//  - ai/tools/intelligence.ts: `getInvestigationResult`'s intrigue roll
//    (always rolled - no assessment call needed there, see
//    `deriveInvestigationDifficulty` below).

/** A skill this resolution layer knows how to weigh. Mirrors the coarse skill buckets the assessment call (ai/prompts/assessment.ts) is allowed to name. */
export type ResolvableSkill = 'oratory' | 'strategy' | 'intrigue';

/**
 * Difficulty is always expressed on this fixed 5 (trivial) - 25 (nearly
 * impossible) scale, whether it comes from the assessment call's own
 * judgment (ai/prompts/assessment.ts) or a derived helper below
 * (`deriveInvestigationDifficulty`). Named here so both producers tune
 * against the same documented range instead of inventing their own.
 */
export const ACTION_DIFFICULTY_RANGE = {
    MIN: 5,
    MAX: 25,
} as const;

function clampDifficulty(value: number): number {
    return Math.min(ACTION_DIFFICULTY_RANGE.MAX, Math.max(ACTION_DIFFICULTY_RANGE.MIN, value));
}

/**
 * The five coarse outcome tiers a resolved action lands in. Deliberately
 * coarse (not a numeric success percentage) so the adjudicator retains room
 * to invent *how* the tier manifests - see ROADMAP_0_MASTER_PLAN.md Phase 3
 * item 4's "tiers stay coarse" instruction. Consumed by
 * ai/prompts/adjudication.ts's PLAYER ACTION OUTCOME block and
 * ai/prompts/intelligence.ts's investigation tier guidance.
 */
export type ActionResolutionTier =
    | 'critical_failure'
    | 'failure'
    | 'partial_success'
    | 'success'
    | 'critical_success';

/**
 * Margin (see `resolveAction`) thresholds mapping to each tier, named and
 * exported so tuning the table is a one-line change. A tier is chosen by the
 * FIRST band (in this order) whose comparison holds:
 *  - margin <= CRITICAL_FAILURE_MAX           -> 'critical_failure'
 *  - margin <  FAILURE_MAX                    -> 'failure'
 *  - margin <  PARTIAL_SUCCESS_MAX             -> 'partial_success'
 *  - margin <  SUCCESS_MAX                     -> 'success'
 *  - otherwise (margin >= SUCCESS_MAX)         -> 'critical_success'
 */
export const ACTION_RESOLUTION_TIER_THRESHOLDS = {
    /** margin <= this value is a critical failure. */
    CRITICAL_FAILURE_MAX: -10,
    /** margin < this value (and > CRITICAL_FAILURE_MAX) is a plain failure. */
    FAILURE_MAX: 0,
    /** margin < this value (and >= FAILURE_MAX) is a partial success. */
    PARTIAL_SUCCESS_MAX: 5,
    /** margin < this value (and >= PARTIAL_SUCCESS_MAX) is a plain success; margin >= this value is a critical success. */
    SUCCESS_MAX: 10,
} as const;

function tierForMargin(margin: number): ActionResolutionTier {
    if (margin <= ACTION_RESOLUTION_TIER_THRESHOLDS.CRITICAL_FAILURE_MAX) return 'critical_failure';
    if (margin < ACTION_RESOLUTION_TIER_THRESHOLDS.FAILURE_MAX) return 'failure';
    if (margin < ACTION_RESOLUTION_TIER_THRESHOLDS.PARTIAL_SUCCESS_MAX) return 'partial_success';
    if (margin < ACTION_RESOLUTION_TIER_THRESHOLDS.SUCCESS_MAX) return 'success';
    return 'critical_success';
}

export interface ResolveActionInput {
    /** Already-rolled d20 (1-20 inclusive) - injected for testability; production callers use `rollD20()`. Per D4, never shown to the player. */
    roll: number;
    /** The actor's relevant skill value (0-10), or null if no skill applies/is known - treated as 0 contribution. */
    relevantSkillValue: number | null;
    /** Pre-derived via `derivePersonalityModifier` - kept as a separate pure input rather than computed inside this function. */
    personalityModifier: number;
    /** Pre-derived via `deriveOppositionModifier` - kept as a separate pure input rather than computed inside this function. */
    oppositionModifier: number;
    /** Target difficulty, `ACTION_DIFFICULTY_RANGE.MIN`-`ACTION_DIFFICULTY_RANGE.MAX` (5-25). */
    difficulty: number;
}

export interface ActionResolution {
    /** Echoes the input roll - never shown to the player (D4). */
    roll: number;
    /** roll + relevantSkillValue (0 if null) + personalityModifier + oppositionModifier. */
    total: number;
    /** total - difficulty. The value the tier bands (`ACTION_RESOLUTION_TIER_THRESHOLDS`) are drawn from. */
    margin: number;
    tier: ActionResolutionTier;
}

/**
 * Resolves an already-rolled d20 plus modifiers against a difficulty into
 * one of five coarse tiers. Pure - deterministic given its inputs, so every
 * margin band is unit-testable without touching `Math.random`. See
 * `rollD20` for the production roll, and `derivePersonalityModifier`/
 * `deriveOppositionModifier` for how the two modifier inputs are usually
 * produced.
 */
export function resolveAction(input: ResolveActionInput): ActionResolution {
    const { roll, relevantSkillValue, personalityModifier, oppositionModifier, difficulty } = input;
    assertValidRoll('resolveAction', roll);

    const total = roll + (relevantSkillValue ?? 0) + personalityModifier + oppositionModifier;
    const margin = total - difficulty;

    return { roll, total, margin, tier: tierForMargin(margin) };
}

// --- Modifier helpers (pure) --------------------------------------------

/** A trait value at this point on the 1-10 `PersonalityTraits` scale (types.ts) contributes zero modifier - i.e. "average" for this trait. */
const TRAIT_MODIFIER_CENTER = 5;
/** Divisor turning a trait's distance from `TRAIT_MODIFIER_CENTER` into a roll-total modifier of roughly -2 to +2.5 across the 1-10 range. */
const TRAIT_MODIFIER_DIVISOR = 2;
/** Separate divisor for the honor-vs-treachery penalty term, so it can be tuned independently of the skill-driven trait bonus above. */
const TREACHERY_HONOR_DIVISOR = 2;

/** Free-text `action_category` substrings (ai/prompts/assessment.ts) that mark an action as treachery/betrayal for `derivePersonalityModifier`'s honor penalty. */
const TREACHERY_KEYWORDS = ['treachery', 'betray', 'backstab', 'double-cross', 'double cross'];

function isTreacherousActionCategory(actionCategory: string): boolean {
    const lower = actionCategory.toLowerCase();
    return TREACHERY_KEYWORDS.some(keyword => lower.includes(keyword));
}

export interface PersonalityModifierInput {
    /** The ACTOR's own personality traits - undefined entities (e.g. a faction/group with no `personality`) contribute a zero modifier. */
    personality?: PersonalityTraits;
    /** The action's relevant skill (from the assessment call, or fixed - e.g. 'intrigue' for investigations), or null. */
    relevantSkill: ResolvableSkill | null;
    /** The assessment call's free-text `action_category` (or an equivalent fixed label for non-assessed call sites like investigations) - scanned for treachery/betrayal keywords to apply the honor penalty below. */
    actionCategory: string;
}

/**
 * Turns the ACTOR's personality traits into a roll-total modifier, relevant
 * to the action being attempted:
 *  - 'intrigue' or 'strategy' actions are fueled by cunning - a schemer's
 *    guile helps regardless of whether the scheme is martial or covert.
 *  - 'oratory' actions are fueled by ambition - the drive behind bold,
 *    persuasive rhetoric.
 *  - ANY action whose `actionCategory` reads as treachery/betrayal
 *    (see `TREACHERY_KEYWORDS`) applies an HONOR PENALTY: a high-honor
 *    character is WORSE at treachery (it cuts against their nature), a
 *    low-honor character suffers little or even gains from the same act.
 * Returns 0 for an entity with no `personality` (e.g. a faction/group).
 */
export function derivePersonalityModifier(input: PersonalityModifierInput): number {
    const { personality, relevantSkill, actionCategory } = input;
    if (!personality) return 0;

    let modifier = 0;

    if (relevantSkill === 'intrigue' || relevantSkill === 'strategy') {
        modifier += (personality.cunning - TRAIT_MODIFIER_CENTER) / TRAIT_MODIFIER_DIVISOR;
    }
    if (relevantSkill === 'oratory') {
        modifier += (personality.ambition - TRAIT_MODIFIER_CENTER) / TRAIT_MODIFIER_DIVISOR;
    }
    if (isTreacherousActionCategory(actionCategory)) {
        modifier -= (personality.honor - TRAIT_MODIFIER_CENTER) / TREACHERY_HONOR_DIVISOR;
    }

    return modifier;
}

/** Divisor turning a 0-10 `perceived_threat` into a roll-total penalty of 0 to -5: the more threatening the opposing entity finds the actor, the more on guard they are, the harder the actor's action. */
const PERCEIVED_THREAT_GUARD_DIVISOR = 2;
/** Divisor turning a -10..10 `trust_level` into a roll-total modifier of -2.5 to +2.5: the opposing entity's trust toward the actor makes the actor's action easier or harder. */
const TRUST_LEVEL_DIVISOR = 4;

export interface OppositionModifierInput {
    /**
     * The OPPOSING entity's own relationship record describing ITS
     * perception of the actor - i.e. `opposingEntity.relationships[actorId]`,
     * per this codebase's directional relationship convention (see
     * ai/prompts/adjudication.ts's RELATIONSHIP DELTAS rule: a relationship
     * keyed under entity A describes A's perception of the other entity
     * ONLY). Undefined/null (no relationship on record, or no opposing
     * entity at all) is treated as neutral - zero modifier.
     */
    relationshipTowardActor?: Relationship | null;
}

/**
 * Turns the OPPOSING entity's directional stats toward the actor into a
 * roll-total modifier:
 *  - Higher `perceived_threat` (0-10) means the opposing entity is more on
 *    guard against the actor specifically, making the actor's action HARDER
 *    (a negative contribution).
 *  - Higher `trust_level` (-10 to 10) toward the actor makes the actor's
 *    action EASIER (a positive contribution); distrust makes it harder.
 * Returns 0 when there is no opposing entity or no relationship on record
 * (treated as neutral, not hostile).
 */
export function deriveOppositionModifier(input: OppositionModifierInput): number {
    const rel = input.relationshipTowardActor;
    if (!rel) return 0;

    const perceivedThreat = rel.perceived_threat ?? 0;
    const trust = rel.trust_level ?? 0;

    const guardPenalty = -(perceivedThreat / PERCEIVED_THREAT_GUARD_DIVISOR);
    const trustBonus = trust / TRUST_LEVEL_DIVISOR;

    return guardPenalty + trustBonus;
}

// --- Investigation difficulty (ai/tools/intelligence.ts) -----------------

/** Baseline difficulty for an investigation with an average (5/10) target - see `deriveInvestigationDifficulty`. */
const INVESTIGATION_BASE_DIFFICULTY = 12;

/**
 * Derives an investigation's difficulty from the TARGET's own paranoia and
 * intrigue skill (both nudge the difficulty up - a more paranoid, more
 * cunning-at-hiding-things target is harder to investigate), clamped to
 * `ACTION_DIFFICULTY_RANGE`. Replaces the old prose "40% chance of a
 * negative consequence" line that lived inside
 * ai/prompts/intelligence.ts::buildInvestigationPrompt and was never
 * actually load-bearing (ai/tools/intelligence.ts::getInvestigationResult
 * never passed a real risk signal into the prompt).
 */
export function deriveInvestigationDifficulty(target: Entity): number {
    const paranoia = target.personality?.paranoia ?? TRAIT_MODIFIER_CENTER;
    const intrigueSkill = target.skills?.intrigue ?? TRAIT_MODIFIER_CENTER;
    const raw = INVESTIGATION_BASE_DIFFICULTY + (paranoia - TRAIT_MODIFIER_CENTER) + (intrigueSkill - TRAIT_MODIFIER_CENTER);
    return clampDifficulty(raw);
}
