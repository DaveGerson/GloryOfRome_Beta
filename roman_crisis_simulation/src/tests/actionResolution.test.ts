/**
 * tests/actionResolution.test.ts
 *
 * Exercises the general-purpose "resolution layer" additions to
 * ai/core/resolution.ts (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4):
 * `resolveAction`'s margin/tier math across every documented band, and the
 * pure modifier helpers (`derivePersonalityModifier`, `deriveOppositionModifier`,
 * `deriveInvestigationDifficulty`) that feed it. The pre-existing mortality
 * tables (`resolvePlayerDeathSave`/`resolveNpcFate`) are covered by
 * tests/mortality.test.ts and are untouched by this file.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAction,
  derivePersonalityModifier,
  deriveOppositionModifier,
  deriveInvestigationDifficulty,
  ACTION_DIFFICULTY_RANGE,
  ACTION_RESOLUTION_TIER_THRESHOLDS,
  type ActionResolutionTier,
} from '../ai/core/resolution';
import { buildActionAssessmentPrompt } from '../ai/prompts/assessment';
import { projectForResolution } from '../playerInput/turnSubmission';
import type { Entity, PersonalityTraits, Relationship, TurnSubmission } from '../types';

function makePersonality(overrides: Partial<PersonalityTraits> = {}): PersonalityTraits {
  return { ambition: 5, paranoia: 5, loyalty: 5, cunning: 5, honor: 5, ...overrides };
}

function makeRelationship(overrides: Partial<Relationship> = {}): Relationship {
  return { entity_id: 'target', relationship_type: 'rival', trust_level: 0, recent_interactions: [], ...overrides };
}

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

describe('ai/core/resolution.ts resolveAction - margin/tier bands', () => {
  // roll fixed at 10, skill/personality/opposition all zeroed out, so
  // margin = 10 - difficulty exactly - lets every test target an EXACT
  // margin by choosing `difficulty`.
  function resolveAtMargin(margin: number) {
    return resolveAction({
      roll: 10,
      relevantSkillValue: null,
      personalityModifier: 0,
      oppositionModifier: 0,
      difficulty: 10 - margin,
    });
  }

  it('echoes the roll and computes total/margin correctly', () => {
    const result = resolveAction({
      roll: 14,
      relevantSkillValue: 6,
      personalityModifier: 1.5,
      oppositionModifier: -2,
      difficulty: 12,
    });
    expect(result.roll).toBe(14);
    expect(result.total).toBe(14 + 6 + 1.5 - 2); // 19.5
    expect(result.margin).toBe(19.5 - 12); // 7.5
    expect(result.tier).toBe('success'); // 5 <= 7.5 < 10
  });

  it('treats a null relevantSkillValue as a zero contribution', () => {
    const withNull = resolveAction({ roll: 10, relevantSkillValue: null, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 });
    const withZero = resolveAction({ roll: 10, relevantSkillValue: 0, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 });
    expect(withNull.total).toBe(withZero.total);
  });

  it('rejects an invalid roll (reuses the same 1-20 integer validation as the mortality tables)', () => {
    expect(() => resolveAction({ roll: 0, relevantSkillValue: null, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 })).toThrow();
    expect(() => resolveAction({ roll: 21, relevantSkillValue: null, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 })).toThrow();
    expect(() => resolveAction({ roll: 10.5, relevantSkillValue: null, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 })).toThrow();
  });

  it('documents the exact threshold constants the roadmap specifies (<=-10 crit fail, <0 fail, <+5 partial, <+10 success, >=+10 crit success)', () => {
    expect(ACTION_RESOLUTION_TIER_THRESHOLDS.CRITICAL_FAILURE_MAX).toBe(-10);
    expect(ACTION_RESOLUTION_TIER_THRESHOLDS.FAILURE_MAX).toBe(0);
    expect(ACTION_RESOLUTION_TIER_THRESHOLDS.PARTIAL_SUCCESS_MAX).toBe(5);
    expect(ACTION_RESOLUTION_TIER_THRESHOLDS.SUCCESS_MAX).toBe(10);
  });

  const bandCases: Array<[number, ActionResolutionTier]> = [
    [-20, 'critical_failure'],
    [-11, 'critical_failure'],
    [-10, 'critical_failure'], // boundary: margin <= -10
    [-9, 'failure'],           // boundary: just above critical_failure
    [-5, 'failure'],
    [-1, 'failure'],           // boundary: just below 0
    [0, 'partial_success'],    // boundary: margin < 0 fails, so 0 is NOT a failure
    [2, 'partial_success'],
    [4, 'partial_success'],    // boundary: just below 5
    [5, 'success'],            // boundary: margin < 5 fails partial, so 5 is success
    [7, 'success'],
    [9, 'success'],            // boundary: just below 10
    [10, 'critical_success'],  // boundary: margin >= 10
    [11, 'critical_success'],
    [25, 'critical_success'],
  ];

  it.each(bandCases)('margin %d resolves to tier %s', (margin, expectedTier) => {
    const result = resolveAtMargin(margin);
    expect(result.margin).toBe(margin);
    expect(result.tier).toBe(expectedTier);
  });

  it('every integer margin from -30 to 30 maps to exactly one tier consistent with the documented bands', () => {
    for (let margin = -30; margin <= 30; margin++) {
      const { tier } = resolveAtMargin(margin);
      if (margin <= -10) expect(tier, `margin ${margin}`).toBe('critical_failure');
      else if (margin < 0) expect(tier, `margin ${margin}`).toBe('failure');
      else if (margin < 5) expect(tier, `margin ${margin}`).toBe('partial_success');
      else if (margin < 10) expect(tier, `margin ${margin}`).toBe('success');
      else expect(tier, `margin ${margin}`).toBe('critical_success');
    }
  });
});

describe('action-assessment submission boundary', () => {
  it('the real assessment prompt receives observable action text and no private or question-only fields', () => {
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate in public.'],
      privateIntent: 'PRIVATE_ASSESSMENT_FORBIDDEN_SENTINEL',
      questionOrContext: 'QUESTION_ASSESSMENT_FORBIDDEN_SENTINEL',
    };
    const observableAttempt = projectForResolution(submission);
    expect(observableAttempt).not.toBeNull();

    const { prompt } = buildActionAssessmentPrompt({
      playerIntent: observableAttempt!,
      playerBrief: 'entity_id: player_1\nname: Gaius Testus',
      worldSummary: 'Year 235, week 7.',
      npcEntities: [],
    });

    expect(prompt).toContain('Address the Senate in public.');
    expect(prompt).not.toContain('PRIVATE_ASSESSMENT_FORBIDDEN_SENTINEL');
    expect(prompt).not.toContain('QUESTION_ASSESSMENT_FORBIDDEN_SENTINEL');
  });
});

describe('ai/core/resolution.ts derivePersonalityModifier', () => {
  it('returns 0 for an entity with no personality, regardless of skill/category', () => {
    expect(derivePersonalityModifier({ personality: undefined, relevantSkill: 'intrigue', actionCategory: 'a scheme' })).toBe(0);
    expect(derivePersonalityModifier({ personality: undefined, relevantSkill: null, actionCategory: 'treachery' })).toBe(0);
  });

  it('cunning fuels intrigue and strategy actions (schemes)', () => {
    const personality = makePersonality({ cunning: 9 });
    const intrigueMod = derivePersonalityModifier({ personality, relevantSkill: 'intrigue', actionCategory: 'a covert scheme' });
    const strategyMod = derivePersonalityModifier({ personality, relevantSkill: 'strategy', actionCategory: 'a tactical maneuver' });
    expect(intrigueMod).toBeCloseTo((9 - 5) / 2, 5);
    expect(strategyMod).toBeCloseTo((9 - 5) / 2, 5);
  });

  it('ambition fuels oratory actions', () => {
    const personality = makePersonality({ ambition: 7 });
    const mod = derivePersonalityModifier({ personality, relevantSkill: 'oratory', actionCategory: 'a rousing speech' });
    expect(mod).toBeCloseTo((7 - 5) / 2, 5);
  });

  it('a relevantSkill of null contributes no skill-driven term', () => {
    const personality = makePersonality({ cunning: 10, ambition: 10 });
    const mod = derivePersonalityModifier({ personality, relevantSkill: null, actionCategory: 'administration' });
    expect(mod).toBe(0);
  });

  it('applies an honor penalty for treachery: a HIGH-honor character is worse at it', () => {
    const honorable = makePersonality({ honor: 9 });
    const mod = derivePersonalityModifier({ personality: honorable, relevantSkill: null, actionCategory: 'a plan of treachery' });
    expect(mod).toBeCloseTo(-((9 - 5) / 2), 5); // negative - a penalty
  });

  it('a LOW-honor character suffers little or even benefits from the same treacherous act', () => {
    const dishonorable = makePersonality({ honor: 1 });
    const mod = derivePersonalityModifier({ personality: dishonorable, relevantSkill: null, actionCategory: 'a betrayal' });
    expect(mod).toBeCloseTo(-((1 - 5) / 2), 5); // positive - low honor is unbothered/helped
    expect(mod).toBeGreaterThan(0);
  });

  it('detects treachery keywords case-insensitively as substrings ("backstab", "double-cross", etc)', () => {
    const personality = makePersonality({ honor: 8 });
    for (const category of ['Treachery', 'A BACKSTAB in the dark', 'plans a double-cross', 'a double cross scheme']) {
      const mod = derivePersonalityModifier({ personality, relevantSkill: null, actionCategory: category });
      expect(mod, category).toBeLessThan(0);
    }
  });

  it('does not apply the honor penalty for a non-treacherous action', () => {
    const personality = makePersonality({ honor: 9 });
    const mod = derivePersonalityModifier({ personality, relevantSkill: null, actionCategory: 'a diplomatic overture' });
    expect(mod).toBe(0);
  });

  it('combines a skill term and a treachery penalty when both apply', () => {
    const personality = makePersonality({ cunning: 8, honor: 9 });
    const mod = derivePersonalityModifier({ personality, relevantSkill: 'intrigue', actionCategory: 'a treacherous scheme to betray an ally' });
    expect(mod).toBeCloseTo((8 - 5) / 2 - (9 - 5) / 2, 5); // 1.5 - 2 = -0.5
  });
});

describe('ai/core/resolution.ts deriveOppositionModifier', () => {
  it('returns 0 when there is no relationship on record (no opposing entity, or unknown to it)', () => {
    expect(deriveOppositionModifier({ relationshipTowardActor: undefined })).toBe(0);
    expect(deriveOppositionModifier({ relationshipTowardActor: null })).toBe(0);
  });

  it('higher perceived_threat makes the action HARDER (a negative modifier)', () => {
    const mod = deriveOppositionModifier({ relationshipTowardActor: makeRelationship({ perceived_threat: 10, trust_level: 0 }) });
    expect(mod).toBe(-5); // -(10/2)
  });

  it('higher trust_level toward the actor makes the action EASIER (a positive modifier)', () => {
    const mod = deriveOppositionModifier({ relationshipTowardActor: makeRelationship({ perceived_threat: 0, trust_level: 10 }) });
    expect(mod).toBe(2.5); // 10/4
  });

  it('distrust (negative trust_level) makes the action harder', () => {
    const mod = deriveOppositionModifier({ relationshipTowardActor: makeRelationship({ perceived_threat: 0, trust_level: -8 }) });
    expect(mod).toBe(-2); // -8/4
  });

  it('combines threat and trust', () => {
    const mod = deriveOppositionModifier({ relationshipTowardActor: makeRelationship({ perceived_threat: 6, trust_level: -8 }) });
    expect(mod).toBe(-3 + -2); // -(6/2) + (-8/4) = -3 - 2 = -5
  });

  it('treats missing perceived_threat/trust_level fields as 0', () => {
    const mod = deriveOppositionModifier({ relationshipTowardActor: { entity_id: 'x', relationship_type: 'rival', trust_level: 0, recent_interactions: [] } });
    expect(mod).toBe(0);
  });
});

describe('ai/core/resolution.ts deriveInvestigationDifficulty', () => {
  it('defaults to the baseline (12) for a target with no personality/skills', () => {
    const target = makeEntity();
    expect(deriveInvestigationDifficulty(target)).toBe(12);
  });

  it('a more paranoid, more cunning-at-intrigue target is harder to investigate', () => {
    const target = makeEntity({ personality: makePersonality({ paranoia: 10 }), skills: { intrigue: 10 } });
    expect(deriveInvestigationDifficulty(target)).toBe(12 + (10 - 5) + (10 - 5)); // 22
  });

  it('a less paranoid, less cunning target is easier to investigate', () => {
    const target = makeEntity({ personality: makePersonality({ paranoia: 2 }), skills: { intrigue: 2 } });
    expect(deriveInvestigationDifficulty(target)).toBe(12 + (2 - 5) + (2 - 5)); // 6
  });

  it('clamps to ACTION_DIFFICULTY_RANGE (5-25) at both ends', () => {
    // Deliberately out-of-normal-range trait values to exercise the clamp -
    // paranoia/intrigue are documented 1-10, but the helper must not
    // silently produce an out-of-contract difficulty even given odd inputs.
    const veryHard = makeEntity({ personality: makePersonality({ paranoia: 30 }), skills: { intrigue: 30 } });
    expect(deriveInvestigationDifficulty(veryHard)).toBe(ACTION_DIFFICULTY_RANGE.MAX);

    const veryEasy = makeEntity({ personality: makePersonality({ paranoia: -10 }), skills: { intrigue: -10 } });
    expect(deriveInvestigationDifficulty(veryEasy)).toBe(ACTION_DIFFICULTY_RANGE.MIN);
  });

  it('ACTION_DIFFICULTY_RANGE matches the documented 5-25 scale', () => {
    expect(ACTION_DIFFICULTY_RANGE.MIN).toBe(5);
    expect(ACTION_DIFFICULTY_RANGE.MAX).toBe(25);
  });
});
