# Task 7 Part 2 — `commitDomainMutation` site map, testability decision, and extraction checklist

Spec: `docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md`, Part 2.
Baseline: all green (npm test 1570, journeys 10). Line numbers below are as of this
document's commit; find each site by its `saveGame(` call, not by line number.

Constraint restated: **byte-identical behavior per site.** The helper adapts to the
site, never the reverse. The invariant: durable bytes exist before reducer dispatch;
`beforeDispatch` runs after save success and before dispatch.

## Per-site map

All sites share the skeleton `if (!saveGame(candidate).ok) { <fail channel>; <exit> }
<between-work> dispatch(<action>) <after-work>`. Everything **outside** that skeleton
(fingerprint prechecks, `request.isCurrent()` guards, candidate construction,
post-commit tails) stays inline at the site and is out of the helper's scope.

| # | Site (anchor) | Candidate | Failure channel (exact) | Failure exit | Between save & dispatch (exact order) | Dispatch action | After dispatch (success) | Site return type |
|---|---|---|---|---|---|---|---|---|
| 1 | `commitPrivateScene` (App.tsx:648) | `buildSaveState({ privateScenes: candidateScenes })` | `setPrivateSceneError('The scene could not be saved. Your words remain ready to retry.')` | `return false` | 1. `privateSceneLockRef.current = candidateScenes.some(scene => scene.status === 'active' \|\| scene.status === 'awaiting_last_word')` 2. `privateScenesRef.current = candidateScenes` | `PRIVATE_SCENES_COMMITTED` | `setPrivateSceneError(null)`; `return true` | `boolean` |
| 2 | TURN_COMMITTED block in `executeTurn` (App.tsx:1088) | `nextSaveState` (prebuilt at :1071) | **`throw new Error('AUTOSAVE_FAILED')`** — lands in `executeTurn`'s catch, which (with `committedTail` still null) takes the rollback branch: `setTurnError('The turn could not be resolved. Your draft has been restored; retry when you are ready.')`, `setRetrySubmission`/`setRetryDraft`, `TURN_ROLLED_BACK`, `GAME_STATE_SET(AWAITING_PLAYER_INPUT)`, draft restore | throw (no return) | 1. `committedTail = { diedThisTurn }` 2. `privateScenesRef.current = committedPrivateScenes` | `TURN_COMMITTED` (full payload) | `setTransactionError(null)` — the FIRST statement after dispatch; the rest of the success tail (`setTurnStage(null)`, `setStreamingNarration('')`, event check, draft clears, ambition inference) stays inline | none (flow continues; helper's boolean is dead at this site — `onSaveFailure` throws, so `return false` is unreachable) |
| 3 | `startGameWithCharacter` (App.tsx:1260) | `candidate` (prebuilt at :1259) | `setTransactionError('Your campaign could not be saved. Please try again.')` | `return;` (void) | `setTransactionError(null)` — **the clear is BEFORE dispatch** | `GAME_STARTED` | nothing in-pattern (onboarding check follows, out of scope) | `void` |
| 4 | `handleSpendResource` (App.tsx:1345) | `buildSaveState({ entities: newEntities })` | `setTransactionError('Your change could not be saved. Please try again.')` | `return false` | `setTransactionError(null)` — **BEFORE dispatch** | `RESOURCE_SPENT` | `return true` | `boolean` |
| 5 | `handleInvestigationOutcome` (App.tsx:1446) | `buildSaveState({ entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, messages: falloutMessage ? [...messages, falloutMessage] : messages })` | `setTransactionError('Your investigation could not be saved. Please try again.')` | `return false` | `setTransactionError(null)` — **BEFORE dispatch** | `INVESTIGATION_COMMITTED` (incl. `falloutMessage`) | dead commented-out `if (hasFallout(...))` block, then `return true` | `Promise<boolean>` (commit part is synchronous; helper returns `boolean`) |
| 6 | `handleSetIntervention` (App.tsx:1464) | `buildSaveState({ gmInterventionText: text })` | `setTransactionError('The directive could not be saved. Please try again.')` | `return false` | `setTransactionError(null)` — **BEFORE dispatch** | `GM_INTERVENTION_SET` | `return true` | `boolean` |
| 7 | `handleEventChoice` (App.tsx:1499) | `buildSaveState({ entities: updatedEntities, worldState: updatedWorldState, eventHistory: newEventHistory, triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings, messages: [...messages, eventMessage] })` | `setEventChoiceError('Your choice could not be saved. Please try again.')` — does **NOT** touch `transactionError` on failure | `return;` (void) | 1. `setTransactionError(null)` 2. `setEventChoiceError(null)` — **BOTH BEFORE dispatch, in that order** | `EVENT_CHOICE_APPLIED` | nothing (dispatch is the last statement) | `void` |

### Cross-site facts the extraction must not flatten

- **The clear-ordering split.** Sites 3–7 clear their error state(s) BEFORE dispatch;
  sites 1–2 clear AFTER dispatch. Under the approved helper shape this means: sites
  3–7 put clears in `beforeDispatch` (alongside nothing else), sites 1–2 put clears
  in `onCommitted`. Do NOT "normalize" sites 3–7 into `onCommitted` — the field names
  suggest refs-in-`beforeDispatch` / clears-in-`onCommitted`, but per-site order wins.
  (The ordering is unobservable under React 18 batching in the happy path, but it IS
  observable if `dispatch` throws — and at site 2 the `committedTail`-before-dispatch
  order is load-bearing: a reducer throw after a durable save must land in the
  catch's post-commit branch, never the rollback branch.)
- **Failure-channel diversity.** `setTransactionError` (3, 4, 5, 6) vs
  `setPrivateSceneError` (1) vs `setEventChoiceError` (7) vs throw (2). Site 7's
  failure sets ONLY `eventChoiceError`; its success clears BOTH `transactionError`
  and `eventChoiceError`.
- **Site 7's `setTransactionError(null)` on success is defensively redundant** (any
  turn commit that spawned the modal already cleared it) and therefore not
  observably testable — it is preserved by diff review only.
- **Exactly one `saveGame` call per commit.** Tests assert `setItem` called exactly
  2× per failed commit (primary + backup write); a double `saveGame` would break
  the counted-spy contract.
- **Helper identity.** `commitPrivateScene` (deps `[buildSaveState, dispatch]`) and
  `handleEventChoice` (useCallback) will reference the helper. Define
  `commitDomainMutation` with `useCallback` over `[dispatch]` (state setters are
  stable) so adding it to dep arrays does not make those callbacks — and everything
  downstream of them — recreate every render.

## Testability decision

**Decision: no new red tests for the helper. Existing component coverage + four new
green [REGRESSION PIN] tests + the mechanical diff-review checklist below.**

Rationale: the helper is App-local and unexported; its only observable contract is
component behavior, and that behavior is already pinned densely — durable-bytes-
before-dispatch is asserted at the actual write boundary via `Storage.setItem` spies
(privateSceneTransaction :117/:355), every site's save-failure UX is exercised with
`failBothSaveWrites()`-style quota throws, and retryability is asserted per site.
A "red test for the helper" would either require exporting it (production change,
out of scope) or restate existing component tests. The one honest gap found: sites
3–6 had no assertion that a successful retry CLEARS the transaction alert (the
`setTransactionError(null)` clears the extraction is most likely to drop or
mis-wire). Closed with four green pins (below). The in-block statement ordering
that React batching makes unobservable is delegated to diff review, explicitly.

## Coverage inventory per site (pre-existing, all names verbatim)

**Site 1 — `commitPrivateScene`** (`tests/privateSceneTransaction.test.tsx` unless noted)
- Failure: `save failure preserves the prior record and reply draft, then end/skip make zero provider calls`
- Success + bytes-before-visibility: `persists the atomic player+NPC exchange before it becomes visible and rejects duplicate send`; `reaches the durable-write boundary with the candidate while reducer state and DOM still show the prior scene list`
- Error clear on success: `reports a no-longer-eligible private-scene target inside the dialog and permits retry` (appTransactionContracts C1 — asserts dialog alert null after retry commit)
- Lock semantics: `rejects a forced macro submit at handler level while a scene owns the central domain lock`

**Site 2 — TURN_COMMITTED**
- Failure: `rolls back a resolved turn when both autosave writes throw, leaves old bytes intact, and permits retry` (`tests/gmScreenSmoke.test.ts`); `leaves a pending outcome and reducer state untouched when the macro-turn autosave fails` (`tests/privateSceneTransaction.test.tsx`)
- Success + bytes-before-reducer-visibility + ref update: `projects one pending outcome, saves its consumption before reducer visibility, and never replays it to a later turn` (`tests/privateSceneTransaction.test.tsx`)
- `setTransactionError(null)` after dispatch: `keeps a failed non-turn alert until the next turn is durably committed, then clears it` (`tests/appTransactionContracts.test.ts`)
- committedTail branch: `keeps the durable commit and never rolls back or offers Retry when post-commit work throws` (C1)

**Site 3 — `startGameWithCharacter`** (`tests/appTransactionContracts.test.ts`)
- Failure + retry: `keeps CharacterSelection and the prior bytes when a new campaign cannot persist, then permits the same selection retry`
- GAP (closed): alert clear on successful retry → new pin.

**Site 4 — `handleSpendResource`**
- Failure + retry: `does not spend or display a Deep Analysis until the same state is durably saved, and keeps Commission retryable`
- GAP (closed): alert clear on successful retry → new pin.

**Site 5 — `handleInvestigationOutcome`**
- Failure + retry: `rolls back paid intel, knowledge, blackmail, fallout, hint, and display on write failure and retries the same reveal once`; also `awaits investigation extraction inside the atomic lease and retries without partial display, spend, fallout, knowledge, or save` (`tests/relationshipObservationCommit.test.ts`)
- Success-commit atomicity: `persists the investigation fallout hint in the same commit and renders it once after immediate reload`
- GAP (closed): alert clear on successful retry → new pin.

**Site 6 — `handleSetIntervention`**
- Success: `persists a GM directive immediately, with the v1 buildSaveState shape and one confirmation`
- Failure + retry: `does not confirm or change a GM directive when both writes fail, and leaves the exact directive retryable`
- GAP (closed): alert clear on successful retry → new pin.

**Site 7 — `handleEventChoice`**
- Failure + retry: `keeps a triggered event modal and all event/domain/transcript slices unchanged when its choice cannot persist`; `surfaces a failed event-choice save inside the modal dialog and keeps the choice retryable` (C1 — asserts alerts 0 after retry, pinning `setEventChoiceError(null)`)
- The success-path `setTransactionError(null)` half of the dual clear is unreachable-observable (see cross-site facts) — diff review only.

**New pins (this commit)** — `tests/appTransactionContracts.test.ts`, describe
`App commit-site success paths clear the transaction alert (Task 7 pins)`; all four
green pre-refactor:
- `clears the campaign-save alert when the same character selection retry durably commits [REGRESSION PIN]` (site 3)
- `clears the Deep Analysis alert when the same commission retry durably commits [REGRESSION PIN]` (site 4)
- `clears the investigation alert when the same reveal retry durably commits [REGRESSION PIN]` (site 5)
- `clears the GM directive alert when the same directive retry durably commits [REGRESSION PIN]` (site 6)

## Extraction diff-review checklist

Helper-level (once):
- [ ] Helper body is exactly: save → on failure `onSaveFailure()` then `return false` → `beforeDispatch?.()` → `dispatch(action)` → `onCommitted?.()` → `return true`. Nothing else — no logging, no extra state.
- [ ] Exactly ONE `saveGame(candidate)` call; only `.ok` consumed.
- [ ] Helper wrapped in `useCallback` with deps `[dispatch]`; every useCallback site that now references it adds it to its dep array; `npm run lint` baseline unchanged.
- [ ] No site's candidate construction, prechecks (`isCurrent()`, fingerprints), or post-commit tail moved into the helper.

Per site — the reviewer must confirm on the diff, for each:

**Site 1 (`commitPrivateScene`)**
- [ ] Both fingerprint prechecks remain OUTSIDE and above the helper call, unchanged.
- [ ] `onSaveFailure` sets the exact private-scene message; site does `return` the helper's boolean (`return commitDomainMutation({...})`).
- [ ] `beforeDispatch` = lock ref THEN scenes ref, in that order; `onCommitted` = `setPrivateSceneError(null)`.
- [ ] Action object `{ type: 'PRIVATE_SCENES_COMMITTED', privateScenes: candidateScenes }` unchanged.

**Site 2 (TURN_COMMITTED)**
- [ ] `onSaveFailure: () => { throw new Error('AUTOSAVE_FAILED'); }` — message string byte-identical; the throw escapes the helper into `executeTurn`'s catch.
- [ ] `beforeDispatch` = `committedTail = { diedThisTurn }` THEN `privateScenesRef.current = committedPrivateScenes` — committedTail FIRST (reducer-throw → post-commit branch invariant).
- [ ] `setTransactionError(null)` stays the first thing after dispatch (via `onCommitted` or inline immediately after the helper call — both are behavior-identical here since failure throws); the remaining success tail stays inline and unmoved.
- [ ] The helper's return value is not used to gate anything at this site.
- [ ] TURN_COMMITTED payload byte-identical (all 16 fields).

**Site 3 (`startGameWithCharacter`)**
- [ ] Failure maps to `if (!commitDomainMutation({...})) return;` — function stays void; onboarding block still runs ONLY on success (i.e., after the early return).
- [ ] `setTransactionError(null)` is in `beforeDispatch` (it precedes `GAME_STARTED` today), NOT `onCommitted`.
- [ ] Failure message `'Your campaign could not be saved. Please try again.'` exact.

**Site 4 (`handleSpendResource`)**
- [ ] `return commitDomainMutation({...})` (boolean passthrough); both `request.isCurrent()` guards stay outside.
- [ ] `setTransactionError(null)` in `beforeDispatch`; failure message `'Your change could not be saved. Please try again.'` exact.

**Site 5 (`handleInvestigationOutcome`)**
- [ ] The `if (!request.isCurrent()) return false;` immediately before the save stays immediately before the helper call.
- [ ] Candidate's conditional `messages: falloutMessage ? [...messages, falloutMessage] : messages` unchanged; `falloutMessage` still in the dispatch payload.
- [ ] `setTransactionError(null)` in `beforeDispatch`; failure message `'Your investigation could not be saved. Please try again.'` exact; site still returns `true` after the helper (or passes through).

**Site 6 (`handleSetIntervention`)**
- [ ] `return commitDomainMutation({...})`; `setTransactionError(null)` in `beforeDispatch`; failure message `'The directive could not be saved. Please try again.'` exact.

**Site 7 (`handleEventChoice`)**
- [ ] Failure channel is `setEventChoiceError('Your choice could not be saved. Please try again.')` ONLY — `transactionError` untouched on failure.
- [ ] `beforeDispatch` = `setTransactionError(null)` THEN `setEventChoiceError(null)` — both, that order, before dispatch. The dual clear survives.
- [ ] Void site: `if (!commitDomainMutation({...})) return;` or bare call — no new return value consumed.
- [ ] EVENT_CHOICE_APPLIED payload byte-identical.

## Post-extraction verification (from `roman_crisis_simulation/src`)

```
npm run typecheck
npm run lint            # baseline must be unchanged
npm test                # zero failures outside any still-red concurrent TDD suites
                        # (tests/turnActorsGate.test.ts was committed red for Task 4);
                        # the four Task 7 pins and every suite in the coverage
                        # inventory above MUST pass. At this doc's commit:
                        # 1567 passing with turnActorsGate excluded.
npm run test:journeys   # expect 10
```

Targeted fast loop while iterating:

```
npx vitest run tests/appTransactionContracts.test.ts tests/privateSceneTransaction.test.tsx tests/gmScreenSmoke.test.ts tests/relationshipObservationCommit.test.ts
```
