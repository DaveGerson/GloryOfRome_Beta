# Schema-declared player-action attribution + commitDomainMutation extraction

Date: 2026-07-28
Status: Approved by owner (this session) — implementation pending
Scope: two independent refactors, one engagement. Part 1 closes BACKLOG B7's two
declared prose-attribution gaps by construction; Part 2 extracts the seven
save-then-dispatch sites in `App.tsx` into one helper.

---

## Part 1 — Schema-declared player-action attribution

### Problem

`ai/core/playerBoundary.ts` enforces a hard postcondition: on a turn with no
observable player attempt, no provider response may author a player action.
The **mechanical** half (deltas, entityActions, `remove_entities`) is checked
structurally via typed fields (`playerOwnsDelta`, `assertNoPlayerRemoval`) and
is sound. The **prose** half is *inferred* from free text by a ~1,000-line
regex clause grammar (subordinator splitting, possessive parsing, anaphora
scopes, passive-agent scans, curated word lists). BACKLOG B7 documents two
gaps that cannot close without over-rejecting legitimate third-person prose:

1. **DECLARED GAP 1** — a third-person pronoun under a second-person
   possessive: "Your grip weakens because **he** burned the granary."
2. **Possessive passive-agent gap** — "burned **by your agents**" /
   "sealed by my predecessor" (all persons at once, or not at all).

Both are inherent to inferring attribution from English. The owner has ruled:
replace inference with a typed interchange contract.

### Decision

Every prose-bearing field in provider responses carries a declared
`actors: string[]` — the entity ids whose **actions** the text narrates
(empty array = pure world/state description; merely *mentioning* an entity as
an object or bystander does not put it in `actors`). Gemini structured-output
mode guarantees the field's presence and shape; runtime zod validation
guarantees it post-parse. Attribution becomes data. The clause-decomposition
grammar is deleted.

The declaration is a self-report from the model being policed. The accepted
residual risk (owner-approved): a model that writes player-action prose while
omitting the player from `actors` slips past the typed gate. Bounding fact:
the mechanical layer still blocks every state effect, so a missed lie costs
one contradictory sentence on screen — an immersion blemish, never
corruption, resource loss, or death.

**Runtime lie-catcher (owner-selected, with corrected sizing):** a flat
tripwire, not the grammar. Sentence-initial player-subject (player aliases /
"you"/"I", reusing `proseSubjectAliases`) whose head verb is **not** in the
existing curated non-action verb lists (`NON_ACTION_PLAYER_PREDICATE`,
`RECEPTIVE_PLAYER_PREDICATE`, `EMPTY_ACT_PREDICATE`, copular/modal/negated
forms, auxiliary stripping) fires the tripwire on a field that did NOT
declare the player. The curated lists survive as flat data (~100 lines
total); what is deleted is the clause-decomposition machinery —
`splitSubordinateClauses`, possessive phrase classification, `ClauseScope`
anaphora, passive-agent scanning, the possessed-condition/state-adjective
apparatus. Note: a bare `/^You \w+/` check was explicitly rejected during
design — legal no-attempt narration lives in exactly that register ("You
wait", "You receive a letter").

### Contract surfaces

Derived from the current redaction call sites (`ai/core/turn.ts:63`,
`turn.ts:887-894`; mirrored `ai/mocks.ts:443,496-500`):

| Surface | Today | With contract |
|---|---|---|
| Narration prose | redact-on-classifier-hit | `actors` on the narration payload |
| Inner monologue | same | `actors` on the monologue payload |
| Headlines | `string[]` | each becomes `{ text, actors }` |
| Delta `reason` | classifier | sibling `actors` on the delta (distinct from `origin_id`, which stays the *mechanical* owner) |
| entityAction `notes` | classifier | sibling `actors` on the entityAction |
| Simulation-state prose | classifier over values | `actors` declaration on the simulation response (exact shape: implementer's choice, principle = every free-prose field is covered by exactly one declaration) |

Schema changes land in `ai/core/schemas.ts` (Gemini structured output) and
`ai/core/zodSchemas.ts` (runtime validation) together. Prompts
(`ai/prompts/*`) teach the contract with the same delimiting/`asPromptData`
conventions as the existing prompt sweep.

### Gate semantics (playerBoundary.ts after the refactor)

On a no-attempt turn:

1. **Declared:** field's `actors` includes the player (via
   `samePlayerIdentity`) → redact that field, reusing the existing redaction
   plumbing and player-facing redaction notes. Pure data check.
2. **Tripwire:** field's `actors` does NOT include the player, but a sentence
   opens with a player subject and a non-allowlisted verb → redact that
   field (the declaration lied or erred).
3. **Mechanics:** `playerOwnsDelta`, `assertNoPlayerRemoval`, and the
   hidden-mechanics leakage checks are untouched.

On an observable-attempt turn the gate is inert, as today. Redaction (not
turn rejection) remains the failure mode for prose, per the P0 hardening.

### Consumers and follow-through

- `ai/mocks.ts` and the journey fake clients (`tests/journeys/`) emit the new
  fields and keep their boundary projections aligned with the real gate.
- `tests/playerBoundary.test.ts`: the DECLARED GAP entries are retired — the
  gap sentences become first-class contract cases (declared `actors:
  [rival_id]` → passes; declared player → redacts).
- BACKLOG B7: close the two prose-gap bullets with a pointer to this spec.
- DESIGN_DECISIONS.md: new D-entry recording the contract, the residual-risk
  acceptance, and the tripwire's corrected scope.
- Optional (not in scope, may be a follow-on): an offline declaration-vs-prose
  drift audit in the eval harness's deterministic-checks leg.

### Testing (TDD — tests first, must fail before implementation)

- Contract shape: zod + schema reject responses missing `actors`.
- Gate matrix per surface: declared-player → redacted; declared-rival with
  B7 gap sentences → passes untouched; undeclared + tripwire register
  ("You seize the treasury") → redacted; undeclared + legal register
  ("You wait", "You receive a letter", "You learn of the mutiny") → passes.
- Mechanics regression: existing `playerOwnsDelta` / removal / hidden-
  mechanics suites unchanged and green.
- Journeys: quietReign (the no-attempt-heavy journey) stays green with
  fake clients emitting the contract.

---

## Part 2 — `commitDomainMutation` extraction (App.tsx)

### Problem

Seven sites repeat save-then-dispatch with only the error channel and some
pre-dispatch ref work varying: `roman_crisis_simulation/src/App.tsx` lines
648 (`commitPrivateScene`), 1088 (turn commit), 1260
(`startGameWithCharacter`), 1345 (`spendResource`), 1446
(`handleInvestigationOutcome`), 1464 (`handleSetIntervention`), 1499
(`handleEventChoice`).

### Decision

One helper, pure extraction, byte-identical behavior:

```ts
commitDomainMutation({
  candidate,        // SaveGameState — already built by the caller
  action,           // reducer action dispatched only after a durable save
  onSaveFailure,    // site's error channel: setTransactionError /
                    // setPrivateSceneError / setEventChoiceError / throw
  beforeDispatch?,  // site's between-save-and-dispatch ref work:
                    // privateSceneLockRef, privateScenesRef, committedTail
}): boolean         // true iff saved + dispatched
```

Invariant preserved: **the durable bytes exist before the reducer dispatch**,
and `beforeDispatch` runs after the save succeeds and before the dispatch —
exactly where the existing sites do their ref writes.

Site-specific quirks that MUST survive verbatim:

- Site 1088 throws `AUTOSAVE_FAILED` instead of setting error state
  (`onSaveFailure` throws).
- Site 1499 clears both `transactionError` and `eventChoiceError` on
  success; site 648 clears `privateSceneError` *after* dispatch.
- Success-path error-clear ordering per site is preserved, not normalized.

Location: `App.tsx` local helper (it closes over dispatch/error setters); the
TDD stage may argue for a parameterized module under `state/` if it tests
cleaner — behavior parity is the constraint, placement is not.

### Testing

Existing App-level suites and journeys are the primary net. Add focused
tests only where the helper's contract is observable (save-failure paths per
error channel; dispatch-only-after-durable-save ordering).

---

## Process

Worktree `b7-schema-attribution`. Pipeline (owner-prescribed): opus subagents
write the TDD suites → sonnet subagents implement → opus subagents verify
(`npm run typecheck`, `npm test`, `npm run test:journeys`, `npm run lint`) →
final opus adversarial review before any merge. Part 2 lands after Part 1 to
keep the diffs reviewable, but they are independent commits.
