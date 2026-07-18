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
import { processMortality } from './mortality';

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
    const { transformedAdjudication, mortalityEvents } = await processMortality(
        ai,
        adjudication,
        currentEntities,
        playerEntity.entity_id,
        turnNumber,
        isMockMode
    );

    // *** NEW STEP 2.7: Get Updated Simulation State ***
    // Uses the mortality-TRANSFORMED adjudication so e.g. `imperial_status`
    // doesn't flip to 'Vacant' off a death claim that validation/the roll
    // ultimately overturned.
    const updatedSimulationState = await getUpdatedSimulationState(ai, transformedAdjudication, currentSimulationState, isMockMode);

    // 3. Apply the (mortality-transformed) adjudication to get new state
    let { updatedEntities, updatedWorldState, updatedReports } = applyAdjudication(transformedAdjudication, currentEntities, currentWorldState, currentReports);

    // 4. Get player monologue
    const updatedPlayerEntity = updatedEntities.find(e => e.entity_id === playerEntity.entity_id) || playerEntity;
    const recentPlayerIntents = turnHistory.map(h => h.playerIntent).slice(-6);
    const playerMonologue = await getPlayerMonologue(ai, updatedPlayerEntity, transformedAdjudication.headlines, recentPlayerIntents, isMockMode);

    // 5. Get narration and suggested actions. `buildNarrationPrompt` receives
    // a SANITIZED adjudication (gm_private and any secret_truth trace
    // stripped - see ai/prompts/narration.ts) plus the mortality pipeline's
    // pre-decided narrative directives, so the model narrates outcomes
    // without ever seeing GM-private ground truth (DESIGN_DECISIONS.md D3/D4).
    const mortalityDirectives = mortalityEvents.map(ev => `- ${ev.entity_name} (${ev.entity_id}): ${ev.outcomeSummary}`);
    const narrationPrompt = buildNarrationPrompt(metaNarrative, updatedPlayerEntity, playerIntent, transformedAdjudication, mortalityDirectives);
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
    const relationshipDeltas = await getRelationshipUpdates(ai, narration, transformedAdjudication.headlines, updatedEntities, isMockMode);
    if (relationshipDeltas && relationshipDeltas.length > 0) {
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
    };

    const result = {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState, // Return the new state
        updatedReports,
        narration,
        headlines: transformedAdjudication.headlines,
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
