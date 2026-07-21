/**
 * ai/prompts/npcMind.ts
 *
 * PURPOSE: One spotlight character's own per-turn MIND call (ROADMAP_PHASE_4.md
 * 4C item 4, DESIGN_DECISIONS.md D10/D22) - the character is addressed IN
 * CHARACTER and asked to decide this turn's move in service of its own
 * goals, from its BOUNDED knowledge only.
 * MODEL: flash (GEMINI_FLASH) - one call per spotlight character, up to
 * MAX_MINDS_PER_TURN per turn, launched in parallel (D16 sanctions the
 * added latency leg; the flash tier keeps its cost with assessment/monologue,
 * not adjudication).
 * CONSUMER: ai/tools/npcMind.ts `getNpcMindDecision`, from ai/core/turn.ts's
 * npc_minds stage (between the Director and adjudication).
 * OUTPUT: validated against `zNpcMindDecision` (ai/core/zodSchemas.ts) /
 * `NpcMindDecisionSchema` (ai/core/schemas.ts).
 *
 * THE ASYMMETRY CONTRACT (D10/D22 - the point of the whole feature): this
 * prompt may contain ONLY what the character plausibly knows -
 *  - its OWN full brief (its own secrets, scheme, personality, skills,
 *    beliefs, goals, resources, and its own outbound relationship reads),
 *  - its OWN perception-grounded memories (Entity.memories, the D10 stamp),
 *  - its OWN perceived digest of the previous turn's events (the same
 *    viewer-agnostic filter in perception/visibility.ts, run from THIS
 *    character's vantage, deduplicated against the memory lines already
 *    stamped from it - ai/core/turn.ts::selectUnrememberedChanges),
 *  - its Director intent (recast as the character's carried resolve). NOTE
 *    the trust model here: the intent is DIRECTOR-AUTHORED free text
 *    injected verbatim - no code filters it, and free text cannot be
 *    reliably code-filtered. It is trusted by convention: bounded by the
 *    Director prompt's own INTENT KNOWLEDGE BOUND authoring contract
 *    (ai/prompts/intelligence.ts) and audited by the eval judge's
 *    information-asymmetry axis (ai/prompts/evalJudge.ts), not by code,
 *  - and PUBLIC knowledge (headlines + the D5-public macro world summary).
 * It must NEVER contain another character's secrets, gm_private,
 * secret_truth, rumor truth flags, or the player's private data - and
 * never another character's active_scheme OBJECT (goal/steps). One
 * sanctioned carve-out on scheme NAMES: the crude-v1 witnessed rule lets a
 * co-located viewer perceive a schemer's scheme delta as "You catch wind
 * of X's scheme: <name>" (perception/visibility.ts::describeDelta), so a
 * rival's scheme NAME may legitimately reach this prompt through the
 * character's own memories/digest. That is proximity-witnessed perception
 * under D5, not a leak. That is why `buildMindSelfBrief` below is a
 * DEDICATED builder and the input shape carries no roster: the omniscient
 * adjudicator fragments (ai/prompts/fragments.ts::getEntityBrief and
 * friends) serialize any entity's scheme/secrets and must never be reused
 * here. Pinned by tests/npcMinds.test.ts (a rival's scheme present in
 * world state must not appear in this prompt).
 *
 * Mind outputs are GM-PRIVATE (D4/D5): GameMasterScreen and ai/ only.
 */

import { Entity, NpcIntent } from '../../types';
import type { PerceivedChange } from '../../perception/visibility';

/**
 * Cost/latency cap on mind calls per turn (D16/D22): at most this many
 * spotlight characters get a mind call, in spotlight order (the Director
 * lists its picks by importance). Spotlights beyond the cap - and any
 * spotlight whose mind call fails - fall back to their Director intent
 * alone in the adjudication prompt, exactly the pre-minds behavior.
 * Defined here (not in ai/core/turn.ts) so ai/mocks.ts can bound the mock
 * path without importing from turn.ts (which imports mocks.ts).
 */
export const MAX_MINDS_PER_TURN = 3;

/**
 * Bounded slice of the character's own memory lines fed into its mind
 * prompt - the LAST N entries of the perception-grounded memories stamped
 * by ai/core/engine.ts (each line is something this character actually
 * witnessed or heard from its own vantage). Bounded because Entity.memories
 * holds up to MAX_ENTITY_MEMORIES entries and a mind needs recent lived
 * experience, not the whole remembered past.
 */
export const MIND_MEMORY_LINES = 8;

export interface NpcMindPromptInput {
  /** The character's OWN full entity record - its own secrets/scheme are its own knowledge. Nothing about any other entity may enter through this input. */
  self: Entity;
  /** The Director's durable intent committed for this character this turn, if any - recast in the prompt as the character's own carried resolve. Director-authored free text injected VERBATIM: guarded by the Director's INTENT KNOWLEDGE BOUND contract and the eval judge, not by code (see the asymmetry-contract note above). */
  directorIntent?: NpcIntent;
  /** What this character perceived of the PREVIOUS turn's events, from its own vantage - already filtered through perception/visibility.ts's buildPerceivedDigest with this character as the viewer, and already deduplicated against the memory lines the previous turn stamped from that same digest (ai/core/turn.ts::selectUnrememberedChanges) so the prompt never shows the same event twice. */
  perceivedChanges: PerceivedChange[];
  /** PUBLIC knowledge: the previous turn's headlines (empire-public news, D5). */
  publicHeadlines: string[];
  /** PUBLIC knowledge: the one-line macro world summary (year/week/political climate/economic stability - the D5 crude-v1 public macro fields only, never region detail). */
  worldSummary: string;
  turnNumber: number;
}

/**
 * The character's OWN brief, second person, self-knowledge only - the
 * dedicated mind counterpart to fragments.ts's omniscient `getEntityBrief`.
 * Everything here is the character's own record of themself: their secrets
 * are theirs to know, their scheme is their own plan, their relationship
 * numbers are their OWN reads of others (which may be wrong about the
 * world - that is the point). `secret_truth` is deliberately never
 * serialized: mind-eligible characters are status 'alive', so a hidden
 * survivor (public status 'dead') never reaches a mind call at all.
 * Exported for direct asymmetry testing.
 */
export function buildMindSelfBrief(self: Entity): string {
  const lines: string[] = [];
  lines.push(`You are ${self.name}${self.position ? `, ${self.position}` : ''} (entity_id: ${self.entity_id}), currently at ${self.location}.`);
  if (self.personality) {
    lines.push(`Your nature (1-10): ambition ${self.personality.ambition}, paranoia ${self.personality.paranoia}, loyalty ${self.personality.loyalty}, cunning ${self.personality.cunning}, honor ${self.personality.honor}.`);
  }
  if (self.skills && Object.keys(self.skills).length > 0) {
    lines.push(`Your skills: ${Object.entries(self.skills).map(([name, value]) => `${name}:${value}`).join(', ')}.`);
  }
  if (self.beliefs && self.beliefs.length > 0) {
    lines.push(`Your beliefs: ${self.beliefs.join('; ')}`);
  }
  if (self.secrets && self.secrets.length > 0) {
    lines.push(`Your secrets (yours alone - you know them; others may not): ${self.secrets.join('; ')}`);
  }
  lines.push(`Your goals: ${self.short_term_goals.join(', ') || 'none pressing'}. Your ambitions: ${self.long_term_ambitions.join(', ') || 'none declared'}.`);
  if (self.active_scheme) {
    lines.push(`Your active scheme (your own plan): ${JSON.stringify(self.active_scheme)}`);
  }
  if (Object.keys(self.resources).length > 0) {
    lines.push(`Your resources: ${Object.entries(self.resources).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : v}`).join(', ')}.`);
  }
  const relationships = Object.values(self.relationships)
    .filter(r => r)
    .map(r => `${r.entity_id}(trust:${r.trust_level}, respect:${r.respect_level ?? 0}, threat:${r.perceived_threat ?? 0}, alignment:${r.ideological_alignment ?? 0}, dependency:${r.dependency_level ?? 0})`);
  if (relationships.length > 0) {
    lines.push(`How you stand toward others (YOUR OWN reads - not necessarily the truth about them): ${relationships.join(', ')}`);
  }
  return lines.join('\n');
}

/** Builds the { systemInstruction, prompt } pair for one character's per-turn mind call. */
export function buildNpcMindPrompt(input: NpcMindPromptInput): { systemInstruction: string; prompt: string } {
  const { self, directorIntent, perceivedChanges, publicHeadlines, worldSummary, turnNumber } = input;

  const systemInstruction = `
ROLE: A character's own private mind.
You are ${self.name}${self.position ? `, ${self.position}` : ''} - the character themself, thinking in the first person. You are NOT a game master, narrator, or assistant: you are one living person inside Rome's crisis, with your own wants, fears, and plans.

WHAT YOU KNOW - AND NOTHING MORE: everything you know is given below - who you are, what you remember, what you perceived this past week from your own vantage, and what all of Rome has heard. You know NOTHING beyond it. Other characters' secrets, private schemes, and hidden motives are closed to you unless something below told you of them; never act on knowledge your own eyes, ears, and informants could not have brought you.

TASK: Decide YOUR move for the coming week, in service of your own goals and your own scheme. Choose like the person you are - your nature, beliefs, and loyalties govern the choice, not optimal play. You may be wrong about others; act on what YOU believe.

OUTPUT: a single JSON object per the schema, no explanatory text or markdown:
- "entity_id": exactly "${self.entity_id}".
- "chosen_action": ONE concrete act you take this week, in prose - a single decisive move, not a list of options.
- "method": HOW you carry it out, briefly.
- "private_reasoning": your true thinking, first person - the honest why behind the move, including anything you would never say aloud. No one in the world ever hears this.
- "scheme_adjustment": OPTIONAL - if this week's events shift your active scheme (a step completed, failed, or redirected), one line on how; omit or null if your scheme stands unchanged.
`;

  const memoryLines = self.memories
    .slice(-MIND_MEMORY_LINES)
    .map(m => `- T${m.turn}: ${m.event_description}`);

  const prompt = `
It is Turn ${turnNumber}. ${worldSummary}

WHO YOU ARE:
${buildMindSelfBrief(self)}

WHAT YOU REMEMBER (your own experiences, oldest first):
${memoryLines.length > 0 ? memoryLines.join('\n') : 'Nothing of note yet - your story here is just beginning.'}

WHAT ELSE YOU PERCEIVED THIS PAST WEEK (only what your own vantage admitted, beyond what you already remember above):
${perceivedChanges.length > 0 ? perceivedChanges.map(c => `- [${c.source}] ${c.text}`).join('\n') : 'Nothing beyond what you already remember reached you this week.'}

WHAT ALL OF ROME HAS HEARD (public news):
${publicHeadlines.length > 0 ? publicHeadlines.map(h => `- ${h}`).join('\n') : '- The city was quiet.'}
${directorIntent ? `
YOUR RESOLVE (the aim you have been carrying forward):
"${directorIntent.intent}"
Decide this week's move in service of it - or against it, if what you now know demands a change of course.
` : ''}`;

  return { systemInstruction, prompt };
}
