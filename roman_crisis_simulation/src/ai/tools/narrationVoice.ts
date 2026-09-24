/**
 * ai/tools/narrationVoice.ts
 *
 * "Hear it performed": one committed, player-visible GM narration in, one
 * playable WAV out. Two model calls, both through ai/core/geminiService.ts:
 *
 *  1. `narrationPerformance` (the intermediary prep model, prose) - the
 *     director inserts `<...>` delivery directions. By default this is
 *     `GEMINI_NARRATION_PREP` at LOW thinking; a narrator profile
 *     (narration/narrators.ts) may name its own, tuned, prep model. Its output is validated by
 *     narration/performanceScript.ts; a refused script, or a failed call,
 *     falls back to the plain narration under one generic direction. The
 *     voice never fails for want of a director.
 *  2. `narrationVoice` (the profile's TTS model, audio) - the transcript is
 *     performed in the profile's voice; raw PCM is wrapped in a WAV header
 *     (narration/wav.ts).
 *
 * The caller may only pass text that is already committed to the player's
 * chat (DESIGN_DECISIONS.md D4/D5) - in practice a `messages[]` entry with
 * `sender === 'gm'` (hooks/useNarrationVoice.ts). Nothing else from the
 * game state reaches either call.
 *
 * Mock Mode: like every ai/tools call site, `isMockMode` is checked here,
 * before the service is reached. Both network calls are skipped: the
 * fallback-directed transcript and a short synthesized tone stand in, so
 * offline play and tests still run the whole decode -> WAV -> playback
 * path.
 */

import {
  generateSpeech,
  generateText,
  type GeminiClient,
} from '../core/geminiService';
import {
  buildNarrationPerformancePrompt,
  buildNarrationTtsPrompt,
} from '../prompts/narrationPerformance';
import { LAMPLIGHT_NARRATOR, type NarratorProfile } from '../../narration/narrators';
import { performedTranscriptFor, speakableText, type PerformedTranscript } from '../../narration/performanceScript';
import { MOCK_TONE_MIME_TYPE, ensureWav, pcmToWav, synthesizeMockTone } from '../../narration/wav';

/** The owner's reference: temperature 1 for the voice itself. */
export const NARRATION_VOICE_TEMPERATURE = LAMPLIGHT_NARRATOR.voice.temperature;

export interface NarrationPerformance extends PerformedTranscript {
  /** A complete RIFF/WAVE file, ready for a Blob. */
  wav: Uint8Array<ArrayBuffer>;
}

/**
 * The prep model's raw answer for one narration, unvalidated - or the error
 * that stopped it. Shared by the game path below and the tuning harness
 * (narration/tuning/), which reports refused scripts verbatim so a
 * narrator's director notes can be tuned against them.
 */
export async function runNarrationDirector(
  ai: GeminiClient,
  narration: string,
  narrator: NarratorProfile = LAMPLIGHT_NARRATOR,
): Promise<{ output: string | null; error?: unknown }> {
  const { systemInstruction, prompt } = buildNarrationPerformancePrompt(speakableText(narration), narrator);
  try {
    const output = await generateText(ai, {
      callName: 'narrationPerformance',
      model: narrator.prep.model,
      systemInstruction,
      prompt,
      // The SDK's ThinkingLevel enum is upper-case ('LOW'); profiles are
      // authored lower-case for readability.
      thinkingConfig: { thinkingLevel: narrator.prep.thinkingLevel.toUpperCase() },
      temperature: narrator.prep.temperature,
    });
    return { output };
  } catch (error) {
    return { output: null, error };
  }
}

/**
 * Step 1 alone: the director's script, validated, or the fallback. Never
 * throws - a failed director call is just a fallback.
 */
export async function directNarrationPerformance(
  ai: GeminiClient,
  narration: string,
  isMockMode: boolean,
  narrator: NarratorProfile = LAMPLIGHT_NARRATOR,
): Promise<PerformedTranscript> {
  if (isMockMode) return performedTranscriptFor(narration, null);

  const { output, error } = await runNarrationDirector(ai, narration, narrator);
  if (error !== undefined) {
    console.warn('narrationVoice: the director call failed; performing the plain narration instead', error);
  }
  const performed = performedTranscriptFor(narration, output);
  if (performed.rejection) {
    console.warn(`narrationVoice: the director's script was refused (${performed.rejection}); performing the plain narration instead`);
  }
  return performed;
}

/**
 * Both steps: the performed transcript and its WAV. Throws only when the
 * TTS call itself fails (an `AiServiceError` from the service).
 */
export async function performNarration(
  ai: GeminiClient,
  narration: string,
  isMockMode: boolean,
  narrator: NarratorProfile = LAMPLIGHT_NARRATOR,
): Promise<NarrationPerformance> {
  const performed = await directNarrationPerformance(ai, narration, isMockMode, narrator);
  if (isMockMode) {
    return { ...performed, wav: pcmToWav(synthesizeMockTone(), MOCK_TONE_MIME_TYPE) };
  }
  const speech = await generateSpeech(ai, {
    callName: 'narrationVoice',
    model: narrator.voice.model,
    prompt: buildNarrationTtsPrompt(performed.transcript, narrator),
    voiceName: narrator.voice.voiceName,
    temperature: narrator.voice.temperature,
  });
  return { ...performed, wav: ensureWav(speech.pcm, speech.mimeType) };
}
