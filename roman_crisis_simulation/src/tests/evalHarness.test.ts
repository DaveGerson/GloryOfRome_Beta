import { describe, it, expect, vi } from 'vitest';
import { buildEvalCorpus } from '../persistence/evalCorpus';
import { SAVE_VERSION } from '../persistence/saveGame';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import {
  checkRawCallSchema,
  schemaForCallName,
  measureTurnDensity,
  measureTurnCompleteness,
  replayTurnRolls,
  evaluateTurn,
  evaluateCorpus,
  assertEvalCorpusShape,
  formatCorpusReport,
  STRUCTURED_CALL_SCHEMAS,
  PROSE_CALL_NAMES,
} from '../eval/harness';
import { judgeTurn, formatJudgeVerdict, EvalJudgeVerdict } from '../eval/judge';
import { buildEvalJudgePrompt } from '../ai/prompts/evalJudge';
import { zEvalJudgeVerdict } from '../ai/core/zodSchemas';
import { GeminiClient } from '../ai/core/geminiService';
import { getMockInitialState } from './mockData';
import type {
  Adjudication,
  ActionResolutionEvent,
  MortalityEvent,
  RawCallRecord,
  TurnHistoryEntry,
} from '../types';

// --- Fixtures (mockData shapes) -------------------------------------------

const { entities: MOCK_ENTITIES } = getMockInitialState();
const PLAYER_ID = 'severus_alexander';
const META = { saveVersion: SAVE_VERSION, turnNumber: 3, playerCharacterId: PLAYER_ID };

function makeAdjudication(turn: number): Adjudication {
  return {
    turn,
    entityActions: [{ id: 'maximinus_thrax', intent: 'recruit', notes: 'Raising fresh cohorts on the Danube.' }],
    deltas: [
      { type: 'resource', key: `${PLAYER_ID}:denarii`, delta: -5000, reason: 'Donative to the Praetorians.' },
      { type: 'relation', key: `maximinus_thrax:${PLAYER_ID}:trust_level`, delta: -2, reason: 'The donative reads as fear.' },
    ],
    headlines: ['The Emperor opens the treasury to the Guard.'],
    gm_private: ['Thrax interprets the donative as weakness.'],
  };
}

function makeRawCall(callName: string, rawResponse: string, overrides: Partial<RawCallRecord> = {}): RawCallRecord {
  return {
    callName,
    model: 'test-model',
    latencyMs: 100,
    attempts: 1,
    promptChars: 500,
    promptText: `prompt for ${callName}`,
    systemInstruction: `system for ${callName}`,
    rawResponse,
    validated: true,
    ...overrides,
  };
}

const VALID_ADJUDICATION_JSON = JSON.stringify(makeAdjudication(3));
// Deliberately schema-invalid: headlines must be an array of strings.
const INVALID_ADJUDICATION_JSON = JSON.stringify({ ...makeAdjudication(3), headlines: 'not an array' });

function makeEntry(turnNumber: number, overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return {
    turnNumber,
    playerIntent: `intent ${turnNumber}`,
    adjudication: makeAdjudication(turnNumber),
    narration: `Narration for turn ${turnNumber}`,
    rawCalls: [makeRawCall('adjudication', VALID_ADJUDICATION_JSON)],
    turnSeed: 42,
    ...overrides,
  };
}

function makeResolutionTrace(roll: number): ActionResolutionEvent {
  return {
    assessment: {
      is_consequential: true,
      action_category: 'oratory persuasion',
      relevant_skill: 'oratory',
      difficulty: 12,
      opposing_entity_id: 'gaius_pontius_magnus',
      rationale: 'Swaying a senator carries real opposition.',
    },
    roll,
    total: roll + 3,
    margin: roll + 3 - 12,
    tier: 'partial_success',
  };
}

function makeMortalityEvent(entityId: string, roll: number | undefined, valid: boolean): MortalityEvent {
  const entity = MOCK_ENTITIES.find(e => e.entity_id === entityId)!;
  return {
    entity_id: entity.entity_id,
    entity_name: entity.name,
    claim: 'Cut down in the forum.',
    valid,
    ...(roll !== undefined ? { roll, band: 'confirmed_dead' } : {}),
    outcomeSummary: valid ? 'The blade finds its mark.' : 'Death claim invalidated.',
  };
}

// --- Schema validity -------------------------------------------------------

describe('eval/harness checkRawCallSchema', () => {
  it('validates a well-formed structured response against its mapped schema', () => {
    const check = checkRawCallSchema(makeRawCall('adjudication', VALID_ADJUDICATION_JSON));
    expect(check.status).toBe('valid');
    expect(check.detail).toBeNull();
  });

  it('accepts a fenced JSON response (same cleaning as the live service)', () => {
    const check = checkRawCallSchema(makeRawCall('adjudication', '```json\n' + VALID_ADJUDICATION_JSON + '\n```'));
    expect(check.status).toBe('valid');
  });

  it('reports a schema violation with the offending paths', () => {
    const check = checkRawCallSchema(makeRawCall('adjudication', INVALID_ADJUDICATION_JSON));
    expect(check.status).toBe('schema_violation');
    expect(check.detail).toContain('headlines');
  });

  it('reports unparseable JSON', () => {
    const check = checkRawCallSchema(makeRawCall('adjudication', 'not json at all'));
    expect(check.status).toBe('unparseable_json');
    expect(check.detail).toBeTruthy();
  });

  it('skips prose call families', () => {
    const check = checkRawCallSchema(makeRawCall('narration', 'The forum seethes with rumor.'));
    expect(check.status).toBe('skipped_prose');
  });

  it('skips unknown call names instead of failing them', () => {
    const check = checkRawCallSchema(makeRawCall('someFutureCall', '{"anything": true}'));
    expect(check.status).toBe('skipped_unknown');
  });

  it('maps suffixed entityBatch call names to the entity batch schema', () => {
    expect(schemaForCallName('entityBatch:NPCs_1')).not.toBeNull();
    const check = checkRawCallSchema(
      makeRawCall('entityBatch:NPCs_1', JSON.stringify({ entities: [MOCK_ENTITIES[1]] }))
    );
    expect(check.status).toBe('valid');
  });

  it('maps suffixed npcMind call names (4C.4) to the mind decision schema', () => {
    expect(schemaForCallName('npcMind:maximinus_thrax')).not.toBeNull();
    const check = checkRawCallSchema(
      makeRawCall('npcMind:maximinus_thrax', JSON.stringify({
        entity_id: 'maximinus_thrax',
        chosen_action: 'March south.',
        method: 'By night.',
        private_reasoning: 'The purple calls.',
      }))
    );
    expect(check.status).toBe('valid');
    // A decision missing a required field is a schema violation, not skipped.
    const broken = checkRawCallSchema(
      makeRawCall('npcMind:maximinus_thrax', JSON.stringify({ entity_id: 'maximinus_thrax' }))
    );
    expect(broken.status).toBe('schema_violation');
  });

  it('maps relationshipObservations to its strict selector schema', () => {
    expect(schemaForCallName('relationshipObservations')).not.toBeNull();
    const valid = checkRawCallSchema(
      makeRawCall('relationshipObservations', JSON.stringify([{
        evidenceId: 'report_7_1',
        participantIds: ['severus_alexander', 'lucius'],
        excerpt: 'Senator Lucius defended Severus before the Curia.',
      }]))
    );
    expect(valid.status).toBe('valid');

    const modelAuthoredQuote = checkRawCallSchema(
      makeRawCall('relationshipObservations', JSON.stringify([{
        evidenceId: 'report_7_1',
        participantIds: ['severus_alexander', 'lucius'],
        excerpt: 'Senator Lucius defended Severus before the Curia.',
        quote: { speakerId: 'lucius', text: 'A fabricated quote.' },
      }]))
    );
    expect(modelAuthoredQuote.status).toBe('schema_violation');
  });
});

// --- Call-name inventory drift ---------------------------------------------

describe('eval/harness call-name inventory (drift guard)', () => {
  // The EXACT callName values production code passes to geminiService. If a
  // rename in one of the files below trips this test, update BOTH that file
  // and STRUCTURED_CALL_SCHEMAS / PROSE_CALL_NAMES in eval/harness.ts - at
  // runtime an unmapped name only downgrades that call's checks to
  // 'skipped_unknown', so nothing else would catch the drift.
  const EMITTED_STRUCTURED_CALL_NAMES = [
    'adjudication', // ai/core/turn.ts
    'assessment', // ai/tools/assessment.ts
    'storyRelevance', // ai/tools/intelligence.ts
    'updatedSimulationState', // ai/tools/intelligence.ts
    'relationshipUpdates', // ai/tools/intelligence.ts
    'privateConversation', // ai/tools/intelligence.ts
    'investigation', // ai/tools/intelligence.ts
    'mortalityValidation', // ai/core/mortality.ts
    'mortalityOutcome', // ai/core/mortality.ts
    'scenarioStructure', // ai/core/initiator.ts
    'characterCreation', // ai/tools/characterCreator.ts
    'ambitionInference', // ai/tools/ambition.ts
    'relationshipObservations', // ai/tools/relationshipObservations.ts
    // 'entityBatch:<batchName>' (ai/core/initiator.ts) and
    // 'npcMind:<entity_id>' (ai/tools/npcMind.ts) are deliberately not
    // listed: their callNames are suffixed at runtime and resolved by
    // schemaForCallName's prefix rules, covered by their own tests above.
  ];
  const EMITTED_PROSE_CALL_NAMES = [
    'narration', // ai/core/turn.ts
    'playerMonologue', // ai/tools/intelligence.ts
    'clarification', // ai/tools/intelligence.ts
    'rawThoughts', // ai/tools/intelligence.ts
    'deepAnalysis', // ai/tools/intelligence.ts
    'epilogue', // components/EpilogueScreen.tsx
  ];

  it('STRUCTURED_CALL_SCHEMAS keys exactly equal the structured call names the app emits', () => {
    expect(Object.keys(STRUCTURED_CALL_SCHEMAS).sort()).toEqual([...EMITTED_STRUCTURED_CALL_NAMES].sort());
  });

  it('PROSE_CALL_NAMES exactly equals the prose call names the app emits', () => {
    expect([...PROSE_CALL_NAMES].sort()).toEqual([...EMITTED_PROSE_CALL_NAMES].sort());
  });

  it('no call name is claimed as both structured and prose', () => {
    for (const name of Object.keys(STRUCTURED_CALL_SCHEMAS)) {
      expect(PROSE_CALL_NAMES.has(name)).toBe(false);
    }
  });

  it('every emitted structured name resolves to a schema (none silently skipped_unknown)', () => {
    for (const name of EMITTED_STRUCTURED_CALL_NAMES) {
      expect(schemaForCallName(name), name).not.toBeNull();
    }
  });
});

// --- Density and completeness ---------------------------------------------

describe('eval/harness density and completeness', () => {
  it('counts deltas and headlines per turn', () => {
    const corpus = buildEvalCorpus([makeEntry(3)], [], META);
    expect(measureTurnDensity(corpus.turns[0])).toEqual({ deltaCount: 2, headlineCount: 1 });
  });

  it('flags full capture: prompt text on every call, seed present', () => {
    const corpus = buildEvalCorpus([makeEntry(3)], [], META);
    expect(measureTurnCompleteness(corpus.turns[0])).toEqual({
      rawCallCount: 1,
      callsWithPromptText: 1,
      callsWithSystemInstruction: 1,
      turnSeedPresent: true,
    });
  });

  it('flags capture gaps: a call without prompt text, a legacy entry without seed or calls', () => {
    const gappyCall = makeRawCall('adjudication', VALID_ADJUDICATION_JSON, {
      promptText: undefined,
      systemInstruction: undefined,
    });
    const corpus = buildEvalCorpus(
      [
        makeEntry(3, { rawCalls: [makeRawCall('narration', 'Prose.'), gappyCall] }),
        makeEntry(4, { rawCalls: undefined, turnSeed: undefined }),
      ],
      [],
      META
    );
    expect(measureTurnCompleteness(corpus.turns[0])).toEqual({
      rawCallCount: 2,
      callsWithPromptText: 1,
      callsWithSystemInstruction: 1,
      turnSeedPresent: true,
    });
    expect(measureTurnCompleteness(corpus.turns[1])).toEqual({
      rawCallCount: 0,
      callsWithPromptText: 0,
      callsWithSystemInstruction: 0,
      turnSeedPresent: false,
    });
  });
});

// --- Roll reproducibility --------------------------------------------------

describe('eval/harness replayTurnRolls', () => {
  const SEED = 987654321;

  /** Draws the first n rolls the per-turn generator would produce for SEED. */
  function expectedRolls(n: number): number[] {
    const rng = createSeededRng(SEED);
    return Array.from({ length: n }, () => rollD20(rng));
  }

  it('matches when recorded rolls replay from the seed in draw order (action first, then mortality)', () => {
    const [actionRoll, mortalityRoll] = expectedRolls(2);
    const corpus = buildEvalCorpus(
      [
        makeEntry(3, {
          turnSeed: SEED,
          resolutionTrace: makeResolutionTrace(actionRoll),
          mortalityTrace: [makeMortalityEvent('gaius_pontius_magnus', mortalityRoll, true)],
        }),
      ],
      [],
      META
    );
    const replay = replayTurnRolls(corpus.turns[0]);
    expect(replay.status).toBe('match');
    expect(replay.rolls).toHaveLength(2);
    expect(replay.rolls[0]).toMatchObject({ source: 'action', recorded: actionRoll, match: true });
    expect(replay.rolls[1]).toMatchObject({
      source: 'mortality',
      entityId: 'gaius_pontius_magnus',
      recorded: mortalityRoll,
      match: true,
    });
  });

  it('reports a mismatch and pinpoints the offending draw', () => {
    const [actionRoll, mortalityRoll] = expectedRolls(2);
    const wrongRoll = mortalityRoll === 20 ? 1 : mortalityRoll + 1;
    const corpus = buildEvalCorpus(
      [
        makeEntry(3, {
          turnSeed: SEED,
          resolutionTrace: makeResolutionTrace(actionRoll),
          mortalityTrace: [makeMortalityEvent('gaius_pontius_magnus', wrongRoll, true)],
        }),
      ],
      [],
      META
    );
    const replay = replayTurnRolls(corpus.turns[0]);
    expect(replay.status).toBe('mismatch');
    expect(replay.rolls[0].match).toBe(true);
    expect(replay.rolls[1]).toMatchObject({ recorded: wrongRoll, rederived: mortalityRoll, match: false });
  });

  it('does not consume a draw for an invalidated claim (it never reached the dice)', () => {
    const [firstRoll] = expectedRolls(1);
    const corpus = buildEvalCorpus(
      [
        makeEntry(3, {
          turnSeed: SEED,
          mortalityTrace: [
            makeMortalityEvent('maximinus_thrax', undefined, false),
            makeMortalityEvent('gaius_pontius_magnus', firstRoll, true),
          ],
        }),
      ],
      [],
      META
    );
    const replay = replayTurnRolls(corpus.turns[0]);
    expect(replay.status).toBe('match');
    expect(replay.rolls).toHaveLength(1);
    expect(replay.rolls[0].entityId).toBe('gaius_pontius_magnus');
  });

  it('reports no_rolls when the turn recorded none, and no_seed when rolls exist but the seed is missing', () => {
    const noRolls = buildEvalCorpus([makeEntry(3, { turnSeed: SEED })], [], META);
    expect(replayTurnRolls(noRolls.turns[0]).status).toBe('no_rolls');

    const noSeed = buildEvalCorpus(
      [makeEntry(3, { turnSeed: undefined, resolutionTrace: makeResolutionTrace(11) })],
      [],
      META
    );
    const replay = replayTurnRolls(noSeed.turns[0]);
    expect(replay.status).toBe('no_seed');
    expect(replay.rolls[0].rederived).toBeNull();
  });
});

// --- Whole-corpus evaluation ----------------------------------------------

describe('eval/harness evaluateCorpus', () => {
  function makeFixtureCorpus() {
    const [actionRoll] = (() => {
      const rng = createSeededRng(7);
      return [rollD20(rng)];
    })();
    return buildEvalCorpus(
      [
        makeEntry(3, {
          turnSeed: 7,
          resolutionTrace: makeResolutionTrace(actionRoll),
          rawCalls: [
            makeRawCall('adjudication', VALID_ADJUDICATION_JSON),
            makeRawCall('adjudication', INVALID_ADJUDICATION_JSON, { validated: false }),
            makeRawCall('narration', 'Prose narration.'),
          ],
        }),
        makeEntry(4, { rawCalls: undefined, turnSeed: undefined }),
      ],
      [makeRawCall('investigation', 'garbled{{{')],
      META
    );
  }

  it('aggregates per-turn checks and the session call log into one report', () => {
    const report = evaluateCorpus(makeFixtureCorpus());

    expect(report.turns).toHaveLength(2);
    expect(report.summary.turnCount).toBe(2);
    expect(report.summary.schemaCheckCounts).toEqual({
      valid: 1,
      schema_violation: 1,
      unparseable_json: 0,
      skipped_prose: 1,
      skipped_unknown: 0,
    });
    expect(report.summary.totalDeltas).toBe(4);
    expect(report.summary.totalHeadlines).toBe(2);
    expect(report.summary.turnsWithSeed).toBe(1);
    expect(report.summary.turnsWithFullPromptCapture).toBe(1);
    expect(report.summary.rollReplayCounts).toEqual({ match: 1, mismatch: 0, no_rolls: 1, no_seed: 0 });

    expect(report.sessionCallChecks).toHaveLength(1);
    expect(report.sessionCallChecks[0].status).toBe('unparseable_json');
  });

  it('evaluateTurn carries the turn number and all four check sections', () => {
    const corpus = makeFixtureCorpus();
    const turnReport = evaluateTurn(corpus.turns[0]);
    expect(turnReport.turnNumber).toBe(3);
    expect(turnReport.schemaChecks).toHaveLength(3);
    expect(turnReport.density.deltaCount).toBe(2);
    expect(turnReport.completeness.rawCallCount).toBe(3);
    expect(turnReport.rollReplay.status).toBe('match');
  });

  it('formats a report that surfaces violations and mismatch-free replays', () => {
    const text = formatCorpusReport(evaluateCorpus(makeFixtureCorpus()));
    expect(text).toContain('Turn 3');
    expect(text).toContain('schema_violation');
    expect(text).toContain('replay to a match');
  });

  it('assertEvalCorpusShape rejects a non-corpus payload and accepts a real export', () => {
    expect(() => assertEvalCorpusShape({ nope: true })).toThrow(/eval corpus/i);
    expect(() => assertEvalCorpusShape(JSON.parse(JSON.stringify(makeFixtureCorpus())))).not.toThrow();
  });
});

// --- LLM judge scaffold ----------------------------------------------------

const WELL_FORMED_VERDICT: EvalJudgeVerdict = {
  consequence_density: { score: 4, rationale: 'Two concrete deltas and a headline follow from the action.' },
  sim_state_consistency: { score: 5, rationale: 'No contradiction with the given state.' },
  schema_validity: { score: 5, rationale: 'All fields used as intended.' },
  information_asymmetry: { score: 3, rationale: 'A gm_private motive is paraphrased in the narration.' },
  character_richness: { score: 4, rationale: "Thrax's move follows from his own memories and stated intent." },
};

describe('eval judge scaffold', () => {
  it('buildEvalJudgePrompt produces both parts, naming all five axes', () => {
    const { systemInstruction, prompt } = buildEvalJudgePrompt({
      turnNumber: 3,
      playerIntent: 'Address the Senate.',
      adjudication: makeAdjudication(3),
      narration: 'The Curia falls silent as the Emperor rises.',
      mortalityTrace: [makeMortalityEvent('gaius_pontius_magnus', 4, true)],
    });

    expect(systemInstruction.length).toBeGreaterThan(0);
    for (const axis of ['consequence_density', 'sim_state_consistency', 'schema_validity', 'information_asymmetry', 'character_richness']) {
      expect(systemInstruction).toContain(axis);
    }
    expect(prompt).toContain('Address the Senate.');
    expect(prompt).toContain('The Curia falls silent');
    expect(prompt).toContain('GM-PRIVATE MORTALITY TRACE');
  });

  it('buildEvalJudgePrompt renders the Director intents and NPC mind decisions (private_reasoning included) so axes 4-5 have data', () => {
    const { prompt } = buildEvalJudgePrompt({
      turnNumber: 3,
      playerIntent: 'Address the Senate.',
      adjudication: makeAdjudication(3),
      narration: null,
      npcIntents: [{ entity_id: 'maximinus_thrax', intent: 'March the Rhine legions on Rome', continuity: 'pivot' }],
      npcMindResults: [{
        entity_id: 'maximinus_thrax',
        chosen_action: 'Rally the veterans to my standard.',
        method: 'Oaths and donatives.',
        private_reasoning: 'The purple is within reach.',
        scheme_adjustment: null,
      }],
    });

    // Axis 4 (information-asymmetry) needs the intents - each is fed to that
    // character's mind as its own thought; axis 5 (richness) needs the mind
    // decisions, private_reasoning included (both are GM-side artifacts).
    expect(prompt).toContain('DIRECTOR INTENTS');
    expect(prompt).toContain('March the Rhine legions on Rome');
    expect(prompt).toContain('NPC MIND DECISIONS');
    expect(prompt).toContain('The purple is within reach.');
  });

  it('buildEvalJudgePrompt renders explicit placeholders when a turn carried no intents or minds', () => {
    const { prompt } = buildEvalJudgePrompt({
      turnNumber: 3,
      playerIntent: 'Wait and watch.',
      adjudication: makeAdjudication(3),
      narration: null,
      npcIntents: null,
      npcMindResults: null,
    });

    expect(prompt).toContain('(no spotlight intents this turn)');
    expect(prompt).toContain('(no NPC minds ran this turn)');
  });

  it('the fifth axis (4C richness) scores continuity of self, and the axis count is EXACTLY five (pin)', () => {
    const { systemInstruction } = buildEvalJudgePrompt({
      turnNumber: 3,
      playerIntent: 'Address the Senate.',
      adjudication: makeAdjudication(3),
      narration: null,
    });

    expect(systemInstruction).toContain('EXACTLY these five axes');
    expect(systemInstruction).toContain('exactly those five keys');
    // The richness axis's substance: bounded knowledge, memories, intents,
    // voice - continuity of self over plot convenience.
    expect(systemInstruction).toContain("motivated by each character's OWN bounded knowledge, memories, stated intents, and voice");
    expect(systemInstruction).toContain('continuity of self rather than plot convenience');
    // Exactly five - no sixth axis has crept in.
    expect(systemInstruction).toMatch(/^5\. 'character_richness'/m);
    expect(systemInstruction).not.toMatch(/^6\./m);
  });

  it('zEvalJudgeVerdict accepts a well-formed verdict and rejects malformed ones', () => {
    expect(zEvalJudgeVerdict.safeParse(WELL_FORMED_VERDICT).success).toBe(true);

    const missingAxis = { ...WELL_FORMED_VERDICT } as Record<string, unknown>;
    delete missingAxis.schema_validity;
    expect(zEvalJudgeVerdict.safeParse(missingAxis).success).toBe(false);

    // The fifth axis is REQUIRED like the original four - a four-axis
    // verdict no longer validates (schema pair moved in lockstep).
    const missingRichness = { ...WELL_FORMED_VERDICT } as Record<string, unknown>;
    delete missingRichness.character_richness;
    expect(zEvalJudgeVerdict.safeParse(missingRichness).success).toBe(false);

    const outOfRange = {
      ...WELL_FORMED_VERDICT,
      consequence_density: { score: 6, rationale: 'too high' },
    };
    expect(zEvalJudgeVerdict.safeParse(outOfRange).success).toBe(false);
  });

  it('judgeTurn routes through the gateway with a mocked client and returns the parsed verdict', async () => {
    const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
      void params;
      return { text: JSON.stringify(WELL_FORMED_VERDICT) };
    });
    const ai: GeminiClient = { models: { generateContent } };
    const corpus = buildEvalCorpus([makeEntry(3)], [], META);

    const verdict = await judgeTurn(ai, corpus.turns[0]);

    expect(verdict).toEqual(WELL_FORMED_VERDICT);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const params = generateContent.mock.calls[0][0];
    expect(params.contents).toContain('intent 3');
    expect(params.config?.systemInstruction).toContain('consequence_density');
  });

  it('formatJudgeVerdict renders one line per axis', () => {
    const text = formatJudgeVerdict(3, WELL_FORMED_VERDICT);
    expect(text).toContain('Turn 3');
    expect(text).toContain('consequence-density: 4/5');
    expect(text).toContain('information-asymmetry discipline: 3/5');
    expect(text).toContain('character richness: 4/5');
  });
});
