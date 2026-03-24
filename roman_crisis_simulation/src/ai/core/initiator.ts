
import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, EntityStub } from '../../types';
import { ScenarioStructureSchema, EntityListSchema } from './schemas';
import { mockGenerateScenarioStructure, mockGenerateEntitiesDetails, mockInitiateWorld } from '../mocks';

const cleanJson = (text: string): string => {
    // 1. Remove markdown code blocks if present
    let cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    // 2. Remove generic markdown code blocks
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    
    // 3. aggressively find the outer braces to ignore preamble/postamble text
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    return cleaned;
};

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

    const prompt = `
    You are a world-building Game Master. Step 1: Create the skeleton of a new political simulation.
    
    **Meta-Narrative:** "${metaNarrative}"
    **Player Concept:** "${playerCharacterDescription}"

    **Task:**
    1.  **World State:** Generate a 'WorldState' with 3-4 distinct, thematic regions appropriate for the narrative.
    2.  **Cast List (Stubs):** Identify the key actors.
        - **Player:** One entity must be the player character.
        - **NPCs:** Create 4-6 other key entities (individuals or factions) that will drive the conflict.
        - For each, provide a 'stub': ID, name, position (role/title), and a one-sentence description.
    
    The 'entity_id's must be unique snake_case strings.
    
    **IMPORTANT:** Output ONLY the JSON object. Do not include any conversational text.
    `;

    try {
        console.log(`[InitWorld:Step1] Sending request to Gemini (Budget: 512)...`);
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: ScenarioStructureSchema,
                thinkingConfig: { thinkingBudget: 512 } 
            },
        });
        
        console.log(`[InitWorld:Step1] Response received. Length: ${response.text?.length || 0}`);
        const cleanedText = cleanJson(response.text || "{}");
        const result = JSON.parse(cleanedText);
        
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
    
    const castListContext = allStubs.map(s => `- ${s.name} (${s.entity_id}): ${s.position}. ${s.brief_description}`).join('\n');
    const regionNames = Object.keys(worldState.regions).join(', ');

    const prompt = `
    You are a world-building Game Master. Step 2: Flesh out the characters.

    **Meta-Narrative:** "${metaNarrative}"
    **Regions Available:** ${regionNames}
    
    **Full Cast Context (Use this for relationships):**
    ${castListContext}

    **Task:**
    Generate the FULL 'Entity' objects for ONLY these specific characters: ${targetIds}.
    
    **Requirements:**
    1.  **Match IDs:** You MUST use the exact 'entity_id's provided.
    2.  **Deep Relationships:** Every entity must have a 'relationships' object keyed by the IDs of the OTHER entities in the Full Cast Context.
        - Set 'trust_level' (-10 to 10).
        - Set 'perceived_threat', 'ideological_alignment', 'dependency_level'.
    3.  **Schemes:** Give every entity (except maybe the player) a multi-step 'active_scheme'.
    4.  **Resources:** Create unique, thematic resources.
    5.  **Location:** Place them in one of the regions defined in the World State.
    6.  **Memories:** Start with empty arrays.

    **CRITICAL OUTPUT RULES:**
    - Output pure JSON only. 
    - **DO NOT REPEAT** the Cast Context or the inputs in your response logic. 
    - **DO NOT** output entities that were not requested in the "Task" list.
    `;

    try {
        console.log(`[InitWorld:Step2:${batchName}] Sending request to Gemini (Budget: ${budget})...`);
        const start = Date.now();
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: EntityListSchema,
                thinkingConfig: { thinkingBudget: budget }
            },
        });
        const duration = Date.now() - start;
        console.log(`[InitWorld:Step2:${batchName}] Request complete in ${duration}ms. Text Length: ${response.text?.length || 0}`);

        if (!response.text) {
            throw new Error(`Empty response text for batch ${batchName}`);
        }
        
        const cleanedText = cleanJson(response.text);
        const result = JSON.parse(cleanedText);
        
        if (!result.entities || !Array.isArray(result.entities)) {
             throw new Error(`Invalid JSON structure for batch ${batchName}: missing 'entities' array.`);
        }

        console.log(`[InitWorld:Step2:${batchName}] Successfully generated ${result.entities.length} entities.`);
        return result.entities;
    } catch (e) {
        console.error(`[InitWorld:Step2:${batchName}] Failed:`, e);
        // Log the first 500 chars of response to see what went wrong if it's not empty
        if (e instanceof SyntaxError) {
             console.error(`[InitWorld:Step2:${batchName}] JSON Syntax Error. Cleaned text snippet:`, e.message);
        }
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

        // Step 3: Generate NPCs in small batches to avoid timeouts and output limits
        const chunkSize = 2; // Process 2 NPCs at a time
        for (let i = 0; i < structure.npcStubs.length; i += chunkSize) {
            const batchStubs = structure.npcStubs.slice(i, i + chunkSize);
            const batchName = `NPCs_${Math.floor(i/chunkSize) + 1}`;
            
            const npcEntities = await generateEntityBatch(
                ai, 
                batchStubs, 
                allStubs, 
                metaNarrative, 
                structure.worldState, 
                batchName, 
                512 
            );
            entities.push(...npcEntities);
        }

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
