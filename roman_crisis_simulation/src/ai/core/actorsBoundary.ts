/**
 * ai/core/actorsBoundary.ts
 *
 * The actors-attribution INTERCHANGE boundary (D42,
 * roadmaps/DESIGN_DECISIONS.md; ai/core/zodSchemas.ts / ai/core/schemas.ts):
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
 * ai/core/mortality.ts). The headlines' declarations alone are also kept
 * apart, as a separate GM-private record beside the history entry
 * (`attributeHeadlines` below) - never on the committed shapes themselves.
 */

import type { z } from 'zod';
import type { Adjudication, Entity, EntityAction, EventDelta, HeadlineAttribution, LivingFigure, SimulationState } from '../../types';
import type {
  zAdjudication,
  zEntityAction,
  zEventDelta,
  zNarrationPayload,
  zNoAttemptEvidenceSelection,
  zPlayerMonologuePayload,
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

// Task 4: narration/monologue switch to structured output (see
// task-4-design.md section 2). Unlike every other interchange shape above,
// the "strip" for these payloads IS `.text` - a committed narration/
// monologue value is a plain string, never an object - so there is no
// `stripActorsFromX` companion here; ai/core/turn.ts and
// ai/tools/intelligence.ts commit `payload.text` directly.
export type NarrationPayloadInterchange = z.infer<typeof zNarrationPayload>;
export type PlayerMonologuePayloadInterchange = z.infer<typeof zPlayerMonologuePayload>;

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

/** A leading article a label may carry ("the Senate"), stripped before the looser passes. */
const LEADING_ARTICLE = /^(?:the|a|an)\s+/u;

/** The shortest label, article stripped, a whole-word match may rest on: "the mob" names no one. */
const MIN_LOOSE_LABEL = 4;

/**
 * The one place a declaration outlives the commit boundary, and only as a
 * SEPARATE, additive GM-private record (D42 leaves every persisted shape as it
 * was; TurnHistoryEntry.headlineActors): each committed headline paired with
 * the `actors` its interchange item declared, so an occurrence question can be
 * grounded in who really acted (D47).
 *
 * `declared` is the interchange's headline list as the declaration-aware
 * no-attempt gate left it (the gate drops or trims headlines in place, so the
 * texts are already post-redaction); `committed` is the headline list the turn
 * finally commits. A committed headline pairs with the first unpaired declared
 * one of exactly its text. One a later tripwire-only gate pass changed after
 * the capture pairs with none and gets no record - the occurrence question
 * then takes its honest "no record" path - never a guessed one.
 *
 * Each declared label is resolved here against `rosters` in order (the
 * post-turn roster, then the pre-turn one), strictest first:
 *  1. as an entity id, else a display name, else an epithet (the last two
 *     case-insensitive) - an adjudicator that writes "Marcus Crassus" for
 *     `crassus` still names him;
 *  2. the same, with a leading article ("the", "a", "an") stripped from both
 *     sides - "the Praetorian Guard";
 *  3. a whole-word match inside a display NAME - "the Senate" for the
 *     Roman Senate. Never inside an epithet, whose "of the Curia" or "of
 *     the Suburra" names a place, not its bearer, and whose "the Boy
 *     Emperor" outlives the throne. Accepted ONLY when exactly one figure matches, the
 *     stripped label runs to MIN_LOOSE_LABEL characters ("the mob" names no
 *     one), and that figure is not the player (`playerId`): a loose label is
 *     never read as the player's own act.
 * Each hand's name is frozen with it, so the truth never depends on who is
 * still on the roster, or in a snapshot, when the question is asked. A label
 * that resolves to no one is no hand: it is kept apart as `unresolvedActors`
 * for the GM console, and a headline left with no hand arose from
 * circumstance.
 */
export function attributeHeadlines(
  declared: readonly { text: string; actors: readonly string[] }[],
  committed: readonly string[],
  rosters: readonly (readonly Entity[])[],
  playerId?: string,
): HeadlineAttribution[] {
  const everyone = rosters.flat().filter(entity => Boolean(entity?.name?.trim()));
  const folded = (value: string | undefined) => (value ?? '').trim().toLocaleLowerCase();
  const bare = (value: string | undefined) => folded(value).replace(LEADING_ARTICLE, '');
  const words = (value: string | undefined) => bare(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const holds = (haystack: readonly string[], needle: readonly string[]) =>
    needle.length > 0 && haystack.some((_, start) => needle.every((word, i) => haystack[start + i] === word));
  const resolve = (label: string): Entity | undefined => {
    const key = folded(label);
    if (!key) return undefined;
    const exact = everyone.find(entity => entity.entity_id === label)
      ?? everyone.find(entity => folded(entity.name) === key)
      ?? everyone.find(entity => entity.epithet !== undefined && folded(entity.epithet) === key);
    if (exact) return exact;
    const stripped = bare(label);
    if (!stripped) return undefined;
    const unarticled = everyone.find(entity => bare(entity.name) === stripped)
      ?? everyone.find(entity => entity.epithet !== undefined && bare(entity.epithet) === stripped);
    if (unarticled) return unarticled;
    if (stripped.length < MIN_LOOSE_LABEL) return undefined;
    const needle = words(label);
    const loose = new Map(everyone
      .filter(entity => holds(words(entity.name), needle))
      .map(entity => [entity.entity_id, entity] as const));
    const [only] = loose.values();
    return loose.size === 1 && only.entity_id !== playerId ? only : undefined;
  };
  const unpaired = [...declared];
  const records: HeadlineAttribution[] = [];
  for (const text of committed) {
    const index = unpaired.findIndex(headline => headline.text === text);
    if (index < 0) continue;
    const hands = new Map<string, string>();
    const unresolved: string[] = [];
    for (const label of unpaired[index].actors) {
      const figure = resolve(label);
      if (figure) {
        if (!hands.has(figure.entity_id)) hands.set(figure.entity_id, figure.name.trim());
      } else if (folded(label) && !unresolved.some(kept => folded(kept) === folded(label))) {
        unresolved.push(label.trim());
      }
    }
    records.push({
      text,
      actorIds: [...hands.keys()],
      actorNames: [...hands.values()],
      ...(unresolved.length > 0 ? { unresolvedActors: unresolved } : {}),
    });
    unpaired.splice(index, 1);
  }
  return records;
}

/**
 * The figures alive and on the roster at commit, each with the name it wore
 * then - written beside a non-empty attribution record
 * (TurnHistoryEntry.livingAtCommit), so an occurrence answer's decoys are
 * drawn from who was alive THEN, past the snapshot trim, and named as they
 * were: a figure since removed from the roster can still be a decoy, as it
 * can still be a true hand (whose name the record froze too).
 */
export function livingAtCommit(roster: readonly Entity[]): LivingFigure[] {
  const seen = new Set<string>();
  const living: LivingFigure[] = [];
  for (const entity of roster) {
    const id = entity?.entity_id;
    const name = entity?.name?.trim();
    if (entity?.status !== 'alive' || typeof id !== 'string' || id.length === 0 || !name || seen.has(id)) continue;
    seen.add(id);
    living.push({ id, name });
  }
  return living;
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
