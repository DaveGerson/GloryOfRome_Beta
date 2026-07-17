import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, Adjudication, Report, TurnHistoryEntry, SimulationState } from '../../types';
import { AdjudicationSchema } from './schemas';
import { applyAdjudication, applyDeltas } from './engine';
import { mockRunNewTurn } from "../mocks";
import { getPlayerMonologue, getStoryRelevance, getUpdatedSimulationState, getRelationshipUpdates, simulatePrivateConversation } from '../tools/intelligence';
import { generateStructured, generateText, GEMINI_PRO, beginTurnCapture, endTurnCapture } from './geminiService';
import { zAdjudication } from './zodSchemas';
import { buildAdjudicationPrompt } from '../prompts/adjudication';
import { buildNarrationPrompt } from '../prompts/narration';

// Adjudication is the highest-stakes, most consequence-dense call of the
// turn - a moderate temperature keeps outcomes varied without letting the
// model wander from the world state it was given.
const ADJUDICATION_TEMPERATURE = 0.8;
// Narration is pure prose/flavor text - a higher temperature rewards
// creative, varied chronicling of the same underlying adjudication JSON.
const NARRATION_TEMPERATURE = 1.0;

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
    gmInterventionText: string,
    isMockMode: boolean,
    metaNarrative: string
): Promise<{
    updatedEntities: Entity[],
    updatedWorldState: WorldState,
    updatedSimulationState: SimulationState,
    updatedReports: Report[],
    narration: string,
    headlines: string[],
    suggestedActions: string[],
    playerMonologue: string,
    newHistoryEntry: TurnHistoryEntry,
}> {
    if (isMockMode) {
        if(!mockRunNewTurn) throw new Error("Mock function 'mockRunNewTurn' is not implemented.");
        // FIX: Pass currentSimulationState to the mock function to align with its updated signature.
        return mockRunNewTurn(playerIntent, playerEntity, turnNumber, currentEntities, currentWorldState, currentReports, gmInterventionText, metaNarrative, currentSimulationState);
    }

    // Bracket the whole turn pipeline so every AI call made below (across
    // turn.ts and ai/tools/intelligence.ts) is captured for the GM screen's
    // raw-call log. See ai/core/geminiService.ts.
    beginTurnCapture();

    try {
    // 0. Determine story relevance to identify spotlight entities for proactive simulation
    const storyRelevance = await getStoryRelevance(ai, turnNumber, turnHistory.slice(-1)[0]?.adjudication.headlines || [], currentWorldState, isMockMode);

    const npcEntities = currentEntities.filter(e => e.entity_id !== playerEntity.entity_id);

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
    });

    // 2. Get adjudication from AI
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

    // *** NEW STEP 2.5: Get Updated Simulation State ***
    const updatedSimulationState = await getUpdatedSimulationState(ai, adjudication, currentSimulationState, isMockMode);

    // 3. Apply adjudication to get new state
    let { updatedEntities, updatedWorldState, updatedReports } = applyAdjudication(adjudication, currentEntities, currentWorldState, currentReports);

    // *** NEW STEP 3.5: SIMULATE OFF-SCREEN NPC CONVERSATION ***
    if (storyRelevance.spotlight_entities.length >= 2) {
        const npc1Id = storyRelevance.spotlight_entities[0].entity_id;
        const npc2Id = storyRelevance.spotlight_entities[1].entity_id;
        const npc1 = updatedEntities.find(e => e.entity_id === npc1Id);
        const npc2 = updatedEntities.find(e => e.entity_id === npc2Id);

        if (npc1 && npc2) {
            const conversationResult = await simulatePrivateConversation(ai, npc1, npc2, adjudication, isMockMode);

            if (conversationResult && conversationResult.deltas.length > 0) {
                // Apply the new deltas from the conversation
                const { updatedEntities: entitiesAfterConversation, updatedWorldState: worldStateAfterConversation } = applyDeltas(
                    conversationResult.deltas,
                    updatedEntities,
                    updatedWorldState,
                    turnNumber
                );
                updatedEntities = entitiesAfterConversation;
                updatedWorldState = worldStateAfterConversation;

                // Add the conversation to the GM log for transparency
                adjudication.gm_private.push(`[Secret Meeting] ${conversationResult.dialogueSnippet}`);
            }
        }
    }

    // 4. Get player monologue
    const updatedPlayerEntity = updatedEntities.find(e => e.entity_id === playerEntity.entity_id) || playerEntity;
    const recentPlayerIntents = turnHistory.map(h => h.playerIntent).slice(-6);
    const playerMonologue = await getPlayerMonologue(ai, updatedPlayerEntity, adjudication.headlines, recentPlayerIntents, isMockMode);

    // 5. Get narration and suggested actions
    const narrationPrompt = buildNarrationPrompt(metaNarrative, updatedPlayerEntity, playerIntent, adjudication);
    const fullText = await generateText(ai, {
        callName: 'narration',
        model: GEMINI_PRO,
        systemInstruction: narrationPrompt.systemInstruction,
        prompt: narrationPrompt.prompt,
        thinkingConfig: { thinkingBudget: 512 },
        temperature: NARRATION_TEMPERATURE,
    });
    const narrationParts = fullText.split('SUGGESTION:');
    const narration = narrationParts[0].trim();
    const suggestedActions = narrationParts.slice(1).map(s => s.trim()).filter(s => s.length > 0);

    // 5.5 Get and apply relationship updates based on narrative
    const relationshipDeltas = await getRelationshipUpdates(ai, narration, adjudication.headlines, updatedEntities, isMockMode);
    if (relationshipDeltas && relationshipDeltas.length > 0) {
        const { updatedEntities: entitiesAfterRelationshipUpdates } = applyDeltas(relationshipDeltas, updatedEntities, updatedWorldState, turnNumber);
        updatedEntities = entitiesAfterRelationshipUpdates;
        // Log this change for debugging.
        adjudication.gm_private.push(`[Narrative Analyst] Applied ${relationshipDeltas.length} relationship delta(s) based on turn events.`);
    }

    // 6. Create history entry
    const newHistoryEntry: TurnHistoryEntry = {
        turnNumber,
        playerIntent,
        adjudication,
        narration,
        postTurnEntities: updatedEntities, // Store final state
        rawCalls: endTurnCapture(),
    };

    const result = {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState, // Return the new state
        updatedReports,
        narration,
        headlines: adjudication.headlines,
        suggestedActions: suggestedActions.length > 0 ? suggestedActions : ["Consider your next move carefully.", "Consolidate your power.", "Seek new allies."],
        playerMonologue,
        newHistoryEntry,
    };

    console.log("--- RUN NEW TURN OUTPUT ---");
    console.log(JSON.stringify(result, null, 2));

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
