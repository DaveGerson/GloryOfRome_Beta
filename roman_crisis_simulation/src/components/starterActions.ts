/**
 * components/starterActions.ts
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 ("seed starter suggested actions
 * so turn 1 isn't a blank page"). A pure, deterministic, synchronous
 * function - NO AI call - that turns a freshly-chosen player character's own
 * goals into 3 short, concrete first moves for the ActionPills row
 * (components/Chat.tsx). Called from App.tsx's `startGameWithCharacter`,
 * well before the turn pipeline (ai/core/turn.ts) ever runs.
 *
 * Deliberately takes a narrow structural type (rather than the full
 * `Entity`) so this stays a pure function of just the fields it reads and is
 * trivial to unit-test with partial fixtures; any `Entity` is assignable to
 * it as-is.
 *
 * Per DESIGN_DECISIONS.md D8 (player ambition is inferred, never declared),
 * these are exploratory/investigative first moves phrased in the player's
 * own voice - never handed-down objectives or a quest-log entry.
 */

export interface StarterActionSource {
  short_term_goals?: string[];
  long_term_ambitions?: string[];
  position?: string;
}

/** deriveStarterActions always returns exactly this many suggestions. */
export const STARTER_ACTION_COUNT = 3;

function lowerFirst(text: string): string {
  return text.length ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// Each goal/ambition in constants/baseScenario.ts is already phrased as a
// short imperative fragment (e.g. "Secure the Rhine legions", "Become
// Princeps Senatus") - these templates turn one into a concrete first move.
// Cycled through by position so multiple goal-derived pills don't all read
// identically.
const GOAL_TEMPLATES: ReadonlyArray<(goal: string) => string> = [
  goal => `Move to ${lowerFirst(goal)} before anyone else can`,
  goal => `Send trusted word to those who could help you ${lowerFirst(goal)}`,
  goal => `Quietly begin the work to ${lowerFirst(goal)}`,
];

// Fills any slots left over when the entity has fewer than
// STARTER_ACTION_COUNT usable goals/ambitions (e.g. a sparsely-described
// custom character). Generic on purpose, and phrased as first moves to
// take, not objectives to complete - never contradicts D5 (no omniscience)
// or D8 (no quest log).
const GENERIC_FALLBACKS: ReadonlyArray<string> = [
  'Send trusted messengers to learn who truly stands with you',
  'Summon your closest confidants to weigh the dangers of the coming weeks',
  'Write privately to an old ally, testing whether their loyalty still holds',
];

function withIndefiniteArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * Derives exactly `STARTER_ACTION_COUNT` short, actionable starter pills for
 * a freshly-chosen player character. Prefers `short_term_goals` (nearer-term,
 * more turn-1-appropriate), then `long_term_ambitions`, then a single
 * position-flavored line, then generic fallbacks - always topping up to
 * exactly `STARTER_ACTION_COUNT` non-empty strings, even for a character
 * with no goals/ambitions/position at all.
 */
export function deriveStarterActions(entity: StarterActionSource): string[] {
  const goals = [...(entity.short_term_goals ?? []), ...(entity.long_term_ambitions ?? [])]
    .map(goal => goal?.trim())
    .filter((goal): goal is string => Boolean(goal));

  const actions: string[] = [];
  const seen = new Set<string>();

  for (const goal of goals) {
    if (actions.length >= STARTER_ACTION_COUNT) break;
    const template = GOAL_TEMPLATES[actions.length % GOAL_TEMPLATES.length];
    const action = template(goal);
    if (seen.has(action)) continue;
    seen.add(action);
    actions.push(action);
  }

  const position = entity.position?.trim();
  if (actions.length < STARTER_ACTION_COUNT && position) {
    actions.push(`Consider what it means to act as ${withIndefiniteArticle(position)} in this moment`);
  }

  let fallbackIndex = 0;
  while (actions.length < STARTER_ACTION_COUNT) {
    actions.push(GENERIC_FALLBACKS[fallbackIndex % GENERIC_FALLBACKS.length]);
    fallbackIndex++;
  }

  return actions.slice(0, STARTER_ACTION_COUNT);
}
