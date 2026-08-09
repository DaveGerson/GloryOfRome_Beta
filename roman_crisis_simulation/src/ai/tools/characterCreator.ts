
import { GoogleGenAI } from "@google/genai";
import { Entity } from '../../types';
import { ALL_INITIAL_ENTITIES } from '../../constants/baseScenario';
import { mockCreateCharacter } from "../mocks";
import { generateStructured, GEMINI_PRO } from '../core/geminiService';
import { CharacterCreationEntitySchema } from '../core/schemas';
import { zEntity } from '../core/zodSchemas';
import { buildCharacterCreationPrompt } from '../prompts/characterCreation';

export const createCharacter = async (ai: GoogleGenAI, description: string, isMockMode: boolean): Promise<Entity> => {
    if (import.meta.env.DEV) console.log(`[CharCreator] Starting character creation for: "${description}"`);
    if (isMockMode) {
        if(!mockCreateCharacter) throw new Error("Mock function 'mockCreateCharacter' is not implemented.");
        return mockCreateCharacter(description);
    }

    const { systemInstruction, prompt } = buildCharacterCreationPrompt(description, ALL_INITIAL_ENTITIES);

    if (import.meta.env.DEV) console.log(`[CharCreator] Sending request to Gemini 3.0...`);
    try {
        const character = await generateStructured<Entity>(ai, {
            callName: 'characterCreation',
            model: GEMINI_PRO,
            systemInstruction,
            prompt,
            responseSchema: CharacterCreationEntitySchema,
            zodSchema: zEntity,
            thinkingConfig: { thinkingBudget: 1024 },
        });

        if (import.meta.env.DEV) console.log(`[CharCreator] Character created: ${character.name} (${character.entity_id})`);
        return character;
    } catch (error) {
        console.error(`[CharCreator] Error creating character:`, error);
        throw error;
    }
};
