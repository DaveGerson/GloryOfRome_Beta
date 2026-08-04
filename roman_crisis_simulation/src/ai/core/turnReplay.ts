/**
 * Strike the mould again: re-draw a recorded turn's dice from its recorded
 * seed and compare, draw for draw, against what the entry says was rolled.
 *
 * This is a PURE function of the history entry. It does NOT re-run the turn,
 * issue any model call, or touch the mortality pipeline - it re-creates the
 * turn's generator (`createSeededRng(entry.turnSeed)`) and pulls the same
 * number of `rollD20` draws in the same documented order. The Fixtures pane's
 * plaque has always CLAIMED the seed "replays this turn's rolls in draw
 * order"; this proves the claim instead of asserting it.
 *
 * DRAW ORDER (the same order `ai/core/turn.ts` draws in, and the same order
 * `FixturesView` lists):
 *   1. the player action's resolution roll, when the turn recorded a
 *      `resolutionTrace` (a non-consequential action makes no roll at all);
 *   2. each `mortalityTrace` event that carries a numeric `roll`, in array
 *      order. An INVALIDATED claim never reaches the dice, so it consumes no
 *      draw - skipping it is what keeps every later draw aligned.
 *
 * Per DESIGN_DECISIONS.md D4, rolls are GM-console-only ground truth and
 * NEVER reach a player-facing surface. Everything this module returns is a
 * roll or a statement about one, so its only sanctioned consumer is the GM
 * console.
 */

import { TurnHistoryEntry } from '../../types';
import { createSeededRng, rollD20 } from './resolution';

/** One draw, as recorded and as re-drawn from the seed. */
export interface ReplayedDraw {
    /** The same label the Fixtures pane lists the recorded draw under. */
    label: string;
    /** What the entry says was rolled. */
    recorded: number;
    /** What the seed produces at this position now. */
    redrawn: number;
    matches: boolean;
}

export interface TurnReplayResult {
    /**
     * False when the entry carries no `turnSeed` - a turn persisted before
     * the field existed, or a mock-mode turn. Nothing was re-drawn and
     * `draws` is empty; that is not a mismatch, it is an unanswerable
     * question.
     */
    verifiable: boolean;
    draws: ReplayedDraw[];
    /**
     * True when every re-drawn value equals its recorded one - vacuously true
     * for a verifiable turn that drew no dice. Always FALSE when
     * `verifiable` is false: nothing was checked, so nothing may be claimed
     * to hold.
     */
    allMatch: boolean;
}

export function replayTurnDraws(entry: TurnHistoryEntry): TurnReplayResult {
    if (entry.turnSeed === undefined) {
        return { verifiable: false, draws: [], allMatch: false };
    }

    const rng = createSeededRng(entry.turnSeed);
    const draws: ReplayedDraw[] = [];

    if (entry.resolutionTrace) {
        draws.push(makeDraw(
            `Action · ${entry.resolutionTrace.assessment.action_category}`,
            entry.resolutionTrace.roll,
            rollD20(rng),
        ));
    }
    for (const event of entry.mortalityTrace ?? []) {
        if (typeof event.roll !== 'number') continue;
        draws.push(makeDraw(`Mortality · ${event.entity_name}`, event.roll, rollD20(rng)));
    }

    return { verifiable: true, draws, allMatch: draws.every(draw => draw.matches) };
}

function makeDraw(label: string, recorded: number, redrawn: number): ReplayedDraw {
    return { label, recorded, redrawn, matches: recorded === redrawn };
}
