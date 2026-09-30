/**
 * @vitest-environment jsdom
 *
 * tests/groundedOccurrences.test.tsx - the Events tab's "Who is behind it?"
 * and "Who gains?" are grounded (D47) in who really acted: the turn's
 * GM-private attribution record (TurnHistoryEntry.headlineActors, D42).
 *
 * Pins, in order:
 *  - the record: paired with each committed headline by its final text, each
 *    declared label resolved by id, then name, then epithet, then bare or by
 *    a unique whole word, its names frozen at commit and its unresolved
 *    labels kept for the GM, the ids alive at commit beside it; written by
 *    the mock pipeline too (the real one: tests/turnPipeline.test.ts); the
 *    lookup pools a headline cried twice;
 *  - the truth per question - hands, and for "Who gains?" their OPEN intents
 *    only: never a covert intent, never an action's notes (D28);
 *  - the plan (planOccurrence): count and shape never betray the accuracy;
 *    code picks every decoy - a real figure alive at the occurrence's own
 *    turn (past the snapshot trim too), of the true hand's familiarity, a
 *    generated stranger only when none is left - and every false aim from
 *    what other figures pursued that turn, at most three to a hand; "came
 *    back empty" is decided once per occurrence;
 *  - the prompts, through the real tool path: one instruction whatever the
 *    reading or the decoy's kind, no list of figures, the rolls read off the
 *    public headline only; "What follows?" untouched; no record is an honest
 *    "no thread";
 *  - Mock Mode: deterministic, following the same plan, in the game's words;
 *  - D11: the truth lands in the same commit as the finding; the ledger's cap
 *    evicts free answers first, and the sibling outlives it in the player's
 *    own finding; the GM console shows what was planned;
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
  COVERT_INTENTS,
  FIDELITY_REACH,
  NO_HAND_TRUTH,
  occurrenceGrounding,
  occurrenceLedgerEntry,
  planInvestigation,
  planOccurrence,
  MAX_AIMS_PER_HAND,
  siblingOccurrenceOutcome,
  STRANGER_NAME_PARTS,
  strangerName,
  type OccurrenceGrounding,
  type OccurrencePlan,
  type OccurrencePlanContext,
  type OpenIntent,
} from '../ai/core/groundTruth';
import { appendTruthLedgerEntries, MAX_TRUTH_LEDGER_ENTRIES } from '../ai/core/engine';
import { attributeHeadlines } from '../ai/core/actorsBoundary';
import { getClarificationOnEvent, NO_THREAD_TO_FOLLOW } from '../ai/tools/intelligence';
import { buildClarificationPrompt, buildOccurrenceForecastPrompt } from '../ai/prompts/intelligence';
import { asPromptData } from '../ai/prompts/fragments';
import { endTurnCapture } from '../ai/core/geminiService';
import { mockIntelSeed, mockRunNewTurn } from '../ai/mocks';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import {
  ingestOccurrenceFinding,
  ingestReports,
  MAX_KNOWLEDGE_CLAIMS,
  occurrenceClaimKey,
  occurrenceFindings,
  occurrenceSiblingInStore,
  type KnowledgeClaim,
  type OccurrenceQuestion,
} from '../knowledge/store';
import { createInitialGameState, gameReducer, KEEP_FULL_SNAPSHOTS, withOldSnapshotsDropped } from '../state/gameReducer';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import CurrentEventsTab from '../components/tabs/CurrentEventsTab';
import { TruthLedgerView } from '../components/gm/TruthLedgerView';
import type { DomainCommit } from '../app/transactions';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import {
  EntityActionIntentEnum,
  type Entity,
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
import { ALL_INITIAL_ENTITIES, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A headline that names no one: the rolls read at the network standing. */
const OCCURRENCE = 'The grain fleet burns at Ostia.';
/** Sentinels: an action's notes - a secret move, one restating the scheme's goal, a covert-only hand's - must never leave the GM side. */
const SECRET_NOTE = 'NOTE_SENTINEL hires a Sicarius to kill Gaius at the baths';
const GOAL_NOTE = 'GOAL_SENTINEL seize the treasury before the Ides';
const COVERT_NOTE = 'COVERT_SENTINEL poisons the cup at the feast';

const NAMES: Record<string, string> = {
  player: 'Gaius Investigator',
  varro: 'Senator Varro',
  crassus: 'Marcus Crassus',
  livia: 'Livia Drusilla',
  quintus: 'Quintus Sertorius',
  obscurus: 'Tiberius Obscurus',
  hidden: 'Aulus Hidden',
  remote: 'Numerius Remotus',
};
const KNOWN_IDS = ['varro', 'crassus', 'livia', 'quintus'];
/** On the roster, but figures the player has never learned of: a decoy only for a hand they do not know either. */
const UNKNOWN_IDS = ['obscurus', 'hidden', 'remote'];
const player = makeEntity({ entity_id: 'player', name: NAMES.player, visibility_network: KNOWN_IDS });
const roster = Object.entries(NAMES).map(([entity_id, name]) => entity_id === 'player' ? player : makeEntity({ entity_id, name }));
const KNOWN_NAMES = KNOWN_IDS.map(id => NAMES[id]);
const UNKNOWN_NAMES = UNKNOWN_IDS.map(id => NAMES[id]);
const idOf = (name: string) => Object.keys(NAMES).find(id => NAMES[id] === name);

/**
 * What each figure did on the occurrence's turn. Varro's open move is a
 * bargain, beside two covert ones; Crassus's two are open; Livia's are all
 * covert; Quintus and Hidden act, but in no headline - the aims a decoy may
 * wear are these, less the entry's own.
 */
const TURN_ACTIONS = [
  { id: 'varro', intent: 'intrigue' as const, target: 'player', notes: SECRET_NOTE },
  { id: 'varro', intent: 'negotiate' as const, target: 'crassus', notes: 'Varro courts the tribunes.' },
  { id: 'varro', intent: 'assassinate' as const, target: 'player', notes: GOAL_NOTE },
  { id: 'varro', intent: 'intrigue' as const, target: null, notes: 'Again, by night.' },
  { id: 'crassus', intent: 'tax_raise' as const, target: null, notes: 'Crassus squeezes the tax farmers.' },
  { id: 'crassus', intent: 'recruit' as const, target: null, notes: 'Crassus hires guards.' },
  { id: 'livia', intent: 'assassinate' as const, target: 'varro', notes: COVERT_NOTE },
  { id: 'livia', intent: 'intrigue' as const, target: 'varro', notes: COVERT_NOTE },
  { id: 'quintus', intent: 'march' as const, target: null, notes: 'Quintus marches north.' },
  { id: 'hidden', intent: 'propaganda' as const, target: null, notes: 'Hidden spreads tales.' },
];
/** Every open intent pursued that turn by someone OTHER than each hand. */
const OTHERS_AIMS: Record<string, OpenIntent[]> = {
  varro: ['tax_raise', 'recruit', 'march', 'propaganda'],
  crassus: ['negotiate', 'march', 'propaganda'],
};

/** One committed turn crying `text`, its hands frozen with their names. */
function entryFor(actorIds: string[], text = OCCURRENCE, overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return makeTurnHistoryEntry({
    turnNumber: 3,
    adjudication: makeAdjudication({ turn: 3, headlines: [text], entityActions: TURN_ACTIONS }),
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

/** The names the prompt's numbered entries carry, unquoted. */
const namesIn = (calls: Array<{ prompt: string }>): string[] =>
  calls.flatMap(call => call.prompt.split('\n'))
    .map(line => /^\d+\. (?:\(a fragment\) )?("(?:[^"\\]|\\.)*")/.exec(line)?.[1])
    .filter((token): token is string => token !== undefined)
    .map(token => JSON.parse(token) as string);

/** The GM-private vocabulary: none of it may appear in a prompt whose output the player reads, nor on a player surface. */
const TRUTH_FLAG_TOKENS = ['isTrue', 'standing', 'groundTruth', 'accuracy', 'fidelity', 'garbled', 'GARBLED', 'headlineActors', 'actorIds', 'actorNames', 'unresolvedActors', 'livingAtCommit', 'heldToSibling', 'cameBackEmpty'];
const SENTINELS = ['NOTE_SENTINEL', 'GOAL_SENTINEL', 'COVERT_SENTINEL', 'Sicarius', 'treasury', 'poisons'];
/** The GM console's own wording for a stranger: never in a prompt. */
const STRANGER_MARK = ' (a stranger, no roster figure)';

const feminine = (nomen: string) => nomen.replace(/ius$/, 'ia');
/** Whether `name` is one the stranger generator builds, in one of its three forms. */
function isGeneratedStranger(name: string): boolean {
  const { praenomina, nomina, cognomina } = STRANGER_NAME_PARTS;
  const [first, second, third, ...rest] = name.split(' ');
  if (rest.length > 0 || second === undefined) return false;
  if (third !== undefined) return praenomina.includes(first) && nomina.includes(second) && cognomina.some(([masculine]) => masculine === third);
  return (praenomina.includes(first) && nomina.includes(second))
    || (nomina.map(feminine).includes(first) && cognomina.some(([, feminineForm]) => feminineForm === second));
}
/** Every word a generated stranger's name may hold - what a fragment of one is made of. */
const STRANGER_WORDS = new Set([
  ...STRANGER_NAME_PARTS.praenomina, ...STRANGER_NAME_PARTS.nomina, ...STRANGER_NAME_PARTS.nomina.map(feminine), ...STRANGER_NAME_PARTS.cognomina.flat(),
]);

/** Rumors that make figures known to the player through their knowledge store alone - the Dramatis Personae's own test. */
const heardOf = (ids: string[]): KnowledgeClaim[] =>
  ingestReports([], ids.map((about, i) => ({ id: `heard_${i}`, turn: 1, source: 'rumor' as const, about, claim: `${NAMES[about]} is spoken of.`, credibility: 0.5, topic: 'presence' })));

const ask = (
  question: OccurrenceQuestion,
  history: TurnHistoryEntry[],
  ai: GoogleGenAI,
  options: { isMockMode?: boolean; occurrence?: string; sibling?: OccurrenceSiblingOutcome | null; knowledge?: KnowledgeClaim[]; allEntities?: Entity[] } = {},
) => getClarificationOnEvent(ai, options.occurrence ?? OCCURRENCE, question, player, {
  allEntities: options.allEntities ?? roster,
  turnHistory: history,
  knowledge: options.knowledge ?? [],
  sibling: options.sibling ?? null,
}, options.isMockMode ?? false);

const TAKEN = new Set(roster.map(entity => entity.name.toLocaleLowerCase()));
const context = (overrides: Partial<OccurrencePlanContext> = {}): OccurrencePlanContext => ({
  playerId: 'player',
  isKnown: id => id === 'player' || KNOWN_IDS.includes(id),
  takenNames: TAKEN,
  sibling: null,
  ...overrides,
});

/** A grounding straight off `entryFor`. */
const grounding = (actorIds: string[], question: GroundedOccurrenceQuestion, entry = entryFor(actorIds), live: Entity[] = roster): OccurrenceGrounding =>
  occurrenceGrounding({ turnHistory: [entry], occurrence: OCCURRENCE, question, roster: live })!;

const plan = (actorIds: string[], question: GroundedOccurrenceQuestion, accuracy: IntelAccuracy, fidelity: IntelFidelity, seed = 7, overrides: Partial<OccurrencePlanContext> = {}): OccurrencePlan =>
  planOccurrence(grounding(actorIds, question), question, { accuracy, fidelity }, createSeededRng(seed), context(overrides));

/** Each name code put in a true hand's place, paired with the hand it replaced (a changed aim keeps its true name, so is none). */
function decoysOf(read: OccurrencePlan, reachedNames: string[]): Array<{ replaced: string; name: string }> {
  return read.findings
    .map((finding, i) => ({ finding, replaced: reachedNames[i] }))
    .filter(({ finding }) => finding.standing === 'false' || finding.distortion === 'misattributed')
    .map(({ finding, replaced }) => ({ replaced, name: finding.hand!.name }));
}

afterEach(() => {
  vi.restoreAllMocks();
  endTurnCapture();
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('the attribution record (ai/core/actorsBoundary.ts::attributeHeadlines)', () => {
  const post = [
    makeEntity({ entity_id: 'varro', name: 'Senator Varro', epithet: 'the Fox of the Curia' }),
    makeEntity({ entity_id: 'crassus', name: 'Marcus Crassus' }),
    makeEntity({ entity_id: 'quintus', name: 'Quintus Sertorius' }),
    // A figure whose NAME is another's id: an id is matched first.
    makeEntity({ entity_id: 'q_imitator', name: 'quintus' }),
  ];
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

  it('resolves each label by id, then by name, then by epithet - case-insensitively - and keeps the rest apart for the GM', () => {
    const [record] = attributeHeadlines([{
      text: 'A fire.',
      actors: ['quintus', '  marcus CRASSUS ', 'THE FOX OF THE CURIA', 'Senator Varro', 'lucius departed', 'the grain factors', 'The Grain Factors', ' '],
    }], ['A fire.'], [post, pre]);
    expect(record).toEqual({
      text: 'A fire.',
      actorIds: ['quintus', 'crassus', 'varro', 'departed'],
      actorNames: ['Quintus Sertorius', 'Marcus Crassus', 'Senator Varro', 'Lucius Departed'],
      // Once each, as first written.
      unresolvedActors: ['the grain factors'],
    });
    // By name, the imitator is reached only when no id matches.
    expect(attributeHeadlines([{ text: 'x', actors: ['QUINTUS'] }], ['x'], [post])[0].actorIds).toEqual(['q_imitator']);
  });

  it('a collective label resolves bare, or by a unique whole word - "the Senate" - never on a short or ambiguous one, nor loosely to the player', () => {
    const bodies = [
      makeEntity({ entity_id: 'roman_senate', name: 'Roman Senate', epithet: 'the Conscript Fathers' }),
      makeEntity({ entity_id: 'praetorians', name: 'Praetorian Guard' }),
      makeEntity({ entity_id: 'couriers', name: 'Imperial Guard of Couriers' }),
      makeEntity({ entity_id: 'subura_mob', name: 'The Mob of the Subura' }),
      makeEntity({ entity_id: 'player', name: 'Gaius Investigator' }),
    ];
    const [record] = attributeHeadlines([{
      text: 'x',
      actors: ['the Senate', 'Conscript Fathers', 'the Praetorian Guard', 'a mob of the Subura', 'the Guard', 'the mob', 'Investigator'],
    }], ['x'], [bodies], 'player');
    expect(record).toEqual({
      text: 'x',
      actorIds: ['roman_senate', 'praetorians', 'subura_mob'],
      actorNames: ['Roman Senate', 'Praetorian Guard', 'The Mob of the Subura'],
      // Two guards match "the Guard"; "mob" is too short to rest on; a loose label never names the player.
      unresolvedActors: ['the Guard', 'the mob', 'Investigator'],
    });
    // The shipped cast: "the Senate" is the Roman Senate, never the Senatorial Party.
    expect(attributeHeadlines([{ text: 'x', actors: ['the Senate', 'the mob'] }], ['x'], [ALL_INITIAL_ENTITIES])[0])
      .toEqual({ text: 'x', actorIds: ['roman_senate'], actorNames: ['Roman Senate'], unresolvedActors: ['the mob'] });
  });

  it('a declaration whose every label names no one is circumstance - its labels kept only for the GM', () => {
    expect(attributeHeadlines([{ text: 'A fire.', actors: ['ghost', 'phantom'] }], ['A fire.'], [post, pre]))
      .toEqual([{ text: 'A fire.', actorIds: [], actorNames: [], unresolvedActors: ['ghost', 'phantom'] }]);
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
    // ...and beside it, the ids alive at commit.
    expect(attempt.newHistoryEntry.livingAtCommit).toEqual(
      attempt.newHistoryEntry.postTurnEntities!.filter(entity => entity.status === 'alive').map(entity => entity.entity_id),
    );
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
    expect(ground([entryFor(['varro', 'crassus'])])).toMatchObject({
      hands: [{ id: 'varro', name: 'Senator Varro', aims: [] }, { id: 'crassus', name: 'Marcus Crassus', aims: [] }],
      groundTruth: 'Senator Varro | Marcus Crassus',
    });
  });

  it('who gains: the same hands with their OPEN intents only, deduplicated - never a covert intent, a note or a target (D28)', () => {
    const truth = ground([entryFor(['varro', 'crassus', 'obscurus', 'livia'])], 'who_gains')!;
    expect(truth.hands).toEqual([
      { id: 'varro', name: 'Senator Varro', aims: ['negotiate'] },
      { id: 'crassus', name: 'Marcus Crassus', aims: ['tax_raise', 'recruit'] },
      { id: 'obscurus', name: 'Tiberius Obscurus', aims: [] },
      // Every move Livia made was covert: she is a bare name.
      { id: 'livia', name: 'Livia Drusilla', aims: [] },
    ]);
    expect(truth.groundTruth).toBe(
      `Senator Varro: ${AIM_PHRASE.negotiate} | Marcus Crassus: ${AIM_PHRASE.tax_raise}; ${AIM_PHRASE.recruit} | Tiberius Obscurus: no aim learned | Livia Drusilla: no aim learned`,
    );
    // What a decoy's aim may be drawn from: every open intent pursued that turn, covert ones never.
    expect(truth.turnAims.map(pursued => pursued.aim).sort()).toEqual(['march', 'negotiate', 'propaganda', 'recruit', 'tax_raise']);
    const serialized = JSON.stringify(truth);
    for (const token of [...SENTINELS, 'squeezes', 'intrigue', 'assassinate']) expect(serialized).not.toContain(token);
  });

  it('no hands: it arose from circumstance - that is the truth, not a gap', () => {
    expect(ground([entryFor([])])).toMatchObject({ hands: [], groundTruth: NO_HAND_TRUTH.who_is_behind_it });
    expect(ground([entryFor([])], 'who_gains')!.groundTruth).toBe(NO_HAND_TRUTH.who_gains);
  });

  it('labels that named no roster figure read as circumstance to the player - and are named, as such, for the GM', () => {
    const unresolved = (actorIds: string[], labels: string[]) =>
      entryFor(actorIds, OCCURRENCE, { headlineActors: [{ text: OCCURRENCE, actorIds, actorNames: actorIds.map(id => NAMES[id]), unresolvedActors: labels }] });
    expect(ground([unresolved([], ['the grain factors', 'a mob'])])).toMatchObject({ hands: [], groundTruth: 'No roster figure; declared: the grain factors, a mob' });
    expect(ground([unresolved(['varro'], ['a mob'])], 'who_gains')!.groundTruth).toBe(`Senator Varro: ${AIM_PHRASE.negotiate} | declared, but no roster figure: a mob`);
    // Circumstance: the account is the honest nothing, whatever the roll.
    const read = planOccurrence(ground([unresolved([], ['a mob'])])!, 'who_is_behind_it', { accuracy: 'false', fidelity: 'fuller' }, createSeededRng(1), context());
    expect(read).toEqual({ question: 'who_is_behind_it', accuracy: 'true', fidelity: 'fuller', findings: [] });
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
    expect(ground([unfrozen(['ghost'])])).toMatchObject({ hands: [], groundTruth: NO_HAND_TRUTH.who_is_behind_it });
  });
});

// ---------------------------------------------------------------------------
// The plan: shape parity, code-picked decoys, one "came back empty" per occurrence
// ---------------------------------------------------------------------------

describe('planOccurrence - count and shape never betray the accuracy; code picks every decoy', () => {
  const shape = (read: OccurrencePlan) => read.findings.map(finding => [finding.fragmentary, finding.hand!.aims.length]);
  const HAND_SETS = [['varro'], ['obscurus'], ['livia'], ['varro', 'crassus'], ['varro', 'crassus', 'obscurus'], ['crassus', 'obscurus', 'player'], ['livia', 'hidden']];
  /** The names of the hands a reading reached, in the order its findings hold them: fidelity's draws come first, so any accuracy with the same seed reaches the same hands. */
  const reachedNames = (hands: string[], question: GroundedOccurrenceQuestion, fidelity: IntelFidelity, seed: number) =>
    planOccurrence(grounding(hands, question), question, { accuracy: 'true', fidelity }, createSeededRng(seed), context())
      .findings.map(finding => finding.groundTruth!.split(':')[0]);

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

  it('a decoy is a real figure of the true hand\'s familiarity - known for known, unknown for unknown - never a true hand, never the player', () => {
    const seen = new Set<string>();
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      for (const hands of HAND_SETS) {
        for (const accuracy of ['garbled', 'false'] as IntelAccuracy[]) {
          for (let seed = 0; seed < 40; seed++) {
            const read = plan(hands, question, accuracy, 'fuller', seed, { sibling: 'named' });
            const reached = reachedNames(hands, question, 'fuller', seed);
            for (const { replaced, name } of decoysOf(read, reached)) {
              const knownHand = replaced === NAMES.player || KNOWN_NAMES.includes(replaced);
              expect(knownHand ? KNOWN_NAMES : UNKNOWN_NAMES, `${hands}/${seed}: ${replaced} -> ${name}`).toContain(name);
              expect(hands.map(id => NAMES[id])).not.toContain(name);
              expect(name).not.toBe(NAMES.player);
              seen.add(knownHand ? 'known' : 'unknown');
            }
            // Decoys within one account are all different people, and none is a name the account already holds.
            const names = read.findings.map(finding => finding.hand!.name);
            expect(new Set(names).size).toBe(names.length);
          }
        }
      }
    }
    expect(seen).toEqual(new Set(['known', 'unknown']));
  });

  it('an unknown hand\'s decoy is a real unknown roster figure; a generated stranger stands in only when none is left - never a figure of the other familiarity', () => {
    const unknownDecoys = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      unknownDecoys.add(plan(['obscurus'], 'who_is_behind_it', 'false', 'fuller', seed, { sibling: 'named' }).findings[0].hand!.name);
    }
    expect(unknownDecoys).toEqual(new Set(['Aulus Hidden', 'Numerius Remotus']));

    // Every unknown figure is a true hand: each decoy is a stranger, all different, none a name a figure wears.
    for (let seed = 0; seed < 30; seed++) {
      const read = plan(['obscurus', 'hidden', 'remote'], 'who_is_behind_it', 'false', 'fuller', seed, { sibling: 'named' });
      const names = read.findings.map(finding => finding.hand!.name);
      expect(names).toHaveLength(3);
      for (const name of names) {
        expect(isGeneratedStranger(name), name).toBe(true);
        expect(TAKEN.has(name.toLocaleLowerCase())).toBe(false);
      }
      expect(new Set(names).size).toBe(3);
      // The ledger marks each as a stranger; the name itself is plain.
      for (const finding of read.findings) expect(finding.truth).toBe(`${finding.hand!.name}${STRANGER_MARK}`);
    }
    // A known hand with no known figure left gets a stranger too - never an unknown real figure, which would be a tell.
    for (let seed = 0; seed < 20; seed++) {
      const onlyVarroKnown = { sibling: 'named' as const, isKnown: (id: string) => id === 'player' || id === 'varro' };
      const alone = plan(['varro'], 'who_is_behind_it', 'false', 'fuller', seed, onlyVarroKnown);
      const name = alone.findings[0].hand!.name;
      expect(isGeneratedStranger(name), name).toBe(true);
      expect(UNKNOWN_NAMES).not.toContain(name);
      // A stranger never borrows a name some figure wears: take the one it chose, and it chooses another.
      const retaken = plan(['varro'], 'who_is_behind_it', 'false', 'fuller', seed, { ...onlyVarroKnown, takenNames: new Set([...TAKEN, name.toLocaleLowerCase()]) });
      expect(retaken.findings[0].hand!.name).not.toBe(name);
      expect(isGeneratedStranger(retaken.findings[0].hand!.name)).toBe(true);
    }
    // The player's own hand is a known one: its decoy is someone else they know.
    expect(KNOWN_NAMES).toContain(plan(['player'], 'who_is_behind_it', 'false', 'fuller', 3, { sibling: 'named' }).findings[0].hand!.name);
  });

  it('a fragment decoy is cut by the one rule from the full name it replaces with - a figure\'s or a stranger\'s - never from a true hand\'s', () => {
    for (let seed = 0; seed < 30; seed++) {
      const known = plan(['varro'], 'who_is_behind_it', 'false', 'fragment', seed, { sibling: 'named' }).findings[0];
      expect(known.fragmentary).toBe(true);
      expect(KNOWN_NAMES.filter(name => name !== NAMES.varro).some(name => name.split(' ').includes(known.hand!.name))).toBe(true);
      // Every unknown figure a true hand: the one reached gets a stranger's name, cut the same way.
      const stranger = plan(['obscurus', 'hidden', 'remote'], 'who_is_behind_it', 'false', 'fragment', seed, { sibling: 'named' }).findings[0];
      expect(stranger.fragmentary).toBe(true);
      for (const word of stranger.hand!.name.split(' ')) expect(STRANGER_WORDS.has(word), stranger.hand!.name).toBe(true);
    }
  });

  it('a decoy is a figure alive and on the roster at the occurrence\'s OWN turn - never judged by who is alive now', () => {
    const decoysFor = (entry: TurnHistoryEntry, live: Entity[]) => {
      const found = new Set<string>();
      const ground = grounding(['varro'], 'who_is_behind_it', entry, live);
      for (let seed = 0; seed < 40; seed++) {
        for (const finding of planOccurrence(ground, 'who_is_behind_it', { accuracy: 'false', fidelity: 'fuller' }, createSeededRng(seed), context({ sibling: 'named' })).findings) {
          found.add(finding.hand!.name);
        }
      }
      return found;
    };
    const alive = (id: string) => makeEntity({ entity_id: id, name: NAMES[id] });
    const dead = (id: string) => makeEntity({ entity_id: id, name: NAMES[id], status: 'dead' });
    const liviaDeadNow = roster.map(entity => entity.entity_id === 'livia' ? dead('livia') : entity);

    // Dead now, alive then: she may stand in.
    expect(decoysFor(entryFor(['varro'], OCCURRENCE, { postTurnEntities: [player, alive('varro'), alive('livia')] }), liviaDeadNow)).toEqual(new Set(['Livia Drusilla']));
    // Alive now, but dead then - or not yet on the roster (Quintus): never.
    expect(decoysFor(entryFor(['varro'], OCCURRENCE, { postTurnEntities: [player, alive('varro'), alive('crassus'), dead('livia')] }), roster)).toEqual(new Set(['Marcus Crassus']));
    // An entry with only its pre-turn roster: who was alive then, named from the roster.
    const preTurnRoster = [
      { entity_id: 'player', location: 'Rome', status: 'alive' as const },
      { entity_id: 'varro', location: 'Rome', status: 'alive' as const },
      { entity_id: 'quintus', location: 'Rome', status: 'alive' as const },
      { entity_id: 'crassus', location: 'Rome', status: 'dead' as const },
    ];
    expect(decoysFor(entryFor(['varro'], OCCURRENCE, { preTurnRoster }), roster)).toEqual(new Set(['Quintus Sertorius']));
    // No figure the player knows was alive then: a stranger - never the unknown figure who was.
    for (const name of decoysFor(entryFor(['varro'], OCCURRENCE, { postTurnEntities: [player, alive('varro'), alive('hidden')] }), roster)) {
      expect(isGeneratedStranger(name), name).toBe(true);
    }
    // The ids frozen at commit come first, whatever the snapshot says.
    expect(decoysFor(entryFor(['varro'], OCCURRENCE, { livingAtCommit: ['player', 'varro', 'quintus'], postTurnEntities: roster }), liviaDeadNow)).toEqual(new Set(['Quintus Sertorius']));
    // Only an entry with none of these - a save from before the freeze - falls back to the live roster.
    expect(decoysFor(entryFor(['varro']), liviaDeadNow)).toEqual(new Set(['Marcus Crassus', 'Quintus Sertorius']));
  });

  it('past the snapshot trim, the ids frozen at commit still decide: a figure dead since may stand in, one who arrived after never', () => {
    const novus = makeEntity({ entity_id: 'novus', name: 'Flavius Novus' });
    const liveNow = [...roster.map(entity => entity.entity_id === 'livia' ? { ...entity, status: 'dead' as const } : entity), novus];
    const occurrenceTurn = entryFor(['varro'], OCCURRENCE, { turnNumber: 3, postTurnEntities: roster, livingAtCommit: roster.map(entity => entity.entity_id) });
    const later = Array.from({ length: KEEP_FULL_SNAPSHOTS + 2 }, (_, i) => entryFor([], `Later ${i}.`, { turnNumber: 4 + i, postTurnEntities: liveNow }));
    const history = withOldSnapshotsDropped([occurrenceTurn, ...later]);
    expect(history[0].postTurnEntities).toBeUndefined();
    expect(history[0].livingAtCommit).toEqual(roster.map(entity => entity.entity_id));

    // Novus is someone the player knows - he would be a fair decoy, had he been alive then.
    const knowsNovus = context({ sibling: 'named', isKnown: id => id === 'player' || id === 'novus' || KNOWN_IDS.includes(id) });
    const decoys = (turnHistory: TurnHistoryEntry[]) => {
      const found = new Set<string>();
      const ground = occurrenceGrounding({ turnHistory, occurrence: OCCURRENCE, question: 'who_is_behind_it', roster: liveNow })!;
      for (let seed = 0; seed < 60; seed++) {
        found.add(planOccurrence(ground, 'who_is_behind_it', { accuracy: 'false', fidelity: 'fuller' }, createSeededRng(seed), knowsNovus).findings[0].hand!.name);
      }
      return found;
    };
    const frozen = decoys(history);
    expect(frozen).toContain('Livia Drusilla');
    expect(frozen).not.toContain('Flavius Novus');
    // A save from before the freeze can only fall back to who is alive now: the very tell the freeze closes.
    const { livingAtCommit: _dropped, ...unfrozenEntry } = history[0];
    const unfrozen = decoys([unfrozenEntry, ...history.slice(1)]);
    expect(unfrozen).toContain('Flavius Novus');
    expect(unfrozen).not.toContain('Livia Drusilla');
  });

  it('each figure frozen at commit is named off the live roster, else any snapshot - and one named nowhere is left out', () => {
    const frozen = entryFor(['varro'], OCCURRENCE, { livingAtCommit: ['player', 'varro', 'departed', 'nobody', 'varro'] });
    const since = makeTurnHistoryEntry({ turnNumber: 5, postTurnEntities: [makeEntity({ entity_id: 'departed', name: 'Lucius Departed' })] });
    const ground = occurrenceGrounding({ turnHistory: [frozen, since], occurrence: OCCURRENCE, question: 'who_is_behind_it', roster })!;
    expect(ground.aliveThen).toEqual([
      { id: 'player', name: NAMES.player },
      { id: 'varro', name: NAMES.varro },
      { id: 'departed', name: 'Lucius Departed' },
    ]);
  });

  it('a hand is reported with at most three aims - its first three open intents - and a false reading keeps that shape without running dry', async () => {
    const SEVEN: EntityActionIntent[] = ['tax_raise', 'recruit', 'march', 'raid', 'siege', 'fortify', 'propaganda'];
    const busy = entryFor(['crassus'], OCCURRENCE, {
      adjudication: makeAdjudication({
        turn: 3,
        headlines: [OCCURRENCE],
        entityActions: [
          ...SEVEN.map(intent => ({ id: 'crassus', intent, target: null, notes: '' })),
          { id: 'varro', intent: 'negotiate' as const, target: null, notes: '' },
        ],
      }),
    });
    const ground = grounding(['crassus'], 'who_gains', busy);
    expect(MAX_AIMS_PER_HAND).toBe(3);
    expect(ground.hands[0].aims).toEqual(['tax_raise', 'recruit', 'march']);
    expect(ground.groundTruth).toBe(`Marcus Crassus: ${AIM_PHRASE.tax_raise}; ${AIM_PHRASE.recruit}; ${AIM_PHRASE.march}`);
    for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
      for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
        for (let seed = 0; seed < 40; seed++) {
          const read = planOccurrence(ground, 'who_gains', { accuracy, fidelity }, createSeededRng(seed), context({ sibling: 'named' }));
          for (const finding of read.findings) {
            expect(finding.hand!.aims).toHaveLength(3);
            for (const aim of finding.hand!.aims) expect(Object.keys(AIM_PHRASE)).toContain(aim);
            expect(new Set(finding.hand!.aims).size).toBe(3);
          }
          expect(() => buildClarificationPrompt(OCCURRENCE, 'who_gains', player, read)).not.toThrow();
        }
      }
    }
    // Through the tool, on a false roll: three aims, none undefined, no throw.
    pinRolls([1, 15, 20]);
    const { ai, calls } = recordingAi('Crassus, they say.');
    const { truth } = await ask('who_gains', [busy], ai, { sibling: 'named' });
    expect(truth!.finding.standing).toBe('false');
    const line = calls[0].prompt.split('\n').find(candidate => /^1\. /.test(candidate))!;
    expect(line.split(' - sought: ')[1].split(', ')).toHaveLength(3);
    expect(line).not.toContain('undefined');
  });

  it('covert intents are never an aim - not a true one, not a decoy\'s: a covert-only hand is a bare name on every reading', () => {
    expect(Object.keys(AIM_PHRASE)).not.toContain('intrigue');
    expect(Object.keys(AIM_PHRASE)).not.toContain('assassinate');
    // A turn where no one else pursued an open aim: a false aim falls back to the enum - still never a covert one.
    const loneTurn = entryFor(['varro', 'livia'], OCCURRENCE, {
      adjudication: makeAdjudication({ turn: 3, headlines: [OCCURRENCE], entityActions: TURN_ACTIONS.filter(action => action.id === 'varro' || action.id === 'livia') }),
    });
    for (const ground of [grounding(['varro', 'crassus', 'livia'], 'who_gains'), grounding(['varro', 'livia'], 'who_gains', loneTurn)]) {
      expect(ground.hands.find(hand => hand.id === 'livia')!.aims).toEqual([]);
      for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
          for (let seed = 0; seed < 30; seed++) {
            const read = planOccurrence(ground, 'who_gains', { accuracy, fidelity }, createSeededRng(seed), context({ sibling: 'named' }));
            for (const finding of read.findings) {
              for (const aim of finding.hand!.aims) expect(COVERT_INTENTS).not.toContain(aim);
              expect(finding.truth).not.toMatch(/intrigue|assassinat|kill/i);
            }
            const built = buildClarificationPrompt(OCCURRENCE, 'who_gains', player, read);
            for (const token of SENTINELS) expect(`${built.systemInstruction}\n${built.prompt}`).not.toContain(token);
          }
        }
      }
    }
  });

  it('a false or changed aim is one some OTHER figure pursued that turn, never the entry\'s own; any open intent only when none is left', () => {
    const drawn = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const reached = reachedNames(['varro', 'crassus'], 'who_gains', 'fuller', seed);
      const truthful = plan(['varro', 'crassus'], 'who_gains', 'true', 'fuller', seed);
      const falseRead = plan(['varro', 'crassus'], 'who_gains', 'false', 'fuller', seed, { sibling: 'named' });
      falseRead.findings.forEach((finding, i) => {
        const id = idOf(reached[i])!;
        expect(finding.hand!.aims).toHaveLength(truthful.findings[i].hand!.aims.length);
        for (const aim of finding.hand!.aims) {
          expect(OTHERS_AIMS[id]).toContain(aim);
          drawn.add(aim);
        }
        expect(new Set(finding.hand!.aims).size).toBe(finding.hand!.aims.length);
      });
      const garbled = plan(['varro', 'crassus'], 'who_gains', 'garbled', 'fuller', seed);
      garbled.findings.forEach((finding, i) => {
        if (finding.distortion !== 'element_changed') return;
        const id = idOf(reached[i])!;
        const changed = finding.hand!.aims.filter(aim => !truthful.findings[i].hand!.aims.includes(aim));
        expect(changed).toHaveLength(1);
        expect(OTHERS_AIMS[id]).toContain(changed[0]);
      });
    }
    expect(drawn).toEqual(new Set(['tax_raise', 'recruit', 'march', 'propaganda', 'negotiate']));

    // No one else pursued an open aim that turn: any open intent but the entry's own.
    const loneTurn = entryFor(['varro'], OCCURRENCE, {
      adjudication: makeAdjudication({ turn: 3, headlines: [OCCURRENCE], entityActions: TURN_ACTIONS.filter(action => action.id === 'varro') }),
    });
    const fallback = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const read = planOccurrence(grounding(['varro'], 'who_gains', loneTurn), 'who_gains', { accuracy: 'false', fidelity: 'fuller' }, createSeededRng(seed), context({ sibling: 'named' }));
      for (const aim of read.findings[0].hand!.aims) {
        expect(aim).not.toBe('negotiate');
        expect(Object.keys(AIM_PHRASE)).toContain(aim);
        fallback.add(aim);
      }
    }
    expect(fallback.size).toBeGreaterThan(5);
  });

  it('garbled changes one thing in one entry: a bare name is only pinned on another, an aimed one may have one aim changed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const truthful = plan(['varro', 'obscurus'], 'who_gains', 'true', 'fuller', seed);
      const garbled = plan(['varro', 'obscurus'], 'who_gains', 'garbled', 'fuller', seed);
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
      expect(changed[0].truth).toContain(after.name);
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
    expect(held.withheld).toEqual([`Senator Varro: ${AIM_PHRASE.negotiate}`, `Marcus Crassus: ${AIM_PHRASE.tax_raise}; ${AIM_PHRASE.recruit}`]);
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

  it('who gains: each hand and its aims ride as data - open intents only; a covert-only hand is a bare name; never a note, a target or a goal', async () => {
    pinRolls([15, 15]);
    const { ai, calls } = recordingAi('Varro, by my read.');
    const { truth } = await ask('who_gains', [entryFor(['varro', 'obscurus', 'livia'])], ai);
    const prompt = sent(calls);
    expect(prompt).toContain(`${asPromptData('Senator Varro')} - sought: ${asPromptData(AIM_PHRASE.negotiate)}`);
    expect(prompt).toContain(`${asPromptData('Tiberius Obscurus')} - sought: (not learned)`);
    expect(prompt).toContain(`${asPromptData('Livia Drusilla')} - sought: (not learned)`);
    for (const token of [...SENTINELS, 'intrigue', 'assassinat']) expect(prompt).not.toContain(token);
    expect(JSON.stringify(truth)).not.toMatch(/SENTINEL|Sicarius|intrigue|assassinat/);
  });

  it('a decoy of any kind - a known figure, an unknown one, a generated stranger - rides as a plain name under ONE instruction, with no list of figures', async () => {
    pinRolls([15, 15]);
    const truthful = recordingAi('Varro, they say.');
    await ask('who_is_behind_it', [entryFor(['varro'])], truthful.ai);
    vi.restoreAllMocks();

    const falseReading = async (hands: string[], knowledge: KnowledgeClaim[] = []) => {
      pinRolls([1, 15, 20]); // accuracy 4 -> false; fuller; the planner's draw keeps the count
      const misled = recordingAi('The prefect of the watch, they say.');
      const { truth } = await ask('who_is_behind_it', [entryFor(hands)], misled.ai, { knowledge });
      vi.restoreAllMocks();
      return { calls: misled.calls, finding: truth!.finding, decoy: namesIn(misled.calls)[0] };
    };
    const known = await falseReading(['varro']);
    const unknown = await falseReading(['obscurus']);
    // Hidden and Remotus are known to the player through their store alone - the Dramatis Personae's own test - so no unknown figure is left to stand in.
    const stranger = await falseReading(['obscurus'], heardOf(['hidden', 'remote']));

    expect(KNOWN_NAMES.filter(name => name !== NAMES.varro)).toContain(known.decoy);
    expect(['Aulus Hidden', 'Numerius Remotus']).toContain(unknown.decoy);
    expect(isGeneratedStranger(stranger.decoy), stranger.decoy).toBe(true);
    expect(Object.values(NAMES)).not.toContain(stranger.decoy);
    for (const reading of [known, unknown, stranger]) {
      // The model is never told which reading, nor which kind of decoy, it holds: the instruction is the truth's, byte for byte...
      expect(reading.calls[0].systemInstruction).toBe(truthful.calls[0].systemInstruction);
      // ...and the prompt differs from the truth's only by the name.
      expect(reading.calls[0].prompt).toBe(truthful.calls[0].prompt.replace(asPromptData('Senator Varro'), asPromptData(reading.decoy)));
      // No list of figures rides anywhere: the one figure's name in the prompt is the entry's own (beside the master's).
      for (const name of Object.values(NAMES)) {
        if (name !== NAMES.player && name !== reading.decoy) expect(sent(reading.calls)).not.toContain(name);
      }
      expect(sent(reading.calls)).not.toMatch(/stranger|no roster figure|figures your master knows/i);
      expect(reading.finding).toMatchObject({ standing: 'false', cameBackEmpty: false });
    }
    expect(known.finding).toMatchObject({ groundTruth: 'Senator Varro', planned: known.decoy });
    expect(unknown.finding).toMatchObject({ groundTruth: 'Tiberius Obscurus', planned: unknown.decoy });
    // Only the GM's ledger says a stranger is one.
    expect(stranger.finding.planned).toBe(`${stranger.decoy}${STRANGER_MARK}`);
  });

  it('a generated stranger never borrows a name the roster, any snapshot or any hand\'s frozen record wears', async () => {
    const strangerFor = async (history: TurnHistoryEntry[]) => {
      pinRolls([1, 15, 20]);
      const { truth } = await ask('who_is_behind_it', history, recordingAi('A stranger, they say.').ai, { knowledge: heardOf(['hidden', 'remote']) });
      vi.restoreAllMocks();
      return truth!.finding.planned.replace(STRANGER_MARK, '');
    };
    const first = await strangerFor([entryFor(['obscurus'])]);
    expect(isGeneratedStranger(first)).toBe(true);
    // The same draw, once a long-gone hand frozen in an older record wore that name: another is drawn.
    const older = entryFor(['ghost'], 'An older fire.', { turnNumber: 1, headlineActors: [{ text: 'An older fire.', actorIds: ['ghost'], actorNames: [first] }] });
    const second = await strangerFor([older, entryFor(['obscurus'])]);
    expect(second).not.toBe(first);
    expect(isGeneratedStranger(second)).toBe(true);
    // ...and likewise once a snapshot figure wore it.
    const snapshot = entryFor([], 'Another.', { turnNumber: 2, postTurnEntities: [makeEntity({ entity_id: 'someone', name: first })] });
    expect(await strangerFor([snapshot, entryFor(['obscurus'])])).not.toBe(first);
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
    expect(await tierFor(quiet, ['varro'])).toEqual(await tierFor(quiet, ['obscurus']));
    expect(await tierFor(namesAStranger, ['varro'])).toEqual(await tierFor(namesAStranger, ['obscurus']));
    expect(await tierFor(namesAFriend, ['obscurus'])).toEqual(await tierFor(namesAFriend, ['varro']));
    expect((await tierFor(quiet, ['obscurus'])).tier).toBe('success');
    expect((await tierFor(namesAFriend, ['obscurus'])).tier).toBe('success');
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
    vi.restoreAllMocks();

    // Labels the adjudicator declared but no roster figure answered: circumstance to the player, named for the GM.
    pinRolls([1, 15]);
    const declared = await ask('who_gains', [entryFor([], OCCURRENCE, { headlineActors: [{ text: OCCURRENCE, actorIds: [], actorNames: [], unresolvedActors: ['the grain factors'] }] })], ai);
    expect(declared.truth!.finding).toMatchObject({ standing: 'true', groundTruth: 'No roster figure; declared: the grain factors', cameBackEmpty: true, planned: '' });
    expect(sent(calls)).toContain("Your agents found no one's scheme behind it");
    expect(sent(calls)).not.toContain('grain factors');
  });

  it('what follows: untouched - a forecast from the headline and the figures the master knows, with no truth', async () => {
    const { ai, calls } = recordingAi('Expect the price of bread to climb, master.');
    const answer = await ask('what_follows', [entryFor(['obscurus'])], ai);
    expect(answer).toEqual({ text: 'Expect the price of bread to climb, master.' });
    expect(calls[0].prompt).toBe(buildOccurrenceForecastPrompt(OCCURRENCE, player, KNOWN_NAMES).prompt);
    expect(calls[0].prompt).toContain(`**Figures your master knows (data):** ${KNOWN_NAMES.map(name => asPromptData(name)).join(', ')}`);
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

describe('the occurrence prompts: one instruction per question; no GM-private vocabulary, roll or note, for any plan', () => {
  it('whatever the question, accuracy, fidelity, sibling or kind of decoy', () => {
    for (const question of ['who_is_behind_it', 'who_gains'] as const) {
      const instructions = new Set<string>();
      for (const accuracy of ['true', 'garbled', 'false'] as IntelAccuracy[]) {
        for (const fidelity of ['fragment', 'partial', 'fuller'] as IntelFidelity[]) {
          // No hands; known, unknown and covert-only hands; every unknown figure a hand (strangers stand in).
          for (const hands of [[], ['varro', 'crassus', 'obscurus', 'livia'], ['obscurus', 'hidden', 'remote']]) {
            for (const sibling of [null, 'empty', 'named'] as const) {
              const read = planOccurrence(grounding(hands, question), question, { accuracy, fidelity }, createSeededRng(3), context({ sibling }));
              const built = buildClarificationPrompt(OCCURRENCE, question, player, read);
              const text = `${built.systemInstruction}\n${built.prompt}`;
              for (const token of [...TRUTH_FLAG_TOKENS, ...SENTINELS]) expect(text, `${question}/${accuracy}/${fidelity}`).not.toContain(token);
              expect(text).not.toMatch(/\broll(?:ed)?\b|\bmisled\b|\bdistort|\binvent|\bdecoy|stranger|no roster figure|figures your master knows/i);
              expect(built.systemInstruction).toContain('your master may choose to distrust - never as settled fact');
              if (read.findings.length > 0) instructions.add(built.systemInstruction);
            }
          }
        }
      }
      expect(instructions.size, question).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Mock Mode: the same path, deterministically, in the game's words
// ---------------------------------------------------------------------------

describe('Mock Mode - deterministic, following the same plan', () => {
  const mock = (question: OccurrenceQuestion, hands: string[], occurrence = OCCURRENCE, sibling: OccurrenceSiblingOutcome | null = null, knowledge: KnowledgeClaim[] = []) =>
    ask(question, [entryFor(hands, occurrence)], {} as GoogleGenAI, { isMockMode: true, occurrence, sibling, knowledge });

  it('the same question about the same occurrence lands the same way, from a seed fixed by both, never Math.random', async () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random touched'); });
    const first = await mock('who_is_behind_it', ['varro', 'crassus']);
    expect(await mock('who_is_behind_it', ['varro', 'crassus'])).toEqual(first);
    expect(first.truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_is_behind_it'));
    expect((await mock('who_gains', ['varro'])).truth!.rolls.seed).toBe(mockIntelSeed(OCCURRENCE, 'who_gains'));
    expect(random).not.toHaveBeenCalled();
  });

  it('renders aims as phrases - "who sought to ..." - never engine formatting, a covert intent, or a note', async () => {
    let rendered = false;
    for (let i = 0; i < 60 && !rendered; i++) {
      const occurrence = `The mint is robbed, the ${i}th time.`;
      const { text, truth } = await mock('who_gains', ['crassus'], occurrence);
      expect(text).not.toMatch(/ - |intrigue|assassinat|_/);
      for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
      if (truth!.finding.standing === 'true' && truth!.rolls.fidelity !== 'fragment') {
        expect(text).toBe(`(Mock) Your agents say it serves Marcus Crassus, who sought ${AIM_PHRASE.tax_raise} and ${AIM_PHRASE.recruit}.`);
        rendered = true;
      }
    }
    expect(rendered).toBe(true);
  });

  it('a false or garbled reading names exactly the code-picked decoy - a known figure, an unknown one, or a generated stranger', async () => {
    const seen = new Set<string>();
    const strangers: string[] = [];
    const run = async (knowledge: KnowledgeClaim[]) => {
      for (let i = 0; i < 120; i++) {
        const occurrence = `Occurrence number ${i} is cried.`;
        const { text, truth } = await mock('who_is_behind_it', ['varro', 'obscurus'], occurrence, 'named', knowledge);
        if (truth!.finding.standing === 'true') continue;
        const fragment = truth!.rolls.fidelity === 'fragment';
        for (const entry of truth!.finding.planned.split(' | ')) {
          const isStranger = entry.endsWith(STRANGER_MARK);
          const name = isStranger ? entry.slice(0, -STRANGER_MARK.length) : entry;
          // The mock writes the planned name as it stands - a fragment already cut by code - and no descriptor.
          expect(text).toContain(fragment ? `…${name}…` : name);
          if (fragment) continue;
          if (isStranger) {
            expect(isGeneratedStranger(name), name).toBe(true);
            strangers.push(name);
            seen.add('stranger');
          } else if (name !== NAMES.varro && name !== NAMES.obscurus) {
            expect([...KNOWN_NAMES, ...UNKNOWN_NAMES]).toContain(name);
            seen.add(KNOWN_NAMES.includes(name) ? 'known decoy' : 'unknown decoy');
          }
        }
        expect(text).not.toMatch(/stranger|no roster figure|unknown/i);
      }
    };
    await run([]);
    await run(heardOf(['hidden', 'remote']));
    expect(seen).toEqual(new Set(['known decoy', 'unknown decoy', 'stranger']));
    // The same generator offline: no stranger recurs as a learnable mark.
    expect(strangers.length).toBeGreaterThan(20);
    expect(new Set(strangers).size).toBeGreaterThanOrEqual(strangers.length * 0.8);
  });

  it('parity offline: an account names as many hands as the truth would have, or none at all', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const occurrence = `Occurrence number ${i} is cried.`;
      const { text, truth } = await mock('who_is_behind_it', ['varro', 'crassus', 'obscurus'], occurrence);
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
// D11: the truth lands with the finding; the cap spares paid truth; the sibling outlives the cap; the GM console
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
  const FORBIDDEN_STORE_KEYS = ['isTrue', 'standing', 'groundTruth', 'distortion', 'investigation', 'accuracy', 'fidelity', 'rolls', 'headlineActors', 'actorIds', 'actorNames', 'unresolvedActors', 'planned', 'heldToSibling'].map(key => `"${key}"`);

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
  const rumorEntry = (i: number): TruthLedgerEntry => ({ id: `rumor_${i}`, turn: i, claim: `Rumor ${i}.`, aboutId: 'varro', isTrue: true, reportId: `r${i}` });

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
    // The player's own finding keeps only what they read in it: that it named someone.
    expect(action.knowledge.find(claim => claim.claimKey === occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'))!.cameBackEmpty).toBe(false);
    const store = JSON.stringify(action.knowledge);
    for (const key of FORBIDDEN_STORE_KEYS) expect(store).not.toContain(key);
    expect(store).not.toContain('Senator Varro');
  });

  it('reads the sibling question\'s outcome back off the ledger when the store has none: empty, named, or nothing to go on', () => {
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

  it('reads the player\'s own finding first: it outranks the ledger, a re-ask updates it, and one from before the store said defers', () => {
    const ledgerSaysEmpty = [occurrenceLedgerEntry(truthOf('true', 'x', { cameBackEmpty: true }), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 1)];
    const finding = (cameBackEmpty?: boolean, store: KnowledgeClaim[] = []) =>
      ingestOccurrenceFinding(store, { occurrence: OCCURRENCE, question: 'who_is_behind_it', text: 'Varro, they say.', turn: 4, ...(cameBackEmpty === undefined ? {} : { cameBackEmpty }) });
    const siblingOver = (knowledge: KnowledgeClaim[]) => {
      const hook = renderHook(useIntelCommits, deps({ knowledge, truthLedger: ledgerSaysEmpty }).input);
      const outcome = hook.current.occurrenceSibling(OCCURRENCE, 'who_gains');
      hook.unmount();
      return outcome;
    };
    expect(siblingOver(finding(false))).toBe('named');
    expect(siblingOver(finding(true, finding(false)))).toBe('empty');
    expect(siblingOver(finding(undefined))).toBe('empty');
    // Only the other grounded question's finding counts, and only for this occurrence.
    expect(occurrenceSiblingInStore(finding(true), OCCURRENCE, 'who_is_behind_it')).toBeNull();
    expect(occurrenceSiblingInStore(finding(true), 'Another occurrence.', 'who_gains')).toBeNull();
  });

  it('the sibling\'s durable home is the player\'s own finding: once the ledger\'s cap evicts the first answer, the second still agrees', async () => {
    const cases = [
      { first: truthOf('false', 'Circumstance, master.', { planned: '', cameBackEmpty: true }), outcome: 'empty' as const },
      { first: truthOf('true'), outcome: 'named' as const },
    ];
    for (const { first, outcome } of cases) {
      const { input, commits } = deps();
      const asked = renderHook(useIntelCommits, input);
      asked.current.handleOccurrenceFinding(OCCURRENCE, 'who_is_behind_it', first.finding.text, live, first);
      asked.unmount();
      const action = commits[0].action as { knowledge: KnowledgeClaim[]; truthLedger: TruthLedgerEntry[] };

      // A reign's worth of later truths fills the ledger to its cap: the first answer's entry is gone...
      const ledger = appendTruthLedgerEntries(action.truthLedger, Array.from({ length: MAX_TRUTH_LEDGER_ENTRIES }, (_, i) => rumorEntry(i)));
      expect(ledger).toHaveLength(MAX_TRUTH_LEDGER_ENTRIES);
      expect(ledger.some(entry => entry.investigation?.kind === 'occurrence')).toBe(false);
      expect(siblingOccurrenceOutcome(ledger, OCCURRENCE, 'who_gains')).toBeNull();
      // ...while the player's finding outlasts a store flooded with hearsay past ITS cap.
      const knowledge = ingestReports(action.knowledge, Array.from({ length: MAX_KNOWLEDGE_CLAIMS + 50 }, (_, i) => ({
        id: `word_${i}`, turn: 5, source: 'rumor' as const, about: 'varro', claim: `Word ${i}.`, credibility: 0.4, topic: `word ${i}`,
      })));
      expect(knowledge).toHaveLength(MAX_KNOWLEDGE_CLAIMS);

      const later = renderHook(useIntelCommits, deps({ knowledge, truthLedger: ledger }).input);
      const sibling = later.current.occurrenceSibling(OCCURRENCE, 'who_gains');
      later.unmount();
      expect(sibling).toBe(outcome);

      // The second question agrees, on a TRUE roll and on a false one alike.
      for (const rolls of [[15, 15], [1, 15, 1]]) {
        pinRolls(rolls);
        const second = await ask('who_gains', [entryFor(['varro'])], recordingAi('An answer.').ai, { sibling });
        vi.restoreAllMocks();
        expect(second.truth!.finding.cameBackEmpty, `${outcome} / ${rolls}`).toBe(outcome === 'empty');
      }
    }
  });

  it('a forecast, or the honest "no thread to follow", leaves the ledger as it stands and no outcome in the store; a stale request commits nothing', () => {
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
      expect(JSON.stringify(commit.action)).not.toContain('cameBackEmpty');
    }
  });

  it('at the cap, free occurrence answers are evicted first, oldest first - then the oldest of the rest; new entries never', () => {
    const answer = (i: number): TruthLedgerEntry => ({ ...occurrenceLedgerEntry(truthOf('true'), 'k', i, i), id: `occ_${i}` });
    const full = Array.from({ length: MAX_TRUTH_LEDGER_ENTRIES }, (_, i) => (i === 5 || i === 50 ? answer(i) : rumorEntry(i)));

    const afterOne = appendTruthLedgerEntries(full, [rumorEntry(900)]);
    expect(afterOne).toHaveLength(MAX_TRUTH_LEDGER_ENTRIES);
    expect(afterOne.map(entry => entry.id)).not.toContain('occ_5');
    expect(afterOne.map(entry => entry.id)).toContain('occ_50');
    expect(afterOne[0].id).toBe('rumor_0');

    const afterThree = appendTruthLedgerEntries(full, [answer(901), rumorEntry(902), rumorEntry(903)]);
    const ids = afterThree.map(entry => entry.id);
    expect(ids).not.toContain('occ_5');
    expect(ids).not.toContain('occ_50');
    expect(ids).not.toContain('rumor_0');
    expect(ids).toContain('rumor_1');
    expect(ids.slice(-3)).toEqual(['occ_901', 'rumor_902', 'rumor_903']);
  });

  it('the GM console shows it: the question, the occurrence, the standing, the truth, what was planned and the rolls', async () => {
    const key = occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it');
    const entry = occurrenceLedgerEntry(truthOf('false', 'Nothing - circumstance.', { planned: '', cameBackEmpty: true, heldToSibling: true }), key, 4, 1);
    const decoyed = occurrenceLedgerEntry(truthOf('false', 'Livia, they say.', { planned: 'Livia Drusilla' }), key, 4, 2);
    const stranger = occurrenceLedgerEntry(truthOf('false', 'Calpurnius, they say.', { planned: `Gnaeus Calpurnius${STRANGER_MARK}` }), key, 4, 3);
    const declared = occurrenceLedgerEntry(truthOf('true', 'Circumstance.', { groundTruth: 'No roster figure; declared: the grain factors', planned: '', cameBackEmpty: true }), key, 4, 4);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<TruthLedgerView ledger={[entry, decoyed, stranger, declared]} reports={[]} />));
    const text = container.textContent ?? '';
    expect(text).toContain('FALSE');
    expect(text).toContain('occurrence question · who is behind it?');
    expect(text).toContain(`asked of: “${OCCURRENCE}”`);
    expect(text).toContain('truth: “Senator Varro | Marcus Crassus”');
    expect(text).toContain('planned: “Livia Drusilla”');
    expect(text).toContain('planned: “Gnaeus Calpurnius (a stranger, no roster figure)”');
    expect(text).toContain('truth: “No roster figure; declared: the grain factors”');
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

  /** Mounts the tab over a live store and ledger, as App does (hooks/useIntelCommits.ts): findings commit their truth, and the sibling is read back, store first. */
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
          occurrenceSibling={(asked, question) => question === 'what_follows'
            ? null
            : occurrenceSiblingInStore(knowledge, asked, question) ?? siblingOccurrenceOutcome(ledger, asked, question)}
          onFinding={(asked, question, text, _request, truth) => {
            captured.push(truth);
            setKnowledge(prev => ingestOccurrenceFinding(prev, { occurrence: asked, question, text, turn: 3, ...(truth ? { cameBackEmpty: truth.finding.cameBackEmpty } : {}) }));
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
      const { text, truth } = await getClarificationOnEvent({} as GoogleGenAI, occurrence, 'who_is_behind_it', player,
        { allEntities: cast, turnHistory: history(occurrence, hands), knowledge: [] }, true);
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
    // A hand the player does not know gets a decoy they do not know either.
    expect(UNKNOWN_NAMES).toContain(captured[0]!.finding.planned);
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
      livingAtCommit: roster.map(entity => entity.entity_id),
      npcMindResults: [],
    }));
    const trimmed = withOldSnapshotsDropped(history);
    expect(trimmed[0].postTurnEntities).toBeUndefined();
    expect(trimmed.map(entry => entry.headlineActors)).toEqual(history.map(entry => entry.headlineActors));
    expect(trimmed.map(entry => entry.livingAtCommit)).toEqual(history.map(entry => entry.livingAtCommit));
  });

  it('round-trips through the save with the occurrence\'s ledger entry and the player\'s finding, and loads into the reducer', () => {
    localStorage.clear();
    const ledger = [occurrenceLedgerEntry(truthOf('true'), occurrenceClaimKey(OCCURRENCE, 'who_is_behind_it'), 4, 1)];
    const knowledge = ingestOccurrenceFinding([], { occurrence: OCCURRENCE, question: 'who_is_behind_it', text: 'Circumstance.', turn: 4, cameBackEmpty: true });
    const withUnresolved: HeadlineAttribution[] = [...records, { text: 'A riot.', actorIds: [], actorNames: [], unresolvedActors: ['a mob'] }];
    const save = makeLegacySaveState({ turnHistory: [entryFor(['varro'], OCCURRENCE, { headlineActors: withUnresolved, livingAtCommit: ['player', 'varro'] })], truthLedger: ledger, knowledge });
    expect(saveGame(save)).toEqual({ ok: true });
    const loaded = loadGame()!.state;
    expect(loaded.turnHistory[0].headlineActors).toEqual(withUnresolved);
    expect(loaded.truthLedger).toEqual(ledger);
    const state = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded });
    expect(state.turnHistory[0].headlineActors).toEqual(withUnresolved);
    expect(state.turnHistory[0].livingAtCommit).toEqual(['player', 'varro']);
    // The sibling's durable home survives a reload.
    expect(occurrenceSiblingInStore(state.knowledge, OCCURRENCE, 'who_gains')).toBe('empty');
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
    expect(await getClarificationOnEvent(ai, OCCURRENCE, 'who_is_behind_it', player, { allEntities: roster, turnHistory: loaded.turnHistory, knowledge: [] }, false))
      .toEqual({ text: NO_THREAD_TO_FOLLOW.who_is_behind_it });
    expect(calls).toHaveLength(0);
    localStorage.clear();
  });
});

describe('the code lists', () => {
  it('AIM_PHRASE phrases every OPEN entityAction intent in the game\'s words - and no covert one', () => {
    expect(COVERT_INTENTS).toEqual(['assassinate', 'intrigue']);
    expect(Object.keys(AIM_PHRASE).sort()).toEqual([...EntityActionIntentEnum].filter(intent => !COVERT_INTENTS.includes(intent)).sort());
    for (const phrase of Object.values(AIM_PHRASE)) {
      expect(phrase).toMatch(/^to [a-z]/);
      expect(phrase).not.toMatch(/kill|murder|intrigue|plot/i);
    }
  });

  it('the stranger generator\'s pools run to tens of thousands of names, in third-century forms', () => {
    const { praenomina, nomina, cognomina } = STRANGER_NAME_PARTS;
    expect(praenomina.length).toBeGreaterThanOrEqual(15);
    expect(nomina.length).toBeGreaterThanOrEqual(50);
    expect(cognomina.length).toBeGreaterThanOrEqual(50);
    for (const pool of [praenomina, nomina, cognomina.map(([masculine]) => masculine), cognomina.map(([, feminineForm]) => feminineForm)]) {
      expect(new Set(pool).size).toBe(pool.length);
    }
    for (const nomen of nomina) expect(nomen).toMatch(/ius$/);
    const combinations = praenomina.length * nomina.length * (1 + cognomina.length) + nomina.length * cognomina.length;
    expect(combinations).toBeGreaterThan(20_000);
  });

  it('strangerName: diverse, varying with the seed, in all three forms - and never a name a figure wears', () => {
    const cast = new Set([...ALL_INITIAL_ENTITIES, ...roster].map(entity => entity.name.toLocaleLowerCase()));
    const isTaken = (name: string) => cast.has(name.toLocaleLowerCase());
    const rng = createSeededRng(1);
    const drawn = Array.from({ length: 2000 }, () => strangerName(rng, isTaken));
    const counts = new Map<string, number>();
    for (const name of drawn) {
      expect(isGeneratedStranger(name), name).toBe(true);
      expect(isTaken(name)).toBe(false);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // No name more than a quarter of a percent of the draws; nearly every draw a new one.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(5);
    expect(counts.size).toBeGreaterThan(1800);
    const forms = new Set(drawn.map(name => name.split(' ').length === 3 ? 'three' : STRANGER_NAME_PARTS.praenomina.includes(name.split(' ')[0]) ? 'man' : 'woman'));
    expect(forms).toEqual(new Set(['three', 'man', 'woman']));
    // Different seeds, different strangers.
    const firsts = new Set(Array.from({ length: 30 }, (_, seed) => strangerName(createSeededRng(seed), isTaken)));
    expect(firsts.size).toBeGreaterThanOrEqual(27);
    // A refused name is never returned: the next is drawn instead.
    const first = strangerName(createSeededRng(5), () => false);
    const second = strangerName(createSeededRng(5), name => name === first);
    expect(second).not.toBe(first);
    expect(isGeneratedStranger(second)).toBe(true);
  });

  it('across four hundred false readings of an unknown hand with no unknown figure left, no stranger recurs often enough to learn', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 400; seed++) {
      const read = plan(['obscurus'], 'who_is_behind_it', 'false', 'fuller', seed, { sibling: 'named', isKnown: id => id !== 'obscurus' });
      const name = read.findings[0].hand!.name;
      expect(Object.values(NAMES)).not.toContain(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
    expect(counts.size).toBeGreaterThan(350);
  });
});
