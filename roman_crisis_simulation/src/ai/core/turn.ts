import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, Adjudication, Report, TurnHistoryEntry, SimulationState, ActionResolutionEvent, TruthLedgerEntry } from '../../types';
import { AdjudicationSchema } from './schemas';
import { applyAdjudication, applyDeltas } from './engine';
import { mockRunNewTurn } from "../mocks";
import { getPlayerMonologue, getStoryRelevance, getUpdatedSimulationState, getRelationshipUpdates, simulatePrivateConversation } from '../tools/intelligence';
import { getActionAssessment } from '../tools/assessment';
import { generateStructured, generateText, generateTextStream, GEMINI_PRO, beginTurnCapture, endTurnCapture } from './geminiService';
import { zAdjudication } from './zodSchemas';
import { buildAdjudicationPrompt, PlayerActionOutcomeContext } from '../prompts/adjudication';
import { buildNarrationPrompt } from '../prompts/narration';
import { processMortality, detectDeathClaims } from './mortality';
import { createNarrationStreamGate } from './streamSplit';
import { rollD20, resolveAction, derivePersonalityModifier, deriveOppositionModifier, createSeededRng, generateSeed } from './resolution';

// Adjudication is the highest-stakes, most consequence-dense call of the
// turn - a moderate temperature keeps outcomes varied without letting the
// model wander from the world state it was given.
const ADJUDICATION_TEMPERATURE = 0.8;
// Narration is pure prose/flavor text - a higher temperature rewards
// creative, varied chronicling of the same underlying adjudication JSON.
const NARRATION_TEMPERATURE = 1.0;

/**
 * Every real step of `runNewTurn`'s pipeline that can trigger an `onStage`
 * notification (ROADMAP_0_MASTER_PLAN.md Phase 3 item 1), named in the
 * EXACT order they run below - note `mortality` runs before
 * `simulation_state` (the mortality-transformed adjudication feeds the
 * simulation-state call, see step 2.7's comment). Two stages are
 * conditional and simply never fire their notification when the underlying
 * step doesn't run this turn (see the call sites below for exactly why):
 *  - `private_conversation`: only when story relevance names >=2 spotlight
 *    entities that both resolve to real, currently-known entities.
 *  - `mortality`: only when at least one delta in the adjudication (as
 *    merged with any private-conversation deltas) actually claims a death -
 *    see `detectDeathClaims`, called just below to decide this WITHOUT
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
    | 'adjudication'
    | 'private_conversation'
    | 'mortality'
    | 'simulation_state'
    | 'monologue'
    | 'narration'
    | 'relationship_updates';

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
}

export async function runNewTurn(
    ai: GoogleGenAI,
    playerIntent: string,
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
    narration: string,
    headlines: string[],
    suggestedActions: string[],
    playerMonologue: string,
    newHistoryEntry: TurnHistoryEntry,
}> {
    if (isMockMode) {
        if(!mockRunNewTurn) throw new Error("Mock function 'mockRunNewTurn' is not implemented.");
        // FIX: Pass currentSimulationState to the mock function to align with its updated signature.
        return mockRunNewTurn(playerIntent, playerEntity, turnNumber, currentEntities, currentWorldState, currentReports, gmInterventionText, metaNarrative, currentSimulationState, currentTruthLedger);
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
    const [storyRelevance, actionAssessment] = await Promise.all([
        getStoryRelevance(ai, turnNumber, turnHistory.slice(-1)[0]?.adjudication.headlines || [], currentWorldState, isMockMode),
        getActionAssessment(ai, playerEntity, playerIntent, currentWorldState, npcEntities, isMockMode),
    ]);

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
    if (actionAssessment.is_consequential) {
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

    // 1. Compile context
    const recentHistory = turnHistory.slice(-6).map(h => `Turn ${h.turnNumber}: ${h.narration || h.adjudication.headlines.join('. ')}`);
    const { systemInstruction, prompt } = buildAdjudicationPrompt({
        worldState: currentWorldState,
        simulationState: currentSimulationState,
        playerEntity,
        npcEntities,
        history: recentHistory,
        playerIntent,
        gmInterventionText,
        storyRelevance,
        metaNarrative,
        playerActionOutcome,
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

    // Record the resolution layer's trace as a GM-private note (mirrors the
    // mortality pipeline's own gm_private notes) BEFORE processMortality
    // deep-clones the adjudication below, so the note is carried through
    // into `transformedAdjudication` automatically. Mechanics (roll/total/
    // margin/tier) are fine here - gm_private is stripped entirely before
    // the player-facing narration call (see narration.ts's
    // sanitizeAdjudicationForNarration).
    if (resolutionTrace) {
        adjudication.gm_private.push(
            `[Resolution] Player action ("${playerIntent}", ${resolutionTrace.assessment.action_category}) - roll ${resolutionTrace.roll} + modifiers vs difficulty ${resolutionTrace.assessment.difficulty} -> margin ${resolutionTrace.margin.toFixed(1)} -> ${resolutionTrace.tier}.`
        );
    }

    // *** NEW STEP 2.5: SIMULATE OFF-SCREEN NPC CONVERSATION ***
    // Moved ahead of applyAdjudication (previously ran on post-applyAdjudication
    // `updatedEntities`) so its deltas can be merged into `adjudication.deltas`
    // and pass through the SAME mortality validation gate as everything else
    // (DESIGN_DECISIONS.md D2/D3: "Any death declared by the adjudication (or
    // private-conversation deltas) must be VALIDATED"). This means npc1/npc2
    // are looked up from the pre-turn `currentEntities` snapshot rather than
    // the post-adjudication one - a minor behavioral shift, traded for a
    // single unified death-claim scan below instead of two.
    if (storyRelevance.spotlight_entities.length >= 2) {
        const npc1Id = storyRelevance.spotlight_entities[0].entity_id;
        const npc2Id = storyRelevance.spotlight_entities[1].entity_id;
        const npc1 = currentEntities.find(e => e.entity_id === npc1Id);
        const npc2 = currentEntities.find(e => e.entity_id === npc2Id);

        if (npc1 && npc2) {
            // Only notify for this stage once we KNOW the step is actually
            // about to run (both spotlight entities resolved) - see
            // `TurnStage`'s doc comment.
            options?.onStage?.('private_conversation');
            const conversationResult = await simulatePrivateConversation(ai, npc1, npc2, adjudication, isMockMode);

            if (conversationResult && conversationResult.deltas.length > 0) {
                // Merge into the adjudication's own deltas (rather than applying
                // them separately) so a single applyAdjudication call - and a
                // single mortality pass - covers both sources of deltas.
                adjudication.deltas.push(...conversationResult.deltas);
                adjudication.gm_private.push(`[Secret Meeting] ${conversationResult.dialogueSnippet}`);
            }
        }
    }

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
        turnRng
    );

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
    let { updatedEntities, updatedWorldState, updatedReports, updatedTruthLedger, perceivingNpcIds } = applyAdjudication(
        transformedAdjudication, currentEntities, currentWorldState, currentReports, currentTruthLedger,
        {
            playerEntityId: playerEntity.entity_id,
            spotlightIds: storyRelevance.spotlight_entities.map(s => s.entity_id),
        }
    );
    const updatedPlayerEntity = updatedEntities.find(e => e.entity_id === playerEntity.entity_id) || playerEntity;
    const recentPlayerIntents = turnHistory.map(h => h.playerIntent).slice(-6);

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
    // `getRelationshipUpdates` is deliberately NOT in this group - it
    // consumes the narration TEXT itself (the join's own output), so it
    // stays sequential after `Promise.all` resolves, below.
    //
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
    //  - `getRelationshipUpdates` (the one call the roadmap's warning
    //    specifically flagged for historically mutating `adjudication.gm_private`)
    //    already returns a plain `EventDelta[]` today - it is turn.ts itself,
    //    sequentially AFTER the join below, that pushes a note onto
    //    `transformedAdjudication.gm_private`. So there is no "return the
    //    delta and apply it in a defined order" step needed for the three
    //    parallel legs - none of them touch shared state at all, mutated or
    //    otherwise. `getRelationshipUpdates` stays sequential regardless,
    //    per the spec, since its INPUT depends on this join's OUTPUT.
    options?.onStage?.('simulation_state');
    const simulationStatePromise = getUpdatedSimulationState(ai, transformedAdjudication, currentSimulationState, isMockMode);

    options?.onStage?.('monologue');
    const monologuePromise = getPlayerMonologue(ai, updatedPlayerEntity, transformedAdjudication.headlines, recentPlayerIntents, isMockMode);

    // Get narration and suggested actions. `buildNarrationPrompt` receives a
    // SANITIZED adjudication (gm_private and any secret_truth trace stripped
    // - see ai/prompts/narration.ts) plus the mortality pipeline's
    // pre-decided narrative directives, so the model narrates outcomes
    // without ever seeing GM-private ground truth (DESIGN_DECISIONS.md D3/D4).
    options?.onStage?.('narration');
    const narrationStreamGate = createNarrationStreamGate();
    const mortalityDirectives = mortalityEvents.map(ev => `- ${ev.entity_name} (${ev.entity_id}): ${ev.outcomeSummary}`);
    const narrationPrompt = buildNarrationPrompt(metaNarrative, updatedPlayerEntity, playerIntent, transformedAdjudication, mortalityDirectives);
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
    const narrationPromise = onNarrationChunk
        ? generateTextStream(ai, narrationRequest, (textSoFar) => onNarrationChunk(narrationStreamGate(textSoFar)))
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
    const narrationParts = fullText.split('SUGGESTION:');
    const narration = narrationParts[0].trim();
    const suggestedActions = narrationParts.slice(1).map(s => s.trim()).filter(s => s.length > 0);

    // 5.5 Get and apply relationship updates based on narrative
    options?.onStage?.('relationship_updates');
    const relationshipDeltas = await getRelationshipUpdates(ai, narration, transformedAdjudication.headlines, updatedEntities, isMockMode);
    if (relationshipDeltas && relationshipDeltas.length > 0) {
        // DISCARD CONSTRAINT: only `updatedEntities` is taken from this
        // applyDeltas call - any newReports/newTruthLedgerEntries it returns
        // are dropped, AFTER updatedReports/updatedTruthLedger were already
        // settled above. Safe today because this call site's contract is
        // 'relation' deltas only (buildRelationshipUpdatesPrompt instructs
        // the model to emit nothing else), and 'relation' deltas mint no
        // Reports or ledger entries. If this step ever legitimately applied
        // rumor-bearing or systemic-resource deltas, their Report/ledger
        // output would have to be threaded into updatedReports/
        // updatedTruthLedger rather than discarded here.
        const { updatedEntities: entitiesAfterRelationshipUpdates } = applyDeltas(relationshipDeltas, updatedEntities, updatedWorldState, turnNumber);
        updatedEntities = entitiesAfterRelationshipUpdates;
        // Log this change for debugging.
        transformedAdjudication.gm_private.push(`[Narrative Analyst] Applied ${relationshipDeltas.length} relationship delta(s) based on turn events.`);
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
    };

    const result = {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState, // Return the new state
        updatedReports,
        updatedTruthLedger,
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
