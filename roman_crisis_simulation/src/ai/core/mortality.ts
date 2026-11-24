/**
 * ai/core/mortality.ts
 *
 * The mortality pipeline (DESIGN_DECISIONS.md D2/D3/D4,
 * ROADMAP_0_MASTER_PLAN.md Phase 2 item 1). Any death declared by the
 * adjudication goes through
 * two gates before it sticks:
 *
 *  1. VALIDATION - a second, independent model call dispositions each
 *     claim: is this death real and earned given the world state, or a
 *     hallucination/overreach? (ai/prompts/mortality.ts's validation
 *     prompt).
 *  2. HIDDEN CODE-SIDE ROLL - for every validated claim, `resolvePlayerDeathSave`
 *     or `resolveNpcFate` (ai/core/resolution.ts) resolves an already-rolled
 *     d20 into a band. The model NEVER decides the outcome, only narrates
 *     the pre-decided one (a third, OUTCOME call, for bands whose content
 *     is rich enough to need model-authored deltas/narrative steering).
 *
 * `processMortality` returns a TRANSFORMED COPY of the adjudication (the
 * original passed in is never mutated) plus a GM-console trace array. Per
 * D4, rolls are never shown to the player - only recorded here for the GM
 * console.
 */

import { Adjudication, Entity, EventDelta, MortalityEvent } from '../../types';
import { GeminiClient, generateStructured, GEMINI_PRO, TurnCancelledError } from './geminiService';
import { isDeathClaimDelta } from './engine';
import {
  rollD20,
  resolvePlayerDeathSave,
  resolveNpcFate,
  PlayerDeathSaveOutcome,
  NpcFateOutcome,
  Rng,
} from './resolution';
import { getEntityBrief } from '../prompts/fragments';
import { buildMortalityValidationPrompt, buildMortalityOutcomePrompt } from '../prompts/mortality';
import { MortalityValidationSchema, MortalityOutcomeSchema } from './schemas';
import { zMortalityValidation, zMortalityOutcome } from './zodSchemas';
import { stripActorsFromEventDelta } from './actorsBoundary';
import { assertPlayerVisibleTextSafe, assertPlayerVisibleValueSafe } from './playerBoundary';
import type { z } from 'zod';

// Module-local generic pin for generateStructured below - TS cannot always
// infer T from an optional `zodSchema` property alone (see ai/core/actorsBoundary.ts).
type MortalityOutcomeInterchange = z.infer<typeof zMortalityOutcome>;

const MORTALITY_OUTCOME_BOUNDARY_ERROR = 'AI output violated the mortality outcome boundary.';

interface DeathClaim {
  delta: EventDelta;
  entity: Entity;
  isPlayer: boolean;
}

/**
 * The only non-adjudication context the mortality validator may receive.
 * It is constructed by the turn composition root, never copied from the
 * adjudicator's model-authored gm_private trace.
 */
export interface MortalityValidationContext {
  trustedResolutionContext?: string;
  /**
   * False on a turn the player attempted nothing (D46): the world may still
   * make an attempt on their life, but the fate's cost then lands only as
   * what the world does to them - never as an opinion, scheme or act of
   * their own, which the no-attempt boundary would refuse. Omitted = the
   * player acted.
   */
  hasObservableAttempt?: boolean;
  signal?: AbortSignal;
}

/**
 * Scans `deltas` for status deltas that claim a death (reusing engine.ts's
 * exact detection rule) and resolves them against `entities`.
 *
 * Exported so `turn.ts` can run this SAME cheap, side-effect-free check
 * before deciding whether to fire the `'mortality'` `onStage` notification
 * (ROADMAP_0_MASTER_PLAN.md Phase 3 item 1) - rather than duplicating the
 * detection rule, or having `processMortality` itself take an `onStage`
 * param just to report "I'm about to do nothing." `processMortality` below
 * still calls this again internally for its own fast-path; that's one cheap
 * array scan repeated, not a second AI call, so there's no real cost to
 * keeping the two call sites independent.
 *
 * ONE CLAIM PER LIVING ENTITY. Two exclusions keep the fate roll the single
 * authority D2/D3 make it:
 *  - An entity ALREADY dead is not a claim. Its death was decided (and, if
 *    it was a presumed death, its secret survival recorded) on the turn it
 *    happened; a later delta re-declaring it is a no-op for the engine
 *    (dead -> dead). Rolling it again would let a survival band publicly
 *    REVIVE a corpse - or out a presumed-dead NPC in hiding - on a delta
 *    that only ever said "dead".
 *  - A SECOND death-claim delta for the same entity is not a second claim:
 *    only its first is validated and rolled. Otherwise each got its own
 *    roll and applyDeltas let whichever came LAST win, so a failed death
 *    save could be overturned by a lucky second roll (or a survived one
 *    undone) - a different survival chance than D2's table. processMortality
 *    drops the duplicates from the committed deltas (see there).
 */
export function detectDeathClaims(deltas: EventDelta[], entities: Entity[], playerId: string): DeathClaim[] {
  const claims: DeathClaim[] = [];
  const claimedIds = new Set<string>();
  for (const delta of deltas) {
    if (!isDeathClaimDelta(delta)) continue;
    const entity = entities.find(e => e.entity_id === delta.key);
    if (!entity) continue; // Unknown entity (e.g. a same-turn add_entities death) - nothing to validate/roll against.
    if (entity.status === 'dead' || claimedIds.has(entity.entity_id)) continue;
    claimedIds.add(entity.entity_id);
    claims.push({ delta, entity, isPlayer: entity.entity_id === playerId });
  }
  return claims;
}

type ResolvedOutcome = PlayerDeathSaveOutcome | NpcFateOutcome;

/** Shape of the mortality VALIDATION call's parsed/validated response. Mirrors `zMortalityValidation`. */
interface MortalityValidationResult {
  dispositions: { entity_id: string; valid: boolean; reasoning: string }[];
}

interface ResolvedClaim {
  claim: DeathClaim;
  originalCause: string;
  valid: boolean;
  reasoning: string;
  roll?: number;
  outcome?: ResolvedOutcome;
}

function isNpcFateOutcome(outcome: ResolvedOutcome): outcome is NpcFateOutcome {
  return 'publicStatus' in outcome;
}

/**
 * Classifies outcome-call-authored deltas against the candidate whose fate
 * is being dressed. Resource, scheme and condition effects belong directly
 * to that candidate (D48: a loss band's loss is a removed hard asset and/or a
 * new condition, a boon may ease one); relation fallout may put the candidate
 * on either endpoint; rumor authorship is independent of its candidate
 * subject key, so any real entity may be its origin (or it may be organic and
 * omit origin_id). These are the five side-effect types promised by the
 * outcome prompt.
 * Status remains a separately traced rejection because only the validated
 * fate roll may author it; every other unauthorized effect invalidates the
 * whole response rather than being silently sanitized into a partial commit.
 */
export function partitionOutcomeDeltas(
  deltas: EventDelta[],
  candidateId: string,
  knownEntityIds: ReadonlySet<string>,
): { safe: EventDelta[]; rejected: EventDelta[]; unauthorized: EventDelta[] } {
  const safe: EventDelta[] = [];
  const rejected: EventDelta[] = [];
  const unauthorized: EventDelta[] = [];
  for (const delta of deltas) {
    if (delta.type === 'status') {
      rejected.push(delta);
      continue;
    }

    const keyParts = delta.key.split(':');
    const hasAuthorizedShape = (() => {
      switch (delta.type) {
        case 'resource':
          return keyParts.length === 2
            && keyParts[0] === candidateId
            && keyParts[1].length > 0;
        case 'relation':
          return keyParts.length === 3
            && knownEntityIds.has(keyParts[0])
            && knownEntityIds.has(keyParts[1])
            && (keyParts[0] === candidateId || keyParts[1] === candidateId)
            && ['trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level']
              .includes(keyParts[2]);
        case 'scheme':
          return delta.key === candidateId;
        case 'condition':
          return keyParts.length === 2
            && keyParts[0] === candidateId
            && keyParts[1].length > 0
            && !!delta.condition;
        case 'rumor':
          return delta.key === candidateId
            && (!delta.origin_id || knownEntityIds.has(delta.origin_id))
            && typeof delta.is_true === 'boolean'
            && typeof delta.topic === 'string'
            && delta.topic.trim().length > 0;
        default:
          return false;
      }
    })();

    if (hasAuthorizedShape) safe.push(delta);
    else unauthorized.push(delta);
  }
  return { safe, rejected, unauthorized };
}

/**
 * Runs the mortality pipeline against the adjudication's (already merged)
 * deltas. Fast path: if no status delta claims a death, returns
 * immediately with the adjudication untouched and zero extra AI calls.
 *
 * MOCK MODE: bypassed entirely. Mock mode has no real model to run the
 * validation/outcome calls against, and the shared mock adjudication
 * fixture (ai/mocks.ts's MOCK_ADJUDICATION) never declares a death, so
 * there is nothing this pipeline would do differently by partially
 * running against a mock client. Tests that need to exercise the pipeline
 * call `processMortality` directly with `isMockMode: false` and a stub
 * `GeminiClient` (see tests/mortality.test.ts) rather than relying on the
 * isMockMode branch here.
 *
 * `rng` (optional): the random source every fate roll draws from. Callers
 * that need the rolls reproducible pass a seeded generator (ai/core/turn.ts
 * passes its per-turn `createSeededRng` generator, whose seed is recorded
 * on the turn's history entry); when omitted, rolls fall back to
 * `Math.random` and are not replayable.
 *
 * `playerOutcomeDirective` (returned only when the PLAYER'S own death claim
 * was validated and rolled): the resolved band's narrative directive, which
 * ai/core/turn.ts hands to the narration prompt as the one outcome it must
 * narrate (D2: "Narration explains the escape"). It is either a band's
 * fixed default or the outcome call's directive, which has already passed
 * `assertPlayerVisibleTextSafe` below. NPC directives are never returned:
 * an NPC's fate reaches narration only through the player-perceived digest
 * (a presumed-dead directive would otherwise tell the narrator the secret).
 */
export async function processMortality(
  ai: GeminiClient,
  adjudication: Adjudication,
  entities: Entity[],
  playerId: string,
  turnNumber: number,
  isMockMode: boolean,
  rng?: Rng,
  validationContext: MortalityValidationContext = {}
): Promise<{ transformedAdjudication: Adjudication; mortalityEvents: MortalityEvent[]; playerOutcomeDirective?: string; rewrittenHeadlines?: Array<{ from: string; to: string; valid: boolean }> }> {
  if (validationContext.signal?.aborted) {
    throw new TurnCancelledError();
  }
  if (isMockMode) {
    return { transformedAdjudication: adjudication, mortalityEvents: [] };
  }

  // Deep-clone once so the caller's adjudication object is never mutated in
  // place; every delta we then touch below is a reference into THIS clone.
  const transformed: Adjudication = JSON.parse(JSON.stringify(adjudication));

  const claims = detectDeathClaims(transformed.deltas, entities, playerId);
  if (claims.length === 0) {
    return { transformedAdjudication: adjudication, mortalityEvents: [] };
  }

  // --- Gate 1: validation ------------------------------------------------
  const { systemInstruction: valSys, prompt: valPrompt } = buildMortalityValidationPrompt({
    candidates: claims.map(c => ({
      entity_id: c.entity.entity_id,
      name: c.entity.name,
      isPlayer: c.isPlayer,
      cause: c.delta.reason,
      entityBrief: getEntityBrief(c.entity),
    })),
    headlines: transformed.headlines,
    trustedResolutionContext: validationContext.trustedResolutionContext,
  });

  const validation = await generateStructured<MortalityValidationResult>(ai, {
    callName: 'mortalityValidation',
    model: GEMINI_PRO,
    systemInstruction: valSys,
    prompt: valPrompt,
    responseSchema: MortalityValidationSchema,
    zodSchema: zMortalityValidation,
    thinkingConfig: { thinkingBudget: 512 },
    signal: validationContext.signal,
  });

  const dispositionByEntity = new Map(validation.dispositions.map(d => [d.entity_id, d]));

  // --- Gate 2: hidden code-side roll (never shown to the player, D4) -----
  const resolved: ResolvedClaim[] = claims.map(claim => {
    const originalCause = claim.delta.reason;
    const disposition = dispositionByEntity.get(claim.entity.entity_id);
    const valid = disposition?.valid ?? false;
    const reasoning =
      disposition?.reasoning ??
      'The validation call returned no disposition for this entity; defaulting to invalidated (fails closed - a death never sticks without an explicit validation).';

    if (!valid) {
      return { claim, originalCause, valid, reasoning };
    }

    const roll = rollD20(rng);
    const outcome = claim.isPlayer ? resolvePlayerDeathSave(roll) : resolveNpcFate(roll);
    return { claim, originalCause, valid, reasoning, roll, outcome };
  });

  // --- Gate 3: outcome content, only for bands rich enough to need it ----
  const needingOutcome = resolved.filter(r => r.valid && r.outcome?.needsOutcomeContent);
  const outcomeByEntity = new Map<string, { deltas: EventDelta[]; narrative_directive: string; secret_motive?: string | null }>();

  if (needingOutcome.length > 0) {
    const { systemInstruction: outSys, prompt: outPrompt } = buildMortalityOutcomePrompt({
      candidates: needingOutcome.map(r => ({
        entity_id: r.claim.entity.entity_id,
        name: r.claim.entity.name,
        isPlayer: r.claim.isPlayer,
        band: r.outcome!.band,
        cause: r.originalCause,
        entityBrief: getEntityBrief(r.claim.entity),
      })),
      playerIdle: validationContext.hasObservableAttempt === false,
    });

    const outcomeResult = await generateStructured<MortalityOutcomeInterchange>(ai, {
      callName: 'mortalityOutcome',
      model: GEMINI_PRO,
      systemInstruction: outSys,
      prompt: outPrompt,
      responseSchema: MortalityOutcomeSchema,
      zodSchema: zMortalityOutcome,
      thinkingConfig: { thinkingBudget: 512 },
      signal: validationContext.signal,
    });

    // Matched by candidate id: an outcome keyed to anyone else dresses no
    // fate rolled this turn, so it is ignored - and the candidate it failed
    // to name is treated as having no outcome at all (the band's default
    // directive, and the missing-content note below).
    const candidateIds = new Set(needingOutcome.map(r => r.claim.entity.entity_id));
    for (const o of outcomeResult.outcomes) {
      if (!candidateIds.has(o.entity_id)) continue;
      assertPlayerVisibleTextSafe(o.narrative_directive);
      // Actors-attribution parse boundary (D42): strip the
      // interchange-only `actors` sibling off every outcome delta before it
      // joins the committed EventDelta[] merged into the adjudication below.
      const deltas = o.deltas.map(stripActorsFromEventDelta);
      for (const delta of deltas) {
        if (delta.type !== 'scheme') assertPlayerVisibleTextSafe(delta.reason);
        // A condition's name and description reach the bearer's own panel
        // and (when outward) a witness's dispatch: the band that caused it
        // must never ride in on them (D4 - the band is not a state, D48).
        if (delta.condition) assertPlayerVisibleValueSafe(delta.condition);
        if (typeof delta.lost_item === 'string') assertPlayerVisibleTextSafe(delta.lost_item);
      }
      outcomeByEntity.set(o.entity_id, { deltas, narrative_directive: o.narrative_directive, secret_motive: o.secret_motive });
    }
  }

  // --- Apply the transformation ------------------------------------------
  const gmPrivateNotes: string[] = [];

  // A repeated death claim for an entity already claimed above is dropped
  // from the committed deltas (see detectDeathClaims): left in, it would
  // apply AFTER the claim's rewritten delta and re-kill - or, rewritten on
  // its own roll, re-decide - an entity the one authoritative roll settled.
  const claimDeltas = new Set(claims.map(c => c.delta));
  const claimByEntity = new Map(claims.map(c => [c.entity.entity_id, c]));
  transformed.deltas = transformed.deltas.filter(delta => {
    const claim = claimByEntity.get(delta.key);
    if (!claim || claimDeltas.has(delta) || !isDeathClaimDelta(delta)) return true;
    gmPrivateNotes.push(`[Mortality] ${claim.entity.name} (${claim.entity.entity_id}): dropped a repeated death claim ("${delta.reason}") - one claim, one roll per entity per turn.`);
    return false;
  });
  const mortalityEvents: MortalityEvent[] = [];
  const extraDeltas: EventDelta[] = [];
  const knownEntityIds = new Set(entities.map(entity => entity.entity_id));
  const overturnedSubjects: OverturnedDeathSubject[] = [];
  const publicDeadThisTurnIds = new Set<string>();
  let playerOutcomeDirective: string | undefined;

  for (const r of resolved) {
    const { claim, originalCause, valid, reasoning } = r;
    const entityLabel = `${claim.entity.name} (${claim.entity.entity_id})`;

    // D3 defense-in-depth: an adjudicator-authored secret_truth can never ride
    // a death-claim delta past this pipeline. zEventDelta already strips it at
    // the model boundary; this delete guarantees the invariant for any direct
    // caller that bypasses that parse. The secretlyAlive branch below then
    // attaches the pipeline's OWN write.
    delete claim.delta.secret_truth;

    if (!valid) {
      // INVALIDATED: strip the death. Always set an explicit new_status so
      // engine.ts's structured path is taken regardless of what the
      // (now-stale) `reason` text says - see applyDeltas' 'status' case.
      // Preserve the entity's CURRENT status rather than hard-coding
      // 'alive': vetoing a hallucinated death of an exiled/missing entity
      // must not quietly restore them.
      claim.delta.new_status = claim.entity.status;
      // `reason` is committed narrative text (the GM views read it; the
      // narration prompt does not). Keep it diegetic - the validation
      // reasoning itself is GM-only and already recorded in gm_private below.
      claim.delta.reason = `${claim.entity.name} comes through the turn's events unharmed; darker reports prove unfounded.`;
      overturnedSubjects.push({
        entityId: claim.entity.entity_id,
        name: claim.entity.name,
        valid: false,
        ...(claim.entity.position ? { position: claim.entity.position } : {}),
        ...(claim.entity.epithet ? { epithet: claim.entity.epithet } : {}),
      });

      const summary = `Death claim invalidated - ${reasoning}`;
      gmPrivateNotes.push(`[Mortality] ${entityLabel}: ${summary}`);
      mortalityEvents.push({
        entity_id: claim.entity.entity_id,
        entity_name: claim.entity.name,
        claim: originalCause,
        valid: false,
        outcomeSummary: summary,
      });
      continue;
    }

    const outcome = r.outcome!;
    const roll = r.roll!;
    const contentOverride = outcomeByEntity.get(claim.entity.entity_id);
    const narrativeDirective = contentOverride?.narrative_directive ?? outcome.defaultDirective;

    const publicDies = isNpcFateOutcome(outcome) ? outcome.publicStatus === 'dead' : outcome.dies;
    const secretlyAlive = isNpcFateOutcome(outcome) && Boolean(outcome.secretlyAlive);
    if (publicDies) {
      publicDeadThisTurnIds.add(claim.entity.entity_id);
    } else if (!secretlyAlive) {
      overturnedSubjects.push({
        entityId: claim.entity.entity_id,
        name: claim.entity.name,
        valid: true,
        ...(claim.entity.position ? { position: claim.entity.position } : {}),
        ...(claim.entity.epithet ? { epithet: claim.entity.epithet } : {}),
      });
    }
    // A survival band keeps the entity's standing status, as the invalid
    // branch above does: surviving an attempt on one's life does not end an
    // exile (D1) or bring the missing home. Only an entity alive before the
    // claim is written back as 'alive'.
    claim.delta.new_status = publicDies ? 'dead' : claim.entity.status;
    // The narration prompt never reads this `reason` (it narrates from the
    // player-perceived digest, and the player's own resolved directive is
    // handed to it separately - `playerOutcomeDirective` below). It carries
    // ONLY the narrative directive so that nothing in the committed delta
    // exposes the roll/band/validation mechanics, which are D4-hidden and
    // recorded in gm_private (below) and the mortalityTrace.
    claim.delta.reason = narrativeDirective;
    if (claim.isPlayer) playerOutcomeDirective = narrativeDirective;

    let authoredSideEffects = 0;
    if (contentOverride?.deltas && contentOverride.deltas.length > 0) {
      // SECURITY GATE (D2/D4): the outcome call authors SIDE-EFFECT content
      // (resource losses, conditions, relationship shifts, rumors, scheme
      // changes) - it
      // must never author life/freedom status itself. A 'status' delta
      // emitted here would be appended AFTER the one detectDeathClaims/
      // validation/roll pass and applied unchecked by applyAdjudication,
      // letting the outcome model kill, revive, or exile ANY entity outside
      // the hidden fate roll. The claim's own delta (rewritten above)
      // already carries the authoritative status for this candidate; drop
      // every 'status' delta from outcome content and record the rejection
      // for the GM console.
      const { safe, rejected, unauthorized } = partitionOutcomeDeltas(
        contentOverride.deltas,
        claim.entity.entity_id,
        knownEntityIds,
      );
      if (unauthorized.length > 0) {
        throw new Error(MORTALITY_OUTCOME_BOUNDARY_ERROR);
      }
      // On a turn the player attempted nothing (D46), a fate's cost to the
      // player is what the world does to them - a lost holding, a mark,
      // another's view of them. Their own opinions or scheme would be an
      // act of theirs, which the no-attempt boundary refuses; drop those
      // here rather than fail the whole turn after every call was made.
      const idlePlayer = claim.isPlayer && validationContext.hasObservableAttempt === false;
      const ownAct = (delta: EventDelta) => (delta.type === 'relation' && delta.key.split(':')[0] === claim.entity.entity_id)
        || (delta.type === 'scheme' && delta.key === claim.entity.entity_id);
      const kept = idlePlayer ? safe.filter(delta => !ownAct(delta)) : safe;
      for (const dropped of idlePlayer ? safe.filter(ownAct) : []) {
        gmPrivateNotes.push(
          `[Mortality] ${entityLabel}: DROPPED a '${dropped.type}' delta authored by the outcome call (key: ${dropped.key}) - on a turn the player attempted nothing, a fate's cost to them is the world's doing, never an opinion or scheme of their own (D46).`
        );
      }
      // The loss or boon a fate leaves on the candidate - what they hold,
      // the marks they bear - is the doing of whoever made the attempt, so
      // an origin-less resource or condition delta inherits the claim's. On
      // a no-attempt turn this is what lets the world's attempt on the
      // player commit its cost (D46); the post-mortality gate still checks
      // that origin against the roster.
      const claimOrigin = claim.delta.origin_id;
      extraDeltas.push(...kept.map(delta =>
        (delta.type === 'resource' || delta.type === 'condition') && !delta.origin_id && claimOrigin ? { ...delta, origin_id: claimOrigin } : delta));
      authoredSideEffects = kept.length;
      for (const dropped of rejected) {
        gmPrivateNotes.push(
          `[Mortality] ${entityLabel}: REJECTED a 'status' delta authored by the outcome call (key: ${dropped.key}) - status changes may only come from the validated fate roll.`
        );
      }
    }

    if (isNpcFateOutcome(outcome) && outcome.secretlyAlive) {
      claim.delta.secret_truth = {
        actually_alive: true,
        hidden_since_turn: turnNumber,
        motive: contentOverride?.secret_motive || 'Feigning death to escape a losing position and plot a return.',
      };
    }

    gmPrivateNotes.push(
      `[Mortality] ${entityLabel}: validated death claim -> roll ${roll} -> ${outcome.band} (${outcome.label})`
    );
    // D2 makes the loss (or boon) real deltas, "not just prose" - D48 names
    // them: a removed hard asset and/or a condition (a boon may grant an
    // asset or ease one). The band itself is never recorded as a state. It
    // still commits when the outcome call authored none - no fallback is
    // invented here - but the GM console must not read the band's label
    // above as if the loss had happened.
    if ((outcome.needsLoss || outcome.needsBoon) && authoredSideEffects === 0) {
      const kind = outcome.needsLoss ? 'loss' : 'boon';
      gmPrivateNotes.push(
        `[Mortality] ${entityLabel}: the ${outcome.band} band required a ${kind} but none was authored - it committed without one.`
      );
    }
    mortalityEvents.push({
      entity_id: claim.entity.entity_id,
      entity_name: claim.entity.name,
      claim: originalCause,
      valid: true,
      roll,
      band: outcome.band,
      outcomeSummary: narrativeDirective,
    });
  }

  const rosterForGuard = entities.map(entity => (
    publicDeadThisTurnIds.has(entity.entity_id) ? { ...entity, status: 'dead' as const } : entity
  ));
  const { headlines: guardedHeadlines, rewrites: rewrittenHeadlines } = guardOverturnedDeathHeadlines(
    transformed.headlines,
    overturnedSubjects,
    rosterForGuard,
  );
  if (rewrittenHeadlines.length > 0) {
    transformed.headlines = guardedHeadlines;
    for (const { from, to } of rewrittenHeadlines) {
      gmPrivateNotes.push(`[Mortality] Overturned-death headline rewritten: "${from}" -> "${to}"`);
    }
  }

  transformed.deltas.push(...extraDeltas);
  transformed.gm_private.push(...gmPrivateNotes);

  return {
    transformedAdjudication: transformed,
    mortalityEvents,
    playerOutcomeDirective,
    ...(rewrittenHeadlines.length > 0 ? { rewrittenHeadlines } : {}),
  };
}

interface OverturnedDeathSubject {
  entityId: string;
  name: string;
  valid: boolean;
  position?: string;
  epithet?: string;
}

const DEATH_ASSERTION_RE = /\b(?:dead|death|dies|died|killed|killing|slain|slaying|assassinated|assassination|murdered|murder|executed|execution|perished|demise|fell dead|cut down|struck down|poisoned|strangled|beheaded|bled out|body found|met (?:his|her|their) end|passed away|succumbed|corpse|funeral|lifeless)\b/i;
const SURVIVAL_QUALIFIER_RE = /\b(?:surviv(?:ed|es)\s+(?:the\s+|an\s+)?(?:attempt|attack|ambush|assassination|plot|blade|poison|strike|assault|ambuscade)|narrowly escaped|escaped death|escapes with (?:his|her|their) life|foiled\s+(?:the\s+)?(?:plot|assassination|attempt)|unharmed|unfounded|still lives|still alive|fails to end)\b/i;
const TITLE_STOP_WORDS = new Set([
  'emperor', 'empress', 'caesar', 'augustus', 'augusta', 'regent', 'senator', 'consul',
  'general', 'tribune', 'prefect', 'king', 'queen', 'legion', 'guard', 'lord', 'lady',
  'soldier', 'governor', 'commander', 'priest', 'merchant', 'advisor', 'patrician', 'plebeian',
  'gaius', 'marcus', 'lucius', 'publius', 'quintus', 'titus', 'sextus', 'tiberius', 'gnaeus',
]);
const GENERIC_SHARED_ROLES = new Set([
  'senator', 'general', 'tribune', 'consul', 'prefect', 'soldier', 'governor',
  'commander', 'priest', 'merchant', 'advisor', 'patrician', 'plebeian', 'guard', 'lord', 'lady',
]);
const SINGULAR_IMPERIAL_TITLES = ['emperor', 'empress', 'augustus', 'augusta', 'regent'] as const;
const ACTIVE_KILLER_AFTER_RE = /^(?:\s+(?:executes?|kills?|slays?|murders?|orders?\s+the\s+(?:execution|killing|death|murder))\b|\s+(?:executed|killed|slain|murdered)\s+(?:a|an|the|his|her|their|rebel|traitor|senator|rival|general|consul|spy)\b|(?:'s|’s)\s+(?:own\s+)?(?:bodyguards?|guards?|men|soldiers?|legionaries?|agents?|assassins?|troops?|loyalists?)\s+(?:execute|executed|kill|killed|slay|slain|murder|murdered|order)\b)/i;
const PASSIVE_AGENT_BEFORE_RE = /\bby\s+(?:the\s+(?:hands?\s+of\s+)?)?$/i;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanEdgePunctuation(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '').trim();
}

function normalizedNameTokens(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map(cleanEdgePunctuation)
    .filter(token => token.length >= 4);
}

function buildUnicodeBoundaryRegex(term: string, global = false): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escapeRegex(term)}(?![\\p{L}\\p{N}\\p{M}])`, global ? 'giu' : 'iu');
}

interface SubjectPattern {
  regex: RegExp;
  isFullName: boolean;
}

function subjectPatternsFor(
  subject: OverturnedDeathSubject,
  tokenOwnerCount: ReadonlyMap<string, number>,
  phraseOwnerCount: ReadonlyMap<string, number>,
  imperialTitleCount: ReadonlyMap<string, number>,
): SubjectPattern[] {
  const patterns: SubjectPattern[] = [];
  const trimmedName = subject.name.trim();
  if (trimmedName) {
    patterns.push({ regex: buildUnicodeBoundaryRegex(trimmedName), isFullName: true });
    for (const cleanToken of normalizedNameTokens(trimmedName)) {
      const lower = cleanToken.toLowerCase();
      if (TITLE_STOP_WORDS.has(lower)) continue;
      if ((tokenOwnerCount.get(lower) ?? 0) > 1) continue;
      patterns.push({ regex: buildUnicodeBoundaryRegex(cleanToken), isFullName: false });
    }
  }

  const normalizedPos = subject.position ? cleanEdgePunctuation(subject.position).toLowerCase() : '';
  if (normalizedPos && !GENERIC_SHARED_ROLES.has(normalizedPos) && (phraseOwnerCount.get(`pos:${normalizedPos}`) ?? 0) <= 1) {
    patterns.push({ regex: buildUnicodeBoundaryRegex(cleanEdgePunctuation(subject.position!)), isFullName: false });
  }
  if (normalizedPos) {
    for (const title of SINGULAR_IMPERIAL_TITLES) {
      if (normalizedPos !== title && new RegExp(`(?<!co-)\\b${title}\\b`, 'i').test(normalizedPos) && (imperialTitleCount.get(title) ?? 0) <= 1) {
        patterns.push({ regex: buildUnicodeBoundaryRegex(title), isFullName: false });
      }
    }
  }

  const cleanEpithet = subject.epithet ? cleanEdgePunctuation(subject.epithet) : '';
  const normalizedEpithet = cleanEpithet.toLowerCase();
  if (cleanEpithet.length >= 4 && !GENERIC_SHARED_ROLES.has(normalizedEpithet) && (phraseOwnerCount.get(`ep:${normalizedEpithet}`) ?? 0) <= 1) {
    patterns.push({ regex: buildUnicodeBoundaryRegex(cleanEpithet), isFullName: false });
  }

  return patterns;
}

function isVictimOccurrence(headline: string, pattern: RegExp): boolean {
  const globalRe = new RegExp(pattern.source, 'giu');
  for (const match of headline.matchAll(globalRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = headline.slice(Math.max(0, start - 32), start);
    const after = headline.slice(end);
    const isAgent = PASSIVE_AGENT_BEFORE_RE.test(before) || ACTIVE_KILLER_AFTER_RE.test(after);
    if (!isAgent) return true;
  }
  return false;
}

function formatSubjectNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Prevents adjudication headlines from stating that a figure died when the
 * mortality pipeline invalidated the death claim or resolved it to survival
 * (excluding `presumed_dead`, whose public record must stay dead). Pure and
 * idempotent; exported for direct testing and `declaredHeadlines` sync.
 */
export function guardOverturnedDeathHeadlines(
  headlines: readonly string[],
  overturned: readonly OverturnedDeathSubject[],
  allEntities?: readonly Pick<Entity, 'entity_id' | 'name' | 'position' | 'epithet' | 'status'>[],
): { headlines: string[]; rewrites: Array<{ from: string; to: string; valid: boolean }> } {
  if (headlines.length === 0 || overturned.length === 0) {
    return { headlines: [...headlines], rewrites: [] };
  }

  const roster = allEntities && allEntities.length > 0
    ? allEntities
    : overturned.map(subject => ({
      entity_id: subject.entityId,
      name: subject.name,
      position: subject.position,
      epithet: subject.epithet,
      status: 'alive' as const,
    }));

  const tokenOwnerCount = new Map<string, number>();
  const phraseOwnerCount = new Map<string, number>();
  const imperialTitleCount = new Map<string, number>();
  for (const entity of roster) {
    const seenTokens = new Set<string>();
    for (const token of normalizedNameTokens(entity.name)) {
      const lower = token.toLowerCase();
      if (!seenTokens.has(lower)) {
        seenTokens.add(lower);
        tokenOwnerCount.set(lower, (tokenOwnerCount.get(lower) ?? 0) + 1);
      }
    }
    const pos = entity.position ? cleanEdgePunctuation(entity.position).toLowerCase() : '';
    if (pos) {
      phraseOwnerCount.set(`pos:${pos}`, (phraseOwnerCount.get(`pos:${pos}`) ?? 0) + 1);
      if (entity.status !== 'dead') {
        for (const title of SINGULAR_IMPERIAL_TITLES) {
          if (new RegExp(`(?<!co-)\\b${title}\\b`, 'i').test(pos)) {
            imperialTitleCount.set(title, (imperialTitleCount.get(title) ?? 0) + 1);
          }
        }
      }
    }
    const ep = entity.epithet ? cleanEdgePunctuation(entity.epithet).toLowerCase() : '';
    if (ep) {
      phraseOwnerCount.set(`ep:${ep}`, (phraseOwnerCount.get(`ep:${ep}`) ?? 0) + 1);
    }
  }

  const overturnedIds = new Set(overturned.map(subject => subject.entityId));
  const deadFullNameRegexes = roster
    .filter(entity => entity.status === 'dead' && !overturnedIds.has(entity.entity_id) && entity.name.trim().length > 0)
    .map(entity => buildUnicodeBoundaryRegex(entity.name.trim()));

  const matchers = overturned
    .map(subject => ({
      subject,
      patterns: subjectPatternsFor(subject, tokenOwnerCount, phraseOwnerCount, imperialTitleCount),
    }))
    .filter(item => item.patterns.length > 0);
  if (matchers.length === 0) {
    return { headlines: [...headlines], rewrites: [] };
  }

  const rewrites: Array<{ from: string; to: string; valid: boolean }> = [];
  const nextHeadlines: string[] = [];
  const seenRewrittenTexts = new Set<string>();

  for (const headline of headlines) {
    if (!DEATH_ASSERTION_RE.test(headline) || SURVIVAL_QUALIFIER_RE.test(headline)) {
      nextHeadlines.push(headline);
      continue;
    }
    const confirmedDeadNamed = deadFullNameRegexes.some(re => re.test(headline));
    const matchedSubjects: OverturnedDeathSubject[] = [];
    for (const entry of matchers) {
      const hasFullName = entry.patterns.some(p => p.isFullName && p.regex.test(headline));
      const matched = hasFullName
        ? entry.patterns.some(p => p.isFullName && isVictimOccurrence(headline, p.regex))
        : (!confirmedDeadNamed && entry.patterns.some(p => !p.isFullName && isVictimOccurrence(headline, p.regex)));
      if (matched) {
        matchedSubjects.push(entry.subject);
      }
    }
    if (matchedSubjects.length === 0) {
      nextHeadlines.push(headline);
      continue;
    }

    const valid = matchedSubjects.some(subject => subject.valid);
    const names = formatSubjectNames(matchedSubjects.map(subject => subject.name));
    const plural = matchedSubjects.length > 1;
    const to = valid
      ? (plural
        ? `An attempt against ${names} fails to end any life; ${names} still live.`
        : `An attempt against ${names} fails to end a life; ${names} still lives.`)
      : (plural
        ? `Reports claiming the end of ${names} prove unfounded; ${names} still live.`
        : `Reports claiming the end of ${names} prove unfounded; ${names} still lives.`);

    rewrites.push({ from: headline, to, valid });
    if (!seenRewrittenTexts.has(to)) {
      seenRewrittenTexts.add(to);
      nextHeadlines.push(to);
    }
  }

  return { headlines: nextHeadlines, rewrites };
}
