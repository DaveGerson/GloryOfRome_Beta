/**
 * narration/tuning/tuneNarrator.tune.ts - `npm run narrator:tune`
 *
 * Runs a narrator profile's prep model over the sample narrations in
 * fixtures.json with a REAL key and writes a report for tuning it. Paid and
 * non-deterministic, so it is never part of `npm test`, `npm run verify` or
 * CI (its own vitest config, its own `*.tune.ts` glob - the eval runner's
 * isolation pattern).
 *
 * Environment:
 *  - GEMINI_API_KEY          required; without it the run skips.
 *  - GOR_NARRATOR            a deployed narrator id, or a path to a profile
 *                            JSON being tuned (default: the built-in).
 *  - GOR_NARRATOR_AUDIO=1    also perform each passage and write .wav files.
 *  - GOR_NARRATOR_FIXTURES   an alternative fixtures JSON path.
 *
 * Output: narration/tuning/out/<narrator-id>/<timestamp>/ (git-ignored):
 * report.md, results.json, and NN.wav when audio is on.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { NARRATORS, narratorById, narratorProfileSchema, type NarratorProfile } from '../narrators';
import { formatTuningReport, runNarratorTuning, summarizeTuning } from './tuneNarrator';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const apiKey = process.env.GEMINI_API_KEY?.trim();

function resolveNarrator(spec: string | undefined): NarratorProfile {
  if (!spec) return narratorById(null);
  if (spec.endsWith('.json')) {
    const parsed = narratorProfileSchema.safeParse(JSON.parse(readFileSync(path.resolve(spec), 'utf8')));
    if (!parsed.success) {
      throw new Error(`${spec} is not a valid narrator profile:\n${parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`);
    }
    return parsed.data;
  }
  const found = NARRATORS.find(n => n.id === spec);
  if (!found) throw new Error(`No deployed narrator '${spec}'. Deployed: ${NARRATORS.map(n => n.id).join(', ')}`);
  return found;
}

describe('narrator tuning', () => {
  it.skipIf(!apiKey)('runs the profile over the sample narrations and writes a report', async () => {
    const narrator = resolveNarrator(process.env.GOR_NARRATOR);
    const fixturesPath = process.env.GOR_NARRATOR_FIXTURES ?? path.join(HERE, 'fixtures.json');
    const { narrations } = JSON.parse(readFileSync(fixturesPath, 'utf8')) as { narrations: string[] };
    const withAudio = process.env.GOR_NARRATOR_AUDIO === '1';

    const ai = new GoogleGenAI({ apiKey: apiKey! });
    const results = await runNarratorTuning({ ai, narrator, narrations, withAudio });
    const summary = summarizeTuning(narrator, results);

    const outDir = path.join(HERE, 'out', narrator.id, new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'report.md'), formatTuningReport(summary, results));
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({
      summary,
      narrator,
      results: results.map(({ audio, ...rest }) => ({
        ...rest,
        audio: audio && ('error' in audio ? audio : { bytes: audio.wav.length, latencyMs: audio.latencyMs }),
      })),
    }, null, 2));
    for (const r of results) {
      if (r.audio && 'wav' in r.audio) {
        writeFileSync(path.join(outDir, `${String(r.index + 1).padStart(2, '0')}.wav`), r.audio.wav);
      }
    }

    console.log(`\nNarrator '${narrator.id}': ${summary.accepted}/${summary.passages} scripts accepted. Report: ${path.relative(process.cwd(), outDir)}/report.md\n`);
    expect(results).toHaveLength(narrations.length);
  });
});
