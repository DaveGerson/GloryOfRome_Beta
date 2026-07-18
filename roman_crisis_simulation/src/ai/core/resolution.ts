/**
 * ai/core/resolution.ts
 *
 * Deterministic, code-side outcome resolution - the seed of the Phase 3
 * "resolution layer" (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4: "a
 * deterministic resolution layer... the LLM narrates a pre-decided
 * result"). Mortality (DESIGN_DECISIONS.md D2/D3/D4) is deliberately built
 * as this module's FIRST consumer, not a one-off - when Phase 3 adds
 * skill/trait/relationship-weighted checks producing coarse outcome tiers,
 * they should extend this file (new tables + `resolve*` functions
 * alongside these) rather than fork a parallel mechanism.
 *
 * Every `resolve*` function below is a PURE function over an
 * already-rolled value, so every band is exhaustively unit-testable
 * without touching randomness. Only `rollD20` touches `Math.random`.
 *
 * Per DESIGN_DECISIONS.md D4, rolls are NEVER shown to the player - only
 * narration conveys the outcome (via the `defaultDirective`/model-authored
 * narrative directive, see ai/prompts/mortality.ts). Rolls ARE recorded
 * for the GM console (see MortalityEvent in types.ts).
 */

/**
 * Rolls a d20 (1-20 inclusive). Uses `Math.random()` directly - fine for
 * now, since mortality rolls don't need to be reproducible across runs.
 * Seeding (so a whole turn/campaign replays deterministically) is deferred
 * to when Phase 3 builds out the rest of the resolution layer; when that
 * lands, route this through a seeded generator instead of `Math.random` so
 * mortality rolls join the same deterministic story as every other roll
 * this module will eventually resolve.
 */
export function rollD20(): number {
    return Math.floor(Math.random() * 20) + 1;
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
