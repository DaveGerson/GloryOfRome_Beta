/**
 * narration/tuning/tuneNarrator.ts
 *
 * The narrator tuning harness's core: run one narrator profile's prep model
 * (and, optionally, its voice) over a set of sample narrations, and report
 * how the narrator behaved - how often the guard accepted its retelling
 * (narration/performanceScript.ts: length, fidelity - no new names or
 * figures - and the mechanics gate), which sentences the fidelity patch
 * cut from the ones it accepted, why it refused the rest, how long the
 * retellings run against their source, how many performance cues each
 * script carries, and the acted scripts themselves, cues included - with,
 * optionally, a sample voice cast whose notes reach the prompt's cast block
 * for the characters a passage names - so
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
import { cuesIn, findIntroducedContent, performedTranscriptFor, spokenTokens, type PerformanceRejection } from '../performanceScript';
import { ensureWav } from '../wav';
import type { VoiceStyle } from '../voiceStyle';
import type { CastManner } from '../voiceCast';

export interface TuningPassageResult {
  index: number;
  narration: string;
  /** The guard accepted the director's script: as written, or patched (see `patchedOut`). */
  accepted: boolean;
  /** Sentences the fidelity patch cut from an accepted script, verbatim. */
  patchedOut: string[];
  /** Why the guard refused it; `director_call_failed` when there was no script at all. */
  rejection?: PerformanceRejection | 'director_call_failed';
  /** The narrator's raw output, verbatim - what to read when tuning. */
  directorOutput: string | null;
  /** What would actually be performed: the accepted acted script (cues included), or the fallback. */
  transcript: string;
  /** Performance cues in `transcript`. */
  cues: number;
  /** For a fidelity refusal or patch: the name(s) or figure(s) the retelling brought in. */
  introduced?: string;
  sourceWords: number;
  /** Spoken words in the narrator's output, cues not counted (0 when there was none). */
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
  /** Accepted only after the fidelity patch cut at least one sentence. */
  patched: number;
  /** Sentences cut across every accepted script. */
  patchedSentences: number;
  acceptanceRate: number;
  rejections: Record<string, number>;
  /** Mean retelling length over its source's, for accepted retellings (1 = same length). */
  meanLengthRatio: number;
  /** Mean performance cues per accepted script. */
  meanCuesPerScript: number;
  meanPrepLatencyMs: number;
}

/** Counts spoken words (not punctuation, not cues) in a text. */
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
  /** A delivery style to audition: it feeds the prep prompt's delivery brief (narration/voiceStyle.ts), never the TTS input. None by default. */
  style?: VoiceStyle | null;
  /** A sample voice cast (fixtures.json `cast`): the notes of those a passage names reach its prep prompt's cast block. None by default. */
  cast?: readonly CastManner[] | null;
  /** Injectable clock for tests. */
  now?: () => number;
}): Promise<TuningPassageResult[]> {
  const { ai, narrator, narrations, playerContext, withAudio = false, voiceName, style = null, cast = null, now = () => performance.now() } = params;
  const allowed = listenerNames(playerContext);
  const results: TuningPassageResult[] = [];
  // Sequential on purpose: tuning is a quality read, and one call at a time
  // keeps the run inside a free-tier rate limit.
  for (const [index, narration] of narrations.entries()) {
    const started = now();
    const { output } = await runNarrationDirector(ai, narration, narrator, playerContext, style, cast);
    const prepLatencyMs = now() - started;
    const performed = performedTranscriptFor(narration, output, allowed);
    const result: TuningPassageResult = {
      index,
      narration,
      accepted: output !== null && !performed.usedFallback,
      patchedOut: performed.patchedOut,
      directorOutput: output,
      transcript: performed.transcript,
      cues: cuesIn(performed.transcript).length,
      sourceWords: countWords(narration),
      retellingWords: output === null ? 0 : countWords(output),
      prepLatencyMs,
    };
    if (output === null) result.rejection = 'director_call_failed';
    else if (performed.rejection) result.rejection = performed.rejection;
    if (output !== null && (performed.rejection === 'introduces_new_name' || performed.rejection === 'introduces_new_number')) {
      result.introduced = findIntroducedContent(narration, output, allowed)?.value;
    }
    if (performed.patchedOut.length > 0) {
      result.introduced = performed.patchedOut
        .map(sentence => findIntroducedContent(narration, sentence, allowed)?.value)
        .filter(Boolean)
        .join(', ');
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
    patched: accepted.filter(r => r.patchedOut.length > 0).length,
    patchedSentences: accepted.reduce((n, r) => n + r.patchedOut.length, 0),
    acceptanceRate: results.length ? accepted.length / results.length : 0,
    rejections,
    meanLengthRatio: mean(accepted.filter(r => r.sourceWords > 0).map(r => r.retellingWords / r.sourceWords)),
    meanCuesPerScript: mean(accepted.map(r => r.cues)),
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
    `Patched: ${summary.patched} (${summary.patchedSentences} sentence${summary.patchedSentences === 1 ? '' : 's'} cut for bringing in a name or figure)`,
    `Mean retelling length: ${summary.meanLengthRatio.toFixed(1)}× its source`,
    `Mean performance cues per accepted script: ${summary.meanCuesPerScript.toFixed(1)}`,
    `Mean prep latency: ${Math.round(summary.meanPrepLatencyMs)} ms`,
    '',
    '## Refusals',
    ...(rejectionLines.length ? rejectionLines : ['- none']),
    '',
    '## Passages',
  ];
  for (const r of results) {
    const verdict = r.accepted
      ? (r.patchedOut.length > 0 ? `accepted, patched (${r.patchedOut.length} cut: "${r.introduced}")` : 'accepted')
      : `refused (${r.rejection}${r.introduced ? `: "${r.introduced}"` : ''})`;
    lines.push('', `### ${r.index + 1}. ${verdict} — ${r.retellingWords} words from ${r.sourceWords}, ${r.cues} cue${r.cues === 1 ? '' : 's'}`, '');
    lines.push('Source:', '', '```', r.narration, '```', '', 'Narrator output:', '', '```', r.directorOutput ?? '(no output)', '```');
    if (r.patchedOut.length > 0) {
      lines.push('', 'Patched out:', '', ...r.patchedOut.map(sentence => `- ${sentence}`), '', 'Performed script:', '', '```', r.transcript, '```');
    } else if (r.accepted) {
      lines.push('', 'Performed script:', '', '```', r.transcript, '```');
    }
    if (!r.accepted) lines.push('', 'Voiced instead:', '', '```', r.transcript, '```');
    if (r.audio) {
      lines.push('', 'error' in r.audio ? `Audio failed: ${r.audio.error}` : `Audio: ${r.audio.wav.length} bytes in ${Math.round(r.audio.latencyMs)} ms`);
    }
  }
  return `${lines.join('\n')}\n`;
}
