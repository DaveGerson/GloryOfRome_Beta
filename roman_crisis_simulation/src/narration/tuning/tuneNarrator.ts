/**
 * narration/tuning/tuneNarrator.ts
 *
 * The narrator tuning harness's core: run one narrator profile's prep model
 * (and, optionally, its voice) over a set of sample narrations, and report
 * how the narrator behaved - how often the guard accepted its retelling
 * (narration/performanceScript.ts: length, fidelity - no new names or
 * figures - and the mechanics gate), why it refused the rest, how long the
 * retellings run against their source, and the retellings themselves - so
 * the profile's persona, temperature, thinking level or prep model can be
 * tuned before the profile is deployed (narration/narrators/README.md).
 *
 * Pure of I/O: the runner (narration/tuning/tuneNarrator.tune.ts,
 * `npm run narrator:tune`) supplies the client and writes the files, and
 * tests/narrators.test.ts drives this with a fake client.
 */

import type { GeminiClient } from '../../ai/core/geminiService';
import { generateSpeech } from '../../ai/core/geminiService';
import { buildNarrationTtsPrompt, type NarrationPlayerContext } from '../../ai/prompts/narrationPerformance';
import { listenerNames, runNarrationDirector } from '../../ai/tools/narrationVoice';
import type { NarratorProfile } from '../narrators';
import { findIntroducedContent, performedTranscriptFor, spokenTokens, type PerformanceRejection } from '../performanceScript';
import { ensureWav } from '../wav';

export interface TuningPassageResult {
  index: number;
  narration: string;
  /** The guard accepted the director's script as written. */
  accepted: boolean;
  /** Why the guard refused it; `director_call_failed` when there was no script at all. */
  rejection?: PerformanceRejection | 'director_call_failed';
  /** The narrator's raw output, verbatim - what to read when tuning. */
  directorOutput: string | null;
  /** What would actually be voiced: the accepted retelling, or the fallback. */
  transcript: string;
  /** For a fidelity refusal: the name or figure the retelling brought in. */
  introduced?: string;
  sourceWords: number;
  /** Words in the narrator's output (0 when there was none). */
  retellingWords: number;
  prepLatencyMs: number;
  /** Present when audio was rendered. */
  audio?: { wav: Uint8Array<ArrayBuffer>; latencyMs: number } | { error: string };
}

export interface TuningSummary {
  narratorId: string;
  prepModel: string;
  thinkingLevel: string;
  passages: number;
  accepted: number;
  acceptanceRate: number;
  rejections: Record<string, number>;
  /** Mean retelling length over its source's, for accepted retellings (1 = same length). */
  meanLengthRatio: number;
  meanPrepLatencyMs: number;
}

/** Counts spoken words (not punctuation) in a text. */
export function countWords(text: string): number {
  return spokenTokens(text).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

export async function runNarratorTuning(params: {
  ai: GeminiClient;
  narrator: NarratorProfile;
  narrations: readonly string[];
  /** The listener the retellings address (a sample player). */
  playerContext?: NarrationPlayerContext;
  /** Also perform each transcript - in `voiceName`, or the profile's own voice. */
  withAudio?: boolean;
  voiceName?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}): Promise<TuningPassageResult[]> {
  const { ai, narrator, narrations, playerContext, withAudio = false, voiceName, now = () => performance.now() } = params;
  const allowed = listenerNames(playerContext);
  const results: TuningPassageResult[] = [];
  // Sequential on purpose: tuning is a quality read, and one call at a time
  // keeps the run inside a free-tier rate limit.
  for (const [index, narration] of narrations.entries()) {
    const started = now();
    const { output } = await runNarrationDirector(ai, narration, narrator, playerContext);
    const prepLatencyMs = now() - started;
    const performed = performedTranscriptFor(narration, output, allowed);
    const result: TuningPassageResult = {
      index,
      narration,
      accepted: output !== null && !performed.usedFallback,
      directorOutput: output,
      transcript: performed.transcript,
      sourceWords: countWords(narration),
      retellingWords: output === null ? 0 : countWords(output),
      prepLatencyMs,
    };
    if (output === null) result.rejection = 'director_call_failed';
    else if (performed.rejection) result.rejection = performed.rejection;
    if (output !== null && (performed.rejection === 'introduces_new_name' || performed.rejection === 'introduces_new_number')) {
      result.introduced = findIntroducedContent(narration, output, allowed)?.value;
    }

    if (withAudio) {
      const voiceStarted = now();
      try {
        const speech = await generateSpeech(ai, {
          callName: 'narratorTuning',
          model: narrator.voice.model,
          prompt: buildNarrationTtsPrompt(performed.transcript),
          voiceName: voiceName || narrator.voice.voiceName,
          temperature: narrator.voice.temperature,
        });
        result.audio = { wav: ensureWav(speech.pcm, speech.mimeType), latencyMs: now() - voiceStarted };
      } catch (error) {
        result.audio = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    results.push(result);
  }
  return results;
}

export function summarizeTuning(narrator: NarratorProfile, results: readonly TuningPassageResult[]): TuningSummary {
  const accepted = results.filter(r => r.accepted);
  const rejections: Record<string, number> = {};
  for (const r of results) {
    if (r.rejection) rejections[r.rejection] = (rejections[r.rejection] ?? 0) + 1;
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    narratorId: narrator.id,
    prepModel: narrator.prep.model,
    thinkingLevel: narrator.prep.thinkingLevel,
    passages: results.length,
    accepted: accepted.length,
    acceptanceRate: results.length ? accepted.length / results.length : 0,
    rejections,
    meanLengthRatio: mean(accepted.filter(r => r.sourceWords > 0).map(r => r.retellingWords / r.sourceWords)),
    meanPrepLatencyMs: mean(results.map(r => r.prepLatencyMs)),
  };
}

/** A human-readable report: the summary, then every passage with its script. */
export function formatTuningReport(summary: TuningSummary, results: readonly TuningPassageResult[]): string {
  const pct = (summary.acceptanceRate * 100).toFixed(0);
  const rejectionLines = Object.entries(summary.rejections)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, n]) => `- ${reason}: ${n}`);
  const lines = [
    `# Narrator tuning — ${summary.narratorId}`,
    '',
    `Prep model: \`${summary.prepModel}\` (thinking: ${summary.thinkingLevel})`,
    `Accepted: ${summary.accepted}/${summary.passages} (${pct}%)`,
    `Mean retelling length: ${summary.meanLengthRatio.toFixed(1)}× its source`,
    `Mean prep latency: ${Math.round(summary.meanPrepLatencyMs)} ms`,
    '',
    '## Refusals',
    ...(rejectionLines.length ? rejectionLines : ['- none']),
    '',
    '## Passages',
  ];
  for (const r of results) {
    const verdict = r.accepted ? 'accepted' : `refused (${r.rejection}${r.introduced ? `: "${r.introduced}"` : ''})`;
    lines.push('', `### ${r.index + 1}. ${verdict} — ${r.retellingWords} words from ${r.sourceWords}`, '');
    lines.push('Source:', '', '```', r.narration, '```', '', 'Narrator output:', '', '```', r.directorOutput ?? '(no output)', '```');
    if (!r.accepted) lines.push('', 'Voiced instead:', '', '```', r.transcript, '```');
    if (r.audio) {
      lines.push('', 'error' in r.audio ? `Audio failed: ${r.audio.error}` : `Audio: ${r.audio.wav.length} bytes in ${Math.round(r.audio.latencyMs)} ms`);
    }
  }
  return `${lines.join('\n')}\n`;
}
