# Schema-Declared Attribution + commitDomainMutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prose clause-grammar in `playerBoundary.ts` with a typed per-field `actors` interchange contract (+ flat tripwire), and extract the seven App.tsx save-then-dispatch sites into `commitDomainMutation`.

**Architecture:** `actors: string[]` is an **interchange-layer field only** — declared in Gemini structured-output schemas and zod validation, consumed by the boundary gate, then **stripped before anything is committed to state or saves** (persisted shapes stay byte-compatible; no migration). The gate becomes: declared-player → redact field; undeclared but tripwire-register prose → redact field. Mechanics gates (`playerOwnsDelta`, `assertNoPlayerRemoval`) and hidden-mechanics checks are untouched. Part 2 is a pure behavior-preserving extraction in App.tsx.

**Tech Stack:** React 19 + TypeScript, zod 4, `@google/genai` structured output, vitest 3. Package root: `roman_crisis_simulation/src` (all npm commands run there).

**Spec:** `docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md` — read it first; it records the owner's decisions and the rejected alternatives (notably: bare `/^You \w+/` tripwire was explicitly rejected — legal no-attempt narration lives in that register).

**Pipeline (owner-prescribed):** For each task, an **opus** subagent writes the failing tests (steps marked TDD), a **sonnet** subagent implements to green, and the stage-4 **opus** verification + adversarial review runs over the whole diff before merge.

**Baseline commit:** `66cd8e4` (worktree `b7-schema-attribution`, branch `worktree-b7-schema-attribution`).

---

### Task 0: Worktree baseline

**Files:** none (environment only)

- [ ] **Step 0.1:** `cd roman_crisis_simulation/src && npm install`
- [ ] **Step 0.2:** `npm test` → expect all suites green (665+ tests at baseline). `npm run typecheck` → clean. Record counts; these are the parity bar.

---

## Part 1 — the actors contract

### Task 1: Interchange types, zod, and Gemini schemas

**Files:**
- Modify: `roman_crisis_simulation/src/ai/core/schemas.ts` (Gemini structured-output declarations)
- Modify: `roman_crisis_simulation/src/ai/core/zodSchemas.ts` (runtime validation)
- Modify: `roman_crisis_simulation/src/types.ts` ONLY if interchange types live there today — persisted types (`Adjudication.headlines: string[]` at types.ts:415, `EventDelta`, `TurnHistoryEntry`, saves) MUST NOT change shape.
- Test: `roman_crisis_simulation/src/tests/` (colocate with the existing schema/zod suites; follow their file naming)

**Contract (verbatim from spec):** every prose-bearing interchange field gains `actors: string[]` — entity ids whose *actions* the text narrates; empty = pure description; mention ≠ actor. Surfaces:

| Interchange surface | Shape change |
|---|---|
| narration payload | sibling `actors` |
| monologue payload | sibling `actors` |
| headlines | `string[]` → `{ text: string, actors: string[] }[]` (interchange only; stripped back to `string[]` at commit) |
| delta `reason` | sibling `actors` on the delta object (distinct from `origin_id`) |
| entityAction `notes` | sibling `actors` on the entityAction |
| simulation-state prose | one declaration covering the simulation response's prose values (implementer picks exact shape; principle: every free-prose field covered by exactly one declaration) |
| no-attempt response (`ai/tools/noAttemptResponse.ts`) | same treatment as narration/monologue |

- [ ] **Step 1.1 (TDD, opus):** failing zod tests — a response payload missing `actors` on any contract surface is rejected; a well-formed one parses. Representative case:

```ts
it('rejects a narration payload that omits actors', () => {
  const parsed = zNarrationResponse.safeParse({ ...validNarration, actors: undefined });
  expect(parsed.success).toBe(false);
});
it('parses headlines as {text, actors} items', () => {
  const parsed = zAdjudication.safeParse({ ...validAdjudication,
    headlines: [{ text: 'Granary burns in the night', actors: ['gaius_pontius'] }] });
  expect(parsed.success).toBe(true);
});
```

(Exact schema export names: discover from `zodSchemas.ts` — e.g. `zSimulationState` is at zodSchemas.ts:318; mirror whatever validates narration/monologue/adjudication today.)

- [ ] **Step 1.2:** run the new tests, confirm they FAIL (schema lacks `actors`).
- [ ] **Step 1.3 (sonnet):** add `actors` to zod + Gemini schemas for every surface in the table. Gemini schema descriptions must teach the semantic: `"entity_ids whose ACTIONS this text narrates; empty if none; merely mentioning an entity does not qualify"`.
- [ ] **Step 1.4:** new tests pass; `npm run typecheck` clean (expect downstream compile errors in turn.ts/mocks.ts — acceptable ONLY if Task 4 lands in the same PR stage; otherwise thread minimal `actors` through call sites now, unused).
- [ ] **Step 1.5:** commit `feat: declare per-field actors on provider interchange schemas`.

### Task 2: Boundary gate refactor (`playerBoundary.ts`)

**Files:**
- Modify: `roman_crisis_simulation/src/ai/core/playerBoundary.ts`
- Test: `roman_crisis_simulation/src/tests/playerBoundary.test.ts` (major rewrite)

**Deleted:** the clause-decomposition machinery — `splitSubordinateClauses`, `possessedPhrasePredicate`/`possessedHeadPredicate`, `ClauseScope`/anaphora sets, passive-agent scanning, `POSSESSED_CONDITION_PREDICATE`, `STATE_ADJECTIVES` apparatus, `PLAYER_OBJECT_PREDECESSORS`, `containsPlayerAttributedAction` and its per-part subject inheritance.
**Kept as flat data:** `proseSubjectAliases`/`identityAliases`/`samePlayerIdentity`/`SHARED_TITLE_POSITIONS`, the curated allowlists `NON_ACTION_PLAYER_PREDICATE`, `RECEPTIVE_PLAYER_PREDICATE`, `EMPTY_ACT_PREDICATE`, copular/modal/negated/continuous forms, auxiliary stripping, contraction normalization.
**Kept verbatim:** hidden-mechanics half; `playerOwnsDelta`; `assertNoPlayerRemoval`; the redaction plumbing (`redactInventedPlayerProse*` shells and their player-facing notes) rewired to the new classifiers.

**New core API (names final unless TDD stage argues otherwise):**

```ts
/** Declared check: pure data. */
export function actorsIncludePlayer(actors: readonly string[], player: PlayerIdentity): boolean;
/** Tripwire: sentence-initial player subject + verb not in the curated
 *  non-action lists. Flat scan — no clause decomposition. */
export function tripwireFlagsPlayerConduct(text: string, player: PlayerIdentity): boolean;
```

- [ ] **Step 2.1 (TDD, opus):** failing tests for the full gate matrix. The B7 gap sentences are the star cases:

```ts
// Declared-player: pure data check, prose never parsed
expect(actorsIncludePlayer([player.entity_id], player)).toBe(true);
expect(actorsIncludePlayer(['gaius_pontius'], player)).toBe(false);
// B7 gap sentence with a rival declaration: tripwire must NOT fire
// (was DECLARED GAP 1 under the grammar — now legal by declaration)
expect(tripwireFlagsPlayerConduct(
  'Your grip weakens because he burned the granary.', player)).toBe(false);
// Tripwire catches the dominant lie register
expect(tripwireFlagsPlayerConduct('You seize the treasury.', player)).toBe(true);
// Legal no-attempt register must NOT trip
for (const legal of ['You wait.', 'You receive a letter.', 'You learn of the mutiny.',
  'You are gaining favor.', 'You do nothing this week.'])
  expect(tripwireFlagsPlayerConduct(legal, player)).toBe(false);
// Redaction shell wired to the new classifiers: declared-player field redacts,
// declared-rival field survives verbatim (assert via redactInventedPlayerProseFromValue's
// successor over a {text, actors} payload — opus stage pins the exact shape)
```

Opus stage: expand across surfaces (headline items, delta reasons, notes, monologue first-person 'I' register), observable-attempt turns (gate inert), and port every still-meaningful case from the existing suite. Retire the `DECLARED GAP` blocks with a comment pointing at the spec.

- [ ] **Step 2.2:** confirm FAIL (new exports don't exist).
- [ ] **Step 2.3 (sonnet):** implement; delete the machinery; header comment rewritten to describe the contract + tripwire + residual-risk acceptance.
- [ ] **Step 2.4:** `npx vitest run tests/playerBoundary.test.ts` green; full `npm test` may break in turn/mocks until Task 4 — note status honestly.
- [ ] **Step 2.5:** commit `refactor: declaration-primary player boundary, delete clause grammar`.

### Task 3: Prompts teach the contract

**Files:**
- Modify: the prompt builders feeding each surface (`roman_crisis_simulation/src/ai/prompts/` — adjudication, narration, monologue, simulation/intelligence, noAttempt; discover exact files via the schema imports)
- Test: prompt snapshot/content tests where the existing suites assert prompt text

- [ ] **Step 3.1 (TDD, opus):** failing tests asserting each prompt states: actors = ids of entities whose actions the text narrates; mention ≠ actor; on a no-attempt turn the player id must not appear in any `actors` and no prose may narrate player conduct.
- [ ] **Step 3.2 (sonnet):** add the contract text using the repo's existing delimiting conventions (`asPromptData` where player-influenced values interpolate — see the prompt-sweep decisions).
- [ ] **Step 3.3:** green; commit `feat: prompts declare the actors attribution contract`.

### Task 4: Pipeline wire-through (`turn.ts`, `mocks.ts`)

**Files:**
- Modify: `roman_crisis_simulation/src/ai/core/turn.ts` (adjudication gate near the `redactInventedPlayerProse` call; narration/monologue/simulation gates near the `redactInventedPlayerProseFromValue` calls; strip `actors` before building `TurnHistoryEntry`/results)
- Modify: `roman_crisis_simulation/src/ai/mocks.ts` (mirror gates at mocks.ts:443,494-500; mock payloads emit `actors`)
- Test: existing turn/mocks suites + new stripping assertions

- [ ] **Step 4.1 (TDD, opus):** failing tests: (a) a mock adjudication declaring the player on a headline on a no-attempt turn commits with that headline redacted; (b) committed state/turnHistory contain **no `actors` fields** (deep scan of the result object); (c) declared-rival B7-gap prose survives commit verbatim.
- [ ] **Step 4.2 (sonnet):** wire gates, strip at commit boundary, update every mock payload.
- [ ] **Step 4.3:** full `npm test` green; `npm run typecheck` clean.
- [ ] **Step 4.4:** commit `feat: turn pipeline enforces and strips the actors contract`.

### Task 5: Journey fake clients

**Files:**
- Modify: `roman_crisis_simulation/src/tests/journeys/` fake clients/harness so scripted responses carry `actors`
- Test: `npm run test:journeys`

- [ ] **Step 5.1 (sonnet):** update scripted payloads (quietReign is the no-attempt-heavy one — its prose must declare NPC actors or empty, never the player).
- [ ] **Step 5.2:** `npm run test:journeys` green; commit `test: journeys emit the actors contract`.

### Task 6: Docs close-out

**Files:**
- Modify: `roadmaps/BACKLOG.md` (B7: close DECLARED-GAP-1 and possessive-passive bullets → pointer to spec)
- Modify: `roadmaps/DESIGN_DECISIONS.md` (new D-entry: contract, residual-risk acceptance, tripwire scope)
- Modify: `roman_crisis_simulation/src/tests/promptDataBoundary.test.ts` only if its directory walker trips on changed prompt files

- [ ] **Step 6.1 (sonnet):** write both doc updates; commit `docs: record the actors-contract decision, close B7 prose gaps`.

---

## Part 2 — commitDomainMutation

### Task 7: Extract the helper across the seven sites

**Files:**
- Modify: `roman_crisis_simulation/src/App.tsx` (sites at the seven `if (!saveGame(...).ok)` blocks — anchors: `commitPrivateScene`, the `TURN_COMMITTED` block (`throw new Error('AUTOSAVE_FAILED')`), `startGameWithCharacter`, `spendResource`, `handleInvestigationOutcome`, `handleSetIntervention`, `handleEventChoice`)
- Test: existing App-level suites + journeys are the parity net; add focused tests only if the helper is extractable pure

**Helper (App.tsx-local; closes over `dispatch`):**

```ts
interface DomainCommit {
    candidate: SaveGameState;
    action: GameAction;
    onSaveFailure: () => void;      // set*Error(...) or throw AUTOSAVE_FAILED
    beforeDispatch?: () => void;    // ref writes AFTER durable save, BEFORE dispatch
    onCommitted?: () => void;       // success-path error-clears, preserving per-site ORDER
}
const commitDomainMutation = ({ candidate, action, onSaveFailure, beforeDispatch, onCommitted }: DomainCommit): boolean => {
    if (!saveGame(candidate).ok) { onSaveFailure(); return false; }
    beforeDispatch?.();
    dispatch(action);
    onCommitted?.();
    return true;
};
```

**Quirks that must survive verbatim (from the spec):** turn-commit site throws instead of returning; `handleEventChoice` clears BOTH `transactionError` and `eventChoiceError` before dispatch (today: before — keep exactly what the site does today, do not normalize); `commitPrivateScene` sets lock/scene refs between save and dispatch and clears `privateSceneError` after; most sites clear `setTransactionError(null)` BEFORE dispatch — if the helper's shape can't express a site verbatim, adjust the helper, not the site's semantics.

- [ ] **Step 7.1 (TDD, opus):** decide testability — if the seven sites are only reachable through component behavior, rely on the existing suites and write a diff-review checklist instead of new tests; otherwise add save-failure-per-error-channel tests. Do not force untestable tests.
- [ ] **Step 7.2 (sonnet):** extract; migrate all seven; `npm test` + `npm run test:journeys` green; `npm run lint` clean.
- [ ] **Step 7.3:** commit `refactor: extract commitDomainMutation across the seven save-then-dispatch sites`.

---

## Stage gates (after all tasks)

- [ ] **Verify (opus):** fresh subagent(s) run `npm run typecheck && npm test && npm run test:journeys && npm run lint` from `roman_crisis_simulation/src`, read the seven-site diff for behavior parity, and confirm no persisted-shape change (`actors` absent from saves/turnHistory).
- [ ] **Adversarial review (opus):** attack the contract (can prose narrate player conduct while declaring rivals in a register the tripwire misses? is stripping complete? did any persisted shape drift? did redaction notes regress?), attack the seven-site extraction for ordering/atomicity drift. Findings → fix tasks before merge.
- [ ] **Merge decision:** superpowers:finishing-a-development-branch.
