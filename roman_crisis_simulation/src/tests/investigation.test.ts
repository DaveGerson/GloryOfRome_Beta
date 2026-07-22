/**
 * tests/investigation.test.ts
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "close the investigation loop" /
 * "replace the prose '40% chance' with a real roll". Exercises
 * ai/tools/intelligence.ts::getInvestigationResult's new resolution-layer
 * wiring: a HIDDEN `resolveAction` roll decided BEFORE the model call, the
 * pre-decided tier passed into the prompt, and - the actual guarantee this
 * file is here to prove - the `consequences` field's null/non-null
 * contract enforced POST-HOC in code, not merely requested of the model.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { getInvestigationResult } from '../ai/tools/intelligence';
import { endTurnCapture } from '../ai/core/geminiService';
import { rollD20, createSeededRng } from '../ai/core/resolution';
import type { Entity } from '../types';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'e1',
    name: 'Test Entity',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

/** A target with baseline (5/10) paranoia and intrigue skill -> deriveInvestigationDifficulty === 12 (ai/core/resolution.ts). */
function makeBaselineTarget(overrides: Partial<Entity> = {}): Entity {
  return makeEntity({
    entity_id: 'target_1',
    name: 'Senator Rufus',
    personality: { ambition: 5, paranoia: 5, loyalty: 5, cunning: 5, honor: 5 },
    skills: { intrigue: 5 },
    ...overrides,
  });
}

function makePlayer(overrides: Partial<Entity> = {}): Entity {
  return makeEntity({ entity_id: 'player_1', name: 'Gaius Investigator', ...overrides });
}

/**
 * Mocks Math.random so the investigation's seed (generateSeed,
 * ai/core/resolution.ts) becomes one whose seeded generator's FIRST d20
 * draw is exactly `roll`. Searches the (dense) low seed space for such a
 * seed, then pins Math.random to the value generateSeed floors back to it -
 * mirrors tests/turnPipeline.test.ts's identical helper.
 */
function mockRoll(roll: number) {
  let seed = 0;
  while (rollD20(createSeededRng(seed)) !== roll) seed++;
  return vi.spyOn(Math, 'random').mockReturnValue(seed / 2 ** 32);
}

/** A minimal mock GeminiClient (structurally a GoogleGenAI) that returns `responseJson` for the single `investigation` call getInvestigationResult makes. */
function makeMockAi(responseJson: object): { ai: GoogleGenAI; generateContent: ReturnType<typeof vi.fn> } {
  const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(responseJson) });
  return { ai: { models: { generateContent } } as unknown as GoogleGenAI, generateContent };
}

afterEach(() => {
  vi.restoreAllMocks();
  endTurnCapture(); // defensive drain, mirrors tests/turnPipeline.test.ts
});

describe('ai/tools/intelligence.ts getInvestigationResult - resolution layer wiring', () => {
  it('rolls BEFORE the model call and embeds the pre-decided tier in the prompt (never a roll number)', async () => {
    mockRoll(18); // baseline difficulty 12 (isRisky=false) -> margin 6 -> 'success'
    const { ai, generateContent } = makeMockAi({ reportData: ['A secret.'], report: 'Found a secret.', consequences: null });

    await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(generateContent).toHaveBeenCalledTimes(1); // the roll happens in code, not as a model call
    const call = generateContent.mock.calls[0][0] as { config?: Record<string, unknown> };
    const systemInstruction = String(call.config?.systemInstruction ?? '');
    expect(systemInstruction).toContain('SUCCESS');
    // Mechanics (the numeric roll itself) must never leak into the prompt text -
    // only the tier name, which is GM-side classification, not a raw number.
    expect(systemInstruction).not.toMatch(/\broll\b.*\b18\b/i);
  });

  it('success tier: consequences is null even when the model (misbehaving) returns a non-null string', async () => {
    mockRoll(18); // difficulty 12, margin 6 -> 'success'
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'Clean intel.', consequences: 'The model hallucinated a consequence anyway.' });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(result.consequences).toBeNull(); // enforced in code, not just prompt hope
  });

  it('critical_success tier: consequences is null even when the model returns a non-null string', async () => {
    mockRoll(20); // an easy target (difficulty clamped to 5) -> margin 15 -> 'critical_success'
    const easyTarget = makeBaselineTarget({ personality: { ambition: 5, paranoia: 1, loyalty: 5, cunning: 5, honor: 5 }, skills: { intrigue: 1 } });
    const { ai } = makeMockAi({ reportData: ['A secret.', 'A bonus morsel.'], report: 'Exceptional intel, plus a bonus.', consequences: 'Should not appear.' });

    const result = await getInvestigationResult(ai, easyTarget, makePlayer(), false, false, 'secrets');

    expect(result.consequences).toBeNull();
  });

  it('failure tier: consequences is non-null even when the model (misbehaving) returns null', async () => {
    mockRoll(5); // difficulty 12, margin -7 -> 'failure'
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'The investigation turned up little.', consequences: null });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(result.consequences).not.toBeNull();
    expect(typeof result.consequences).toBe('string');
    expect((result.consequences as string).length).toBeGreaterThan(0);
  });

  it('failure tier: a well-behaved model\'s own consequence string is preserved, not overridden', async () => {
    mockRoll(5); // difficulty 12, margin -7 -> 'failure'
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'Report.', consequences: 'Your agent was seen loitering near the villa.' });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(result.consequences).toBe('Your agent was seen loitering near the villa.');
  });

  it('critical_failure tier: consequences is non-null even when the model returns null', async () => {
    mockRoll(1); // difficulty 12, margin -11 -> 'critical_failure'
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'Disaster.', consequences: null });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(result.consequences).not.toBeNull();
    expect(typeof result.consequences).toBe('string');
  });

  it('partial_success tier: the model\'s own consequences value (null or a string) is passed through unmodified', async () => {
    mockRoll(13); // difficulty 12, margin 1 -> 'partial_success'

    const { ai: aiNull } = makeMockAi({ reportData: ['A secret.'], report: 'Mostly clean.', consequences: null });
    const resultNull = await getInvestigationResult(aiNull, makeBaselineTarget(), makePlayer(), false, false, 'secrets');
    expect(resultNull.consequences).toBeNull();

    const { ai: aiString } = makeMockAi({ reportData: ['A secret.'], report: 'A faint trace remains.', consequences: 'A faint whiff of suspicion lingers.' });
    const resultString = await getInvestigationResult(aiString, makeBaselineTarget(), makePlayer(), false, false, 'secrets');
    expect(resultString.consequences).toBe('A faint whiff of suspicion lingers.');
  });

  it('isRisky nudges the difficulty up, shifting the resolved tier at a boundary roll', async () => {
    // difficulty 12 (baseline), roll 17: isRisky=false -> margin 5 -> 'success'.
    // isRisky=true adds +2 difficulty -> margin 3 -> 'partial_success'.
    mockRoll(17);
    const { ai: aiNotRisky } = makeMockAi({ reportData: ['A secret.'], report: 'Report.', consequences: null });
    const notRisky = await getInvestigationResult(aiNotRisky, makeBaselineTarget(), makePlayer(), false, false, 'secrets');
    expect(notRisky.consequences).toBeNull(); // success tier

    const { ai: aiRisky, generateContent } = makeMockAi({ reportData: ['A secret.'], report: 'Report.', consequences: null });
    await getInvestigationResult(aiRisky, makeBaselineTarget(), makePlayer(), true, false, 'secrets');
    const call = generateContent.mock.calls[0][0] as { config?: Record<string, unknown> };
    expect(String(call.config?.systemInstruction)).toContain('PARTIAL_SUCCESS');
  });

  it('mock mode bypasses the resolution layer entirely (delegates straight to the mock function)', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const { ai, generateContent } = makeMockAi({ reportData: [], report: 'unused', consequences: null });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), true, true, 'secrets');

    expect(generateContent).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
    expect(result.report).toBeTruthy();
    // No roll happened, so there is no resolution trace (and no seed) to record.
    expect(result.resolutionTrace).toBeUndefined();
  });

  it('records a resolutionTrace carrying the investigation\'s own seed, and replaying the seed reproduces the recorded roll', async () => {
    // Math.random is deliberately UNMOCKED: the seed is real entropy, and
    // the reproducibility contract must hold for whatever seed was drawn.
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'Report.', consequences: null });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    const trace = result.resolutionTrace;
    expect(trace).toBeDefined();
    expect(typeof trace!.seed).toBe('number');
    expect(Number.isInteger(trace!.seed)).toBe(true);
    expect(trace!.seed!).toBeGreaterThanOrEqual(0);
    expect(trace!.seed!).toBeLessThan(2 ** 32);
    // The investigation's roll is its dedicated generator's first draw:
    // rebuilding the generator from the recorded seed reproduces it.
    expect(rollD20(createSeededRng(trace!.seed!))).toBe(trace!.roll);
    // The synthetic assessment mirrors the fixed check an investigation is.
    expect(trace!.assessment).toMatchObject({
      is_consequential: true,
      action_category: 'secrets investigation',
      relevant_skill: 'intrigue',
      difficulty: 12,
      opposing_entity_id: 'target_1',
    });
  });

  it('trace mechanics (roll/total/margin/tier) match the pre-decided resolution fed to the prompt', async () => {
    mockRoll(18); // difficulty 12 (isRisky=false), no skills/personality/relationship -> total 18, margin 6 -> 'success'
    const { ai } = makeMockAi({ reportData: ['A secret.'], report: 'Report.', consequences: null });

    const result = await getInvestigationResult(ai, makeBaselineTarget(), makePlayer(), false, false, 'secrets');

    expect(result.resolutionTrace).toMatchObject({ roll: 18, total: 18, margin: 6, tier: 'success' });
  });
});
