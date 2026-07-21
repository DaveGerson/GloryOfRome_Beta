/**
 * components/investigationLoop.ts
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "close the investigation loop."
 *
 * `getInvestigationResult` (ai/tools/intelligence.ts) already returns a
 * `consequences: string | null` field describing the fallout of a risky
 * intelligence-gathering action (e.g. an agent getting spotted). Before this
 * module existed, App.tsx stashed these in `turnInvestigations` and threw
 * them away unread every turn (see App.tsx's old `setTurnInvestigations([])`
 * on turn commit) - the "wired and never consumed" dead code the roadmap
 * calls out.
 *
 * Pure, React-free queue management for that fallout, so it's unit-testable
 * without a DOM/React harness (this repo has no react-testing-library):
 *  - `appendFallout` - queue a newly-returned consequence (a no-op when the
 *    investigation didn't have one).
 *  - `buildInterventionTextWithFallout` - the ONLY way pending fallout
 *    re-enters the world: prepended onto whatever GM Intervention text the
 *    console operator authored, then passed as `runNewTurn`'s
 *    `gmInterventionText` argument (see App.tsx's `executeTurn`).
 *    `ai/prompts/fragments.ts`'s `buildGmInterventionBlock` already treats
 *    that argument as a must-honor directive, so no change to
 *    `runNewTurn`'s signature or the adjudication prompt builder is needed.
 *  - `clearFallout` - the "consumed" transition, called only after a turn
 *    successfully commits. A turn that throws must NEVER call this - the
 *    queue is otherwise left completely untouched on failure, so a retried
 *    action still carries the same pending fallout into the next attempt
 *    (App.tsx's rollback path restores it from the pre-turn snapshot
 *    defensively, but nothing in the success path ever runs early enough to
 *    lose it in the first place).
 *  - `hasFallout` - also doubles as the condition for the subtle, in-fiction
 *    chat notice fired the moment an investigation returns one
 *    (DESIGN_DECISIONS.md D5 - a hint, never the mechanical truth; the full
 *    consequence string is GM-console-only, see GameMasterScreen.tsx).
 */

import type { InvestigationResult } from '../types';

/** The queued, not-yet-narrated consequence strings from past investigations. */
export type FalloutQueue = string[];

/** True whenever a `consequences` value is a real, non-blank directive (as opposed to null/undefined/whitespace). */
export function hasFallout(consequences: string | null | undefined): consequences is string {
    return typeof consequences === 'string' && consequences.trim().length > 0;
}

/**
 * Appends a new investigation result's consequence onto the queue, if it has
 * one. Returns the SAME array reference when there's nothing to append (a
 * clean, riskless investigation), so callers can use the result directly as
 * a `setState` value without an unnecessary re-render.
 */
export function appendFallout(queue: FalloutQueue, result: Pick<InvestigationResult, 'consequences'>): FalloutQueue {
    if (!hasFallout(result.consequences)) return queue;
    return [...queue, result.consequences.trim()];
}

/** The "consumed" transition - call only once a turn that carried this queue's fallout has successfully committed. */
export function clearFallout(): FalloutQueue {
    return [];
}

/** Renders a single queued consequence as a must-honor GM-intervention directive line. */
export function formatFalloutDirective(consequence: string): string {
    return `INTELLIGENCE FALLOUT (must be reflected this turn): ${consequence}`;
}

/**
 * Combines any pending intelligence fallout with the operator-authored GM
 * intervention text into the single string that should actually be passed
 * as `runNewTurn`'s `gmInterventionText` argument. Fallout directives are
 * prepended, one per queued consequence, ahead of whatever the GM console
 * operator typed - both halves are must-honor per
 * `ai/prompts/fragments.ts`'s `buildGmInterventionBlock`, so ordering here
 * doesn't change how strongly either is treated.
 */
export function buildInterventionTextWithFallout(pendingFallout: FalloutQueue, gmInterventionText: string): string {
    if (pendingFallout.length === 0) return gmInterventionText;

    const falloutBlock = pendingFallout.map(formatFalloutDirective).join('\n');
    const operatorText = gmInterventionText.trim();
    return operatorText ? `${falloutBlock}\n\n${operatorText}` : falloutBlock;
}
