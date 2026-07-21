import { describe, it, expect } from 'vitest';
import { buildEvalCorpus, evalCorpusFilename } from '../persistence/evalCorpus';
import { SAVE_VERSION } from '../persistence/saveGame';
import type {
  ActionResolutionEvent,
  MortalityEvent,
  RawCallRecord,
  TurnHistoryEntry,
} from '../types';

function makeRawCall(callName: string, withPromptText = true): RawCallRecord {
  return {
    callName,
    model: 'gemini-3-pro-preview',
    latencyMs: 120,
    attempts: 1,
    promptChars: 900,
    rawResponse: `{"result":"response for ${callName}"}`,
    validated: true,
    ...(withPromptText
      ? {
          promptText: `full prompt for ${callName}`,
          systemInstruction: `system instruction for ${callName}`,
        }
      : {}),
  };
}

function makeResolutionTrace(): ActionResolutionEvent {
  return {
    assessment: {
      is_consequential: true,
      action_category: 'political maneuvering',
      relevant_skill: 'intrigue',
      difficulty: 14,
      opposing_entity_id: 'maximinus_thrax',
      rationale: 'A direct move against a rival.',
    },
    roll: 11,
    total: 17,
    margin: 3,
    tier: 'success',
  };
}

function makeMortalityTrace(): MortalityEvent[] {
  return [
    {
      entity_id: 'gaius_pontius_magnus',
      entity_name: 'Gaius Pontius Magnus',
      claim: 'Poisoned at a banquet.',
      valid: true,
      roll: 4,
      band: 'dies',
      outcomeSummary: 'The poison takes him before dawn.',
    },
  ];
}

/** An entry with every optional field populated. */
function makeFullEntry(turnNumber: number): TurnHistoryEntry {
  return {
    turnNumber,
    playerIntent: `do thing ${turnNumber}`,
    adjudication: {
      turn: turnNumber,
      entityActions: [],
      deltas: [],
      headlines: [`Headline ${turnNumber}`],
      gm_private: [`Private note ${turnNumber}`],
    },
    narration: `Narration for turn ${turnNumber}`,
    postTurnEntities: [],
    rawCalls: [makeRawCall('adjudication'), makeRawCall('narration')],
    mortalityTrace: makeMortalityTrace(),
    resolutionTrace: makeResolutionTrace(),
    turnSeed: 987654321,
  };
}

/** The shape entries persisted before the optional capture fields existed have. */
function makeLegacyEntry(turnNumber: number): TurnHistoryEntry {
  return {
    turnNumber,
    playerIntent: `old thing ${turnNumber}`,
    adjudication: {
      turn: turnNumber,
      entityActions: [],
      deltas: [],
      headlines: [],
      gm_private: [],
    },
    postTurnEntities: [],
  };
}

const META = { saveVersion: SAVE_VERSION, turnNumber: 5, playerCharacterId: 'severus_alexander' };

describe('persistence/evalCorpus buildEvalCorpus', () => {
  it('produces one corpus turn per history entry, in order, with the top-level sections', () => {
    const corpus = buildEvalCorpus([makeFullEntry(1), makeLegacyEntry(2)], [makeRawCall('epilogue')], META);

    expect(Object.keys(corpus).sort()).toEqual(['meta', 'sessionCallLog', 'turns']);
    expect(corpus.turns).toHaveLength(2);
    expect(corpus.turns.map(t => t.turnNumber)).toEqual([1, 2]);
    expect(corpus.turns[0].playerIntent).toBe('do thing 1');
    expect(corpus.turns[0].narration).toBe('Narration for turn 1');
    expect(corpus.turns[0].adjudication.headlines).toEqual(['Headline 1']);
    expect(corpus.turns[0].adjudication.gm_private).toEqual(['Private note 1']);
  });

  it('carries prompt text and system instruction on raw calls when they were recorded', () => {
    const corpus = buildEvalCorpus([makeFullEntry(1)], [], META);

    const calls = corpus.turns[0].rawCalls;
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.callName)).toEqual(['adjudication', 'narration']);
    expect(calls[0].promptText).toBe('full prompt for adjudication');
    expect(calls[0].systemInstruction).toBe('system instruction for adjudication');
    expect(calls[0].rawResponse).toBe('{"result":"response for adjudication"}');
  });

  it('carries the turn seed and the resolution/mortality traces', () => {
    const corpus = buildEvalCorpus([makeFullEntry(3)], [], META);

    const turn = corpus.turns[0];
    expect(turn.turnSeed).toBe(987654321);
    expect(turn.resolutionTrace).toEqual(makeResolutionTrace());
    expect(turn.mortalityTrace).toEqual(makeMortalityTrace());
  });

  it('normalizes legacy entries that lack the optional fields', () => {
    const corpus = buildEvalCorpus([makeLegacyEntry(1)], [], META);

    const turn = corpus.turns[0];
    expect(turn.narration).toBeNull();
    expect(turn.rawCalls).toEqual([]);
    expect(turn.turnSeed).toBeNull();
    expect(turn.resolutionTrace).toBeNull();
    expect(turn.mortalityTrace).toBeNull();
    // Raw calls without captured prompt text pass through untouched too.
    const noText = buildEvalCorpus(
      [{ ...makeLegacyEntry(2), rawCalls: [makeRawCall('adjudication', false)] }],
      [],
      META,
    );
    expect(noText.turns[0].rawCalls[0].promptText).toBeUndefined();
    expect(noText.turns[0].rawCalls[0].systemInstruction).toBeUndefined();
  });

  it('includes the out-of-band session call log as its own section, as a copy', () => {
    const sessionLog = [makeRawCall('investigation'), makeRawCall('ambition_inference')];
    const corpus = buildEvalCorpus([], sessionLog, META);

    expect(corpus.sessionCallLog.map(c => c.callName)).toEqual(['investigation', 'ambition_inference']);
    expect(corpus.sessionCallLog).not.toBe(sessionLog);
    expect(corpus.turns).toEqual([]);
  });

  it('stamps the metadata verbatim, including a null player character', () => {
    const corpus = buildEvalCorpus([], [], META);
    expect(corpus.meta).toEqual({
      saveVersion: SAVE_VERSION,
      turnNumber: 5,
      playerCharacterId: 'severus_alexander',
    });

    const noPlayer = buildEvalCorpus([], [], { ...META, playerCharacterId: null });
    expect(noPlayer.meta.playerCharacterId).toBeNull();
  });

  it('survives a JSON round-trip unchanged', () => {
    const corpus = buildEvalCorpus([makeFullEntry(1), makeLegacyEntry(2)], [makeRawCall('epilogue')], META);
    expect(JSON.parse(JSON.stringify(corpus))).toEqual(corpus);
  });
});

describe('persistence/evalCorpus evalCorpusFilename', () => {
  it('names the download after the current turn', () => {
    expect(evalCorpusFilename(12)).toBe('gor-eval-corpus-turn12.json');
  });
});
