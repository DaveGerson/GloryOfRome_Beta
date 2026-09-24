/**
 * tests/mockParity.test.ts
 *
 * E2: mockRunNewTurn (ai/mocks.ts) never ran the player-boundary gates its
 * real twin (ai/core/turn.ts::runNewTurn) enforces, and committed Director
 * intents unfiltered by selectDurableIntents (phantom intents for entities
 * absent from the roster). This file pins both real-path behaviors onto the
 * mock so the two never diverge again.
 */
import { describe, it, expect, vi } from 'vitest';
import { mockRunNewTurn } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { INITIAL_SIMULATION_STATE, ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { playerOwnsDelta, samePlayerIdentity } from '../ai/core/playerBoundary';
import { Entity, TurnSubmission } from '../types';
import { performNarration } from '../ai/tools/narrationVoice';
import { parseTranscript, speakableText, spokenTokens } from '../narration/performanceScript';
import { GEMINI_TTS, type GeminiClient } from '../ai/core/geminiService';

const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });
const questionOnly = (q: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: q });
const privateIntentOnly = (intent: string): TurnSubmission => ({ version: 1, kind: 'structured', privateIntent: intent });

/** Every character components/CharacterSelection.tsx offers. */
const PLAYABLE_PRESET_IDS = [
  'severus_alexander',
  'maximinus_thrax',
  'gaius_pontius_magnus',
  'lycinia_stolo',
] as const;

const run = (submission: TurnSubmission | string, player: Entity, entities: Entity[], sim = INITIAL_SIMULATION_STATE) =>
  mockRunNewTurn(submission, player, 1, entities, getMockInitialState().worldState, [], '', 'A crisis.', structuredClone(sim), [], []);

function findEntity(entities: Entity[], entityId: string): Entity {
  const found = entities.find(e => e.entity_id === entityId);
  if (!found) throw new Error(`fixture missing entity_id ${entityId}`);
  return found;
}

describe('mockRunNewTurn / real-pipeline boundary parity (E2)', () => {
  it('a no-attempt mock turn emits a boundary-compliant adjudication (no player-authored content)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(questionOnly('What do the wardens report?'), player, entities);

    expect(result.newHistoryEntry.adjudication.entityActions.some(action => action.id === 'severus_alexander')).toBe(false);
    expect(result.newHistoryEntry.adjudication.deltas.some(delta =>
      delta.type === 'relation' && delta.key.startsWith('severus_alexander:'))).toBe(false);
    expect(result.headlines).not.toContain('Emperor promises bonus to Praetorian Guard.');
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
  });

  // C1 (shipping blocker): projectMockAdjudicationForNoAttempt filtered an
  // ENUMERATION of surfaces (entityActions by id, 'relation' deltas by key
  // root, headlines) and missed three more the canned MOCK_ADJUDICATION
  // authors - a 'resource' delta keyed maximinus_thrax, a 'status' delta keyed
  // gaius_pontius_magnus, and remove_entities: ['lycinia_stolo']. Since
  // playerOwnsDelta matches on the key root for EVERY delta type and
  // valueRemovesPlayer matches remove_entities, every no-attempt turn threw
  // for three of the four shipped presets. Mock Mode is a production-visible
  // toggle (components/Header.tsx), so this was user-reachable and
  // deterministic - retry never succeeded. The projection now enforces the
  // INVARIANT (remove everything the actual player owns, on every surface the
  // structural gates examine) rather than a list of surfaces.
  it.each(PLAYABLE_PRESET_IDS)('a no-attempt mock turn commits for preset %s', async entityId => {
    // ALL_INITIAL_ENTITIES is the SHIPPED roster components/CharacterSelection.tsx
    // draws from; tests/mockData.ts's fixture holds only three of the four.
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, entityId);

    const question = await run(questionOnly('What is whispered in the Curia?'), player, entities);
    expect(question.newHistoryEntry.turnNumber).toBe(1);

    const privateIntent = await run(privateIntentOnly('Weigh my options in silence.'), player, entities);
    expect(privateIntent.newHistoryEntry.turnNumber).toBe(1);
  });

  it.each(PLAYABLE_PRESET_IDS)('a no-attempt mock turn owns nothing of preset %s', async entityId => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, entityId);

    const { newHistoryEntry } = await run(questionOnly('What is whispered in the Curia?'), player, entities);
    const { adjudication } = newHistoryEntry;

    // Asserted through playerBoundary.ts's OWN ownership predicate, not a
    // restatement of it: the invariant is "owns nothing", and the carve-outs
    // the predicate encodes (an NPC-authored rumor keyed under the player, a
    // world-driven dependency_level rise) are legitimately still present.
    expect(adjudication.entityActions.some(action => samePlayerIdentity(action.id, player))).toBe(false);
    expect(adjudication.deltas.some(delta => playerOwnsDelta(delta, player))).toBe(false);
    expect((adjudication.remove_entities ?? []).some(id => samePlayerIdentity(id, player))).toBe(false);
  });

  // The gate-wiring lever, rebuilt from INJECTED content so it no longer
  // depends on which preset is playing: a structural violation the mock cannot
  // project away (the player named in a simulation-state remove_entities).
  it.each(PLAYABLE_PRESET_IDS)(
    'the real structural gate still fires in mock mode for preset %s',
    async entityId => {
      const entities = ALL_INITIAL_ENTITIES;
      const player = findEntity(entities, entityId);
      const sim = { ...INITIAL_SIMULATION_STATE, remove_entities: [entityId] } as unknown as typeof INITIAL_SIMULATION_STATE;

      await expect(run(questionOnly('What do the wardens report?'), player, entities, sim))
        .rejects.toThrow('AI output violated the player action boundary.');
    },
  );

  it('the gates stay open on an observable attempt (parity with the real short-circuit)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'gaius_pontius_magnus');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.newHistoryEntry.adjudication.entityActions.some(action => action.id === 'severus_alexander')).toBe(true);
  });

  // CHANGED (prose/structural split): player-attributed PROSE on a
  // player-visible surface is a narrative blemish, not a mechanical violation.
  // The mock runs the same redact-or-throw wiring as ai/core/turn.ts, so the
  // crisis text is scrubbed and the turn commits instead of failing.
  it.each(PLAYABLE_PRESET_IDS)(
    'a no-attempt turn redacts player-attributed simulation-state prose for preset %s',
    async entityId => {
      const entities = ALL_INITIAL_ENTITIES;
      const player = findEntity(entities, entityId);
      const invented = `${player.name} marches on the Praetorian camp.`;
      const sim = { ...INITIAL_SIMULATION_STATE, major_ongoing_crisis: invented };

      const result = await run(questionOnly('What do the wardens report?'), player, entities, sim);

      expect(result.updatedSimulationState.major_ongoing_crisis).not.toContain('marches');
      expect(result.newHistoryEntry.adjudication.gm_private.some(note =>
        note.startsWith('[Boundary]') && note.includes(invented))).toBe(true);
    },
  );

  it('phantom spotlight intents for entities absent from the roster are dropped (selectDurableIntents parity)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.updatedNpcIntents.map(i => i.entity_id)).toEqual(['maximinus_thrax']);
    expect(result.newHistoryEntry.npcIntents).toEqual(result.updatedNpcIntents);
  });

  it('dead spotlights hold no durable intent', async () => {
    const entities = ALL_INITIAL_ENTITIES.map(e => e.entity_id === 'maximinus_thrax' ? { ...e, status: 'dead' as const } : e);
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.updatedNpcIntents.map(i => i.entity_id)).toEqual(['praetorian_guard']);
  });
});

// The narration voice (ai/tools/narrationVoice.ts): Mock Mode skips both the
// director and the TTS call, but what it hands the player must obey the same
// invariants as the real path - the spoken words are exactly the committed
// narration's, and the audio is a playable WAV.
describe('narration voice: mock / real parity', () => {
  const NARRATION = 'The Senate waits. "Not this time," mutters Maximinus, and the torches gutter.';

  const spokenWordsOf = (transcript: string) => {
    const parsed = parseTranscript(transcript);
    if (!parsed.ok) throw new Error(`unparseable transcript: ${parsed.reason}`);
    return spokenTokens(parsed.value.spoken);
  };

  it('both paths voice exactly the committed words, as a RIFF/WAVE file', async () => {
    const script = `<low> ${NARRATION.replace('"Not', '<a growl> "Not')}`;
    const ai: GeminiClient = {
      models: {
        generateContent: vi.fn(async (params: { model: string }) => params.model === GEMINI_TTS
          ? { candidates: [{ content: { parts: [{ inlineData: { data: 'AAAAAA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }
          : { text: script }),
      },
    };
    const mock = await performNarration(ai, NARRATION, true);
    expect(ai.models.generateContent).not.toHaveBeenCalled();
    const real = await performNarration(ai, NARRATION, false);

    for (const result of [mock, real]) {
      expect(spokenWordsOf(result.transcript)).toEqual(spokenTokens(speakableText(NARRATION)));
      expect(String.fromCharCode(...result.wav.slice(0, 4), ...result.wav.slice(8, 12))).toBe('RIFFWAVE');
    }
    expect(real.usedFallback).toBe(false);
    expect(mock.usedFallback).toBe(true);
  });
});
