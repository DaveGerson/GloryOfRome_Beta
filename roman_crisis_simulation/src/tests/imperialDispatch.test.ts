/**
 * tests/imperialDispatch.test.ts
 *
 * Tests for the fact-based Imperial Intelligence Dispatch summarizing the
 * state of all tabs in crisp High English or Mid-Atlantic broadcast style.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  compileTabsFactSummary,
} from '../hooks/useImperialDispatch';
import {
  buildImperialDispatchPrompt,
} from '../ai/prompts/narrationPerformance';
import {
  directImperialDispatch,
  performImperialDispatch,
} from '../ai/tools/narrationVoice';
import { GEMINI_TTS, type GeminiClient } from '../ai/core/geminiService';
import type { WorldState, Entity, Report, SimulationState } from '../types';

describe('compileTabsFactSummary', () => {
  const worldState: WorldState = {
    week: 4,
    year: 235,
    economic_stability: 'fragile',
    political_climate: 'strained',
    regions: {},
  };

  const simulationState: SimulationState = {
    imperial_status: 'Contested',
    senate_status: 'Functional',
    military_status: 'Divided',
    plebeian_mood: 'Uneasy',
    major_ongoing_crisis: 'Border incursions along the Danube',
  };

  const entities: Entity[] = [
    {
      entity_id: 'e1',
      name: 'Player Caesar',
      entity_type: 'individual',
      status: 'alive',
      location: 'Rome',
      relationships: {},
      memories: [],
      resources: { denarii: 12000, grain: 400 },
      visibility_network: [],
      current_state_narrative: 'Ruling Rome',
      short_term_goals: [],
      long_term_ambitions: [],
    },
    {
      entity_id: 'e2',
      name: 'Maximinus Thrax',
      entity_type: 'individual',
      status: 'alive',
      position: 'Legatus',
      location: 'Pannonia',
      relationships: {},
      memories: [],
      resources: {},
      visibility_network: [],
      current_state_narrative: 'Marching south',
      short_term_goals: [],
      long_term_ambitions: [],
    },
    {
      entity_id: 'e3',
      name: 'Gordian',
      entity_type: 'individual',
      status: 'alive',
      position: 'Proconsul',
      location: 'Africa',
      relationships: {},
      memories: [],
      resources: {},
      visibility_network: [],
      current_state_narrative: 'Governing Africa',
      short_term_goals: [],
      long_term_ambitions: [],
    },
  ];

  const reports: Report[] = [
    {
      id: 'r1',
      turn: 4,
      source: 'scout',
      about: 'Danube Garrison',
      claim: 'Troops demand grain and delayed stipends.',
      credibility: 0.9,
    },
  ];

  const currentEvents = ['Riots break out near the docks in Ostia'];

  it('compiles an informative situation summary across all tabs', () => {
    const summary = compileTabsFactSummary({
      worldState,
      simulationState,
      entities,
      reports,
      currentEvents,
      playerEntity: entities[0],
      turnNumber: 4,
    });

    expect(summary).toContain('Week IV');
    expect(summary).toContain('Year 235 CE');
    expect(summary).toContain('Economic stability: fragile');
    expect(summary).toContain('Political climate: strained');
    expect(summary).toContain('Imperial throne: Contested');
    expect(summary).toContain('Legions: Divided');
    expect(summary).toContain('Plebeian mood: Uneasy');
    expect(summary).toContain('Border incursions along the Danube');
    expect(summary).toContain('denarii: 12000, grain: 400');
    expect(summary).toContain('Riots break out near the docks in Ostia');
    expect(summary).toContain('Danube Garrison: Troops demand grain and delayed stipends.');
    expect(summary).toContain('Maximinus Thrax (Legatus, status: alive)');
    expect(summary).toContain('Gordian (Proconsul, status: alive)');
  });
});

describe('buildImperialDispatchPrompt', () => {
  it('frames the model as the Chief of Intelligence in High English broadcast style', () => {
    const facts = 'Week IV: Treasury stable. Grain shortage in Alexandria.';
    const { systemInstruction, prompt } = buildImperialDispatchPrompt(facts);

    expect(systemInstruction).toContain('Principal Secretary of the Imperial Chancellery');
    expect(systemInstruction).toContain('High English or Mid-Atlantic broadcast style');
    expect(systemInstruction).toContain('Output ONLY the clean spoken text');
    expect(prompt).toContain(facts);
  });
});

describe('directImperialDispatch and performImperialDispatch', () => {
  function makeAi(dispatchText: string = 'The imperial treasury stands resilient this week. Frontier garrisons hold the lines.') {
    const generateContent = vi.fn(async (params: { model: string; contents: string }) => {
      if (params.model === GEMINI_TTS) {
        return {
          candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }],
        };
      }
      return { text: dispatchText };
    });
    const ai: GeminiClient = { models: { generateContent } };
    return { ai, generateContent };
  }

  it('directImperialDispatch returns clean spoken prose in real mode', async () => {
    const { ai } = makeAi('## Intelligence Dispatch:\n<crisp> All provinces remain calm under imperial mandate.');
    const result = await directImperialDispatch(ai, 'raw facts', false);

    expect(result.transcript).toBe('All provinces remain calm under imperial mandate.');
    expect(result.transcript).not.toContain('##');
    expect(result.transcript).not.toContain('<crisp>');
  });

  it('directImperialDispatch falls back to cleaned facts in mock mode', async () => {
    const { ai } = makeAi();
    const result = await directImperialDispatch(ai, 'Treasury 100 talents. **Legions** ready.', true);

    expect(result.usedFallback).toBe(true);
    expect(result.transcript).toContain('Treasury 100 talents. Legions ready.');
    expect(result.transcript).not.toContain('**');
  });

  it('performImperialDispatch voices the dispatch with Sadaltager as default legate voice', async () => {
    const { ai, generateContent } = makeAi();
    const result = await performImperialDispatch(ai, 'Summary facts', false);

    expect(result.wav).toBeDefined();
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: GEMINI_TTS,
        config: expect.objectContaining({
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sadaltager' } } },
        }),
      }),
    );
  });

  it('performImperialDispatch returns synthesized mock tone in mock mode without calling API', async () => {
    const { ai, generateContent } = makeAi();
    const result = await performImperialDispatch(ai, 'Summary facts', true);

    expect(result.wav).toBeDefined();
    expect(generateContent).not.toHaveBeenCalled();
  });
});
