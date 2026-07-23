/**
 * tests/initiator.test.ts
 *
 * Characterization tests for ai/core/initiator.ts's REAL (non-mock)
 * orchestration - `generateScenarioStructure` (Step 1: world/cast skeleton)
 * and `initiateWorld` (Step 1 + Step 2: full entity generation). Both route
 * every Gemini call through `ai/core/geminiService.ts::generateStructured`,
 * so this file scripts a fake `GoogleGenAI` client (same pattern as
 * tests/turnPipeline.test.ts) and asserts on the orchestrator's actual
 * outputs - not merely on how many times the fake was called.
 *
 * Calls are classified by their (stable, distinct-per-callsite)
 * systemInstruction text - see ai/prompts/worldGen.ts - and entity-batch
 * calls are further keyed by the target entity_ids named in the prompt
 * ("...specific characters: <ids>"), since Step 2 issues one call for the
 * player and one per NPC batch.
 */
import { describe, it, expect, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { generateScenarioStructure, initiateWorld } from '../ai/core/initiator';
import { zWorldState, zEntity } from '../ai/core/zodSchemas';

// --- fixtures ------------------------------------------------------------

const validWorldState = {
  year: 1,
  week: 3,
  economic_stability: 'Stable',
  political_climate: 'Tense',
  regions: {
    Rome: { stability: 'Stable', controlling_faction: 'Senate', current_events: [] },
    Britannia: { stability: 'Unstable', controlling_faction: null, current_events: ['An uprising brews in the north.'] },
  },
};

const playerStub = {
  entity_id: 'player_1',
  name: 'Gaius Testus',
  entity_type: 'individual',
  position: 'Junior Senator',
  brief_description: 'An ambitious newcomer to the Senate.',
};

const npcStubs = [
  {
    entity_id: 'npc_rival',
    name: 'Senator Rival',
    entity_type: 'individual',
    position: 'Senior Senator',
    brief_description: 'An entrenched political rival.',
  },
  {
    entity_id: 'npc_general',
    name: 'General Draco',
    entity_type: 'individual',
    position: 'Legion Commander',
    brief_description: 'Commander of the Ninth Legion.',
  },
];

const validStructureJson = JSON.stringify({ worldState: validWorldState, playerStub, npcStubs });

// Structurally valid JSON, but missing the required 'npcStubs' contract
// field entirely - the "intentionally incomplete" negative-control fixture.
const incompleteStructureJson = JSON.stringify({ worldState: validWorldState, playerStub });

// Not valid JSON at all (truncated mid-object, no closing brace) - fails at
// parseModelJson (ai/core/json.ts), before zod ever sees it.
const malformedChunk = '```json\n{ "worldState": { "year": 1, "week": 3, "economic_stability": "Stable"';

const validPlayerEntityJson = JSON.stringify({
  entities: [
    {
      entity_id: 'player_1',
      name: 'Gaius Testus',
      entity_type: 'individual',
      status: 'alive',
      location: 'Rome',
      relationships: {
        npc_rival: { entity_id: 'npc_rival', relationship_type: 'rival', trust_level: -4, recent_interactions: [] },
        npc_general: { entity_id: 'npc_general', relationship_type: 'ally', trust_level: 5, recent_interactions: [] },
      },
      memories: [],
      resources: { denarii: 800 },
      visibility_network: ['npc_rival', 'npc_general'],
      current_state_narrative: 'Newly seated in the Senate, wary of rivals.',
      short_term_goals: ['Secure the grain commission'],
      long_term_ambitions: ['Ascend to Consul'],
      voice: 'Measured, careful oratory; avoids overcommitting.',
      epithet: 'the Prudent',
    },
  ],
});

const validNpcBatchJson = JSON.stringify({
  entities: [
    {
      entity_id: 'npc_rival',
      name: 'Senator Rival',
      entity_type: 'individual',
      status: 'alive',
      location: 'Rome',
      relationships: {
        player_1: { entity_id: 'player_1', relationship_type: 'rival', trust_level: -4, recent_interactions: [] },
      },
      memories: [],
      resources: { denarii: 1200 },
      visibility_network: ['player_1'],
      current_state_narrative: 'Watches the newcomer with suspicion.',
      short_term_goals: ['Undermine the newcomer'],
      long_term_ambitions: ['Control the grain supply'],
      voice: 'Sharp, cutting sarcasm.',
      epithet: 'the Viper',
      active_scheme: {
        name: 'Discredit the newcomer',
        overall_goal: 'Ruin his reputation before the next census.',
        steps: [{ objective: 'Spread rumors in the forum', status: 'in_progress' }],
      },
    },
    {
      entity_id: 'npc_general',
      name: 'General Draco',
      entity_type: 'individual',
      status: 'alive',
      location: 'Britannia',
      relationships: {
        player_1: { entity_id: 'player_1', relationship_type: 'ally', trust_level: 5, recent_interactions: [] },
      },
      memories: [],
      resources: { legions: 1 },
      visibility_network: ['player_1'],
      current_state_narrative: 'Holds the frontier, awaiting orders from Rome.',
      short_term_goals: ['Quell the uprising'],
      long_term_ambitions: ['Earn a triumph'],
      voice: 'Blunt, soldierly.',
      epithet: 'the Iron Wall',
    },
  ],
});

// --- fake GoogleGenAI client ----------------------------------------------

type CallKind = 'structure' | 'entityBatch';

function classify(systemInstruction: unknown): CallKind {
  const s = typeof systemInstruction === 'string' ? systemInstruction : '';
  if (s.includes('Create the skeleton of a new political simulation')) return 'structure';
  if (s.includes('Flesh out the characters')) return 'entityBatch';
  throw new Error(`initiator test fake: unrecognized call. systemInstruction: ${s.slice(0, 200)}`);
}

interface ScriptedCall {
  kind: CallKind;
  contents: string;
}

/**
 * Builds a fake GoogleGenAI-shaped client that dequeues scripted responses
 * per call kind. Entity-batch calls are keyed by the exact target-id string
 * embedded in the prompt ("...specific characters: <ids>."), since Step 2
 * issues a separate call per batch (player, then each NPC chunk).
 */
function createHarness(script: { structure: string[]; entityBatches: Record<string, string[]> }) {
  const structureQueue = [...script.structure];
  const batchQueues: Record<string, string[]> = Object.fromEntries(
    Object.entries(script.entityBatches).map(([key, responses]) => [key, [...responses]])
  );
  const calls: ScriptedCall[] = [];

  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    calls.push({ kind, contents: params.contents });

    if (kind === 'structure') {
      const next = structureQueue.shift();
      if (next === undefined) throw new Error('initiator test fake: structure queue exhausted');
      return { text: next };
    }

    const match = params.contents.match(/specific characters:\s*([^\n.]+)/);
    const key = match ? match[1].trim() : '';
    const queue = batchQueues[key];
    if (!queue) throw new Error(`initiator test fake: no scripted response for entity batch [${key}]`);
    const next = queue.shift();
    if (next === undefined) throw new Error(`initiator test fake: entity batch queue exhausted for [${key}]`);
    return { text: next };
  });

  const ai = { models: { generateContent } } as unknown as GoogleGenAI;
  return { ai, calls, generateContent };
}

// --- tests -----------------------------------------------------------------

describe('ai/core/initiator.ts generateScenarioStructure - real orchestration', () => {
  it('parses a valid scripted response into a well-formed WorldState plus player/NPC stubs', async () => {
    const h = createHarness({ structure: [validStructureJson], entityBatches: {} });

    const result = await generateScenarioStructure(h.ai, 'A senator navigates a crumbling Republic', 'An ambitious junior senator', false);

    expect(() => zWorldState.parse(result.worldState)).not.toThrow();
    expect(result.playerStub.entity_id).toBe('player_1');
    expect(result.npcStubs.map(s => s.entity_id)).toEqual(['npc_rival', 'npc_general']);
    expect(h.calls).toHaveLength(1);
  });

  it('recovers from a malformed (unparseable) chunk via the existing repair-retry, on the second scripted attempt', async () => {
    const h = createHarness({ structure: [malformedChunk, validStructureJson], entityBatches: {} });

    const result = await generateScenarioStructure(h.ai, 'A senator navigates a crumbling Republic', 'An ambitious junior senator', false);

    // Real repair engaged: two network round-trips, the second one carrying
    // geminiService's repair suffix (ai/core/geminiService.ts::formatRepairSuffix).
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].contents).toContain('Return ONLY corrected valid JSON.');
    expect(h.calls[1].contents).toContain('unparseable JSON');

    // And the orchestrator's output is the recovered, well-formed structure.
    expect(() => zWorldState.parse(result.worldState)).not.toThrow();
    expect(result.playerStub.entity_id).toBe('player_1');
    expect(result.npcStubs).toHaveLength(2);
  });

  it('negative control: a response missing the required npcStubs contract field, even after the repair-retry, surfaces as a fatal AiServiceError naming the missing field', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = createHarness({ structure: [incompleteStructureJson, incompleteStructureJson], entityBatches: {} });

      await expect(
        generateScenarioStructure(h.ai, 'A senator navigates a crumbling Republic', 'An ambitious junior senator', false)
      ).rejects.toMatchObject({
        name: 'AiServiceError',
        kind: 'fatal',
        callName: 'scenarioStructure',
      });

      // Proves the failure is for the expected missing-contract reason (not a
      // coincidental parse error): repair engaged once, naming the actual
      // missing field, and still failed on the corrected re-attempt.
      expect(h.calls).toHaveLength(2);
      expect(h.calls[1].contents).toContain('npcStubs');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('ai/core/initiator.ts initiateWorld - real end-to-end orchestration', () => {
  it('drives the real two-step pipeline to well-formed entities with the player integrated into the roster', async () => {
    const h = createHarness({
      structure: [validStructureJson],
      entityBatches: {
        player_1: [validPlayerEntityJson],
        'npc_rival, npc_general': [validNpcBatchJson],
      },
    });

    const result = await initiateWorld(h.ai, 'A senator navigates a crumbling Republic', 'An ambitious junior senator', false);

    expect(() => zWorldState.parse(result.worldState)).not.toThrow();
    expect(result.entities).toHaveLength(3);
    result.entities.forEach(entity => expect(() => zEntity.parse(entity)).not.toThrow());

    // The player entity is actually integrated: playerCharacterId resolves
    // to a real entity in the roster, matching the scripted player stub.
    expect(result.playerCharacterId).toBe('player_1');
    const player = result.entities.find(e => e.entity_id === result.playerCharacterId);
    expect(player).toBeDefined();
    expect(player?.name).toBe('Gaius Testus');
    expect(result.entities.map(e => e.entity_id).sort()).toEqual(['npc_general', 'npc_rival', 'player_1']);

    // Three real network calls: Step 1 (structure) + Step 2 player batch +
    // Step 2 NPC batch (chunkSize 2, both NPCs fit in one batch).
    expect(h.calls.filter(c => c.kind === 'structure')).toHaveLength(1);
    expect(h.calls.filter(c => c.kind === 'entityBatch')).toHaveLength(2);
  });
});
