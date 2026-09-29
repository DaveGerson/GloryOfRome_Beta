/**
 * @vitest-environment jsdom
 *
 * tests/groundedIntel.test.tsx - DESIGN_DECISIONS.md D47: investigations
 * reach for the truth, and two hidden rolls decide how right and how much.
 *
 * Pins, in order:
 *  - the two rolls' bands and inputs (ai/core/resolution.ts);
 *  - the ground-truth pool per kind, and the scoping/shaping plan built from
 *    it BEFORE any prompt (ai/core/groundTruth.ts) - fidelity picks what is
 *    reached, accuracy whether it comes back true, garbled or false, and a
 *    false account carries NO truth into the prompt;
 *  - the prompts built from that plan, through the real tool path;
 *  - the sentinel: `secret_truth` can never reach an intelligence prompt;
 *  - D11 bookkeeping: one GM-private ledger entry per finding, written in
 *    the same commit as the reveal, never reaching a player surface;
 *  - D28: the nature a scheme's clues add up to follows from the clues, and
 *    the ledger records whether it is the truth;
 *  - leverage: the adjudicator's GM-private context knows which lever holds;
 *  - save compatibility: new fields round-trip, old saves load unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import {
  createSeededRng,
  rollD20,
  resolveInvestigationAccuracy,
  resolveInvestigationFidelity,
} from '../ai/core/resolution';
import {
  deriveLeverageTruth,
  FIDELITY_REACH,
  groundTruthPool,
  investigationLedgerEntries,
  investigationTruth,
  NO_DESIGN_TRUTH,
  NOTHING_ON_RECORD,
  planInvestigation,
  planSchemeNature,
  resolveSchemeNatureStanding,
  type GroundTruthKind,
  type SchemeClueRecord,
} from '../ai/core/groundTruth';
import {
  getDeepAnalysis,
  getInvestigationResult,
  getSchemeNatureReading,
  settleInvestigationTruth,
} from '../ai/tools/intelligence';
import { buildDeepAnalysisPrompt, buildInvestigationPrompt, buildSchemeNaturePrompt } from '../ai/prompts/intelligence';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { asPromptData, buildLeverageTruthBlock } from '../ai/prompts/fragments';
import { endTurnCapture } from '../ai/core/geminiService';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import { computeInvestigationKnowledge } from '../knowledge/commit';
import { deriveDossier, ingestSchemeClue, SCHEME_CLUE_LINE, SCHEME_NATURE_UNSYNTHESIZED, type KnowledgeClaim } from '../knowledge/store';
import { gameReducer, createInitialGameState } from '../state/gameReducer';
import { saveGame, loadGame, type SaveGameState } from '../persistence/saveGame';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import { TruthLedgerView } from '../components/gm/TruthLedgerView';
import type { DomainCommit } from '../app/transactions';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import type { Entity, InvestigationResult, InvestigationTruth, IntelAccuracy, IntelFidelity, TruthLedgerEntry } from '../types';
import { renderHook } from './renderHook';
import { makeEntity, makeLegacySaveState, makeSimulationState, makeWorldState } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRETS = [
  'Owes the Syrian bankers a ruinous sum',
  'Poisoned his first wife at Antium',
  'Keeps a Christian freedwoman as his confidante',
  'Forged the will that made him rich',
];
const BELIEFS = ['Only the legions can save Rome', 'The Senate is a nest of vipers'];
const SCHEME = {
  name: 'The Silent Knife',
  overall_goal: 'Seize the treasury and buy the Praetorian Guard before the Ides',
  steps: [
    { objective: 'Win the quaestor over with a gift of land', status: 'completed' as const },
    { objective: 'Bribe the prefect of the night watch', status: 'in_progress' as const },
  ],
};
const SITUATION = 'Heavily indebted and short of friends in the Curia';
const SECRET_TRUTH_SENTINEL = 'SECRET_TRUTH_SENTINEL_MOTIVE';

/** A baseline target: 5/10 paranoia and intrigue (difficulty 12), a full record, and a hidden-survivor record that must never be read. */
function makeTarget(overrides: Partial<Entity> = {}): Entity {
  return makeEntity({
    entity_id: 'varro',
    name: 'Senator Varro',
    position: 'Senator',
    personality: { ambition: 5, paranoia: 5, loyalty: 5, cunning: 5, honor: 5 },
    skills: { intrigue: 5 },
    beliefs: BELIEFS,
    secrets: SECRETS,
    active_scheme: SCHEME,
    current_state_narrative: SITUATION,
    short_term_goals: ['Win the grain contract'],
    long_term_ambitions: ['Become consul'],
    secret_truth: { actually_alive: true, hidden_since_turn: 3, motive: SECRET_TRUTH_SENTINEL },
    ...overrides,
  });
}

const investigator = makeEntity({ entity_id: 'player', name: 'Gaius Investigator', visibility_network: ['varro'] });

/**
 * Pins Math.random so the investigation's recorded seed is one whose
 * generator's FIRST draws are exactly `rolls` - the tier roll, then the D47
 * accuracy and fidelity rolls (a deep analysis makes no tier roll, so its
 * first two are accuracy and fidelity).
 */
function pinRolls(rolls: number[]) {
  let seed = 0;
  for (;; seed++) {
    const rng = createSeededRng(seed);
    if (rolls.every(roll => rollD20(rng) === roll)) break;
  }
  return vi.spyOn(Math, 'random').mockReturnValue(seed / 2 ** 32);
}

/** A fake provider that records every call and answers each with `text`. */
function recordingAi(text: string) {
  const calls: Array<{ systemInstruction: string; prompt: string }> = [];
  const generateContent = vi.fn(async (params: { contents: string; config?: Record<string, unknown> }) => {
    calls.push({ systemInstruction: String(params.config?.systemInstruction ?? ''), prompt: params.contents });
    return { text };
  });
  return { ai: { models: { generateContent } } as unknown as GoogleGenAI, calls };
}

function investigationReply(reportData: string[]) {
  return JSON.stringify({ reportData, report: 'Your agent brings word.', consequences: null });
}

const everyPrompt = (calls: Array<{ systemInstruction: string; prompt: string }>) =>
  calls.map(call => `${call.systemInstruction}\n${call.prompt}`).join('\n');

/** D47's GM-private vocabulary: none of it may appear in any prompt whose output the player reads, nor on any player surface. */
const TRUTH_FLAG_TOKENS = ['isTrue', 'standing', 'groundTruth', 'accuracy', 'fidelity', 'garbled', 'GARBLED'];

afterEach(() => {
  vi.restoreAllMocks();
  endTurnCapture();
});

// ---------------------------------------------------------------------------
// The two hidden rolls
// ---------------------------------------------------------------------------

describe('D47 rolls (ai/core/resolution.ts)', () => {
  const accuracy = (roll: number, tier: Parameters<typeof resolveInvestigationAccuracy>[0]['tier'] = 'partial_success', extra: { intrigue?: number | null; paranoia?: number } = {}) =>
    resolveInvestigationAccuracy({ roll, tier, investigatorIntrigue: extra.intrigue ?? 5, targetParanoia: extra.paranoia ?? 5 }).accuracy;
  const fidelity = (roll: number, tier: Parameters<typeof resolveInvestigationFidelity>[0]['tier'] = 'partial_success', difficulty = 12) =>
    resolveInvestigationFidelity({ roll, tier, investigatorIntrigue: 5, difficulty }).fidelity;

  it('accuracy bands: <= 6 false, 7-12 garbled, >= 13 true', () => {
    expect([1, 6, 7, 12, 13, 20].map(roll => accuracy(roll))).toEqual(['false', 'false', 'garbled', 'garbled', 'true', 'true']);
  });

  it('fidelity bands: <= 8 fragment, 9-14 partial, >= 15 fuller', () => {
    expect([1, 8, 9, 14, 15, 20].map(roll => fidelity(roll))).toEqual(['fragment', 'fragment', 'partial', 'partial', 'fuller', 'fuller']);
  });

  it('the operational tier feeds both rolls without deciding either', () => {
    expect(accuracy(10, 'critical_failure')).toBe('false');
    expect(accuracy(10, 'partial_success')).toBe('garbled');
    expect(accuracy(10, 'success')).toBe('true');
    // Even a critical success can come back garbled, and a critical failure true.
    expect(accuracy(1, 'critical_success')).toBe('garbled');
    expect(accuracy(20, 'critical_failure')).toBe('true');
    expect(fidelity(11, 'failure')).toBe('fragment');
    expect(fidelity(11, 'critical_success')).toBe('fuller');
  });

  it('a skilled investigator is misled less, a paranoid target misleads more - each on its own scale', () => {
    expect(accuracy(11, 'partial_success', { intrigue: 10 })).toBe('true'); // 11 + 2.5
    expect(accuracy(8, 'partial_success', { paranoia: 10 })).toBe('false'); // 8 - 2.5
    // Off-scale model-authored values count only at the edge of their scale.
    expect(resolveInvestigationAccuracy({ roll: 10, tier: 'success', investigatorIntrigue: 90, targetParanoia: 5 }).score)
      .toBe(resolveInvestigationAccuracy({ roll: 10, tier: 'success', investigatorIntrigue: 10, targetParanoia: 5 }).score);
    // An unknown skill reads as average, not as none.
    expect(resolveInvestigationAccuracy({ roll: 10, tier: 'success', investigatorIntrigue: null, targetParanoia: undefined }).score).toBe(13);
  });

  it('a closely guarded target yields less; the difficulty counts only on its scale', () => {
    expect(fidelity(13, 'partial_success', 12)).toBe('partial');
    expect(fidelity(13, 'partial_success', 22)).toBe('fragment'); // 13 - 5
    expect(resolveInvestigationFidelity({ roll: 14, tier: 'success', investigatorIntrigue: 5, difficulty: 99 }).score)
      .toBe(resolveInvestigationFidelity({ roll: 14, tier: 'success', investigatorIntrigue: 5, difficulty: 25 }).score);
  });

  it('refuses a roll off the die', () => {
    expect(() => resolveInvestigationAccuracy({ roll: 0, tier: 'success', investigatorIntrigue: 5, targetParanoia: 5 })).toThrow();
    expect(() => resolveInvestigationFidelity({ roll: 21, tier: 'success', investigatorIntrigue: 5, difficulty: 12 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ground truth, scoped in code
// ---------------------------------------------------------------------------

describe('groundTruthPool (ai/core/groundTruth.ts)', () => {
  it('reads each kind off the real record - beliefs, secrets, the scheme\'s goal and steps, the situation and aims', () => {
    const target = makeTarget();
    expect(groundTruthPool(target, 'beliefs').map(item => item.text)).toEqual(BELIEFS);
    expect(groundTruthPool(target, 'secrets').map(item => item.text)).toEqual(SECRETS);
    expect(groundTruthPool(target, 'scheme')).toEqual([
      { source: 'scheme_goal', text: SCHEME.overall_goal },
      { source: 'scheme_step', text: SCHEME.steps[0].objective },
      { source: 'scheme_step', text: SCHEME.steps[1].objective },
    ]);
    expect(groundTruthPool(target, 'deep_analysis').map(item => item.source)).toEqual(['situation', 'aim', 'ambition']);
  });

  it('never offers the scheme\'s title as a clue (D28), and never the scheme to an assessment', () => {
    const target = makeTarget();
    expect(JSON.stringify(groundTruthPool(target, 'scheme'))).not.toContain(SCHEME.name);
    expect(JSON.stringify(groundTruthPool(target, 'deep_analysis'))).not.toContain(SCHEME.overall_goal);
  });

  it('never reads secret_truth, for any kind', () => {
    for (const kind of ['beliefs', 'secrets', 'scheme', 'deep_analysis'] as const) {
      const pool = JSON.stringify(groundTruthPool(makeTarget(), kind));
      expect(pool).not.toContain(SECRET_TRUTH_SENTINEL);
      expect(pool).not.toContain('actually_alive');
    }
  });

  it('drops blank entries and tolerates a record with nothing on it', () => {
    const bare = makeEntity({ beliefs: ['', '  '], secrets: undefined });
    expect(groundTruthPool(bare, 'beliefs')).toEqual([]);
    expect(groundTruthPool(bare, 'secrets')).toEqual([]);
    expect(groundTruthPool(bare, 'scheme')).toEqual([]);
    expect(groundTruthPool(bare, 'deep_analysis')).toEqual([]);
  });
});

describe('planInvestigation - fidelity scopes, accuracy shapes', () => {
  const plan = (kind: GroundTruthKind, accuracy: IntelAccuracy, fidelity: IntelFidelity, target = makeTarget(), seed = 7) =>
    planInvestigation(target, kind, { accuracy, fidelity }, createSeededRng(seed));

  it('fidelity decides how many items, or how much of one, reach the prompt', () => {
    const fragment = plan('secrets', 'true', 'fragment');
    expect(fragment.findings).toHaveLength(FIDELITY_REACH.fragment);
    expect(fragment.findings[0].fragmentary).toBe(true);
    expect(SECRETS).toContain(fragment.findings[0].groundTruth);
    expect(fragment.findings[0].groundTruth).toContain(fragment.findings[0].truth!);
    expect(fragment.findings[0].truth!.length).toBeLessThan(fragment.findings[0].groundTruth!.length);

    const partial = plan('secrets', 'true', 'partial');
    expect(partial.findings).toHaveLength(2);
    const fuller = plan('secrets', 'true', 'fuller');
    expect(fuller.findings).toHaveLength(3);
    for (const finding of [...partial.findings, ...fuller.findings]) {
      expect(finding.fragmentary).toBe(false);
      expect(SECRETS).toContain(finding.truth);
    }
    expect(new Set(fuller.findings.map(finding => finding.truth)).size).toBe(3);
  });

  it('a scheme buy carries at most one step, or a fragment of the goal - never the whole plan (D28)', () => {
    const steps = SCHEME.steps.map(step => step.objective);
    const fragment = plan('scheme', 'true', 'fragment');
    const partial = plan('scheme', 'true', 'partial');
    const fuller = plan('scheme', 'true', 'fuller');
    for (const scoped of [fragment, partial, fuller]) {
      expect(scoped.findings).toHaveLength(1);
      expect(JSON.stringify(scoped.findings.map(finding => finding.truth))).not.toContain(SCHEME.name);
      expect(scoped.findings[0].truth).not.toBe(SCHEME.overall_goal);
      expect(scoped.schemeName).toBe(SCHEME.name);
    }
    expect(steps).toContain(fragment.findings[0].groundTruth);
    expect(fragment.findings[0].fragmentary).toBe(true);
    expect(steps).toContain(partial.findings[0].truth);
    expect(fuller.findings[0].groundTruth).toBe(SCHEME.overall_goal);
    expect(fuller.findings[0].fragmentary).toBe(true);
    expect(SCHEME.overall_goal).toContain(fuller.findings[0].truth!);
  });

  it('true: every finding is the truth as reached, and says so on the plan', () => {
    const scoped = plan('beliefs', 'true', 'partial');
    expect(scoped.accuracy).toBe('true');
    expect(scoped.findings.every(finding => finding.standing === 'true' && finding.truth === finding.groundTruth)).toBe(true);
  });

  it('garbled: exactly one finding is marked for exactly one recorded distortion', () => {
    for (let seed = 0; seed < 20; seed++) {
      const scoped = plan('secrets', 'garbled', 'fuller', makeTarget(), seed);
      const garbled = scoped.findings.filter(finding => finding.standing === 'garbled');
      expect(garbled).toHaveLength(1);
      expect(['element_changed', 'misattributed']).toContain(garbled[0].distortion);
      expect(garbled[0].groundTruth).toBeDefined();
      expect(scoped.findings.filter(finding => finding.standing === 'true')).toHaveLength(2);
    }
  });

  it('false: NO truth reaches the plan at all - as many findings as the reach, each to be invented', () => {
    for (const fidelity of ['fragment', 'partial', 'fuller'] as const) {
      const scoped = plan('secrets', 'false', fidelity);
      expect(scoped.findings).toHaveLength(FIDELITY_REACH[fidelity]);
      for (const finding of scoped.findings) {
        expect(finding).toMatchObject({ truth: null, standing: 'false' });
        expect(finding.groundTruth).toBeUndefined();
      }
    }
    expect(plan('scheme', 'false', 'fuller').findings).toHaveLength(1);
  });

  it('an empty record is an honest nothing whatever the roll, and "no design" for a scheme', () => {
    const bare = makeEntity({ entity_id: 'bare' });
    for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
      const read = plan('secrets', accuracy, 'fuller', bare);
      expect(read.findings).toEqual([]);
      expect(read.accuracy).toBe('true');
      expect(read.withheld).toBeUndefined();
      expect(plan('scheme', accuracy, 'partial', bare).findings).toEqual([
        { truth: NO_DESIGN_TRUTH, fragmentary: false, groundTruth: NO_DESIGN_TRUTH, standing: 'true' },
      ]);
    }
  });

  // The count of findings, and whether there are any, must never tell the
  // player which accuracy they hold (D26): a false reading comes back as many
  // and as whole as the truth would have.
  it('the number and shape of findings never depend on the accuracy roll', () => {
    const shape = (read: ReturnType<typeof plan>) => read.findings.map(finding => finding.fragmentary);
    for (const kind of ['secrets', 'beliefs', 'scheme'] as GroundTruthKind[]) {
      for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
        for (let seed = 1; seed <= 12; seed++) {
          const truthful = plan(kind, 'true', fidelity, makeTarget(), seed);
          const garbled = plan(kind, 'garbled', fidelity, makeTarget(), seed);
          const falseRead = plan(kind, 'false', fidelity, makeTarget(), seed);
          expect(shape(garbled)).toEqual(shape(truthful));
          // A false reading is either the same shape as the truth, or a false "nothing".
          if (falseRead.accuracy === 'false') expect(shape(falseRead)).toEqual(shape(truthful));
          else if (kind === 'scheme') expect(falseRead.findings).toEqual([{ truth: NO_DESIGN_TRUTH, fragmentary: false, groundTruth: expect.any(String), standing: 'false' }]);
          else expect(falseRead.findings).toEqual([]);
        }
      }
    }
  });

  it('a false "nothing to find" reads as the honest one, and is recorded as false against what it hid', () => {
    let falseNothing: ReturnType<typeof plan> | undefined;
    for (let seed = 1; seed <= 40 && !falseNothing; seed++) {
      const read = plan('secrets', 'false', 'partial', makeTarget(), seed);
      if (read.findings.length === 0) falseNothing = read;
    }
    expect(falseNothing).toBeDefined();
    expect(falseNothing!.accuracy).toBe('true'); // shaped exactly as an honest nothing
    expect(falseNothing!.withheld!.length).toBeGreaterThan(0);
    const truth = investigationTruth(falseNothing!, 'target', { tier: 'success' } as never, [], 'Nothing of note.');
    expect(truth.findings).toEqual([{ text: 'Nothing of note.', standing: 'false', groundTruth: falseNothing!.withheld!.join(' | ') }]);
  });

  it('is deterministic for a seed', () => {
    expect(plan('beliefs', 'garbled', 'fuller', makeTarget(), 42)).toEqual(plan('beliefs', 'garbled', 'fuller', makeTarget(), 42));
  });
});

// ---------------------------------------------------------------------------
// The tool path: rolls -> plan -> prompt -> account + truth
// ---------------------------------------------------------------------------

describe('getInvestigationResult - grounded prompts (D47)', () => {
  // isRisky=false against the baseline target: difficulty 12. Roll 18 is a
  // success tier (+3 on both D47 rolls).
  it('true: the prompt carries the reached truths as data, and each finding the player gets carries its truth', async () => {
    pinRolls([18, 15, 8]); // success; accuracy 18 -> true; fidelity 11 -> partial (two items)
    const { ai, calls } = recordingAi(investigationReply(['One.', 'Two.', 'An invented third.']));

    const result = await getInvestigationResult(ai, makeTarget(), investigator, false, false, 'secrets');

    const prompt = everyPrompt(calls);
    expect(prompt).toContain('the truth as your agents reached it');
    const reached = SECRETS.filter(secret => prompt.includes(asPromptData(secret)));
    expect(reached).toHaveLength(2);
    // Held to one finding per planned finding: the invented third is dropped.
    expect(result.reportData).toEqual(['One.', 'Two.']);
    expect(result.truth!.findings.map(finding => finding.text)).toEqual(['One.', 'Two.']);
    expect(result.truth!.findings.every(finding => finding.standing === 'true')).toBe(true);
    expect(result.truth!.findings.map(finding => finding.groundTruth).sort()).toEqual([...reached].sort());
    expect(result.truth!.rolls).toMatchObject({ tier: 'success', accuracyRoll: 15, accuracy: 'true', fidelityRoll: 8, fidelity: 'partial' });
    expect(result.truth!.rolls.seed).toBe(result.resolutionTrace!.seed);
  });

  it('false: no truth reaches the prompt, and the account is recorded false throughout', async () => {
    pinRolls([18, 1, 15]); // success; accuracy 4 -> false; fidelity 18 -> fuller (three)
    const { ai, calls } = recordingAi(investigationReply(['A.', 'B.', 'C.']));

    const result = await getInvestigationResult(ai, makeTarget(), investigator, false, false, 'secrets');

    const prompt = everyPrompt(calls);
    for (const secret of SECRETS) expect(prompt).not.toContain(secret);
    expect(prompt).toContain('brought back no truth at all');
    expect(prompt).toContain('**FINDINGS:** none reached your agents');
    expect(result.reportData).toEqual(['A.', 'B.', 'C.']);
    expect(result.truth!.findings.every(finding => finding.standing === 'false' && finding.groundTruth === undefined)).toBe(true);
  });

  it('garbled: the prompt asks for exactly the one recorded distortion, and the code knows which finding it is', async () => {
    pinRolls([18, 6, 15]); // success; accuracy 9 -> garbled; fidelity fuller
    const { ai, calls } = recordingAi(investigationReply(['A.', 'B.', 'C.']));

    const result = await getInvestigationResult(ai, makeTarget(), investigator, false, false, 'secrets');

    const garbledIndex = result.truth!.findings.findIndex(finding => finding.standing === 'garbled');
    expect(garbledIndex).toBeGreaterThanOrEqual(0);
    expect(result.truth!.findings.filter(finding => finding.standing === 'garbled')).toHaveLength(1);
    expect(everyPrompt(calls)).toContain(`finding ${garbledIndex + 1} came back distorted`);
    expect(everyPrompt(calls)).toContain('Never signal that any finding is distorted');
  });

  it('a scheme buy reaches one fragment of the design - never its title, never the whole goal or plan', async () => {
    pinRolls([18, 15, 15]); // success; true; fuller -> a fragment of the goal
    const { ai, calls } = recordingAi(investigationReply(['A clue.', 'Another the model should not add.']));

    const result = await getInvestigationResult(ai, makeTarget(), investigator, false, false, 'scheme');

    const prompt = everyPrompt(calls);
    expect(prompt).not.toContain(SCHEME.name);
    expect(prompt).not.toContain(asPromptData(SCHEME.overall_goal));
    for (const step of SCHEME.steps) expect(prompt).not.toContain(step.objective);
    expect(prompt).toContain('(a fragment)');
    expect(result.reportData).toEqual(['A clue.']);
    expect(result.truth!.findings[0]).toMatchObject({ standing: 'true', groundTruth: SCHEME.overall_goal, schemeName: SCHEME.name });
  });

  it('an honest "nothing to find" still leaves its rolls, and its truth, for the ledger', async () => {
    pinRolls([18, 15, 8]);
    const { ai, calls } = recordingAi(investigationReply([]));
    const result = await getInvestigationResult(ai, makeTarget({ secrets: [] }), investigator, false, false, 'secrets');
    expect(everyPrompt(calls)).toContain('there was nothing of the kind to find');
    expect(result.reportData).toEqual([]);
    expect(result.truth!.findings).toEqual([{ text: 'Your agent brings word.', standing: 'true', groundTruth: NOTHING_ON_RECORD }]);
    expect(investigationLedgerEntries(result.truth!, 2, 1)[0].investigation!.rolls).toMatchObject({ accuracyRoll: 15, fidelityRoll: 8 });
  });

  it('the account the player receives carries no truth flag - the truth rides beside it', async () => {
    pinRolls([18, 6, 15]);
    const { ai } = recordingAi(investigationReply(['A.', 'B.', 'C.']));
    const { truth, resolutionTrace, ...account } = await getInvestigationResult(ai, makeTarget(), investigator, false, false, 'secrets');
    void truth; void resolutionTrace;
    const serialized = JSON.stringify(account);
    for (const token of TRUTH_FLAG_TOKENS) expect(serialized).not.toContain(token);
  });
});

describe('getDeepAnalysis - grounded in the target\'s real situation (D47)', () => {
  it('reaches the target\'s situation and aims at the rolled fidelity, never its scheme, and records one finding', async () => {
    pinRolls([15, 15]); // no tier roll: accuracy 15+3 -> true; fidelity 18 -> fuller (three facts)
    const { ai, calls } = recordingAi('He is a danger to you, by my read.');

    const { analysis, truth } = await getDeepAnalysis(ai, makeTarget(), investigator, false);

    const prompt = everyPrompt(calls);
    const facts = [SITUATION, 'Win the grain contract', 'Become consul'];
    expect(facts.filter(fact => prompt.includes(asPromptData(fact)))).toHaveLength(3);
    expect(prompt).not.toContain(SCHEME.name);
    expect(prompt).not.toContain(SCHEME.overall_goal);
    expect(analysis).toBe('He is a danger to you, by my read.');
    expect(truth).toMatchObject({ kind: 'deep_analysis', targetId: 'varro', rolls: { tier: 'success', accuracy: 'true', fidelity: 'fuller' } });
    expect(truth.findings).toHaveLength(1);
    expect(truth.findings[0]).toMatchObject({ text: analysis, standing: 'true' });
    for (const fact of facts) expect(truth.findings[0].groundTruth).toContain(fact);
  });

  it('a false reading carries no fact about them', async () => {
    pinRolls([1, 15]);
    const { ai, calls } = recordingAi('A fabricated read.');
    const { truth } = await getDeepAnalysis(ai, makeTarget(), investigator, false);
    const prompt = everyPrompt(calls);
    for (const fact of [SITUATION, 'Win the grain contract', 'Become consul']) expect(prompt).not.toContain(asPromptData(fact));
    expect(truth.findings[0].standing).toBe('false');
  });
});

describe('the sentinel: secret_truth never reaches an intelligence prompt', () => {
  const FORBIDDEN = [SECRET_TRUTH_SENTINEL, 'secret_truth', 'actually_alive', 'hidden_since_turn'];

  it('no plan, of any kind, accuracy or fidelity, builds a prompt that carries it', () => {
    const target = makeTarget();
    for (const kind of ['beliefs', 'secrets', 'scheme', 'deep_analysis'] as const) {
      for (const accuracy of ['true', 'garbled', 'false'] as const) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as const) {
          const scoped = planInvestigation(target, kind, { accuracy, fidelity }, createSeededRng(3));
          const built = kind === 'deep_analysis'
            ? buildDeepAnalysisPrompt(target, investigator, true, scoped)
            : buildInvestigationPrompt(target, investigator, kind, 'success', scoped);
          const text = `${built.systemInstruction}\n${built.prompt}`;
          for (const token of FORBIDDEN) expect(text, `${kind}/${accuracy}/${fidelity}`).not.toContain(token);
          // Nor any of the GM-private truth vocabulary.
          for (const token of TRUTH_FLAG_TOKENS) expect(text, `${kind}/${accuracy}/${fidelity}`).not.toContain(token);
        }
      }
    }
    for (const standing of ['true', 'garbled', 'false'] as const) {
      const clues: SchemeClueRecord[] = [{ text: 'A thread.', standing, schemeName: SCHEME.name }];
      const built = buildSchemeNaturePrompt(target, investigator, planSchemeNature(target, clues));
      for (const token of [...FORBIDDEN, ...TRUTH_FLAG_TOKENS]) expect(`${built.systemInstruction}\n${built.prompt}`).not.toContain(token);
    }
  });

  it('nor through the real tool path, for any aspect', async () => {
    const { ai, calls } = recordingAi(investigationReply(['A.']));
    for (const kind of ['beliefs', 'secrets', 'scheme'] as const) {
      await getInvestigationResult(ai, makeTarget(), investigator, true, false, kind);
    }
    const text = recordingAi('An assessment.');
    await getDeepAnalysis(text.ai, makeTarget(), investigator, false);
    await getSchemeNatureReading(text.ai, makeTarget(), investigator, planSchemeNature(makeTarget(), [{ text: 'A.', standing: 'true', schemeName: SCHEME.name }]), false);
    const all = `${everyPrompt(calls)}\n${everyPrompt(text.calls)}`;
    for (const token of FORBIDDEN) expect(all).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// D11 bookkeeping, and the D28 nature
// ---------------------------------------------------------------------------

function truthFor(kind: InvestigationTruth['kind'], findings: InvestigationTruth['findings']): InvestigationTruth {
  return {
    kind,
    targetId: 'varro',
    rolls: { seed: 99, tier: 'success', accuracyRoll: 15, accuracy: 'true', fidelityRoll: 8, fidelity: 'partial' },
    findings,
  };
}

describe('the truth ledger - one GM-private entry per finding (D11)', () => {
  it('records each finding\'s standing, its ground truth and the rolls, linked to the dossier aspect', () => {
    const entries = investigationLedgerEntries(truthFor('secrets', [
      { text: 'Owes the bankers.', standing: 'true', groundTruth: SECRETS[0] },
      { text: 'Poisoned his wife at Ostia.', standing: 'garbled', groundTruth: SECRETS[1], distortion: 'element_changed' },
    ]), 4, 1000);
    expect(entries).toEqual([
      {
        id: 'truth_4_intel_1000_0', turn: 4, claim: 'Owes the bankers.', aboutId: 'varro', isTrue: true,
        reportId: 'investigation:varro:secrets',
        investigation: { kind: 'secrets', standing: 'true', groundTruth: SECRETS[0], rolls: truthFor('secrets', []).rolls },
      },
      {
        id: 'truth_4_intel_1000_1', turn: 4, claim: 'Poisoned his wife at Ostia.', aboutId: 'varro', isTrue: false,
        reportId: 'investigation:varro:secrets',
        investigation: { kind: 'secrets', standing: 'garbled', groundTruth: SECRETS[1], distortion: 'element_changed', rolls: truthFor('secrets', []).rolls },
      },
    ]);
  });

  it('the GM console shows true-vs-believed for a finding: its standing, the truth, and the rolls - numbers allowed there only', async () => {
    const entries = investigationLedgerEntries(truthFor('secrets', [
      { text: 'Poisoned his wife at Ostia.', standing: 'garbled', groundTruth: SECRETS[1], distortion: 'misattributed' },
    ]), 4, 1);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<TruthLedgerView ledger={entries} reports={[]} />));
    const text = container.textContent ?? '';
    expect(text).toContain('GARBLED');
    expect(text).toContain("player holds: your agents' account");
    expect(text).toContain(SECRETS[1]);
    expect(text).toContain('misattributed');
    expect(text).toContain('accuracy d20 15 → true');
    expect(text).toContain('fidelity d20 8 → partial');
    await act(async () => root.unmount());
  });
});

describe('the D28 nature follows from the accumulated clues', () => {
  const clue = (standing: IntelAccuracy, schemeName: string | undefined = SCHEME.name): SchemeClueRecord => ({ text: `A ${standing} thread.`, standing, ...(schemeName ? { schemeName } : {}) });

  it('weighs true 1, garbled half, false nothing - and a clue about a former design nothing', () => {
    const read = (...standings: IntelAccuracy[]) => resolveSchemeNatureStanding(standings.map(s => clue(s)), SCHEME.name);
    expect(read('true', 'true', 'true')).toBe('true');
    expect(read('true', 'true', 'false')).toBe('true');
    expect(read('true', 'garbled', 'garbled')).toBe('true');
    expect(read('true', 'garbled', 'false')).toBe('garbled');
    expect(read('garbled', 'garbled', 'garbled')).toBe('garbled');
    expect(read('true', 'false', 'false')).toBe('garbled');
    expect(read('garbled', 'false', 'false')).toBe('false');
    expect(read('false', 'false', 'false')).toBe('false');
    expect(resolveSchemeNatureStanding([], SCHEME.name)).toBe('false');
    const stale = clue('true', 'A Design Since Abandoned');
    expect(resolveSchemeNatureStanding([clue('true'), clue('true'), stale], SCHEME.name)).toBe('true');
    expect(resolveSchemeNatureStanding([clue('true'), stale, stale], SCHEME.name)).toBe('garbled');
  });

  it('hands the model the true design only when the clues earned it, and none on a false trail', () => {
    const target = makeTarget();
    const truePlan = planSchemeNature(target, [clue('true'), clue('true'), clue('true')]);
    expect(truePlan).toMatchObject({ standing: 'true', design: { name: SCHEME.name, goal: SCHEME.overall_goal } });
    const garbledPlan = planSchemeNature(target, [clue('garbled'), clue('garbled'), clue('garbled')]);
    expect(garbledPlan).toMatchObject({ standing: 'garbled', distortion: 'element_changed', design: { name: SCHEME.name } });
    const falsePlan = planSchemeNature(target, [clue('false'), clue('false'), clue('garbled')]);
    expect(falsePlan.design).toBeNull();
    const prompt = buildSchemeNaturePrompt(target, investigator, falsePlan);
    expect(`${prompt.systemInstruction}${prompt.prompt}`).not.toContain(SCHEME.name);
    expect(`${prompt.systemInstruction}${prompt.prompt}`).not.toContain(SCHEME.overall_goal);
    expect(prompt.prompt).toContain(asPromptData('A false thread.'));
    const truePrompt = buildSchemeNaturePrompt(target, investigator, truePlan);
    expect(truePrompt.prompt).toContain(asPromptData(`${SCHEME.name}: ${SCHEME.overall_goal}`));
  });

  it('a target with no design: the true nature is that nothing is afoot, and it cannot be half-misread', () => {
    const bare = makeEntity({ entity_id: 'bare' });
    const noDesignClue = (standing: IntelAccuracy): SchemeClueRecord => ({ text: 'No sign of any design.', standing });
    expect(planSchemeNature(bare, [noDesignClue('true')])).toMatchObject({ standing: 'true', noDesign: true, design: null });
    expect(planSchemeNature(bare, [noDesignClue('garbled')])).toMatchObject({ standing: 'false', noDesign: false });
  });

  it('reads every clue on the ledger plus this buy\'s, and records whether the nature is the truth', async () => {
    const target = makeTarget();
    const prior = investigationLedgerEntries(truthFor('scheme', [
      { text: 'Land changed hands for the quaestor.', standing: 'true', groundTruth: SCHEME.steps[0].objective, schemeName: SCHEME.name },
      { text: 'The night watch drinks on another\'s coin.', standing: 'true', groundTruth: SCHEME.steps[1].objective, schemeName: SCHEME.name },
    ]), 2, 1);
    const { ai, calls } = recordingAi('Your agents read it plain: he means to buy the Guard with the treasury itself.');

    const settled = await settleInvestigationTruth({
      ai, isMockMode: false, target, player: investigator,
      truth: truthFor('scheme', [{ text: 'Coin is counted at the treasury by night.', standing: 'garbled', groundTruth: SCHEME.overall_goal, distortion: 'element_changed', schemeName: SCHEME.name }]),
      ledger: prior, natureDue: true, turn: 3, stamp: 2,
    });

    expect(calls).toHaveLength(1);
    for (const entry of prior) expect(calls[0].prompt).toContain(asPromptData(entry.claim));
    expect(calls[0].prompt).toContain(asPromptData('Coin is counted at the treasury by night.'));
    expect(settled.natureReading).toBe('Your agents read it plain: he means to buy the Guard with the treasury itself.');
    const nature = settled.ledgerEntries.find(entry => entry.investigation?.kind === 'scheme_nature')!;
    // true + true + garbled = 2.5 / 3 -> the true nature.
    expect(nature).toMatchObject({ claim: settled.natureReading, isTrue: true, investigation: { standing: 'true', groundTruth: `${SCHEME.name}: ${SCHEME.overall_goal}` } });
  });

  it('is not read before the reveal is due', async () => {
    const { ai, calls } = recordingAi('unused');
    const settled = await settleInvestigationTruth({
      ai, isMockMode: false, target: makeTarget(), player: investigator,
      truth: truthFor('scheme', [{ text: 'A thread.', standing: 'true', schemeName: SCHEME.name }]),
      ledger: [], natureDue: false, turn: 3, stamp: 2,
    });
    expect(calls).toHaveLength(0);
    expect(settled.natureReading).toBeUndefined();
    expect(settled.ledgerEntries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The commit: truth and account land together, and only the account is player-facing
// ---------------------------------------------------------------------------

describe('hooks/useIntelCommits - findings and their truth land in one commit', () => {
  const player = makeEntity({ entity_id: 'player', name: 'Gaius', resources: { investigations: 3, deep_analyses: 2 } });
  const live: DomainMutationContext = { isCurrent: () => true };
  const FORBIDDEN_STORE_KEYS = ['isTrue', 'standing', 'groundTruth', 'distortion', 'investigation', 'accuracy', 'fidelity', 'rolls'].map(key => `"${key}":`);

  function deps(overrides: Partial<IntelCommitsDeps> = {}) {
    const commits: DomainCommit[] = [];
    const input: IntelCommitsDeps = {
      ai: {} as GoogleGenAI,
      isMockMode: true,
      entities: [player, makeTarget()],
      playerCharacterId: 'player',
      knowledge: [],
      truthLedger: [],
      pendingIntelligenceFallout: [],
      messages: [],
      turnNumber: 4,
      buildSaveState: saved => ({ ...saved } as SaveGameState),
      commitDomainMutation: commit => { commits.push(commit); return true; },
      setTransactionNote: () => {},
      ...overrides,
    };
    return { input, commits };
  }

  it('a secrets reveal files the leverage, and writes one ledger entry per finding in the same commit', async () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    const result: InvestigationResult = { target_id: 'varro', report: 'Your agent is fairly sure.', consequences: null };
    const truth = truthFor('secrets', [
      { text: 'Owes the bankers.', standing: 'true', groundTruth: SECRETS[0] },
      { text: 'Keeps a second household at Ostia.', standing: 'false' },
    ]);
    await act(async () => { await hook.current.handleInvestigationOutcome('secrets', 'varro', ['Owes the bankers.', 'Keeps a second household at Ostia.'], 1, result, live, truth); });
    hook.unmount();

    const action = commits[0].action as { entities: Entity[]; knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };
    expect(action.truthLedger).toHaveLength(2);
    expect(action.truthLedger.map(entry => [entry.claim, entry.isTrue])).toEqual([['Owes the bankers.', true], ['Keeps a second household at Ostia.', false]]);
    expect(commits[0].candidate.truthLedger).toEqual(action.truthLedger);
    expect(action.entities.find(entity => entity.entity_id === 'player')!.resources.blackmail_on_varro)
      .toEqual(['Owes the bankers.', 'Keeps a second household at Ostia.']);
    // The player's store holds the account only - no flag, no ground truth.
    const store = JSON.stringify(action.knowledge);
    for (const key of FORBIDDEN_STORE_KEYS) expect(store).not.toContain(key);
    expect(store).not.toContain(SECRETS[0]);
  });

  it('an assessment\'s truth lands with its spend', () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    expect(hook.current.handleDeepAnalysis('varro', 1, 'He is dangerous.', live, truthFor('deep_analysis', [{ text: 'He is dangerous.', standing: 'false' }]))).toBe(true);
    hook.unmount();
    const action = commits[0].action as { truthLedger: TruthLedgerEntry[] };
    expect(action.truthLedger).toEqual([expect.objectContaining({ claim: 'He is dangerous.', isTrue: false, reportId: 'investigation:varro:deep_analysis' })]);
  });

  it('a commit without a truth (an older caller) leaves the ledger as it stands', async () => {
    const ledger: TruthLedgerEntry[] = [{ id: 'truth_1_1', turn: 1, claim: 'A rumor.', aboutId: 'varro', isTrue: false, reportId: 'r1' }];
    const { input, commits } = deps({ truthLedger: ledger });
    const hook = renderHook(useIntelCommits, input);
    await act(async () => { await hook.current.handleInvestigationOutcome('beliefs', 'varro', ['x'], 1, { target_id: 'varro', report: 'r', consequences: null }, live); });
    hook.unmount();
    expect((commits[0].action as { truthLedger: TruthLedgerEntry[] }).truthLedger).toBe(ledger);
  });

  /** Two paid clues already held, both recorded on the ledger with the given standing. */
  function twoCluesHeld(standing: IntelAccuracy): { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] } {
    let knowledge: KnowledgeClaim[] = [];
    for (const turn of [2, 3]) {
      knowledge = ingestSchemeClue(knowledge, { schemerId: 'varro', turn, source: 'spy', text: SCHEME_CLUE_LINE, advancesNature: true });
    }
    const truthLedger = investigationLedgerEntries(truthFor('scheme', [
      { text: 'Thread one.', standing, schemeName: SCHEME.name },
      { text: 'Thread two.', standing, schemeName: SCHEME.name },
    ]), 3, 1);
    return { knowledge, truthLedger };
  }

  it('the clue that reaches the reveal earns the TRUE nature when the accurate clues carried it (Mock Mode, deterministically)', async () => {
    const { input, commits } = deps(twoCluesHeld('true'));
    const hook = renderHook(useIntelCommits, input);
    const truth = truthFor('scheme', [{ text: 'Thread three.', standing: 'true', schemeName: SCHEME.name }]);
    await act(async () => { await hook.current.handleInvestigationOutcome('scheme', 'varro', ['Thread three.'], 1, { target_id: 'varro', report: 'This buy\'s own report.', consequences: null }, live, truth); });
    hook.unmount();

    const action = commits[0].action as { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };
    const discovery = deriveDossier(action.knowledge, 'varro').entries.find(entry => entry.kind === 'scheme')!.schemeDiscovery!;
    expect(discovery).toEqual({ clues: 3, revealed: true, nature: `(Mock) Your agents read the threads as one design: ${SCHEME.overall_goal}.` });
    const nature = action.truthLedger.find(entry => entry.investigation?.kind === 'scheme_nature')!;
    expect(nature).toMatchObject({ claim: discovery.nature, isTrue: true, investigation: { standing: 'true' } });
  });

  it('a false trail reveals a false nature - held by the player as their agents\' read, tracked as false on the ledger', async () => {
    const { input, commits } = deps(twoCluesHeld('false'));
    const hook = renderHook(useIntelCommits, input);
    const truth = truthFor('scheme', [{ text: 'Thread three.', standing: 'false', schemeName: SCHEME.name }]);
    await act(async () => { await hook.current.handleInvestigationOutcome('scheme', 'varro', ['Thread three.'], 1, { target_id: 'varro', report: 'r', consequences: null }, live, truth); });
    hook.unmount();

    const action = commits[0].action as { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };
    const discovery = deriveDossier(action.knowledge, 'varro').entries.find(entry => entry.kind === 'scheme')!.schemeDiscovery!;
    expect(discovery.revealed).toBe(true);
    expect(discovery.nature).not.toContain(SCHEME.overall_goal);
    const nature = action.truthLedger.find(entry => entry.investigation?.kind === 'scheme_nature')!;
    expect(nature).toMatchObject({ claim: discovery.nature, isTrue: false, investigation: { standing: 'false', groundTruth: `${SCHEME.name}: ${SCHEME.overall_goal}` } });
    const store = JSON.stringify(action.knowledge);
    for (const key of FORBIDDEN_STORE_KEYS) expect(store).not.toContain(key);
  });
});

describe('knowledge store: the nature reading (D28/D47)', () => {
  const buyThree = (natureReading?: string | null) => {
    let store: KnowledgeClaim[] = [];
    for (const turn of [1, 2]) {
      store = computeInvestigationKnowledge({ prev: store, targetId: 'varro', kind: 'scheme', reportText: 'report', turnNumber: turn });
    }
    return computeInvestigationKnowledge({
      prev: store, targetId: 'varro', kind: 'scheme', reportText: 'the last buy\'s report', turnNumber: 3,
      ...(natureReading !== undefined ? { natureReading } : {}),
    });
  };
  const natureOf = (store: KnowledgeClaim[]) => deriveDossier(store, 'varro').entries[0].schemeDiscovery!.nature;

  it('a reading is the nature; none due keeps the old report fallback; a reading due but absent is the honest pending line', () => {
    expect(natureOf(buyThree('The design, as read.'))).toBe('The design, as read.');
    expect(natureOf(buyThree())).toBe('the last buy\'s report');
    expect(natureOf(buyThree(null))).toBe(SCHEME_NATURE_UNSYNTHESIZED);
  });
});

// ---------------------------------------------------------------------------
// Leverage: the adjudicator knows which lever holds
// ---------------------------------------------------------------------------

describe('leverage from a bought secret (D47/D11)', () => {
  const ledger = investigationLedgerEntries(truthFor('secrets', [
    { text: 'Owes the bankers.', standing: 'true', groundTruth: SECRETS[0] },
    { text: 'Poisoned his wife at Ostia.', standing: 'garbled', groundTruth: SECRETS[1], distortion: 'element_changed' },
    { text: 'Keeps a second household at Ostia.', standing: 'false' },
  ]), 2, 1);
  const holder = makeEntity({
    entity_id: 'player',
    name: 'Gaius',
    resources: { blackmail_on_varro: ['Owes the bankers.', 'Poisoned his wife at Ostia.', 'Keeps a second household at Ostia.', 'Filed before D47.'] },
  });

  it('matches each filed item to its truth, and says nothing of leverage with no recorded truth', () => {
    expect(deriveLeverageTruth(holder, ledger)).toEqual([
      { targetId: 'varro', item: 'Owes the bankers.', standing: 'true', groundTruth: SECRETS[0] },
      { targetId: 'varro', item: 'Poisoned his wife at Ostia.', standing: 'garbled', groundTruth: SECRETS[1] },
      { targetId: 'varro', item: 'Keeps a second household at Ostia.', standing: 'false' },
    ]);
    // A legacy save: leverage and no ledger truth behind it.
    expect(deriveLeverageTruth(holder, [])).toEqual([]);
  });

  it('the adjudicator\'s GM-secret context carries the truth of the leverage; absent any, the prompt is unchanged', () => {
    const input = {
      worldState: makeWorldState(),
      simulationState: makeSimulationState(),
      playerEntity: holder,
      npcEntities: [makeTarget()],
      history: [],
      submission: { observableAttempt: 'Press Varro with what I know', questionOrContext: null },
      gmInterventionText: '',
      storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
      metaNarrative: 'A crisis.',
    };
    const { prompt } = buildAdjudicationPrompt({ ...input, leverageTruth: deriveLeverageTruth(holder, ledger) });
    expect(prompt).toContain("GM-SECRET: THE PLAYER'S LEVERAGE, AS IT TRULY STANDS");
    expect(prompt).toContain(`On Senator Varro (varro): ${asPromptData('Keeps a second household at Ostia.')} - FALSE`);
    expect(prompt).toContain(`${asPromptData('Poisoned his wife at Ostia.')} - GARBLED - half-true: the truth is ${asPromptData(SECRETS[1])}`);
    expect(prompt).toContain('turn the accusation back on the player');
    expect(prompt).toContain('adjudicate the attempt against what is TRUE, never against what the player believes');
    expect(prompt).not.toContain('Filed before D47.');

    expect(buildAdjudicationPrompt({ ...input, leverageTruth: [] }).prompt).toBe(buildAdjudicationPrompt(input).prompt);
    expect(buildLeverageTruthBlock(undefined, [])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Player surfaces: the dossier shows the agent's account, never its truth
// ---------------------------------------------------------------------------

describe('the dossier shows the agent\'s sourced account - never the truth behind it (D26)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const TRUE_SECRET = 'TRUE_SECRET_SENTINEL keeps a hoard beneath the Aventine';

  /** A figure whose offline secrets reading lands false (Mock Mode rolls from a seed fixed by the figure). */
  async function figureMisledAbout(): Promise<Entity> {
    for (let i = 0; i < 200; i++) {
      const candidate = makeTarget({ entity_id: `figure_${i}`, secrets: [TRUE_SECRET] });
      const result = await getInvestigationResult({} as GoogleGenAI, candidate, investigator, true, true, 'secrets');
      if (result.truth!.findings.length > 0 && result.truth!.findings.every(finding => finding.standing === 'false')) return candidate;
    }
    throw new Error('no figure found whose secrets reading lands false');
  }

  it('a false reading shows the planted story as the agent\'s account, and nothing of the truth or its flags', async () => {
    const figure = await figureMisledAbout();
    const captured: InvestigationTruth[] = [];
    const Harness: React.FC = () => {
      const [knowledge, setKnowledge] = useState<KnowledgeClaim[]>([]);
      const run: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
      return (
        <DramatisPersonaeTab
          playerEntity={{ ...investigator, resources: { investigations: 3 }, visibility_network: [figure.entity_id] }}
          entities={[investigator, figure]}
          knowledge={knowledge}
          turnNumber={4}
          runDomainMutation={run}
          ai={{} as GoogleGenAI}
          isMockMode={true}
          onSpendDeepAnalysis={() => true}
          onInvestigationOutcome={(kind, targetId, reportData, _cost, result, _request, truth) => {
            if (truth) captured.push(truth);
            setKnowledge(prev => computeInvestigationKnowledge({
              prev, targetId, kind, reportText: result.report, turnNumber: 4,
              items: Array.isArray(reportData) ? reportData.filter((item): item is string => typeof item === 'string') : undefined,
            }));
            return true;
          }}
        />
      );
    };
    await act(async () => root.render(<Harness />));
    const intel = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('Intel'))!;
    await act(async () => intel.click());
    const secretsLabel = Array.from(container.querySelectorAll('span')).find(span => span.textContent === 'Secrets')!;
    const reveal = Array.from(secretsLabel.parentElement!.querySelectorAll('button')).find(button => button.textContent?.startsWith('Reveal'))!;
    await act(async () => {
      reveal.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const text = container.textContent ?? '';
    // The GM side knows it is false...
    expect(captured).toHaveLength(1);
    expect(captured[0].findings.every(finding => finding.standing === 'false')).toBe(true);
    // ...the player sees only the agent's account of it.
    expect(text).toContain(captured[0].findings[0].text);
    expect(text).not.toContain('TRUE_SECRET_SENTINEL');
    for (const token of TRUTH_FLAG_TOKENS) expect(text).not.toContain(token);
    expect(container.innerHTML).not.toContain('TRUE_SECRET_SENTINEL');
  });
});

// ---------------------------------------------------------------------------
// State and saves
// ---------------------------------------------------------------------------

describe('the reducer and the save (compatibility)', () => {
  it('INVESTIGATION_COMMITTED lands the ledger with the reveal, and leaves it as it stands when none is carried', () => {
    const state = { ...createInitialGameState(), truthLedger: [{ id: 't0', turn: 1, claim: 'Old.', aboutId: 'x', isTrue: true, reportId: 'r0' }] };
    const entries = investigationLedgerEntries(truthFor('beliefs', [{ text: 'A belief.', standing: 'true', groundTruth: BELIEFS[0] }]), 2, 1);
    const next = gameReducer(state, { type: 'INVESTIGATION_COMMITTED', entities: [], pendingIntelligenceFallout: [], knowledge: [], truthLedger: [...state.truthLedger, ...entries] });
    expect(next.truthLedger).toHaveLength(2);
    const unchanged = gameReducer(state, { type: 'INVESTIGATION_COMMITTED', entities: [], pendingIntelligenceFallout: [], knowledge: [] });
    expect(unchanged.truthLedger).toBe(state.truthLedger);
  });

  it('round-trips a finding\'s truth through the save, and loads an older save - its leverage and dossier unflagged - unchanged', () => {
    localStorage.clear();
    const entries = investigationLedgerEntries(truthFor('secrets', [{ text: 'Owes the bankers.', standing: 'garbled', groundTruth: SECRETS[0], distortion: 'misattributed' }]), 2, 1);
    const current = makeLegacySaveState({ truthLedger: entries });
    expect(saveGame(current)).toEqual({ ok: true });
    expect(loadGame()!.state.truthLedger).toEqual(entries);

    // A save from before D47: blackmail filed, a secrets dossier held, a
    // rumor-only ledger - no truth flags anywhere.
    const legacyLedger: TruthLedgerEntry[] = [{ id: 'truth_1_1', turn: 1, claim: 'A rumor.', aboutId: 'varro', isTrue: false, reportId: 'report_1_1' }];
    const legacyKnowledge = computeInvestigationKnowledge({ prev: [], targetId: 'varro', kind: 'secrets', reportText: 'Old reading.', items: ['Old secret.'], turnNumber: 1 });
    const legacy = makeLegacySaveState({
      entities: [makeEntity({ entity_id: 'severus_alexander', resources: { investigations: 1, blackmail_on_varro: ['Old secret.'] } })],
      truthLedger: legacyLedger,
      knowledge: legacyKnowledge,
    });
    expect(saveGame(legacy)).toEqual({ ok: true });
    const loaded = loadGame()!.state;
    expect(loaded.truthLedger).toEqual(legacyLedger);
    expect(loaded.knowledge).toEqual(legacyKnowledge);
    const loadedState = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded });
    expect(loadedState.truthLedger).toEqual(legacyLedger);
    const loadedPlayer = loadedState.entities.find(entity => entity.entity_id === legacy.playerCharacterId)!;
    expect(loadedPlayer.resources.blackmail_on_varro).toEqual(['Old secret.']);
    // Leverage filed before D47 has no recorded truth: the adjudicator is told nothing about it.
    expect(deriveLeverageTruth(loadedPlayer, loadedState.truthLedger)).toEqual([]);
    expect(deriveDossier(loadedState.knowledge, 'varro').entries[0]).toMatchObject({ latestText: 'Old reading.', latestItems: ['Old secret.'] });
    localStorage.clear();
  });
});
