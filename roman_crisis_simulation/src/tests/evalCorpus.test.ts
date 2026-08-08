import { describe, it, expect } from 'vitest';
import { buildEvalCorpus, evalCorpusFilename } from '../persistence/evalCorpus';
import { SAVE_VERSION } from '../persistence/saveGame';
import type { KnowledgeClaim } from '../knowledge/store';
import type {
  MortalityEvent,
  RawCallRecord,
  TruthLedgerEntry,
  TurnHistoryEntry,
} from '../types';
import {
  makeRawCall as baseMakeRawCall,
  makeResolutionTrace,
  makeMortalityEvent,
  makeTurnHistoryEntry,
  makeAdjudication,
  makeNpcIntent,
} from './factories';

function makeRawCall(callName: string, withPromptText = true): RawCallRecord {
  return baseMakeRawCall({
    callName,
    latencyMs: 120,
    promptChars: 900,
    rawResponse: `{"result":"response for ${callName}"}`,
    ...(withPromptText
      ? {
          promptText: `full prompt for ${callName}`,
          systemInstruction: `system instruction for ${callName}`,
        }
      : {}),
  });
}

function makeMortalityTrace(): MortalityEvent[] {
  return [makeMortalityEvent()];
}

/** An entry with every optional field populated. */
function makeFullEntry(turnNumber: number): TurnHistoryEntry {
  return makeTurnHistoryEntry({
    turnNumber,
    playerIntent: `do thing ${turnNumber}`,
    adjudication: makeAdjudication({
      turn: turnNumber,
      headlines: [`Headline ${turnNumber}`],
      gm_private: [`Private note ${turnNumber}`],
    }),
    narration: `Narration for turn ${turnNumber}`,
    postTurnEntities: [],
    rawCalls: [makeRawCall('adjudication'), makeRawCall('narration')],
    mortalityTrace: makeMortalityTrace(),
    resolutionTrace: makeResolutionTrace(),
    turnSeed: 987654321,
    npcIntents: [makeNpcIntent()],
    npcMindResults: [{
      entity_id: 'maximinus_thrax',
      chosen_action: 'Rally the Danube veterans to my standard.',
      method: 'Camp fires, oaths, and donatives.',
      private_reasoning: 'The purple is within reach.',
      scheme_adjustment: null,
    }],
  });
}

/** The shape entries persisted before the optional capture fields existed have. */
function makeLegacyEntry(turnNumber: number): TurnHistoryEntry {
  return makeTurnHistoryEntry({
    turnNumber,
    playerIntent: `old thing ${turnNumber}`,
    adjudication: makeAdjudication({ turn: turnNumber }),
    postTurnEntities: [],
  });
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

  it('excludes postTurnEntities from every corpus turn, even when the history entry carries one', () => {
    const entry = makeFullEntry(1);
    expect(entry.postTurnEntities).toBeDefined();

    const corpus = buildEvalCorpus([entry, makeLegacyEntry(2)], [], META);

    // Promised by persistence/evalCorpus.ts: full entity snapshots would
    // dwarf the prompt/response data the corpus exists to carry.
    expect('postTurnEntities' in corpus.turns[0]).toBe(false);
    expect('postTurnEntities' in corpus.turns[1]).toBe(false);
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

  it('carries the Director intents and NPC mind decisions (GM-side, private_reasoning included) so the judge can score axes 4 and 5', () => {
    const corpus = buildEvalCorpus([makeFullEntry(4)], [], META);

    const turn = corpus.turns[0];
    expect(turn.npcIntents).toEqual([{ entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions', continuity: 'new' }]);
    expect(turn.npcMindResults).toHaveLength(1);
    // The corpus is a GM-console-only export (D18), so the mind's first-person
    // reasoning rides along - it is exactly what the character-richness axis
    // scores against and it never reaches a player-facing surface.
    expect(turn.npcMindResults?.[0].private_reasoning).toBe('The purple is within reach.');
  });

  it('normalizes legacy entries that lack the optional fields', () => {
    const corpus = buildEvalCorpus([makeLegacyEntry(1)], [], META);

    const turn = corpus.turns[0];
    expect(turn.narration).toBeNull();
    expect(turn.rawCalls).toEqual([]);
    expect(turn.turnSeed).toBeNull();
    expect(turn.resolutionTrace).toBeNull();
    expect(turn.mortalityTrace).toBeNull();
    expect(turn.npcIntents).toBeNull();
    expect(turn.npcMindResults).toBeNull();
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

  describe('campaign slices (truth ledger / knowledge, GM-side)', () => {
    const truthLedger: TruthLedgerEntry[] = [
      { id: 'truth_2_1', turn: 2, claim: 'The Emperor bargains with the Germans', aboutId: 'severus_alexander', isTrue: false, originId: 'maximinus_thrax', reportId: 'report_2_1' },
      { id: 'truth_3_1', turn: 3, claim: 'Grain stores run low', aboutId: 'The Suburra', isTrue: true, assumed: true, reportId: 'report_3_1' },
    ];
    const knowledge: KnowledgeClaim[] = [
      {
        id: 'claim_2_report:severus_alexander:rumor',
        subject: 'severus_alexander',
        claim: 'The Emperor bargains with the Germans',
        claimKey: 'report:severus_alexander:rumor',
        firstLearnedTurn: 2,
        updates: [{ turn: 2, source: 'rumor', text: 'The Emperor bargains with the Germans', credibility: 0.6 }],
      },
    ];

    it('carries both slices as top-level fields, as copies, so the judge can score campaign-wide true-vs-believed and assumed-rate', () => {
      const corpus = buildEvalCorpus([makeFullEntry(1)], [], META, { truthLedger, knowledge });

      expect(corpus.truthLedger).toEqual(truthLedger);
      expect(corpus.truthLedger).not.toBe(truthLedger);
      expect(corpus.knowledge).toEqual(knowledge);
      expect(corpus.knowledge).not.toBe(knowledge);
      // The assumed flag - the judge's assumed-rate input - passes through.
      expect(corpus.truthLedger![1].assumed).toBe(true);
    });

    it('omits absent slices entirely (legacy exports keep their exact prior shape)', () => {
      const withoutSlices = buildEvalCorpus([makeFullEntry(1)], [], META);
      expect(Object.keys(withoutSlices).sort()).toEqual(['meta', 'sessionCallLog', 'turns']);
      expect('truthLedger' in withoutSlices).toBe(false);
      expect('knowledge' in withoutSlices).toBe(false);

      // One slice provided, the other absent - only the provided one lands.
      const partial = buildEvalCorpus([makeFullEntry(1)], [], META, { truthLedger });
      expect(partial.truthLedger).toEqual(truthLedger);
      expect('knowledge' in partial).toBe(false);
    });

    it('survives a JSON round-trip unchanged with slices attached', () => {
      const corpus = buildEvalCorpus([makeFullEntry(1)], [makeRawCall('epilogue')], META, { truthLedger, knowledge });
      expect(JSON.parse(JSON.stringify(corpus))).toEqual(corpus);
    });
  });
});

describe('persistence/evalCorpus evalCorpusFilename', () => {
  it('names the download after the current turn', () => {
    expect(evalCorpusFilename(12)).toBe('gor-eval-corpus-turn12.json');
  });
});
