
// ai/mocks.ts

import { Adjudication, Entity, Report, Scheme, SimulationState, StoryRelevance, TurnHistoryEntry, WorldState, EventDelta, EntityStub } from '../types';
import { applyAdjudication, applyDeltas } from './core/engine';

// --- MOCK DATA ---
const MOCK_NEW_MOBSTER: Entity = {
    entity_id: "flavius_fulco",
    name: "Flavius Fulco",
    entity_type: "individual",
    status: "alive",
    position: "Suburra Gang Leader",
    location: "The Suburra",
    personality: { ambition: 8, paranoia: 7, loyalty: 3, cunning: 8, honor: 2 },
    beliefs: ["Coin is the only true emperor.", "Fear is a more reliable tool than loyalty."],
    secrets: ["Owes a debt to a dangerous senator."],
    skills: { oratory: 5, administration: 6, strategy: 4, intrigue: 8 },
    active_scheme: {
        name: "Suburra Supremacy",
        overall_goal: "Consolidate control over the Suburra's criminal underworld.",
        steps: [
            { objective: "Eliminate rival gangs", status: 'in_progress' },
            { objective: "Extort protection money from merchants", status: 'in_progress' },
        ]
    },
    current_state_narrative: "Flavius Fulco, a ruthless and ambitious gang leader, has emerged from the shadows of the Suburra. He sees the city's instability as the perfect opportunity to expand his criminal enterprise.",
    short_term_goals: ["Eliminate rival gangs", "Extort protection money from merchants"],
    long_term_ambitions: ["Become the undisputed crime lord of Rome"],
    resources: { denarii: 15000, gang_members: 50 },
    relationships: {
        "severus_alexander": { entity_id: "severus_alexander", relationship_type: "irrelevance", trust_level: 0, recent_interactions: [] },
        "lycinia_stolo": { entity_id: "lycinia_stolo", relationship_type: "rival", trust_level: -6, recent_interactions: [] }
    },
    visibility_network: ["praetorian_guard", "lycinia_stolo"],
    memories: [],
};


const MOCK_ADJUDICATION: Adjudication = {
  turn: 1,
  entityActions: [
    {
      id: "maximinus_thrax",
      intent: "propaganda",
      target: null,
      notes: "Maximinus Thrax spreads rumors about the Emperor's weakness, boosting his own standing with the troops.",
    },
     {
      id: "severus_alexander",
      intent: "appease_troops",
      target: "praetorian_guard",
      notes: "The Emperor attempts to shore up support with the Praetorians by promising a donative.",
    },
  ],
  deltas: [
    { type: 'resource', key: 'maximinus_thrax:legion_support', delta: 2, reason: 'Successful propaganda campaign.' },
    { type: 'relation', key: 'severus_alexander:maximinus_thrax', delta: -1, reason: 'Slandered by military propaganda.' },
    { type: 'rumor', key: 'severus_alexander', delta: 0.6, reason: 'The Emperor is said to be considering a peaceful tribute to the Germans, angering the legions.' },
    { type: 'relation', key: 'severus_alexander:praetorian_guard', delta: 1, reason: 'Promised a donative.' },
    { type: 'add_region', key: 'Temple of Jupiter', delta: 0, reason: '{"stability":"Stable","controlling_faction":null,"current_events":["Priests conduct rituals to placate the gods amidst the political turmoil."]}' },
  ],
  headlines: ["Discontent grows in the Praetorian Camp as rumors of imperial weakness spread.", "Emperor promises bonus to Praetorian Guard."],
  gm_private: ["The Praetorian Guard's loyalty is wavering more than publicly known.", "Lycinia Stolo's network has been compromised. She is no longer a major player and is being replaced by the more aggressive Flavius Fulco."],
  add_entities: [ MOCK_NEW_MOBSTER ],
  remove_entities: ['lycinia_stolo']
};

const MOCK_NEW_CHARACTER: Entity = {
    entity_id: "lucius_vorenus",
    name: "Lucius Vorenus",
    entity_type: "individual",
    status: "alive",
    position: "Veteran Centurion",
    location: "The Suburra",
    personality: { ambition: 4, paranoia: 6, loyalty: 8, cunning: 5, honor: 9 },
    beliefs: ["The old ways are the best ways.", "A soldier's loyalty is to his legion, then to Rome."],
    secrets: ["Witnessed corruption by a Senator on a past campaign.", "Worries he is no longer fit for the battlefield."],
    skills: { oratory: 4, administration: 3, strategy: 8, intrigue: 2 },
    active_scheme: {
        name: "A Soldier's Honor",
        overall_goal: "Find a worthy leader to restore honor to the military.",
        steps: [
            { objective: "Re-establish contact with old comrades.", status: 'in_progress' },
            { objective: "Assess the worthy and unworthy leaders of Rome.", status: 'in_progress' },
        ]
    },
    current_state_narrative: "A hardened veteran of the Legio II Parthica, Lucius Vorenus is disgusted by the corruption he sees in Rome. Loyal to the old ways, he believes only a strong, honorable leader can save the Empire from itself. He has a small following of loyal legionaries.",
    short_term_goals: ["Re-establish contact with old comrades", "Assess the political situation"],
    long_term_ambitions: ["Restore honor to the military", "Find a worthy leader to serve"],
    resources: { denarii: 5000, deep_analyses: 2, investigations: 3 },
    relationships: {
        "severus_alexander": { entity_id: "severus_alexander", relationship_type: "contempt", trust_level: -5, recent_interactions: [] },
        "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "cautious respect", trust_level: 3, recent_interactions: [] },
        "praetorian_guard": { entity_id: "praetorian_guard", relationship_type: "distrust", trust_level: -4, recent_interactions: [] },
        "roman_senate": { entity_id: "roman_senate", relationship_type: "indifference", trust_level: 0, recent_interactions: [] },
        "julia_mamaea": { entity_id: "julia_mamaea", relationship_type: "distrust", trust_level: -2, recent_interactions: [] },
        "senatorial_party": { entity_id: "senatorial_party", relationship_type: "political rival", trust_level: -1, recent_interactions: [] },
        "military_cabal": { entity_id: "military_cabal", relationship_type: "potential ally", trust_level: 2, recent_interactions: [] }
    },
    visibility_network: ["severus_alexander", "maximinus_thrax", "praetorian_guard"],
    memories: [],
};

const MOCK_CUSTOM_WORLD_STATE: WorldState = {
    year: 122, week: 1, economic_stability: 'Failing', political_climate: 'Oppressive',
    regions: {
        'Eboracum Fortress': { stability: 'Stable', controlling_faction: 'legio_ix_hispana', current_events: ["The Ninth Legion holds the northern frontier against unknown horrors."] },
        'Isurium Brigantum': { stability: 'Unrest', controlling_faction: 'brigantes_tribe', current_events: ["The Brigantes chieftains whisper of ancient pacts and sacrifices."] },
        'Misty Moors': { stability: 'Hostile', controlling_faction: null, current_events: ["Strange beasts and whispers of ancient magic plague the moors."] }
    }
};

const MOCK_CUSTOM_ENTITIES: Entity[] = [
    {
      entity_id: "legatus_draco", name: "Legatus Draco", entity_type: "individual", status: "alive", position: "Commander of the Ninth Legion", location: "Eboracum Fortress",
      short_term_goals: ["Suppress local cults", "Maintain discipline"], long_term_ambitions: ["Survive the winter"],
      current_state_narrative: "A grim, pragmatic commander haunted by the disappearance of patrols in the moors.",
      relationships: { "mock_player_character": { entity_id: "mock_player_character", relationship_type: "subordinate", trust_level: 5, recent_interactions: [] } },
      memories: [], resources: { legionary_support: 70 }, visibility_network: []
    },
    {
      entity_id: "morwen", name: "Morwen", entity_type: "individual", status: "alive", position: "Priestess of the Old Gods", location: "Misty Moors",
      short_term_goals: ["Drive the Romans out"], long_term_ambitions: ["Awaken a slumbering horror"],
      current_state_narrative: "A mysterious figure who commands the loyalty of the local tribes and seems to wield strange powers.",
      relationships: { "mock_player_character": { entity_id: "mock_player_character", relationship_type: "enemy", trust_level: -8, recent_interactions: [] } },
      memories: [], resources: { cultist_followers: 100 }, visibility_network: []
    },
];

const MOCK_PLAYER_IN_CUSTOM_WORLD: Entity = {
    entity_id: "mock_player_character",
    name: "Gaius Vibius",
    entity_type: "individual",
    status: "alive",
    position: "Inquisitor and Exorcist",
    location: "Eboracum Fortress",
    personality: { ambition: 5, paranoia: 8, loyalty: 7, cunning: 6, honor: 6 },
    beliefs: ["The darkness must be fought with iron and faith.", "There are truths man was not meant to know."],
    secrets: ["Haunted by a past failure where he condemned an innocent soul."],
    skills: { oratory: 5, administration: 4, strategy: 6, intrigue: 8 },
    active_scheme: {
        name: "Purge the North",
        overall_goal: "Uncover and destroy the source of the supernatural corruption in Britannia.",
        steps: [{ objective: "Investigate the Misty Moors.", status: 'in_progress' }]
    },
    current_state_narrative: "You are an Inquisitor, sent from Rome to investigate supernatural occurrences on the Britannian frontier. You are a man of faith and steel, but what you find here may test both.",
    short_term_goals: ["Investigate the Misty Moors"],
    long_term_ambitions: ["Destroy the source of the corruption"],
    resources: { denarii: 2000, deep_analyses: 3, investigations: 4 },
    relationships: {
        "legatus_draco": { entity_id: "legatus_draco", relationship_type: "ally", trust_level: 5, recent_interactions: [] },
        "morwen": { entity_id: "morwen", relationship_type: "nemesis", trust_level: -8, recent_interactions: [] }
    },
    visibility_network: ["legatus_draco", "morwen"],
    memories: [],
};


// --- MOCK FUNCTIONS ---

export const mockGenerateScenarioStructure = async (metaNarrative: string, playerCharacterDescription: string): Promise<{ worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[] }> => {
    console.log("--- MOCK SCENARIO STRUCTURE GENERATION ---");
    const playerStub: EntityStub = {
        entity_id: 'mock_player_character',
        name: 'Gaius Vibius',
        entity_type: 'individual',
        position: 'Inquisitor',
        brief_description: 'An inquisitor sent to Britannia.'
    };
    
    const npcStubs: EntityStub[] = [
        {
            entity_id: 'legatus_draco',
            name: 'Legatus Draco',
            entity_type: 'individual',
            position: 'Legion Commander',
            brief_description: 'Commander of the Ninth Legion.'
        },
         {
            entity_id: 'morwen',
            name: 'Morwen',
            entity_type: 'individual',
            position: 'Priestess',
            brief_description: 'Priestess of the Old Gods.'
        }
    ];

    return {
        worldState: MOCK_CUSTOM_WORLD_STATE,
        playerStub,
        npcStubs
    };
}

export const mockGenerateEntitiesDetails = async (worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[]): Promise<Entity[]> => {
    console.log("--- MOCK ENTITY DETAILS GENERATION ---");
    // Return the pre-defined mock entities which match the stubs
    return [...MOCK_CUSTOM_ENTITIES, MOCK_PLAYER_IN_CUSTOM_WORLD];
}

// Deprecated in favor of the 2-step process, but kept for compatibility if needed.
export const mockInitiateWorld = async (metaNarrative: string, playerCharacterDescription: string): Promise<{ worldState: WorldState, entities: Entity[], playerCharacterId: string }> => {
    console.log("--- MOCK WORLD INITIATION (LEGACY) ---");
    const structure = await mockGenerateScenarioStructure(metaNarrative, playerCharacterDescription);
    const entities = await mockGenerateEntitiesDetails(structure.worldState, structure.playerStub, structure.npcStubs);
    return {
        worldState: structure.worldState,
        entities,
        playerCharacterId: structure.playerStub.entity_id,
    };
};

export const mockRunNewTurn = async (
    playerIntent: string,
    playerEntity: Entity,
    turnNumber: number,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    currentReports: Report[],
    gmInterventionText: string,
    metaNarrative: string,
    currentSimulationState: SimulationState
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
}> => {
    console.log("--- MOCK TURN RUN ---");
    console.log("GM Intervention Text:", gmInterventionText);
    console.log("Meta Narrative:", metaNarrative);

    const adjudication = { ...MOCK_ADJUDICATION, turn: turnNumber };
    
    let { updatedEntities, updatedWorldState, updatedReports } = applyAdjudication(adjudication, currentEntities, currentWorldState, currentReports);
    
    // MOCK CONVERSATION SIMULATION
    const npc1 = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');
    const npc2 = updatedEntities.find(e => e.entity_id === 'praetorian_guard');
    if (npc1 && npc2) {
        const conversationResult = await mockSimulatePrivateConversation(npc1, npc2);
        if (conversationResult.deltas.length > 0) {
            const { updatedEntities: entitiesAfter, updatedWorldState: worldStateAfter } = applyDeltas(
                conversationResult.deltas,
                updatedEntities,
                updatedWorldState,
                turnNumber
            );
            updatedEntities = entitiesAfter;
            updatedWorldState = worldStateAfter;
            adjudication.gm_private.push(`[Secret Meeting] ${conversationResult.dialogueSnippet}`);
        }
    }

    const narration = `(Mock Mode) Your action to "${playerIntent}" has been noted. In the city, Maximinus Thrax continues to stir up trouble, spreading rumors about the Emperor's weakness. The mood in the Praetorian Camp grows darker.`;
    
    const suggestedActions = [
        "Mock: Investigate Thrax's rumors",
        "Mock: Send a message to the Senate",
        "Mock: Try to bribe the Praetorians",
    ];

    const playerMonologue = await mockGetPlayerMonologue(playerEntity, MOCK_ADJUDICATION.headlines, [playerIntent]);

    const newHistoryEntry: TurnHistoryEntry = {
        turnNumber,
        playerIntent,
        adjudication,
        narration,
        postTurnEntities: updatedEntities
    };

    return {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState: currentSimulationState,
        updatedReports,
        narration,
        headlines: adjudication.headlines,
        suggestedActions,
        playerMonologue,
        newHistoryEntry,
    };
};

export const mockCreateCharacter = async (description: string): Promise<Entity> => {
    console.log("--- MOCK CHARACTER CREATION ---");
    if(!MOCK_NEW_CHARACTER) throw new Error("Mock for MOCK_NEW_CHARACTER does not exist");
    return { ...MOCK_NEW_CHARACTER, current_state_narrative: `(Mock Character) Based on your description: "${description}", this character was generated.` };
};

export const mockGetClarificationOnEvent = async (event: string, question: string): Promise<string> => {
    console.log("--- MOCK CLARIFICATION ---");
    return `(Mock) Regarding "${event}", the general consensus is that it was orchestrated by a rival faction to sow discord. The motives seem purely political.`;
};

export const mockGetRawThoughts = async (target: Entity): Promise<string> => {
    console.log("--- MOCK RAW THOUGHTS ---");
    return `(Mock) My gut tells me ${target.name} is not to be trusted. They have a serpent's smile. I should watch my back.`;
};

export const mockGetDeepAnalysis = async (target: Entity): Promise<string> => {
    console.log("--- MOCK DEEP ANALYSIS ---");
    return `(Mock Analysis) Our agents report that ${target.name} has been meeting secretly with members of the military. Their stated goals likely hide a more sinister ambition. They pose a moderate threat, but have limited resources for now.`;
};

export const mockGetInvestigationResult = async (target: Entity, isRisky: boolean, subject: 'secrets' | 'beliefs' | 'scheme' = 'secrets'): Promise<{ report: string, consequences: string | null, reportData: any }> => {
    console.log("--- MOCK INVESTIGATION ---");
    
    let reportData: any;
    let reportText: string;

    switch(subject) {
        case 'beliefs':
            reportData = [`(Mock) Believes the army is the only true power in Rome.`, `(Mock) Thinks honor is for fools.`];
            reportText = `We've uncovered some of ${target.name}'s core beliefs. They seem to be a military pragmatist.`;
            break;
        case 'scheme':
            reportData = {
                name: "(Mock) The Thracian Coup",
                overall_goal: "To seize the imperial throne.",
                steps: [
                    { objective: "Undermine the emperor.", status: 'in_progress' },
                    { objective: "Bribe the Praetorians.", status: 'pending' },
                ]
            } as Scheme;
            reportText = `We've confirmed ${target.name}'s active scheme. They are planning a coup.`;
            break;
        case 'secrets':
        default:
             reportData = [`(Mock) Is secretly illiterate.`, `(Mock) Fears assassination from his own men.`];
             reportText = `Our spy discovered that ${target.name} harbors deep-seated fears and hides a surprising vulnerability.`;
             break;
    }

    if (isRisky) {
        return {
            reportData,
            report: reportText,
            consequences: "One of your agents was seen near the target's villa and is now being watched, reducing their effectiveness."
        };
    }
    return {
        reportData,
        report: reportText,
        consequences: null
    };
};

export const mockGetPlayerMonologue = async (player: Entity, turnHeadlines: string[], recentPlayerIntents: string[]): Promise<string> => {
    console.log("--- MOCK PLAYER MONOLOGUE ---");
    const recentActionsSummary = recentPlayerIntents.length > 0 ? `my recent actions (${recentPlayerIntents.join('; ')})` : `my inaction`;
    return `(Mock Monologue) These events... (${turnHeadlines.join(', ')}). Considering ${recentActionsSummary}, a pattern emerges. This plays directly into my hands. If I'm careful, I can use this chaos to my advantage. But I must watch for vipers in the grass.`;
};


export const mockGetStoryRelevance = async (turnNumber: number): Promise<StoryRelevance> => {
    console.log("--- MOCK STORY RELEVANCE ---");
    const relevance: StoryRelevance = {
        spotlight_entities: [
            { entity_id: 'maximinus_thrax', reason: 'His propaganda is causing instability.' },
            { entity_id: 'praetorian_guard', reason: 'Their loyalty is in question and is a major plot point.' }
        ],
        add_entity_suggestion: { description: 'A ruthless Suburra gang leader named Flavius Fulco who sees the chaos as an opportunity.', reason: 'Introduces a criminal element to complicate the political struggle.'},
        remove_entity_suggestion: { entity_id: 'lycinia_stolo', reason: 'Her role as an informant is less critical now that open conflict is brewing.'},
        add_location_suggestion: { name: 'Temple of Jupiter', description: 'The main religious site on the Capitoline Hill.', reason: 'Introduces a religious dimension to the conflict.'},
    };
    return relevance;
};

export const mockSimulatePrivateConversation = async (npc1: Entity, npc2: Entity): Promise<{ dialogueSnippet: string, deltas: EventDelta[] }> => {
    console.log(`--- MOCK SIMULATE CONVERSATION between ${npc1.name} and ${npc2.name} ---`);
    return {
        dialogueSnippet: `(Mock) ${npc1.name} and ${npc2.name} met secretly. ${npc1.name} offered support in exchange for future concessions, and ${npc2.name} tentatively agreed.`,
        deltas: [
            { type: 'relation', key: `${npc1.entity_id}:${npc2.entity_id}:trust_level`, delta: 2, reason: 'Formed a secret pact.' },
            { type: 'resource', key: `${npc1.entity_id}:favor_from_${npc2.entity_id}`, delta: 1, reason: 'Gained a favor during a secret meeting.'}
        ]
    };
};
