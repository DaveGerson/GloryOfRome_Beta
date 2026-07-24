/**
 * ai/core/mortality.ts
 *
 * The mortality pipeline (DESIGN_DECISIONS.md D2/D3/D4,
 * ROADMAP_0_MASTER_PLAN.md Phase 2 item 1). Any death declared by the
 * adjudication (or merged private-conversation deltas - see turn.ts, which
 * merges them into `adjudication.deltas` before calling this) goes through
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
import { GeminiClient, generateStructured, GEMINI_PRO } from './geminiService';
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
import { assertPlayerVisibleTextSafe } from './playerBoundary';

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
 */
export function detectDeathClaims(deltas: EventDelta[], entities: Entity[], playerId: string): DeathClaim[] {
  const claims: DeathClaim[] = [];
  for (const delta of deltas) {
    if (!isDeathClaimDelta(delta)) continue;
    const entity = entities.find(e => e.entity_id === delta.key);
    if (!entity) continue; // Unknown entity (e.g. a same-turn add_entities death) - nothing to validate/roll against.
    claims.push({ delta, entity, isPlayer: entity.entity_id === playerId });
  }
  return claims;
}

type ResolvedOutcome = PlayerDeathSaveOutcome | NpcFateOutcome;

/** Shape of the mortality VALIDATION call's parsed/validated response. Mirrors `zMortalityValidation`. */
interface MortalityValidationResult {
  dispositions: { entity_id: string; valid: boolean; reasoning: string }[];
}

/** Shape of the mortality OUTCOME call's parsed/validated response. Mirrors `zMortalityOutcome`. */
interface MortalityOutcomeResult {
  outcomes: { entity_id: string; deltas: EventDelta[]; narrative_directive: string; secret_motive?: string | null }[];
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
 * is being dressed. Resource and scheme effects belong directly to that
 * candidate; relation fallout may put the candidate on either endpoint;
 * rumor authorship is independent of its candidate subject key, so any real
 * entity may be its origin (or it may be organic and omit origin_id).
 * These are the four side-effect types promised by the outcome prompt.
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
): Promise<{ transformedAdjudication: Adjudication; mortalityEvents: MortalityEvent[] }> {
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
    });

    const outcomeResult = await generateStructured<MortalityOutcomeResult>(ai, {
      callName: 'mortalityOutcome',
      model: GEMINI_PRO,
      systemInstruction: outSys,
      prompt: outPrompt,
      responseSchema: MortalityOutcomeSchema,
      zodSchema: zMortalityOutcome,
      thinkingConfig: { thinkingBudget: 512 },
    });

    for (const o of outcomeResult.outcomes) {
      assertPlayerVisibleTextSafe(o.narrative_directive);
      for (const delta of o.deltas) {
        if (delta.type !== 'scheme') assertPlayerVisibleTextSafe(delta.reason);
      }
      outcomeByEntity.set(o.entity_id, { deltas: o.deltas, narrative_directive: o.narrative_directive, secret_motive: o.secret_motive });
    }
  }

  // --- Apply the transformation ------------------------------------------
  const gmPrivateNotes: string[] = [];
  const mortalityEvents: MortalityEvent[] = [];
  const extraDeltas: EventDelta[] = [];
  const knownEntityIds = new Set(entities.map(entity => entity.entity_id));

  for (const r of resolved) {
    const { claim, originalCause, valid, reasoning } = r;
    const entityLabel = `${claim.entity.name} (${claim.entity.entity_id})`;

    if (!valid) {
      // INVALIDATED: strip the death. Always set an explicit new_status so
      // engine.ts's structured path is taken regardless of what the
      // (now-stale) `reason` text says - see applyDeltas' 'status' case.
      // Preserve the entity's CURRENT status rather than hard-coding
      // 'alive': vetoing a hallucinated death of an exiled/missing entity
      // must not quietly restore them.
      claim.delta.new_status = claim.entity.status;
      // `reason` is narrative text that reaches the narrator (and GM views).
      // Keep it diegetic - the validation reasoning itself is GM-only and
      // already recorded in gm_private below.
      claim.delta.reason = `${claim.entity.name} comes through the turn's events unharmed; darker reports prove unfounded.`;

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
    claim.delta.new_status = publicDies ? 'dead' : 'alive';
    // `reason` reaches the narrator: carry ONLY the narrative directive.
    // The roll/band/validation mechanics are D4-hidden and already recorded
    // in gm_private (below) and the mortalityTrace.
    claim.delta.reason = narrativeDirective;

    if (contentOverride?.deltas && contentOverride.deltas.length > 0) {
      // SECURITY GATE (D2/D4): the outcome call authors SIDE-EFFECT content
      // (resource losses, relationship shifts, rumors, scheme changes) - it
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
      extraDeltas.push(...safe);
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

  transformed.deltas.push(...extraDeltas);
  transformed.gm_private.push(...gmPrivateNotes);

  return { transformedAdjudication: transformed, mortalityEvents };
}
