// @vitest-environment jsdom
/**
 * tests/journeys/retryDice.journey.ts
 *
 * DESIGN_DECISIONS.md D51 - "A retried turn keeps its dice" - through the
 * REAL App transaction and the REAL turn pipeline. Only the provider
 * boundary is scripted.
 *
 * Turn 1 draws three dice from one generator, in the documented order: the
 * consequential action's roll, the mortality roll on a validated claim on
 * the Emperor's life, and the composure roll of Julia Mamaea, who stands
 * with him in the palace and keeps a secret faith. The attempt then fails
 * at the last provider call - AFTER the narration was written, which in
 * play streams to the player as it comes. Whatever the player does next -
 * Retry, rewrite the action and send it, reload the page, restore an
 * earlier copy of the reign - the turn draws the same three dice, because
 * its seed is the reign's seed mixed with the turn's number
 * (ai/core/resolution.ts::deriveTurnSeed), not a fresh draw per attempt.
 *
 * runNewTurn is wrapped (never replaced) so the failed attempt's own record
 * - its seed and every roll it made - can be compared with the committed
 * one; a failed attempt's record is otherwise discarded with it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as turnModule from '../../ai/core/turn';
import type { RunNewTurnResult } from '../../ai/core/turn';
import {
  JourneyRunner,
  ScriptedClient,
  appButton,
  appClick,
  appControl,
  appSetValue,
  buildSaveStateFromThread,
  clearAppGeminiScript,
  installAppGeminiScript,
  loadThreadState,
  mountJourneyApp,
  mountJourneyAppFromAutosave,
  scriptedFailure,
  scriptedJsonArray,
  waitForApp,
  type MountedJourneyApp,
} from './harness';
import {
  PLAYER_ID,
  scriptAdjudication,
  scriptAssessmentConsequential,
  scriptAssessmentIdle,
  scriptMonologue,
  scriptMortalityValidation,
  scriptNarration,
  scriptSimulationState,
  scriptStoryRelevance,
  statusDelta,
} from './fixtures';
import { createSeededRng, deriveTurnSeed, rollD20 } from '../../ai/core/resolution';
import { replayTurnDraws } from '../../ai/core/turnReplay';
import { composureRollsOf } from '../../ai/core/composure';
import { importSaveBlob, isValidReignSeed, rawSaveBlob, SAVE_KEY } from '../../persistence/saveGame';
import type { EventDelta, TurnHistoryEntry } from '../../types';

vi.mock('../../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn(actual.runNewTurn) };
});

const runNewTurnSpy = vi.mocked(turnModule.runNewTurn);

afterEach(() => {
  clearAppGeminiScript();
  runNewTurnSpy.mockClear();
});

const JULIA = 'julia_mamaea'; // on the Palatine with the Emperor; keeps the circle of Origen secret
const INTENT = 'Hold the audience in the palace with my mother at my side.';
const REWRITTEN_INTENT = 'Receive the petitioners behind closed doors, my mother beside me.';
/** The dice turn 1 is made to draw: action, then mortality (14 - the Emperor survives), then Julia's composure. */
const TURN_ONE_ROLLS = [12, 14, 9];

/**
 * A reign seed whose turn `turn` draws exactly `rolls` first - found by
 * search, as the harness finds a turn seed for scripted dice
 * (harness.ts::findSeedForRolls), but through deriveTurnSeed: the App never
 * draws a turn seed, only the reign's.
 */
function findReignSeedForRolls(turn: number, rolls: number[]): number {
  for (let reign = 0; reign < 5_000_000; reign++) {
    const rng = createSeededRng(deriveTurnSeed(reign, turn));
    if (rolls.every(roll => rollD20(rng) === roll)) return reign;
  }
  throw new Error(`no reign seed draws ${JSON.stringify(rolls)} on turn ${turn}`);
}

/** Every die a turn's record says it rolled, in draw order (turnReplay's order). */
function drawsOf(entry: TurnHistoryEntry): number[] {
  return [
    ...(entry.resolutionTrace ? [entry.resolutionTrace.roll] : []),
    ...(entry.mortalityTrace ?? []).flatMap(event => typeof event.roll === 'number' ? [event.roll] : []),
    ...composureRollsOf(entry).flatMap(bearer => bearer.rolls.map(roll => roll.roll)),
  ];
}

/** What runNewTurn was handed as `options.turnSeed`, call by call. */
function turnSeedsPassed(): Array<number | undefined> {
  return runNewTurnSpy.mock.calls.map(call => call[14]?.turnSeed);
}

/** The record the `index`th runNewTurn call produced - kept even when the App then failed and discarded it. */
async function attemptRecord(index: number): Promise<TurnHistoryEntry> {
  const settled = runNewTurnSpy.mock.results[index];
  expect(settled?.type, `runNewTurn call #${index}`).toBe('return');
  return (await (settled!.value as Promise<RunNewTurnResult>)).newHistoryEntry;
}

/**
 * Turn 1's provider script: a consequential action, a validated claim on
 * the Emperor's life, and a burn Julia takes in the audience hall (which
 * makes her one of the figures truly present, D50). With `failAtTheEnd`,
 * the last call of the turn - after the narration - fails.
 */
function turnOneClient(runner: JourneyRunner, label: string, failAtTheEnd: boolean): ScriptedClient {
  const burn: EventDelta = {
    type: 'condition', key: `${JULIA}:burned_hand`, delta: 0, reason: 'A brazier overturned in the audience hall.',
    condition: { change: 'add', name: 'a burned hand', description: 'Bandaged from wrist to knuckle.', outward: true, severity: 'light' },
  };
  return new ScriptedClient({
    storyRelevance: scriptStoryRelevance(),
    assessment: scriptAssessmentConsequential({ category: 'court politics', skill: 'oratory', difficulty: 12 }),
    adjudication: scriptAdjudication(1, {
      deltas: [statusDelta(PLAYER_ID, 'dead', 'A blade is drawn among the petitioners.'), burn],
      headlines: ['A blade flashes in the imperial audience hall.'],
    }),
    mortalityValidation: scriptMortalityValidation([
      { entity_id: PLAYER_ID, valid: true, reasoning: 'A genuine attempt on the Emperor\'s life this turn.' },
    ]),
    simulationState: scriptSimulationState(runner.thread.simulationState),
    monologue: scriptMonologue('I will not flinch before them.'),
    narration: scriptNarration('A blade flashes among the petitioners; a brazier goes over, and Julia Mamaea binds her hand.', [
      'Question the Guard', 'Summon the physician', 'Keep your mother close',
    ]),
    relationshipObservations: failAtTheEnd
      ? scriptedFailure(new Error('deliberate relationship provider failure'))
      : scriptedJsonArray([]),
  }, label);
}

/** Turn 2: nothing at stake and nobody at hand - no dice, but the turn still has its seed. */
function quietClient(runner: JourneyRunner, turn: number, label: string): ScriptedClient {
  return new ScriptedClient({
    storyRelevance: scriptStoryRelevance(),
    assessment: scriptAssessmentIdle(),
    adjudication: scriptAdjudication(turn),
    simulationState: scriptSimulationState(runner.thread.simulationState),
    monologue: scriptMonologue('The dispatches say little.'),
    narration: scriptNarration('The dispatches are read by lamplight.', ['Rest', 'Write to the Senate', 'Walk the gardens']),
    relationshipObservations: scriptedJsonArray([]),
  }, label);
}

async function send(app: MountedJourneyApp, text: string): Promise<void> {
  await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), text);
  await appClick(appButton(app.container, 'Speak'));
}

/** Plays turn 1 to its failure after the narration, and returns the discarded attempt's record. */
async function failTurnOne(runner: JourneyRunner, app: MountedJourneyApp): Promise<TurnHistoryEntry> {
  const failing = turnOneClient(runner, 'retryDice/failure', true);
  installAppGeminiScript(failing);
  const expectedConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
  await send(app, INTENT);
  await waitForApp(() => expect(app.container.textContent).toMatch(/your draft is kept/i));
  expectedConsole.mockRestore();
  // The narration was written before the failure - in play, the player
  // may already have read the outcome as it streamed.
  expect(failing.calls.map(call => call.kind)).toContain('narration');
  expect(failing.calls.at(-1)?.kind).toBe('relationshipObservations');
  expect(loadThreadState().turnNumber).toBe(1);
  expect(loadThreadState().turnHistory).toHaveLength(0);
  return attemptRecord(runNewTurnSpy.mock.calls.length - 1);
}

/** The failed attempt and the committed turn drew the same dice from the same seed. */
function expectSameDice(committed: TurnHistoryEntry, failed: TurnHistoryEntry, turnSeed: number): void {
  expect(failed.turnSeed).toBe(turnSeed);
  expect(committed.turnSeed).toBe(turnSeed);
  expect(drawsOf(failed)).toEqual(TURN_ONE_ROLLS);
  expect(drawsOf(committed)).toEqual(TURN_ONE_ROLLS);
  expect(committed.resolutionTrace).toMatchObject({ roll: failed.resolutionTrace!.roll, tier: failed.resolutionTrace!.tier });
  expect(committed.mortalityTrace?.map(event => [event.entity_id, event.roll, event.band]))
    .toEqual(failed.mortalityTrace?.map(event => [event.entity_id, event.roll, event.band]));
  expect(committed.mortalityTrace?.[0]).toMatchObject({ entity_id: PLAYER_ID, valid: true, band: 'survive', roll: 14 });
  expect(composureRollsOf(committed)).toEqual(composureRollsOf(failed));
  expect(composureRollsOf(committed)).toEqual([expect.objectContaining({
    entityId: JULIA,
    rolls: [expect.objectContaining({ subjectKind: 'tie', subjectId: 'circle_of_origen', roll: 9 })],
  })]);
  // The recorded seed keeps its meaning: "Strike the mould again" re-draws
  // the committed turn's dice from it, draw for draw.
  const replay = replayTurnDraws(committed);
  expect(replay.verifiable).toBe(true);
  expect(replay.allMatch).toBe(true);
  expect(replay.draws.map(draw => draw.redrawn)).toEqual(TURN_ONE_ROLLS);
}

describe('journey: a retried turn keeps its dice (D51)', () => {
  const REIGN = findReignSeedForRolls(1, TURN_ONE_ROLLS);
  const TURN_ONE_SEED = deriveTurnSeed(REIGN, 1);

  it('replays the same action, mortality and composure draws on Retry, and gives the next turn its own seed', async () => {
    const runner = new JourneyRunner({ name: 'retryDice/retry' });
    installAppGeminiScript(turnOneClient(runner, 'retryDice/boot', false));
    const app = await mountJourneyApp({ ...buildSaveStateFromThread(runner.thread), reignSeed: REIGN });
    try {
      expect(loadThreadState().reignSeed).toBe(REIGN);
      const failed = await failTurnOne(runner, app);

      installAppGeminiScript(turnOneClient(runner, 'retryDice/retry', false));
      await appClick(appButton(app.container, 'Retry the last action'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));

      const committed = loadThreadState().turnHistory.at(-1)!;
      expect(committed.playerIntent).toBe(INTENT);
      expectSameDice(committed, failed, TURN_ONE_SEED);
      expect(turnSeedsPassed()).toEqual([TURN_ONE_SEED, TURN_ONE_SEED]);

      // The next turn of the reign is another turn: its own seed, unrelated.
      installAppGeminiScript(quietClient(runner, 2, 'retryDice/turn-2'));
      await send(app, 'Read the dispatches alone.');
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(3));
      const next = loadThreadState().turnHistory.at(-1)!;
      expect(next.turnSeed).toBe(deriveTurnSeed(REIGN, 2));
      expect(next.turnSeed).not.toBe(TURN_ONE_SEED);
      expect(turnSeedsPassed().at(-1)).toBe(deriveTurnSeed(REIGN, 2));
      expect(loadThreadState().reignSeed).toBe(REIGN);
    } finally {
      await app.unmount();
    }
  });

  it('draws the same dice when the action is rewritten before it is sent again', async () => {
    const runner = new JourneyRunner({ name: 'retryDice/rewritten' });
    installAppGeminiScript(turnOneClient(runner, 'retryDice/boot', false));
    const app = await mountJourneyApp({ ...buildSaveStateFromThread(runner.thread), reignSeed: REIGN });
    try {
      const failed = await failTurnOne(runner, app);
      expect(appControl<HTMLTextAreaElement>(app.container, 'Chat input').value).toBe(INTENT);

      installAppGeminiScript(turnOneClient(runner, 'retryDice/rewritten', false));
      await send(app, REWRITTEN_INTENT);
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));

      const committed = loadThreadState().turnHistory.at(-1)!;
      expect(committed.playerIntent).toBe(REWRITTEN_INTENT);
      expectSameDice(committed, failed, TURN_ONE_SEED);
      expect(turnSeedsPassed()).toEqual([TURN_ONE_SEED, TURN_ONE_SEED]);
    } finally {
      await app.unmount();
    }
  });

  it('draws the same dice after a reload before commit, and again from a restored earlier copy of the reign', async () => {
    const runner = new JourneyRunner({ name: 'retryDice/reload' });
    installAppGeminiScript(turnOneClient(runner, 'retryDice/boot', false));
    const app = await mountJourneyApp({ ...buildSaveStateFromThread(runner.thread), reignSeed: REIGN });
    // "Take a copy of the reign" before turn 1 is played.
    const earlierCopy = rawSaveBlob()!;
    let reloaded: MountedJourneyApp | null = null;
    let restored: MountedJourneyApp | null = null;
    try {
      const failed = await failTurnOne(runner, app);

      // The page is reloaded before the turn ever committed: the reign comes
      // back from the autosave, seed and all, and the turn is written anew.
      await app.unmount();
      installAppGeminiScript(turnOneClient(runner, 'retryDice/after-reload', false));
      reloaded = await mountJourneyAppFromAutosave();
      expect(loadThreadState().reignSeed).toBe(REIGN);
      await send(reloaded, INTENT);
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      expectSameDice(loadThreadState().turnHistory.at(-1)!, failed, TURN_ONE_SEED);
      await reloaded.unmount();
      reloaded = null;

      // The earlier copy is restored over the committed turn (a save
      // round-trip through the file route): turn 1 is to play again, and it
      // is the same turn of the same reign - same seed, same dice.
      expect(importSaveBlob(earlierCopy)).toMatchObject({ ok: true, turnNumber: 1 });
      expect(localStorage.getItem(SAVE_KEY)).toBe(earlierCopy);
      installAppGeminiScript(turnOneClient(runner, 'retryDice/restored-copy', false));
      restored = await mountJourneyAppFromAutosave();
      expect(loadThreadState().turnNumber).toBe(1);
      expect(loadThreadState().reignSeed).toBe(REIGN);
      await send(restored, REWRITTEN_INTENT);
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      expectSameDice(loadThreadState().turnHistory.at(-1)!, failed, TURN_ONE_SEED);
      expect(turnSeedsPassed()).toEqual([TURN_ONE_SEED, TURN_ONE_SEED, TURN_ONE_SEED]);
    } finally {
      if (document.body.contains(app.container)) await app.unmount();
      if (reloaded) await reloaded.unmount();
      if (restored) await restored.unmount();
    }
  });

  it('gives a reign saved before D51 a seed as it loads, stores it at once, and derives its turns from it', async () => {
    const runner = new JourneyRunner({ name: 'retryDice/legacy' });
    const legacy = buildSaveStateFromThread(runner.thread);
    expect(legacy).not.toHaveProperty('reignSeed');
    installAppGeminiScript(quietClient(runner, 1, 'retryDice/legacy'));
    const app = await mountJourneyApp(legacy);
    try {
      // Continue read the reign and stored the seed it was given before any
      // turn was played - so a reload now would find the same one.
      const stored = JSON.parse(localStorage.getItem(SAVE_KEY)!) as { state: { reignSeed?: unknown; turnNumber: number } };
      expect(isValidReignSeed(stored.state.reignSeed)).toBe(true);
      expect(stored.state.turnNumber).toBe(1);
      const assigned = stored.state.reignSeed as number;

      await send(app, 'Read the dispatches alone.');
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      expect(turnSeedsPassed()).toEqual([deriveTurnSeed(assigned, 1)]);
      expect(loadThreadState().turnHistory.at(-1)!.turnSeed).toBe(deriveTurnSeed(assigned, 1));
      expect(loadThreadState().reignSeed).toBe(assigned);
    } finally {
      await app.unmount();
    }
  });
});
