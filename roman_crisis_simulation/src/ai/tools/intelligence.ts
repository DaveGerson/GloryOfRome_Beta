import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, StoryRelevance, Adjudication, SimulationState, ActionResolutionEvent, NpcIntent, InvestigationRolls, InvestigationTruth, TruthLedgerEntry } from '../../types';
import { mockGetClarificationOnEvent, mockGetDeepAnalysis, mockGetInvestigationResult, mockGetPlayerMonologue, mockGetSchemeNatureReading, mockGetStoryRelevance, mockIntelSeed } from '../mocks';
import { StoryRelevanceSchema, SimulationStateSchema, PlayerMonologuePayloadSchema, buildInvestigationResultSchema } from '../core/schemas';
import { generateStructured, generateText, GEMINI_PRO, GEMINI_FLASH } from '../core/geminiService';
import { zStoryRelevance, zSimulationState, zPlayerMonologuePayload, zInvestigationResult } from '../core/zodSchemas';
import type { PlayerMonologuePayloadInterchange, SimulationStateInterchange } from '../core/actorsBoundary';
import {
    rollD20,
    resolveAction,
    derivePersonalityModifier,
    deriveOppositionModifier,
    deriveInvestigationDifficulty,
    resolveInvestigationAccuracy,
    resolveInvestigationFidelity,
    ActionResolutionTier,
    createSeededRng,
    generateSeed,
    type Rng,
} from '../core/resolution';
import {
    assessmentTruth,
    investigationLedgerEntries,
    investigationTruth,
    planInvestigation,
    planSchemeNature,
    schemeClueRecords,
    schemeNatureLedgerEntry,
    type GroundTruthKind,
    type InvestigationPlan,
    type SchemeNaturePlan,
} from '../core/groundTruth';
import {
    buildClarificationPrompt,
    buildDeepAnalysisPrompt,
    buildInvestigationPrompt,
    buildSchemeNaturePrompt,
    buildStoryRelevancePrompt,
    buildSimulationStateUpdatePrompt,
} from '../prompts/intelligence';
import { buildPlayerMonologuePrompt } from '../prompts/narration';
import { assertPlayerVisibleTextSafe, assertPlayerVisibleValueSafe } from '../core/playerBoundary';

export const getClarificationOnEvent = async (ai: GoogleGenAI, event: string, question: string, player: Entity, allEntities: Entity[], isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetClarificationOnEvent) throw new Error("Mock function 'mockGetClarificationOnEvent' is not implemented.");
        const text = await mockGetClarificationOnEvent(event, question);
        assertPlayerVisibleTextSafe(text);
        return text;
    }
    const entitiesInEvent = allEntities.filter(e => event.toLowerCase().includes(e.name.toLowerCase()));
    const isVisible = entitiesInEvent.every(e => player.visibility_network.includes(e.entity_id) || e.entity_id === player.entity_id);

    const { systemInstruction, prompt } = buildClarificationPrompt(event, question, player, isVisible);
    const text = await generateText(ai, { callName: 'clarification', model: GEMINI_FLASH, systemInstruction, prompt });
    const playerVisibleText = text || "No response generated.";
    assertPlayerVisibleTextSafe(playerVisibleText);
    return playerVisibleText;
};
/**
 * The generator every D47 draw of one investigation-family call comes from:
 * a fresh recorded seed, or - offline - the target's and aspect's fixed
 * mock seed (ai/mocks.ts::mockIntelSeed), so a provider-free run exercises
 * the same grounded path deterministically and never touches Math.random.
 */
function intelGenerator(isMockMode: boolean, targetId: string, kind: GroundTruthKind): { seed: number; rng: Rng } {
    const seed = isMockMode ? mockIntelSeed(targetId, kind) : generateSeed();
    return { seed, rng: createSeededRng(seed) };
}

/**
 * The D47 accuracy and fidelity rolls (ai/core/resolution.ts) for one
 * investigation-family call, drawn in that order from `rng`, and the plan
 * (ai/core/groundTruth.ts) they shape: which of the target's real truths
 * reach the prompt, and whether they come back true, garbled or false.
 */
function rollAndPlan(
    target: Entity,
    player: Entity,
    kind: GroundTruthKind,
    tier: ActionResolutionTier,
    seed: number,
    rng: Rng,
): { rolls: InvestigationRolls; plan: InvestigationPlan } {
    const investigatorIntrigue = player.skills?.intrigue ?? null;
    const accuracy = resolveInvestigationAccuracy({
        roll: rollD20(rng),
        tier,
        investigatorIntrigue,
        targetParanoia: target.personality?.paranoia,
    });
    const fidelity = resolveInvestigationFidelity({
        roll: rollD20(rng),
        tier,
        investigatorIntrigue,
        difficulty: deriveInvestigationDifficulty(target),
    });
    const rolls: InvestigationRolls = {
        seed,
        tier,
        accuracyRoll: accuracy.roll,
        accuracy: accuracy.accuracy,
        fidelityRoll: fidelity.roll,
        fidelity: fidelity.fidelity,
    };
    return { rolls, plan: planInvestigation(target, kind, { accuracy: accuracy.accuracy, fidelity: fidelity.fidelity }, rng) };
}

/**
 * The standing a commissioned Spymaster's Assessment reads at in place of an
 * operational tier roll (it makes none - no agent risks being seen, so it
 * carries no consequences): a figure inside the player's network is read as a
 * clean operation would be; one outside it as a middling one - less reached,
 * more easily misled. Only the D47 accuracy and fidelity rolls are made.
 */
const DEEP_ANALYSIS_STANDING: Record<'inNetwork' | 'outsideNetwork', ActionResolutionTier> = {
    inNetwork: 'success',
    outsideNetwork: 'partial_success',
};

/**
 * A commissioned Spymaster's Assessment, grounded (D47) in the target's real
 * situation and aims at the rolled fidelity and accuracy. Returns the
 * assessment the player receives and its GM-PRIVATE truth (one finding: the
 * assessment as delivered), which the commit writes to the truth ledger and
 * nothing renders.
 */
export const getDeepAnalysis = async (ai: GoogleGenAI, target: Entity, player: Entity, isMockMode: boolean): Promise<{ analysis: string; truth: InvestigationTruth }> => {
    const isVisible = player.visibility_network.includes(target.entity_id);
    const { seed, rng } = intelGenerator(isMockMode, target.entity_id, 'deep_analysis');
    const tier = DEEP_ANALYSIS_STANDING[isVisible ? 'inNetwork' : 'outsideNetwork'];
    const { rolls, plan } = rollAndPlan(target, player, 'deep_analysis', tier, seed, rng);

    let playerVisibleText: string;
    if (isMockMode) {
        if(!mockGetDeepAnalysis) throw new Error("Mock function 'mockGetDeepAnalysis' is not implemented.");
        playerVisibleText = await mockGetDeepAnalysis(target, plan);
    } else {
        const { systemInstruction, prompt } = buildDeepAnalysisPrompt(target, player, isVisible, plan);
        const text = await generateText(ai, { callName: 'deepAnalysis', model: GEMINI_FLASH, systemInstruction, prompt });
        playerVisibleText = text || "Intelligence unavailable.";
    }
    assertPlayerVisibleTextSafe(playerVisibleText);
    return { analysis: playerVisibleText, truth: assessmentTruth(plan, target.entity_id, rolls, playerVisibleText) };
};

/** `isRisky` nudges the roll's difficulty up slightly - kept as a signature-compatible parameter (components/DramatisPersonaeTab.tsx always passes `true` today) rather than removed outright now that a real roll (not a prose "40% chance" line) decides the outcome. */
const RISKY_INVESTIGATION_DIFFICULTY_BONUS = 2;

/** Fallback consequence text used ONLY if the model ignores the tier guidance and returns `null` on a failure tier - the field's non-null-ness on a failure tier is enforced in code, not just prompt hope. */
const DEFAULT_INVESTIGATION_CONSEQUENCE: Record<'critical_failure' | 'failure', string> = {
    critical_failure: 'Your agent was caught red-handed - the target now knows exactly who came looking, and why.',
    failure: 'Your agent was spotted and is now being watched, reducing their effectiveness.',
};

function isFailureTier(tier: ActionResolutionTier): tier is 'critical_failure' | 'failure' {
    return tier === 'critical_failure' || tier === 'failure';
}

/** What an investigation hands back: the player-facing account, the GM-only roll trace, and the GM-PRIVATE truth of every finding (D47). */
export interface InvestigationToolResult {
    report: string;
    consequences: string | null;
    reportData: string[];
    resolutionTrace?: ActionResolutionEvent;
    /**
     * GM-PRIVATE (D11/D47): one entry per itemised finding in `reportData`,
     * in order, with whether it is true and the ground truth behind it. The
     * caller forwards it, untouched and unrendered, to the commit that writes
     * the truth ledger - never to any player-facing surface.
     */
    truth?: InvestigationTruth;
}

export const getInvestigationResult = async (ai: GoogleGenAI, target: Entity, player: Entity, isRisky: boolean, isMockMode: boolean, subject: 'secrets' | 'beliefs' | 'scheme' = 'secrets'): Promise<InvestigationToolResult> => {
    // Resolution layer (ROADMAP_0_MASTER_PLAN.md Phase 3 item 5): resolve a
    // HIDDEN dice roll BEFORE the model call, exactly like the mortality
    // pipeline and the main turn's action-resolution layer - the model
    // never decides whether the investigation succeeds, only narrates the
    // pre-decided tier. No assessment call is needed here (unlike the main
    // turn's player action): an investigation is always a real, consequential
    // 'intrigue' check, so it always rolls.
    //
    // Investigations run OUTSIDE the turn pipeline (player-triggered from
    // the UI), so each gets its OWN 32-bit seed rather than drawing from a
    // turn's generator; the seed is recorded on the returned
    // `resolutionTrace` so the roll is replayable
    // (ai/core/resolution.ts::createSeededRng). The trace - seed, roll,
    // tier, all of it - is GM-console-only data (DESIGN_DECISIONS.md D4):
    // callers must never render it, or anything derived from it, on a
    // player-facing surface.
    //
    // D47: the same generator then draws the accuracy and fidelity rolls and
    // picks which of the target's real truths are reached (rollAndPlan) - in
    // Mock Mode too, from the fixed mock seed, so offline play runs the same
    // grounded path.
    const { seed, rng } = intelGenerator(isMockMode, target.entity_id, subject);
    const relevantSkillValue = player.skills?.intrigue ?? null;
    const personalityModifier = derivePersonalityModifier({
        personality: player.personality,
        relevantSkill: 'intrigue',
        actionCategory: `${subject} investigation`,
    });
    const oppositionModifier = deriveOppositionModifier({
        relationshipTowardActor: target.relationships[player.entity_id],
    });
    const baseDifficulty = deriveInvestigationDifficulty(target);
    const difficulty = isRisky ? baseDifficulty + RISKY_INVESTIGATION_DIFFICULTY_BONUS : baseDifficulty;

    const resolution = resolveAction({
        roll: rollD20(rng),
        relevantSkillValue,
        personalityModifier,
        oppositionModifier,
        difficulty,
    });

    // The `assessment` block mirrors what the main turn's assessment call
    // would have said about this fixed check (see ActionResolutionEvent in
    // types.ts) - investigations make no assessment call, since they are
    // always a consequential 'intrigue' roll.
    const resolutionTrace: ActionResolutionEvent = {
        assessment: {
            is_consequential: true,
            action_category: `${subject} investigation`,
            relevant_skill: 'intrigue',
            difficulty,
            opposing_entity_id: target.entity_id,
            rationale: "Investigations always roll: a fixed intrigue check against the target's derived difficulty.",
        },
        roll: resolution.roll,
        total: resolution.total,
        margin: resolution.margin,
        tier: resolution.tier,
        seed,
    };

    const { rolls, plan } = rollAndPlan(target, player, subject, resolution.tier, seed, rng);

    if (isMockMode) {
        if(!mockGetInvestigationResult) throw new Error("Mock function 'mockGetInvestigationResult' is not implemented.");
        const mockResult = await mockGetInvestigationResult(target, isRisky, subject, plan);
        assertPlayerVisibleValueSafe(mockResult);
        const reportData = mockResult.reportData.slice(0, plan.findings.length);
        return { report: mockResult.report, consequences: mockResult.consequences, reportData, resolutionTrace, truth: investigationTruth(plan, target.entity_id, rolls, reportData, mockResult.report) };
    }

    const { systemInstruction, prompt } = buildInvestigationPrompt(target, player, subject, resolution.tier, plan);
    const result = await generateStructured<{ report: string, consequences: string | null, reportData: string[] }>(ai, {
        callName: 'investigation',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: buildInvestigationResultSchema(subject),
        zodSchema: zInvestigationResult,
        thinkingConfig: { thinkingBudget: 512 },
    });

    // Enforce the tier's consequences contract POST-HOC, in code - not just
    // prompt hope: success tiers are ALWAYS null (even if the model
    // hallucinated a consequence anyway), failure tiers are ALWAYS non-null
    // (falling back to a generic consequence if the model ignored the
    // directive and returned null).
    const consequences = isFailureTier(resolution.tier)
        ? (result.consequences ?? DEFAULT_INVESTIGATION_CONSEQUENCE[resolution.tier])
        : (resolution.tier === 'partial_success' ? result.consequences : null);

    // The mechanics boundary judges everything the model returned, dropped
    // findings included: a reply that leaks a roll anywhere is refused whole.
    assertPlayerVisibleValueSafe({ report: result.report, consequences, reportData: result.reportData });

    // D47, enforced the same way: the player receives one itemised finding
    // per PLANNED finding and no more, so every finding shown (and every
    // secret filed as leverage) carries a truth the engine knows. A finding
    // the model invented beyond the plan is dropped here, never shown.
    const reportData = result.reportData.slice(0, plan.findings.length);

    return { report: result.report, consequences, reportData, resolutionTrace, truth: investigationTruth(plan, target.entity_id, rolls, reportData, result.report) };
};

/**
 * The D28 reveal's reading: the design the accumulated scheme clues add up
 * to, in the agents' voice. `plan` (ai/core/groundTruth.ts::planSchemeNature)
 * has already decided - from the clue standings on the truth ledger - whether
 * that design is the true one, a garbled one or a false one. Returns null
 * when the model returns nothing (the caller then shows the honest
 * "particulars pending" line and records no nature).
 */
export const getSchemeNatureReading = async (ai: GoogleGenAI, target: Entity, player: Entity, plan: SchemeNaturePlan, isMockMode: boolean): Promise<string | null> => {
    let text: string;
    if (isMockMode) {
        if(!mockGetSchemeNatureReading) throw new Error("Mock function 'mockGetSchemeNatureReading' is not implemented.");
        text = await mockGetSchemeNatureReading(target, plan);
    } else {
        const { systemInstruction, prompt } = buildSchemeNaturePrompt(target, player, plan);
        text = (await generateText(ai, { callName: 'schemeNature', model: GEMINI_FLASH, systemInstruction, prompt })) ?? '';
    }
    const nature = text.trim();
    if (nature.length === 0) return null;
    assertPlayerVisibleTextSafe(nature);
    return nature;
};

/** What settling one investigation's truth commits: its ledger entries and, at the D28 reveal, the nature reading the dossier will quote. */
export interface SettledInvestigationTruth {
    ledgerEntries: TruthLedgerEntry[];
    /**
     * Present only when this scheme buy reached (or stood past) the reveal:
     * the reading, or null when none came back - then no nature is recorded
     * and the store keeps the nature already earned (knowledge/store.ts
     * ::ingestInvestigationReveal). Handed to the knowledge commit as is.
     */
    natureReading?: string | null;
}

/**
 * The commit-side half of D47/D11 for one bought investigation, shared by
 * hooks/useIntelCommits.ts and the journey harness so the two cannot drift:
 * one ledger entry per finding the player received, and - when this is a
 * scheme buy that reaches the D28 reveal (`natureDue`) - the nature reading,
 * planned from EVERY clue on the ledger plus this buy's, and its own ledger
 * entry recording whether the nature the player now holds is the truth.
 * `ledger` is read, never written; the caller appends the entries.
 */
export async function settleInvestigationTruth(params: {
    ai: GoogleGenAI;
    isMockMode: boolean;
    target: Entity;
    player: Entity;
    truth: InvestigationTruth;
    ledger: readonly TruthLedgerEntry[];
    natureDue: boolean;
    turn: number;
    stamp: number;
}): Promise<SettledInvestigationTruth> {
    const { ai, isMockMode, target, player, truth, ledger, natureDue, turn, stamp } = params;
    const ledgerEntries = investigationLedgerEntries(truth, turn, stamp);
    if (truth.kind !== 'scheme' || !natureDue) return { ledgerEntries };

    const clues = schemeClueRecords([...ledger, ...ledgerEntries], target.entity_id);
    const naturePlan = planSchemeNature(target, clues);
    const natureReading = await getSchemeNatureReading(ai, target, player, naturePlan, isMockMode);
    if (natureReading === null) return { ledgerEntries, natureReading: null };
    return {
        ledgerEntries: [...ledgerEntries, schemeNatureLedgerEntry(target.entity_id, naturePlan, natureReading, turn, stamp)],
        natureReading,
    };
}

/**
 * Task 4 of the actors-attribution refactor (task-4-design.md section 2):
 * switches from plain `generateText` to structured output
 * (`PlayerMonologuePayloadSchema`/`zPlayerMonologuePayload`, still
 * GEMINI_FLASH), returning the parsed `{ text, actors }` payload rather than
 * a bare string. The STRIP for this surface IS `.text` - there is no
 * `stripActorsFromX` companion (see actorsBoundary.ts) - ai/core/turn.ts
 * commits `payload.text` (post-gate) as the player-visible monologue. The
 * declared `actors` feed the no-attempt declaration gate at the call site
 * (defense-in-depth per the design doc's REACHABILITY FINDING - this call is
 * never reached on a validated no-attempt submission).
 */
export const getPlayerMonologue = async (
    ai: GoogleGenAI,
    player: Entity,
    turnHeadlines: string[],
    recentPlayerIntents: string[],
    hasObservableAttempt: boolean,
    isMockMode: boolean,
    // D49: the figures the headlines name - only their OPENLY professed ties
    // reach the prompt (buildPlayerMonologuePrompt). Optional, [] = none.
    figuresAtHand: readonly Entity[] = [],
): Promise<PlayerMonologuePayloadInterchange> => {
    if (isMockMode) {
        if(!mockGetPlayerMonologue) throw new Error("Mock function 'mockGetPlayerMonologue' is not implemented.");
        const payload = await mockGetPlayerMonologue(player, turnHeadlines, recentPlayerIntents);
        assertPlayerVisibleTextSafe(payload.text);
        return payload;
    }

    const { systemInstruction, prompt } = buildPlayerMonologuePrompt(player, turnHeadlines, recentPlayerIntents, hasObservableAttempt, figuresAtHand);
    const payload = await generateStructured<PlayerMonologuePayloadInterchange>(ai, {
        callName: 'playerMonologue',
        model: GEMINI_FLASH,
        systemInstruction,
        prompt,
        responseSchema: PlayerMonologuePayloadSchema,
        zodSchema: zPlayerMonologuePayload,
    });
    const playerVisibleText = payload.text || "I am contemplative.";
    assertPlayerVisibleTextSafe(playerVisibleText);
    return { ...payload, text: playerVisibleText };
};

export const getStoryRelevance = async (ai: GoogleGenAI, turnNumber: number, prevTurnHeadlines: string[], worldState: WorldState, npcEntities: Entity[], previousIntents: NpcIntent[], isMockMode: boolean): Promise<StoryRelevance> => {
    if (isMockMode) {
        if (!mockGetStoryRelevance) throw new Error("Mock function 'mockGetStoryRelevance' is not implemented.");
        return mockGetStoryRelevance(turnNumber, previousIntents);
    }

    const { systemInstruction, prompt } = buildStoryRelevancePrompt(turnNumber, prevTurnHeadlines, worldState, npcEntities, previousIntents);
    return generateStructured<StoryRelevance>(ai, {
        callName: 'storyRelevance',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: StoryRelevanceSchema,
        zodSchema: zStoryRelevance,
        thinkingConfig: { thinkingBudget: 512 },
    });
};

/**
 * D42 (roadmaps/DESIGN_DECISIONS.md; task-4-design.md section 2/3): the
 * STRIP moves out of this helper to ai/core/turn.ts's commit boundary,
 * so this now returns the raw `SimulationStateInterchange` (still carrying
 * `actors`) rather than the committed `SimulationState` - the caller must
 * gate `major_ongoing_crisis` against its declaration before stripping.
 * Mock branch mirrors the same shape: `{ ...oldState, actors: [] }` (no
 * provider, so no declaration - the mock pipeline keeps its own tripwire-only
 * crisis gate, see ai/mocks.ts).
 */
export const getUpdatedSimulationState = async (ai: GoogleGenAI, adjudication: Adjudication, oldState: SimulationState, hasObservableAttempt: boolean, isMockMode: boolean): Promise<SimulationStateInterchange> => {
    if (isMockMode) {
        assertPlayerVisibleValueSafe(oldState);
        return { ...oldState, actors: [] };
    }

    const { systemInstruction, prompt } = buildSimulationStateUpdatePrompt(adjudication, oldState, hasObservableAttempt);
    const rawUpdatedState = await generateStructured<SimulationStateInterchange>(ai, {
        callName: 'updatedSimulationState',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: SimulationStateSchema,
        zodSchema: zSimulationState,
        thinkingConfig: { thinkingBudget: 512 },
    });
    assertPlayerVisibleValueSafe(rawUpdatedState);
    return rawUpdatedState;
};
