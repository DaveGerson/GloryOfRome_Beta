/**
 * tests/generateSpeech.test.ts
 *
 * ai/core/geminiService.ts::generateSpeech - the narration voice's single
 * network entry point: AUDIO modality with one prebuilt voice, every
 * inline-data part decoded and concatenated, the shared transient retry,
 * a placeholder (never base64) in the call log, and a fatal error when no
 * audio comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@google/genai';
import {
  AiServiceError,
  DEFAULT_NARRATOR_VOICE,
  DEFAULT_SPEECH_MIME_TYPE,
  GEMINI_TTS,
  generateSpeech,
  getSessionCallLog,
  resetSessionCallLog,
  type GeminiClient,
} from '../ai/core/geminiService';

const audioPart = (data: string, mimeType?: string) => ({ inlineData: { data, mimeType } });
const audioResponse = (...parts: ReturnType<typeof audioPart>[]) => ({ candidates: [{ content: { parts } }] });

function makeAi(generateContent: GeminiClient['models']['generateContent']): GeminiClient {
  return { models: { generateContent } };
}

const request = {
  callName: 'narrationVoice',
  model: GEMINI_TTS,
  prompt: '## Transcript:\n<grave> Rome waits.',
  voiceName: DEFAULT_NARRATOR_VOICE,
  temperature: 1,
};

describe('generateSpeech', () => {
  beforeEach(() => resetSessionCallLog());

  it('exports the owner\'s reference model and voice', () => {
    expect(GEMINI_TTS).toBe('gemini-3.8-flash-tts');
    expect(DEFAULT_NARRATOR_VOICE).toBe('Enceladus');
  });

  it('sends AUDIO modality with the prebuilt voice and temperature', async () => {
    const generateContent = vi.fn(async () => audioResponse(audioPart('AQID', 'audio/L16;codec=pcm;rate=24000')));
    await generateSpeech(makeAi(generateContent), request);
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash-tts',
      contents: request.prompt,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Enceladus' } } },
        temperature: 1,
      },
    });
  });

  it('decodes and concatenates every inline-data part, keeping the first mime type', async () => {
    const ai = makeAi(async () => audioResponse(
      audioPart('AQI=', 'audio/L16;codec=pcm;rate=24000'),
      { inlineData: {} } as ReturnType<typeof audioPart>,
      audioPart('AwQ=', 'audio/L16;codec=pcm;rate=16000'),
    ));
    const result = await generateSpeech(ai, request);
    expect([...result.pcm]).toEqual([1, 2, 3, 4]);
    expect(result.mimeType).toBe('audio/L16;codec=pcm;rate=24000');
  });

  it('defaults the mime type when the parts omit it', async () => {
    const result = await generateSpeech(makeAi(async () => audioResponse(audioPart('AQID'))), request);
    expect(result.mimeType).toBe(DEFAULT_SPEECH_MIME_TYPE);
  });

  it('records a short placeholder in the call log, never the base64', async () => {
    const base64 = btoa('x'.repeat(300));
    await generateSpeech(makeAi(async () => audioResponse(audioPart(base64, 'audio/L16;codec=pcm;rate=24000'))), request);
    const [record] = getSessionCallLog();
    expect(record.callName).toBe('narrationVoice');
    expect(record.rawResponse).toBe('[audio: 300 bytes, audio/L16;codec=pcm;rate=24000]');
    expect(record.rawResponse).not.toContain(base64.slice(0, 16));
    expect(record.promptText).toBe(request.prompt);
    expect(record.validated).toBe(true);
  });

  it('throws a fatal AiServiceError when no audio came back (and still logs the call)', async () => {
    const ai = makeAi(async () => ({ text: 'I cannot sing.' }));
    const promise = generateSpeech(ai, request);
    await expect(promise).rejects.toBeInstanceOf(AiServiceError);
    await expect(generateSpeech(ai, request)).rejects.toMatchObject({ kind: 'fatal', callName: 'narrationVoice' });
    expect(getSessionCallLog().at(-1)?.rawResponse).toBe('[audio: none]');
  });

  describe('transient retry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries a 503 and succeeds on the same backoff as every other call', async () => {
      const generateContent = vi.fn()
        .mockRejectedValueOnce(new ApiError({ message: 'Unavailable', status: 503 }))
        .mockResolvedValueOnce(audioResponse(audioPart('AQID')));
      const promise = generateSpeech(makeAi(generateContent), request);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;
      expect([...result.pcm]).toEqual([1, 2, 3]);
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(getSessionCallLog().at(-1)?.attempts).toBe(2);
    });

    it('fails fast as fatal on a 400', async () => {
      const generateContent = vi.fn().mockRejectedValue(new ApiError({ message: 'Bad Request', status: 400 }));
      await expect(generateSpeech(makeAi(generateContent), request)).rejects.toMatchObject({ kind: 'fatal' });
      expect(generateContent).toHaveBeenCalledTimes(1);
    });
  });
});
