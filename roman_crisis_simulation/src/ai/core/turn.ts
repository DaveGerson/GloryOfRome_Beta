import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, Adjudication, Report, TurnHistoryEntry, SimulationState, ActionResolutionEvent, TruthLedgerEntry, NpcIntent, NpcMindDecision, StoryRelevance, EntityAction, Memory, PacingPosture, EventFiringRecord, EventDelta, Scheme, SchemeStep, TurnSubmission } from '../../types';
import { AdjudicationSchema } from './schemas';
import { applyAdjudication } from './engine';
import { mockRunNewTurn } from "../mocks";
import { getPlayerMonologue, getStoryRelevance, getUpdatedSimulationState } from '../tools/intelligence';
import { getActionAssessment } from '../tools/assessment';
import { getNpcMindDecision } from '../tools/npcMind';
import { MAX_MINDS_PER_TURN } from '../prompts/npcMind';
import { buildWorldSummary } from '../prompts/fragments';
import { buildPerceivedDigest, buildPlayerPerceivedDigest, PerceivedChange } from '../../perception/visibility';
import { generateStructured, generateText, generateTextStream, GEMINI_PRO, beginTurnCapture, endTurnCapture } from './geminiService';
import { zAdjudication } from './zodSchemas';
import { buildAdjudicationPrompt, PlayerActionOutcomeContext, HistoricalMaterialEntry } from '../prompts/adjudication';
import { selectRipeEventMaterial } from '../../events/engine';
import { buildNarrationPrompt, selectVoiceCast } from '../prompts/narration';
import { processMortality, detectDeathClaims } from './mortality';
import { createNarrationStreamGate } from './streamSplit';
import { rollD20, resolveAction, derivePersonalityModifier, deriveOppositionModifier, createSeededRng, generateSeed } from './resolution';
import { normalizeTurnSubmissionInput, projectForAdjudication, projectForNarration, projectForNoAttemptResponse, projectForPlayerOwnedAi, projectForResolution, serializeTurnSubmission } from '../../playerInput/turnSubmission';
import {
    assertNoInventedPlayerAction,
    assertNoInventedPlayerVisibleAction,
    assertPlayerVisibleAdjudicationSafe,
    assertPlayerVisibleTextSafe,
    assertPlayerVisibleValueSafe,
    createPlayerVisibleStreamGate,
} from './playerBoundary';

// Adjudication is the highest-stakes, most consequence-dense call of the
// turn - a moderate temperature keeps outcomes varied without letting the
// model wander from the world state it was given.
const ADJUDICATION_TEMPERATURE = 0.8;
// Narration is pure prose/flavor text - a higher temperature rewards
// creative, varied chronicling of the same underlying adjudication JSON.
const NARRATION_TEMPERATURE = 1.0;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches a rendered display name without ASCII-only `\b` semantics. */
function textContainsWholeDisplayName(text: string, displayName: string): boolean {
    const normalizedName = displayName.normalize('NFKC').trim();
    if (!normalizedName) return false;
    const normalizedText = text.normalize('NFKC');
    const pattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}\\p{M}])${escapeRegExp(normalizedName)}(?=$|[^\\p{L}\\p{N}\\p{M}])`,
        'iu'
    );
    return pattern.test(normalizedText);
}

/**
 * Upper bound on the persisted per-turn intent list (4C.3): intents exist
 * for spotlight NPCs only, and the Director is instructed to pick 2-4
 * spotlights - so the durable slice stays small by construction; the cap is
 * the code-side guarantee against a runaway response bloating the save.
 */
export const MAX_NPC_INTENTS = 4;

/**
 * Derives the DURABLE intent list from the Director's raw output: an intent
 * survives only when its entity_id is BOTH an actual spotlight pick AND an
 * entity that is alive in the current roster (intents are per-spotlight by
 * contract, and a durable intent may never ride on someone who cannot act),
 * deduped to ONE intent per entity_id keeping the FIRST emitted, capped at
 * MAX_NPC_INTENTS in emission order. The alive gate is load-bearing: a
 * spotlight id can name an NPC who is dead/exiled/missing (or absent) in
 * state, and an intent committed on such an id would be persisted and fed to
 * the NEXT turn's Director and adjudicator as live direction for a corpse -
 * the adjudicator's own spotlight block already renders only alive NPCs, so
 * a dead-id intent could never earn an entityAction and would just accrete
 * as phantom direction. The dedupe is load-bearing too: the Director's
 * contract is exactly one intent per spotlight, and without it a duplicate
 * would crowd the cap, list twice in the adjudication prompt's intents
 * block, and disagree with the mind handoff (whose Map lookup keeps only one
 * entry per entity) about WHICH intent stands - first-wins makes every
 * consumer see the same one. This filtered list is the single shape
 * everything downstream consumes - the adjudication prompt's intents block,
 * the code-side consistency check, the history entry, and the reducer's
 * persisted `npcIntents` slice. Pure; exported for direct unit testing.
 */
export function selectDurableIntents(storyRelevance: StoryRelevance, roster: readonly Pick<Entity, 'entity_id' | 'status'>[]): NpcIntent[] {
    const spotlightIds = new Set(storyRelevance.spotlight_entities.map(s => s.entity_id));
    const aliveIds = new Set(roster.filter(e => e.status === 'alive').map(e => e.entity_id));
    const seen = new Set<string>();
    const durable: NpcIntent[] = [];
    for (const intent of storyRelevance.spotlight_intents ?? []) {
        if (!spotlightIds.has(intent.entity_id) || !aliveIds.has(intent.entity_id) || seen.has(intent.entity_id)) continue;
        seen.add(intent.entity_id);
        durable.push(intent);
    }
    return durable.slice(0, MAX_NPC_INTENTS);
}

/**
 * GM-private trace for the silent-wipe edge (4C.3): the Director emitted a
 * schema-valid intent list, spotlights exist, and yet EVERY intent failed
 * selectDurableIntents' gate (mismatched entity_ids, or spotlights that are
 * not alive in the current roster) - selectDurableIntents then commits []
 * wholesale and next turn's Director is told "None on record" with no trace
 * of why. This note records the discard for the GM console
 * (same soft-contract style as buildIntentConsistencyNotes); it changes no
 * behavior. Returns [] in every non-wipe case, including the legitimate
 * empty-emission and no-spotlight cases. Pure; exported for direct unit
 * testing.
 */
export function buildIntentDiscardNotes(storyRelevance: StoryRelevance, durableIntents: NpcIntent[]): string[] {
    const emitted = storyRelevance.spotlight_intents ?? [];
    if (emitted.length === 0 || durableIntents.length > 0 || storyRelevance.spotlight_entities.length === 0) return [];
    return [
        `[Director] All ${emitted.length} emitted intent(s) were discarded: none named a live spotlight pick (intents for ${emitted.map(i => i.entity_id).join(', ')}; spotlights ${storyRelevance.spotlight_entities.map(s => s.entity_id).join(', ')}). Nothing was committed, so next turn's Director will see "None on record" - soft contract, nothing was forced.`,
    ];
}

/**
 * Drops the perceived-digest lines a mind prompt would otherwise show
 * TWICE (4C.4): the previous turn's memory stamp (ai/core/engine.ts) and
 * the mind-input digest both render the same deltas through
 * perception/visibility.ts's describeDelta, so a line stamped into this
 * NPC's memories last turn re-derives byte-identical here. Only lines whose
 * text matches a memory entry stamped with the PREVIOUS turn's number are
 * dropped (an older turn's identical text describes a different event and
 * must not suppress a fresh line). Lines the stamp dropped survive - the
 * per-turn MAX_NPC_MEMORY_LINES_PER_TURN cap, and viewers excluded from
 * the perceiving set entirely (MAX_PERCEIVING_NPCS), for whom this digest
 * is the only channel. Pure; exported for direct unit testing.
 */
export function selectUnrememberedChanges(
    changes: PerceivedChange[],
    memories: Memory[],
    previousTurnNumber: number | undefined
): PerceivedChange[] {
    if (previousTurnNumber === undefined) return changes;
    const remembered = new Set(
        memories.filter(m => m.turn === previousTurnNumber).map(m => m.event_description)
    );
    if (remembered.size === 0) return changes;
    return changes.filter(change => !remembered.has(change.text));
}

/**
 * Picks which spotlight characters get a mind call this turn (4C.4, D22):
 * the Director's spotlight picks in spotlight order (its picks are its
 * importance ranking), resolved against the pre-turn roster - ALIVE,
 * non-player entities only, deduped, capped at MAX_MINDS_PER_TURN
 * (ai/prompts/npcMind.ts). Ids that resolve to nothing are skipped, never
 * padded around.
 *
 * D22 GROUPING SEAM: one mind per spotlight CHARACTER today. When minds are
 * later grouped per set/faction (the sanctioned cost lever - factions that
 * act as a bloc may become one collective mind), THIS function is the seam:
 * it would return mind GROUPS (each carrying one or more member entities)
 * instead of individual entities, and buildNpcMindPrompt's self-brief would
 * grow a collective form. Nothing downstream assumes one-entity-per-mind
 * beyond what this function hands it. Pure; exported for direct unit
 * testing.
 */
export function selectMindEntities(storyRelevance: StoryRelevance, entities: Entity[], playerEntityId: string): Entity[] {
    const byId = new Map(entities.map(e => [e.entity_id, e]));
    const picked: Entity[] = [];
    const pickedIds = new Set<string>();
    for (const spotlight of storyRelevance.spotlight_entities) {
        if (picked.length >= MAX_MINDS_PER_TURN) break;
        const entity = byId.get(spotlight.entity_id);
        if (!entity || entity.status !== 'alive' || entity.entity_id === playerEntityId || pickedIds.has(entity.entity_id)) continue;
        pickedIds.add(entity.entity_id);
        picked.push(entity);
    }
    return picked;
}

/**
 * Upper bound on an `active_scheme`'s `steps` list once a mind-driven
 * evolution (D30) appends to it: past this cap the OLDEST steps are dropped.
 * A scheme's earliest phases are typically already completed, so the plan's
 * next moves are the load-bearing ones for what the character does now. The
 * bound is deliberately generous - the adjudicator authors ~3-5-step schemes
 * (see DYNAMIC SCHEMES in ai/prompts/adjudication.ts), so this only ever
 * bites a long-running spotlight whose own mind keeps evolving its plan turn
 * after turn; without it, a persisted field would grow without limit.
 */
export const MAX_SCHEME_STEPS = 8;

/**
 * D30: reconstructs a COMPLETE, parseable `Scheme` from an entity's CURRENT
 * `active_scheme` by folding the mind's one-line `scheme_adjustment` in as a
 * new in_progress step. This is the exact shape ai/core/engine.ts's 'scheme'
 * case REPLACES `active_scheme` with (it JSON.parses `delta.reason` as a full
 * Scheme object) - the mind returns a one-liner, not a full object, so
 * representing that note as the plan's next step keeps `active_scheme`
 * faithful to its existing shape and never corrupts engine.ts's parsing. An
 * entity with no prior scheme is SEEDED from the note (a minded character may
 * establish a scheme, not only evolve one). Steps are capped at
 * MAX_SCHEME_STEPS, dropping oldest. Pure; exported for direct unit testing.
 */
export function evolveSchemeFromAdjustment(current: Scheme | undefined, adjustment: string): Scheme {
    const note = adjustment.trim();
    const newStep: SchemeStep = { objective: note, status: 'in_progress' };
    if (!current) {
        return { name: 'Evolving design', overall_goal: note, steps: [newStep] };
    }
    const steps = [...current.steps, newStep];
    return {
        name: current.name,
        overall_goal: current.overall_goal,
        steps: steps.length > MAX_SCHEME_STEPS ? steps.slice(steps.length - MAX_SCHEME_STEPS) : steps,
    };
}

/**
 * D30: turns each spotlight mind's own `scheme_adjustment` into a committed
 * 'scheme' delta EVOLVING that entity's `active_scheme` - the character's
 * interior plan belongs to its own mind, not the adjudicator. One delta per
 * mind decision carrying a non-empty `scheme_adjustment` whose entity_id
 * resolves in `entities`; the delta's `key` is that entity_id, `delta` is 0,
 * and `reason` is a JSON string of the reconstructed Scheme (the exact
 * contract ai/core/engine.ts's 'scheme' case parses). Evolution is computed
 * from the PRE-TURN `active_scheme` in `entities`, so the mind evolves the
 * character's OWN standing plan regardless of any scheme delta the
 * adjudicator emitted the same turn (that one is deduped away at the call
 * site - a minded entity's scheme is owned by its mind). Pure; exported for
 * direct unit testing.
 */
export function buildMindSchemeDeltas(decisions: NpcMindDecision[], entities: Entity[]): EventDelta[] {
    const byId = new Map(entities.map(e => [e.entity_id, e]));
    const deltas: EventDelta[] = [];
    for (const decision of decisions) {
        const note = decision.scheme_adjustment?.trim();
        if (!note) continue;
        const entity = byId.get(decision.entity_id);
        if (!entity) continue;
        deltas.push({
            type: 'scheme',
            key: decision.entity_id,
            delta: 0,
            reason: JSON.stringify(evolveSchemeFromAdjustment(entity.active_scheme, note)),
        });
    }
    return deltas;
}

/**
 * The SOFT entityActions-vs-intent contract (4C.3): every spotlight NPC
 * holding a Director intent should have an entityAction this turn acting in
 * service of it. A missing action is recorded as a gm_private note for the
 * GM console - never a hard failure and never a forced/synthesized action,
 * because the adjudicator legitimately folds some moves into deltas or
 * narrative rather than a discrete entityAction entry. Pure; exported for
 * direct unit testing.
 */
export function buildIntentConsistencyNotes(entityActions: EntityAction[], npcIntents: NpcIntent[]): string[] {
    const actorIds = new Set(entityActions.map(action => action.id));
    return npcIntents
        .filter(intent => !actorIds.has(intent.entity_id))
        .map(intent => `[Director] Spotlight ${intent.entity_id} holds intent "${intent.intent}" (${intent.continuity}) but has no entityAction this turn - soft contract, no action was forced.`);
}

/**
 * Every real step of `runNewTurn`'s pipeline that can trigger an `onStage`
 * notification (ROADMAP_0_MASTER_PLAN.md Phase 3 item 1), named in the
 * EXACT order they run below - note `mortality` runs before
 * `simulation_state` (the mortality-transformed adjudication feeds the
 * simulation-state call, see step 2.7's comment). Two stages are
 * conditional and simply never fire their notification when the underlying
 * step doesn't run this turn (see the call sites below for exactly why):
 *  - `npc_minds`: only when at least one spotlight pick resolves to a
 *    living, non-player roster entity (see `selectMindEntities`) - up to
 *    MAX_MINDS_PER_TURN flash-tier mind calls in one Promise.all, the one
 *    added latency leg between the Director and adjudication (4C.4, D16).
 *  - `mortality`: only when at least one delta in the adjudication (as
 *    finalized below) actually claims a death - see `detectDeathClaims`,
 *    called just below to decide this WITHOUT
 *    duplicating `processMortality`'s own internal fast-path detection.
 *
 * RESOLUTION LAYER NOTE (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4): the
 * resolution layer's assessment call (`ai/tools/assessment.ts::getActionAssessment`)
 * runs CONCURRENTLY with `getStoryRelevance` under the SAME `'story_relevance'`
 * notification - it deliberately does NOT get its own `TurnStage` member.
 * `components/Chat.tsx` holds an exhaustive `Record` over this union owned
 * by a concurrent workstream, so this feature composes with the existing
 * stage window instead of extending it.
 *
 * PARALLELIZATION NOTE (ROADMAP_0_MASTER_PLAN.md Phase 3 item 3): once the
 * mortality-transformed adjudication has been applied, `simulation_state`,
 * `monologue`, and `narration` are launched CONCURRENTLY via `Promise.all`
 * - none of the three depends on either of the other two's output (see the
 * race-audit comment at the call site below). Their `onStage` notifications
 * still fire once each, synchronously, in the exact order the three legs
 * are LAUNCHED ('simulation_state' -> 'monologue' -> 'narration') - so the
 * stage a caller sees "settle" on is 'narration', the leg whose output the
 * player actually watches (and whose streaming bubble takes over the UI
 * immediately regardless). This is a deliberate shift from every other
 * stage in this enum: `onStage` notifications are no longer strictly
 * "the one thing currently running" for these three - they're "the latest
 * leg launched", since three are genuinely in flight at once. Callers that
 * want a single human-readable status label for this window can just treat
 * 'narration' as covering all three.
 */
export type TurnStage =
    | 'story_relevance'
    | 'npc_minds'
    | 'adjudication'
    | 'mortality'
    | 'simulation_state'
    | 'monologue'
    | 'narration';

export interface RunNewTurnOptions {
    /** Invoked right before each real pipeline step starts (see `TurnStage`'s doc comment for which stages can be skipped). */
    onStage?: (stage: TurnStage) => void;
    /**
     * Invoked with the CUMULATIVE, display-safe narration text as the
     * narration call streams in - already passed through
     * `createNarrationStreamGate` (see streamSplit.ts), so callers never see
     * a trailing `SUGGESTION:` line leak into what's rendered. When
     * provided, narration uses `generateTextStream`; when omitted, narration
     * uses the plain (non-streaming) `generateText`, exactly as before this
     * option existed.
     */
    onNarrationChunk?: (textSoFar: string) => void;
    /**
     * The device-level pacing-posture preference (ROADMAP_PHASE_4.md 4D
     * item 1, D23) - App.tsx reads it fresh from persistence/settings.ts at
     * each turn's start and passes it here; it selects the posture line in
     * the adjudication prompt's PACING JUDGMENT principle. Absent means
     * 'balanced' (the default contract). Prompt wording is ALL it tunes:
     * per D23 no code-side tension scalar, accumulator, or threshold exists
     * anywhere in this pipeline - pacing is the adjudicator's own judgment,
     * recorded per turn as a "[Pacing]" gm_private note (GM console only).
     */
    pacingPosture?: PacingPosture;
    /**
     * The campaign's per-event firing bookkeeping (ROADMAP_PHASE_4.md 4D
     * item 2, D12/D24) - the reducer's `eventFirings` slice. When present,
     * runNewTurn derives the ripe/near authored-event material
     * (events/engine.ts::selectRipeEventMaterial) from the PRE-TURN state
     * it already holds and renders it as the adjudication prompt's
     * GM-private HISTORICAL MATERIAL block, giving the PACING JUDGMENT
     * (D23) concrete historical currents to prefer when it tightens (D24).
     * Absent means no block - the pre-4D.2 prompt shape, unchanged. Prompt
     * material only: nothing here fires events, adds calls, or touches
     * player-facing surfaces (D4/D5).
     */
    eventFirings?: EventFiringRecord[];
}

export async function runNewTurn(
    ai: GoogleGenAI,
    submission: TurnSubmission | string,
    playerEntity: Entity,
    turnNumber: number,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    currentSimulationState: SimulationState,
    turnHistory: TurnHistoryEntry[],
    currentReports: Report[],
    // GM-PRIVATE (DESIGN_DECISIONS.md D11): flows current -> updated exactly
    // like currentReports/updatedReports; the engine appends one entry per
    // rumor delta (ai/core/engine.ts).
    currentTruthLedger: TruthLedgerEntry[],
    // GM-PRIVATE (D4/D5, 4C.3): the PREVIOUS turn's committed Director
    // intents (the reducer's `npcIntents` slice) - fed into this turn's
    // Director input for its continuity ruling, replaced wholesale by this
    // turn's `updatedNpcIntents` at commit.
    currentNpcIntents: NpcIntent[],
    gmInterventionText: string,
    isMockMode: boolean,
    metaNarrative: string,
    options?: RunNewTurnOptions
): Promise<{
    updatedEntities: Entity[],
    updatedWorldState: WorldState,
    updatedSimulationState: SimulationState,
    updatedReports: Report[],
    updatedTruthLedger: TruthLedgerEntry[],
    updatedNpcIntents: NpcIntent[],
    narration: string,
    headlines: string[],
    suggestedActions: string[],
    playerMonologue: string,
    newHistoryEntry: TurnHistoryEntry,
}> {
    const normalizedSubmission = normalizeTurnSubmissionInput(submission);
    const noAttemptResponse = projectForNoAttemptResponse(normalizedSubmission);
    const playerIntent = serializeTurnSubmission(normalizedSubmission);
    const resolutionAttempt = projectForResolution(normalizedSubmission);
    // Question/Context remains non-canonical context on mixed observable
    // submissions. With no observable attempt, the adjudicator still runs so
    // independent NPC/world events can advance, but receives no player prose
    // from which it could fabricate an avatar action.
    const adjudicationSubmission = resolutionAttempt === null
        ? { observableAttempt: null, questionOrContext: null }
        : projectForAdjudication(normalizedSubmission);
    const playerOwnedContext = projectForPlayerOwnedAi(normalizedSubmission);
    const narrationSubmission = projectForNarration(normalizedSubmission);
    if (isMockMode) {
        if(!mockRunNewTurn) throw new Error("Mock function 'mockRunNewTurn' is not implemented.");
        // FIX: Pass currentSimulationState to the mock function to align with its updated signature.
        return mockRunNewTurn(normalizedSubmission, playerEntity, turnNumber, currentEntities, currentWorldState, currentReports, gmInterventionText, metaNarrative, currentSimulationState, currentTruthLedger, currentNpcIntents);
    }

    // Bracket the whole turn pipeline so every AI call made below (across
    // turn.ts and ai/tools/intelligence.ts) is captured for the GM screen's
    // raw-call log. See ai/core/geminiService.ts.
    beginTurnCapture();

    // One seed per turn: every hidden roll this pipeline makes draws from
    // this single seeded generator, in a fixed order - the player action's
    // resolution roll first (when consequential), then each mortality roll
    // in claim order - so recording `turnSeed` on the history entry below
    // replays the turn's dice exactly (see createSeededRng in
    // ai/core/resolution.ts). Per DESIGN_DECISIONS.md D4 the seed is
    // GM-console data, never player-facing.
    const turnSeed = generateSeed();
    const turnRng = createSeededRng(turnSeed);

    try {
    // 0. Determine story relevance (Director spotlight-picking) AND assess
    // whether the player's action is consequential enough to warrant a
    // hidden dice resolution (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4's
    // resolution layer) - launched CONCURRENTLY via `Promise.all`. Both
    // calls only read PRE-TURN state (currentWorldState/currentEntities/
    // playerEntity/turnHistory) and are otherwise fully independent of one
    // another, so this costs zero additional wall-clock over story_relevance
    // alone (see the TurnStage doc comment above for why both share the
    // single 'story_relevance' notification instead of a new stage).
    options?.onStage?.('story_relevance');
    const npcEntities = currentEntities.filter(e => e.entity_id !== playerEntity.entity_id);
    const storyRelevancePromise = getStoryRelevance(ai, turnNumber, turnHistory.slice(-1)[0]?.adjudication.headlines || [], currentWorldState, npcEntities, currentNpcIntents, isMockMode);
    const actionAssessmentPromise = resolutionAttempt === null
        ? Promise.resolve(undefined)
        : getActionAssessment(ai, playerEntity, resolutionAttempt, currentWorldState, npcEntities, isMockMode);
    const [storyRelevance, actionAssessment] = await Promise.all([storyRelevancePromise, actionAssessmentPromise]);

    // *** THE DIRECTOR'S DURABLE INTENTS (4C.3) ***
    // The single filtered/capped intent list every downstream consumer sees:
    // the adjudication prompt's SPOTLIGHT NPC INTENTS block, the post-hoc
    // consistency check below, the history entry, and (via the result) the
    // reducer's persisted npcIntents slice that feeds NEXT turn's Director.
    const npcIntents = selectDurableIntents(storyRelevance, currentEntities);

    // *** RESOLUTION LAYER (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) ***
    // The model NEVER decides whether the player's action succeeds - it only
    // narrates a pre-decided outcome, mirroring the mortality pipeline's own
    // contract (DESIGN_DECISIONS.md D2/D3/D4). Non-consequential actions
    // (questions, idle conversation, pure information requests) skip rolling
    // entirely: no PLAYER ACTION OUTCOME block is injected into the
    // adjudication prompt below, no `resolutionTrace` is recorded, and the
    // adjudicator behaves exactly as it did before this feature existed.
    let playerActionOutcome: PlayerActionOutcomeContext | undefined;
    let resolutionTrace: ActionResolutionEvent | undefined;
    if (actionAssessment?.is_consequential) {
        const opposingEntity = actionAssessment.opposing_entity_id
            ? currentEntities.find(e => e.entity_id === actionAssessment.opposing_entity_id)
            : undefined;
        // Directional per this codebase's relationship convention (see
        // ai/prompts/adjudication.ts's RELATIONSHIP DELTAS rule): a
        // relationship keyed under entity A describes A's perception of the
        // OTHER entity ONLY. `opposingEntity.relationships[playerEntity.entity_id]`
        // is therefore the opposing entity's perception of the PLAYER - "the
        // opposing entity's directional stats toward the actor" this
        // feature's spec calls for.
        const relationshipTowardActor = opposingEntity?.relationships[playerEntity.entity_id];

        const relevantSkillValue = actionAssessment.relevant_skill
            ? playerEntity.skills?.[actionAssessment.relevant_skill] ?? null
            : null;
        const personalityModifier = derivePersonalityModifier({
            personality: playerEntity.personality,
            relevantSkill: actionAssessment.relevant_skill,
            actionCategory: actionAssessment.action_category,
        });
        const oppositionModifier = deriveOppositionModifier({ relationshipTowardActor });

        const resolution = resolveAction({
            roll: rollD20(turnRng),
            relevantSkillValue,
            personalityModifier,
            oppositionModifier,
            difficulty: actionAssessment.difficulty,
        });

        playerActionOutcome = { tier: resolution.tier, actionCategory: actionAssessment.action_category };
        resolutionTrace = {
            assessment: actionAssessment,
            roll: resolution.roll,
            total: resolution.total,
            margin: resolution.margin,
            tier: resolution.tier,
        };
    }

    // *** STEP 1.5: NPC MINDS (4C.4, D10/D22) ***
    // One flash-tier mind call per mind-eligible spotlight character (see
    // selectMindEntities - alive, non-player, capped at MAX_MINDS_PER_TURN),
    // all launched in a single Promise.all: the ONE added latency leg
    // between the Director and adjudication that D16 sanctions. Each mind's
    // prompt carries ONLY that character's bounded knowledge (its own brief/
    // memories, its own perceived digest of the PREVIOUS turn's events from
    // the pre-turn roster, its Director intent, and public headlines/macro
    // state - see ai/prompts/npcMind.ts's asymmetry contract). SOFT
    // DEGRADATION: a mind-call failure never fails the turn - it is caught
    // per-mind, recorded as a [Mind] gm_private note (pushed onto the
    // adjudication below, once it exists), and that spotlight simply falls
    // back to its Director intent alone in the adjudication prompt.
    const mindNpcs = selectMindEntities(storyRelevance, currentEntities, playerEntity.entity_id);
    const npcMindResults: NpcMindDecision[] = [];
    const mindFailureNotes: string[] = [];
    if (mindNpcs.length > 0) {
        options?.onStage?.('npc_minds');
        const previousEntry = turnHistory.slice(-1)[0];
        const previousDeltas = previousEntry?.adjudication.deltas ?? [];
        const publicHeadlines = previousEntry?.adjudication.headlines ?? [];
        const worldSummary = buildWorldSummary(currentWorldState);
        const intentByEntity = new Map(npcIntents.map(intent => [intent.entity_id, intent]));
        const settled = await Promise.all(mindNpcs.map(async (npc): Promise<NpcMindDecision | null> => {
            try {
                return await getNpcMindDecision(ai, {
                    self: npc,
                    directorIntent: intentByEntity.get(npc.entity_id),
                    // The character's own vantage on last week's ground truth
                    // - the same viewer-agnostic filter the memory stamp and
                    // the player digest use (perception/visibility.ts) -
                    // minus the lines the previous turn's memory stamp
                    // already put in this character's memories, which the
                    // mind prompt renders separately (see
                    // selectUnrememberedChanges above).
                    perceivedChanges: selectUnrememberedChanges(
                        buildPerceivedDigest(previousDeltas, npc, currentEntities, currentWorldState),
                        npc.memories,
                        previousEntry?.turnNumber
                    ),
                    publicHeadlines,
                    worldSummary,
                    turnNumber,
                }, isMockMode);
            } catch (e) {
                mindFailureNotes.push(`[Mind] ${npc.entity_id}'s mind call failed (${e instanceof Error ? e.message : String(e)}) - proceeding without it; the adjudicator falls back to this spotlight's Director intent alone.`);
                return null;
            }
        }));
        npcMindResults.push(...settled.filter((decision): decision is NpcMindDecision => decision !== null));
    }

    // *** HISTORICAL MATERIAL (4D.2, D12/D24) ***
    // Authored events whose triggers are ripe or nearly due against the
    // PRE-TURN state, offered to the adjudicator's PACING JUDGMENT as
    // preferred payoff seeds. Derived only when the caller supplied the
    // event bookkeeping (options.eventFirings) - legacy call sites see no
    // block. Pure derivation, no model call; the modal event system in
    // App.tsx remains the only thing that ever fires an event verbatim.
    const historicalMaterial: HistoricalMaterialEntry[] | undefined = options?.eventFirings
        ? selectRipeEventMaterial(currentWorldState, currentSimulationState, currentEntities, playerEntity, options.eventFirings, turnNumber)
            .map(m => ({ id: m.event.id, title: m.event.title, premise: m.premise, status: m.status }))
        : undefined;

    // 1. Compile context
    const recentHistory = turnHistory.slice(-6).map(h => `Turn ${h.turnNumber}: ${h.narration || h.adjudication.headlines.join('. ')}`);
    const { systemInstruction, prompt } = buildAdjudicationPrompt({
        worldState: currentWorldState,
        simulationState: currentSimulationState,
        playerEntity,
        npcEntities,
        history: recentHistory,
        submission: adjudicationSubmission,
        gmInterventionText,
        storyRelevance,
        metaNarrative,
        playerActionOutcome,
        npcIntents,
        npcMindDecisions: npcMindResults,
        pacingPosture: options?.pacingPosture,
        historicalMaterial,
    });

    // 2. Get adjudication from AI
    options?.onStage?.('adjudication');
    const adjudication = await generateStructured<Adjudication>(ai, {
        callName: 'adjudication',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: AdjudicationSchema,
        zodSchema: zAdjudication,
        thinkingConfig: { thinkingBudget: 1024 },
        temperature: ADJUDICATION_TEMPERATURE,
    });
    assertNoInventedPlayerAction(
        adjudication,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    assertPlayerVisibleAdjudicationSafe(adjudication);

    // Record the resolution layer's trace as a GM-private note (mirrors the
    // mortality pipeline's own gm_private notes) BEFORE processMortality
    // deep-clones the adjudication below, so the note is carried through
    // into `transformedAdjudication` automatically. Mechanics (roll/total/
    // margin/tier) are fine here - gm_private is stripped entirely before
    // the player-facing narration call (see narration.ts's
    // sanitizeAdjudicationForNarration).
    let trustedResolutionContext: string | undefined;
    if (resolutionTrace) {
        trustedResolutionContext = `[Resolution] Player action ("${resolutionAttempt ?? '(no observable attempt)'}", ${resolutionTrace.assessment.action_category}) - roll ${resolutionTrace.roll} + modifiers vs difficulty ${resolutionTrace.assessment.difficulty} -> margin ${resolutionTrace.margin.toFixed(1)} -> ${resolutionTrace.tier}.`;
        adjudication.gm_private.push(trustedResolutionContext);
    }

    // *** ENTITY-ACTIONS-VS-INTENT CONSISTENCY (4C.3, soft contract) ***
    // Validated post-hoc in code, against the adjudicator's OWN
    // entityActions: a spotlight NPC holding a Director intent with no
    // entityAction gets a gm_private note for the
    // GM console. Never a hard failure - see buildIntentConsistencyNotes.
    // gm_private is stripped before narration (ai/prompts/narration.ts), so
    // these notes can never reach the player. The discard note records the
    // silent-wipe edge (all emitted intents failed the spotlight filter) so
    // the GM console can see why next turn's Director holds no record.
    adjudication.gm_private.push(...buildIntentConsistencyNotes(adjudication.entityActions, npcIntents));
    adjudication.gm_private.push(...buildIntentDiscardNotes(storyRelevance, npcIntents));

    // Mind-call soft-degradation notes (4C.4): recorded per failed mind in
    // step 1.5 above, attached here once the adjudication object exists -
    // gm_private is GM-console-only (stripped before narration), so the
    // failure is visible for tuning without ever reaching the player.
    adjudication.gm_private.push(...mindFailureNotes);

    // *** D30: MINDS CONTINUOUSLY EVOLVE THEIR OWN SCHEMES ***
    // A spotlight NPC's mind DRIVES its own active_scheme's evolution
    // (DESIGN_DECISIONS.md D30): where its decision returned a
    // scheme_adjustment, that is the CHARACTER'S own evolving intent - applied
    // as its own 'scheme' delta, not left as a hint the adjudicator may
    // discard (the pre-D30 wiring). DIRECTION PRECEDENCE, extended to scheme
    // OWNERSHIP: for a MINDED entity its own mind-driven scheme evolution WINS
    // over ANY competing 'scheme' delta from the adjudicator for that SAME
    // entity this turn. This dedup strips every 'scheme' delta whose key is a
    // mind-evolved entity, then appends the mind's own, so the entity's scheme
    // is never double-applied or overwritten. The adjudicator still OWNS
    // 'scheme' deltas for every NON-minded entity (the DYNAMIC SCHEMES rule)
    // and owns action OUTCOMES in the shared world for everyone. These deltas
    // are folded into adjudication.deltas HERE - before processMortality (a
    // deep clone that preserves non-death deltas) and before applyAdjudication
    // (step 3) - so they are committed and applied exactly ONCE, flowing
    // through D28 perception like any other 'scheme' delta: a witness senses
    // only 'something afoot', never the scheme's name
    // (perception/visibility.ts::describeDelta).
    const mindSchemeDeltas = buildMindSchemeDeltas(npcMindResults, currentEntities);
    if (mindSchemeDeltas.length > 0) {
        const mindEvolvedIds = new Set(mindSchemeDeltas.map(d => d.key));
        const supersededIds = adjudication.deltas
            .filter(d => d.type === 'scheme' && mindEvolvedIds.has(d.key))
            .map(d => d.key);
        adjudication.deltas = adjudication.deltas.filter(d => !(d.type === 'scheme' && mindEvolvedIds.has(d.key)));
        adjudication.deltas.push(...mindSchemeDeltas);
        for (const id of mindEvolvedIds) {
            adjudication.gm_private.push(`[Mind] ${id} evolved its own active_scheme this turn - applied as the character's own scheme (DIRECTION PRECEDENCE: a minded entity's interior plan is owned by its mind, not the adjudicator).`);
        }
        if (supersededIds.length > 0) {
            adjudication.gm_private.push(`[Mind] Superseded ${supersededIds.length} competing 'scheme' delta(s) for mind-evolved entities (${supersededIds.join(', ')}) - the entity's own mind owns its scheme evolution this turn; no double-application or overwrite.`);
        }
    }
    assertNoInventedPlayerAction(
        adjudication,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    assertPlayerVisibleAdjudicationSafe(adjudication);

    // *** NEW STEP 2.6: MORTALITY PIPELINE (DESIGN_DECISIONS.md D2/D3/D4) ***
    // Runs BEFORE applyAdjudication and BEFORE narration: any death claim in
    // `adjudication.deltas` (main adjudication + the private-conversation
    // deltas just merged above) is validated by a second, independent model
    // call, then resolved by a hidden code-side roll. The model never
    // decides death - it only narrates the pre-decided outcome (via
    // `mortalityEvents`' directives, fed into the narration prompt below).
    // In mock mode this is a no-op (see ai/core/mortality.ts's doc comment).
    //
    // `onStage('mortality')` only fires when there's actually at least one
    // death claim to run the pipeline against - checked here via the SAME
    // detection `processMortality` uses internally for its own fast-path
    // (see `detectDeathClaims`'s doc comment in mortality.ts for why this
    // is a cheap re-scan rather than a second AI call or a param threaded
    // into `processMortality` itself).
    if (detectDeathClaims(adjudication.deltas, currentEntities, playerEntity.entity_id).length > 0) {
        options?.onStage?.('mortality');
    }
    const { transformedAdjudication, mortalityEvents } = await processMortality(
        ai,
        adjudication,
        currentEntities,
        playerEntity.entity_id,
        turnNumber,
        isMockMode,
        turnRng,
        { trustedResolutionContext }
    );
    assertNoInventedPlayerAction(
        transformedAdjudication,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    assertPlayerVisibleAdjudicationSafe(transformedAdjudication);

    // 3. Apply the (mortality-transformed) adjudication to get new state.
    // Pure/synchronous (ai/core/engine.ts) - runs to completion before any
    // of the three parallel legs below are launched, so `updatedEntities`/
    // `updatedWorldState`/`updatedReports` are fully settled, ordinary
    // (non-shared-with-anything-concurrent) values by the time they're read.
    // The perception context bounds the NPC-side memory stamp inside
    // applyAdjudication (D5/D10): the player's entity stays out of that
    // loop (player knowledge lives in the knowledge store), and the
    // spotlight cast is first in line for the capped perceiving set. The
    // per-NPC digests are derived and discarded there; `perceivingNpcIds`
    // (recorded on the history entry below) is what lets the GM console
    // re-derive them for display.
    const appliedAdjudication = applyAdjudication(
        transformedAdjudication, currentEntities, currentWorldState, currentReports, currentTruthLedger,
        {
            playerEntityId: playerEntity.entity_id,
            spotlightIds: storyRelevance.spotlight_entities.map(s => s.entity_id),
            // The App's authoritative counter - the memory stamp's `turn`
            // provenance, never the model-echoed adjudication.turn (see
            // PerceptionStampContext in ai/core/engine.ts).
            turnNumber,
        }
    );
    let { updatedEntities } = appliedAdjudication;
    const { updatedWorldState, updatedReports, updatedTruthLedger, perceivingNpcIds } = appliedAdjudication;
    const updatedPlayerEntity = updatedEntities.find(e => e.entity_id === playerEntity.entity_id) || playerEntity;
    const recentPlayerIntents = [...turnHistory.map(h => h.playerIntent).slice(-6), playerOwnedContext];

    // *** NEW STEPS 2.7/4/5, PARALLELIZED (ROADMAP_0_MASTER_PLAN.md Phase 3
    // item 3) ***
    //
    // Three remaining legs of the turn are launched CONCURRENTLY via
    // `Promise.all`, because none of them depends on either of the other
    // two's output - only on the mortality-transformed adjudication and/or
    // the now-applied entity state:
    //   (a) getUpdatedSimulationState - reads `transformedAdjudication` +
    //       the OLD `currentSimulationState` (never the entities) to derive
    //       empire-level meta-narrative status. Previously ran BEFORE
    //       `applyAdjudication` (step 2.7); reordering it to run alongside
    //       the other two is behaviorally identical since it never read
    //       anything `applyAdjudication` produces.
    //   (b) getPlayerMonologue - reads only the already-applied
    //       `updatedPlayerEntity` + this turn's headlines/recent intents.
    //   (c) narration - reads `transformedAdjudication` + `updatedPlayerEntity`
    //       (both sanitized internally - see ai/prompts/narration.ts);
    //       streams via `onNarrationChunk`/the stream gate exactly as before
    //       this refactor, just launched inside the parallel block instead
    //       of sequentially after the monologue call.
    // For a structured no-attempt submission, (b) and (c) remain present as
    // already-resolved empty promises so the join and TurnStage sequence stay
    // unchanged, but neither player-prose provider call is issued.
    // RACE AUDIT (read every function's body - ai/tools/intelligence.ts,
    // ai/prompts/narration.ts, ai/prompts/intelligence.ts - before landing
    // this): none of (a)/(b)/(c) mutates any argument it's given.
    //  - `getUpdatedSimulationState`/`getPlayerMonologue` only pass their
    //    Entity/Adjudication/SimulationState params into pure `buildX`
    //    prompt-string builders (template literals / JSON.stringify) and
    //    return a freshly-parsed value from `generateStructured`/
    //    `generateText` - no assignment back onto any input.
    //  - The narration path's `buildNarrationPrompt` runs
    //    `sanitizeAdjudicationForNarration`/`sanitizeEntityForNarration`
    //    first, which build BRAND NEW objects via spread/`.map()` (they
    //    never assign onto `adjudication`/`updatedPlayerEntity`).
    options?.onStage?.('simulation_state');
    const simulationStatePromise = getUpdatedSimulationState(ai, transformedAdjudication, currentSimulationState, isMockMode);

    options?.onStage?.('monologue');
    const monologuePromise = noAttemptResponse
        ? Promise.resolve('')
        : getPlayerMonologue(ai, updatedPlayerEntity, transformedAdjudication.headlines, recentPlayerIntents, isMockMode);

    // Get narration and suggested actions. The event input crosses the D5
    // visibility seam first, then is narrowed field-by-field to text/source.
    // Raw adjudication actions, headlines, delta keys/reasons, and private
    // truth never enter this player-output request.
    options?.onStage?.('narration');
    const narrationStreamGate = createNarrationStreamGate();
    const playerVisibleStreamGate = createPlayerVisibleStreamGate();
    const playerPerceivedDigest = buildPlayerPerceivedDigest(
        transformedAdjudication.deltas,
        updatedPlayerEntity,
        updatedEntities,
        updatedWorldState
    );
    const playerNarrationEvents = playerPerceivedDigest
        .map(({ text, source }) => ({ text, source }));
    // 4C.5: voice flavor is allowed only for identities explicitly rendered
    // in player-visible event text. PerceivedChange.subject/deltaKey remain
    // knowledge provenance and must not select hidden rumor subjects.
    const explicitlyVisibleEntityIds = updatedEntities
        .filter(entity => entity.name.trim().length > 0
            && playerNarrationEvents.some(event => textContainsWholeDisplayName(event.text, entity.name)))
        .map(entity => entity.entity_id);
    const voiceCast = selectVoiceCast(
        [],
        explicitlyVisibleEntityIds,
        updatedEntities
    );
    const narrationPrompt = buildNarrationPrompt(metaNarrative, updatedPlayerEntity, narrationSubmission, playerNarrationEvents, voiceCast);
    const narrationRequest = {
        callName: 'narration',
        model: GEMINI_PRO,
        systemInstruction: narrationPrompt.systemInstruction,
        prompt: narrationPrompt.prompt,
        thinkingConfig: { thinkingBudget: 512 },
        temperature: NARRATION_TEMPERATURE,
    };
    // Streaming is opt-in per call (`onNarrationChunk` provided) so every
    // other call site / test that doesn't care about streaming keeps using
    // plain `generateText`, byte-for-byte as before this option existed.
    // The stream's raw cumulative text is passed through the narration
    // stream gate BEFORE reaching the caller, so `onNarrationChunk` only
    // ever sees display-safe text with any `SUGGESTION:` tail withheld -
    // see streamSplit.ts.
    const onNarrationChunk = options?.onNarrationChunk;
    const narrationPromise = noAttemptResponse
        ? Promise.resolve('')
        : onNarrationChunk
            ? generateTextStream(ai, narrationRequest, (textSoFar) => {
                const displayText = narrationStreamGate(textSoFar);
                const completedText = playerVisibleStreamGate.push(displayText);
                if (completedText !== null) onNarrationChunk(completedText);
            })
            : generateText(ai, narrationRequest);

    // The join. If any of the three rejects, `Promise.all` rejects
    // immediately with that leg's error (fail-fast) - the other two keep
    // running to their own settlement in the background, but since
    // `Promise.all` already attached a handler to every promise in its
    // array (synchronously, as part of the call above), a later
    // resolve/reject from a "losing" leg is never reported as an unhandled
    // rejection. The outer try/catch below (`endTurnCapture(); throw e;`)
    // is what actually surfaces the failure to the caller.
    const [updatedSimulationState, playerMonologue, fullText] = await Promise.all([
        simulationStatePromise,
        monologuePromise,
        narrationPromise,
    ]);
    assertPlayerVisibleValueSafe(updatedSimulationState);
    assertPlayerVisibleTextSafe(playerMonologue);
    assertPlayerVisibleTextSafe(fullText);
    assertNoInventedPlayerVisibleAction(
        updatedSimulationState,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    assertNoInventedPlayerVisibleAction(
        fullText,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    assertNoInventedPlayerVisibleAction(
        playerMonologue,
        playerEntity,
        narrationSubmission.hasObservableAttempt,
    );
    const narrationParts = fullText.split('SUGGESTION:');
    const narration = narrationParts[0].trim();
    const suggestedActions = narrationParts.slice(1).map(s => s.trim()).filter(s => s.length > 0);
    if (onNarrationChunk) {
        const finalNarration = playerVisibleStreamGate.finish(narration);
        if (finalNarration !== null) onNarrationChunk(finalNarration);
    }

    // 6. Create history entry
    const newHistoryEntry: TurnHistoryEntry = {
        turnNumber,
        playerIntent,
        adjudication: transformedAdjudication,
        narration,
        postTurnEntities: updatedEntities, // Store final state
        rawCalls: endTurnCapture(),
        mortalityTrace: mortalityEvents.length > 0 ? mortalityEvents : undefined,
        resolutionTrace,
        turnSeed,
        perceivingNpcIds,
        // Optional on the entry (save-compat): omitted entirely when the
        // Director committed no spotlight intents this turn.
        npcIntents: npcIntents.length > 0 ? npcIntents : undefined,
        // Optional (save-compat), bounded at MAX_MINDS_PER_TURN by
        // construction: this turn's mind decisions, private_reasoning
        // included - GM-console-only (D4/D5), trimmed with the snapshot
        // window like perceivingNpcIds (state/gameReducer.ts).
        npcMindResults: npcMindResults.length > 0 ? npcMindResults : undefined,
    };

    const result = {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState, // Return the new state
        updatedReports,
        updatedTruthLedger,
        // Replaces the persisted slice wholesale each commit - the Director's
        // output IS the durable intent state (4C.3 continuity loop).
        updatedNpcIntents: npcIntents,
        narration,
        headlines: transformedAdjudication.headlines,
        suggestedActions: suggestedActions.length > 0 ? suggestedActions : ["Consider your next move carefully.", "Consolidate your power.", "Seek new allies."],
        playerMonologue,
        newHistoryEntry,
    };

    // Never dump `result` to the console: it carries the turn's full raw-call
    // capture (prompts/system instructions), gm_private notes, and the turn
    // seed - GM-only data (DESIGN_DECISIONS.md D4/D5) whose sanctioned
    // channels are the GM console and the eval-corpus export.
    return result;
    } catch (e) {
        // Drain the in-flight capture buffer so a failed turn's partial raw
        // calls don't leak into whatever unrelated AI call happens next
        // (e.g. a player-triggered investigation action while the error is
        // being surfaced to the user).
        endTurnCapture();
        throw e;
    }
}
