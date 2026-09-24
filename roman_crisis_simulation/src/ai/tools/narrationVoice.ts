/**
 * ai/tools/narrationVoice.ts
 *
 * "Hear it performed": one committed, player-visible GM narration in, one
 * playable WAV out. Two model calls, both through ai/core/geminiService.ts:
 *
 *  1. `narrationPerformance` (flash, prose) - the dramatic Roman bard/narrator
 *     recounts and acts out the scene in 1-2 powerful paragraphs full of fervor,
 *     tension, and pizzazz. Its output is validated by
 *     narration/performanceScript.ts; a refused script, or a failed call,
 *     falls back to the plain narration. The voice never fails for want
 *     of a narrator.
 *  2. `narrationVoice` (GEMINI_TTS, audio) - the clean transcript is voiced
 *     directly in the `DEFAULT_NARRATOR_VOICE`; the returned PCM is wrapped
 *     in a WAV header (narration/wav.ts).
 *
 * The caller may only pass text that is already committed to the player's
 * chat (DESIGN_DECISIONS.md D4/D5) - in practice a `messages[]` entry with
 * `sender === 'gm'` (hooks/useNarrationVoice.ts). Nothing else from the
 * game state reaches either call.
 *
 * Mock Mode: like every ai/tools call site, `isMockMode` is checked here,
 * before the service is reached. Both network calls are skipped: the
 * fallback plain narration transcript and a short synthesized tone stand in, so
 * offline play and tests still run the whole decode -> WAV -> playback
 * path.
 */

import {
  DEFAULT_NARRATOR_VOICE,
  GEMINI_FLASH,
  GEMINI_TTS,
  generateSpeech,
  generateText,
  type GeminiClient,
} from '../core/geminiService';
import {
  buildNarrationPerformancePrompt,
  buildNarrationTtsPrompt,
  buildImperialDispatchPrompt,
  NARRATION_PERFORMANCE_TEMPERATURE,
} from '../prompts/narrationPerformance';
import {
  cleanSpokenTranscript,
  performedTranscriptFor,
  speakableText,
  type PerformedTranscript,
} from '../../narration/performanceScript';
import { MOCK_TONE_MIME_TYPE, ensureWav, pcmToWav, synthesizeMockTone } from '../../narration/wav';
import { getNarratorVoice } from '../../persistence/uiPrefs';

/** The owner's reference: temperature 1 for the voice itself. */
export const NARRATION_VOICE_TEMPERATURE = 1;

export interface NarrationPerformance extends PerformedTranscript {
  /** A complete RIFF/WAVE file, ready for a Blob. */
  wav: Uint8Array<ArrayBuffer>;
}

/**
 * Step 1 alone: the director's script, validated, or the fallback. Never
 * throws - a failed director call is just a fallback.
 */
export async function directNarrationPerformance(
  ai: GeminiClient,
  narration: string,
  isMockMode: boolean,
): Promise<PerformedTranscript> {
  if (isMockMode) return performedTranscriptFor(narration, null);

  const { systemInstruction, prompt } = buildNarrationPerformancePrompt(speakableText(narration));
  let directorOutput: string | null = null;
  try {
    directorOutput = await generateText(ai, {
      callName: 'narrationPerformance',
      model: GEMINI_FLASH,
      systemInstruction,
      prompt,
      temperature: NARRATION_PERFORMANCE_TEMPERATURE,
    });
  } catch (error) {
    console.warn('narrationVoice: the director call failed; performing the plain narration instead', error);
  }
  const performed = performedTranscriptFor(narration, directorOutput);
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
  voiceName?: string,
): Promise<NarrationPerformance> {
  const performed = await directNarrationPerformance(ai, narration, isMockMode);
  if (isMockMode) {
    return { ...performed, wav: pcmToWav(synthesizeMockTone(), MOCK_TONE_MIME_TYPE) };
  }
  const resolvedVoice = voiceName || getNarratorVoice() || DEFAULT_NARRATOR_VOICE;
  const speech = await generateSpeech(ai, {
    callName: 'narrationVoice',
    model: GEMINI_TTS,
    prompt: buildNarrationTtsPrompt(performed.transcript),
    voiceName: resolvedVoice,
    temperature: NARRATION_VOICE_TEMPERATURE,
  });
  return { ...performed, wav: ensureWav(speech.pcm, speech.mimeType) };
}

/**
 * Generates a fact-based Imperial Intelligence Dispatch summarizing the state
 * of all tabs in crisp High English or Mid-Atlantic broadcast style.
 */
export async function directImperialDispatch(
  ai: GeminiClient,
  factsSummary: string,
  isMockMode: boolean,
): Promise<PerformedTranscript> {
  if (isMockMode) {
    const fallback = cleanSpokenTranscript(factsSummary.slice(0, 300));
    return { transcript: fallback, usedFallback: true };
  }

  const { systemInstruction, prompt } = buildImperialDispatchPrompt(factsSummary);
  let rawDispatch: string | null = null;
  try {
    rawDispatch = await generateText(ai, {
      callName: 'imperialDispatch',
      model: GEMINI_FLASH,
      systemInstruction,
      prompt,
      temperature: 0.5,
    });
  } catch (error) {
    console.warn('imperialDispatch: dispatch generation failed; using fallback summary', error);
  }

  const clean = cleanSpokenTranscript(rawDispatch || factsSummary);
  return { transcript: clean, usedFallback: !rawDispatch };
}

/**
 * Voicing step for the Imperial Dispatch. Uses Sadaltager (or the configured voice)
 * for a crisp, knowledgeable intelligence briefing.
 */
export async function performImperialDispatch(
  ai: GeminiClient,
  factsSummary: string,
  isMockMode: boolean,
  voiceName?: string,
): Promise<NarrationPerformance> {
  const performed = await directImperialDispatch(ai, factsSummary, isMockMode);
  if (isMockMode) {
    return { ...performed, wav: pcmToWav(synthesizeMockTone(), MOCK_TONE_MIME_TYPE) };
  }
  const resolvedVoice = voiceName || 'Sadaltager';
  const speech = await generateSpeech(ai, {
    callName: 'imperialDispatchVoice',
    model: GEMINI_TTS,
    prompt: buildNarrationTtsPrompt(performed.transcript),
    voiceName: resolvedVoice,
    temperature: 0.8,
  });
  return { ...performed, wav: ensureWav(speech.pcm, speech.mimeType) };
}
