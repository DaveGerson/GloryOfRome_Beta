# Phase 6 Structured Input and Relationship Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP Chat/Structured turn composer and replace player-facing relationship scores and AI-authored self-reads with sourced, perception-safe observations, without changing hidden game mechanics.

**Architecture:** Two deep modules own the new seams. `playerInput/turnSubmission.ts` owns the versioned submission contract, canonical plaintext storage, validation, and named audience projections. `knowledge/relationships.ts` plus a fail-closed observation extractor turn only already-player-visible evidence into knowledge claims. React renders those projections; it never interprets raw adjudication, hidden relationship state, or secret entity state.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 3 with jsdom and `react-dom` (no React Testing Library), Zod 4, `@google/genai` behind `ai/core/geminiService.ts`.

## Global Constraints

- All Gemini traffic goes through `ai/core/geminiService.ts`; prompt builders live under `ai/prompts/`; every structured-output schema change updates `ai/core/schemas.ts`, `ai/core/zodSchemas.ts`, mocks, tests, and `ai/prompts/README.md` in the same task.
- Player surfaces consume only perception-safe projections. They never render raw `adjudication.deltas`, `gm_private`, rolls, outcome tiers, traces, hidden `SimulationState`, `secret_truth`, hidden relationship values, live NPC goals, or live NPC state narratives.
- Only `player.status === 'dead'` is terminal. This plan adds no win state, quest log, action-economy rule, resolution modifier, mortality rule, relationship calculation, or simulation rule.
- `SAVE_VERSION` stays at `1`. Structured turns use the existing required plaintext `TurnHistoryEntry.playerIntent`; new knowledge fields are optional so old saves load unchanged. Every committed state still flows through `buildSaveState` in `App.tsx`.
- Do not change `TurnStage`. If a task unexpectedly requires it, stop and return to owner review because `ai/core/turn.ts` and the exhaustive `Record<TurnStage, string>` in `components/Chat.tsx` must change together.
- Do not add dependencies. Component tests use jsdom, React 19 `act`, and `react-dom/client`, matching `tests/gmScreenSmoke.test.ts`.
- Task agents may not edit game mechanics or system-design decision documents. A newly discovered gameplay/design branch stops the task and becomes a short owner addendum; it is not decided inside an implementation lane.
- No finding may be left merely flagged. Fix it in this phase or stop with an explicit blocker. The current runtime exposes no Sonnet agent, so it cannot perform the mandatory Sonnet triage required before accepting debt.

## Plan Readiness and Owner Gates

The owner responses in `roadmaps/PHASE_6_PLAYER_INPUT_AND_OBSERVABILITY_GRILL.md` are the authoritative product packet. They settle the following implementation shape:

| Owner ruling | Executable interpretation |
|---|---|
| Q01/Q14 | Structured mode has repeatable `actions[]` and repeatable `{ recipient, command }[]` rows. Each recipient is either selected from perception-safe known entities or entered through “Someone else…”. It opens with one row of each type. A suggested-action pill appends an action and does not remove the remaining pills. |
| Q02/Q03 | Question/Context asks the GM to answer from the avatar's present viewpoint. It never authorizes an invented investigation or avatar action and never creates a roll by itself. |
| Q04/Q05 | Private Intent is player-owned context. The omniscient adjudicator, narrator, player monologue, player suggestions, player history, and GM console may see it. NPC minds, relationship mechanics, apparent ambition, knowledge, and perception may not. |
| Q06/Q08 | Add no player export feature. Store one compact canonical plaintext artifact in the existing `playerIntent`; parse it before every consumer and show Private Intent collapsed in player history. GM/debug artifacts retain the full submission. |
| Q09-Q11/Q13 | A nearby `Chat | Structured` control persists as a local UI preference. Each mode has a separate in-session draft; successful submission clears its draft. Chat keeps Enter-to-submit; Structured uses Enter for newline and Ctrl/Cmd+Enter to submit. |
| Q15 | Retry resends the exact normalized submission. The single-user MVP does not add submission IDs; an in-flight guard and atomic reducer commit must prove no duplicate turn. |
| Q16-Q19 | Personae shows natural-language evidence, exact sourced quotes, and an expandable timeline. It shows no relationship scores or engine interpretations, has no notes UI, and hides entities the player has not learned exist. A physical object may be evidence in an observation, but it is not a new dossier entity in this MVP. |
| Q20 | Every story needs executable evidence. Mocks may replace only the external Gemini boundary; normalization, projection, prompts, reducers, persistence, and rendering execute for real in tests. |

### Decision-to-task traceability

| Question | Owning task(s) | Primary proof |
|---|---|---|
| Q01 | 1, 3, 4, 5 | typed known/custom recipient round-trip, safe-option derivation, and composer tests |
| Q02 | 2, 8 | question-only pipeline and journey; no assessment or invented action |
| Q03 | 1, 2 | resolution/adjudication projection tests |
| Q04 | 1, 2, 7 | private-sentinel prompt capture across every consumer |
| Q05 | 4 | collapsed author-visible Private Intent rendering |
| Q06 | 4, 8 | no player export surface; full GM/debug artifact smoke |
| Q07 | 1 | typed union and one canonical serialization |
| Q08 | 1, 4 | plaintext history/save round-trip under save v1 |
| Q09 | 3 | visible adjacent `Chat | Structured` control |
| Q10 | 3 | guarded local preference tests |
| Q11 | 3, 4 | independent drafts, success clear, failure restore |
| Q12 | 0, 1 | exact 20,000-character boundary tests |
| Q13 | 3 | keyboard event tests for both modes |
| Q14 | 3 | multiple pill append test with pills retained |
| Q15 | 4 | exact retry and no-double-commit tests |
| Q16 | 5, 7 | player-safe evidence contract and atomic extraction wiring |
| Q17 | 5, 6 | exact evidence excerpt/provenance and timeline rendering |
| Q18 | 5, 6 | quote validation, prohibited-read render tests, hidden roster tests |
| Q19 | 6 | Personae test asserts no player-notes control |
| Q20 | 1-8 | completion matrix, full CI, browser smoke, final adversarial review |

The two addendum decisions are closed:

- A01 sets a synchronous local maximum of **20,000 characters across the canonical submitted artifact**. The composer reports characters, blocks over-limit submission, and never truncates.
- A02 sets a **known-entity selector plus “Someone else…” free text**. Selector options come only from the perception-safe known-entity read model. The composer never receives the full entity roster, and a selected entity that is no longer in the allowed option set fails validation rather than silently becoming custom text.

The implementation-model gate is also closed: David explicitly approved **`gpt-5.6-terra` at `medium`** as the substitute for unavailable Luna. RED remains `gpt-5.6-sol` at `high`; verification and final review remain `gpt-5.6-sol` at `xhigh`.

## Target Data Flow

```text
Chat draft ───────┐
                  ├─ validate/normalize ─ TurnSubmission ─ canonical plaintext ─ history/save/GM
Structured draft ┘                              │
                                                ├─ resolution projection ─ assessment
                                                ├─ separated projection ─ omniscient adjudicator
                                                ├─ player-owned projection ─ narration/monologue/suggestions
                                                └─ observable projection ─ apparent ambition only

observable submission/player-specific perceived digest/new reports/investigation report
                  │
                  └─ PlayerSafeEvidence ─ Gemini selector ─ strict validator ─ KnowledgeClaim
                                                                           │
                                            known-entity + timeline read model ─ Personae UI
```

The submission interface is the privacy test surface. Consumers do not receive `TurnSubmission` and choose fields ad hoc; they receive a named projection selected at the composition root. The relationship interface is likewise narrow: the selector receives evidence text plus an ID/name directory, never narration, current-event headlines, Private Intent, an `Entity`, `EventDelta`, adjudication, relationship record, or simulation state. Narration is deliberately excluded because it may be shaped by Private Intent; feeding it back into knowledge would semantically launder private motive even when no literal sentinel survives.

## Dependency and Parallelization Pass

```text
Wave 0: Task 0 — close owner/model gates and record the base
Wave 1: Task 1 — submission contract (shared dependency)
Wave 2: Task 2 — AI routing     ┐
        Task 3 — composer UI    ├─ independent isolated worktrees
        Task 5 — observations  ┘
Wave 3: Task 4 — App/history/retry/recipient wiring (depends on 1,2,3,5)
        Task 6 — Personae projection (depends on 5) — independent of Task 4
Wave 4: Task 7 — integrate observation pipeline (depends on 2,4,5,6)
Wave 5: Task 8 — integrated journeys, CI, browser smoke, final review
```

At most three task lanes run beside the controller. Every lane uses its own Git worktree and branch; the controller stays on `phase-6` for review and integration. No two agents edit the same worktree. Before each wave, the controller rebases task briefs on the actual integrated `phase-6` SHA and rechecks changed-file overlap.

## Per-Task Agent Workflow

Every implementation task follows this exact loop:

| Gate | Fresh agent | Required behavior | Evidence and stop rule |
|---|---|---|---|
| RED | `gpt-5.6-sol`, effort `high` | Read the task brief and approved decisions. Add tests only, through public seams. Run the focused command and commit the red tests. | The failure must name missing behavior. A passing test, syntax/setup error, assertion against internals, or unrelated failure blocks GREEN until the test is repaired. |
| GREEN | `gpt-5.6-terra`, effort `medium` | Read the task brief plus RED commit. Add the smallest coherent production implementation. Never weaken, delete, skip, or rewrite the RED assertions to gain green. Commit implementation after focused and adjacent tests pass. | Any conflict with an invariant or owner ruling stops the lane and returns a concrete blocker. |
| VERIFY | `gpt-5.6-sol`, effort `xhigh`, read-only | Inspect the task base through head, rerun focused and adjacent commands, check spec behavior, privacy, test authenticity, and code quality. | Every finding blocks integration. The verifier reports exact file/line, consequence, reproduction, and a concrete repair path. |
| FIX | Fresh `gpt-5.6-terra` `medium` agent | Receive the complete verifier finding set, fix all findings in one wave, run covering tests, and commit. | Dispatch a fresh Sol `xhigh` verifier. Repeat until clean. |
| INTEGRATE | Controller | Confirm commits and exit codes, integrate only the reviewed task branch into `phase-6`, and record the result in `.superpowers/sdd/progress.md`. | Agent prose alone is never completion evidence. |

When spawning a named model, use `fork_turns: "none"` and provide only the task brief, approved decisions, base SHA, required invariants, focused commands, and report path. The controller owns conflict resolution and plan bookkeeping; task agents do not merge one another.

## Task 0: Close Decisions, Preserve the Owner Packet, and Establish the Execution Base

**Files:**

- Modify: `roadmaps/PHASE_6_PLAYER_INPUT_AND_OBSERVABILITY_ADDENDUM_1.md` (owner only)
- Modify: `roadmaps/PHASE_6_PLAYER_INPUT_AND_OBSERVABILITY_GRILL.md` (controller promotion only; preserve authored wording)
- Modify: `roadmaps/DESIGN_DECISIONS.md` (controller promotion only)
- Create during execution: `.superpowers/sdd/progress.md`

- [x] David answered A01 and A02 directly in the addendum: 20,000 characters; known-entity selector plus custom free text.
- [x] Controller removed accidental trailing whitespace without changing owner prose and promoted the settled rulings into `DESIGN_DECISIONS.md` as D35-D36.
- [x] David approved the available `gpt-5.6-terra` at `medium` as the implementation/fix substitute.
- [ ] Run the current baseline from `roman_crisis_simulation/src`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:journeys
npm run build
```

Expected: all commands exit `0`. Record the output summary and `git rev-parse HEAD` in `.superpowers/sdd/progress.md`.

- [ ] Commit only the owner packet/decision promotion after David's answers are present.

```powershell
git add roadmaps/PHASE_6_PLAYER_INPUT_AND_OBSERVABILITY_GRILL.md roadmaps/PHASE_6_PLAYER_INPUT_AND_OBSERVABILITY_ADDENDUM_1.md roadmaps/DESIGN_DECISIONS.md .superpowers/sdd/progress.md
git commit -m "docs: settle phase 6 input and observability decisions"
```

## Task 1: Build the Canonical Turn Submission Module

**Files:**

- Modify: `roman_crisis_simulation/src/types.ts`
- Create: `roman_crisis_simulation/src/playerInput/turnSubmission.ts`
- Create: `roman_crisis_simulation/src/tests/turnSubmission.test.ts`

### RED — Sol `high`

- [ ] Add the public contract:

```ts
export const TURN_SUBMISSION_VERSION = 1 as const;

export interface KnownRecipientOption {
  entityId: string;
  displayName: string;
}

export type MessageRecipient =
  | { kind: 'known_entity'; entityId: string; displayName: string }
  | { kind: 'free_text'; text: string };

export interface MessageOrOrder {
  recipient: MessageRecipient;
  command: string;
}

export interface MessageOrOrderDraft {
  recipient:
    | { kind: 'known_entity'; entityId: string }
    | { kind: 'free_text'; text: string }
    | null;
  command: string;
}

export type TurnSubmission =
  | { version: 1; kind: 'freeform'; text: string }
  | {
      version: 1;
      kind: 'structured';
      actions?: readonly string[];
      messagesOrOrders?: readonly MessageOrOrder[];
      privateIntent?: string;
      questionOrContext?: string;
    };

export interface StructuredTurnDraft {
  actions: string[];
  messagesOrOrders: MessageOrOrderDraft[];
  privateIntent: string;
  questionOrContext: string;
}
```

- [ ] Test normalization, exact multiline round-trip, repeatable rows, omission of blanks, rejection of half-complete recipient/command rows, blank-artifact rejection, reserved-prefix freeform escape, legacy freeform parsing, malformed-envelope fail-closed behavior, and the exact 20,000-character boundary without truncation.
- [ ] Test both recipient variants. A selected known ID must exist in the supplied `KnownRecipientOption[]`, and its canonical `displayName` comes from that option rather than draft text. A stale/tampered ID fails validation. “Someone else…” trims and stores nonempty free text without inventing an entity ID.
- [ ] Pin audience separation with a private sentinel:

```ts
const submission: TurnSubmission = {
  version: 1,
  kind: 'structured',
  actions: ['Attend the Senate'],
  messagesOrOrders: [{
    recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
    command: 'Meet me at dusk',
  }],
  privateIntent: 'PRIVATE_SENTINEL_BACK_CLODIUS',
  questionOrContext: 'What can I infer from the empty benches?',
};

expect(projectForResolution(submission)).not.toContain('PRIVATE_SENTINEL');
expect(projectForExternalInference(submission)).not.toContain('PRIVATE_SENTINEL');
expect(projectForPlayerOwnedAi(submission)).toContain('PRIVATE_SENTINEL_BACK_CLODIUS');
```

- [ ] Prove question-only and private-only artifacts are valid but return `null` from `projectForResolution` and `projectForExternalInference`.

```powershell
npm test -- tests/turnSubmission.test.ts
```

Expected RED: module/imports do not exist or the named behaviors fail. Setup and syntax must otherwise succeed.

### GREEN — Terra `medium`

- [ ] Implement these named functions in `playerInput/turnSubmission.ts`:

```ts
export const TURN_SUBMISSION_PREFIX = 'GOR_TURN_SUBMISSION/1\n';
export const MAX_TURN_SUBMISSION_CHARACTERS = 20_000;

export function validateAndNormalizeTurnSubmission(
  draft: TurnSubmission | StructuredTurnDraft,
  context: { knownRecipients: readonly KnownRecipientOption[] }
): { ok: true; submission: TurnSubmission } | { ok: false; issues: TurnSubmissionIssue[] };

export function serializeTurnSubmission(submission: TurnSubmission): string;
export function deserializeTurnSubmission(text: string): TurnSubmission | null;
export function projectForResolution(submission: TurnSubmission): string | null;
export function projectForAdjudication(submission: TurnSubmission): {
  observableAttempt: string | null;
  privateIntent: string | null;
  questionOrContext: string | null;
};
export function projectForPlayerOwnedAi(submission: TurnSubmission): string;
export function projectForExternalInference(submission: TurnSubmission): string | null;
export function projectForPlayerHistory(submission: TurnSubmission): PlayerSubmissionHistory;
```

- [ ] Serialize structured submissions as the prefix plus compact deterministic JSON. Preserve ordinary freeform as raw text; envelope freeform text that begins with the reserved prefix. Treat malformed prefixed text as invalid, never as observable freeform.
- [ ] Render known recipients as `To: Lucius [lucius]` in AI projections and custom recipients as `To: the night watch`. Player history renders the human label without exposing an implementation-only ID.
- [ ] Keep projections named by consumer. Do not add a generic audience flag that lets callers casually select the wrong visibility.
- [ ] Preserve internal authored whitespace; trim only surrounding field/row whitespace. Enforce the settled combined boundary on the canonical serialized artifact and block rather than truncate.

```powershell
npm test -- tests/turnSubmission.test.ts
npm run typecheck
git add types.ts playerInput/turnSubmission.ts tests/turnSubmission.test.ts
git commit -m "feat: add canonical turn submission contract"
```

### VERIFY — Sol `xhigh`

- [ ] Rerun the focused test and typecheck.
- [ ] Inspect every exported projection with the sentinel; prove malformed canonical text fails closed and legacy text remains compatible.
- [ ] Confirm the module has no React, AI, storage, or game-mechanics dependency.

## Task 2: Route Submission Projections Through AI Boundaries

**Files:**

- Modify: `roman_crisis_simulation/src/ai/core/turn.ts`
- Modify: `roman_crisis_simulation/src/ai/mocks.ts`
- Modify: `roman_crisis_simulation/src/ai/tools/assessment.ts`
- Modify: `roman_crisis_simulation/src/ai/tools/ambition.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/assessment.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/adjudication.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/narration.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/ambition.ts`
- Modify: `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- Modify: `roman_crisis_simulation/src/tests/actionResolution.test.ts`
- Modify: `roman_crisis_simulation/src/tests/ambition.test.ts`
- Modify: `roman_crisis_simulation/src/tests/npcMinds.test.ts`
- Create: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`

### RED — Sol `high`

- [ ] Change test call sites to pass `TurnSubmission` into `runNewTurn` and capture every real prompt at the mocked Gemini service seam.
- [ ] Assert the Private Intent sentinel appears only in adjudication, narration/suggestions, and player monologue inputs. Assert it is absent from assessment, apparent ambition, NPC minds, Director/story relevance, private conversation, simulation update, relationship updates, knowledge inputs, and perception artifacts.
- [ ] Assert adjudication receives separately labeled `observableAttempt`, `privateIntent`, and `questionOrContext` blocks.
- [ ] Assert question-only/private-only turns skip assessment and create no resolution trace while still producing a GM response.
- [ ] Assert apparent-ambition inference receives neither Private Intent nor `active_scheme`, private goals, beliefs, or mechanical relationship values from the player entity.
- [ ] Pin the complete apparent-ambition player whitelist. Captured prompts may contain only this brief plus observable submissions and public headlines:

```ts
export interface ApparentAmbitionPlayerBrief {
  entityId: string;
  name: string;
  entityType: Entity['entity_type'];
  position?: string;
}
```

Assert the prompt excludes location, status, faction membership, resources, memories, visibility network, state narrative, goals, beliefs, schemes, secrets, and all relationship records. No raw `Entity` crosses this seam.
- [ ] Assert real and mock modes persist the same canonical `playerIntent`, and current-turn player-owned context is included in monologue generation.

```powershell
npm test -- tests/submissionPrivacy.test.ts tests/turnPipeline.test.ts tests/actionResolution.test.ts tests/ambition.test.ts tests/npcMinds.test.ts
```

Expected RED: raw-string call sites, prompt leaks, or missing skip behavior fail the assertions.

### GREEN — Terra `medium`

- [ ] Make `runNewTurn` accept an immutable `TurnSubmission`. Serialize once for history and derive named projections before any AI call.
- [ ] Pass only `projectForResolution` to assessment. If it is `null`, skip assessment and resolution entirely.
- [ ] Pass the separated object to the adjudication prompt. Its system instruction must state that Private Intent is goal context only: it grants no modifier, fact, concealment, NPC knowledge, or observable action. Question/Context asks for a player-view answer and cannot cause the avatar to investigate or act.
- [ ] Pass `projectForPlayerOwnedAi` to narration/monologue/suggestions with a matching non-leak instruction.
- [ ] Export `buildApparentAmbitionPlayerBrief` from `ai/prompts/ambition.ts` and construct the exact whitelisted `ApparentAmbitionPlayerBrief` above field by field. Pass only that brief, `projectForExternalInference`, and already-public headlines to apparent-ambition inference. Never pass a raw `Entity`, full serialized history, or `getEntityBrief(player)`.
- [ ] Do not pass submissions directly to NPC minds, relationship updates, Director, simulation updater, private conversations, knowledge, or perception.
- [ ] Keep all model constants and calls where they already belong; introduce no direct `ai.models.generateContent` call and no model ID.

```powershell
npm test -- tests/submissionPrivacy.test.ts tests/turnPipeline.test.ts tests/actionResolution.test.ts tests/ambition.test.ts tests/npcMinds.test.ts
npm run typecheck
npm run lint
git add ai/core/turn.ts ai/mocks.ts ai/tools/assessment.ts ai/tools/ambition.ts ai/prompts/assessment.ts ai/prompts/adjudication.ts ai/prompts/narration.ts ai/prompts/ambition.ts tests/submissionPrivacy.test.ts tests/turnPipeline.test.ts tests/actionResolution.test.ts tests/ambition.test.ts tests/npcMinds.test.ts
git commit -m "feat: route turn submissions by visibility"
```

### VERIFY — Sol `xhigh`

- [ ] Inspect all `playerIntent` and `TurnSubmission` call sites with `rg`; every consumer must use a named projection or the canonical persistence string.
- [ ] Run the focused suite and verify captured prompts, not mocked return values, carry the privacy proof.
- [ ] Confirm question-only turns produce no action assessment, die roll, resolution trace, or invented avatar action.

## Task 3: Build the Chat/Structured Composer as an Independent UI Module

**Files:**

- Create: `roman_crisis_simulation/src/playerInput/composerState.ts`
- Create: `roman_crisis_simulation/src/components/StructuredTurnComposer.tsx`
- Create: `roman_crisis_simulation/src/components/TurnComposer.tsx`
- Modify: `roman_crisis_simulation/src/components/Chat.tsx`
- Modify: `roman_crisis_simulation/src/persistence/uiPrefs.ts`
- Create: `roman_crisis_simulation/src/tests/composerState.test.ts`
- Create: `roman_crisis_simulation/src/tests/turnComposer.test.tsx`
- Modify: `roman_crisis_simulation/src/tests/uiPrefs.test.ts`

### RED — Sol `high`

- [ ] Test pure draft operations first:

```ts
const withFirstPill = appendSuggestedAction(emptyStructuredDraft(), 'Address the Senate');
expect(withFirstPill.actions).toEqual(['Address the Senate']);
expect(appendSuggestedAction(withFirstPill, 'Write to Lucius').actions)
  .toEqual(['Address the Senate', 'Write to Lucius']);
expect(addMessageOrOrderRow(emptyStructuredDraft()).messagesOrOrders)
  .toHaveLength(2);
```

- [ ] Test Chat is the first-run default, a valid stored mode restores, corrupt storage falls back to Chat, and storage exceptions do not crash.
- [ ] With React 19 `act` plus jsdom, prove the visible `Chat | Structured` control, four labels, initial action and recipient/command rows, `+` row controls, disabled processing state, accessible names/focus order, and remaining-character error/status at the 20,000-character boundary.
- [ ] Pass two `KnownRecipientOption`s and prove each Message/Order row renders only those options, an unselected placeholder, and “Someone else…”. Selecting “Someone else…” reveals a labeled free-text input; selecting a known entity removes that input without retaining its text in the draft. A hidden-name sentinel not present in the options must not appear anywhere in the DOM.
- [ ] Prove Structured Enter inserts a newline and Ctrl+Enter/Cmd+Enter submits; Chat keeps its existing Enter and Shift+Enter behavior.
- [ ] Prove mode switching preserves separate drafts; successful submit clears only the submitted draft; failed submit restoration accepts the exact prior draft.
- [ ] Prove clicking two suggested pills appends two action rows and both pills remain present.

```powershell
npm test -- tests/composerState.test.ts tests/turnComposer.test.tsx tests/uiPrefs.test.ts
```

Expected RED: new modules and UI controls are absent.

### GREEN — Terra `medium`

- [ ] Keep the component interface small:

```ts
export type ComposerMode = 'chat' | 'structured';

export interface TurnComposerProps {
  chatDraft: string;
  structuredDraft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  suggestedActions: string[];
  disabled: boolean;
  isProcessing: boolean;
  turnStage?: TurnStage | null;
  onChatDraftChange(value: string): void;
  onStructuredDraftChange(value: StructuredTurnDraft): void;
  onSubmit(input: string | StructuredTurnDraft): void;
}
```

- [ ] Keep draft manipulation in pure `composerState.ts`; React owns only event wiring and ephemeral display state.
- [ ] Extend `uiPrefs.ts` with guarded `getComposerMode()`/`setComposerMode()` and a dedicated key. Keep this preference out of save state.
- [ ] Render repeatable Actions and Messages/Orders; allow blank extra rows in the draft but let Task 1 normalization omit them. A row starts with an unselected recipient. Its `<select>` is built only from `recipientOptions` plus “Someone else…”, and custom mode renders a plain text field with browser autocomplete disabled. The component never accepts or inspects `Entity[]`.
- [ ] Render Private Intent with explicit private-to-the-avatar copy and Question/Context with explicit no-autonomous-action copy.
- [ ] Suggested pills call the append helper in Structured mode and the existing Chat behavior in Chat mode; they never submit or switch modes.

```powershell
npm test -- tests/composerState.test.ts tests/turnComposer.test.tsx tests/uiPrefs.test.ts
npm run typecheck
npm run lint
git add playerInput/composerState.ts components/StructuredTurnComposer.tsx components/TurnComposer.tsx components/Chat.tsx persistence/uiPrefs.ts tests/composerState.test.ts tests/turnComposer.test.tsx tests/uiPrefs.test.ts
git commit -m "feat: add structured turn composer"
```

### VERIFY — Sol `xhigh`

- [ ] Rerun tests and inspect keyboard events, labels, error association, tab order, disabled behavior, and mode persistence.
- [ ] Confirm no draft enters `localStorage`, save state, AI calls, or domain state before submission.
- [ ] Confirm this branch changes no game mechanic, prompt, schema, or reducer.

## Task 4: Integrate App Orchestration, History, Save Compatibility, and Exact Retry

**Depends on:** Tasks 1, 2, 3, and 5 integrated.

**Files:**

- Modify: `roman_crisis_simulation/src/App.tsx`
- Modify: `roman_crisis_simulation/src/components/Chat.tsx`
- Modify: `roman_crisis_simulation/src/components/GameMasterScreen.tsx`
- Modify: `roman_crisis_simulation/src/state/gameReducer.ts` only where existing action payload types/comments require the new submission representation
- Modify: `roman_crisis_simulation/src/tests/gameReducer.test.ts`
- Modify: `roman_crisis_simulation/src/tests/gmScreenSmoke.test.ts`
- Create: `roman_crisis_simulation/src/tests/playerSubmissionHistory.test.tsx`
- Modify: `roman_crisis_simulation/src/tests/persistence.test.ts`

### RED — Sol `high`

- [ ] Drive App through its real normalization, `runNewTurn`, reducer, and save seams. Prove one structured artifact yields one player message, one committed turn, and one history entry even with multiple actions/orders.
- [ ] Seed one visible-network NPC, one knowledge-discovered faction, and one hidden actor. Assert App passes only the first two through `knownRecipientOptionsForPlayer` to `TurnComposer`; selecting either serializes its stable ID/name, while “Someone else…” serializes only the authored free text. The hidden actor must be absent from both DOM and artifact unless the player independently types that name as custom text.
- [ ] Assert the player message and `TurnHistoryEntry.playerIntent` contain the identical canonical plaintext string.
- [ ] Assert a synchronous in-flight guard prevents two calls before React's processing render can disable the composer.
- [ ] Assert failure commits no entities, world, reports, truth ledger, knowledge, intents, turn history, narration, monologue, ribbon, or player message. While processing, the submitted artifact is a pending UI projection outside committed `messages`; on failure it disappears, the exact draft returns, and one non-persisted `role="alert"` retry notice remains.
- [ ] Assert Retry reuses the exact immutable normalized submission and a successful retry commits exactly once. Editing after restore creates a freshly normalized artifact.
- [ ] Pin transcript counts for fail → retry → success: before success there are zero new committed messages; after success there is exactly one player artifact, one GM narration, one monologue when produced, and one ribbon. The ephemeral error clears and never appears in save data.
- [ ] Render player history and prove Actions, Messages/Orders, and Question/Context are labeled; Private Intent is author-visible but collapsed by default. Legacy freeform remains one ordinary player bubble.
- [ ] Render GM history and prove all parsed fields, including Private Intent, are visible in the GM-only console.
- [ ] Load a version-1 legacy save containing raw `playerIntent` and prove it still renders as freeform. Save/reload a structured turn and prove the canonical string round-trips without a version bump or second persisted field.

```powershell
npm test -- tests/playerSubmissionHistory.test.tsx tests/gameReducer.test.ts tests/gmScreenSmoke.test.ts tests/persistence.test.ts
```

Expected RED: App still accepts a raw string and Chat renders canonical text as one undifferentiated bubble.

### GREEN — Terra `medium`

- [ ] Normalize at the App boundary, then hold the immutable submission for the complete attempt:

```ts
const turnInFlightRef = useRef(false);
const [retrySubmission, setRetrySubmission] = useState<TurnSubmission | null>(null);

async function executeTurn(submission: TurnSubmission): Promise<void> {
  if (turnInFlightRef.current) return;
  turnInFlightRef.current = true;
  const serialized = serializeTurnSubmission(submission);
  try {
    // player message, runNewTurn, atomic reducer commit, and buildSaveState
  } finally {
    turnInFlightRef.current = false;
  }
}
```

- [ ] Do not add submission IDs. Exactly-once behavior comes from the synchronous in-flight guard plus the existing single atomic `TURN_COMMITTED` reducer transition.
- [ ] Create one parsed structured-history renderer shared by committed player bubbles and GM presentation where practical. Player history uses native `<details>` or an equivalently accessible disclosure for Private Intent; GM history expands all fields.
- [ ] Keep failed drafts and the retry notice outside committed game state. Render the in-flight player artifact as pending UI, commit it only in the successful `TURN_COMMITTED` message batch, and clear the submitted mode only after the reducer/save commit succeeds.
- [ ] Derive `recipientOptions` once from `knownRecipientOptionsForPlayer(player, entities, knowledge)`, pass only that array to `TurnComposer`, and pass the same array into `validateAndNormalizeTurnSubmission`. Never pass the complete roster into a composer or validation helper.
- [ ] Feed apparent ambition with `projectForExternalInference(deserializeTurnSubmission(h.playerIntent))`, excluding invalid canonical entries and Private Intent, rather than raw history strings.
- [ ] Leave `persistence/saveGame.ts` shape and `SAVE_VERSION` unchanged unless a test proves validation needs an optional `KnowledgeClaim` field from Task 5; all App writes still call `buildSaveState`.

```powershell
npm test -- tests/playerSubmissionHistory.test.tsx tests/gameReducer.test.ts tests/gmScreenSmoke.test.ts tests/persistence.test.ts
npm test -- tests/turnSubmission.test.ts tests/submissionPrivacy.test.ts tests/turnComposer.test.tsx
npm run typecheck
npm run lint
git add App.tsx components/Chat.tsx components/GameMasterScreen.tsx state/gameReducer.ts tests/playerSubmissionHistory.test.tsx tests/gameReducer.test.ts tests/gmScreenSmoke.test.ts tests/persistence.test.ts
git commit -m "feat: integrate structured turns with retry and history"
```

### VERIFY — Sol `xhigh`

- [ ] Rerun both command groups and inspect the failed-turn/retry path for stale closures and duplicate commits.
- [ ] Confirm the same serialized string drives the player message, turn history, save, retry, and GM view; consumer prompts still receive projections rather than that raw string.
- [ ] Confirm old saves load, new saves remain version 1, and only `buildSaveState` persists committed state.

## Task 5: Create the Perception-Safe Relationship Observation Substrate

**Independent after Task 1. This task does not change relationship mechanics.**

**Files:**

- Modify: `roman_crisis_simulation/src/knowledge/store.ts`
- Modify: `roman_crisis_simulation/src/knowledge/commit.ts`
- Create: `roman_crisis_simulation/src/knowledge/relationships.ts`
- Create: `roman_crisis_simulation/src/ai/prompts/relationshipObservations.ts`
- Create: `roman_crisis_simulation/src/ai/tools/relationshipObservations.ts`
- Modify: `roman_crisis_simulation/src/ai/core/schemas.ts`
- Modify: `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/README.md`
- Create: `roman_crisis_simulation/src/tests/relationshipKnowledge.test.ts`
- Create: `roman_crisis_simulation/src/tests/relationshipObservationExtraction.test.ts`
- Modify: `roman_crisis_simulation/src/tests/knowledgeStore.test.ts`
- Modify: `roman_crisis_simulation/src/tests/knowledgeCommit.test.ts`
- Modify: `roman_crisis_simulation/src/tests/evalHarness.test.ts`
- Modify: `roman_crisis_simulation/src/tests/persistence.test.ts`

### RED — Sol `high`

- [ ] Pin the untrusted model output and trusted persisted marker:

```ts
export interface PlayerSafeEvidence {
  id: string;
  source: KnowledgeSource;
  text: string;
  /** Present only when a deterministic parser proves one unambiguous explicit attribution. */
  trustedQuote?: { speakerId: string; text: string };
}

export interface RelationshipObservationDraft {
  evidenceId: string;
  participantIds: string[];
  excerpt: string;
}

export interface RelationshipObservationMarker {
  evidenceId: string;
  participantIds: string[];
  quote?: { speakerId: string; text: string };
}
```

- [ ] Add an optional `relationshipObservation?: RelationshipObservationMarker` to `KnowledgeClaim`; test that legacy claims still parse and save under version 1.
- [ ] Test fail-closed validation: the evidence ID must exist; there must be at least two unique existing entity IDs; `excerpt` must be an exact substring of cited evidence; a previously unknown participant is allowed only when its display name occurs in the cited evidence. Persist the exact validated excerpt, never model-rewritten relationship prose.
- [ ] The model cannot author or attribute a quote. A deterministic evidence builder may attach `trustedQuote` only when one explicit speaker-name/verb/quoted-text pattern is unambiguous and the quote is an exact evidence substring. Copy that trusted value into the persisted marker only when its speaker is a validated participant and its text occurs in the selected excerpt. Ambiguous or multi-speaker prose renders as an ordinary sourced excerpt without quote attribution.
- [ ] Test that the trusted source is copied from `PlayerSafeEvidence`, never accepted from model output. Contradictory observations remain separate claims with unique keys such as `relationship-observation:{turn}:{ordinal}` and a single frozen initial update.
- [ ] Use polluted fixtures containing `secret_truth`, `gm_private`, raw deltas, roll/tier/trace values, entity goals, relationship values, and Private Intent. Assert none of those values or keys reach the prompt, validated drafts, knowledge claim, or serialized player artifacts.
- [ ] Assert the prompt receives only `{ id, source, text }[]` plus `{ entity_id, name }[]`; locally derived `trustedQuote` attribution is not sent to or editable by the model. It never receives `Entity`, relationships, `recent_interactions`, adjudication, `SimulationState`, schemes, or goals.
- [ ] Assert invalid structured output rejects at the tool boundary. A valid empty list means “no meaningful observation” and succeeds; Task 7 pins enclosing-turn rollback.
- [ ] Test the read model:

```ts
expect(isEntityKnownToPlayer(player, hiddenEntity, knowledge)).toBe(false);
expect(isEntityKnownToPlayer(player, observedEntity, knowledgeWithObservation)).toBe(true);
expect(relationshipTimelineFor(knowledgeWithContradictions, observedEntity.entity_id))
  .toHaveLength(2);
expect(knownRecipientOptionsForPlayer(player, entities, knowledge))
  .toEqual([{ entityId: observedEntity.entity_id, displayName: observedEntity.name }]);
```

Knownness may use only the player's `visibility_network`, the player's own faction ID, and player-held knowledge whose subject/observation participants name the candidate. It must not use the candidate's location, status, faction, relationships, goals, state narrative, scheme, or secret truth; it must not use the existence of a hidden engine relationship key.
- [ ] Test recipient options as the same knownness projection: exclude the player, include known individuals/groups/factions, sort by display name, and never inspect status to infer reachability. Selecting a recipient is an authored attempt, not proof they are alive, reachable, or obliged to obey. An off-network hidden-name sentinel must be absent.

```powershell
npm test -- tests/relationshipKnowledge.test.ts tests/relationshipObservationExtraction.test.ts tests/knowledgeStore.test.ts tests/knowledgeCommit.test.ts tests/evalHarness.test.ts
```

Expected RED: observation schema, extractor, ingestion, and read model are absent.

### GREEN — Terra `medium`

- [ ] Build `{ systemInstruction, prompt }` in `ai/prompts/relationshipObservations.ts`, inventory the family in `ai/prompts/README.md`, and call `generateStructured` through `geminiService.ts` from the tool. Use an existing model constant; never hardcode an ID.
- [ ] Add matching Gemini and Zod schemas in the same commit. Validate output field by field; do not spread untrusted output into knowledge.
- [ ] Make the model select exact evidence excerpts and participants, not author a relationship interpretation. The model schema contains no quote attribution, sentiment, direction, confidence, tier, score, or freeform analysis field.
- [ ] Make the tool accept only `PlayerSafeEvidence[]` and `{ entity_id, name }[]`; it cannot construct evidence from game state. Task 7 owns composition-root evidence construction and atomic commit wiring. A physical object may remain in evidence prose but does not become an entity participant or dossier.
- [ ] Add pure ingestion functions and optional `relationshipObservations` inputs to `computeTurnKnowledge`/`computeInvestigationKnowledge`. Stamp only the authoritative turn argument and do not mutate the prior store.
- [ ] Export `knownRecipientOptionsForPlayer(player, entities, knowledge): KnownRecipientOption[]` from `knowledge/relationships.ts`. Build each option field by field after `isEntityKnownToPlayer` passes; never map the full roster and filter later in a UI component.
- [ ] Bound new claims using the store's existing `MAX_KNOWLEDGE_CLAIMS`; do not create an unbounded parallel store.

```powershell
npm test -- tests/relationshipKnowledge.test.ts tests/relationshipObservationExtraction.test.ts tests/knowledgeStore.test.ts tests/knowledgeCommit.test.ts tests/evalHarness.test.ts
npm test -- tests/persistence.test.ts tests/dramatisPersonaeIntel.test.ts
npm run typecheck
npm run lint
git add knowledge/store.ts knowledge/commit.ts knowledge/relationships.ts ai/prompts/relationshipObservations.ts ai/tools/relationshipObservations.ts ai/core/schemas.ts ai/core/zodSchemas.ts ai/prompts/README.md tests/relationshipKnowledge.test.ts tests/relationshipObservationExtraction.test.ts tests/knowledgeStore.test.ts tests/knowledgeCommit.test.ts tests/evalHarness.test.ts tests/persistence.test.ts
git commit -m "feat: capture sourced relationship observations"
```

### VERIFY — Sol `xhigh`

- [ ] Inspect the entire extractor input construction, not only its type declarations. Use a sentinel grep and captured-prompt test to prove forbidden fields never cross the seam.
- [ ] Confirm source provenance and quote validation are deterministic, malformed output fails loudly, empty output succeeds, ingestion is idempotent for the same evidence ID, and legacy saves remain valid.
- [ ] Confirm `ai/core/engine.ts`, numeric relationship computation, resolution, mortality, and action economy are unchanged.

## Task 6: Remove Hidden Relationship Reads and Render Knowledge-Backed Personae

**Depends on:** Task 5 integrated.

**Files:**

- Modify: `roman_crisis_simulation/src/perception/visibility.ts`
- Modify: `roman_crisis_simulation/src/components/SidePanel.tsx`
- Modify: `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
- Modify: `roman_crisis_simulation/src/components/tabs/dramatisPersonaeIntel.ts`
- Create: `roman_crisis_simulation/src/components/tabs/RelationshipObservations.tsx`
- Modify: `roman_crisis_simulation/src/ai/mocks.ts`
- Modify: `roman_crisis_simulation/src/ai/tools/intelligence.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/intelligence.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/README.md`
- Modify: `roman_crisis_simulation/src/tests/perception.test.ts`
- Modify: `roman_crisis_simulation/src/tests/dramatisPersonaeIntel.test.ts`
- Create: `roman_crisis_simulation/src/tests/dramatisPersonaeTab.test.tsx`

### RED — Sol `high`

- [ ] Add `buildPlayerPerceivedDigest` tests proving `relation` deltas remain available to NPC perception through `buildPerceivedDigest` but are absent from the returned player digest and its tab metadata. Task 7 proves the integrated dispatch, knowledge, and pulse call sites.
- [ ] Render Personae with a deliberately poisoned entity graph and prove:

  - an alive off-network actor is absent;
  - a presumed-dead actor with `secret_truth.actually_alive` is absent;
  - a known actor appears with public name/position and “No observations yet” when appropriate;
  - an observation can make a previously unknown actor appear only when the cited evidence named them;
  - a known member of an unknown faction appears under “Other known figures,” without leaking the faction name;
  - latest evidence is compact, timeline disclosure expands all entries, exact quotes are visibly quoted, and contradictory observations coexist;
  - Trust, Respect, Threat, Alignment, Dependency, bars, arrows, heat/color, tiers, synthesized labels, `current_state_narrative`, `short_term_goals`, active scheme, and `secret_truth` never render.

- [ ] Test that the free **Raw Thoughts** self-read control and any player-notes control are absent. Paid investigations and Deep Analysis remain available only under their existing resource/sourcing rules.

```powershell
npm test -- tests/perception.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx tests/knowledgeStore.test.ts
```

Expected RED: current Personae exposes the complete alive roster, numeric mechanics, raw state/goals, and Raw Thoughts.

### GREEN — Terra `medium`

- [ ] Add a player-specific projection rather than changing NPC semantics:

```ts
export function buildPlayerPerceivedDigest(
  deltas: EventDelta[],
  player: Entity,
  entities: Entity[],
  world: WorldState
): PerceivedChange[] {
  return buildPerceivedDigest(deltas, player, entities, world)
    .filter(change => change.deltaType !== 'relation');
}
```

- [ ] Export the player projection for Task 7 to wire. Keep the existing `buildPerceivedDigest` behavior unchanged for NPC minds.
- [ ] Filter known entities before grouping. Reveal a faction heading only when the faction itself passes knownness; otherwise place known members under neutral “Other known figures.” Apply ordinary status display/filtering only after knownness so hidden status cannot establish identity.
- [ ] Replace the mechanical block with `RelationshipObservations`, showing the latest three items and an accessible timeline disclosure. Render claim provenance and turn/age without adding credibility-as-sentiment or an engine verdict.
- [ ] Remove `TrustBar`, numeric relationship fields, raw `current_state_narrative`, and `short_term_goals` from this player surface.
- [ ] Retire the free Raw Thoughts call family: remove its Personae control/state/dispatch, tool export, prompt builder, mock case, README inventory entry, and tests. Do not replace it with another synthesized self-read.
- [ ] Keep the hidden relationship records and GM console untouched. Do not delete the shared `TrustBar` component if another non-player consumer still uses it.

```powershell
npm test -- tests/perception.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx tests/knowledgeStore.test.ts
npm test -- tests/npcPerception.test.ts tests/npcMinds.test.ts tests/gmScreenSmoke.test.ts
npm run typecheck
npm run lint
git add perception/visibility.ts components/SidePanel.tsx components/tabs/DramatisPersonaeTab.tsx components/tabs/dramatisPersonaeIntel.ts components/tabs/RelationshipObservations.tsx ai/tools/intelligence.ts ai/prompts/intelligence.ts ai/prompts/README.md ai/mocks.ts tests/perception.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx
git commit -m "feat: render relationship evidence without hidden reads"
```

### VERIFY — Sol `xhigh`

- [ ] Inspect initial roster, faction grouping, and discovery against poisoned fixtures.
- [ ] Confirm the Personae component contains no hidden state or relationship interpretation while the GM console still has ground truth and NPC perception still functions.
- [ ] Run `rg -n "secret_truth" components --glob "!GameMasterScreen.tsx"` and require no output. Then inspect any `.secret_truth` access under `perception/` or `knowledge/`; comments and adversarial fixtures may name the field, but player read models may never access or serialize it.

## Task 7: Integrate Observation Extraction, Player Digest, and Atomic Knowledge Commits

**Depends on:** Tasks 2, 4, 5, and 6 integrated.

**Files:**

- Modify: `roman_crisis_simulation/src/App.tsx`
- Modify: `roman_crisis_simulation/src/knowledge/commit.ts`
- Modify: `roman_crisis_simulation/src/knowledge/relationships.ts`
- Modify: `roman_crisis_simulation/src/components/SidePanel.tsx`
- Modify: `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
- Modify: `roman_crisis_simulation/src/components/tabs/dramatisPersonaeIntel.ts`
- Create: `roman_crisis_simulation/src/tests/relationshipObservationCommit.test.ts`
- Modify: `roman_crisis_simulation/src/tests/knowledgeCommit.test.ts`
- Modify: `roman_crisis_simulation/src/tests/dramatisPersonaeIntel.test.ts`
- Modify: `roman_crisis_simulation/src/tests/dramatisPersonaeTab.test.tsx`
- Modify: `roman_crisis_simulation/src/tests/perception.test.ts`
- Modify: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`
- Modify: `roman_crisis_simulation/src/tests/gameReducer.test.ts`

### RED — Sol `high`

- [ ] Pin `buildTurnRelationshipEvidence` as a pure allowlist: it accepts only `projectForExternalInference(submission)`, `buildPlayerPerceivedDigest(...)`, and new Reports. It does not accept narration, current-event headlines, Private Intent, raw deltas, adjudication, traces, entity objects, relationships, goals, schemes, or simulation state.
- [ ] Add a semantic-laundering fixture where Private Intent says “poison Lucius” and narration paraphrases “the player secretly plans Lucius's death.” Assert neither phrase can enter `PlayerSafeEvidence` or the captured observation prompt because narration is outside the function's interface. Also prove a private-only submission produces no self evidence.
- [ ] Assert App calls extraction only after `runNewTurn` returns but before any reducer/save commit. This makes it structurally separate from hidden `getRelationshipUpdates`; hidden relationship output never selects, seeds, or suppresses a player observation.
- [ ] Assert validated drafts enter `computeTurnKnowledge` in the same reducer/save commit as narration and reports, stamped with App's authoritative turn. Failed extraction rolls back the whole turn, restores Task 4's pending/error UI, and retry commits each evidence ID once.
- [ ] Assert investigation extraction receives only the player-facing investigation report and ID/name directory, then lands in the existing atomic spend/fallout/knowledge commit. The callback is asynchronous; invalid extraction causes no display, spend, fallout, or knowledge commit.
- [ ] Add adversarial multi-speaker quote tests. Only an unambiguous deterministic `trustedQuote` may render with a speaker; ambiguous evidence renders the exact sourced excerpt without attribution.
- [ ] Assert every player-facing digest, Dispatches entry, knowledge ingestion, and tab pulse uses `buildPlayerPerceivedDigest`; relation deltas remain visible only to NPC perception and GM surfaces. Personae pulse is derived from relationship claims learned on the committed turn.

```powershell
npm test -- tests/relationshipObservationCommit.test.ts tests/knowledgeCommit.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx tests/perception.test.ts tests/submissionPrivacy.test.ts tests/gameReducer.test.ts
```

Expected RED: the safe evidence builder and async investigation contract are absent, App still uses `buildPerceivedDigest`, and commits have no observation-extraction gate.

### GREEN — Terra `medium`

- [ ] After `runNewTurn` returns, build `PlayerSafeEvidence[]` only from the observable submission projection, player-specific perceived digest, and new Reports, then await `getRelationshipObservations` before dispatch/save. Never use narration or headlines as evidence. This adds no `TurnStage` and changes no turn-engine mechanic.
- [ ] Keep raw model drafts inside the tool; App receives only validated observations. In mock mode, return a deterministic valid empty list or fixture-derived valid observations through the same validator.
- [ ] Pass validated observations into `computeTurnKnowledge` and `computeInvestigationKnowledge`; dispatch and `buildSaveState` receive the resulting single knowledge array.
- [ ] Change `onInvestigationOutcome` to return `Promise<void>` through `SidePanel` and `DramatisPersonaeTab`. Await App's extraction and atomic commit before putting the report into `uncoveredIntel`; on rejection, show an accessible error and leave display, resources, fallout, knowledge, and save untouched.
- [ ] Replace App's player call sites with `buildPlayerPerceivedDigest`. Do not change NPC call sites. Derive the Personae pulse from newly learned observation claims, never `relation` deltas.
- [ ] Preserve failure restoration from Task 4: no turn/resource/domain slice or committed transcript entry lands when observation extraction or validation rejects.

```powershell
npm test -- tests/relationshipObservationCommit.test.ts tests/knowledgeCommit.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx tests/perception.test.ts tests/submissionPrivacy.test.ts tests/gameReducer.test.ts
npm test -- tests/gameReducer.test.ts tests/persistence.test.ts tests/npcMinds.test.ts tests/gmScreenSmoke.test.ts
npm run typecheck
npm run lint
git add App.tsx knowledge/commit.ts knowledge/relationships.ts components/SidePanel.tsx components/tabs/DramatisPersonaeTab.tsx components/tabs/dramatisPersonaeIntel.ts tests/relationshipObservationCommit.test.ts tests/knowledgeCommit.test.ts tests/dramatisPersonaeIntel.test.ts tests/dramatisPersonaeTab.test.tsx tests/perception.test.ts tests/submissionPrivacy.test.ts tests/gameReducer.test.ts
git commit -m "feat: integrate player-safe relationship evidence"
```

### VERIFY — Sol `xhigh`

- [ ] Inspect actual input construction and App commit order with poisoned sentinels; type signatures alone are insufficient proof.
- [ ] Rerun both command groups and confirm semantic-laundering resistance, conservative quote attribution, loud turn/investigation rollback, exact retry, idempotent ingestion, authoritative turns, and no relation-delta player pulse.
- [ ] Confirm `ai/core/turn.ts`, the existing hidden relationship-update call, and `ai/core/engine.ts` are unchanged by this task.

## Task 8: Integrated Journeys, Accessibility, CI, Browser Smoke, and Final Review

**Depends on:** Tasks 1-7 integrated into `phase-6`.

**Files:**

- Create: `roman_crisis_simulation/src/tests/journeys/structuredInput.journey.ts`
- Create: `roman_crisis_simulation/src/tests/journeys/relationshipObservations.journey.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/saveReload.journey.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/harness.ts`

### ACCEPTANCE TEST AUTHORING — Sol `high`

- [ ] Add a mixed-mode journey that executes Chat → Structured with multiple actions plus one known-entity order and one “Someone else…” order → failure/retry → save/reload → Chat. Prove the hidden roster is absent, both recipient variants persist canonically, one turn commits per successful submission, retry is exact, drafts remain separate, Private Intent is collapsed, and no private sentinel enters forbidden call captures.
- [ ] Add a discovery journey where a hidden off-network actor is absent, appears after player-visible cited evidence, shows only that evidence, survives reload, and never exposes a presumed-dead actor's `secret_truth`.
- [ ] Add a question-only journey proving the GM answers from the avatar's available viewpoint without an action assessment, roll, resolution trace, or autonomous exploration.
- [ ] Make journey mocks replace only Gemini responses. They must execute real normalization, projections, prompt builders, turn orchestration, reducer transitions, knowledge ingestion, save/load, and rendering helpers.

```powershell
npm run test:journeys -- tests/journeys/structuredInput.journey.ts tests/journeys/relationshipObservations.journey.ts tests/journeys/saveReload.journey.ts
```

These acceptance tests may start green because Tasks 1-7 already completed their red/green loops. A green first run is valid only after the author demonstrates anti-vacuity: temporarily invert one relevant production guard in the isolated worktree, run the covering journey and observe the expected failure, restore the production file without committing the mutation, then rerun green.

### DEFECT FIX LOOP — Terra `medium`

- [ ] If a journey exposes a production defect, stop acceptance-test completion and dispatch a fresh `gpt-5.6-terra` `medium` fixer with the failing assertion, reproduction, and exact affected seam. Add a focused unit regression beside every production fix and commit that fix separately with explicit paths.
- [ ] Send the fix to a fresh Sol `xhigh` verifier and repeat until clean. Do not weaken a journey, replace a real helper with a mock, or move assertions to implementation details.
- [ ] Once the production range is clean, commit only the journey and harness files:

```powershell
npm run test:journeys -- tests/journeys/structuredInput.journey.ts tests/journeys/relationshipObservations.journey.ts tests/journeys/saveReload.journey.ts
npm test
npm run typecheck
npm run lint
git add tests/journeys/structuredInput.journey.ts tests/journeys/relationshipObservations.journey.ts tests/journeys/saveReload.journey.ts tests/journeys/harness.ts
git commit -m "test: cover phase 6 player input and observability journeys"
```

### VERIFY — Sol `xhigh`

- [ ] Inspect journey authenticity and run the full local CI sequence from `roman_crisis_simulation/src`:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:journeys
npm run build
```

All six commands must exit `0`. `npm ci` is included because it matches `.github/workflows/ci.yml`; do not infer CI health from a pre-existing `node_modules` tree.

- [ ] Start Vite for a manual browser-control smoke:

```powershell
npm run dev -- --host 127.0.0.1
```

Use the actual printed port. Verify:

1. Chat is default; Structured preference survives reload.
2. Drafts survive mode switching and clear only after successful submission.
3. Multiple actions and recipient/command rows work; pills append without disappearing; the selector contains only known entities plus “Someone else…”, whose free-text field works without hidden autocomplete.
4. Structured Enter inserts a newline; Ctrl/Cmd+Enter submits.
5. Question-only input receives a player-view answer without invented action.
6. Retry resends exact content and commits one turn.
7. Private Intent is collapsed in player history, complete in GM history, and absent from NPC/relationship/ambition/knowledge/perception outputs.
8. Unknown actors are absent; newly observed actors appear with sourced evidence and an expandable timeline, never scores/bars/hidden biography.
9. Save/reload preserves both structured history and relationship observations.
10. Keyboard focus, disclosure controls, labels, error announcements, and disabled states are usable.

Capture screenshots and the browser console result in `.superpowers/sdd/progress.md`. Any console error or failed story blocks final review.

## Final Whole-Branch Code Review

- [ ] After Task 8 is clean, dispatch one fresh **`gpt-5.6-sol` at `xhigh`** as an adversarial, read-only final reviewer.
- [ ] Review the fixed range from the Task 0 execution-base SHA through `phase-6` head along four axes:

  1. exact Q01-Q20/A01-A02 spec compliance;
  2. repository standards and all eight architecture invariants;
  3. test authenticity, including real seams beneath mocked Gemini;
  4. privacy/adversarial leakage, using poisoned sentinels and hidden-entity fixtures.

- [ ] Every finding must include current `file:line`, reproduction or failed assertion, concrete player/system consequence, and a repair path. Hypotheses must be labeled as hypotheses. The reviewer makes no edits.
- [ ] Send the complete finding set to one fresh `gpt-5.6-terra` `medium` fixer, add regression tests, rerun the full CI sequence and browser smoke, then dispatch a fresh Sol `xhigh` final reviewer. Repeat until the review has zero open findings.
- [ ] Do not merge, push, or delete worktrees as part of this plan unless David separately authorizes those operations.

## Completion Evidence Matrix

| Story | Required proof |
|---|---|
| Repeatable structured artifact | `turnSubmission.test.ts`, `composerState.test.ts`, `turnComposer.test.tsx`, structured-input journey |
| Visibility-safe recipient selector | knownness/option unit tests, composer DOM leak sentinel, App wiring test, mixed-mode journey |
| Private Intent boundaries | captured-prompt sentinel tests, history rendering test, GM smoke, final adversarial review |
| Question without invented action | projection unit test, turn-pipeline skip test, question-only journey, browser smoke |
| Exact retry and atomic commit | App/reducer tests, failed-attempt journey, save/reload journey |
| Save-v1 compatibility | legacy and new persistence tests, save/reload journey |
| No numeric/AI self-read | Personae render test, Raw Thoughts removal test, browser smoke |
| Hidden-until-observed entities | knownness unit tests, poisoned Personae test, relationship-observation journey |
| Sourced evidence and quotes | extractor validation tests, knowledge provenance test, timeline render test |
| No mechanics regression | action-resolution, NPC perception/minds, mortality-adjacent full suite, unchanged engine diff |
| Ship readiness | full CI exit `0`, browser console clean, final Sol `xhigh` review clean |

## Plan Self-Review Checklist

- [ ] Every Q01-Q20 ruling maps to at least one implementation task and one proof row.
- [x] A01/A02 and the Terra `medium` substitution are closed before RED begins.
- [ ] Every task names exact files, RED evidence, GREEN behavior, commands, commit, and independent verification.
- [ ] Prompt/schema pairs and README inventory changes land together.
- [ ] Private Intent has no generic downstream string path.
- [ ] Relationship observations originate only from player-visible evidence and cannot be selected by hidden mechanic state.
- [ ] Recipient selector options originate only from the known-entity read model; custom text never queries or reveals the hidden roster.
- [ ] The player-specific digest removes relationship deltas without changing NPC perception.
- [ ] Save version, terminal-state rule, hidden-roll rule, and GM-only ground truth remain unchanged.
- [ ] No unresolved finding is described as accepted debt.
