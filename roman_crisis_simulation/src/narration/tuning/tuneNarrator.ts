/**
 * narration/tuning/tuneNarrator.ts
 *
 * The narrator tuning harness's core: run one narrator profile's prep model
 * (and, optionally, its voice) over a set of sample narrations, and report
 * how the director behaved - how often the word-for-word guard accepted its
 * script, why it refused the rest, and the scripts themselves - so the
 * profile's `directorNotes`, temperature, thinking level or prep model can
 * be tuned before the profile is deployed (narration/narrators/README.md).
 *
 * Pure of I/O: the runner (narration/tuning/tuneNarrator.tune.ts,
 * `npm run narrator:tune`) supplies the client and writes the files, and
 * tests/narrators.test.ts drives this with a fake client.
 */

import type { GeminiClient } from '../../ai/core/geminiService';
import { generateSpeech } from '../../ai/core/geminiService';
import { buildNarrationTtsPrompt } from '../../ai/prompts/narrationPerformance';
import { runNarrationDirector } from '../../ai/tools/narrationVoice';
import type { NarratorProfile } from '../narrators';
import { performedTranscriptFor, type PerformanceRejection } from '../performanceScript';
import { ensureWav } from '../wav';

export interface TuningPassageResult {
  index: number;
  narration: string;
  /** The guard accepted the director's script as written. */
  accepted: boolean;
  /** Why the guard refused it; `director_call_failed` when there was no script at all. */
  rejection?: PerformanceRejection | 'director_call_failed';
  /** The director's raw output, verbatim - what to read when tuning. */
  directorOutput: string | null;
  /** What would actually be voiced: the accepted script, or the fallback. */
  transcript: string;
  directions: number;
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
  meanDirectionsPerAcceptedScript: number;
  meanPrepLatencyMs: number;
}

/** Counts `<...>` directions in a transcript. */
export function countDirections(transcript: string): number {
  return (transcript.match(/<[^<>]+>/g) ?? []).length;
}

export async function runNarratorTuning(params: {
  ai: GeminiClient;
  narrator: NarratorProfile;
  narrations: readonly string[];
  /** Also perform each transcript with the profile's voice. */
  withAudio?: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}): Promise<TuningPassageResult[]> {
  const { ai, narrator, narrations, withAudio = false, now = () => performance.now() } = params;
  const results: TuningPassageResult[] = [];
  // Sequential on purpose: tuning is a quality read, and one call at a time
  // keeps the run inside a free-tier rate limit.
  for (const [index, narration] of narrations.entries()) {
    const started = now();
    const { output } = await runNarrationDirector(ai, narration, narrator);
    const prepLatencyMs = now() - started;
    const performed = performedTranscriptFor(narration, output);
    const result: TuningPassageResult = {
      index,
      narration,
      accepted: output !== null && !performed.usedFallback,
      directorOutput: output,
      transcript: performed.transcript,
      directions: countDirections(performed.transcript),
      prepLatencyMs,
    };
    if (output === null) result.rejection = 'director_call_failed';
    else if (performed.rejection) result.rejection = performed.rejection;

    if (withAudio) {
      const voiceStarted = now();
      try {
        const speech = await generateSpeech(ai, {
          callName: 'narratorTuning',
          model: narrator.voice.model,
          prompt: buildNarrationTtsPrompt(performed.transcript, narrator),
          voiceName: narrator.voice.voiceName,
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
    meanDirectionsPerAcceptedScript: mean(accepted.map(r => r.directions)),
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
    `Mean directions per accepted script: ${summary.meanDirectionsPerAcceptedScript.toFixed(1)}`,
    `Mean prep latency: ${Math.round(summary.meanPrepLatencyMs)} ms`,
    '',
    '## Refusals',
    ...(rejectionLines.length ? rejectionLines : ['- none']),
    '',
    '## Passages',
  ];
  for (const r of results) {
    lines.push('', `### ${r.index + 1}. ${r.accepted ? 'accepted' : `refused (${r.rejection})`}`, '');
    lines.push('Director output:', '', '```', r.directorOutput ?? '(no output)', '```');
    if (!r.accepted) lines.push('', 'Voiced instead:', '', '```', r.transcript, '```');
    if (r.audio) {
      lines.push('', 'error' in r.audio ? `Audio failed: ${r.audio.error}` : `Audio: ${r.audio.wav.length} bytes in ${Math.round(r.audio.latencyMs)} ms`);
    }
  }
  return `${lines.join('\n')}\n`;
}
