/**
 * @vitest-environment jsdom
 *
 * tests/groundedOccurrences.test.tsx - the Events tab's "Who is behind it?"
 * and "Who gains?" are grounded (D47) in who really acted: the turn's
 * GM-private attribution record (TurnHistoryEntry.headlineActors, D42).
 *
 * Pins, in order:
 *  - the record: paired with each committed headline by its final text, its
 *    names frozen at commit, written by the mock pipeline too (the real one:
 *    tests/turnPipeline.test.ts); the lookup pools a headline cried twice;
 *  - the truth per question - hands, and for "Who gains?" their intents only,
 *    never an action's notes (D28);
 *  - the plan (planOccurrence): count and shape never betray the accuracy,
 *    code picks every decoy - never a true hand, never a figure the player
 *    does not know - and "came back empty" is decided once per occurrence;
 *  - the prompts, through the real tool path: one instruction whatever the
 *    reading, the rolls read off the public headline only; "What follows?"
 *    untouched; no record is an honest "no thread";
 *  - Mock Mode: deterministic, following the same plan, in the game's words;
 *  - D11: the truth lands in the same commit as the finding; the ledger's cap
 *    evicts free answers first; the GM console shows what was planned;
 *  - the leak guard, and save compatibility.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import {
  AIM_PHRASE,
  assessmentTruth,
  FIDELITY_REACH,
  NO_HAND_TRUTH,
  occurrenceGrounding,
  occurrenceLedgerEntry,
  planInvestigation,
  planOccurrence,
  siblingOccurrenceOutcome,
  type OccurrenceGrounding,
  type OccurrencePlan,
  type OccurrencePlanContext,
} from '../ai/core/groundTruth';
import { appendTruthLedgerEntries, MAX_TRUTH_LEDGER_ENTRIES } from '../ai/core/engine';
import { attributeHeadlines } from '../ai/core/actorsBoundary';
import { getClarificationOnEvent, NO_THREAD_TO_FOLLOW } from '../ai/tools/intelligence';
import { buildClarificationPrompt, buildOccurrenceForecastPrompt } from '../ai/prompts/intelligence';
import { asPromptData } from '../ai/prompts/fragments';
import { endTurnCapture } from '../ai/core/geminiService';
import { mockIntelSeed, mockRunNewTurn } from '../ai/mocks';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import { ingestOccurrenceFinding, occurrenceClaimKey, occurrenceFindings, type KnowledgeClaim, type OccurrenceQuestion } from '../knowledge/store';
import { createInitialGameState, gameReducer, KEEP_FULL_SNAPSHOTS, withOldSnapshotsDropped } from '../state/gameReducer';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import CurrentEventsTab from '../components/tabs/CurrentEventsTab';
import { TruthLedgerView } from '../components/gm/TruthLedgerView';
import type { DomainCommit } from '../app/transactions';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import {
  EntityActionIntentEnum,
  type EntityActionIntent,
  type GroundedOccurrenceQuestion,
  type HeadlineAttribution,
  type IntelAccuracy,
  type IntelFidelity,
  type OccurrenceSiblingOutcome,
  type OccurrenceTruth,
  type TruthLedgerEntry,
  type TurnHistoryEntry,
  type TurnSubmission,
} from '../types';
import { renderHook } from './renderHook';
import { makeAdjudication, makeEntity, makeLegacySaveState, makeTurnHistoryEntry } from './factories';
import { getMockInitialState } from './mockData';
import { INITIAL_SIMULATION_STATE } from '../constants/baseScenario';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A headline that names no one: the rolls read at the network standing. */
const OCCURRENCE = 'The grain fleet burns at Ostia.';
/** Sentinels: an action's notes - a secret move, and one restating the scheme's goal - must never leave the GM side. */
const SECRET_NOTE = 'NOTE_SENTINEL hires a Sicarius to kill Gaius at the baths';
const GOAL_NOTE = 'GOAL_SENTINEL seize the treasury before the Ides';

const NAMES: Record<string, string> = {
  player: 'Gaius Investigator',
  varro: 'Senator Varro',
  crassus: 'Marcus Crassus',
  livia: 'Livia Drusilla',
  quintus: 'Quintus Sertorius',
  stranger: 'Tiberius Obscurus',
  hidden: 'Aulus Hidden',
};
const player = makeEntity({ entity_id: 'player', name: NAMES.player, visibility_network: ['varro', 'crassus', 'livia', 'quintus'] });
/** On the roster, but figures the player has never learned of: never a decoy. */
const UNKNOWN_TO_PLAYER = ['stranger', 'hidden'];
const roster = Object.entries(NAMES).map(([entity_id, name]) => entity_id === 'player' ? player : makeEntity({ entity_id, name }));
const KNOWN = ['varro', 'crassus', 'livia', 'quintus'].map(id => ({ id, name: NAMES[id] }));

/** One committed turn crying `text`, its hands frozen with their names - and what Varro and Crassus did that turn. */
function entryFor(actorIds: string[], text = OCCURRENCE, overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return makeTurnHistoryEntry({
    turnNumber: 3,
    adjudication: makeAdjudication({
      turn: 3,
      headlines: [text],
      entityActions: [
        { id: 'varro', intent: 'intrigue', target: 'player', notes: SECRET_NOTE },
        { id: 'varro', intent: 'assassinate', target: 'player', notes: GOAL_NOTE },
        { id: 'varro', intent: 'intrigue', target: null, notes: 'Again, by night.' },
        { id: 'crassus', intent: 'tax_raise', target: null, notes: 'Crassus squeezes the tax farmers.' },
      ],
    }),
    headlineActors: [{ text, actorIds, actorNames: actorIds.map(id => NAMES[id]) }],
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

/** The names the prompt's numbered entries carry (a stranger reads as null). */
const namesIn = (calls: Array<{ prompt: string }>): Array<string | null> =>
  calls.flatMap(call => call.prompt.split('\n'))
    .map(line => /^\d+\. (?:\(a fragment\) )?("[^"]*"|\(a stranger\))/.exec(line)?.[1])
    .filter((token): token is string => token !== undefined)
    .map(token => token === '(a stranger)' ? null : JSON.parse(token) as string);

/** The GM-private vocabulary: none of it may appear in a prompt whose output the player reads, nor on a player surface. */
const TRUTH_FLAG_TOKENS = ['isTrue', 'standing', 'groundTruth', 'accuracy', 'fidelity', 'garbled', 'GARBLED', 'headlineActors', 'actorIds', 'actorNames', 'heldToSibling', 'cameBackEmpty'];
const SENTINELS = ['NOTE_SENTINEL', 'GOAL_SENTINEL', 'Sicarius', 'treasury'];

const ask = (
  question: OccurrenceQuestion,
  history: TurnHistoryEntry[],
  ai: GoogleGenAI,
  options: { isMockMode?: boolean; occurrence?: string; sibling?: OccurrenceSiblingOutcome | null } = {},
) => getClarificationOnEvent(ai, options.occurrence ?? OCCURRENCE, question, player, roster, history, options.isMockMode ?? false, options.sibling ?? null);

const context = (overrides: Partial<OccurrencePlanContext> = {}): OccurrencePlanContext => ({ playerId: 'player', knownFigures: KNOWN, sibling: null, ...overrides });

/** A grounding straight off `entryFor`. */
const grounding = (actorIds: string[], question: GroundedOccurrenceQuestion): OccurrenceGrounding =>
  occurrenceGrounding({ turnHistory: [entryFor(actorIds)], occurrence: OCCURRENCE, question, roster })!;

const plan = (actorIds: string[], question: GroundedOccurrenceQuestion, accuracy: IntelAccuracy, fidelity: IntelFidelity, seed = 7, overrides: Partial<OccurrencePlanContext> = {}): OccurrencePlan =>
  planOccurrence(grounding(actorIds, question), question, { accuracy, fidelity }, createSeededRng(seed), context(overrides));

afterEach(() => {
  vi.restoreAllMocks();
  endTurnCapture();
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('the attribution record (ai/core/actorsBoundary.ts::attributeHeadlines)', () => {
  const post = [makeEntity({ entity_id: 'varro', name: 'Senator Varro' }), makeEntity({ entity_id: 'crassus', name: 'Marcus Crassus' })];
  // A figure the turn itself removed: only the pre-turn roster still holds them.
  const pre = [...post, makeEntity({ entity_id: 'departed', name: 'Lucius Departed' })];

  it('pairs each committed headline with its own declaration by exact text, and freezes each hand\'s name', () => {
    const declared = [
      { text: 'A fire.', actors: ['varro', 'varro', 'departed'] },
      { text: 'A riot.', actors: [] },
      { text: 'A fire.', actors: ['crassus'] },
      { text: 'Dropped later.', actors: ['crassus'] },
    ];
    const records = attributeHeadlines(declared, ['A fire.', 'A riot.', 'A fire.', 'Changed by a later pass.'], [post, pre]);
    expect(records).toEqual([
      { text: 'A fire.', actorIds: ['varro', 'departed'], actorNames: ['Senator Varro', 'Lucius Departed'] },
      { text: 'A riot.', actorIds: [], actorNames: [] },
      { text: 'A fire.', actorIds: ['crassus'], actorNames: ['Marcus Crassus'] },
    ]);
    // A copy: the record never aliases the interchange it was read from.
    records[1].actorIds.push('x');
    expect(declared[1].actors).toEqual([]);
  });

  it('drops a hand that names no one at commit - a declaration of hands that are no one is circumstance', () => {
    expect(attributeHeadlines([{ text: 'A fire.', actors: ['ghost', 'phantom'] }], ['A fire.'], [post, pre]))
      .toEqual([{ text: 'A fire.', actorIds: [], actorNames: [] }]);
  });

  const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });
  const questionOnly = (text: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: text });
  const runMock = (submission: TurnSubmission) => {
    const state = getMockInitialState();
    const severus = state.entities.find(entity => entity.entity_id === 'severus_alexander')!;
    return mockRunNewTurn(submission, severus, 1, state.entities, state.worldState, [], '', 'A crisis.', structuredClone(INITIAL_SIMULATION_STATE), [], []);
  };

  it('Mock Mode writes it too, names frozen - post-redaction, so a headline the gate dropped has none', async () => {
    const attempt = await runMock(freeform('Hold court'));
    expect(attempt.newHistoryEntry.headlineActors).toEqual([
      { text: 'Discontent grows in the Praetorian Camp as rumors of imperial weakness spread.', actorIds: [], actorNames: [] },
      { text: 'Emperor promises bonus to Praetorian Guard.', actorIds: ['severus_alexander'], actorNames: ['Severus Alexander'] },
    ]);
    const idle = await runMock(questionOnly('What is whispered in the Curia?'));
    expect(idle.headlines).not.toContain('Emperor promises bonus to Praetorian Guard.');
    expect(idle.newHistoryEntry.headlineActors!.map(record => record.text)).toEqual(idle.headlines);
    expect(idle.newHistoryEntry.adjudication.headlines).toEqual(idle.headlines);
  });
});

// ---------------------------------------------------------------------------
// The ground truth, in code
// ---------------------------------------------------------------------------

describe('occurrenceGrounding - the truth per question, off the record', () => {
  const ground = (history: TurnHistoryEntry[], question: GroundedOccurrenceQuestion = 'who_is_behind_it', occurrence = OCCURRENCE) =>
    occurrenceGrounding({ turnHistory: history, occurrence, question, roster });

  it('who is behind it: the hands, by the names frozen at commit', () => {
    expect(ground([entryFor(['varro', 'crassus'])])).toEqual({
      hands: [{ id: 'varro', name: 'Senator Varro', aims: [] }, { id: 'crassus', name: 'Marcus Crassus', aims: [] }],
      groundTruth: 'Senator Varro | Marcus Crassus',
    });
  });

  it('who gains: the same hands with their INTENTS only, deduplicated - never an action\'s notes or target (D28)', () => {
    const truth = ground([entryFor(['varro', 'crassus', 'stranger'])], 'who_gains')!;
    expect(truth.hands).toEqual([
      { id: 'varro', name: 'Senator Varro', aims: ['intrigue', 'assassinate'] },
      { id: 'crassus', name: 'Marcus Crassus', aims: ['tax_raise'] },
      { id: 'stranger', name: 'Tiberius Obscurus', aims: [] },
    ]);
    expect(truth.groundTruth).toBe(`Senator Varro: ${AIM_PHRASE.intrigue}; ${AIM_PHRASE.assassinate} | Marcus Crassus: ${AIM_PHRASE.tax_raise} | Tiberius Obscurus: no aim learned`);
    const serialized = JSON.stringify(truth);
    for (const sentinel of [...SENTINELS, 'player', 'squeezes']) expect(serialized).not.toContain(sentinel);
  });

  it('no hands: it arose from circumstance - that is the truth, not a gap', () => {
    expect(ground([entryFor([])])).toEqual({ hands: [], groundTruth: NO_HAND_TRUTH.who_is_behind_it });
    expect(ground([entryFor([])], 'who_gains')!.groundTruth).toBe(NO_HAND_TRUTH.who_gains);
  });

  it('frozen names hold a reign later, whoever has left the roster and every snapshot since', () => {
    const departed = entryFor(['departed'], OCCURRENCE, { headlineActors: [{ text: OCCURRENCE, actorIds: ['departed'], actorNames: ['Lucius Departed'] }] });
    expect(ground([departed])!.hands).toEqual([{ id: 'departed', name: 'Lucius Departed', aims: [] }]);
  });

  it('pools every record of the same text on the newest turn that holds it, in declared order, once each', () => {
    const twice = entryFor([], OCCURRENCE, {
      headlineActors: [
        { text: OCCURRENCE, actorIds: ['varro'], actorNames: ['Senator Varro'] },
        { text: 'Another.', actorIds: ['livia'], actorNames: ['Livia Drusilla'] },
        { text: OCCURRENCE, actorIds: ['crassus', 'varro'], actorNames: ['Marcus Crassus', 'Senator Varro'] },
      ],
    });
    expect(ground([twice])!.hands.map(hand => hand.id)).toEqual(['varro', 'crassus']);
    // An older turn's record of the same text gives way to the newest.
    const older = entryFor(['livia'], OCCURRENCE, { turnNumber: 1 });
    expect(ground([older, twice])!.hands.map(hand => hand.id)).toEqual(['varro', 'crassus']);
    expect(ground([older, twice], 'who_is_behind_it', OCCURRENCE.toLowerCase())).toBeNull();
  });

  it('null only for a truly absent record; a record written before names were frozen is named from the roster, else a snapshot', () => {
    expect(ground([])).toBeNull();
    expect(ground([makeTurnHistoryEntry({ adjudication: makeAdjudication({ headlines: [OCCURRENCE] }) })])).toBeNull();
    const damaged = { ...entryFor([]), headlineActors: [null, { text: OCCURRENCE }, 'x'] } as unknown as TurnHistoryEntry;
    expect(ground([damaged])).toBeNull();

    const unfrozen = (ids: string[], extra: Partial<TurnHistoryEntry> = {}) =>
      entryFor(ids, OCCURRENCE, { headlineActors: [{ text: OCCURRENCE, actorIds: ids }], ...extra });
    expect(ground([unfrozen(['varro', 'departed', 'ghost'], { postTurnEntities: [makeEntity({ entity_id: 'departed', name: 'Lucius Departed' })] })])!.hands.map(hand => hand.name))
      .toEqual(['Senator Varro', 'Lucius Departed']);
    // Hands named nowhere read as circumstance - never as "no thread".
    expect(ground([unfrozen(['ghost'])])).toEqual({ hands: [], groundTruth: NO_HAND_TRUTH.who_is_behind_it });
  });
});

// ---------------------------------------------------------------------------
// The plan: shape parity, code-picked decoys, one "came back empty" per occurrence
// ---------------------------------------------------------------------------

describe('planOccurrence - count and shape never betray the accuracy; code picks every decoy', () => {
  const shape = (read: OccurrencePlan) => read.findings.map(finding => [finding.fragmentary, finding.hand!.aims.length]);
  const HAND_SETS = [['varro'], ['stranger'], ['varro', 'crassus'], ['varro', 'crassus', 'stranger'], ['crassus', 'stranger', 'player']];

  it('parity: true, garbled and false readings carry as many entries, of the same shape - or a false nothing', () => {
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      for (const hands of HAND_SETS) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
          for (let seed = 1; seed <= 25; seed++) {
            const truthful = plan(hands, question, 'true', fidelity, seed);
            const garbled = plan(hands, question, 'garbled', fidelity, seed);
            const falseRead = plan(hands, question, 'false', fidelity, seed);
            expect(shape(garbled)).toEqual(shape(truthful));
            expect(truthful.findings).toHaveLength(Math.min(FIDELITY_REACH[fidelity], hands.length));
            if (falseRead.accuracy === 'false') {
              expect(shape(falseRead)).toEqual(shape(truthful));
              expect(falseRead.withheld!.length).toBe(truthful.findings.length);
            } else {
              expect(falseRead).toMatchObject({ accuracy: 'true', findings: [] });
              expect(falseRead.withheld!.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it('a decoy is never a true hand, never the player, and never a roster figure the player does not know', () => {
    const knownNames = KNOWN.map(figure => figure.name);
    const trueNames = (hands: string[]) => hands.map(id => NAMES[id]);
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      for (const hands of HAND_SETS) {
        for (const accuracy of ['garbled', 'false'] as IntelAccuracy[]) {
          for (let seed = 0; seed < 40; seed++) {
            const read = plan(hands, question, accuracy, 'fuller', seed);
            // Every name code put in a true hand's place (a changed aim keeps its true name).
            for (const finding of read.findings.filter(candidate => candidate.standing === 'false' || candidate.distortion === 'misattributed')) {
              const name = finding.hand!.name;
              if (name === null) continue; // a stranger the model invents
              expect(knownNames).toContain(name);
              expect(trueNames(hands)).not.toContain(name);
              expect(name).not.toBe(NAMES.player);
              for (const unknown of UNKNOWN_TO_PLAYER) expect(name).not.toBe(NAMES[unknown]);
            }
            // Decoys within one account are all different people.
            const decoys = read.findings.map(finding => finding.hand!.name).filter((name): name is string => name !== null);
            expect(new Set(decoys).size).toBe(decoys.length);
          }
        }
      }
    }
  });

  it('a decoy keeps the true hand\'s familiarity: a known figure for a known hand, a stranger for a stranger\'s', () => {
    for (let seed = 0; seed < 30; seed++) {
      const read = plan(['varro', 'stranger'], 'who_is_behind_it', 'false', 'fuller', seed, { sibling: 'named' });
      const reachedOrder = plan(['varro', 'stranger'], 'who_is_behind_it', 'true', 'fuller', seed).findings.map(finding => finding.hand!.name);
      read.findings.forEach((finding, i) => {
        if (reachedOrder[i] === 'Senator Varro') expect(KNOWN.map(figure => figure.name)).toContain(finding.hand!.name);
        else expect(finding.hand!.name).toBeNull();
      });
    }
    // The player's own hand is a known one: its decoy is someone else they know.
    expect(KNOWN.map(figure => figure.name)).toContain(plan(['player'], 'who_is_behind_it', 'false', 'fuller', 3, { sibling: 'named' }).findings[0].hand!.name);
    // With no known figure left to stand in, a stranger does.
    const alone = plan(['varro'], 'who_is_behind_it', 'false', 'fuller', 3, { sibling: 'named', knownFigures: [KNOWN[0]] });
    expect(alone.findings[0].hand!.name).toBeNull();
  });

  it('a fragment decoy is a fragment of a known figure\'s name, never of a true hand\'s', () => {
    for (let seed = 0; seed < 30; seed++) {
      const read = plan(['varro'], 'who_is_behind_it', 'false', 'fragment', seed, { sibling: 'named' });
      const name = read.findings[0].hand!.name!;
      expect(read.findings[0].fragmentary).toBe(true);
      expect(KNOWN.filter(figure => figure.id !== 'varro').some(figure => figure.name.split(' ').includes(name))).toBe(true);
    }
  });

  it('false aims: as many as the true entry had, none of them its true intents; a bare name stays bare', () => {
    for (let seed = 0; seed < 30; seed++) {
      const truthful = plan(['varro', 'crassus', 'stranger'], 'who_gains', 'true', 'fuller', seed);
      const falseRead = plan(['varro', 'crassus', 'stranger'], 'who_gains', 'false', 'fuller', seed, { sibling: 'named' });
      falseRead.findings.forEach((finding, i) => {
        const trueAims = truthful.findings[i].hand!.aims;
        expect(finding.hand!.aims).toHaveLength(trueAims.length);
        for (const aim of finding.hand!.aims) {
          expect(EntityActionIntentEnum).toContain(aim);
          expect(trueAims).not.toContain(aim);
        }
        expect(new Set(finding.hand!.aims).size).toBe(finding.hand!.aims.length);
      });
    }
  });

  it('garbled changes one thing in one entry: a bare name is only pinned on another, an aimed one may have one aim changed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const truthful = plan(['varro', 'stranger'], 'who_gains', 'true', 'fuller', seed);
      const garbled = plan(['varro', 'stranger'], 'who_gains', 'garbled', 'fuller', seed);
      const changed = garbled.findings.filter(finding => finding.standing === 'garbled');
      expect(changed).toHaveLength(1);
      const i = garbled.findings.indexOf(changed[0]);
      const before = truthful.findings[i].hand!;
      const after = changed[0].hand!;
      if (before.aims.length === 0) expect(changed[0].distortion).toBe('misattributed');
      if (changed[0].distortion === 'misattributed') {
        expect(after.aims).toEqual(before.aims);
        expect(after.name).not.toBe(before.name);
      } else {
        expect(after.name).toBe(before.name);
        const differing = after.aims.filter((aim, a) => aim !== before.aims[a]);
        expect(differing).toHaveLength(1);
        expect(before.aims).not.toContain(differing[0]);
      }
      seen.add(`${before.aims.length > 0 ? 'aimed' : 'bare'}:${changed[0].distortion}`);
      // The ledger's label is what was planned.
      expect(changed[0].truth).toContain(after.name ?? '(a stranger the agents invented)');
    }
    expect(seen).toEqual(new Set(['aimed:element_changed', 'aimed:misattributed', 'bare:misattributed']));
  });

  it('an empty truth is an honest nothing whatever the roll or the sibling', () => {
    for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
      for (const sibling of [null, 'empty', 'named'] as const) {
        const read = plan([], 'who_gains', accuracy, 'fuller', 3, { sibling });
        expect(read).toEqual({ question: 'who_gains', accuracy: 'true', fidelity: 'fuller', findings: [] });
      }
    }
  });

  it('a sibling that came back empty holds this one to a nothing - recorded false - even on a true roll', () => {
    const held = plan(['varro', 'crassus'], 'who_gains', 'true', 'fuller', 3, { sibling: 'empty' });
    expect(held).toMatchObject({ accuracy: 'true', findings: [], heldToSibling: true });
    expect(held.withheld).toEqual([`Senator Varro: ${AIM_PHRASE.intrigue}; ${AIM_PHRASE.assassinate}`, `Marcus Crassus: ${AIM_PHRASE.tax_raise}`]);
  });

  it('a sibling that named hands forbids a false nothing: a false roll invents instead', () => {
    let nothings = 0;
    for (let seed = 0; seed < 150; seed++) {
      const read = plan(['varro', 'crassus'], 'who_is_behind_it', 'false', 'partial', seed, { sibling: 'named' });
      expect(read.accuracy).toBe('false');
      expect(read.findings).toHaveLength(2);
      if (plan(['varro', 'crassus'], 'who_is_behind_it', 'false', 'partial', seed).findings.length === 0) nothings++;
    }
    // ...where, with no sibling, about a third come back as a false nothing.
    expect(nothings / 150).toBeGreaterThan(0.2);
    expect(nothings / 150).toBeLessThan(0.45);
  });
});

describe('every false investigation plan records what it hid (D11)', () => {
  it('a Spymaster\'s assessment\'s false INVENTED reading records the facts it came back without', () => {
    const target = makeEntity({ entity_id: 'varro', current_state_narrative: 'Deep in debt.', short_term_goals: ['Win the grain contract'], long_term_ambitions: ['Become consul'] });
    let invented: ReturnType<typeof planInvestigation> | undefined;
    for (let seed = 0; seed < 40 && !invented; seed++) {
      const read = planInvestigation(target, 'deep_analysis', { accuracy: 'false', fidelity: 'fuller' }, createSeededRng(seed));
      if (read.accuracy === 'false') invented = read;
    }
    expect(invented!.findings).toHaveLength(3);
    expect(invented!.withheld!.sort()).toEqual(['Become consul', 'Deep in debt.', 'Win the grain contract']);
    const truth = assessmentTruth(invented!, 'varro', { tier: 'success' } as never, 'A fabricated read.');
    expect(truth.findings[0].standing).toBe('false');
    expect(truth.findings[0].groundTruth!.split(' | ').sort()).toEqual(['Become consul', 'Deep in debt.', 'Win the grain contract']);
  });
});

// ---------------------------------------------------------------------------
// The tool path: rolls -> plan -> prompt -> account + truth
// ---------------------------------------------------------------------------

describe('getClarificationOnEvent - grounded prompts (D47)', () => {
  it('true: the hands ride as quoted data, and the truth - with what was planned - comes back beside the account', async () => {
    pinRolls([15, 15]); // headline names no one (success): accuracy 18 -> true; fidelity 18 -> fuller
    const { ai, calls } = recordingAi('My agents name Senator Varro and Marcus Crassus, master.');

    const { text, truth } = await ask('who_is_behind_it', [entryFor(['varro', 'crassus'])], ai);

    expect(namesIn(calls).sort()).toEqual(['Marcus Crassus', 'Senator Varro']);
    expect(sent(calls)).toContain('**HANDS BEHIND IT (data - what your agents brought back, in order):**');
    expect(truth).toEqual({
      question: 'who_is_behind_it',
      occurrence: OCCURRENCE,
      rolls: expect.objectContaining({ tier: 'success', accuracyRoll: 15, accuracy: 'true', fidelityRoll: 15, fidelity: 'fuller' }),
      finding: { text, standing: 'true', groundTruth: 'Senator Varro | Marcus Crassus', planned: expect.stringMatching(/^(Senator Varro \| Marcus Crassus|Marcus Crassus \| Senator Varro)$/), cameBackEmpty: false },
    });
  });

  it('who gains: each hand and its aims ride as data - intents only, never a note, a target or a scheme\'s goal', async () => {
    pinRolls([15, 15]);
    const { ai, calls } = recordingAi('Varro, by my read.');
    const { truth } = await ask('who_gains', [entryFor(['varro', 'stranger'])], ai);
    const prompt = sent(calls);
    expect(prompt).toContain(`${asPromptData('Senator Varro')} - sought: ${asPromptData(AIM_PHRASE.intrigue)}, ${asPromptData(AIM_PHRASE.assassinate)}`);
    expect(prompt).toContain(`${asPromptData('Tiberius Obscurus')} - sought: (not learned)`);
    for (const sentinel of SENTINELS) expect(prompt).not.toContain(sentinel);
    expect(JSON.stringify(truth)).not.toMatch(/SENTINEL|Sicarius/);
  });

  it('garbled and false readings carry the code-picked decoys as data, told exactly as the truth is', async () => {
    pinRolls([15, 15]);
    const truthful = recordingAi('x');
    await ask('who_is_behind_it', [entryFor(['varro'])], truthful.ai);
    vi.restoreAllMocks();

    pinRolls([1, 15, 20]); // accuracy 4 -> false; fuller; the planner's draw keeps the count
    const misled = recordingAi('The prefect of the watch, they say.');
    const { truth } = await ask('who_is_behind_it', [entryFor(['varro'])], misled.ai);

    const [decoy] = namesIn(misled.calls);
    expect(['Marcus Crassus', 'Livia Drusilla', 'Quintus Sertorius']).toContain(decoy);
    expect(sent(misled.calls)).not.toContain('Senator Varro');
    // The one instruction: the model is never told which reading it holds.
    expect(misled.calls[0].systemInstruction).toBe(truthful.calls[0].systemInstruction);
    expect(truth!.finding).toEqual({ text: 'The prefect of the watch, they say.', standing: 'false', groundTruth: 'Senator Varro', planned: decoy, cameBackEmpty: false });
  });

  it('a stranger\'s hand gets a stranger for a decoy - invented by the model, none of the figures the master knows', async () => {
    pinRolls([1, 15, 20]);
    const { ai, calls } = recordingAi('A freedman named Pallas, they say.');
    const { truth } = await ask('who_is_behind_it', [entryFor(['stranger'])], ai);
    expect(namesIn(calls)).toEqual([null]);
    const known = KNOWN.map(figure => asPromptData(figure.name)).join(', ');
    expect(calls[0].systemInstruction).toContain(`none of the names in this prompt and none of these figures your master knows: ${known}`);
    for (const unknown of UNKNOWN_TO_PLAYER) expect(sent(calls)).not.toContain(NAMES[unknown]);
    expect(truth!.finding).toMatchObject({ standing: 'false', planned: '(a stranger the agents invented)', groundTruth: 'Tiberius Obscurus' });
  });

  it('the honest nothing, the false nothing and a nothing held to its sibling are asked for in byte-identical prompts', async () => {
    const honest = recordingAi('No single hand, master: it arose from circumstance.');
    pinRolls([1, 15]);
    const honestAnswer = await ask('who_gains', [entryFor([])], honest.ai);
    vi.restoreAllMocks();

    const misled = recordingAi('No single hand, master: it arose from circumstance.');
    pinRolls([1, 15, 1]); // accuracy false; the planner's draw lands a false nothing
    const misledAnswer = await ask('who_gains', [entryFor(['varro'])], misled.ai);
    vi.restoreAllMocks();

    const held = recordingAi('No single hand, master: it arose from circumstance.');
    pinRolls([15, 15]); // a TRUE roll - held to its sibling's nothing all the same
    const heldAnswer = await ask('who_gains', [entryFor(['varro'])], held.ai, { sibling: 'empty' });

    expect(misled.calls).toEqual(honest.calls);
    expect(held.calls).toEqual(honest.calls);
    expect(sent(honest.calls)).toContain("Your agents found no one's scheme behind it");
    expect(honestAnswer.truth!.finding).toMatchObject({ standing: 'true', groundTruth: NO_HAND_TRUTH.who_gains, cameBackEmpty: true, planned: '' });
    expect(misledAnswer.truth!.finding).toMatchObject({ standing: 'false', cameBackEmpty: true });
    expect(heldAnswer.truth!.finding).toMatchObject({ standing: 'false', cameBackEmpty: true, heldToSibling: true });
  });

  it('asking both questions: an empty truth gives two honest nothings; a false nothing forces its sibling to one', async () => {
    const ledgerOf = (truth: OccurrenceTruth) => [occurrenceLedgerEntry(truth, occurrenceClaimKey(OCCURRENCE, truth.question), 3, 1)];

    pinRolls([1, 15]);
    const first = await ask('who_is_behind_it', [entryFor([])], recordingAi('Circumstance.').ai);
    vi.restoreAllMocks();
    const sibling = siblingOccurrenceOutcome(ledgerOf(first.truth!), OCCURRENCE, 'who_gains');
    expect(sibling).toBe('empty');
    pinRolls([15, 15]);
    const second = await ask('who_gains', [entryFor([])], recordingAi('Circumstance.').ai, { sibling });
    vi.restoreAllMocks();
    expect([first.truth!.finding.standing, second.truth!.finding.standing]).toEqual(['true', 'true']);
    expect(second.truth!.finding.heldToSibling).toBeUndefined();

    pinRolls([1, 15, 1]); // a false nothing on the first...
    const lie = await ask('who_is_behind_it', [entryFor(['varro'])], recordingAi('Circumstance.').ai);
    vi.restoreAllMocks();
    expect(lie.truth!.finding).toMatchObject({ standing: 'false', cameBackEmpty: true });
    pinRolls([15, 15]); // ...holds the second to a nothing, even on a true roll
    const held = await ask('who_gains', [entryFor(['varro'])], recordingAi('Circumstance.').ai, { sibling: siblingOccurrenceOutcome(ledgerOf(lie.truth!), OCCURRENCE, 'who_gains') });
    expect(held.truth!.finding).toMatchObject({ standing: 'false', cameBackEmpty: true, heldToSibling: true });
  });

  it('the rolls read the PUBLIC headline only - swapping the hidden hands never moves a tier', async () => {
    const tierFor = async (occurrence: string, hands: string[]) => {
      pinRolls([12, 12]);
      const { truth } = await ask('who_is_behind_it', [entryFor(hands, occurrence)], recordingAi('x').ai, { occurrence });
      vi.restoreAllMocks();
      return { tier: truth!.rolls.tier, accuracy: truth!.rolls.accuracy, fidelity: truth!.rolls.fidelity };
    };
    const quiet = 'The grain fleet burns at Ostia.';
    const namesAStranger = 'Tiberius Obscurus is seen at the docks.';
    const namesAFriend = 'Senator Varro is seen at the docks.';
    expect(await tierFor(quiet, ['varro'])).toEqual(await tierFor(quiet, ['stranger']));
    expect(await tierFor(namesAStranger, ['varro'])).toEqual(await tierFor(namesAStranger, ['stranger']));
    expect(await tierFor(namesAFriend, ['stranger'])).toEqual(await tierFor(namesAFriend, ['varro']));
    expect((await tierFor(quiet, ['stranger'])).tier).toBe('success');
    expect((await tierFor(namesAFriend, ['stranger'])).tier).toBe('success');
    expect((await tierFor(namesAStranger, ['varro'])).tier).toBe('partial_success');
    // The headline sets the fidelity difficulty too: 12 + 3 reaches fuller inside, 12 - 2 only partial outside.
    expect((await tierFor(quiet, ['varro'])).fidelity).toBe('fuller');
    expect((await tierFor(namesAStranger, ['varro'])).fidelity).toBe('partial');
  });

  it('no record: the honest "no thread to follow" - no call, no roll, no truth; hands that are no one are circumstance', async () => {
    const random = vi.spyOn(Math, 'random');
    const { ai, calls } = recordingAi('unused');
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      expect(await ask(question, [], ai)).toEqual({ text: NO_THREAD_TO_FOLLOW[question] });
    }
    expect(calls).toHaveLength(0);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();

    pinRolls([15, 15]);
    const circumstance = await ask('who_is_behind_it', [entryFor(['ghost'], OCCURRENCE, { headlineActors: [{ text: OCCURRENCE, actorIds: ['ghost'] }] })], ai);
    expect(circumstance.truth!.finding).toMatchObject({ standing: 'true', groundTruth: NO_HAND_TRUTH.who_is_behind_it, cameBackEmpty: true });
  });

  it('what follows: untouched - a forecast from the headline and the figures the master knows, with no truth', async () => {
    const { ai, calls } = recordingAi('Expect the price of bread to climb, master.');
    const answer = await ask('what_follows', [entryFor(['stranger'])], ai);
    expect(answer).toEqual({ text: 'Expect the price of bread to climb, master.' });
    expect(calls[0].prompt).toBe(buildOccurrenceForecastPrompt(OCCURRENCE, player, KNOWN.map(figure => figure.name)).prompt);
    expect(calls[0].prompt).toContain(`**Figures your master knows (data):** ${KNOWN.map(figure => asPromptData(figure.name)).join(', ')}`);
    expect(sent(calls)).not.toContain('Tiberius Obscurus');
    expect(sent(calls)).toContain('state no hidden fact as known');
    for (const token of TRUTH_FLAG_TOKENS) expect(sent(calls)).not.toContain(token);
  });

  it('holds a grounded account to the mechanics boundary', async () => {
    pinRolls([15, 15]);
    await expect(ask('who_is_behind_it', [entryFor(['varro'])], recordingAi('The roll total was 7.').ai))
      .rejects.toThrow('player-visible mechanics boundary');
  });
});

describe('the occurrence prompts carry no GM-private vocabulary, no roll, no note, for any plan', () => {
  it('whatever the question, accuracy, fidelity or sibling', () => {
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
          for (const hands of [[], ['varro', 'crassus', 'stranger']]) {
            for (const sibling of [null, 'empty', 'named'] as const) {
              const read = planOccurrence(grounding(hands, question), question, { accuracy, fidelity }, createSeededRng(3), context({ sibling }));
              const built = buildClarificationPrompt(OCCURRENCE, question, player, KNOWN.map(figure => figure.name), read);
              const text = `${built.systemInstruction}\n${built.prompt}`;
              for (const token of [...TRUTH_FLAG_TOKENS, ...SENTINELS]) expect(text, `${question}/${accuracy}/${fidelity}`).not.toContain(token);
              expect(text).not.toMatch(/\broll(?:ed)?\b|\bmisled\b|\bdistort|\binvent \d/i);
              expect(built.systemInstruction).toContain('your master may choose to distrust - never as settled fact');
              for (const unknown of UNKNOWN_TO_PLAYER) {
                if (read.findings.every(finding => finding.standing === 'true' || finding.hand?.name !== NAMES[unknown])) continue;
                throw new Error(`a decoy named ${NAMES[unknown]}`);
              }
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mock Mode: the same path, deterministically, in the game's words
// ---------------------------------------------------------------------------

describe('Mock Mode - deterministic, following the same plan', () => {
  const mock = (question: OccurrenceQuestion, hands: string[], occurrence = OCCURRENCE, sibling: OccurrenceSiblingOutcome | null = null) =>
    ask(question, [entryFor(hands, occurrence)], {} as GoogleGenAI, { isMockMode: true, occurrence, sibling });

  it('the same question about the same occurrence lands the same way, from a seed fixed by both, never Math.random', async () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random touched'); });
    const first = await mock('who_is_behind_it', ['varro', 'crassus']);
    expect(await mock('who_is_behind_it', ['varro', 'crassus'])).toEqual(first);
    expect(first.truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_is_behind_it'));
    expect((await mock('who_gains', ['varro'])).truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_gains'));
    expect(random).not.toHaveBeenCalled();
  });

  it('renders aims as phrases - "who sought to ..." - never engine formatting, and never a note', async () => {
    let rendered = false;
    for (let i = 0; i < 60 && !rendered; i++) {
      const occurrence = `The mint is robbed, the ${i}th time.`;
      const { text, truth } = await mock('who_gains', ['varro'], occurrence);
      expect(text).not.toMatch(/ - |intrigue:|assassinate|_/);
      for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
      if (truth!.finding.standing === 'true' && truth!.rolls.fidelity !== 'fragment') {
        expect(text).toBe(`(Mock) Your agents say it serves Senator Varro, who sought ${AIM_PHRASE.intrigue} and ${AIM_PHRASE.assassinate}.`);
        rendered = true;
      }
    }
    expect(rendered).toBe(true);
  });

  it('a false or garbled reading names the code-picked decoy - a real figure the player knows, or a canned stranger', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const occurrence = `Occurrence number ${i} is cried.`;
      const { text, truth } = await mock('who_is_behind_it', ['varro', 'stranger'], occurrence, 'named');
      const planned = truth!.finding.planned.split(' | ');
      if (truth!.finding.standing === 'true') continue;
      for (const name of planned) {
        if (name === '(a stranger the agents invented)') { seen.add('stranger'); continue; }
        expect(text).toContain(name.split(' ')[0]);
        if (truth!.rolls.fidelity !== 'fragment') {
          expect(['Senator Varro', 'Tiberius Obscurus', 'Marcus Crassus', 'Livia Drusilla', 'Quintus Sertorius']).toContain(name);
          if (name !== 'Senator Varro' && name !== 'Tiberius Obscurus') seen.add('known decoy');
        }
      }
      expect(text).not.toContain('Aulus Hidden');
    }
    expect(seen).toEqual(new Set(['stranger', 'known decoy']));
  });

  it('parity offline: an account names as many hands as the truth would have, or none at all', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const occurrence = `Occurrence number ${i} is cried.`;
      const { text, truth } = await mock('who_is_behind_it', ['varro', 'crassus', 'stranger'], occurrence);
      const named = text.includes('name the hand') ? text.slice(text.indexOf(': ') + 2).split('; ').length : 0;
      const reach = Math.min(FIDELITY_REACH[truth!.rolls.fidelity], 3);
      const standing = truth!.finding.standing;
      seen.add(`${standing}:${named === 0 ? 'none' : 'some'}`);
      if (named === 0) expect(standing, occurrence).toBe('false'); // only ever a false nothing: the truth is not empty
      else expect(named, occurrence).toBe(reach);
    }
    expect(seen).toContain('true:some');
    expect(seen).toContain('garbled:some');
    expect(seen).toContain('false:some');
  });

  it('an occurrence with no single hand reads as the honest nothing, whatever it rolled; "What follows?" stays a forecast', async () => {
    for (let i = 0; i < 12; i++) {
      const occurrence = `A quiet week, the ${i}th.`;
      const answer = await mock('who_is_behind_it', [], occurrence);
      expect(answer.text).toBe('(Mock) Your agents find no single hand behind it: it arose from circumstance.');
      expect(answer.truth!.finding.standing).toBe('true');
    }
    const forecast = await mock('what_follows', ['varro']);
    expect(forecast.truth).toBeUndefined();
    expect(forecast.text).toContain('forecast');
  });
});

// ---------------------------------------------------------------------------
// D11: the truth lands with the finding; the cap spares paid truth; the GM console
// ---------------------------------------------------------------------------

function truthOf(standing: IntelAccuracy, text = 'Varro, they say.', extra: Partial<OccurrenceTruth['finding']> = {}): OccurrenceTruth {
  return {
    question: 'who_is_behind_it',
    occurrence: OCCURRENCE,
    rolls: { seed: 99, tier: 'success', accuracyRoll: 15, accuracy: standing, fidelityRoll: 8, fidelity: 'partial' },
    finding: {
      text, standing, groundTruth: 'Senator Varro | Marcus Crassus', planned: 'Livia Drusilla | Marcus Crassus', cameBackEmpty: false,
      ...(standing === 'garbled' ? { distortion: 'misattributed' as const } : {}),
      ...extra,
    },
  };
}

describe('the truth ledger and the atomic commit (hooks/useIntelCommits.ts)', () => {
  const live: DomainMutationContext = { isCurrent: () => true };
  const FORBIDDEN_STORE_KEYS = ['isTrue', 'standing', 'groundTruth', 'distortion', 'investigation', 'accuracy', 'fidelity', 'rolls', 'headlineActors', 'actorIds', 'actorNames', 'planned'].map(key => `"${key}"`);

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

  it('records the finding\'s truth - what was planned, whether it came back empty - in the same commit as the finding', () => {
    const prior: TruthLedgerEntry = { id: 'truth_1_1', turn: 1, claim: 'A rumor.', aboutId: 'varro', isTrue: false, reportId: 'r1' };
    const { input, commits } = deps({ truthLedger: [prior] });
    const hook = renderHook(useIntelCommits, input);
    const truth = truthOf('garbled', 'Livia and Crassus, they say.');
    expect(hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_is_behind_it', truth.finding.text, live, truth)).toBe(true);
    hook.unmount();

    const action = commits[0].action as { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };
    expect(action.truthLedger).toEqual([prior, {
      id: expect.stringMatching(/^truth_4_occurrence_\d+_who_is_behind_it$/),
      turn: 4,
      claim: 'Livia and Crassus, they say.',
      aboutId: 'world',
      isTrue: false,
      reportId: occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'),
      investigation: {
        kind: 'occurrence', standing: 'garbled', groundTruth: 'Senator Varro | Marcus Crassus', distortion: 'misattributed',
        rolls: truth.rolls, question: 'who_is_behind_it', occurrence: OCCURRENCE,
        planned: 'Livia Drusilla | Marcus Crassus', cameBackEmpty: false,
      },
    }]);
    expect(commits[0].candidate.truthLedger).toEqual(action.truthLedger);
    expect(occurrenceFindings(action.knowledge, OCCURRENCE)).toEqual([{ question: 'who_is_behind_it', text: 'Livia and Crassus, they say.', turn: 4 }]);
    const store = JSON.stringify(action.knowledge);
    for (const key of FORBIDDEN_STORE_KEYS) expect(store).not.toContain(key);
    expect(store).not.toContain('Senator Varro');
  });

  it('reads the sibling question\'s outcome back off the ledger: empty, named, or nothing to go on', () => {
    const entry = (question: GroundedOccurrenceQuestion, cameBackEmpty: boolean, occurrence = OCCURRENCE) =>
      occurrenceLedgerEntry({ ...truthOf('true', 'x', { cameBackEmpty }), question, occurrence }, occurrenceClaimKey(occurrence, question), 4, 1);
    const hook = (truthLedger: TruthLedgerEntry[]) => renderHook(useIntelCommits, deps({ truthLedger }).input);

    const empty = hook([entry('who_is_behind_it', true)]);
    expect(empty.current.occurrenceSibling(OCCURRENCE, 'who_gains')).toBe('empty');
    expect(empty.current.occurrenceSibling(OCCURRENCE, 'who_is_behind_it')).toBeNull(); // its own entry is no sibling
    expect(empty.current.occurrenceSibling(OCCURRENCE, 'what_follows')).toBeNull();
    empty.unmount();

    const named = hook([entry('who_gains', false), entry('who_gains', false, 'Another occurrence.')]);
    expect(named.current.occurrenceSibling(OCCURRENCE, 'who_is_behind_it')).toBe('named');
    named.unmount();

    // Recorded before the ledger said, or never asked: each question rolls on its own.
    const legacy = entry('who_is_behind_it', true);
    delete legacy.investigation!.cameBackEmpty;
    expect(siblingOccurrenceOutcome([legacy], OCCURRENCE, 'who_gains')).toBeNull();
    expect(siblingOccurrenceOutcome([], OCCURRENCE, 'who_gains')).toBeNull();
  });

  it('a forecast, or the honest "no thread to follow", leaves the ledger as it stands; a stale request commits nothing', () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    hook.current.handleOccurrenceFinding(OCCURRENCE, 'what_follows', 'Bread will be dear.', live);
    hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_gains', NO_THREAD_TO_FOLLOW.who_gains, live);
    expect(hook.current.handleOccurrenceFinding(OCCURRENCE, 'who_is_behind_it', 'x', { isCurrent: () => false }, truthOf('true'))).toBe(false);
    hook.unmount();
    expect(commits).toHaveLength(2);
    for (const commit of commits) {
      expect(commit.action).not.toHaveProperty('truthLedger');
      expect(commit.candidate).not.toHaveProperty('truthLedger');
    }
  });

  it('at the cap, free occurrence answers are evicted first, oldest first - then the oldest of the rest; new entries never', () => {
    const rumor = (i: number): TruthLedgerEntry => ({ id: `rumor_${i}`, turn: i, claim: `Rumor ${i}.`, aboutId: 'varro', isTrue: true, reportId: `r${i}` });
    const answer = (i: number): TruthLedgerEntry => ({ ...occurrenceLedgerEntry(truthOf('true'), 'k', i, i), id: `occ_${i}` });
    const full = Array.from({ length: MAX_TRUTH_LEDGER_ENTRIES }, (_, i) => (i === 5 || i === 50 ? answer(i) : rumor(i)));

    const afterOne = appendTruthLedgerEntries(full, [rumor(900)]);
    expect(afterOne).toHaveLength(MAX_TRUTH_LEDGER_ENTRIES);
    expect(afterOne.map(entry => entry.id)).not.toContain('occ_5');
    expect(afterOne.map(entry => entry.id)).toContain('occ_50');
    expect(afterOne[0].id).toBe('rumor_0');

    const afterThree = appendTruthLedgerEntries(full, [answer(901), rumor(902), rumor(903)]);
    const ids = afterThree.map(entry => entry.id);
    expect(ids).not.toContain('occ_5');
    expect(ids).not.toContain('occ_50');
    expect(ids).not.toContain('rumor_0');
    expect(ids).toContain('rumor_1');
    expect(ids.slice(-3)).toEqual(['occ_901', 'rumor_902', 'rumor_903']);
  });

  it('the GM console shows it: the question, the occurrence, the standing, the truth, what was planned and the rolls', async () => {
    const entry = occurrenceLedgerEntry(truthOf('false', 'Nothing - circumstance.', { planned: '', cameBackEmpty: true, heldToSibling: true }), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 1);
    const decoyed = occurrenceLedgerEntry(truthOf('false', 'Livia, they say.', { planned: 'Livia Drusilla' }), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 2);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<TruthLedgerView ledger={[entry, decoyed]} reports={[]} />));
    const text = container.textContent ?? '';
    expect(text).toContain('FALSE');
    expect(text).toContain('occurrence question · who is behind it?');
    expect(text).toContain(`asked of: “${OCCURRENCE}”`);
    expect(text).toContain('truth: “Senator Varro | Marcus Crassus”');
    expect(text).toContain('planned: “Livia Drusilla”');
    expect(text).toContain("planned: nothing - no hand named · held to the other question's nothing, whatever its own roll");
    expect(text).toContain('accuracy d20 15 → false');
    await act(async () => root.unmount());
  });
});

// ---------------------------------------------------------------------------
// The Events tab: the agents' account only - and the two questions agree
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
  const cast = [...roster, hand];
  const history = (occurrence: string, hands: string[]) => [entryFor([], occurrence, {
    headlineActors: [{ text: occurrence, actorIds: hands, actorNames: hands.map(id => id === 'sentinel_hand' ? hand.name : NAMES[id]) }],
  })];

  /** Mounts the tab over a live ledger, as App does: findings commit their truth, and the sibling is read back off it. */
  async function mountTab(occurrence: string, hands: string[]) {
    const captured: Array<OccurrenceTruth | undefined> = [];
    const Harness: React.FC = () => {
      const [knowledge, setKnowledge] = useState<KnowledgeClaim[]>([]);
      const [ledger, setLedger] = useState<TruthLedgerEntry[]>([]);
      const run: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
      return (
        <CurrentEventsTab
          events={[occurrence]} week={3} playerEntity={player} allEntities={cast} turnHistory={history(occurrence, hands)}
          knowledge={knowledge} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={run}
          occurrenceSibling={(asked, question) => question === 'what_follows' ? null : siblingOccurrenceOutcome(ledger, asked, question)}
          onFinding={(asked, question, text, _request, truth) => {
            captured.push(truth);
            setKnowledge(prev => ingestOccurrenceFinding(prev, { occurrence: asked, question, text, turn: 3 }));
            if (truth) setLedger(prev => [...prev, occurrenceLedgerEntry(truth, occurrenceClaimKey(asked, question), 3, prev.length)]);
            return true;
          }}
        />
      );
    };
    await act(async () => root.render(<Harness />));
    const toggle = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(occurrence))!;
    await act(async () => toggle.click());
    const askQuestion = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === label)!;
      await act(async () => {
        button.click();
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    };
    return { captured, askQuestion };
  }

  /** An occurrence whose offline "Who is behind it?" reading lands as `wanted` (Mock Mode rolls from a seed fixed by the occurrence). */
  async function occurrenceWhere(hands: string[], wanted: (truth: OccurrenceTruth, text: string) => boolean): Promise<string> {
    for (let i = 0; i < 300; i++) {
      const occurrence = `The aqueduct fails, the ${i}th time.`;
      const { text, truth } = await getClarificationOnEvent({} as GoogleGenAI, occurrence, 'who_is_behind_it', player, cast, history(occurrence, hands), true);
      if (wanted(truth!, text)) return occurrence;
    }
    throw new Error('no occurrence found for the wanted reading');
  }

  it('a false reading shows the decoy as the agents\' account, and nothing of the true hand, its flags or the record', async () => {
    const occurrence = await occurrenceWhere(['sentinel_hand'], (truth, text) => truth.finding.standing === 'false' && text.includes('name the hand'));
    const { captured, askQuestion } = await mountTab(occurrence, ['sentinel_hand']);
    await askQuestion('Who is behind it?');

    expect(captured).toHaveLength(1);
    expect(captured[0]!.finding).toMatchObject({ standing: 'false', groundTruth: 'SENTINEL_HAND Aurelius' });
    const finding = container.querySelector('.gor-finding')!;
    expect(finding.textContent).toContain('Your agents · who is behind it');
    expect(finding.textContent).toContain(captured[0]!.finding.text);
    expect(container.innerHTML).not.toContain('SENTINEL_HAND');
    for (const token of [...TRUTH_FLAG_TOKENS, ...SENTINELS]) expect(container.textContent).not.toContain(token);
  });

  it('asking both questions: a false nothing on the first holds the second to a nothing - the tab threads the sibling', async () => {
    const occurrence = await occurrenceWhere(['varro', 'crassus'], truth => truth.finding.cameBackEmpty && truth.finding.standing === 'false');
    const { captured, askQuestion } = await mountTab(occurrence, ['varro', 'crassus']);
    await askQuestion('Who is behind it?');
    await askQuestion('Who gains?');

    expect(captured).toHaveLength(2);
    expect(captured[0]!.finding).toMatchObject({ cameBackEmpty: true, standing: 'false' });
    expect(captured[1]!.finding).toMatchObject({ cameBackEmpty: true, standing: 'false', heldToSibling: true });
    expect(container.textContent).toContain("(Mock) Your agents find no one's scheme behind it: whoever profits, profits by chance.");
    expect(container.textContent).not.toContain('Senator Varro');
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
    expect(onFinding).toHaveBeenCalledWith(OCCURRENCE, 'who_gains', NO_THREAD_TO_FOLLOW.who_gains, expect.anything(), undefined);
  });
});

// ---------------------------------------------------------------------------
// State and saves
// ---------------------------------------------------------------------------

describe('the record in state and saves (compatibility)', () => {
  const records: HeadlineAttribution[] = [{ text: OCCURRENCE, actorIds: ['varro'], actorNames: ['Senator Varro'] }];

  it('is kept on every entry - the snapshot trim leaves it, since Examined reaches older occurrences', () => {
    const history = Array.from({ length: KEEP_FULL_SNAPSHOTS + 3 }, (_, i) => entryFor(['varro'], `Occurrence ${i}.`, {
      turnNumber: i + 1,
      postTurnEntities: roster,
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

/** Every intent is phrased as an aim. */
describe('AIM_PHRASE', () => {
  it('phrases every entityAction intent, in the game\'s words', () => {
    expect(Object.keys(AIM_PHRASE).sort()).toEqual([...EntityActionIntentEnum].sort());
    for (const intent of EntityActionIntentEnum as readonly EntityActionIntent[]) expect(AIM_PHRASE[intent]).toMatch(/^to [a-z]/);
  });
});
