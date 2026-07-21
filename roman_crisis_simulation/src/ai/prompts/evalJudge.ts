/**
 * ai/prompts/evalJudge.ts
 *
 * PURPOSE: The offline eval judge (DESIGN_DECISIONS.md D18) - scores ONE
 * exported corpus turn (persistence/evalCorpus.ts) on four fixed axes:
 * consequence-density, sim-state consistency, schema validity, and
 * information-asymmetry discipline (did anything reach a player-facing
 * surface its viewer could not know). Advisory tuning signal only: the
 * judge is itself unvalidated, so its scores gate nothing.
 * MODEL: flash (GEMINI_FLASH) - cheap enough to run over a whole corpus.
 * CONSUMER: eval/judge.ts::judgeTurn, from the offline runner
 * (eval/runEval.eval.ts) ONLY - this call family is never made from app
 * code and never runs inside the normal test suite.
 * OUTPUT: validated against `zEvalJudgeVerdict` (ai/core/zodSchemas.ts) /
 * `EvalJudgeVerdictSchema` (ai/core/schemas.ts).
 *
 * The judge sees GM-private ground truth (gm_private, the mortality trace)
 * BY DESIGN - that is what lets it check the information-asymmetry axis.
 * Its input and output are eval-side tooling data under the same rule as
 * the corpus itself: never rendered on a player-facing surface (D4/D5).
 */

import { Adjudication, MortalityEvent } from '../../types';

export interface EvalJudgePromptInput {
  turnNumber: number;
  playerIntent: string;
  /** The turn's full (mortality-transformed) adjudication, gm_private included. */
  adjudication: Adjudication;
  /** The player-facing narration for the turn, or null when the corpus captured none. */
  narration: string | null;
  /** GM-private mortality trace for the turn, when any death claim was processed. */
  mortalityTrace?: MortalityEvent[] | null;
}

const EVAL_JUDGE_SYSTEM_INSTRUCTION = `
ROLE: Simulation Turn Judge.
You evaluate ONE recorded turn of a political simulation game after the fact. You are not playing the game and you change nothing - you only score the turn's captured output.

You are given the player's action, the turn's structured adjudication (including GM-private data the player must never see), and the player-facing surfaces (narration and headlines).

TASK: Score the turn on EXACTLY these four axes, each as an integer from 1 (worst) to 5 (best) with a short rationale citing specifics from the turn:
1. 'consequence_density': consequence-density - how much real, concrete consequence the turn's output carries.
2. 'sim_state_consistency': sim-state consistency - whether the turn's output is consistent with the simulation state it was given.
3. 'schema_validity': schema validity - whether the structured output is well-formed and uses its fields as intended.
4. 'information_asymmetry': information-asymmetry discipline - whether anything reached a player-facing surface (narration, headlines) that its viewer could not know (GM-private notes, secret truths, hidden rolls).

OUTPUT: A single JSON object with exactly those four keys, each an object of the form {"score": <integer 1-5>, "rationale": "<short justification>"}. Do not include any explanatory text or markdown.
`;

/** Builds the { systemInstruction, prompt } pair for the offline eval judge call. */
export function buildEvalJudgePrompt(input: EvalJudgePromptInput): { systemInstruction: string; prompt: string } {
  const { turnNumber, playerIntent, adjudication, narration, mortalityTrace } = input;

  const prompt = `
TURN UNDER REVIEW: ${turnNumber}

PLAYER'S ACTION THIS TURN:
"${playerIntent}"

PLAYER-FACING NARRATION:
${narration ?? '(none captured)'}

PLAYER-FACING HEADLINES:
${adjudication.headlines.length > 0 ? adjudication.headlines.map(h => `- ${h}`).join('\n') : '(none)'}

FULL ADJUDICATION (GM-side structured output, gm_private included - the player never sees this object):
${JSON.stringify(adjudication, null, 2)}

GM-PRIVATE MORTALITY TRACE:
${mortalityTrace && mortalityTrace.length > 0 ? JSON.stringify(mortalityTrace, null, 2) : '(no death claims this turn)'}
`;

  return { systemInstruction: EVAL_JUDGE_SYSTEM_INSTRUCTION, prompt };
}
