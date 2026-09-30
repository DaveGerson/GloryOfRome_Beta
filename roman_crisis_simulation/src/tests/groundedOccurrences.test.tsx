/**
 * @vitest-environment jsdom
 *
 * tests/groundedOccurrences.test.tsx - the Events tab's "Who is behind it?"
 * and "Who gains?" are grounded (D47) in who really acted: the turn's
 * GM-private attribution record (TurnHistoryEntry.headlineActors, D42).
 *
 * Pins, in order:
 *  - the record: paired with each committed headline by its final text, and
 *    written by the mock pipeline too (the real one: tests/turnPipeline.test.ts);
 *  - the pool planner (planFromPool): fidelity scopes, accuracy shapes, and
 *    the count and shape of findings never betray the accuracy;
 *  - the ground truth per question, read off the record in code;
 *  - the prompts, through the real tool path: the truths ride as data on a
 *    true or garbled roll and not at all on a false one; "What follows?" is a
 *    forecast with nothing hidden in it; no record is an honest nothing;
 *  - Mock Mode: deterministic, and following the same plan;
 *  - D11: the truth lands on the ledger in the same commit as the finding,
 *    and the GM console shows it;
 *  - the leak guard: the record, and the truth, never reach the player;
 *  - save compatibility: the record round-trips, survives the snapshot trim,
 *    and an old save loads unchanged into the honest "no record" path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import {
  FIDELITY_REACH,
  groundTruthPool,
  NO_HAND_TRUTH,
  occurrenceGrounding,
  occurrenceLedgerEntry,
  planFromPool,
  planInvestigation,
  assessmentTruth,
  type PoolPlan,
} from '../ai/core/groundTruth';
import { attributeHeadlines } from '../ai/core/actorsBoundary';
import { getClarificationOnEvent, NO_THREAD_TO_FOLLOW } from '../ai/tools/intelligence';
import { buildClarificationPrompt, buildOccurrenceForecastPrompt } from '../ai/prompts/intelligence';
import { asPromptData } from '../ai/prompts/fragments';
import { endTurnCapture } from '../ai/core/geminiService';
import { mockIntelSeed, mockRunNewTurn } from '../ai/mocks';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import { ingestOccurrenceFinding, occurrenceClaimKey, occurrenceFindings, type KnowledgeClaim } from '../knowledge/store';
import { createInitialGameState, gameReducer, KEEP_FULL_SNAPSHOTS, withOldSnapshotsDropped } from '../state/gameReducer';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import CurrentEventsTab from '../components/tabs/CurrentEventsTab';
import { TruthLedgerView } from '../components/gm/TruthLedgerView';
import type { DomainCommit } from '../app/transactions';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import type { HeadlineAttribution, IntelAccuracy, IntelFidelity, OccurrenceTruth, TruthLedgerEntry, TurnHistoryEntry, TurnSubmission } from '../types';
import { renderHook } from './renderHook';
import { makeAdjudication, makeEntity, makeLegacySaveState, makeTurnHistoryEntry } from './factories';
import { getMockInitialState } from './mockData';
import { INITIAL_SIMULATION_STATE } from '../constants/baseScenario';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OCCURRENCE = 'The grain fleet burns at Ostia.';
const VARRO_AIM = 'Varro buys up the grain contracts cheap.';

const player = makeEntity({ entity_id: 'player', name: 'Gaius Investigator', visibility_network: ['varro', 'crassus'] });
const varro = makeEntity({ entity_id: 'varro', name: 'Senator Varro' });
const crassus = makeEntity({ entity_id: 'crassus', name: 'Marcus Crassus' });
const stranger = makeEntity({ entity_id: 'stranger', name: 'Tiberius Obscurus' });
const roster = [player, varro, crassus, stranger];

/** One committed turn whose only headline is `text`, with the given declared hands - and Varro's and Crassus's aims that turn. */
function entryFor(actorIds: string[], text = OCCURRENCE, overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return makeTurnHistoryEntry({
    turnNumber: 3,
    adjudication: makeAdjudication({
      turn: 3,
      headlines: [text],
      entityActions: [
        { id: 'varro', intent: 'intrigue', target: null, notes: VARRO_AIM },
        // A redacted note is no aim: only the intent stands for it.
        { id: 'crassus', intent: 'tax_raise', target: null, notes: 'Something shifts, unremarked.' },
      ],
    }),
    headlineActors: [{ text, actorIds }],
    ...overrides,
  });
}

/**
 * Pins Math.random so the question's recorded seed is one whose generator's
 * FIRST draws are exactly `rolls`: an occurrence makes no operational roll,
 * so these are accuracy, fidelity, then the planner's own draws.
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

const sent = (calls: Array<{ systemInstruction: string; prompt: string }>) =>
  calls.map(call => `${call.systemInstruction}\n${call.prompt}`).join('\n');

/**
 * The truths the prompt carries as its numbered data entries - what the
 * agents reached. (The figures the master knows ride on a line of their own,
 * as public knowledge, and may name the same people.)
 */
const reachedIn = (calls: Array<{ prompt: string }>): string[] =>
  calls.flatMap(call => call.prompt.split('\n'))
    .map(line => /^\d+\. (?:\(a fragment\) )?(".*")$/.exec(line)?.[1])
    .filter((quoted): quoted is string => quoted !== undefined)
    .map(quoted => JSON.parse(quoted) as string);

/** The GM-private vocabulary: none of it may appear in a prompt whose output the player reads, nor on a player surface. */
const TRUTH_FLAG_TOKENS = ['isTrue', 'standing', 'groundTruth', 'accuracy', 'fidelity', 'garbled', 'GARBLED', 'headlineActors', 'actorIds'];

const ask = (question: 'who_is_behind_it' | 'who_gains' | 'what_follows', history: TurnHistoryEntry[], ai: GoogleGenAI, isMockMode = false, occurrence = OCCURRENCE) =>
  getClarificationOnEvent(ai, occurrence, question, player, roster, history, isMockMode);

afterEach(() => {
  vi.restoreAllMocks();
  endTurnCapture();
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('the attribution record (ai/core/actorsBoundary.ts::attributeHeadlines)', () => {
  it('pairs each committed headline with its own declaration, by exact text, in order', () => {
    const declared = [
      { text: 'A fire.', actors: ['varro', 'varro'] },
      { text: 'A riot.', actors: [] },
      { text: 'A fire.', actors: ['crassus'] },
      { text: 'Dropped later.', actors: ['stranger'] },
    ];
    const records = attributeHeadlines(declared, ['A fire.', 'A riot.', 'A fire.', 'Changed by a later pass.']);
    expect(records).toEqual([
      { text: 'A fire.', actorIds: ['varro'] },
      { text: 'A riot.', actorIds: [] },
      { text: 'A fire.', actorIds: ['crassus'] },
    ]);
    // A copy: the record never aliases the interchange it was read from.
    records[1].actorIds.push('x');
    expect(declared[1].actors).toEqual([]);
  });

  const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });
  const questionOnly = (text: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: text });
  const runMock = (submission: TurnSubmission) => {
    const state = getMockInitialState();
    const severus = state.entities.find(entity => entity.entity_id === 'severus_alexander')!;
    return mockRunNewTurn(submission, severus, 1, state.entities, state.worldState, [], '', 'A crisis.', structuredClone(INITIAL_SIMULATION_STATE), [], []);
  };

  it('Mock Mode writes it too - post-redaction, so a headline the gate dropped has none', async () => {
    const attempt = await runMock(freeform('Hold court'));
    expect(attempt.newHistoryEntry.headlineActors).toEqual([
      { text: 'Discontent grows in the Praetorian Camp as rumors of imperial weakness spread.', actorIds: [] },
      { text: 'Emperor promises bonus to Praetorian Guard.', actorIds: ['severus_alexander'] },
    ]);
    // On a no-attempt turn the declared-player headline is dropped by the gate.
    const idle = await runMock(questionOnly('What is whispered in the Curia?'));
    expect(idle.headlines).not.toContain('Emperor promises bonus to Praetorian Guard.');
    expect(idle.newHistoryEntry.headlineActors!.map(record => record.text)).toEqual(idle.headlines);
    // The committed headlines themselves stay bare text (D42).
    expect(idle.newHistoryEntry.adjudication.headlines).toEqual(idle.headlines);
  });
});

// ---------------------------------------------------------------------------
// The pool planner: fidelity scopes, accuracy shapes, and nothing betrays which
// ---------------------------------------------------------------------------

describe('planFromPool - the entry point for a pool with no target Entity', () => {
  const POOL = ['Senator Varro', 'Marcus Crassus', 'Tiberius Obscurus', 'Quintus Sertorius'];
  const plan = (pool: readonly string[], accuracy: IntelAccuracy, fidelity: IntelFidelity, seed = 7) =>
    planFromPool(pool, { accuracy, fidelity }, createSeededRng(seed));

  it('fidelity decides how many items reach the prompt - and a fragment only part of one', () => {
    const fragment = plan(POOL, 'true', 'fragment');
    expect(fragment.findings).toHaveLength(FIDELITY_REACH.fragment);
    expect(fragment.findings[0]).toMatchObject({ fragmentary: true, standing: 'true' });
    expect(fragment.findings[0].groundTruth).toContain(fragment.findings[0].truth!);
    expect(plan(POOL, 'true', 'partial').findings).toHaveLength(2);
    expect(plan(POOL, 'true', 'fuller').findings).toHaveLength(3);
    // Never more than the truth holds.
    expect(plan(POOL.slice(0, 2), 'true', 'fuller').findings).toHaveLength(2);
  });

  // The must-fix of the last review, pinned for the new entry point: the
  // count of findings, and whether there are any, never tells the player
  // which accuracy they hold (D26).
  it('parity: the number and shape of findings never depend on the accuracy roll', () => {
    const shape = (read: PoolPlan) => read.findings.map(finding => finding.fragmentary);
    for (let size = 1; size <= POOL.length; size++) {
      for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
        for (let seed = 1; seed <= 25; seed++) {
          const pool = POOL.slice(0, size);
          const truthful = plan(pool, 'true', fidelity, seed);
          const garbled = plan(pool, 'garbled', fidelity, seed);
          const falseRead = plan(pool, 'false', fidelity, seed);
          expect(shape(garbled)).toEqual(shape(truthful));
          if (falseRead.accuracy === 'false') {
            // As many, as whole or as fragmentary, as the truth - and no truth in any.
            expect(shape(falseRead)).toEqual(shape(truthful));
            expect(falseRead.findings.every(finding => finding.truth === null && finding.groundTruth === undefined)).toBe(true);
          } else {
            // A false nothing: shaped exactly as the honest one, recorded against what it hid.
            expect(falseRead).toMatchObject({ accuracy: 'true', findings: [] });
            expect(falseRead.withheld!.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('about a third of false readings on a non-empty truth come back as a false nothing', () => {
    let nothing = 0;
    for (let seed = 0; seed < 300; seed++) if (plan(POOL, 'false', 'partial', seed).findings.length === 0) nothing++;
    expect(nothing / 300).toBeGreaterThan(0.2);
    expect(nothing / 300).toBeLessThan(0.45);
  });

  it('an empty truth is an honest nothing whatever the roll', () => {
    for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
      for (let seed = 0; seed < 10; seed++) {
        expect(plan([], accuracy, 'fuller', seed)).toEqual({ accuracy: 'true', fidelity: 'fuller', findings: [] });
      }
    }
  });

  it('garbled marks exactly one item, with a distortion drawn only from those allowed', () => {
    for (let seed = 0; seed < 30; seed++) {
      const names = planFromPool(POOL, { accuracy: 'garbled', fidelity: 'fuller' }, createSeededRng(seed), ['misattributed']);
      const garbled = names.findings.filter(finding => finding.standing === 'garbled');
      expect(garbled).toHaveLength(1);
      expect(garbled[0].distortion).toBe('misattributed');
    }
  });

  it('is the very plan an itemised investigation makes - one machinery, not two', () => {
    const target = makeEntity({ secrets: ['One.', 'Two.', 'Three.', 'Four.'] });
    for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
      for (let seed = 0; seed < 10; seed++) {
        const texts = groundTruthPool(target, 'secrets').map(item => item.text);
        expect(planInvestigation(target, 'secrets', { accuracy, fidelity: 'partial' }, createSeededRng(seed)))
          .toEqual({ kind: 'secrets', ...planFromPool(texts, { accuracy, fidelity: 'partial' }, createSeededRng(seed)) });
      }
    }
  });

  it('a prose account of a false nothing is recorded false against what it hid (the assessment, too)', () => {
    const falseNothing = { kind: 'deep_analysis' as const, accuracy: 'true' as const, fidelity: 'partial' as const, findings: [], withheld: ['Deep in debt.', 'Wants the consulship.'] };
    const truth = assessmentTruth(falseNothing, 'varro', { tier: 'success' } as never, 'Nothing of note on him.');
    expect(truth.findings).toEqual([{ text: 'Nothing of note on him.', standing: 'false', groundTruth: 'Deep in debt. | Wants the consulship.' }]);
  });
});

// ---------------------------------------------------------------------------
// The ground truth, in code
// ---------------------------------------------------------------------------

describe('occurrenceGrounding - the truth per question, off the record', () => {
  const ground = (history: TurnHistoryEntry[], question: 'who_is_behind_it' | 'who_gains' = 'who_is_behind_it', occurrence = OCCURRENCE) =>
    occurrenceGrounding({ turnHistory: history, occurrence, question, roster });

  it('who is behind it: the declared hands, by display name', () => {
    expect(ground([entryFor(['varro', 'crassus'])])).toEqual({
      pool: ['Senator Varro', 'Marcus Crassus'],
      actorIds: ['varro', 'crassus'],
      groundTruth: 'Senator Varro | Marcus Crassus',
    });
  });

  it('who gains: the same hands, with their recorded aims that turn', () => {
    expect(ground([entryFor(['varro', 'crassus', 'stranger'])], 'who_gains')!.pool).toEqual([
      `Senator Varro - intrigue: ${VARRO_AIM}`,
      'Marcus Crassus - tax raise',
      // A hand with no action that turn: known to stand behind it, aim unknown.
      'Tiberius Obscurus',
    ]);
  });

  it('who gains never carries a scheme\'s title: notes that name the design fall back to the bare intent (D28)', () => {
    const schemer = makeEntity({
      entity_id: 'varro', name: 'Senator Varro',
      active_scheme: { name: 'The Silent Knife', overall_goal: 'Seize the treasury.', steps: [] },
    });
    const entry = entryFor(['varro']);
    entry.adjudication.entityActions = [{ id: 'varro', intent: 'intrigue', target: null, notes: 'Varro quietly advances the silent knife.' }];
    const grounding = occurrenceGrounding({ turnHistory: [entry], occurrence: OCCURRENCE, question: 'who_gains', roster: [player, schemer] });
    expect(grounding!.pool).toEqual(['Senator Varro - intrigue']);
    expect(JSON.stringify(grounding)).not.toMatch(/silent knife/i);
  });

  it('no hands: it arose from circumstance - that is the truth, not a gap', () => {
    expect(ground([entryFor([])])).toEqual({ pool: [], actorIds: [], groundTruth: NO_HAND_TRUTH.who_is_behind_it });
    expect(ground([entryFor([])], 'who_gains')!.groundTruth).toBe(NO_HAND_TRUTH.who_gains);
  });

  it('finds the record by exact text, newest turn first', () => {
    const older = entryFor(['crassus'], OCCURRENCE, { turnNumber: 2 });
    const newer = entryFor(['varro'], OCCURRENCE, { turnNumber: 5 });
    expect(ground([older, newer])!.pool).toEqual(['Senator Varro']);
    expect(ground([older, newer], 'who_is_behind_it', OCCURRENCE.toLowerCase())).toBeNull();
  });

  it('no record - an old save, or an entry without one - is null, never a guess', () => {
    expect(ground([])).toBeNull();
    expect(ground([makeTurnHistoryEntry({ adjudication: makeAdjudication({ headlines: [OCCURRENCE] }) })])).toBeNull();
    // A damaged save's record is read defensively.
    const damaged = { ...entryFor([]), headlineActors: [null, { text: OCCURRENCE }, 'x'] } as unknown as TurnHistoryEntry;
    expect(ground([damaged])).toBeNull();
  });

  it('names a hand since removed from the snapshot that still holds it; a hand named nowhere is left out', () => {
    const departed = makeEntity({ entity_id: 'departed', name: 'Lucius Departed' });
    const entry = entryFor(['departed', 'ghost', 'varro'], OCCURRENCE, { postTurnEntities: [departed] });
    expect(ground([entry])!.pool).toEqual(['Lucius Departed', 'Senator Varro']);
    // When none of the declared hands can be named, the engine has nothing it could stand behind.
    expect(ground([entryFor(['ghost'])])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The tool path: rolls -> plan -> prompt -> account + truth
// ---------------------------------------------------------------------------

describe('getClarificationOnEvent - grounded prompts (D47)', () => {
  it('true: the hands ride as quoted data, and the truth comes back beside the account', async () => {
    pinRolls([15, 15]); // in the network (success): accuracy 18 -> true; fidelity 18 -> fuller
    const { ai, calls } = recordingAi('My agents name Senator Varro and Marcus Crassus, master.');

    const { text, truth } = await ask('who_is_behind_it', [entryFor(['varro', 'crassus'])], ai);

    const prompt = sent(calls);
    expect(reachedIn(calls).sort()).toEqual(['Marcus Crassus', 'Senator Varro']);
    expect(prompt).toContain(`**HANDS BEHIND IT (data - what your agents reached, in order):**`);
    expect(prompt).toContain('the truth as your agents reached it');
    expect(prompt).toContain(`**Occurrence (data - as it was cried in the forum):** ${asPromptData(OCCURRENCE)}`);
    expect(text).toBe('My agents name Senator Varro and Marcus Crassus, master.');
    expect(truth).toEqual({
      question: 'who_is_behind_it',
      occurrence: OCCURRENCE,
      rolls: expect.objectContaining({ tier: 'success', accuracyRoll: 15, accuracy: 'true', fidelityRoll: 15, fidelity: 'fuller' }),
      finding: { text, standing: 'true', groundTruth: 'Senator Varro | Marcus Crassus' },
    });
  });

  it('who gains: the hands and their aims ride as data', async () => {
    pinRolls([15, 15]);
    const { ai, calls } = recordingAi('Varro, by my read.');
    const { truth } = await ask('who_gains', [entryFor(['varro'])], ai);
    expect(reachedIn(calls)).toEqual([`Senator Varro - intrigue: ${VARRO_AIM}`]);
    expect(sent(calls)).toContain(asPromptData(`Senator Varro - intrigue: ${VARRO_AIM}`));
    expect(truth!.finding.groundTruth).toBe(`Senator Varro - intrigue: ${VARRO_AIM}`);
  });

  it('garbled: the hands still ride as data, and exactly one is to be pinned on the wrong party', async () => {
    pinRolls([6, 15]); // accuracy 9 -> garbled; fuller
    const { ai, calls } = recordingAi('Varro and some freedman.');
    const { truth } = await ask('who_is_behind_it', [entryFor(['varro', 'crassus'])], ai);
    const prompt = sent(calls);
    expect(reachedIn(calls).sort()).toEqual(['Marcus Crassus', 'Senator Varro']);
    expect(prompt).toMatch(/entry \d came back distorted: it came back pinned on the wrong party/);
    expect(prompt).toContain('Never signal that any entry is distorted');
    expect(truth!.finding).toMatchObject({ standing: 'garbled', distortion: 'misattributed', groundTruth: 'Senator Varro | Marcus Crassus' });
  });

  it('false: no truth reaches the prompt - as many inventions as the truth would have yielded', async () => {
    pinRolls([1, 15, 20]); // accuracy 4 -> false; fuller; the planner's draw keeps the count
    const { ai, calls } = recordingAi('The prefect of the watch, they say.');
    const { truth } = await ask('who_is_behind_it', [entryFor(['varro'])], ai);
    const prompt = sent(calls);
    expect(reachedIn(calls)).toEqual([]);
    expect(prompt).toContain('brought back no truth at all');
    expect(prompt).toContain('Invent 1 plausible figure behind it');
    expect(prompt).toContain('**HANDS BEHIND IT:** none reached your agents');
    // What a falsehood is invented from is public knowledge only: the figures
    // the master knows - whether or not the true hand is among them.
    expect(prompt).toContain(`**Figures your master knows (data):** ${asPromptData('Senator Varro')}, ${asPromptData('Marcus Crassus')}`);
    expect(truth!.finding).toEqual({ text: 'The prefect of the watch, they say.', standing: 'false', groundTruth: 'Senator Varro' });
  });

  it('a false nothing is asked for exactly as the honest nothing is - and recorded false', async () => {
    const honest = recordingAi('No single hand, master: it arose from circumstance.');
    pinRolls([1, 15]);
    const honestAnswer = await ask('who_is_behind_it', [entryFor([])], honest.ai);
    vi.restoreAllMocks();

    const misled = recordingAi('No single hand, master: it arose from circumstance.');
    pinRolls([1, 15, 1]); // accuracy false; the planner's draw lands a false nothing
    const misledAnswer = await ask('who_is_behind_it', [entryFor(['varro'])], misled.ai);

    // The two prompts are byte-identical: nothing the model is told - and so
    // nothing the player reads - can tell the two apart.
    expect(misled.calls).toEqual(honest.calls);
    expect(sent(honest.calls)).toContain('Your agents found no single hand behind it');
    expect(reachedIn(misled.calls)).toEqual([]);
    expect(honestAnswer.truth!.finding).toMatchObject({ standing: 'true', groundTruth: NO_HAND_TRUTH.who_is_behind_it });
    expect(misledAnswer.truth!.finding).toMatchObject({ standing: 'false', groundTruth: 'Senator Varro' });
  });

  it('fidelity reads the network: strangers guard their part, so less of it is reached', async () => {
    pinRolls([15, 15]); // outside the network (partial_success): accuracy 15 -> true; fidelity 13 -> partial
    const { ai, calls } = recordingAi('Two of them, my agents think.');
    const { truth } = await ask('who_is_behind_it', [entryFor(['varro', 'crassus', 'stranger'])], ai);
    expect(truth!.rolls).toMatchObject({ tier: 'partial_success', fidelity: 'partial' });
    expect(reachedIn(calls)).toHaveLength(2);
  });

  it('a fragment reaches part of one hand, and says so', async () => {
    pinRolls([15, 1]); // true; fidelity 4 -> fragment
    const { ai, calls } = recordingAi('Only a whisper of a name.');
    await ask('who_is_behind_it', [entryFor(['varro', 'crassus'])], ai);
    const [fragment] = reachedIn(calls);
    expect(reachedIn(calls)).toHaveLength(1);
    expect(['Senator', 'Varro', 'Marcus', 'Crassus']).toContain(fragment);
    expect(sent(calls)).toContain('(a fragment)');
    expect(sent(calls)).toContain('report only that much, and never complete it');
  });

  it('no record: the honest "no thread to follow" - no call, no roll, no truth', async () => {
    const random = vi.spyOn(Math, 'random');
    const { ai, calls } = recordingAi('unused');
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      expect(await ask(question, [], ai)).toEqual({ text: NO_THREAD_TO_FOLLOW[question] });
    }
    expect(calls).toHaveLength(0);
    expect(random).not.toHaveBeenCalled();
  });

  it('what follows: a forecast, never grounded - nothing hidden reaches it, and no truth comes back', async () => {
    const { ai, calls } = recordingAi('Expect the price of bread to climb, master.');
    const answer = await ask('what_follows', [entryFor(['stranger'])], ai);
    expect(answer).toEqual({ text: 'Expect the price of bread to climb, master.' });
    const prompt = sent(calls);
    expect(prompt).not.toContain('Tiberius Obscurus');
    expect(prompt).toContain('forecast');
    expect(prompt).toContain('state no hidden fact as known');
    for (const token of TRUTH_FLAG_TOKENS) expect(prompt).not.toContain(token);
  });

  it('holds a grounded account to the mechanics boundary', async () => {
    pinRolls([15, 15]);
    await expect(ask('who_is_behind_it', [entryFor(['varro'])], recordingAi('The roll total was 7.').ai))
      .rejects.toThrow('player-visible mechanics boundary');
  });
});

describe('the occurrence prompts carry no GM-private vocabulary, no roll, for any plan', () => {
  it('whatever the question, accuracy and fidelity', () => {
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
          for (const pool of [[], ['Senator Varro', 'Marcus Crassus']]) {
            const built = buildClarificationPrompt(OCCURRENCE, question, player, ['Senator Varro'], planFromPool(pool, { accuracy, fidelity }, createSeededRng(3)));
            const text = `${built.systemInstruction}\n${built.prompt}`;
            for (const token of TRUTH_FLAG_TOKENS) expect(text, `${question}/${accuracy}/${fidelity}`).not.toContain(token);
            expect(text).not.toMatch(/\broll(?:ed)?\b/i);
            expect(built.systemInstruction).toContain('your master may choose to distrust - never as settled fact');
            expect(built.systemInstruction).toContain('no numbers');
          }
        }
      }
    }
    const forecast = buildOccurrenceForecastPrompt(OCCURRENCE, player, ['Senator Varro']);
    for (const token of TRUTH_FLAG_TOKENS) expect(`${forecast.systemInstruction}\n${forecast.prompt}`).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// Mock Mode: the same path, deterministically
// ---------------------------------------------------------------------------

describe('Mock Mode - deterministic, and following the same plan', () => {
  it('the same question about the same occurrence lands the same way, from a seed fixed by both, never Math.random', async () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random touched'); });
    const history = [entryFor(['varro', 'crassus'])];
    const first = await ask('who_is_behind_it', history, {} as GoogleGenAI, true);
    const again = await ask('who_is_behind_it', history, {} as GoogleGenAI, true);
    expect(again).toEqual(first);
    expect(first.truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_is_behind_it'));
    const gains = await ask('who_gains', history, {} as GoogleGenAI, true);
    expect(gains.truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_gains'));
    expect(random).not.toHaveBeenCalled();
  });

  it('an occurrence with no single hand reads as the honest nothing, whatever it rolled', async () => {
    for (let i = 0; i < 12; i++) {
      const occurrence = `A quiet week, the ${i}th.`;
      const answer = await ask('who_is_behind_it', [entryFor([], occurrence)], {} as GoogleGenAI, true, occurrence);
      expect(answer.text).toBe('(Mock) Your agents find no single hand behind it: it arose from circumstance.');
      expect(answer.truth!.finding.standing).toBe('true');
    }
  });

  it('parity offline: a false account names as many hands as the truth would have, or none at all', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const occurrence = `Occurrence number ${i} is cried.`;
      const { text, truth } = await ask('who_is_behind_it', [entryFor(['varro', 'crassus', 'stranger'], occurrence)], {} as GoogleGenAI, true, occurrence);
      const named = text.includes('name the hand') ? text.slice(text.indexOf(': ') + 2).split('; ').length : 0;
      const reach = Math.min(FIDELITY_REACH[truth!.rolls.fidelity], 3);
      const standing = truth!.finding.standing;
      seen.add(`${standing}:${named === 0 ? 'none' : 'some'}`);
      if (named === 0) expect(standing, occurrence).toBe('false'); // only ever a false nothing: the truth is not empty
      else expect(named, occurrence).toBe(reach);
    }
    // The sweep reached true, garbled and false accounts alike.
    expect(seen).toContain('true:some');
    expect(seen).toContain('garbled:some');
    expect(seen).toContain('false:some');
  });

  it('"What follows?" offline is a forecast, and carries no truth', async () => {
    const answer = await ask('what_follows', [entryFor(['varro'])], {} as GoogleGenAI, true);
    expect(answer.truth).toBeUndefined();
    expect(answer.text).toContain('forecast');
    expect(answer.text).not.toContain('Senator Varro');
  });
});

// ---------------------------------------------------------------------------
// D11: the truth lands with the finding, in one commit; the GM console shows it
// ---------------------------------------------------------------------------

function truthOf(standing: IntelAccuracy, text = 'Varro, they say.'): OccurrenceTruth {
  return {
    question: 'who_is_behind_it',
    occurrence: OCCURRENCE,
    rolls: { seed: 99, tier: 'success', accuracyRoll: 15, accuracy: standing, fidelityRoll: 8, fidelity: 'partial' },
    finding: { text, standing, groundTruth: 'Senator Varro | Marcus Crassus', ...(standing === 'garbled' ? { distortion: 'misattributed' as const } : {}) },
  };
}

describe('the truth ledger and the atomic commit (hooks/useIntelCommits.ts)', () => {
  const live: DomainMutationContext = { isCurrent: () => true };
  const FORBIDDEN_STORE_KEYS = ['isTrue', 'standing', 'groundTruth', 'distortion', 'investigation', 'accuracy', 'fidelity', 'rolls', 'headlineActors', 'actorIds'].map(key => `"${key}"`);

  function deps(overrides: Partial<IntelCommitsDeps> = {}) {
    const commits: DomainCommit[] = [];
    const input: IntelCommitsDeps = {
      ai: {} as GoogleGenAI,
      isMockMode: true,
      entities: roster,
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

  it('records the finding\'s truth, linked to its claim, in the same commit as the finding', () => {
    const prior: TruthLedgerEntry = { id: 'truth_1_1', turn: 1, claim: 'A rumor.', aboutId: 'varro', isTrue: false, reportId: 'r1' };
    const { input, commits } = deps({ truthLedger: [prior] });
    const hook = renderHook(useIntelCommits, input);
    const truth = truthOf('garbled', 'Varro and a freedman of his.');
    expect(hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_is_behind_it', truth.finding.text, live, truth)).toBe(true);
    hook.unmount();

    expect(commits).toHaveLength(1);
    const action = commits[0].action as { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };
    expect(action.truthLedger).toEqual([prior, {
      id: expect.stringMatching(/^truth_4_occurrence_\d+_who_is_behind_it$/),
      turn: 4,
      claim: 'Varro and a freedman of his.',
      aboutId: 'world',
      isTrue: false,
      reportId: occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'),
      investigation: {
        kind: 'occurrence', standing: 'garbled', groundTruth: 'Senator Varro | Marcus Crassus', distortion: 'misattributed',
        rolls: truth.rolls, question: 'who_is_behind_it', occurrence: OCCURRENCE,
      },
    }]);
    expect(commits[0].candidate.truthLedger).toEqual(action.truthLedger);
    // The finding itself is the player's, and carries nothing of its truth.
    expect(occurrenceFindings(action.knowledge, OCCURRENCE)).toEqual([{ question: 'who_is_behind_it', text: 'Varro and a freedman of his.', turn: 4 }]);
    const store = JSON.stringify(action.knowledge);
    for (const key of FORBIDDEN_STORE_KEYS) expect(store).not.toContain(key);
    expect(store).not.toContain('Marcus Crassus');
  });

  it('a forecast, or the honest "no thread to follow", leaves the ledger as it stands', () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    hook.current.handleOccurrenceFinding(OCCURRENCE, 'what_follows', 'Bread will be dear.', live);
    hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_gains', NO_THREAD_TO_FOLLOW.who_gains, live);
    hook.unmount();
    for (const commit of commits) {
      expect(commit.action).not.toHaveProperty('truthLedger');
      expect(commit.candidate).not.toHaveProperty('truthLedger');
    }
  });

  it('a stale request commits nothing - neither the finding nor its truth', () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    expect(hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_is_behind_it', 'x', { isCurrent: () => false }, truthOf('true'))).toBe(false);
    hook.unmount();
    expect(commits).toEqual([]);
  });

  it('the GM console shows it: the question, the occurrence, its standing, the truth and the rolls', async () => {
    const entry = occurrenceLedgerEntry(truthOf('false', 'The prefect of the watch.'), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 1);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<TruthLedgerView ledger={[entry]} reports={[]} />));
    const text = container.textContent ?? '';
    expect(text).toContain('FALSE');
    expect(text).toContain("player holds: your agents' account");
    expect(text).toContain('The prefect of the watch.');
    expect(text).toContain('occurrence question · who is behind it?');
    expect(text).toContain(`asked of: “${OCCURRENCE}”`);
    expect(text).toContain('truth: “Senator Varro | Marcus Crassus”');
    expect(text).toContain('accuracy d20 15 → false');
    await act(async () => root.unmount());
  });
});

// ---------------------------------------------------------------------------
// The leak guard: the Events tab shows the agents' account, never its truth
// ---------------------------------------------------------------------------

describe('the Events tab shows the agents\' sourced account - never the record or the truth (D26)', () => {
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
    localStorage.clear();
  });

  const hand = makeEntity({ entity_id: 'sentinel_hand', name: 'SENTINEL_HAND Aurelius' });

  /** An occurrence whose offline "Who is behind it?" reading lands false with names (Mock Mode rolls from a seed fixed by the occurrence). */
  async function occurrenceMisread(): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const occurrence = `The aqueduct fails, the ${i}th time.`;
      const { text, truth } = await getClarificationOnEvent({} as GoogleGenAI, occurrence, 'who_is_behind_it', player, [...roster, hand], [entryFor(['sentinel_hand'], occurrence)], true);
      if (truth!.finding.standing === 'false' && text.includes('name the hand')) return occurrence;
    }
    throw new Error('no occurrence found whose reading lands false');
  }

  it('a false reading shows the planted story as the agents\' account, and nothing of the truth, its flags or the record', async () => {
    const occurrence = await occurrenceMisread();
    const history = [entryFor(['sentinel_hand'], occurrence)];
    const captured: Array<OccurrenceTruth | undefined> = [];
    const Harness: React.FC = () => {
      const [knowledge, setKnowledge] = useState<KnowledgeClaim[]>([]);
      const run: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
      return (
        <CurrentEventsTab
          events={[occurrence]} week={3} playerEntity={player} allEntities={[...roster, hand]} turnHistory={history}
          knowledge={knowledge} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={run}
          onFinding={(asked, question, text, _request, truth) => {
            captured.push(truth);
            setKnowledge(prev => ingestOccurrenceFinding(prev, { occurrence: asked, question, text, turn: 3 }));
            return true;
          }}
        />
      );
    };
    await act(async () => root.render(<Harness />));
    const toggle = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(occurrence))!;
    await act(async () => toggle.click());
    const question = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Who is behind it?')!;
    await act(async () => {
      question.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The GM side knows it is false...
    expect(captured).toHaveLength(1);
    expect(captured[0]!.finding).toMatchObject({ standing: 'false', groundTruth: 'SENTINEL_HAND Aurelius' });
    // ...the player sees only the agents' account of it, in its own register.
    const finding = container.querySelector('.gor-finding')!;
    expect(finding.textContent).toContain('Your agents · who is behind it');
    expect(finding.textContent).toContain(captured[0]!.finding.text);
    expect(container.innerHTML).not.toContain('SENTINEL_HAND');
    for (const token of TRUTH_FLAG_TOKENS) expect(container.textContent).not.toContain(token);
  });

  it('an occurrence with no record answers honestly, and costs nothing new', async () => {
    const onFinding = vi.fn(() => true);
    const run: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
    await act(async () => root.render(
      <CurrentEventsTab events={[OCCURRENCE]} week={3} playerEntity={player} allEntities={roster} turnHistory={[]}
        knowledge={[]} ai={{} as GoogleGenAI} isMockMode={false} runDomainMutation={run} onFinding={onFinding} />,
    ));
    const toggle = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(OCCURRENCE))!;
    await act(async () => toggle.click());
    const question = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Who gains?')!;
    await act(async () => {
      question.click();
      await Promise.resolve();
    });
    // No key needed, no model asked: `ai` here would throw on any call.
    expect(onFinding).toHaveBeenCalledWith(OCCURRENCE, 'who_gains', NO_THREAD_TO_FOLLOW.who_gains, expect.anything(), undefined);
  });
});

// ---------------------------------------------------------------------------
// State and saves
// ---------------------------------------------------------------------------

describe('the record in state and saves (compatibility)', () => {
  const records: HeadlineAttribution[] = [{ text: OCCURRENCE, actorIds: ['varro'] }];

  it('is kept on every entry - the snapshot trim leaves it, since Examined reaches older occurrences', () => {
    const history = Array.from({ length: KEEP_FULL_SNAPSHOTS + 3 }, (_, i) => entryFor(['varro'], `Occurrence ${i}.`, {
      turnNumber: i + 1,
      postTurnEntities: [varro],
      npcMindResults: [],
    }));
    const trimmed = withOldSnapshotsDropped(history);
    expect(trimmed[0].postTurnEntities).toBeUndefined();
    expect(trimmed.map(entry => entry.headlineActors)).toEqual(history.map(entry => entry.headlineActors));
  });

  it('round-trips through the save with the occurrence\'s ledger entry, and loads into the reducer', () => {
    localStorage.clear();
    const ledger = [occurrenceLedgerEntry(truthOf('true'), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 1)];
    const save = makeLegacySaveState({ turnHistory: [entryFor(['varro'])], truthLedger: ledger });
    expect(saveGame(save)).toEqual({ ok: true });
    const loaded = loadGame()!.state;
    expect(loaded.turnHistory[0].headlineActors).toEqual(records);
    expect(loaded.truthLedger).toEqual(ledger);
    const state = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded });
    expect(state.turnHistory[0].headlineActors).toEqual(records);
    localStorage.clear();
  });

  it('an older save - no record anywhere - loads unchanged, and its occurrences take the honest "no record" path', async () => {
    localStorage.clear();
    const legacyEntry = makeTurnHistoryEntry({ turnNumber: 3, adjudication: makeAdjudication({ headlines: [OCCURRENCE] }) });
    const legacy = makeLegacySaveState({ turnHistory: [legacyEntry], currentEvents: [OCCURRENCE] });
    expect(saveGame(legacy)).toEqual({ ok: true });
    const loaded = loadGame()!.state;
    expect(loaded.turnHistory).toEqual([legacyEntry]);
    expect(loaded.turnHistory[0]).not.toHaveProperty('headlineActors');

    const { ai, calls } = recordingAi('unused');
    expect(await getClarificationOnEvent(ai, OCCURRENCE, 'who_is_behind_it', player, roster, loaded.turnHistory, false))
      .toEqual({ text: NO_THREAD_TO_FOLLOW.who_is_behind_it });
    expect(calls).toHaveLength(0);
    localStorage.clear();
  });
});
