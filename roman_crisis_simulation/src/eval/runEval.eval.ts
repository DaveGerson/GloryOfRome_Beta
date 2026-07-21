/**
 * eval/runEval.eval.ts
 *
 * The offline eval runner (DESIGN_DECISIONS.md D18): loads a corpus JSON
 * exported from the GM console, runs eval/harness.ts's deterministic
 * checks, and - when an API key is available - scores each turn with the
 * LLM judge (eval/judge.ts). Usage: eval/README.md.
 *
 * Constraints:
 *  - Named `*.eval.ts` ON PURPOSE: the default vitest include glob
 *    (`*.test.ts`) never matches it, so `npm test` neither runs nor slows
 *    on this file. It runs only via `npm run eval`
 *    (vitest.eval.config.ts). Do not rename it to `*.test.ts`.
 *  - The corpus path comes from the GOR_EVAL_CORPUS env var; without it,
 *    everything here skips with a pointer instead of failing.
 *  - The judge runs ONLY when GEMINI_API_KEY is set - a bare
 *    `npm run eval` must stay fully offline.
 *  - Checks report, they don't gate: findings (schema violations, roll
 *    mismatches) are printed for a human to read, not asserted on - the
 *    only failures here are a corpus that can't be loaded at all or a
 *    judge call that errors.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import type { EvalCorpus } from '../persistence/evalCorpus';
import { assertEvalCorpusShape, evaluateCorpus, formatCorpusReport } from './harness';
import { judgeTurn, formatJudgeVerdict, EVAL_JUDGE_API_KEY_ENV } from './judge';

const CORPUS_ENV = 'GOR_EVAL_CORPUS';
const corpusPath = process.env[CORPUS_ENV];
const apiKey = process.env[EVAL_JUDGE_API_KEY_ENV];

function loadCorpus(path: string): EvalCorpus {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  assertEvalCorpusShape(parsed);
  return parsed;
}

describe('eval harness', () => {
  if (!corpusPath) {
    it.skip(`SKIPPED: set ${CORPUS_ENV}=/path/to/gor-eval-corpus-turnN.json (exported from the GM console) to run the eval harness`, () => {});
    return;
  }

  it('deterministic checks over the exported corpus', () => {
    const corpus = loadCorpus(corpusPath);
    const report = evaluateCorpus(corpus);
    console.log(formatCorpusReport(report));
    expect(report.turns.length).toBe(corpus.turns.length);
  });

  if (!apiKey) {
    it.skip(`LLM judge SKIPPED: set ${EVAL_JUDGE_API_KEY_ENV} to score each turn with the judge (deterministic checks above still ran)`, () => {});
  } else {
    it('LLM judge scores each turn', async () => {
      const corpus = loadCorpus(corpusPath);
      // A real GoogleGenAI instance structurally satisfies GeminiClient
      // (see ai/core/geminiService.ts) - the judge call goes through the
      // same gateway, retries, and capture as every app call.
      const ai = new GoogleGenAI({ apiKey });
      for (const turn of corpus.turns) {
        const verdict = await judgeTurn(ai, turn);
        console.log(formatJudgeVerdict(turn.turnNumber, verdict));
      }
    });
  }
});
