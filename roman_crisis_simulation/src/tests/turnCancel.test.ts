/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateStructured,
  generateStructuredStream,
  GEMINI_PRO,
  TurnCancelledError,
  type GeminiClient,
} from '../ai/core/geminiService';
import { runNewTurn } from '../ai/core/turn';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { selectNoAttemptEvidence } from '../ai/tools/noAttemptResponse';
import { makeEntity, makeSimulationState, makeWorldState } from './factories';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('2C: Turn Cancel & AbortSignal support', () => {
  it('generateStructured rejects immediately with TurnCancelledError without retrying or Pro fallback', async () => {
    const controller = new AbortController();
    const generateContent = vi.fn(async () => {
      // Simulate a hanging request until abort fires.
      return await new Promise<{ text: string }>(() => {});
    });
    const ai: GeminiClient = { models: { generateContent } };

    const promise = generateStructured(ai, {
      callName: 'adjudication',
      model: GEMINI_PRO,
      prompt: 'Test prompt',
      signal: controller.signal,
    });

    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(TurnCancelledError);
    // Called only once: no transient retry and no Pro fallback.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('generateStructuredStream stops mid-stream and calls iterator.return on abort', async () => {
    const controller = new AbortController();
    const returnSpy = vi.fn(async () => ({ value: undefined, done: true as const }));
    let chunkCount = 0;

    const ai: GeminiClient = {
      models: {
        generateContent: vi.fn(),
        generateContentStream: vi.fn(async () => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                chunkCount++;
                if (chunkCount === 1) {
                  return { value: { text: '{"text": "First' }, done: false as const };
                }
                controller.abort();
                return await new Promise<IteratorResult<{ text?: string }>>(() => {});
              },
              return: returnSpy,
            };
          },
        })),
      },
    };

    const chunks: string[] = [];
    const promise = generateStructuredStream<{ text: string }>(
      ai,
      {
        callName: 'narration',
        model: GEMINI_PRO,
        prompt: 'Stream prompt',
        signal: controller.signal,
      },
      soFar => chunks.push(soFar),
    );

    await expect(promise).rejects.toBeInstanceOf(TurnCancelledError);
    expect(chunks).toEqual(['{"text": "First']);
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it('runNewTurn stops before issuing AI calls when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const generateContent = vi.fn(async () => ({ text: '{}' }));
    const ai: GeminiClient = { models: { generateContent } };

    const player = makeEntity({ entity_id: 'player_1', name: 'Severus Alexander' });
    await expect(runNewTurn(
      ai as never,
      { version: 1, kind: 'freeform', text: 'Address the Senate.' },
      player,
      1,
      [player],
      makeWorldState(),
      makeSimulationState(),
      [],
      [],
      [],
      [],
      '',
      false,
      'Crisis of 235',
      { signal: controller.signal },
    )).rejects.toBeInstanceOf(TurnCancelledError);
    expect(generateContent).not.toHaveBeenCalled();

    // Mock Mode also honors pre-aborted signals without issuing mock turn work.
    await expect(runNewTurn(
      ai as never,
      { version: 1, kind: 'freeform', text: 'Address the Senate.' },
      player,
      1,
      [player],
      makeWorldState(),
      makeSimulationState(),
      [],
      [],
      [],
      [],
      '',
      true,
      'Crisis of 235',
      { signal: controller.signal },
    )).rejects.toBeInstanceOf(TurnCancelledError);
  });

  it('forwards config.abortSignal to SDK requests and prevents unhandled rejections when signal aborts synchronously inside invoke()', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const generateContent = vi.fn(async (params: { config?: { abortSignal?: AbortSignal } }) => {
        seenSignal = params.config?.abortSignal;
        controller.abort();
        // Reject asynchronously on abort like real fetch() would when config.abortSignal aborts.
        return await new Promise<{ text: string }>((_resolve, reject) => {
          queueMicrotask(() => reject(new DOMException('Aborted', 'AbortError')));
        });
      });
      const ai: GeminiClient = { models: { generateContent } };

      await expect(generateStructured(ai, {
        callName: 'adjudication',
        model: GEMINI_PRO,
        prompt: 'Test prompt',
        signal: controller.signal,
      })).rejects.toBeInstanceOf(TurnCancelledError);

      expect(seenSignal).toBe(controller.signal);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('aborts parallel sibling calls in runDirectorStage on first failure and propagates TurnCancelledError from post-turn tools', async () => {
    const capturedSignals: AbortSignal[] = [];
    const ai: GeminiClient = {
      models: {
        generateContent: vi.fn(async (params: { config?: { abortSignal?: AbortSignal; responseSchema?: unknown } }) => {
          const sig = params.config?.abortSignal;
          if (sig) capturedSignals.push(sig);
          const schema = JSON.stringify(params.config?.responseSchema ?? '');
          if (schema.includes('spotlight_entities')) {
            throw new Error('400 bad request');
          }
          return await new Promise<{ text: string }>(() => {});
        }),
      },
    };
    const player = makeEntity({ entity_id: 'player_1', name: 'Severus Alexander' });
    await expect(runNewTurn(
      ai as never,
      { version: 1, kind: 'freeform', text: 'Address the legions.' },
      player,
      1,
      [player],
      makeWorldState(),
      makeSimulationState(),
      [],
      [],
      [],
      [],
      '',
      false,
      'Crisis of 235',
    )).rejects.toThrow();
    // Both Director-stage calls ran with linked child signals, and the sibling signal was aborted on failure.
    expect(capturedSignals.length).toBeGreaterThanOrEqual(2);
    expect(capturedSignals.every(s => s.aborted)).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    await expect(getRelationshipObservations(ai, [], [], [], false, aborted.signal)).rejects.toBeInstanceOf(TurnCancelledError);
    await expect(selectNoAttemptEvidence(ai, 'Who is behind this?', [{ id: 'ev1', source: 'rumor', text: 'Rumors swirl.' }], false, aborted.signal)).rejects.toBeInstanceOf(TurnCancelledError);
  });
});
