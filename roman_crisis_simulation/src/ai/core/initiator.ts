
import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, EntityStub } from '../../types';
import { ScenarioStructureSchema, EntityListSchema } from './schemas';
import { mockGenerateScenarioStructure, mockGenerateEntitiesDetails, mockInitiateWorld } from '../mocks';
import { generateStructured, GEMINI_PRO } from './geminiService';
import { zScenarioStructure, zEntityBatch } from './zodSchemas';
import { buildScenarioStructurePrompt, buildEntityBatchPrompt } from '../prompts/worldGen';

export const generateScenarioStructure = async (
    ai: GoogleGenAI,
    metaNarrative: string,
    playerCharacterDescription: string,
    isMockMode: boolean
): Promise<{ worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[] }> => {
    console.log(`[InitWorld:Step1] Generating scenario structure...`);

    if (isMockMode) {
        return mockGenerateScenarioStructure(metaNarrative, playerCharacterDescription);
    }

    const { systemInstruction, prompt } = buildScenarioStructurePrompt(metaNarrative, playerCharacterDescription);

    try {
        console.log(`[InitWorld:Step1] Sending request to Gemini (Budget: 512)...`);
        const result = await generateStructured<{ worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[] }>(ai, {
            callName: 'scenarioStructure',
            model: GEMINI_PRO,
            systemInstruction,
            prompt,
            responseSchema: ScenarioStructureSchema,
            zodSchema: zScenarioStructure,
            thinkingConfig: { thinkingBudget: 512 },
        });

        console.log(`[InitWorld:Step1] Parsed successfully. Player: ${result.playerStub?.entity_id}, NPCs: ${result.npcStubs?.length}`);
        return result;
    } catch (e) {
        console.error("[InitWorld:Step1] Failed to generate structure:", e);
        throw e;
    }
};

const generateEntityBatch = async (
    ai: GoogleGenAI,
    targetStubs: EntityStub[],
    allStubs: EntityStub[],
    metaNarrative: string,
    worldState: WorldState,
    batchName: string,
    budget: number
): Promise<Entity[]> => {
    const targetIds = targetStubs.map(s => s.entity_id).join(', ');
    console.log(`[InitWorld:Step2:${batchName}] preparing prompt for IDs: [${targetIds}]`);

    const { systemInstruction, prompt } = buildEntityBatchPrompt(targetStubs, allStubs, metaNarrative, worldState);

    try {
        console.log(`[InitWorld:Step2:${batchName}] Sending request to Gemini (Budget: ${budget})...`);
        const start = Date.now();
        const result = await generateStructured<{ entities?: Entity[] }>(ai, {
            callName: `entityBatch:${batchName}`,
            model: GEMINI_PRO,
            systemInstruction,
            prompt,
            responseSchema: EntityListSchema,
            zodSchema: zEntityBatch,
            thinkingConfig: { thinkingBudget: budget },
        });
        const duration = Date.now() - start;
        console.log(`[InitWorld:Step2:${batchName}] Request complete in ${duration}ms.`);

        if (!result.entities || !Array.isArray(result.entities)) {
             throw new Error(`Invalid JSON structure for batch ${batchName}: missing 'entities' array.`);
        }

        console.log(`[InitWorld:Step2:${batchName}] Successfully generated ${result.entities.length} entities.`);
        return result.entities;
    } catch (e) {
        console.error(`[InitWorld:Step2:${batchName}] Failed:`, e);
        throw e;
    }
};

export const initiateWorld = async (
    ai: GoogleGenAI,
    metaNarrative: string,
    playerCharacterDescription: string,
    isMockMode: boolean
): Promise<{ worldState: WorldState, entities: Entity[], playerCharacterId: string }> => {
    console.log(`[InitWorld] Starting world generation for narrative: "${metaNarrative}"`);

    if (isMockMode) {
        return mockInitiateWorld(metaNarrative, playerCharacterDescription);
    }

    try {
        // Step 1: Generate Skeleton
        const structure = await generateScenarioStructure(ai, metaNarrative, playerCharacterDescription, isMockMode);

        const allStubs = [structure.playerStub, ...structure.npcStubs];
        const entities: Entity[] = [];

        // Step 2: Generate Player (Detailed)
        // Reduced budget to 512 to avoid "hallucination loops" or excessive output size
        const playerEntities = await generateEntityBatch(
            ai,
            [structure.playerStub],
            allStubs,
            metaNarrative,
            structure.worldState,
            "Player",
            512
        );
        entities.push(...playerEntities);

        // Step 3: Generate NPCs in small batches to avoid timeouts and output limits.
        // Batches are independent of one another, so fire them all in parallel
        // (Promise.all preserves result ordering regardless of completion order,
        // and rejects with the first batch failure - same fail-fast contract the
        // sequential loop had, just without the artificial serialization latency).
        const chunkSize = 2; // Process 2 NPCs at a time
        const npcBatches: EntityStub[][] = [];
        for (let i = 0; i < structure.npcStubs.length; i += chunkSize) {
            npcBatches.push(structure.npcStubs.slice(i, i + chunkSize));
        }

        const npcEntityBatches = await Promise.all(
            npcBatches.map((batchStubs, index) => generateEntityBatch(
                ai,
                batchStubs,
                allStubs,
                metaNarrative,
                structure.worldState,
                `NPCs_${index + 1}`,
                512
            ))
        );

        npcEntityBatches.forEach(npcEntities => entities.push(...npcEntities));

        console.log(`[InitWorld] World Generation Complete. Total Entities: ${entities.length}`);

        return {
            worldState: structure.worldState,
            entities: entities,
            playerCharacterId: structure.playerStub.entity_id
        };

    } catch (error) {
        console.error("[InitWorld] World Generation Failed:", error);
        throw error;
    }
};
