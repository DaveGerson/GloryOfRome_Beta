import { GoogleGenAI, Type } from "@google/genai";
import { Entity, WorldState, StoryRelevance, Scheme, Adjudication, SimulationState, EventDelta } from '../../types';
import { mockGetClarificationOnEvent, mockGetRawThoughts, mockGetDeepAnalysis, mockGetInvestigationResult, mockGetPlayerMonologue, mockGetStoryRelevance, mockSimulatePrivateConversation } from '../mocks';
import { RelationshipDeltasSchema, ConversationSimulationSchema } from '../core/schemas';
import { parseModelJson } from '../core/json';

export const getClarificationOnEvent = async (ai: GoogleGenAI, event: string, question: string, player: Entity, allEntities: Entity[], isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetClarificationOnEvent) throw new Error("Mock function 'mockGetClarificationOnEvent' is not implemented.");
        return mockGetClarificationOnEvent(event, question);
    }
    const entitiesInEvent = allEntities.filter(e => event.toLowerCase().includes(e.name.toLowerCase()));
    const isVisible = entitiesInEvent.every(e => player.visibility_network.includes(e.entity_id) || e.entity_id === player.entity_id);

    const prompt = `You are a spymaster's aide in ancient Rome. Your master, ${player.name}, has asked for clarification on a recent event.
    
    **Event:** "${event}"
    **Question:** "${question}"

    **Your Master's Knowledge:** Your master has direct knowledge of these entities: ${player.visibility_network.join(', ')}.
    
    **Task:** Based on your master's knowledge, provide an answer.
    - If the key players in the event are visible to your master (${isVisible}), provide a confident, detailed answer.
    - If they are not visible, provide a vague, rumor-based answer reflecting your limited intelligence.
    `;

    const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
    return response.text || "No response generated.";
};

export const getRawThoughts = async (ai: GoogleGenAI, target: Entity, player: Entity, isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetRawThoughts) throw new Error("Mock function 'mockGetRawThoughts' is not implemented.");
        return mockGetRawThoughts(target);
    }
    const isVisible = player.visibility_network.includes(target.entity_id);
    const prompt = `You are the inner monologue of ${player.name}, a ${player.position} in ancient Rome. You are contemplating another character: ${target.name}. Your network: [${player.visibility_network.join(', ')}].
    Task: If you **know** the target (${isVisible}), provide your personal, unfiltered thoughts. If you **do not know** them (${!isVisible}), provide thoughts based on their public reputation. Keep it concise and first-person.`;
    const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
    return response.text || "I have no thoughts on this.";
};

export const getDeepAnalysis = async (ai: GoogleGenAI, target: Entity, player: Entity, isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetDeepAnalysis) throw new Error("Mock function 'mockGetDeepAnalysis' is not implemented.");
        return mockGetDeepAnalysis(target);
    }
     const isVisible = player.visibility_network.includes(target.entity_id);
     const prompt = `You are a trusted advisor to ${player.name}. Task: Provide a detailed intelligence report on ${target.name}.
    - If the target is in your network (${isVisible}), provide concrete intelligence and assess their threat level.
    - If they are outside your network (${!isVisible}), report on limited information and emphasize them as an "unknown variable".`;
    const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
    return response.text || "Intelligence unavailable.";
};

export const getInvestigationResult = async (ai: GoogleGenAI, target: Entity, player: Entity, isRisky: boolean, isMockMode: boolean, subject: 'secrets' | 'beliefs' | 'scheme' = 'secrets'): Promise<{ report: string, consequences: string | null, reportData: any }> => {
    if (isMockMode) {
        if(!mockGetInvestigationResult) throw new Error("Mock function 'mockGetInvestigationResult' is not implemented.");
        return mockGetInvestigationResult(target, isRisky, subject);
    }
    
    const schemeSchema = {
        type: Type.OBJECT,
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
    
    const subjectSchema = subject === 'scheme' ? schemeSchema : { type: Type.ARRAY, items: { type: Type.STRING } };
    
    const investigationSchema = {
        type: Type.OBJECT,
        properties: {
            reportData: subjectSchema,
            report: { type: Type.STRING, description: "The narrative intelligence report summarizing the findings." },
            consequences: { type: Type.STRING, nullable: true, description: "Negative consequences of the investigation. If none, return null." }
        },
        required: ['reportData', 'report', 'consequences']
    };

    const prompt = `You are the head of intelligence for ${player.name}. You completed an investigation into ${target.name} to uncover their **${subject}**.

    **Target Profile:**
    - Name: ${target.name}
    - Position: ${target.position}
    - Personality: Ambition(${target.personality?.ambition}), Paranoia(${target.personality?.paranoia}), Loyalty(${target.personality?.loyalty}), Cunning(${target.personality?.cunning}), Honor(${target.personality?.honor})
    - Known Goals: ${target.short_term_goals.join(', ')}

    **Task:** Generate a JSON object with the results.
    1.  **reportData:** Based on the target's profile, generate a plausible list of ${subject} (or a full Scheme object if the subject is 'scheme'). This is the raw data.
    2.  **report:** Write a brief, narrative report for your master summarizing what you found.
    3.  **consequences:** If the investigation has a chance of failure (paranoia > 6 or cunning > 6), there's a 40% chance of a negative consequence. Otherwise, return null. The consequence should be a short string describing the negative outcome (e.g., 'Your agent was spotted').

    **CRITICAL JSON FORMATTING RULES:**
    Your response MUST be a perfectly valid JSON object that adheres to the schema.
    - **Escape All Quotes:** Inside any string value, every double quote (") MUST be escaped (\\").
    - **No Trailing Commas.**`;
    
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview", 
        contents: prompt, 
        config: { 
            responseMimeType: "application/json", 
            responseSchema: investigationSchema,
            thinkingConfig: { thinkingBudget: 512 }
        }
    });
    const result = parseModelJson<{ report: string, consequences: string | null, reportData: any }>(response.text || "{}");
    return { report: result.report, consequences: result.consequences, reportData: result.reportData };
};

export const getPlayerMonologue = async (ai: GoogleGenAI, player: Entity, turnHeadlines: string[], recentPlayerIntents: string[], isMockMode: boolean): Promise<string> => {
    if (isMockMode) {
        if(!mockGetPlayerMonologue) throw new Error("Mock function 'mockGetPlayerMonologue' is not implemented.");
        return mockGetPlayerMonologue(player, turnHeadlines, recentPlayerIntents);
    }

    const recentActionsString = recentPlayerIntents.length > 0
        ? recentPlayerIntents.map((intent, i) => `${i + 1}. "${intent}"`).join('\n')
        : "No significant actions have been taken yet.";

    const prompt = `
    You are the inner voice of ${player.name}, a ${player.position} in ancient Rome.
    Your personality is defined by: Ambition(${player.personality?.ambition}), Paranoia(${player.personality?.paranoia}), Loyalty(${player.personality?.loyalty}), Cunning(${player.personality?.cunning}), Honor(${player.personality?.honor}).
    Your current state is: "${player.current_state_narrative}"

    The following events just occurred this week:
    - ${turnHeadlines.join('\n- ')}

    Here is a summary of your strategic actions over the last few weeks:
    ${recentActionsString}

    Task: Write a brief, first-person internal monologue (2-3 sentences). Do NOT simply state your goals. Instead, reflect on your recent strategy.
    - Consider the risks of your current path. Are you making powerful enemies? Are you over-extending yourself?
    - Contemplate the long-term consequences of your actions. Is your strategy working? Do you need to change course?
    - Your thoughts should be personal and strategic, revealing fears, hopes, or schemes based on the new events and your past choices.
    `;

    const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
    return response.text || "I am contemplative.";
};

export const getStoryRelevance = async (ai: GoogleGenAI, turnNumber: number, prevTurnHeadlines: string[], worldState: WorldState, isMockMode: boolean): Promise<StoryRelevance> => {
    if (isMockMode) {
        if (!mockGetStoryRelevance) throw new Error("Mock function 'mockGetStoryRelevance' is not implemented.");
        return mockGetStoryRelevance(turnNumber);
    }
    
    const storyRelevanceSchema = {
        type: Type.OBJECT,
        properties: {
            spotlight_entities: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        entity_id: { type: Type.STRING },
                        reason: { type: Type.STRING }
                    },
                    required: ['entity_id', 'reason']
                }
            },
            add_entity_suggestion: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                    description: { type: Type.STRING, description: "A detailed description of the new entity to be created." },
                    reason: { type: Type.STRING, description: "Why this entity should be added now." }
                },
                required: ['description', 'reason']
            },
            remove_entity_suggestion: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                    entity_id: { type: Type.STRING, description: "The ID of the entity to remove." },
                    reason: { type: Type.STRING, description: "Why this entity should be removed now." }
                },
                required: ['entity_id', 'reason']
            },
            add_location_suggestion: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                    name: { type: Type.STRING, description: "The name of the new location." },
                    description: { type: Type.STRING, description: "A brief description of the new location." },
                    reason: { type: Type.STRING, description: "Why this location should be added now." }
                },
                required: ['name', 'description', 'reason']
            },
            remove_location_suggestion: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                    name: { type: Type.STRING, description: "The name of the location to remove." },
                    reason: { type: Type.STRING, description: "Why this location should be removed now." }
                },
                required: ['name', 'reason']
            }
        },
        required: ['spotlight_entities']
    };

    const prompt = `
    You are a master storyteller and game master for a Roman political simulation.
    It is currently Turn ${turnNumber}. The political climate is ${worldState.political_climate}.
    
    Last turn's major events were:
    - ${prevTurnHeadlines.length > 0 ? prevTurnHeadlines.join('\n- ') : "The city was quiet."}
    
    Task: Analyze the situation and determine the narrative focus for the upcoming turn.
    1.  **Spotlight Entities:** Identify 2-4 existing entities who are now critically important. Provide a brief reason for each.
    2.  **Evolve The World (Optional):** To keep the story fresh, consider if the cast or setting should change.
        - **Add Entity?** Is there a new character archetype missing that would create compelling conflict? (e.g., a populist tribune, a foreign envoy, a ruthless crime boss). If so, suggest adding ONE.
        - **Remove Entity?** Has an existing character become irrelevant or served their purpose? If so, suggest removing ONE to streamline the story.
        - **Add Location?** Would a new location open up strategic or narrative possibilities? (e.g., 'The Temple of Vesta', 'A Hidden Catacomb'). If so, suggest adding ONE.
        - **Remove Location?** Has a location become unimportant? If so, suggest removing ONE.
    
    Only suggest additions or removals if they would significantly improve the narrative. Otherwise, leave these fields null. Limit suggestions to a maximum of one of each type.

    Return a valid JSON object matching the schema.
    `;
    
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview", 
        contents: prompt, 
        config: { 
            responseMimeType: "application/json", 
            responseSchema: storyRelevanceSchema,
            thinkingConfig: { thinkingBudget: 512 }
        }
    });
    
    return parseModelJson<StoryRelevance>(response.text || "{}");
};

export const getUpdatedSimulationState = async (ai: GoogleGenAI, adjudication: Adjudication, oldState: SimulationState, isMockMode: boolean): Promise<SimulationState> => {
    if (isMockMode) return oldState;

    const simulationStateSchema = {
        type: Type.OBJECT,
        properties: {
            imperial_status: { type: Type.STRING, enum: ['Stable', 'Contested', 'Vacant'] },
            senate_status: { type: Type.STRING, enum: ['Ascendant', 'Functional', 'Deposed', 'Irrelevant'] },
            military_status: { type: Type.STRING, enum: ['Loyal', 'Divided', 'Rebellious'] },
            plebeian_mood: { type: Type.STRING, enum: ['Content', 'Uneasy', 'Rioting'] },
            major_ongoing_crisis: { type: Type.STRING, nullable: true },
        },
        required: ['imperial_status', 'senate_status', 'military_status', 'plebeian_mood', 'major_ongoing_crisis']
    };

    const prompt = `
You are a Roman historian analyzing the state of the Empire. Based on the previous state and the summary of events that just occurred, update the meta-narrative state of the simulation.

**Previous State:**
${JSON.stringify(oldState, null, 2)}

**Events of This Week (Adjudication):**
- Headlines: ${adjudication.headlines.join('. ')}
- Key Deltas: ${adjudication.deltas.slice(0, 5).map(d => `${d.type} on ${d.key} because ${d.reason}`).join('; ')}

**Your Task:**
Return a new, updated JSON object reflecting the current reality.
- If an emperor was killed, imperial_status MUST become 'Vacant' and a 'Succession Crisis' should begin.
- If legions are openly fighting, military_status MUST become 'Rebellious' and a 'Civil War' crisis should begin.
- If the senate was purged or its power broken, senate_status could become 'Deposed' or 'Irrelevant'.
- If events caused mass unrest (e.g., grain shortage), plebeian_mood could become 'Rioting'.

Return only the valid JSON object.
`;
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt, 
        config: {
            responseMimeType: "application/json", 
            responseSchema: simulationStateSchema,
            thinkingConfig: { thinkingBudget: 512 }
        }
    });

    return parseModelJson<SimulationState>(response.text || "{}");
};

export const getRelationshipUpdates = async (ai: GoogleGenAI, narration: string, headlines: string[], entities: Entity[], isMockMode: boolean): Promise<EventDelta[]> => {
    if (isMockMode) {
        return Promise.resolve([]);
    }
    
    const entityBriefs = entities
        .filter(e => e.status === 'alive')
        .map(e => {
            const rels = Object.entries(e.relationships)
                .filter(([_, rel]) => rel) // Add a filter to remove null or undefined relationships
                .map(([id, rel]) => {
                    const targetName = entities.find(t => t.entity_id === id)?.name || id;
                    return `${targetName}(T:${rel.trust_level}, Th:${rel.perceived_threat ?? 0})`;
                }).join(', ');
            return `- ${e.name} (ID: ${e.entity_id}). Relationships: ${rels || 'None'}`;
        }).join('\n');

    const prompt = `
    You are a narrative analyst AI. Your task is to read a summary of events and identify subtle shifts in relationships between characters. Based on the events, suggest specific, numerical changes to their relationship stats.

    **Current Character Relationships:**
    ${entityBriefs}

    **Events of the Turn:**
    Headlines:
    - ${headlines.join('\n- ')}
    
    Narration:
    "${narration}"

    **Task:**
    Based *only* on the events described above, generate a list of 'relation' deltas to reflect how the characters' feelings towards each other might have changed.
    - Only generate deltas for relationships that were directly or strongly implicitly affected by the events.
    - The 'key' for a relation delta MUST be in the format 'entity_a_id:entity_b_id:attribute'. Valid attributes are 'trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'.
    - A delta changes entity_a's perception of entity_b ONLY (relationships are asymmetric). If both characters' feelings changed, emit two deltas — one per direction. The two directions need not be equal.
    - 'delta' should be a small integer, typically between -3 and 3, representing the change.
    - 'reason' should be a brief justification citing the event from the narration.
    - If no relationships were significantly affected, return an empty list for 'deltas'.

    Return a valid JSON object matching the schema.
    `;

    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: RelationshipDeltasSchema,
            thinkingConfig: { thinkingBudget: 512 }
        },
    });

    const result = parseModelJson<{ deltas: EventDelta[] }>(response.text || "{}");
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

    const prompt = `
    You are a secret observer in a Roman political simulation, reporting on clandestine meetings.
    Two characters, ${npc1.name} and ${npc2.name}, have met in secret this week.

    **Character Profiles:**
    - ${npc1.name} (${npc1.position}): Goals: ${npc1.short_term_goals.join(', ')}. Personality: Ambition(${npc1.personality?.ambition}), Cunning(${npc1.personality?.cunning}), Loyalty(${npc1.personality?.loyalty}).
    - ${npc2.name} (${npc2.position}): Goals: ${npc2.short_term_goals.join(', ')}. Personality: Ambition(${npc2.personality?.ambition}), Cunning(${npc2.personality?.cunning}), Loyalty(${npc2.personality?.loyalty}).
    
    **Context: Events of the Week**
    - Headlines: ${adjudication.headlines.join('. ')}
    - Player Action Summary: A player character took an action that resulted in these events.

    **Task:**
    Simulate the outcome of their private conversation. What did they discuss? Did they form an alliance, betray one another, or exchange secrets?
    1.  **dialogueSnippet:** Write a short, third-person summary of their conversation for the Game Master's log.
    2.  **deltas:** Generate 1-3 'EventDelta' objects that mechanically represent the outcome. This could be changing their 'trust_level' or 'perceived_threat' towards each other, or creating a new 'resource' like 'blackmail_on_${npc1.entity_id}'.

    Return a valid JSON object matching the schema.
    `;

    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: ConversationSimulationSchema,
            thinkingConfig: { thinkingBudget: 512 }
        },
    });

    return parseModelJson<{ dialogueSnippet: string, deltas: EventDelta[] }>(response.text || "{}");
};