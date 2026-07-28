
import {
    mockRunNewTurn,
    mockCreateCharacter,
    mockGetClarificationOnEvent,
    mockGetDeepAnalysis,
    mockGetInvestigationResult,
    mockGetPlayerMonologue,
    mockGetStoryRelevance,
    mockInitiateWorld,
    mockGenerateScenarioStructure,
    mockGenerateEntitiesDetails
} from '../ai/mocks';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';

/**
 * Runs a "smoke test" on application startup to validate that all mock functions
 * are working as expected after any system changes. This helps catch integration
 * issues or breaking changes in mock data structures early.
 */
export const runSmokeTest = async () => {
    console.log('%c[SMOKE TEST] Starting validation of mock functions...', 'color: blue; font-weight: bold;');
    
    // An array of test cases, each with a name and a function to execute.
    const testCases: { name: string, fn: () => Promise<unknown> }[] = [
        {
            name: 'mockRunNewTurn',
            fn: async () => {
                const player = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'severus_alexander');
                if (!player) throw new Error("Setup failed: Player 'severus_alexander' not found in mock data.");
                return mockRunNewTurn(
                    'Test player intent',
                    player,
                    1,
                    [...ALL_INITIAL_ENTITIES],
                    {...INITIAL_WORLD_STATE},
                    [],
                    'Test GM intervention',
                    'Test meta narrative theme',
                    {...INITIAL_SIMULATION_STATE}
                );
            }
        },
        {
            name: 'mockCreateCharacter',
            fn: () => mockCreateCharacter('A brave centurion from the northern frontier.')
        },
        {
            name: 'mockGetClarificationOnEvent',
            fn: () => mockGetClarificationOnEvent('A riot in the Suburra', 'Who was responsible?')
        },
        {
            name: 'mockGetDeepAnalysis',
            fn: () => {
                 const target = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax');
                 if (!target) throw new Error("Setup failed: Target 'maximinus_thrax' not found for getDeepAnalysis.");
                 return mockGetDeepAnalysis(target);
            }
        },
        {
            name: 'mockGetInvestigationResult (secrets)',
            fn: () => {
                 const target = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax');
                 if (!target) throw new Error("Setup failed: Target 'maximinus_thrax' not found for getInvestigationResult.");
                 return mockGetInvestigationResult(target, true, 'secrets');
            }
        },
        {
            name: 'mockGetInvestigationResult (scheme)',
            fn: () => {
                 const target = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax');
                 if (!target) throw new Error("Setup failed: Target 'maximinus_thrax' not found for getInvestigationResult.");
                 return mockGetInvestigationResult(target, false, 'scheme');
            }
        },
        {
            name: 'mockGetPlayerMonologue',
            fn: () => {
                const player = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'severus_alexander');
                if (!player) throw new Error("Setup failed: Player 'severus_alexander' not found for getPlayerMonologue.");
                return mockGetPlayerMonologue(player, ['The city is on edge.', 'A rival makes a bold move.'], ['Tried to host a banquet', 'Sent a threatening message']);
            }
        },
        {
            name: 'mockGetStoryRelevance',
            fn: () => mockGetStoryRelevance(2)
        },
        {
            name: 'mockGenerateScenarioStructure',
            fn: async () => {
                const result = await mockGenerateScenarioStructure('Gothic Horror', 'Inquisitor');
                if (!result.worldState || !result.playerStub || !result.npcStubs) {
                     throw new Error("mockGenerateScenarioStructure result missing required fields.");
                }
                return result;
            }
        },
        {
            name: 'mockGenerateEntitiesDetails',
            fn: async () => {
                const structure = await mockGenerateScenarioStructure('Gothic Horror', 'Inquisitor');
                const result = await mockGenerateEntitiesDetails(structure.worldState, structure.playerStub, structure.npcStubs);
                if (!Array.isArray(result) || result.length === 0) {
                     throw new Error("mockGenerateEntitiesDetails result is empty or invalid.");
                }
                return result;
            }
        },
        {
            name: 'mockInitiateWorld',
            fn: async () => {
                const result = await mockInitiateWorld('A gothic horror story on the Roman frontier.', 'An inquisitor sent to investigate strange happenings.');
                // Add strict validation for world generation structure
                if (!result.worldState || !result.entities || !result.playerCharacterId) {
                    throw new Error("mockInitiateWorld result is missing required fields (worldState, entities, or playerCharacterId).");
                }
                if (!Array.isArray(result.entities) || result.entities.length === 0) {
                    throw new Error("mockInitiateWorld returned no entities.");
                }
                const player = result.entities.find(e => e.entity_id === result.playerCharacterId);
                if (!player) {
                    throw new Error("mockInitiateWorld player character ID not found in entities list.");
                }
                console.log(`[SMOKE TEST] mockInitiateWorld validated: Generated ${result.entities.length} entities.`);
                return result;
            }
        },
    ];

    // Execute all test cases sequentially.
    for (const test of testCases) {
        console.log(`[SMOKE TEST] Executing: ${test.name}...`);
        try {
            const result = await test.fn();
            // A simple check to ensure the mock function returned something.
            if (result === undefined || result === null) {
                 throw new Error(`Returned null or undefined.`);
            }
            console.log(`[SMOKE TEST] ✅ PASSED: ${test.name}`);
        } catch (error) {
            console.error(`[SMOKE TEST] ❌ FAILED: ${test.name}`, error);
            // Re-throw a more informative error to be caught by the main app.
            throw new Error(`[SMOKE TEST] The application is not a passing build. Mock function '${test.name}' failed. See console for details.`, { cause: error });
        }
    }

    console.log('%c[SMOKE TEST] All mock functions validated successfully. Build is stable.', 'color: green; font-weight: bold;');
};
