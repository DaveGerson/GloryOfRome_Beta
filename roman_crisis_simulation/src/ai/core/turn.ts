import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, Adjudication, Report, TurnHistoryEntry, SimulationState } from '../../types';
import { AdjudicationSchema } from './schemas';
import { compileContext, applyAdjudication, applyDeltas } from './engine';
import { mockRunNewTurn } from "../mocks";
import { getPlayerMonologue, getStoryRelevance, getUpdatedSimulationState, getRelationshipUpdates, simulatePrivateConversation } from '../tools/intelligence';

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

    // 0. Determine story relevance to identify spotlight entities for proactive simulation
    const storyRelevance = await getStoryRelevance(ai, turnNumber, turnHistory.slice(-1)[0]?.adjudication.headlines || [], currentWorldState, isMockMode);
    
    const npcEntities = currentEntities.filter(e => e.entity_id !== playerEntity.entity_id);

    // 1. Compile context
    const recentHistory = turnHistory.slice(-6).map(h => `Turn ${h.turnNumber}: ${h.narration || h.adjudication.headlines.join('. ')}`);
    const prompt = compileContext(currentWorldState, currentSimulationState, playerEntity, npcEntities, recentHistory, playerIntent, gmInterventionText, storyRelevance, metaNarrative);
    
    // 2. Get adjudication from AI
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: AdjudicationSchema,
            thinkingConfig: { thinkingBudget: 1024 }
        },
    });

    const text = response.text || "{}";
    const cleanedText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const adjudication = JSON.parse(cleanedText) as Adjudication;

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
    const narrationPrompt = `
ROLE: Chronicler of the Empire & Intelligence Briefer
META-NARRATIVE: The story's theme is "${metaNarrative}". Your tone and focus should align with this.

PLAYER CHARACTER PROFILE (for context):
${JSON.stringify(updatedPlayerEntity, null, 2)}

PLAYER'S ACTION THIS TURN:
"${playerIntent}"

ADJUDICATION JSON (all events of the turn):
${JSON.stringify(adjudication, null, 2)}

Task:
1.  **Narrate the Turn (2-3 paragraphs):** Write a narrative summary for the player. This MUST follow a specific structure:
    a.  **Direct Consequences:** Begin by describing the immediate, observable results of the player's action ("${playerIntent}"). What happened right after they did it?
    b.  **Observed & Reported Events:** Describe other major events from the adjudication (headlines, key NPC actions) BUT strictly from the player's vantage point. Consider their location, allies, and spies.
    c.  **Source Information:** For any information the player didn't witness directly, you MUST state how they learned of it. Be specific and creative. Examples: "A panicked messenger arrives...", "Whispers in the Senate, relayed by your ally Gaius Pontius, suggest...", "A coded message from your spymaster reveals...". This makes information potentially unreliable.
    d.  **Tone:** Maintain a tone of Tacitus meets field report. Focus on concrete outcomes. Do not invent new facts not present in the Adjudication JSON.

2.  **Suggest Next Actions:** After the narration, on new lines, suggest exactly 3 brief, interesting, actionable next steps for the player, each prefixed with "SUGGESTION:". The suggestions should be tailored to the player's character, goals, and the new situation.
    `;
    const narrationResponse = await ai.models.generateContent({ 
        model: "gemini-3-pro-preview", 
        contents: narrationPrompt,
        config: { thinkingConfig: { thinkingBudget: 512 } }
    });
    const fullText = narrationResponse.text || "";
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
}