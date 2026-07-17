import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@google/genai';
import {
  generateStructured,
  generateText,
  AiServiceError,
  GeminiClient,
} from '../ai/core/geminiService';

/** Minimal mock client matching GeminiClient's structural shape. */
function makeMockAi(generateContent: (...args: any[]) => Promise<{ text?: string }>): GeminiClient {
  return { models: { generateContent } };
}

describe('geminiService', () => {
  describe('generateStructured - parseModelJson integration', () => {
    it('parses a plain JSON response', async () => {
      const ai = makeMockAi(async () => ({ text: '{"value": 42}' }));
      const result = await generateStructured<{ value: number }>(ai, {
        callName: 'test-plain',
        model: 'test-model',
        prompt: 'say something',
      });
      expect(result).toEqual({ value: 42 });
    });

    it('parses a ```json fenced response', async () => {
      const ai = makeMockAi(async () => ({ text: '```json\n{"value": 7}\n```' }));
      const result = await generateStructured<{ value: number }>(ai, {
        callName: 'test-fenced',
        model: 'test-model',
        prompt: 'say something',
      });
      expect(result).toEqual({ value: 7 });
    });

    it('parses JSON with conversational preamble/postamble via brace-hunting', async () => {
      const ai = makeMockAi(async () => ({
        text: 'Sure, here is the JSON you asked for:\n{"value": 99}\nHope that helps!',
      }));
      const result = await generateStructured<{ value: number }>(ai, {
        callName: 'test-preamble',
        model: 'test-model',
        prompt: 'say something',
      });
      expect(result).toEqual({ value: 99 });
    });
  });

  describe('generateStructured - zod rejection -> repair-retry path', () => {
    const zPoint = z.object({ x: z.number(), y: z.number() });

    it('retries once with a repair suffix and succeeds on the corrected response', async () => {
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: '{"x": 1}' }) // missing "y" - fails zod
        .mockResolvedValueOnce({ text: '{"x": 1, "y": 2}' }); // corrected
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ x: number; y: number }>(ai, {
        callName: 'test-repair',
        model: 'test-model',
        prompt: 'give me a point',
        zodSchema: zPoint,
      });

      expect(result).toEqual({ x: 1, y: 2 });
      expect(generateContent).toHaveBeenCalledTimes(2);

      // The second call's prompt must include the repair suffix, referencing
      // the violated path, and instructing corrected-JSON-only output.
      const secondCallArgs = generateContent.mock.calls[1][0];
      expect(secondCallArgs.contents).toContain('violated the schema');
      expect(secondCallArgs.contents).toContain('y');
      expect(secondCallArgs.contents).toContain('Return ONLY corrected valid JSON.');
    });

    it('throws a fatal AiServiceError if the repair attempt still violates the schema', async () => {
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: '{"x": 1}' })
        .mockResolvedValueOnce({ text: '{"x": "not a number"}' });
      const ai = makeMockAi(generateContent);

      await expect(
        generateStructured<{ x: number; y: number }>(ai, {
          callName: 'test-repair-fail',
          model: 'test-model',
          prompt: 'give me a point',
          zodSchema: zPoint,
        })
      ).rejects.toMatchObject({
        name: 'AiServiceError',
        kind: 'fatal',
        callName: 'test-repair-fail',
      });
      expect(generateContent).toHaveBeenCalledTimes(2);
    });

    it('retries once on unparseable JSON and succeeds on the corrected response', async () => {
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: 'not json at all {{{' })
        .mockResolvedValueOnce({ text: '{"x": 3, "y": 4}' });
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ x: number; y: number }>(ai, {
        callName: 'test-malformed-repair',
        model: 'test-model',
        prompt: 'give me a point',
        zodSchema: zPoint,
      });

      expect(result).toEqual({ x: 3, y: 4 });
      expect(generateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('transient retry/backoff path', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a 500 once and succeeds, without surfacing an error', async () => {
      const serverError = new ApiError({ message: 'Internal Server Error', status: 500 });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ text: 'Hello after retry' });
      const ai = makeMockAi(generateContent);

      const resultPromise = generateText(ai, {
        callName: 'test-transient',
        model: 'test-model',
        prompt: 'say hi',
      });

      // Flush the backoff sleep between attempt 1 and attempt 2.
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;
      expect(result).toBe('Hello after retry');
      expect(generateContent).toHaveBeenCalledTimes(2);
    });

    it('gives up after exhausting retries and throws a transient AiServiceError', async () => {
      const serverError = new ApiError({ message: 'Internal Server Error', status: 503 });
      const generateContent = vi.fn().mockRejectedValue(serverError);
      const ai = makeMockAi(generateContent);

      const resultPromise = generateText(ai, {
        callName: 'test-transient-exhausted',
        model: 'test-model',
        prompt: 'say hi',
      });
      // Suppress unhandled-rejection warnings while timers advance.
      resultPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(30_000);

      await expect(resultPromise).rejects.toMatchObject({
        name: 'AiServiceError',
        kind: 'transient',
        callName: 'test-transient-exhausted',
      });
      expect(generateContent).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
    });

    it('does not retry a non-transient (e.g. 400) error - fails fast as fatal', async () => {
      const badRequest = new ApiError({ message: 'Bad Request', status: 400 });
      const generateContent = vi.fn().mockRejectedValue(badRequest);
      const ai = makeMockAi(generateContent);

      await expect(
        generateText(ai, { callName: 'test-fatal-400', model: 'test-model', prompt: 'say hi' })
      ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'fatal' });
      expect(generateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('AiServiceError typing', () => {
    it('carries kind, callName, message, and cause', () => {
      const cause = new Error('underlying');
      const err = new AiServiceError('fatal', 'my-call', 'something broke', cause);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AiServiceError);
      expect(err.name).toBe('AiServiceError');
      expect(err.kind).toBe('fatal');
      expect(err.callName).toBe('my-call');
      expect(err.message).toBe('something broke');
      expect(err.cause).toBe(cause);
    });
  });
});
