/**
 * ai/prompts/epilogue.ts
 *
 * PURPOSE: DESIGN_DECISIONS.md D1 - "There is no such thing as winning...
 * the epilogue is the payoff artifact for every run, however it ends."
 * Once (and only once) the player character's status becomes 'dead',
 * `buildEpiloguePrompt` produces a Tacitus-meets-funerary-inscription
 * obituary for the whole run: how they died, what they did across the
 * campaign, and - if the game ever formed an impression of one (D8) -
 * what they appeared to be after. This is deliberately the one place the
 * inferred ambition (ai/tools/ambition.ts) is allowed to shape
 * player-facing text; it is never shown as a UI element itself.
 * MODEL: pro (GEMINI_PRO), temperature ~1.0 - this is the single most
 * "reward the player with prose" call in the app, same tier reasoning as
 * narration.ts's NARRATION_TEMPERATURE.
 * CONSUMER: components/EpilogueScreen.tsx (calls `generateText` directly -
 * there is no ai/tools/epilogue.ts; the orchestration is small enough to
 * live in the component itself, alongside its loading/fallback state).
 * OUTPUT: plain prose (no schema) - 2-3 paragraphs plus a closing one-line
 * epitaph, per the format contract below.
 *
 * D4 note: none of the mortality pipeline's HIDDEN rolls/bands ever reach
 * this prompt. `causeNarration` is the player-facing narration text the
 * narrator ALREADY produced for the fatal turn, and `mortalityOutcomeSummary`
 * (when present) is that same pipeline's `narrative_directive` - the exact
 * text already handed to that narration call (ai/core/mortality.ts /
 * ai/core/turn.ts) - never the raw roll or band. Nothing new leaks here.
 */

import { Entity } from '../../types';

/** One turn's public headlines, already capped/selected by the caller - see EpilogueScreen.tsx. */
export interface EpilogueTurnHeadlines {
  turnNumber: number;
  headlines: string[];
}

/** One entry from the player's EventHistoryEntry log - the authored-event choices they made. */
export interface EpilogueEventChoice {
  turnNumber: number;
  eventTitle: string;
  choiceText: string;
}

/** The GM-console-only ambition snapshot (ai/tools/ambition.ts / App.tsx), passed in here ONLY - see the file-level doc comment. */
export interface EpilogueAmbition {
  apparent_ambition: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface EpiloguePromptInput {
  player: Entity;
  metaNarrative: string;
  /** Total turns the run lasted (turnHistory.length at the moment of death). */
  turnCount: number;
  /** The final turn's player-facing narration text - the concrete, in-fiction account of how the end came. */
  causeNarration: string;
  /** ai/core/mortality.ts's pre-decided narrative directive for this death, if the mortality pipeline ran this turn - see the D4 note above. */
  mortalityOutcomeSummary?: string;
  /** Per-turn headlines, already capped by the caller to keep this prompt a sane size on a long campaign. */
  turnHeadlines: EpilogueTurnHeadlines[];
  /** How many EARLIER turns were dropped entirely to keep the prompt capped - surfaced so the model can gesture at "many quiet weeks" rather than inventing specifics for turns it was never shown. */
  omittedTurnCount: number;
  eventChoices: EpilogueEventChoice[];
  inferredAmbition: EpilogueAmbition | null;
}

const SYSTEM_INSTRUCTION = `
ROLE: Tacitus, writing this character's final entry in the annals.
The run has ended - this character has died. Your task is to write their epilogue: the closing entry of a history, part obituary, part funerary inscription. This is the one payoff every run earns, whatever shape the story took (there is no "winning" this game - only how the story ends and how it is remembered).

TONE: Tacitus meets a funerary inscription - dry, weighty, morally observant prose; grand where the record earns grandeur, damning where it earns contempt, and never softened out of sentiment. Do not write generic fantasy-epic filler - ground every claim in the specific events you were given.

FORMAT (strict):
1. 2-3 paragraphs of prose:
   - Open with the manner of death - concrete, drawn from the cause given, not invented.
   - Then survey the arc of their time in the story: what they pursued, what they built or destroyed, who they made of themselves - drawn from the headlines and choices given. If an apparent ambition is provided, let it frame this survey (e.g. "In this he was consistent to the end" or "and so the throne he coveted eluded him still") - but do not simply restate it as a label; weave it into the judgment a historian would render.
   - If no clear ambition could be discerned, do not force one - note the absence plainly, the way a historian admits a subject who defies easy summary.
2. Close with exactly ONE final line, on its own, functioning as an epitaph - short, quotable, the kind of line that would be carved in stone or repeated by those who knew them.

RULES:
- Do not mention dice, rolls, validation, "bands", game mechanics, or anything the in-fiction world could not know about itself.
- Do not address the player directly or break the historical framing ("you" is fine only if the source material itself is written in second person to the character - default to third person).
- Base every concrete claim on the material given below; do not invent named characters, battles, or events not present in it.
- Output plain prose only - no markdown headers, no lists, no JSON.
`;

/** Builds the { systemInstruction, prompt } pair for the post-death epilogue call. */
export function buildEpiloguePrompt(input: EpiloguePromptInput): { systemInstruction: string; prompt: string } {
  const {
    player,
    metaNarrative,
    turnCount,
    causeNarration,
    mortalityOutcomeSummary,
    turnHeadlines,
    omittedTurnCount,
    eventChoices,
    inferredAmbition,
  } = input;

  const omittedNote = omittedTurnCount > 0
    ? `(${omittedTurnCount} earlier turn(s) preceded this excerpt and are not itemized below - gesture at "the early years" / "a long middle stretch" as appropriate rather than inventing specifics for them.)\n`
    : '';

  const headlinesBlock = turnHeadlines.length > 0
    ? turnHeadlines
        .map(t => `Turn ${t.turnNumber}: ${t.headlines.length > 0 ? t.headlines.join('; ') : '(no notable headlines)'}`)
        .join('\n')
    : 'No headline record survives.';

  const eventChoicesBlock = eventChoices.length > 0
    ? eventChoices.map(e => `Turn ${e.turnNumber} - "${e.eventTitle}": chose to ${e.choiceText}`).join('\n')
    : 'No special events marked this reign.';

  const ambitionBlock = inferredAmbition
    ? `An outside observer's read on their apparent ambition (confidence: ${inferredAmbition.confidence}): ${inferredAmbition.apparent_ambition}`
    : 'No consistent ambition was ever discerned in their actions - if you cannot find one either from the record below, say so plainly rather than inventing one.';

  const prompt = `
META-NARRATIVE THEME: "${metaNarrative}"

THE DECEASED:
Name: ${player.name}
Position: ${player.position || player.entity_type}
Final location: ${player.location}
Final self-account: ${player.current_state_narrative}

MANNER OF DEATH (the final turn's narration - the definitive account of how the end came):
${causeNarration}
${mortalityOutcomeSummary ? `\nThe fatal outcome, in the words already given to the world: ${mortalityOutcomeSummary}\n` : ''}

LENGTH OF THE REIGN: ${turnCount} turn(s).

${ambitionBlock}

TURN-BY-TURN PUBLIC HEADLINES (a capped excerpt of the record; most recent last):
${omittedNote}${headlinesBlock}

NOTABLE CHOSEN EVENTS ACROSS THE REIGN:
${eventChoicesBlock}
`;

  return { systemInstruction: SYSTEM_INSTRUCTION, prompt };
}
