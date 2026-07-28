# Phase 6 No-Attempt Evidence Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace freeform AI-authored player responses on question-only and private-intent-only turns with a strict evidence-ID selector plus deterministic rendering, while leaving observable turns and all game mechanics unchanged.

**Architecture:** `turnSubmission.ts` classifies the response path, a pure `playerView/noAttemptResponse.ts` module owns evidence projection/validation/rendering, and a narrow AI adapter returns only evidence IDs. `runNewTurn` skips narration and monologue generation for no-attempt turns; `App.tsx` finalizes the safe response from the prospective player knowledge store before one atomic save/reducer commit.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 3 with jsdom and `react-dom`, Zod 4, `@google/genai` exclusively behind `ai/core/geminiService.ts`.

## Global Constraints

- All Gemini calls go through `ai/core/geminiService.ts` (`generateStructured`, `generateText`, or `generateTextStream`). Never call `ai.models.generateContent` directly and never hardcode model IDs.
- All prompt text lives in `ai/prompts/`, one file per call family, with an inventory entry in `ai/prompts/README.md`. Prompt and schema changes in `ai/core/schemas.ts` and `ai/core/zodSchemas.ts` land together.
- Player-facing code receives only perception-filtered data from `perception/visibility.ts` and the player knowledge store. Never render or send raw adjudication deltas, `gm_private`, truth-ledger fields, `secret_truth`, resolution/mortality traces, dice, outcome tiers, or hidden `SimulationState` detail.
- Private Intent is excluded from the selector, evidence, knowledge, perception, relationship mechanics, apparent ambition, and NPC minds. It stays in the approved player-owned/GM projections only.
- Only `player.status === 'dead'` is terminal. Do not add win states, quest UI, action economy, resolution changes, mortality changes, relationship calculations, NPC behavior changes, or simulation-rule changes.
- `SAVE_VERSION` remains `1`. Use existing `TurnHistoryEntry.narration` and messages; add no required persisted field. All committed state still goes through `buildSaveState` in `App.tsx`.
- Do not change `TurnStage`. If an implementation unexpectedly requires it, stop: `ai/core/turn.ts` and the exhaustive `Record<TurnStage, string>` in `components/Chat.tsx` would have to change together.
- Do not add dependencies. Use existing Vitest/jsdom/React test patterns.
- Every production behavior starts with a test that fails for the intended missing behavior. Never weaken or delete the RED assertion to obtain GREEN.
- No task may edit adjudication mechanics, mortality authorization, action resolution, NPC behavior, visibility rules, or system-design decision documents. Surface a concrete blocker instead.
- Every surfaced finding receives a binary disposition: fix it in this deployment, or stop for explicit owner adjudication. Do not label debt or defer a defect silently.

---

## File Map

**New focused modules**

- `roman_crisis_simulation/src/playerView/noAttemptResponse.ts`: pure player-safe evidence projection, selection validation, deterministic copy, and source labels.
- `roman_crisis_simulation/src/ai/prompts/noAttemptResponse.ts`: question/evidence selector prompt family.
- `roman_crisis_simulation/src/ai/tools/noAttemptResponse.ts`: Gemini-service adapter and safe fallback boundary.

**Existing integration points**

- `roman_crisis_simulation/src/playerInput/turnSubmission.ts`: named no-attempt response projection.
- `roman_crisis_simulation/src/ai/core/schemas.ts` and `zodSchemas.ts`: strict structured selector output.
- `roman_crisis_simulation/src/ai/core/turn.ts`: skip freeform player-output generation only when there is no observable attempt.
- `roman_crisis_simulation/src/App.tsx`: build prospective knowledge, select/render/finalize the response, and commit atomically.
- `roman_crisis_simulation/src/state/gameReducer.ts`: omit the monologue message when no monologue exists.

**Tests**

- `roman_crisis_simulation/src/tests/noAttemptResponse.test.ts`
- `roman_crisis_simulation/src/tests/noAttemptResponseSelector.test.ts`
- `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`
- `roman_crisis_simulation/src/tests/appTransactionContracts.test.ts`
- `roman_crisis_simulation/src/tests/gameReducer.test.ts`
- `roman_crisis_simulation/src/tests/journeys/structuredInput.journey.ts`

## Task 1: Pure No-Attempt Projection and Deterministic Response Contract

**Files:**

- Modify: `roman_crisis_simulation/src/playerInput/turnSubmission.ts`
- Create: `roman_crisis_simulation/src/playerView/noAttemptResponse.ts`
- Create: `roman_crisis_simulation/src/tests/noAttemptResponse.test.ts`

**Interfaces:**

- Consumes: `TurnSubmission`, `KnowledgeClaim[]`, and `KnowledgeSource`.
- Produces:

```ts
export type NoAttemptResponseProjection =
  | { kind: 'question'; question: string }
  | { kind: 'private_intent' }
  | null;

export function projectForNoAttemptResponse(
  submission: TurnSubmission
): NoAttemptResponseProjection;

export const MAX_NO_ATTEMPT_EVIDENCE = 60;
export const MAX_NO_ATTEMPT_SELECTION = 5;
export const NO_ATTEMPT_NO_ANSWER = 'Nothing in your current observations answers that yet.';
export const PRIVATE_INTENT_ACKNOWLEDGEMENT = 'Your private intent is noted. No action is taken on your behalf.';

export interface NoAttemptEvidence {
  id: string;
  source: KnowledgeSource;
  text: string;
}

export interface NoAttemptEvidenceSelection {
  decision: 'answer' | 'no_answer';
  evidenceIds: string[];
}

export type NoAttemptSelectionResult =
  | { kind: 'answer'; evidence: NoAttemptEvidence[] }
  | { kind: 'no_answer'; reason: 'no_evidence' | 'model_no_answer' | 'invalid_selection' | 'selector_failure' };

export function buildNoAttemptEvidence(knowledge: readonly KnowledgeClaim[]): NoAttemptEvidence[];
export function validateNoAttemptSelection(
  selection: NoAttemptEvidenceSelection,
  evidence: readonly NoAttemptEvidence[]
): NoAttemptSelectionResult;
export function renderNoAttemptResponse(result: NoAttemptSelectionResult): string;
```

- [ ] **Step 1: Write the failing projection tests**

Add table-driven tests proving:

```ts
expect(projectForNoAttemptResponse({
  version: 1,
  kind: 'structured',
  questionOrContext: 'What can I tell from the empty benches?',
})).toEqual({ kind: 'question', question: 'What can I tell from the empty benches?' });

expect(projectForNoAttemptResponse({
  version: 1,
  kind: 'structured',
  privateIntent: 'PRIVATE_SENTINEL',
})).toEqual({ kind: 'private_intent' });

expect(projectForNoAttemptResponse({
  version: 1,
  kind: 'structured',
  actions: ['Attend the Senate'],
  privateIntent: 'PRIVATE_SENTINEL',
  questionOrContext: 'Who is watching?',
})).toBeNull();
```

Also prove a question plus Private Intent returns only the exact question projection and that freeform submissions never classify as no-attempt.

- [ ] **Step 2: Write the failing evidence and rendering tests**

Use hand-built `KnowledgeClaim` fixtures with multiple updates and turns. Assert all of the following literal behavior:

- Newest updates appear first.
- Exact duplicate `(source, text)` pairs appear once.
- Only the newest 60 items survive.
- IDs are exactly `evidence-1` through `evidence-N` after ordering/deduplication.
- A polluted update cast with `secret_truth`, `gm_private`, `roll`, and `tier` properties produces evidence objects whose keys are exactly `id`, `source`, and `text`.
- `answer` with one to five unique offered IDs resolves to those canonical evidence objects in model-selected order.
- Unknown IDs, duplicate IDs, zero IDs for `answer`, more than five IDs, or nonempty IDs for `no_answer` resolve to `{ kind: 'no_answer', reason: 'invalid_selection' }`.
- Empty evidence is represented by `{ kind: 'no_answer', reason: 'no_evidence' }` before selection.
- Rendering is literal and deterministic:

```ts
expect(renderNoAttemptResponse({
  kind: 'answer',
  evidence: [{ id: 'evidence-1', source: 'network', text: 'Lucius left the forum before the vote.' }],
})).toBe('What you can currently tell:\n- Via your network: Lucius left the forum before the vote.');

expect(renderNoAttemptResponse({ kind: 'no_answer', reason: 'model_no_answer' }))
  .toBe(NO_ATTEMPT_NO_ANSWER);
```

Use one exhaustive `Record<KnowledgeSource, string>` with these fixed labels: `self` -> `From your own experience`, `witnessed` -> `You witnessed`, `network` -> `Via your network`, `public` -> `Common knowledge`, `scout` -> `From a scout`, `spy` -> `From a spy`, `merchant` -> `From a merchant`, `messenger` -> `From a messenger`, `rumor` -> `Rumor`.

- [ ] **Step 3: Run RED and record the intended failures**

Run from `roman_crisis_simulation/src`:

```powershell
npm test -- tests/noAttemptResponse.test.ts
```

Expected: FAIL because the new exports/modules do not exist. Syntax and fixture setup must otherwise compile.

- [ ] **Step 4: Implement the minimal pure modules**

Implement `projectForNoAttemptResponse` by checking `projectForResolution(submission)` first. If it is non-null, return `null`. Otherwise return the trimmed Question/Context when present, then `private_intent` when present, else `null`.

Implement evidence construction with field-by-field copies. Flatten every update as a local record with its `turn`, original claim index, and update index; sort by descending turn and stable original order; deduplicate on `${source}\u0000${text}`; slice to 60; then assign local IDs. Do not serialize or copy claim IDs, subjects, edges, credibility, relationship markers, or scheme discovery.

Implement semantic validation without coercion. Resolve the selected ID set, then filter the canonical evidence list so provider order cannot shape presentation. Never reuse text supplied by the model.

- [ ] **Step 5: Run GREEN, mutation-check, and commit**

```powershell
npm test -- tests/noAttemptResponse.test.ts tests/turnSubmission.test.ts
npm run typecheck
git diff --check
git add playerInput/turnSubmission.ts playerView/noAttemptResponse.ts tests/noAttemptResponse.test.ts
git commit -m "feat: define evidence-only no-attempt responses"
```

Mutation check: reverse the sort, copy the polluted update by spread, accept one unknown ID, and change one source label; each mutation must make at least one test fail.

## Task 2: Strict Gemini Evidence-ID Selector Boundary

**Files:**

- Create: `roman_crisis_simulation/src/ai/prompts/noAttemptResponse.ts`
- Create: `roman_crisis_simulation/src/ai/tools/noAttemptResponse.ts`
- Modify: `roman_crisis_simulation/src/ai/core/schemas.ts`
- Modify: `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/README.md`
- Modify: `roman_crisis_simulation/src/eval/harness.ts`
- Create: `roman_crisis_simulation/src/tests/noAttemptResponseSelector.test.ts`
- Modify: `roman_crisis_simulation/src/tests/evalHarness.test.ts`

**Interfaces:**

- Consumes: `GeminiClient`, exact Question/Context text, `NoAttemptEvidence[]`, and `isMockMode`.
- Produces:

```ts
export const NoAttemptEvidenceSelectionSchema;
export const zNoAttemptEvidenceSelection;

export function buildNoAttemptEvidenceSelectionPrompt(
  question: string,
  evidence: readonly NoAttemptEvidence[]
): { systemInstruction: string; prompt: string };

export async function selectNoAttemptEvidence(
  ai: GeminiClient,
  question: string,
  evidence: readonly NoAttemptEvidence[],
  isMockMode?: boolean
): Promise<NoAttemptSelectionResult>;
```

- [ ] **Step 1: Write failing schema/prompt boundary tests**

Create a fake `GeminiClient` at the existing `generateContent` seam and return JSON from the fake. Assert the actual captured request:

- uses call name `noAttemptEvidenceSelection` through `generateStructured`;
- uses the centralized `GEMINI_FLASH` model constant;
- includes the exact question;
- includes only `{ id, source, text }` evidence fields;
- excludes sentinels placed in extra runtime properties named `privateIntent`, `narration`, `gm_private`, `secret_truth`, `resolutionTrace`, `mortalityTrace`, `roll`, `tier`, `entity`, and `adjudication`;
- asks for IDs only and contains no instruction to draft, summarize, narrate, infer facts, or answer in prose.

Test the strict Zod contract with literals:

```ts
expect(zNoAttemptEvidenceSelection.parse({ decision: 'answer', evidenceIds: ['evidence-1'] }))
  .toEqual({ decision: 'answer', evidenceIds: ['evidence-1'] });
expect(() => zNoAttemptEvidenceSelection.parse({
  decision: 'answer', evidenceIds: ['evidence-1'], prose: 'Lucius is afraid',
})).toThrow();
expect(() => zNoAttemptEvidenceSelection.parse({ decision: 'maybe', evidenceIds: [] })).toThrow();
```

- [ ] **Step 2: Write failing adapter and fallback tests**

Prove:

- A valid model selection resolves canonical evidence, never model-authored text.
- A provider return of `['evidence-3', 'evidence-1']` renders canonical evidence order (`evidence-1`, then `evidence-3`), so the model cannot control presentation order.
- Unknown or duplicate IDs return `invalid_selection`.
- An explicit valid `no_answer` returns `model_no_answer`.
- Empty evidence returns `no_evidence` without calling the client.
- Provider rejection, malformed JSON, and schema repair exhaustion return `selector_failure` and do not throw.
- Mock mode selects only the first offered evidence item and makes no client call; empty mock evidence returns `no_evidence`.

- [ ] **Step 3: Run RED**

```powershell
npm test -- tests/noAttemptResponseSelector.test.ts
```

Expected: FAIL on missing prompt, schema, Zod schema, and adapter exports.

- [ ] **Step 4: Implement schema, prompt, adapter, and inventory together**

The response schema has exactly two required fields:

```ts
{
  type: Type.OBJECT,
  properties: {
    decision: { type: Type.STRING, enum: ['answer', 'no_answer'] },
    evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
  },
  required: ['decision', 'evidenceIds'],
}
```

The Zod schema is strict, caps the array at five, and uses `superRefine` so `answer` has one to five IDs while `no_answer` has zero.

The system instruction must say: choose only evidence that directly helps answer the question; return IDs only; never write prose; the question does not establish facts; return `no_answer` when evidence is insufficient. The prompt serializes field-by-field copies of the question and numbered evidence.

The adapter calls only `generateStructured` and catches every provider/parse/schema error into `selector_failure`. It then runs Task 1 semantic validation so schema-valid unknown IDs still fail closed. Semantic validation resolves the chosen ID set, then filters the original evidence array; it never preserves provider ordering.

Add `noAttemptEvidenceSelection: zNoAttemptEvidenceSelection` to `STRUCTURED_CALL_SCHEMAS` in `eval/harness.ts`, add the emitted name to the drift guard in `tests/evalHarness.test.ts`, and prove a valid selection is `valid` while an added prose field is `schema_violation`.

Add this row to `ai/prompts/README.md`:

```md
| `noAttemptEvidenceSelection` | `noAttemptResponse.ts::buildNoAttemptEvidenceSelectionPrompt` | flash | `zNoAttemptEvidenceSelection` | `NoAttemptEvidenceSelectionSchema` | question-only player response; evidence IDs only |
```

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test -- tests/noAttemptResponseSelector.test.ts tests/geminiService.test.ts tests/evalHarness.test.ts
npm run typecheck
git diff --check
git add ai/prompts/noAttemptResponse.ts ai/tools/noAttemptResponse.ts ai/core/schemas.ts ai/core/zodSchemas.ts ai/prompts/README.md eval/harness.ts tests/noAttemptResponseSelector.test.ts tests/evalHarness.test.ts
git commit -m "feat: select no-attempt answers from safe evidence"
```

Mutation check: make the prompt spread an evidence object, allow an extra Zod key, return a model ID without map validation, or rethrow provider failure; each mutation must be caught.

## Task 3: Suppress Freeform No-Attempt Narration and Monologue

**Files:**

- Modify: `roman_crisis_simulation/src/ai/core/turn.ts`
- Modify: `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- Modify: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`

**Interfaces:**

- Consumes: `projectForNoAttemptResponse(normalizedSubmission)` from Task 1.
- Produces: the existing `runNewTurn` result shape. For no-attempt turns only, `narration === ''`, `playerMonologue === ''`, and `suggestedActions` uses the existing deterministic fallback. All world/state/history fields still resolve normally.

- [ ] **Step 1: Replace no-attempt prose expectations with failing call-boundary tests**

In the real turn-pipeline harness, add question-only, private-only, and question-plus-private cases. For each, assert:

```ts
expect(h.order).not.toContain('playerMonologue');
expect(h.order).not.toContain('narration');
expect(result.narration).toBe('');
expect(result.playerMonologue).toBe('');
expect(result.suggestedActions).toEqual([
  'Consider your next move carefully.',
  'Consolidate your power.',
  'Seek new allies.',
]);
```

Also assert story relevance, adjudication, NPC/world evolution, simulation-state update, mortality checks when applicable, history creation, and the turn seed still execute. Assessment and relationship-update calls remain absent because there is no observable attempt.

Add an observable structured case containing Action + Question + Private Intent and assert narration/monologue still execute and receive the already-approved player-owned context.

- [ ] **Step 2: Prove streaming and poison outputs cannot cross the no-attempt path**

Pass `onNarrationChunk` and configure narration/monologue fakes with action, mechanics, and privacy poison. Assert neither fake is called, the callback receives nothing, and the turn does not depend on their poisoned values. Do not remove the existing player-boundary tests for observable narration.

- [ ] **Step 3: Run RED**

```powershell
npm test -- tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts
```

Expected: FAIL because current no-attempt turns still issue prose calls and return model text.

- [ ] **Step 4: Implement the conditional call suppression**

At the top of `runNewTurn`, derive `const noAttemptResponse = projectForNoAttemptResponse(normalizedSubmission)`. Keep the full adjudication/state pipeline unchanged.

In the existing parallel block:

```ts
const monologuePromise = noAttemptResponse
  ? Promise.resolve('')
  : getPlayerMonologue(
      ai,
      updatedPlayerEntity,
      transformedAdjudication.headlines,
      recentPlayerIntents,
      isMockMode,
    );

const narrationPromise = noAttemptResponse
  ? Promise.resolve('')
  : onNarrationChunk
    ? generateTextStream(ai, narrationRequest, (textSoFar) => {
        const displayText = narrationStreamGate(textSoFar);
        const completedText = playerVisibleStreamGate.push(displayText);
        if (completedText !== null) onNarrationChunk(completedText);
      })
    : generateText(ai, narrationRequest);
```

The prompt builder may remain local to the existing block, but the no-attempt branch must make no Gemini request and must never invoke the stream callback. Keep the existing `TurnStage` notifications; do not add or rename a stage. Keep all adjudication, mortality, state application, player-visible mechanics checks, and relationship-update rules unchanged.

For no-attempt results, parsing the empty narration yields no suggestions and therefore the existing three fixed fallback suggestions. Do not introduce alternative gameplay suggestions.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test -- tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts tests/playerBoundary.test.ts
npm run typecheck
git diff --check
git add ai/core/turn.ts tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts
git commit -m "fix: remove freeform output from no-attempt turns"
```

Mutation check: force either no-attempt branch to call narration or monologue, or classify an observable structured submission as no-attempt; the focused tests must fail.

## Task 4: Finalize and Commit the Safe Response Atomically

**Files:**

- Modify: `roman_crisis_simulation/src/App.tsx`
- Modify: `roman_crisis_simulation/src/state/gameReducer.ts`
- Modify: `roman_crisis_simulation/src/tests/appTransactionContracts.test.ts`
- Modify: `roman_crisis_simulation/src/tests/gameReducer.test.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/structuredInput.journey.ts`

**Interfaces:**

- Consumes: Task 1's projection/evidence/renderer, Task 2's selector, Task 3's empty no-attempt prose result, and the existing prospective `newKnowledge` computation.
- Produces: one finalized `TurnHistoryEntry`, GM message, optional monologue message, save payload, and reducer commit with identical response text.

- [ ] **Step 1: Write failing reducer/message tests**

Change `TURN_COMMITTED.monologueMessage` to `Message | null` and test both branches before implementation:

- A normal commit with a monologue preserves the exact message order: player, GM, Inner Thoughts, ribbon.
- A no-attempt commit with `monologueMessage: null` preserves player, GM, ribbon and contains no `player_monologue` message or empty bubble.

The reducer test must assert the real `messages` output array, not a mock call.

- [ ] **Step 2: Write failing App transaction and privacy tests**

Using the existing transaction test seam, prove this order:

```text
runNewTurn
  -> build perception-safe prospective knowledge
  -> select evidence IDs (question only)
  -> finalize history/message text
  -> saveGame(buildSaveState(...))
  -> TURN_COMMITTED
```

Assert these cases:

1. Question-only with a valid selection stores and renders exactly the deterministic answer; the same string appears in `TurnHistoryEntry.narration`, the GM message, save payload, and reducer action.
2. Question-only with no evidence, explicit no-answer, invalid IDs, schema failure, or provider failure stores the fixed no-answer string and still commits the already-resolved world turn once.
3. `invalid_selection` or `selector_failure` appends exactly `[No-attempt response] Evidence selection failed; the player received the safe no-answer fallback.` to a copied `adjudication.gm_private` array. The diagnostic contains no question, evidence, provider output, exception message, or sentinel. `no_evidence` and `model_no_answer` do not add an error diagnostic.
4. Private-only makes no selector call, stores the fixed acknowledgement, and commits no Inner Thoughts message.
5. Question plus Private Intent sends the question and evidence to the selector while the Private Intent sentinel is absent from the request and final answer.
6. Observable submissions do not call the selector and preserve current narration, monologue, streaming, and suggestions byte-for-byte.
7. A superseded transaction after selector resolution performs no save or reducer commit.
8. Save failure restores the exact draft and leaves all prospective response/knowledge changes uncommitted.

- [ ] **Step 3: Add a failing end-to-end journey**

Extend `structuredInput.journey.ts` to execute:

```text
question-only -> private-only -> structured Action + Question -> save -> reload
```

Use only the Gemini boundary as a fake. Assert:

- the question turn advances exactly one turn and renders only selected evidence;
- the private turn advances exactly one turn, shows the fixed acknowledgement, and has no Inner Thoughts bubble;
- the mixed turn uses ordinary narration/monologue and does not call the evidence selector;
- Private Intent remains collapsed in player history and visible in the GM artifact;
- no raw delta, `gm_private`, `secret_truth`, roll, trace, tier, or poison sentinel appears in player-visible messages;
- all three final responses survive save/reload exactly.

- [ ] **Step 4: Run RED**

```powershell
npm test -- tests/appTransactionContracts.test.ts tests/gameReducer.test.ts
npm run test:journeys -- tests/journeys/structuredInput.journey.ts
```

Expected: FAIL because App still commits raw `result.narration`, always appends a monologue, and never invokes the evidence selector.

- [ ] **Step 5: Implement atomic finalization in `App.tsx` and `gameReducer.ts`**

Derive the no-attempt projection once from the frozen submission. Keep a base history entry for computing the current perception digest. After `newKnowledge` is computed:

```ts
let finalNarration = result.narration;
let finalAdjudication = result.newHistoryEntry.adjudication;

if (noAttemptResponse?.kind === 'question') {
  const evidence = buildNoAttemptEvidence(newKnowledge);
  const selection = await selectNoAttemptEvidence(
    ai,
    noAttemptResponse.question,
    evidence,
    isMockMode,
  );
  if (!transaction.isCurrent()) return;
  finalNarration = renderNoAttemptResponse(selection);
  if (selection.kind === 'no_answer'
      && (selection.reason === 'invalid_selection' || selection.reason === 'selector_failure')) {
    finalAdjudication = {
      ...finalAdjudication,
      gm_private: [
        ...finalAdjudication.gm_private,
        '[No-attempt response] Evidence selection failed; the player received the safe no-answer fallback.',
      ],
    };
  }
} else if (noAttemptResponse?.kind === 'private_intent') {
  finalNarration = PRIVATE_INTENT_ACKNOWLEDGEMENT;
}
```

Build `historyEntryWithState` only after finalization, overriding both `narration` and `adjudication`. Then build `newTurnHistory`, the GM message, save payload, and reducer action from that finalized value.

Use one conditional array for save and reducer parity:

```ts
const monologueMessage: Message | null = result.playerMonologue
  ? { sender: 'player_monologue', text: result.playerMonologue }
  : null;
const committedMessages = [
  playerMessage,
  gmMessage,
  ...(monologueMessage ? [monologueMessage] : []),
  ribbonMessage,
];
```

The save gets `[...messages, ...committedMessages]`. The reducer receives the same message objects and conditionally appends the monologue. Do not persist selector IDs, diagnostic reasons, or evidence lists.

- [ ] **Step 6: Run GREEN, full adjacent gates, and commit**

```powershell
npm test -- tests/noAttemptResponse.test.ts tests/noAttemptResponseSelector.test.ts tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts tests/appTransactionContracts.test.ts tests/gameReducer.test.ts tests/playerSubmissionHistory.test.tsx
npm run test:journeys -- tests/journeys/structuredInput.journey.ts tests/journeys/saveReload.journey.ts
npm run typecheck
npm run build
npm run lint
git diff --check
git add App.tsx state/gameReducer.ts tests/appTransactionContracts.test.ts tests/gameReducer.test.ts tests/journeys/structuredInput.journey.ts
git commit -m "feat: commit safe no-attempt responses atomically"
```

Mutation check: commit `result.narration` instead of `finalNarration`, append an empty monologue, send knowledge before perception ingestion, include Private Intent in selector input, or save before selector completion; the focused tests or journey must fail.

## Per-Task Review Gate

After each task:

1. Record the task base and head SHAs.
2. Generate one review package containing the full task diff.
3. Dispatch a fresh Sol `xhigh` reviewer with the task brief, implementer report, review package, and Global Constraints above.
4. Require both verdicts: spec compliance and code quality.
5. Any Critical or Important finding returns to the same implementer for a RED-first fix, then receives a fresh scoped re-review. Do not proceed with an open finding.
6. Record every finding and disposition in this plan's SDD ledger.

## Final Whole-Branch Verification

After all four tasks pass their task reviews:

```powershell
npm run typecheck
npm test
npm run test:journeys
npm run build
npm run lint
git diff --check
```

Then run browser acceptance against the built application:

- Submit a question-only structured turn with known evidence and inspect the exact evidence-only answer.
- Submit a private-intent-only turn and inspect the fixed acknowledgement plus absence of Inner Thoughts.
- Submit an Action + Question turn and inspect ordinary streamed narration/monologue.
- Open player history and GM console; confirm Private Intent is collapsed for the player, present for the GM, and absent from the evidence-selector raw request.
- Save/reload and confirm all three responses survive exactly.

Generate a review package from the Phase 6 merge base through final head. Dispatch one fresh Sol `xhigh` whole-branch reviewer to check the approved design, every architecture invariant, test authenticity, and all deferred/parked ledger lines. One consolidated fix agent handles any final findings, followed by one scoped re-review.

Only after that review is clean may the controller merge this lane into `phase-6`, rerun the full command set in the hub checkout, update Phase 6 progress artifacts, and report the branch as complete.
