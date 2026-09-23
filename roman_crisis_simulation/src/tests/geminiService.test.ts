import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@google/genai';
import {
  generateStructured,
  generateText,
  generateTextStream,
  generateStructuredStream,
  AiServiceError,
  GeminiClient,
  beginTurnCapture,
  endTurnCapture,
  getSessionCallLog,
  resetSessionCallLog,
  MAX_SESSION_CALL_RECORDS,
  MAX_CAPTURED_PROMPT_CHARS,
  GEMINI_PRO,
  GEMINI_PRO_FALLBACK,
  GEMINI_FLASH,
  resetProFallback,
  isProFallbackActive,
} from '../ai/core/geminiService';

/** Minimal mock client matching GeminiClient's structural shape. */
function makeMockAi(generateContent: GeminiClient['models']['generateContent']): GeminiClient {
  return { models: { generateContent } };
}

/** Minimal mock client for streaming - `generateContent` is stubbed but unused. */
function makeStreamMockAi(
  generateContentStream: NonNullable<GeminiClient['models']['generateContentStream']>
): GeminiClient {
  return {
    models: {
      generateContent: vi.fn(async () => ({ text: '' })),
      generateContentStream,
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

/** Builds an async generator yielding one chunk per string in `texts`. */
async function* chunksOf(texts: string[]): AsyncGenerator<{ text?: string }> {
  for (const text of texts) {
    yield { text };
  }
}

/** Like `chunksOf`, but throws `error` after yielding all of `texts`. */
async function* chunksThenThrow(texts: string[], error: unknown): AsyncGenerator<{ text?: string }> {
  for (const text of texts) {
    yield { text };
  }
  throw error;
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

    // App.tsx surfaces a fatal AiServiceError's `message` verbatim in
    // player-facing chat, and for adjudication-family calls the raw model
    // output can carry gm_private material (D4/D5) - so the message must
    // stay free of it, with the snippet only on `debugSnippet`.
    it('keeps the raw model output out of the schema-violation error message, carrying it on debugSnippet', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const offending = '{"x": "SECRET_GM_PLOT_DETAIL"}';
        const generateContent = vi.fn().mockResolvedValue({ text: offending });
        const ai = makeMockAi(generateContent);

        let caught: unknown;
        try {
          await generateStructured<{ x: number; y: number }>(ai, {
            callName: 'test-message-leak',
            model: 'test-model',
            prompt: 'give me a point',
            zodSchema: zPoint,
          });
        } catch (e) {
          caught = e;
        }

        expect(caught).toBeInstanceOf(AiServiceError);
        const err = caught as AiServiceError;
        expect(err.kind).toBe('fatal');
        // The violated paths ARE surfaced; the raw output is not.
        expect(err.message).toContain('violated its schema');
        expect(err.message).not.toContain('SECRET_GM_PLOT_DETAIL');
        expect(err.debugSnippet).toContain('SECRET_GM_PLOT_DETAIL');
      } finally {
        consoleError.mockRestore();
      }
    });

    it('keeps the raw model output out of the unparseable-JSON error message, carrying the parse detail on debugSnippet', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const generateContent = vi.fn().mockResolvedValue({ text: 'SECRET_GM_PLOT_DETAIL {{{' });
        const ai = makeMockAi(generateContent);

        let caught: unknown;
        try {
          await generateStructured<{ x: number; y: number }>(ai, {
            callName: 'test-parse-leak',
            model: 'test-model',
            prompt: 'give me a point',
            zodSchema: zPoint,
          });
        } catch (e) {
          caught = e;
        }

        expect(caught).toBeInstanceOf(AiServiceError);
        const err = caught as AiServiceError;
        expect(err.kind).toBe('fatal');
        expect(err.message).toContain('unparseable JSON');
        expect(err.message).not.toContain('SECRET_GM_PLOT_DETAIL');
        expect(err.debugSnippet).toContain('SECRET_GM_PLOT_DETAIL');
      } finally {
        consoleError.mockRestore();
      }
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

  describe('generateTextStream', () => {
    afterEach(() => {
      endTurnCapture(); // Drain any capture left active by a test that forgot to end it.
    });

    it('accumulates cumulative text across chunks, invoking onChunk after each, and resolves with the full text', async () => {
      const generateContentStream = vi.fn(async () => chunksOf(['Hello ', 'brave ', 'new world']));
      const ai = makeStreamMockAi(generateContentStream);

      const onChunk = vi.fn();
      const result = await generateTextStream(
        ai,
        { callName: 'test-stream-happy', model: 'test-model', prompt: 'narrate' },
        onChunk
      );

      expect(result).toBe('Hello brave new world');
      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Hello brave ');
      expect(onChunk).toHaveBeenNthCalledWith(3, 'Hello brave new world');
      expect(generateContentStream).toHaveBeenCalledTimes(1);
    });

    it('skips onChunk for a chunk carrying no text', async () => {
      const generateContentStream = vi.fn(async () => chunksOf(['A', '', 'B']));
      const ai = makeStreamMockAi(generateContentStream);

      const onChunk = vi.fn();
      const result = await generateTextStream(
        ai,
        { callName: 'test-stream-empty-chunk', model: 'test-model', prompt: 'narrate' },
        onChunk
      );

      expect(result).toBe('AB');
      expect(onChunk).toHaveBeenCalledTimes(2);
    });

    describe('acquisition retry (transient failures before the stream starts)', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('retries a transient failure while ACQUIRING the stream and succeeds', async () => {
        const serverError = new ApiError({ message: 'Internal Server Error', status: 500 });
        const generateContentStream = vi
          .fn()
          .mockRejectedValueOnce(serverError)
          .mockResolvedValueOnce(chunksOf(['Recovered ', 'narration']));
        const ai = makeStreamMockAi(generateContentStream);

        const onChunk = vi.fn();
        const resultPromise = generateTextStream(
          ai,
          { callName: 'test-stream-acquire-retry', model: 'test-model', prompt: 'narrate' },
          onChunk
        );

        await vi.advanceTimersByTimeAsync(10_000);

        const result = await resultPromise;
        expect(result).toBe('Recovered narration');
        expect(generateContentStream).toHaveBeenCalledTimes(2);
        expect(onChunk).toHaveBeenCalledTimes(2);
      });

      it('gives up after exhausting acquisition retries and throws a transient AiServiceError', async () => {
        const serverError = new ApiError({ message: 'Internal Server Error', status: 503 });
        const generateContentStream = vi.fn().mockRejectedValue(serverError);
        const ai = makeStreamMockAi(generateContentStream);

        const resultPromise = generateTextStream(
          ai,
          { callName: 'test-stream-acquire-exhausted', model: 'test-model', prompt: 'narrate' },
          vi.fn()
        );
        resultPromise.catch(() => {});

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(resultPromise).rejects.toMatchObject({
          name: 'AiServiceError',
          kind: 'transient',
          callName: 'test-stream-acquire-exhausted',
        });
        expect(generateContentStream).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
      });

      it('does not retry a non-transient acquisition failure - fails fast as fatal', async () => {
        const badRequest = new ApiError({ message: 'Bad Request', status: 400 });
        const generateContentStream = vi.fn().mockRejectedValue(badRequest);
        const ai = makeStreamMockAi(generateContentStream);

        await expect(
          generateTextStream(
            ai,
            { callName: 'test-stream-acquire-fatal', model: 'test-model', prompt: 'narrate' },
            vi.fn()
          )
        ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'fatal' });
        expect(generateContentStream).toHaveBeenCalledTimes(1);
      });
    });

    it('surfaces a mid-stream failure (after chunks started flowing) as a transient AiServiceError with no retry', async () => {
      const midStreamError = new Error('connection dropped mid-response');
      const generateContentStream = vi.fn(async () =>
        chunksThenThrow(['The senator rises', ' to speak, but'], midStreamError)
      );
      const ai = makeStreamMockAi(generateContentStream);

      const onChunk = vi.fn();
      await expect(
        generateTextStream(
          ai,
          { callName: 'test-stream-mid-error', model: 'test-model', prompt: 'narrate' },
          onChunk
        )
      ).rejects.toMatchObject({
        name: 'AiServiceError',
        kind: 'transient',
        callName: 'test-stream-mid-error',
      });

      // The chunks that DID arrive before the failure were still delivered.
      expect(onChunk).toHaveBeenCalledTimes(2);
      // No retry of the stream itself - acquiring it only happened once.
      expect(generateContentStream).toHaveBeenCalledTimes(1);
    });

    it("propagates the CONSUMER's own onChunk throw unchanged - never as a transient mid-stream failure - and closes the stream", async () => {
      // Regression: the onChunk call sat inside the same try as the stream
      // iteration, so turn.ts's player-visible stream gate refusing a leaked
      // mechanic surfaced as "failed mid-stream" (kind 'transient'), and the
      // player was told the connection dropped and invited to retry.
      let closed = false;
      async function* stream(): AsyncGenerator<{ text?: string }> {
        try {
          yield { text: 'Safe prose. ' };
          yield { text: 'Leaked mechanic.' };
          yield { text: ' Never read.' };
        } finally {
          closed = true;
        }
      }
      const ai = makeStreamMockAi(vi.fn(async () => stream()));
      const gateVerdict = new Error('player-visible text failed the boundary');
      const onChunk = vi.fn((textSoFar: string) => {
        if (textSoFar.includes('Leaked')) throw gateVerdict;
      });

      const failure = await generateTextStream(
        ai,
        { callName: 'test-stream-consumer-throw', model: 'test-model', prompt: 'narrate' },
        onChunk
      ).catch((e: unknown) => e);

      expect(failure).toBe(gateVerdict);
      expect(failure).not.toBeInstanceOf(AiServiceError);
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(closed).toBe(true);
    });

    it('generateStructuredStream: an onChunk throw propagates unchanged too, and each chunk also arrives on its own', async () => {
      const ai = makeStreamMockAi(vi.fn(async () => chunksOf(['{"text": "A', 'B"}'])));
      const seen: Array<[string, string]> = [];
      const payload = await generateStructuredStream<{ text: string }>(
        ai,
        { callName: 'test-structured-stream-chunks', model: 'test-model', prompt: 'narrate' },
        (soFar, chunk) => { seen.push([soFar, chunk]); }
      );
      expect(payload).toEqual({ text: 'AB' });
      expect(seen).toEqual([['{"text": "A', '{"text": "A'], ['{"text": "AB"}', 'B"}']]);

      const gateVerdict = new Error('boundary');
      const failing = makeStreamMockAi(vi.fn(async () => chunksOf(['{"text": "A', 'B"}'])));
      const failure = await generateStructuredStream(
        failing,
        { callName: 'test-structured-stream-consumer-throw', model: 'test-model', prompt: 'narrate' },
        () => { throw gateVerdict; }
      ).catch((e: unknown) => e);
      expect(failure).toBe(gateVerdict);
    });

    it('throws a fatal AiServiceError if the client has no generateContentStream implementation', async () => {
      const ai: GeminiClient = { models: { generateContent: vi.fn(async () => ({ text: '' })) } };

      await expect(
        generateTextStream(
          ai,
          { callName: 'test-stream-unsupported', model: 'test-model', prompt: 'narrate' },
          vi.fn()
        )
      ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'fatal', callName: 'test-stream-unsupported' });
    });

    it('records the full concatenated text (with attempts/latency) via the turn capture, same as generateText', async () => {
      const generateContentStream = vi.fn(async () => chunksOf(['Part one ', 'part two']));
      const ai = makeStreamMockAi(generateContentStream);

      beginTurnCapture();
      const result = await generateTextStream(
        ai,
        { callName: 'test-stream-capture', model: 'test-model', prompt: 'narrate' },
        vi.fn()
      );
      const records = endTurnCapture();

      expect(result).toBe('Part one part two');
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        callName: 'test-stream-capture',
        model: 'test-model',
        attempts: 1,
        rawResponse: 'Part one part two',
        validated: true,
      });
      expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
      expect(records[0].promptChars).toBe('narrate'.length);
      expect(records[0].promptText).toBe('narrate');
    });

    it('does not record anything if acquiring the stream fails outright (nothing succeeded to capture)', async () => {
      const badRequest = new ApiError({ message: 'Bad Request', status: 400 });
      const generateContentStream = vi.fn().mockRejectedValue(badRequest);
      const ai = makeStreamMockAi(generateContentStream);

      beginTurnCapture();
      await expect(
        generateTextStream(
          ai,
          { callName: 'test-stream-capture-fail', model: 'test-model', prompt: 'narrate' },
          vi.fn()
        )
      ).rejects.toThrow();
      const records = endTurnCapture();

      expect(records).toHaveLength(0);
    });
  });

  describe('raw call capture - prompt text and the session-wide log', () => {
    beforeEach(() => {
      resetSessionCallLog();
    });

    afterEach(() => {
      resetSessionCallLog();
      endTurnCapture(); // Drain any capture left active by a test that forgot to end it.
    });

    it('captures promptText and systemInstruction on a bracketed structured call', async () => {
      const ai = makeMockAi(async () => ({ text: '{"value": 1}' }));

      beginTurnCapture();
      await generateStructured<{ value: number }>(ai, {
        callName: 'test-capture-prompt',
        model: 'test-model',
        systemInstruction: 'You are the adjudicator.',
        prompt: 'adjudicate the turn',
      });
      const records = endTurnCapture();

      expect(records).toHaveLength(1);
      expect(records[0].promptText).toBe('adjudicate the turn');
      expect(records[0].systemInstruction).toBe('You are the adjudicator.');
      expect(records[0].promptChars).toBe('adjudicate the turn'.length);
      // The same call is also visible in the session-wide log.
      expect(getSessionCallLog()).toHaveLength(1);
      expect(getSessionCallLog()[0].promptText).toBe('adjudicate the turn');
    });

    it('captures the repair-retry round-trip with ITS actual prompt (the repair suffix included)', async () => {
      const zPoint = z.object({ x: z.number(), y: z.number() });
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: '{"x": 1}' }) // missing "y" - fails zod
        .mockResolvedValueOnce({ text: '{"x": 1, "y": 2}' });
      const ai = makeMockAi(generateContent);

      beginTurnCapture();
      await generateStructured<{ x: number; y: number }>(ai, {
        callName: 'test-capture-repair',
        model: 'test-model',
        prompt: 'give me a point',
        zodSchema: zPoint,
      });
      const records = endTurnCapture();

      expect(records).toHaveLength(2);
      expect(records[0].promptText).toBe('give me a point');
      expect(records[1].promptText).toContain('give me a point');
      expect(records[1].promptText).toContain('violated the schema');
    });

    it('records an out-of-band call (no active bracket) in the session log', async () => {
      const ai = makeMockAi(async () => ({ text: 'a report on the legate' }));

      await generateText(ai, {
        callName: 'test-out-of-band',
        model: 'test-model',
        systemInstruction: 'You are an informant.',
        prompt: 'investigate the legate',
      });

      const log = getSessionCallLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        callName: 'test-out-of-band',
        model: 'test-model',
        promptText: 'investigate the legate',
        systemInstruction: 'You are an informant.',
        rawResponse: 'a report on the legate',
        validated: true,
      });
      // No bracket was open, so a later bracket sees none of it.
      beginTurnCapture();
      expect(endTurnCapture()).toHaveLength(0);
    });

    it('keeps concurrent calls in their origin capture and never appends a late completion to a replacement capture', async () => {
      const firstResponse = deferred<{ text: string }>();
      const secondResponse = deferred<{ text: string }>();
      const generateContent = vi.fn()
        .mockImplementationOnce(() => firstResponse.promise)
        .mockImplementationOnce(() => secondResponse.promise);
      const ai = makeMockAi(generateContent);

      beginTurnCapture();
      const lateOldCall = generateText(ai, {
        callName: 'old-turn-late', model: 'test-model', prompt: 'old prompt',
      });
      const completedOldCall = generateText(ai, {
        callName: 'old-turn-complete', model: 'test-model', prompt: 'old prompt 2',
      });
      secondResponse.resolve({ text: 'completed in the origin capture' });
      await completedOldCall;
      const originRecords = endTurnCapture();

      beginTurnCapture();
      firstResponse.resolve({ text: 'completed after the replacement began' });
      await lateOldCall;
      const replacementRecords = endTurnCapture();

      expect(originRecords.map(record => record.callName)).toEqual(['old-turn-complete']);
      expect(replacementRecords).toEqual([]);
    });

    it('does not append an abandoned call to a session created after reset', async () => {
      const oldResponse = deferred<{ text: string }>();
      const ai = makeMockAi(vi.fn(() => oldResponse.promise));

      const abandonedCall = generateText(ai, {
        callName: 'abandoned-campaign-call', model: 'test-model', prompt: 'old campaign prompt',
      });
      resetSessionCallLog();
      oldResponse.resolve({ text: 'late old campaign response' });
      await abandonedCall;

      expect(getSessionCallLog()).toEqual([]);
    });

    it('evicts the oldest records once the session log exceeds its cap', async () => {
      const ai = makeMockAi(async () => ({ text: 'ok' }));
      const overflow = 3;
      const total = MAX_SESSION_CALL_RECORDS + overflow;

      for (let i = 0; i < total; i++) {
        await generateText(ai, { callName: `call-${i}`, model: 'test-model', prompt: 'p' });
      }

      const log = getSessionCallLog();
      expect(log).toHaveLength(MAX_SESSION_CALL_RECORDS);
      expect(log[0].callName).toBe(`call-${overflow}`); // oldest survivors first
      expect(log[log.length - 1].callName).toBe(`call-${total - 1}`);
    });

    it('truncates an oversized prompt defensively while keeping the true promptChars', async () => {
      const bigPrompt = 'p'.repeat(MAX_CAPTURED_PROMPT_CHARS + 100);
      const ai = makeMockAi(async () => ({ text: 'ok' }));

      await generateText(ai, { callName: 'test-truncate-prompt', model: 'test-model', prompt: bigPrompt });

      const log = getSessionCallLog();
      expect(log).toHaveLength(1);
      expect(log[0].promptText!.length).toBeLessThan(bigPrompt.length);
      expect(log[0].promptText).toContain('[truncated');
      expect(log[0].promptChars).toBe(bigPrompt.length);
    });

    it('omits systemInstruction from the record when the request had none', async () => {
      const ai = makeMockAi(async () => ({ text: 'ok' }));

      await generateText(ai, { callName: 'test-no-sys', model: 'test-model', prompt: 'p' });

      expect(getSessionCallLog()[0].systemInstruction).toBeUndefined();
    });
  });

  describe('AiServiceError typing', () => {
    it('carries kind, callName, message, cause, and the optional debugSnippet', () => {
      const cause = new Error('underlying');
      const err = new AiServiceError('fatal', 'my-call', 'something broke', cause, 'offending output');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AiServiceError);
      expect(err.name).toBe('AiServiceError');
      expect(err.kind).toBe('fatal');
      expect(err.callName).toBe('my-call');
      expect(err.message).toBe('something broke');
      expect(err.cause).toBe(cause);
      expect(err.debugSnippet).toBe('offending output');

      const bare = new AiServiceError('transient', 'my-call', 'timed out');
      expect(bare.debugSnippet).toBeUndefined();
    });
  });

  describe('pro-tier model fallback (GEMINI_PRO -> GEMINI_PRO_FALLBACK)', () => {
    beforeEach(() => {
      resetProFallback();
      resetSessionCallLog();
    });

    afterEach(() => {
      resetProFallback();
      resetSessionCallLog();
      endTurnCapture(); // Drain any capture left active by a test that forgot to end it.
    });

    it('falls back once to GEMINI_PRO_FALLBACK when GEMINI_PRO 404s, and succeeds', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: '{"ok":1}' });
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ ok: number }>(ai, {
        callName: 'test-pro-fallback',
        model: GEMINI_PRO,
        prompt: 'adjudicate',
      });

      expect(result).toEqual({ ok: 1 });
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO_FALLBACK);
      expect(isProFallbackActive()).toBe(true);
    });

    it('records the model actually used (the fallback) in the RawCallRecord', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: '{"ok":1}' });
      const ai = makeMockAi(generateContent);

      await generateStructured<{ ok: number }>(ai, {
        callName: 'test-pro-fallback-record',
        model: GEMINI_PRO,
        prompt: 'adjudicate',
      });

      const log = getSessionCallLog();
      expect(log).toHaveLength(1);
      expect(log[0].model).toBe(GEMINI_PRO_FALLBACK);
    });

    it('sticks to the fallback for a later pro-tier call - no further 404 attempt against the preview id', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: '{"ok":1}' });
      const ai = makeMockAi(generateContent);

      await generateStructured<{ ok: number }>(ai, { callName: 'first', model: GEMINI_PRO, prompt: 'p1' });
      expect(isProFallbackActive()).toBe(true);

      generateContent.mockClear();
      generateContent.mockResolvedValueOnce({ text: '{"ok":2}' });

      const second = await generateStructured<{ ok: number }>(ai, { callName: 'second', model: GEMINI_PRO, prompt: 'p2' });

      expect(second).toEqual({ ok: 2 });
      // Exactly one call, straight on the fallback - the preview id is never retried.
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO_FALLBACK);
    });

    it('resetProFallback clears stickiness - a later pro call retries the preview id again', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: '{"ok":1}' });
      const ai = makeMockAi(generateContent);

      await generateStructured<{ ok: number }>(ai, { callName: 'first', model: GEMINI_PRO, prompt: 'p1' });
      expect(isProFallbackActive()).toBe(true);

      resetProFallback();
      expect(isProFallbackActive()).toBe(false);

      generateContent.mockClear();
      generateContent.mockResolvedValueOnce({ text: '{"ok":2}' });

      const second = await generateStructured<{ ok: number }>(ai, { callName: 'second', model: GEMINI_PRO, prompt: 'p2' });

      expect(second).toEqual({ ok: 2 });
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
    });

    it.each([
      ['NOT_FOUND', 'models/gemini-3-pro-preview is NOT_FOUND'],
      ['is not found', 'models/gemini-3-pro-preview is not found'],
    ])('detects a model-unavailable 404 whose message reads "%s"', async (_label, message) => {
      const notFound = new ApiError({ status: 404, message });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: '{"ok":1}' });
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ ok: number }>(ai, {
        callName: 'test-detect',
        model: GEMINI_PRO,
        prompt: 'p',
      });

      expect(result).toEqual({ ok: 1 });
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO_FALLBACK);
    });

    describe('negatives: transient/fatal errors on GEMINI_PRO never trigger the fallback', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('429 retries transiently 3x, every attempt on GEMINI_PRO, no switch', async () => {
        const rateLimited = new ApiError({ status: 429, message: 'Too Many Requests' });
        const generateContent = vi.fn().mockRejectedValue(rateLimited);
        const ai = makeMockAi(generateContent);

        const resultPromise = generateText(ai, { callName: 'test-429-no-switch', model: GEMINI_PRO, prompt: 'p' });
        resultPromise.catch(() => {});

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(resultPromise).rejects.toMatchObject({ name: 'AiServiceError', kind: 'transient' });
        expect(generateContent).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
        for (const call of generateContent.mock.calls) {
          expect(call[0].model).toBe(GEMINI_PRO);
        }
        expect(isProFallbackActive()).toBe(false);
      });

      it('500 retries transiently 3x, every attempt on GEMINI_PRO, no switch', async () => {
        const serverError = new ApiError({ status: 500, message: 'Internal Server Error' });
        const generateContent = vi.fn().mockRejectedValue(serverError);
        const ai = makeMockAi(generateContent);

        const resultPromise = generateText(ai, { callName: 'test-500-no-switch', model: GEMINI_PRO, prompt: 'p' });
        resultPromise.catch(() => {});

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(resultPromise).rejects.toMatchObject({ name: 'AiServiceError', kind: 'transient' });
        expect(generateContent).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
        for (const call of generateContent.mock.calls) {
          expect(call[0].model).toBe(GEMINI_PRO);
        }
        expect(isProFallbackActive()).toBe(false);
      });

      it('400 is fatal on the first attempt, no switch', async () => {
        const badRequest = new ApiError({ status: 400, message: 'Bad Request' });
        const generateContent = vi.fn().mockRejectedValue(badRequest);
        const ai = makeMockAi(generateContent);

        await expect(
          generateText(ai, { callName: 'test-400-no-switch', model: GEMINI_PRO, prompt: 'p' })
        ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'fatal' });

        expect(generateContent).toHaveBeenCalledTimes(1);
        expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
        expect(isProFallbackActive()).toBe(false);
      });
    });

    it('a zod schema violation goes through the repair-retry on GEMINI_PRO, never the fallback', async () => {
      const zPoint = z.object({ x: z.number(), y: z.number() });
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: '{"x": 1}' }) // missing "y" - fails zod
        .mockResolvedValueOnce({ text: '{"x": 1, "y": 2}' });
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ x: number; y: number }>(ai, {
        callName: 'test-zod-no-switch',
        model: GEMINI_PRO,
        prompt: 'give me a point',
        zodSchema: zPoint,
      });

      expect(result).toEqual({ x: 1, y: 2 });
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO);
      expect(isProFallbackActive()).toBe(false);
    });

    it('unparseable JSON goes through the repair-retry on GEMINI_PRO, never the fallback', async () => {
      const generateContent = vi.fn()
        .mockResolvedValueOnce({ text: 'not json at all {{{' })
        .mockResolvedValueOnce({ text: '{"x": 3, "y": 4}' });
      const ai = makeMockAi(generateContent);

      const result = await generateStructured<{ x: number; y: number }>(ai, {
        callName: 'test-parse-no-switch',
        model: GEMINI_PRO,
        prompt: 'give me a point',
      });

      expect(result).toEqual({ x: 3, y: 4 });
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO);
      expect(isProFallbackActive()).toBe(false);
    });

    it('a 404 on GEMINI_FLASH does not substitute the pro fallback (it keys on the preview id, not any 404)', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-2.5-flash is not found' });
      const generateContent = vi.fn().mockRejectedValue(notFound);
      const ai = makeMockAi(generateContent);

      await expect(
        generateText(ai, { callName: 'test-flash-404', model: GEMINI_FLASH, prompt: 'p' })
      ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'fatal' });

      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_FLASH);
      expect(isProFallbackActive()).toBe(false);
    });

    it('surfaces the error when the fallback attempt itself also fails (attempted once, no infinite loop)', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const serverError = new ApiError({ status: 500, message: 'Internal Server Error' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(serverError);
      const ai = makeMockAi(generateContent);

      await expect(
        generateText(ai, { callName: 'test-fallback-also-fails', model: GEMINI_PRO, prompt: 'p' })
      ).rejects.toMatchObject({ name: 'AiServiceError', kind: 'transient' });

      // Exactly 2 network calls total (preview + one fallback attempt) - no retry loop on the fallback itself.
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_PRO);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO_FALLBACK);
    });

    it('generateText also gets the pro-tier fallback (the substitution lives in the shared request path)', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ text: 'Recovered narration text' });
      const ai = makeMockAi(generateContent);

      const result = await generateText(ai, { callName: 'test-text-fallback', model: GEMINI_PRO, prompt: 'narrate' });

      expect(result).toBe('Recovered narration text');
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls[1][0].model).toBe(GEMINI_PRO_FALLBACK);
    });

    it('generateTextStream acquisition also gets the pro-tier fallback (narration streams on GEMINI_PRO)', async () => {
      const notFound = new ApiError({ status: 404, message: 'models/gemini-3-pro-preview is not found' });
      const generateContentStream = vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce(chunksOf(['Recovered ', 'narration']));
      const ai = makeStreamMockAi(generateContentStream);

      const onChunk = vi.fn();
      const result = await generateTextStream(
        ai,
        { callName: 'test-stream-fallback', model: GEMINI_PRO, prompt: 'narrate' },
        onChunk
      );

      expect(result).toBe('Recovered narration');
      expect(generateContentStream).toHaveBeenCalledTimes(2);
      expect(generateContentStream.mock.calls[0][0].model).toBe(GEMINI_PRO);
      expect(generateContentStream.mock.calls[1][0].model).toBe(GEMINI_PRO_FALLBACK);
      expect(onChunk).toHaveBeenCalledTimes(2);
    });
  });
});
