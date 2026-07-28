/**
 * ai/prompts/evalJudge.ts
 *
 * PURPOSE: The offline eval judge (DESIGN_DECISIONS.md D18) - scores ONE
 * exported corpus turn (persistence/evalCorpus.ts) on five fixed axes:
 * consequence-density, sim-state consistency, schema validity,
 * information-asymmetry discipline (did anything reach a player-facing
 * surface its viewer could not know), and character richness (the 4C
 * richness axis, D10/D16: do NPC actions read as continuity of self rather
 * than plot convenience). Advisory tuning signal only: the judge is itself
 * unvalidated, so its scores gate nothing.
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

import { Adjudication, MortalityEvent, NpcIntent, NpcMindDecision } from '../../types';
import { asPromptData } from './fragments';

export interface EvalJudgePromptInput {
  turnNumber: number;
  playerIntent: string;
  /** The turn's full (mortality-transformed) adjudication, gm_private included. */
  adjudication: Adjudication;
  /** The player-facing narration for the turn, or null when the corpus captured none. */
  narration: string | null;
  /** GM-private mortality trace for the turn, when any death claim was processed. */
  mortalityTrace?: MortalityEvent[] | null;
  /**
   * GM-private Director intents committed this turn - what axis 4 checks for
   * out-of-vantage knowledge (an intent is handed to the character's mind as
   * its own thought) and axis 5 checks NPC moves against. Absent/null when
   * the turn named no spotlight intents.
   */
  npcIntents?: NpcIntent[] | null;
  /**
   * GM-private per-spotlight mind decisions this turn, `private_reasoning`
   * included - the first-person reasoning axes 4 and 5 score against. Absent/
   * null when no mind-eligible spotlight ran this turn.
   */
  npcMindResults?: NpcMindDecision[] | null;
}

const EVAL_JUDGE_SYSTEM_INSTRUCTION = `
ROLE: Simulation Turn Judge.
You evaluate ONE recorded turn of a political simulation game after the fact. You are not playing the game and you change nothing - you only score the turn's captured output.

You are given the player's action, the turn's structured adjudication (including GM-private data the player must never see), and the player-facing surfaces (narration and headlines).

TASK: Score the turn on EXACTLY these five axes, each as an integer from 1 (worst) to 5 (best) with a short rationale citing specifics from the turn:
1. 'consequence_density': consequence-density - how much real, concrete consequence the turn's output carries.
2. 'sim_state_consistency': sim-state consistency - whether the turn's output is consistent with the simulation state it was given.
3. 'schema_validity': schema validity - whether the structured output is well-formed and uses its fields as intended.
4. 'information_asymmetry': information-asymmetry discipline - whether anything reached a player-facing surface (narration, headlines) that its viewer could not know (GM-private notes, secret truths, hidden rolls). Planted-rumor leakage counts here: any player-visible wording that reveals a rumor's truth status or that it was planted is a violation. NPC minds count here too: a mind (any captured npcMind call) acting on knowledge its character could not have - another character's secrets or scheme, GM-private data, events its own vantage never reached - is a violation. Director intents count here too: a Director-authored intent (any captured storyRelevance call's spotlight_intents) that references knowledge its character could not have is a violation - that text is handed to the character's mind verbatim as its own thought.
5. 'character_richness': character richness - whether the turn's NPC actions read as motivated by each character's OWN bounded knowledge, memories, stated intents, and voice: continuity of self rather than plot convenience. Score high when a character's moves follow believably from what THAT character knows, remembers, wants, and how they speak - even when the move is suboptimal; score low when a character acts out of nowhere, contradicts their established motives or memories without cause, sounds interchangeable with any other character, or moves purely because the plot needed it.

OUTPUT: A single JSON object with exactly those five keys, each an object of the form {"score": <integer 1-5>, "rationale": "<short justification>"}. Do not include any explanatory text or markdown.
`;

/**
 * Builds the { systemInstruction, prompt } pair for the offline eval judge
 * call. `playerIntent` reaches here as the corpus's own captured player
 * text; every field below is delimited via `asPromptData` (D2) rather than
 * bare `JSON.stringify` - `playerIntent` in particular was previously
 * interpolated inside bare literal quotes with NO escaping at all, so an
 * embedded quote could break out of the "PLAYER'S ACTION THIS TURN" quoting
 * outright, on top of the usual U+2028/U+2029/U+0085 line-forgery risk. This
 * call is offline eval-harness tooling only (never runs from app code or the
 * normal test suite), so the leverage is low, but it is closed for
 * consistency with every other prompt-text interpolation in this codebase.
 */
export function buildEvalJudgePrompt(input: EvalJudgePromptInput): { systemInstruction: string; prompt: string } {
  const { turnNumber, playerIntent, adjudication, narration, mortalityTrace, npcIntents, npcMindResults } = input;

  const prompt = `
TURN UNDER REVIEW: ${turnNumber}

PLAYER'S ACTION THIS TURN:
${asPromptData(playerIntent)}

PLAYER-FACING NARRATION:
${narration ?? '(none captured)'}

PLAYER-FACING HEADLINES:
${adjudication.headlines.length > 0 ? adjudication.headlines.map(h => `- ${h}`).join('\n') : '(none)'}

FULL ADJUDICATION (GM-side structured output, gm_private included - the player never sees this object):
${asPromptData(adjudication, 2)}

GM-PRIVATE MORTALITY TRACE:
${mortalityTrace && mortalityTrace.length > 0 ? asPromptData(mortalityTrace, 2) : '(no death claims this turn)'}

GM-PRIVATE DIRECTOR INTENTS (each is fed to that character's mind verbatim as its own thought - score axes 4 and 5 against them):
${npcIntents && npcIntents.length > 0 ? asPromptData(npcIntents, 2) : '(no spotlight intents this turn)'}

GM-PRIVATE NPC MIND DECISIONS (each character's own bounded-knowledge decision this turn, private_reasoning included - the substance axes 4 and 5 judge):
${npcMindResults && npcMindResults.length > 0 ? asPromptData(npcMindResults, 2) : '(no NPC minds ran this turn)'}
`;

  return { systemInstruction: EVAL_JUDGE_SYSTEM_INSTRUCTION, prompt };
}
