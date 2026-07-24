import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, StoryRelevance, Adjudication, SimulationState, EventDelta, ActionResolutionEvent, NpcIntent } from '../../types';
import { mockGetClarificationOnEvent, mockGetDeepAnalysis, mockGetInvestigationResult, mockGetPlayerMonologue, mockGetStoryRelevance, mockSimulatePrivateConversation } from '../mocks';
import { RelationshipDeltasSchema, ConversationSimulationSchema, StoryRelevanceSchema, SimulationStateSchema, buildInvestigationResultSchema } from '../core/schemas';
import { generateStructured, generateText, GEMINI_PRO, GEMINI_FLASH } from '../core/geminiService';
import { zRelationshipDeltas, zConversationSimulation, zStoryRelevance, zSimulationState, zInvestigationResult } from '../core/zodSchemas';
import {
    rollD20,
    resolveAction,
    derivePersonalityModifier,
    deriveOppositionModifier,
    deriveInvestigationDifficulty,
    ActionResolutionTier,
    createSeededRng,
    generateSeed,
} from '../core/resolution';
import {
    buildClarificationPrompt,
    buildDeepAnalysisPrompt,
    buildInvestigationPrompt,
    buildStoryRelevancePrompt,
    buildSimulationStateUpdatePrompt,
    buildRelationshipUpdatesPrompt,
    RelationshipUpdateEvidence,
    buildPrivateConversationPrompt,
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

export const getDeepAnalysis = async (ai: GoogleGenAI, target: Entity, player: Entity, isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetDeepAnalysis) throw new Error("Mock function 'mockGetDeepAnalysis' is not implemented.");
        const text = await mockGetDeepAnalysis(target);
        assertPlayerVisibleTextSafe(text);
        return text;
    }
    const isVisible = player.visibility_network.includes(target.entity_id);
    const { systemInstruction, prompt } = buildDeepAnalysisPrompt(target, player, isVisible);
    const text = await generateText(ai, { callName: 'deepAnalysis', model: GEMINI_FLASH, systemInstruction, prompt });
    const playerVisibleText = text || "Intelligence unavailable.";
    assertPlayerVisibleTextSafe(playerVisibleText);
    return playerVisibleText;
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

export const getInvestigationResult = async (ai: GoogleGenAI, target: Entity, player: Entity, isRisky: boolean, isMockMode: boolean, subject: 'secrets' | 'beliefs' | 'scheme' = 'secrets'): Promise<{ report: string, consequences: string | null, reportData: string[], resolutionTrace?: ActionResolutionEvent }> => {
    if (isMockMode) {
        if(!mockGetInvestigationResult) throw new Error("Mock function 'mockGetInvestigationResult' is not implemented.");
        const mockResult = await mockGetInvestigationResult(target, isRisky, subject);
        assertPlayerVisibleValueSafe(mockResult);
        return mockResult;
    }

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
    const seed = generateSeed();
    const rng = createSeededRng(seed);
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

    const { systemInstruction, prompt } = buildInvestigationPrompt(target, player, subject, resolution.tier);
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

    const playerVisibleResult = { report: result.report, consequences, reportData: result.reportData };
    assertPlayerVisibleValueSafe(playerVisibleResult);
    return { ...playerVisibleResult, resolutionTrace };
};

export const getPlayerMonologue = async (ai: GoogleGenAI, player: Entity, turnHeadlines: string[], recentPlayerIntents: string[], isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetPlayerMonologue) throw new Error("Mock function 'mockGetPlayerMonologue' is not implemented.");
        const text = await mockGetPlayerMonologue(player, turnHeadlines, recentPlayerIntents);
        assertPlayerVisibleTextSafe(text);
        return text;
    }

    const { systemInstruction, prompt } = buildPlayerMonologuePrompt(player, turnHeadlines, recentPlayerIntents);
    const text = await generateText(ai, { callName: 'playerMonologue', model: GEMINI_FLASH, systemInstruction, prompt });
    const playerVisibleText = text || "I am contemplative.";
    assertPlayerVisibleTextSafe(playerVisibleText);
    return playerVisibleText;
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

export const getUpdatedSimulationState = async (ai: GoogleGenAI, adjudication: Adjudication, oldState: SimulationState, isMockMode: boolean): Promise<SimulationState> => {
    if (isMockMode) {
        assertPlayerVisibleValueSafe(oldState);
        return oldState;
    }

    const { systemInstruction, prompt } = buildSimulationStateUpdatePrompt(adjudication, oldState);
    const updatedState = await generateStructured<SimulationState>(ai, {
        callName: 'updatedSimulationState',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: SimulationStateSchema,
        zodSchema: zSimulationState,
        thinkingConfig: { thinkingBudget: 512 },
    });
    assertPlayerVisibleValueSafe(updatedState);
    return updatedState;
};

export const getRelationshipUpdates = async (
    ai: GoogleGenAI,
    evidence: RelationshipUpdateEvidence,
    entities: Entity[],
    isMockMode: boolean,
): Promise<EventDelta[]> => {
    if (isMockMode || evidence.observableAttempt === null) {
        return Promise.resolve([]);
    }

    const { systemInstruction, prompt } = buildRelationshipUpdatesPrompt(evidence, entities);
    const result = await generateStructured<{ deltas: EventDelta[] }>(ai, {
        callName: 'relationshipUpdates',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: RelationshipDeltasSchema,
        zodSchema: zRelationshipDeltas,
        thinkingConfig: { thinkingBudget: 512 },
    });
    return result.deltas;
};

export const simulatePrivateConversation = async (
    ai: GoogleGenAI,
    npc1: Entity,
    npc2: Entity,
    adjudication: Adjudication,
    isMockMode: boolean
): Promise<{ dialogueSnippet: string, deltas: EventDelta[] }> => {
    if (isMockMode) {
        return mockSimulatePrivateConversation(npc1, npc2);
    }

    const { systemInstruction, prompt } = buildPrivateConversationPrompt(npc1, npc2, adjudication);
    return generateStructured<{ dialogueSnippet: string, deltas: EventDelta[] }>(ai, {
        callName: 'privateConversation',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: ConversationSimulationSchema,
        zodSchema: zConversationSimulation,
        thinkingConfig: { thinkingBudget: 512 },
    });
};
