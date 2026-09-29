import type { Entity } from '../../types';

// The 'status' delta's legacy reason-parse, in one place. applyDeltas
// (ai/core/engine.ts) applies it, and perception/visibility.ts mirrors it to
// say what a delta did - a module of its own because the engine already
// imports the perception layer, so the perception layer cannot import the
// engine.

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
 * The status applyDeltas' legacy branch sets from a 'status' delta's free-text
 * `reason` when the delta carries no valid structured `new_status`: dead,
 * else exiled, else missing, checked in that order - or undefined when the
 * reason sets none (it may still name a move, which the engine handles
 * separately).
 */
export function legacyStatusFromReason(reason: string): Entity['status'] | undefined {
    if (legacyReasonIndicatesDeath(reason)) return 'dead';
    const text = reason.toLowerCase();
    if (text.includes('exiled')) return 'exiled';
    if (text.includes('missing')) return 'missing';
    return undefined;
}
