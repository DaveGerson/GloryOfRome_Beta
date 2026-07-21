/**
 * eval/judge.ts
 *
 * LLM judge over exported corpus turns (DESIGN_DECISIONS.md D18) - the
 * model-scored complement to eval/harness.ts's deterministic checks.
 *
 * Constraints:
 *  - Every model call goes through ai/core/geminiService.ts, the app-wide
 *    gateway - nothing here touches the SDK directly. The prompt lives in
 *    ai/prompts/evalJudge.ts; the response schema pair lives in
 *    ai/core/schemas.ts + ai/core/zodSchemas.ts.
 *  - Offline tooling only: never imported from app code, and never invoked
 *    against a live API from the normal test suite. The runner
 *    (eval/runEval.eval.ts) invokes it only when `EVAL_JUDGE_API_KEY_ENV`
 *    is set; tests exercise it exclusively through a mock client.
 *  - Advisory only: the judge is itself unvalidated, so its scores are
 *    tuning signal for a human, never a gate.
 */

import type { EvalCorpusTurn } from '../persistence/evalCorpus';
import { GeminiClient, generateStructured, GEMINI_FLASH } from '../ai/core/geminiService';
import { buildEvalJudgePrompt } from '../ai/prompts/evalJudge';
import { EvalJudgeVerdictSchema } from '../ai/core/schemas';
import { zEvalJudgeVerdict } from '../ai/core/zodSchemas';

/** The env var whose presence authorizes the runner to invoke the judge (same key the app itself uses). */
export const EVAL_JUDGE_API_KEY_ENV = 'GEMINI_API_KEY';

/** Mirrors `zEvalJudgeAxisScore` (ai/core/zodSchemas.ts). */
export interface EvalJudgeAxisScore {
  score: number;
  rationale: string;
}

/** Mirrors `zEvalJudgeVerdict` (ai/core/zodSchemas.ts) - keep the two in sync. */
export interface EvalJudgeVerdict {
  consequence_density: EvalJudgeAxisScore;
  sim_state_consistency: EvalJudgeAxisScore;
  schema_validity: EvalJudgeAxisScore;
  information_asymmetry: EvalJudgeAxisScore;
  /** The 4C richness axis (D10/D16): continuity of self over plot convenience. */
  character_richness: EvalJudgeAxisScore;
}

/** Scores one corpus turn on the five fixed axes - see ai/prompts/evalJudge.ts. */
export async function judgeTurn(ai: GeminiClient, turn: EvalCorpusTurn): Promise<EvalJudgeVerdict> {
  const { systemInstruction, prompt } = buildEvalJudgePrompt({
    turnNumber: turn.turnNumber,
    playerIntent: turn.playerIntent,
    adjudication: turn.adjudication,
    narration: turn.narration,
    mortalityTrace: turn.mortalityTrace,
  });

  return generateStructured<EvalJudgeVerdict>(ai, {
    callName: 'evalJudge',
    model: GEMINI_FLASH,
    systemInstruction,
    prompt,
    responseSchema: EvalJudgeVerdictSchema,
    zodSchema: zEvalJudgeVerdict,
  });
}

/** Formats one turn's verdict for terminal output. */
export function formatJudgeVerdict(turnNumber: number, verdict: EvalJudgeVerdict): string {
  const line = (label: string, axis: EvalJudgeAxisScore) => `  ${label}: ${axis.score}/5 - ${axis.rationale}`;
  return [
    `Turn ${turnNumber} judge verdict:`,
    line('consequence-density', verdict.consequence_density),
    line('sim-state consistency', verdict.sim_state_consistency),
    line('schema validity', verdict.schema_validity),
    line('information-asymmetry discipline', verdict.information_asymmetry),
    line('character richness', verdict.character_richness),
  ].join('\n');
}
