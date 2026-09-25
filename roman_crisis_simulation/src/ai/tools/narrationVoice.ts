/**
 * ai/tools/narrationVoice.ts
 *
 * "Hear it performed": one committed, player-visible GM narration in, one
 * playable WAV out. Two model calls, both through ai/core/geminiService.ts:
 *
 *  1. `narrationPerformance` (the intermediary prep model, prose) - the
 *     chosen narrator (narration/narrators.ts; by default the senatorial
 *     partner) recounts the scene to the player in at most two paragraphs of
 *     clean spoken prose. By default this is `GEMINI_NARRATION_PREP` at LOW
 *     thinking; a deployed profile may name its own, tuned, prep model. The
 *     output is validated by narration/performanceScript.ts - including the
 *     fidelity check, which cuts every sentence that brings in a name or a
 *     figure the narration never mentioned (and falls back when that would
 *     cut most of it); a refused script, or a failed call, falls back to
 *     the plain narration. The voice never fails for want of
 *     a narrator.
 *  2. `narrationVoice` (the profile's TTS model, audio) - the clean
 *     transcript is voiced in the player's chosen voice, or else the
 *     narrator's own; raw PCM is wrapped in a WAV header (narration/wav.ts).
 *
 * The caller may only pass text that is already committed to the player's
 * chat (DESIGN_DECISIONS.md D4/D5) - in practice a `messages[]` entry with
 * `sender === 'gm'` (hooks/useNarrationVoice.ts) - plus, optionally, the
 * player's own name and position. Nothing else from the game state reaches
 * either call.
 *
 * The Imperial Dispatch (`performImperialDispatch`) shares the plumbing: its
 * scriptwriter runs on the same prep model and thinking level.
 *
 * Mock Mode: like every ai/tools call site, `isMockMode` is checked here,
 * before the service is reached. Both network calls are skipped: the
 * fallback plain narration transcript and a short synthesized tone stand
 * in, so offline play and tests still run the whole decode -> WAV ->
 * playback path.
 */

import {
  GEMINI_NARRATION_PREP,
  GEMINI_TTS,
  NARRATION_PREP_THINKING_LEVEL,
  generateSpeech,
  generateText,
  type GeminiClient,
  type ThinkingConfigLike,
} from '../core/geminiService';
import {
  buildNarrationPerformancePrompt,
  buildNarrationTtsPrompt,
  buildImperialDispatchPrompt,
  type NarrationPlayerContext,
} from '../prompts/narrationPerformance';
import {
  cleanSpokenTranscript,
  performedTranscriptFor,
  speakableText,
  type PerformedTranscript,
} from '../../narration/performanceScript';
import { MOCK_TONE_MIME_TYPE, ensureWav, pcmToWav, synthesizeMockTone } from '../../narration/wav';
import { DRAMATIC_READER_NARRATOR, type NarratorProfile } from '../../narration/narrators';
import { getNarratorVoiceChoice } from '../../persistence/uiPrefs';

/** The owner's reference: temperature 1 for the voice itself. */
export const NARRATION_VOICE_TEMPERATURE = DRAMATIC_READER_NARRATOR.voice.temperature;

export interface NarrationPerformance extends PerformedTranscript {
  /** A complete RIFF/WAVE file, ready for a Blob. */
  wav: Uint8Array<ArrayBuffer>;
}

export interface NarrationOptions {
  /** Who narrates; defaults to the built-in senatorial partner. */
  narrator?: NarratorProfile;
  /** An explicit voice; otherwise the player's Settings choice, otherwise the narrator's own. */
  voiceName?: string;
  /** The listener's name and position, for address - never game state. */
  playerContext?: NarrationPlayerContext;
}

/** The SDK's ThinkingLevel enum is upper-case ('LOW'); profiles are authored lower-case. */
function thinkingConfigFor(level: string): ThinkingConfigLike {
  return { thinkingLevel: level.toUpperCase() };
}

/** The listener's own words the fidelity check lets the narrator use: name and position. */
export function listenerNames(playerContext: NarrationPlayerContext): string[] {
  if (typeof playerContext === 'string') return [playerContext];
  if (playerContext && typeof playerContext === 'object') {
    return [playerContext.name, playerContext.position].filter((part): part is string => Boolean(part));
  }
  return [];
}

/**
 * The prep model's raw answer for one narration, unvalidated - or the error
 * that stopped it. Shared by the game path below and the tuning harness
 * (narration/tuning/), which reports refused scripts verbatim so a
 * narrator's persona can be tuned against them.
 */
export async function runNarrationDirector(
  ai: GeminiClient,
  narration: string,
  narrator: NarratorProfile = DRAMATIC_READER_NARRATOR,
  playerContext?: NarrationPlayerContext,
): Promise<{ output: string | null; error?: unknown }> {
  const { systemInstruction, prompt } = buildNarrationPerformancePrompt(speakableText(narration), playerContext, narrator);
  try {
    const output = await generateText(ai, {
      callName: 'narrationPerformance',
      model: narrator.prep.model,
      systemInstruction,
      prompt,
      thinkingConfig: thinkingConfigFor(narrator.prep.thinkingLevel),
      temperature: narrator.prep.temperature,
    });
    return { output };
  } catch (error) {
    return { output: null, error };
  }
}

/**
 * Step 1 alone: the narrator's script, validated, or the fallback. Never
 * throws - a failed narrator call is just a fallback.
 */
export async function directNarrationPerformance(
  ai: GeminiClient,
  narration: string,
  isMockMode: boolean,
  playerContext?: NarrationPlayerContext,
  narrator: NarratorProfile = DRAMATIC_READER_NARRATOR,
): Promise<PerformedTranscript> {
  if (isMockMode) return performedTranscriptFor(narration, null);

  const { output, error } = await runNarrationDirector(ai, narration, narrator, playerContext);
  if (error !== undefined) {
    console.warn('narrationVoice: the narrator call failed; performing the plain narration instead', error);
  }
  const performed = performedTranscriptFor(narration, output, listenerNames(playerContext));
  if (performed.rejection) {
    console.warn(`narrationVoice: the narrator's script was refused (${performed.rejection}); performing the plain narration instead`);
  } else if (performed.patchedOut.length > 0) {
    console.warn(`narrationVoice: cut ${performed.patchedOut.length} sentence(s) the narration did not support; performing the rest`);
  }
  return performed;
}

/** The voice a performance uses: explicit, then the player's Settings choice, then the narrator's own. */
export function resolveNarrationVoice(narrator: NarratorProfile, explicit?: string | null): string {
  return explicit || getNarratorVoiceChoice() || narrator.voice.voiceName;
}

/**
 * Both steps: the performed transcript and its WAV. Throws only when the
 * TTS call itself fails (an `AiServiceError` from the service).
 */
export async function performNarration(
  ai: GeminiClient,
  narration: string,
  isMockMode: boolean,
  options: NarrationOptions = {},
): Promise<NarrationPerformance> {
  const narrator = options.narrator ?? DRAMATIC_READER_NARRATOR;
  const performed = await directNarrationPerformance(ai, narration, isMockMode, options.playerContext, narrator);
  if (isMockMode) {
    return { ...performed, wav: pcmToWav(synthesizeMockTone(), MOCK_TONE_MIME_TYPE) };
  }
  const speech = await generateSpeech(ai, {
    callName: 'narrationVoice',
    model: narrator.voice.model,
    prompt: buildNarrationTtsPrompt(performed.transcript),
    voiceName: resolveNarrationVoice(narrator, options.voiceName),
    temperature: narrator.voice.temperature,
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
    return { transcript: fallback, usedFallback: true, patchedOut: [] };
  }

  const { systemInstruction, prompt } = buildImperialDispatchPrompt(factsSummary);
  let rawDispatch: string | null = null;
  try {
    rawDispatch = await generateText(ai, {
      callName: 'imperialDispatch',
      model: GEMINI_NARRATION_PREP,
      systemInstruction,
      prompt,
      thinkingConfig: thinkingConfigFor(NARRATION_PREP_THINKING_LEVEL),
      temperature: 0.5,
    });
  } catch (error) {
    console.warn('imperialDispatch: dispatch generation failed; using fallback summary', error);
  }

  const clean = cleanSpokenTranscript(rawDispatch || factsSummary);
  return { transcript: clean, usedFallback: !rawDispatch, patchedOut: [] };
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
