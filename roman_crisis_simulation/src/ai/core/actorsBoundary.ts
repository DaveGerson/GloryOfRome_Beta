/**
 * ai/core/actorsBoundary.ts
 *
 * The actors-attribution INTERCHANGE boundary (Task 1 of the
 * actors-attribution refactor, ai/core/zodSchemas.ts / ai/core/schemas.ts):
 * every prose-bearing field on the provider's structured-output schemas
 * carries a sibling `actors: string[]` - the entity ids whose ACTIONS the
 * text narrates. That field is INTERCHANGE-ONLY metadata for a LATER gating
 * task; committed/persisted state (types.ts's
 * Adjudication/EventDelta/EntityAction/SimulationState, saves, turnHistory)
 * never carries it.
 *
 * Every call site that zod-parses one of these schemas strips `actors` back
 * off IMMEDIATELY after the parse, through the helpers below, so nothing
 * downstream of the parse boundary (engine.ts, playerBoundary.ts, saves,
 * turnHistory) ever sees the field. Centralized here rather than copy-pasted
 * per call site (ai/core/turn.ts, ai/tools/intelligence.ts,
 * ai/core/mortality.ts).
 */

import type { z } from 'zod';
import type { Adjudication, EntityAction, EventDelta, SimulationState } from '../../types';
import type {
  zAdjudication,
  zEntityAction,
  zEventDelta,
  zNoAttemptEvidenceSelection,
  zSimulationState,
} from './zodSchemas';

// Exported so callers (ai/core/turn.ts, ai/tools/intelligence.ts,
// ai/core/mortality.ts, ai/tools/noAttemptResponse.ts) can pin
// `generateStructured`'s generic explicitly - TS cannot always infer it from
// an optional `zodSchema` property alone.
export type EventDeltaInterchange = z.infer<typeof zEventDelta>;
export type EntityActionInterchange = z.infer<typeof zEntityAction>;
export type AdjudicationInterchange = z.infer<typeof zAdjudication>;
export type SimulationStateInterchange = z.infer<typeof zSimulationState>;
export type NoAttemptEvidenceSelectionInterchange = z.infer<typeof zNoAttemptEvidenceSelection>;

/**
 * Drops the interchange-only `actors` sibling off one parsed EventDelta.
 * Cast at the end: zEventDelta's nullable status/rumor fields infer `| null`
 * (a real value the model may send), while types.ts's EventDelta declares
 * them optional-only (`| undefined`) - the same nullable-vs-optional gap
 * every consumer of this parse already tolerates at runtime.
 */
export function stripActorsFromEventDelta(delta: EventDeltaInterchange): EventDelta {
  const { actors, ...rest } = delta;
  return rest as EventDelta;
}

/** Drops the interchange-only `actors` sibling off one parsed EntityAction. */
export function stripActorsFromEntityAction(action: EntityActionInterchange): EntityAction {
  const { actors, ...rest } = action;
  return rest;
}

/**
 * Drops `actors` from every entityAction/delta and collapses each
 * `{ text, actors }` headline back to its bare `text` string - the shape
 * types.ts's Adjudication (and every persisted turnHistory entry) requires.
 *
 * Explicit top-level destructure (not a blind `...adjudication` spread):
 * zAdjudication is `.passthrough()` (a deliberate fail-soft policy, kept
 * as-is), so a model that emits a stray TOP-LEVEL `actors` key alongside the
 * real per-field ones would otherwise ride the spread straight into the
 * committed Adjudication and saved turnHistory - exactly the leak this
 * module exists to prevent.
 *
 * Cast at the end: zEntity's add_entities/remove_entities infer `| null`
 * via `.nullable().optional()`, while types.ts's Adjudication declares them
 * optional-only (`| undefined`) - the same nullable-vs-optional gap
 * `stripActorsFromEventDelta` documents above; `.passthrough()` also means
 * the interchange type carries extra untyped keys `Adjudication` doesn't
 * declare, which a structural check alone won't paper over.
 */
export function stripActorsFromAdjudication(adjudication: AdjudicationInterchange): Adjudication {
  const { actors: _interchangeOnly, ...rest } = adjudication;
  return {
    ...rest,
    entityActions: adjudication.entityActions.map(stripActorsFromEntityAction),
    deltas: adjudication.deltas.map(stripActorsFromEventDelta),
    headlines: adjudication.headlines.map(headline => headline.text),
  } as Adjudication;
}

/** Drops the interchange-only top-level `actors` off a parsed SimulationState. */
export function stripActorsFromSimulationState(state: SimulationStateInterchange): SimulationState {
  const { actors, ...rest } = state;
  return rest;
}

/**
 * Drops the interchange-only `actors` off a parsed no-attempt evidence
 * selection. Return type is written out inline rather than importing
 * `NoAttemptEvidenceSelection` from playerView/noAttemptResponse.ts:
 * ai/core/** never imports playerView/** (playerView sits above ai/core in
 * the dependency direction - ai/tools/noAttemptResponse.ts is the one that
 * bridges the two); the two shapes are kept in lockstep by hand instead.
 */
export function stripActorsFromNoAttemptEvidenceSelection(
  selection: NoAttemptEvidenceSelectionInterchange
): { decision: 'answer' | 'no_answer'; evidenceIds: string[] } {
  const { actors, ...rest } = selection;
  return rest;
}
