import { GoogleGenAI, Type } from "@google/genai";
import { Entity, Scheme } from '../../types';
import { ALL_INITIAL_ENTITIES } from '../../constants/baseScenario';
import { mockCreateCharacter } from "../mocks";
import { parseModelJson } from '../core/json';

export const createCharacter = async (ai: GoogleGenAI, description: string, isMockMode: boolean): Promise<Entity> => {
    console.log(`[CharCreator] Starting character creation for: "${description}"`);
    if (isMockMode) {
        if(!mockCreateCharacter) throw new Error("Mock function 'mockCreateCharacter' is not implemented.");
        return mockCreateCharacter(description);
    }
    
    const relationshipProperty = {
        type: Type.OBJECT,
        properties: {
            entity_id: { type: Type.STRING },
            relationship_type: { type: Type.STRING },
            trust_level: { type: Type.NUMBER, description: "From -10 to 10" },
            respect_level: { type: Type.NUMBER, nullable: true, description: "Range -10 to 10. How much this new character respects the other." },
            perceived_threat: { type: Type.NUMBER, nullable: true, description: "Range 0-10. How threatening this entity is perceived to be." },
            ideological_alignment: { type: Type.NUMBER, nullable: true, description: "Range -10 to 10. How aligned their beliefs are." },
            dependency_level: { type: Type.NUMBER, nullable: true, description: "Range 0-10. How much this new character depends on the other." },
            recent_interactions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Should be an empty array." }
        },
        required: ['entity_id', 'relationship_type', 'trust_level', 'recent_interactions']
    };

    const schemeSchema = {
        type: Type.OBJECT,
        description: "A multi-step plan the character is pursuing.",
        properties: {
            name: { type: Type.STRING },
            overall_goal: { type: Type.STRING },
            steps: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        objective: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ['pending', 'in_progress', 'completed', 'failed'] }
                    },
                    required: ['objective', 'status']
                }
            }
        },
        required: ['name', 'overall_goal', 'steps']
    };

    const entitySchema = {
        type: Type.OBJECT,
        properties: {
            entity_id: { type: Type.STRING, description: "A unique snake_case version of the character's name." },
            name: { type: Type.STRING, description: "The character's full name." },
            entity_type: { type: Type.STRING, description: "Should be 'individual'." },
            status: { type: Type.STRING, description: "Should be 'alive'." },
            position: { type: Type.STRING, description: "The character's job or title." },
            location: { type: Type.STRING, description: "The character's starting location from this list: Palatine Hill, The Curia, Praetorian Camp, The Suburra." },
            faction_id: { type: Type.STRING, description: "Optional. Assign to 'senatorial_party' or 'military_cabal' if appropriate, otherwise omit." },
            personality: {
                type: Type.OBJECT,
                properties: {
                    ambition: { type: Type.NUMBER },
                    paranoia: { type: Type.NUMBER },
                    loyalty: { type: Type.NUMBER },
                    cunning: { type: Type.NUMBER },
                    honor: { type: Type.NUMBER },
                },
                required: ['ambition', 'paranoia', 'loyalty', 'cunning', 'honor']
            },
            beliefs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 2-3 core beliefs or ideologies." },
            secrets: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-2 hidden secrets or fears." },
            skills: {
                type: Type.OBJECT,
                properties: {
                    oratory: { type: Type.NUMBER },
                    administration: { type: Type.NUMBER },
                    strategy: { type: Type.NUMBER },
                    intrigue: { type: Type.NUMBER },
                },
                description: "A rating of skills from 1-10."
            },
            current_state_narrative: { type: Type.STRING, description: "A rich, third-person description of the character." },
            short_term_goals: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-3 immediate goals." },
            long_term_ambitions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 1-2 long-term ambitions." },
            active_scheme: schemeSchema,
            resources: { 
                type: Type.OBJECT, 
                properties: { 
                    denarii: { type: Type.NUMBER, nullable: true }, 
                    deep_analyses: { type: Type.NUMBER, nullable: true }, 
                    investigations: { type: Type.NUMBER, nullable: true } 
                },
                additionalProperties: { oneOf: [{ type: Type.STRING }, { type: Type.NUMBER }, { type: Type.ARRAY, items: { type: Type.STRING } }] },
                description: "Starting resources. Include denarii, deep_analyses, and investigations. Be creative with additional thematic resources." 
            },
            relationships: {
                type: Type.OBJECT,
                description: "Initial relationships with existing entities. The key must be the entity_id.",
                properties: { "severus_alexander": relationshipProperty, "maximinus_thrax": relationshipProperty, "praetorian_guard": relationshipProperty, "roman_senate": relationshipProperty, "julia_mamaea": relationshipProperty, "senatorial_party": relationshipProperty, "military_cabal": relationshipProperty }
            },
            visibility_network: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of entity_ids the character knows about." },
            memories: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Should be an empty array." }
        },
        required: ['entity_id', 'name', 'entity_type', 'status', 'position', 'location', 'personality', 'beliefs', 'secrets', 'skills', 'current_state_narrative', 'short_term_goals', 'long_term_ambitions', 'active_scheme', 'resources', 'relationships', 'visibility_network', 'memories']
    };

    const existingEntitiesString = ALL_INITIAL_ENTITIES.map(e => `- ${e.name} (${e.position || e.entity_type}, ID: ${e.entity_id})`).join('\n');
    const prompt = `You are a game master for a political simulation game set in Rome, 235 CE. A player wants to create a custom character. Based on their description, generate a complete JSON object for this new character that fits into the existing world.

**Player's Description:**
"${description}"

**Existing Major Factions/Characters in the world:**
${existingEntitiesString}

**Instructions:**
1. Create a complete JSON object matching the provided schema.
2. The 'entity_id' must be a unique, snake_case version of the character's name.
3. The 'current_state_narrative' should be a rich, third-person description based on the player's input.
4. Set plausible 'short_term_goals' and 'long_term_ambitions'.
5. Generate an 'active_scheme' that represents their main underlying plan. It should be a multi-step plan with a clear goal.
6. Generate balanced starting 'resources'. Be creative beyond just 'denarii'. Include unique assets, influence, or knowledge that fit their backstory (e.g., 'favor_from_praefect', 'hidden_cache_of_weapons').
7. Establish initial 'relationships' with all key entities and factions listed above. This MUST include not just 'trust_level', but also plausible starting values for 'respect_level', 'perceived_threat', 'ideological_alignment', and 'dependency_level'.
8. Assign a faction_id if their description strongly suggests allegiance, otherwise leave them independent.
9. The 'visibility_network' should include entities they would likely know about.
10. Define their 'personality' traits on a scale of 1-10.
11. Create plausible 'beliefs', 'secrets', and 'skills' that match their description.
12. The 'memories' array must be present and empty.

**CRITICAL JSON FORMATTING RULES:**
Your response MUST be a perfectly valid JSON object that adheres to the schema. Ensure all quotes inside strings are escaped (e.g., \\"). Do not use trailing commas.`;

    console.log(`[CharCreator] Sending request to Gemini 3.0...`);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: entitySchema,
                thinkingConfig: { thinkingBudget: 1024 }
            },
        });
        
        console.log(`[CharCreator] Response received.`);

        if (!response.text) {
             throw new Error("Empty response from AI for character creation.");
        }
        
        const character = parseModelJson<Entity>(response.text);
        console.log(`[CharCreator] Character created: ${character.name} (${character.entity_id})`);
        return character;
    } catch (error) {
        console.error(`[CharCreator] Error creating character:`, error);
        throw error;
    }
};