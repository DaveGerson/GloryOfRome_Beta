/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import {
  generateStructured,
  generateStructuredStream,
  GEMINI_PRO,
  TurnCancelledError,
  type GeminiClient,
} from '../ai/core/geminiService';
import { runNewTurn } from '../ai/core/turn';
import { makeEntity, makeSimulationState, makeWorldState } from './factories';

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
  });
});
