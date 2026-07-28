# Phase 6 Player-Initiated Private Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace autonomous off-screen conversation and duplicate relationship inference with one player-initiated private-scene micro-loop whose compact outcome is resolved only by the next main adjudication.

**Architecture:** A deep `privateScene/model.ts` module owns immutable eligibility, lifecycle, and audience projections. A single structured Gemini call family produces NPC dialogue plus a separately validated GM-private intent partition but no deltas. `App.tsx` owns save-before-reducer transactions; player UI receives only `perception/visibility.ts` projections, while the main adjudicator and participating NPC mind receive their own compact allowlisted projections.

**Tech Stack:** TypeScript 5.8, React 19, Vitest 3 + jsdom, Zod 4, Google GenAI through the existing Gemini service, localStorage save version 1.

## Global Constraints

- All Gemini calls go through `ai/core/geminiService.ts` (`generateStructured`, `generateText`, or `generateTextStream`). Never call `ai.models.generateContent` directly and never hardcode model IDs.
- All prompt text lives in `ai/prompts/`, one file per call family, with `{ systemInstruction, prompt }` builders and an inventory entry in `ai/prompts/README.md`. Prompt changes and schema changes in `ai/core/schemas.ts` and `ai/core/zodSchemas.ts` land together.
- Player-facing UI renders only perception-filtered data through `perception/visibility.ts`. It never receives raw adjudication deltas, `gm_private`, hidden `SimulationState`, `secret_truth`, NPC hidden intent, rolls, traces, dice, or outcome tiers.
- Only `player.status === 'dead'` may enter `GameState.GAME_OVER`. Private scenes never advance the macro turn, run resolution or mortality, apply deltas, fire events, or create win states.
- Save compatibility remains version 1. `privateScenes` is optional in `persistence/saveGame.ts`; absent data normalizes to `[]`. Every durable scene state passes through `App.tsx::buildSaveState`, saves successfully, and only then reaches the reducer.
- `components/Chat.tsx`'s exhaustive `Record<TurnStage, string>` changes in the same task as `ai/core/turn.ts::TurnStage`.
- Player Private Intent may reach player-owned narration, monologue, suggestions, player history, and the GM ledger. It never reaches objective adjudication, world state, NPC reasoning, relationship mechanics, apparent ambition, knowledge, perception, resolution, or private scenes.
- The main adjudicator is the only ordinary-turn source of relationship deltas. Player relationship observations remain a perception-safe presentation pipeline and never write numeric relationship state.
- NPC speech is an attributed claim, not truth. NPC sincerity, hidden intent, and plans are GM-private intent, not completed actions or world facts.
- One committed scene per macro turn; one active scene globally; one living known individual target who is co-located or in `player.visibility_network`; six NPC responses maximum; the accepted opening is response 1; refusal consumes the scene; last word is one-way and makes no provider call.
- No new runtime or test dependency. Tests exercise real helpers/components and include RED output before production changes.
- The implementation model is `gpt-5.6-sol` at xhigh reasoning. If that worker fails, use the owner-approved `gpt-5.6-terra` medium fallback. Task and final verification reviewers use `gpt-5.6-sol` at xhigh reasoning.

---

### Task 1: Enforce the hard player-Private-Intent boundary

**Files:**
- Modify: `roman_crisis_simulation/src/playerInput/turnSubmission.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/adjudication.ts`
- Modify: `roman_crisis_simulation/src/ai/core/turn.ts`
- Test: `roman_crisis_simulation/src/tests/turnSubmission.test.ts`
- Test: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`
- Test: `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- Test: `roman_crisis_simulation/src/tests/journeys/structuredInput.journey.ts`

**Interfaces:**
- Produces: `AdjudicationSubmissionProjection = { observableAttempt: string | null; questionOrContext: string | null }`.
- Preserves: `projectForPlayerOwnedAi` and `projectForNarration` may retain Private Intent; `projectForExternalInference` remains private-free.

- [ ] **Step 1: Write the failing projection and captured-request tests**

Add a literal poison value and assert the objective projection/request excludes it while player-owned projections retain it:

```ts
const submission: TurnSubmission = {
  version: 1,
  kind: 'structured',
  actions: ['Attend the Senate'],
  privateIntent: 'PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED',
};

expect(projectForAdjudication(submission)).toEqual({
  observableAttempt: 'Attend the Senate',
  questionOrContext: null,
});
expect(projectForPlayerOwnedAi(submission)).toContain('PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED');
expect(adjudicationCallText).not.toContain('PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED');
expect(narrationCallText).toContain('PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED');
expect(monologueCallText).toContain('PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED');
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/turnSubmission.test.ts tests/submissionPrivacy.test.ts tests/turnPipeline.test.ts`

Expected: FAIL because `projectForAdjudication` and the adjudication prompt still contain `privateIntent`.

- [ ] **Step 3: Narrow the objective projection and prompt**

Use this contract and remove the `privateIntent` prompt block entirely:

```ts
export interface AdjudicationSubmissionProjection {
  observableAttempt: string | null;
  questionOrContext: string | null;
}

export function projectForAdjudication(submission: TurnSubmission): AdjudicationSubmissionProjection {
  return submission.kind === 'freeform'
    ? { observableAttempt: submission.text, questionOrContext: null }
    : {
        observableAttempt: projectForResolution(submission),
        questionOrContext: submission.questionOrContext?.trim() || null,
      };
}
```

For no-attempt turns, pass `{ observableAttempt: null, questionOrContext: null }`. Keep the question as non-canonical context on mixed observable submissions; existing prompt rules must continue to forbid inventing an investigation or treating it as fact.

- [ ] **Step 4: Run GREEN and the structured journey**

Run: `npx vitest run tests/turnSubmission.test.ts tests/submissionPrivacy.test.ts tests/turnPipeline.test.ts`

Run: `npm run test:journeys -- tests/journeys/structuredInput.journey.ts`

Expected: PASS; the poison value exists only in player-owned calls/history and never in adjudication.

- [ ] **Step 5: Commit**

```powershell
git add roman_crisis_simulation/src/playerInput/turnSubmission.ts roman_crisis_simulation/src/ai/prompts/adjudication.ts roman_crisis_simulation/src/ai/core/turn.ts roman_crisis_simulation/src/tests/turnSubmission.test.ts roman_crisis_simulation/src/tests/submissionPrivacy.test.ts roman_crisis_simulation/src/tests/turnPipeline.test.ts roman_crisis_simulation/src/tests/journeys/structuredInput.journey.ts
git commit -m "fix: keep player private intent out of adjudication"
```

### Task 2: Retire competing conversation and relationship authorities

**Files:**
- Modify: `roman_crisis_simulation/src/ai/core/turn.ts`
- Modify: `roman_crisis_simulation/src/components/Chat.tsx`
- Modify: `roman_crisis_simulation/src/ai/tools/intelligence.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/intelligence.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/fragments.ts`
- Modify: `roman_crisis_simulation/src/ai/core/schemas.ts`
- Modify: `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
- Modify: `roman_crisis_simulation/src/ai/mocks.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/README.md`
- Modify: `roman_crisis_simulation/src/ai/core/turn_logic.md`
- Modify: `roman_crisis_simulation/src/eval/harness.ts`
- Modify: `roman_crisis_simulation/src/tests/evalHarness.test.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/harness.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/fixtures.ts`
- Test: `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- Test: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`
- Test: `roman_crisis_simulation/src/tests/npcMinds.test.ts`

**Interfaces:**
- Removes: `simulatePrivateConversation`, `getRelationshipUpdates`, `ConversationSimulationSchema`, `RelationshipDeltasSchema`, `zConversationSimulation`, `zRelationshipDeltas`, and the `private_conversation` / `relationship_updates` `TurnStage` variants.
- Preserves: main-adjudication `relation` deltas and player-safe `relationshipObservations` call family.

- [ ] **Step 1: Write failing single-authority tests**

Script the main adjudicator to return one directional relation delta and assert it is applied once with no secondary call:

```ts
expect(calls.filter(call => call.kind === 'relationshipUpdates')).toHaveLength(0);
expect(calls.filter(call => call.kind === 'privateConversation')).toHaveLength(0);
expect(result.newHistoryEntry.adjudication.deltas.filter(delta =>
  delta.type === 'relation' && delta.key === 'lucius:player:trust_level'
)).toHaveLength(1);
expect(result.updatedEntities.find(entity => entity.entity_id === 'lucius')
  ?.relationships.player.trust_level).toBe(6);
```

Add an exhaustive stage expectation that contains neither retired stage.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts tests/npcMinds.test.ts tests/evalHarness.test.ts`

Expected: FAIL because both provider calls and stages still exist.

- [ ] **Step 3: Delete the two call families and their application paths**

Remove step 2.5 and step 5.5 from `runNewTurn`. Delete the tool and prompt builders, paired schemas, mock, call classifiers, journey fixtures, inventory rows, and stale documentation. Update the stage union and exhaustive UI record in the same edit. Do not remove adjudication's directional relationship-delta rule or the separate player-facing relationship-observation extractor.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/turnPipeline.test.ts tests/submissionPrivacy.test.ts tests/npcMinds.test.ts tests/evalHarness.test.ts`

Run: `npm run typecheck`

Expected: PASS with no retired call name or stage reachable.

- [ ] **Step 5: Commit**

```powershell
git add roman_crisis_simulation/src/ai roman_crisis_simulation/src/components/Chat.tsx roman_crisis_simulation/src/eval roman_crisis_simulation/src/tests
git commit -m "refactor: make adjudicator sole consequence authority"
```

### Task 3: Build the pure private-scene domain model

**Files:**
- Create: `roman_crisis_simulation/src/privateScene/model.ts`
- Create: `roman_crisis_simulation/src/tests/privateSceneModel.test.ts`

**Interfaces:**
- Produces: canonical records, response/output types, eligibility, immutable lifecycle transitions, pending-outcome selection, and audience projections.
- Consumes: `Entity` and perception-safe known entity IDs; no AI, React, persistence, reducer, or raw simulation types.

- [ ] **Step 1: Write failing state-machine tests**

Cover this public contract with literal fixtures:

```ts
export const PRIVATE_SCENE_MAX_NPC_RESPONSES = 6;
export const PRIVATE_SCENE_MAX_UTTERANCE_CHARS = 2_000;

export type PrivateSceneStatus = 'active' | 'awaiting_last_word' | 'closed';
export type PrivateSceneClosureReason = 'refused' | 'player_ended' | 'npc_ended' | 'response_limit';
export type PrivateSceneSpeechActKind = 'claim' | 'disclosure' | 'request' | 'promise' | 'agreement' | 'refusal' | 'threat' | 'unclassified';
export type PrivateSceneSpeaker = 'player' | 'npc';

export interface PrivateSceneNpcPrivateState {
  sincerity: string;
  hiddenIntent: string;
  plannedFollowThrough: string[];
}

export interface PrivateSceneSpeechAct {
  speaker: PrivateSceneSpeaker;
  kind: PrivateSceneSpeechActKind;
  text: string;
  exchange: number;
}

export interface PrivateSceneModelResponse {
  disposition: 'refused' | 'continues' | 'ends';
  npcUtterance: string;
  speechActs: PrivateSceneSpeechAct[];
  npcPrivate: PrivateSceneNpcPrivateState;
}

export interface PrivateSceneRecord {
  sceneId: string;
  macroTurn: number;
  playerId: string;
  npcId: string;
  playerName: string;
  npcName: string;
  status: PrivateSceneStatus;
  transcript: Array<{ sequence: number; speaker: PrivateSceneSpeaker; text: string }>;
  npcResponseCount: number;
  speechActs: PrivateSceneSpeechAct[];
  npcPrivate: PrivateSceneNpcPrivateState;
  closureReason?: PrivateSceneClosureReason;
  lastWord?: string;
  consequenceStatus: 'pending' | 'consumed';
  consumedByTurn?: number;
}
```

Tests must prove: hidden/dead/self/non-individual/inaccessible targets fail; known co-located and network targets pass; any committed record consumes the macro turn's allowance; accepted opening is response 1; refusal awaits last word; seventh response fails; either side closes; last word is optional and one-time; stale scene ID/turn/status/count fails without mutation; no transition accepts or returns world/entity/delta state.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/privateSceneModel.test.ts`

Expected: FAIL because `privateScene/model.ts` does not exist.

- [ ] **Step 3: Implement minimal immutable transitions**

Export these functions with discriminated success/error results rather than throwing from normal invalid UI commands:

```ts
eligiblePrivateSceneTargets(input: {
  player: Entity;
  entities: Entity[];
  knownEntityIds: readonly string[];
}): Array<{ entityId: string; displayName: string }>;

beginPrivateScene(input: {
  sceneId: string;
  macroTurn: number;
  player: Entity;
  npc: Entity;
  opening: string;
  response: PrivateSceneModelResponse;
  existing: readonly PrivateSceneRecord[];
}): PrivateSceneTransitionResult;

appendPrivateSceneExchange(input: {
  scene: PrivateSceneRecord;
  expectedNpcResponseCount: number;
  playerUtterance: string;
  response: PrivateSceneModelResponse;
}): PrivateSceneTransitionResult;

endPrivateScene(scene: PrivateSceneRecord): PrivateSceneTransitionResult;
finalizePrivateScene(scene: PrivateSceneRecord, lastWord: string | null): PrivateSceneTransitionResult;
selectPendingPrivateSceneOutcome(scenes: readonly PrivateSceneRecord[]): PrivateSceneRecord | null;
consumePrivateSceneOutcome(scenes: readonly PrivateSceneRecord[], sceneId: string, consumedByTurn: number): PrivateSceneTransitionResult;
```

Use trimmed, nonempty strings, explicit length rejection, immutable arrays, and response-count predecessor checks. `unclassified` is reserved for a code-owned player last word and is never accepted from provider output.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/privateSceneModel.test.ts`

Expected: PASS with mutation checks covering wrong status, wrong count, seventh response, second last word, and duplicate macro-turn scene.

- [ ] **Step 5: Commit**

```powershell
git add roman_crisis_simulation/src/privateScene/model.ts roman_crisis_simulation/src/tests/privateSceneModel.test.ts
git commit -m "feat: define private scene state machine"
```

### Task 4: Add the strict private-scene Gemini call family

**Files:**
- Create: `roman_crisis_simulation/src/ai/prompts/privateScene.ts`
- Create: `roman_crisis_simulation/src/ai/tools/privateScene.ts`
- Modify: `roman_crisis_simulation/src/ai/core/schemas.ts`
- Modify: `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/README.md`
- Modify: `roman_crisis_simulation/src/ai/mocks.ts`
- Modify: `roman_crisis_simulation/src/eval/harness.ts`
- Create: `roman_crisis_simulation/src/tests/privateSceneAi.test.ts`
- Modify: `roman_crisis_simulation/src/tests/evalHarness.test.ts`

**Interfaces:**
- Consumes: `PrivateSceneModelResponse`, one NPC's bounded self brief, player-visible identity, and current scene transcript.
- Produces: strict `PrivateSceneModelResponse`; never `EventDelta` or world state.

- [ ] **Step 1: Write failing schema, adapter, and captured-prompt tests**

Test strict rejection of unknown keys and forbidden values:

```ts
expect(() => zPrivateSceneModelResponse.parse({
  disposition: 'continues',
  npcUtterance: 'I will consider it.',
  speechActs: [],
  npcPrivate: { sincerity: 'feigned', hiddenIntent: 'delay', plannedFollowThrough: [] },
  deltas: [{ type: 'relation', key: 'npc:player:trust_level', delta: 5 }],
})).toThrow();
```

Capture the actual `generateStructured` request and assert it excludes player Private Intent, other NPC secrets, raw deltas, truth flags, rolls, tiers, traces, unrestricted simulation state, and unrelated scene records. Assert mock mode makes zero provider calls.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/privateSceneAi.test.ts tests/evalHarness.test.ts`

Expected: FAIL because the prompt/tool/schema family does not exist.

- [ ] **Step 3: Implement prompt, schemas, and adapter together**

Add a `.strict()` Zod schema with bounded strings/arrays and a matching Gemini response schema. The system instruction must say that NPC speech may be false, `npcPrivate` is the NPC's current internal intent, no statement establishes world truth, and the response must contain no action resolution or deltas.

Expose one adapter:

```ts
export async function continuePrivateScene(
  ai: GoogleGenAI,
  input: PrivateScenePromptInput,
  isMockMode: boolean,
): Promise<PrivateSceneModelResponse>;
```

Use `generateStructured`, `GEMINI_PRO`, call name `privateScene`, and the paired schemas. Opening and later exchanges use the same call family. The deterministic mock supports accepted, refused, and ending responses without network access.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/privateSceneAi.test.ts tests/evalHarness.test.ts`

Run: `npm run typecheck`

Expected: PASS; the captured request contains only the participating NPC's bounded knowledge and scene dialogue.

- [ ] **Step 5: Commit**

```powershell
git add roman_crisis_simulation/src/ai roman_crisis_simulation/src/eval roman_crisis_simulation/src/tests/privateSceneAi.test.ts roman_crisis_simulation/src/tests/evalHarness.test.ts
git commit -m "feat: add private scene AI contract"
```

### Task 5: Persist and reduce private-scene state atomically

**Files:**
- Modify: `roman_crisis_simulation/src/persistence/saveGame.ts`
- Modify: `roman_crisis_simulation/src/state/gameReducer.ts`
- Modify: `roman_crisis_simulation/src/App.tsx`
- Test: `roman_crisis_simulation/src/tests/persistence.test.ts`
- Test: `roman_crisis_simulation/src/tests/gameReducer.test.ts`
- Test: `roman_crisis_simulation/src/tests/appTransactionContracts.test.ts`

**Interfaces:**
- Produces: optional `SaveGameState.privateScenes?: PrivateSceneRecord[]`, required in-memory `GameDomainState.privateScenes`, `PRIVATE_SCENES_COMMITTED`, and `TURN_COMMITTED.privateScenes`.
- Preserves: `SAVE_VERSION = 1`; all writes use `buildSaveState`.

- [ ] **Step 1: Write failing old-save, round-trip, and reducer tests**

Assert an old v1 object with no field loads as `[]`; active, awaiting-last-word, closed-pending, NPC-private, and consumed records round-trip byte-for-byte; `PRIVATE_SCENES_COMMITTED` changes only the scene slice; rollback/load restore it; a new campaign resets it; `TURN_COMMITTED` accepts the already-consumed candidate list.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/persistence.test.ts tests/gameReducer.test.ts tests/appTransactionContracts.test.ts`

Expected: FAIL because save/domain state has no `privateScenes` slice.

- [ ] **Step 3: Add the optional save field and required in-memory slice**

Use these actions:

```ts
| { type: 'PRIVATE_SCENES_COMMITTED'; privateScenes: PrivateSceneRecord[] }
| {
    type: 'TURN_COMMITTED';
    // existing fields unchanged
    privateScenes: PrivateSceneRecord[];
  }
```

Add `privateScenes: []` to initial state, `save.privateScenes ?? []` on load/rollback, reset it on game start, include it in `buildSaveState`, and leave `SAVE_VERSION` at 1. No scene state may be copied into `messages`, `Entity.memories`, knowledge, reports, or turn history.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/persistence.test.ts tests/gameReducer.test.ts tests/appTransactionContracts.test.ts`

Expected: PASS and all non-scene domain slices remain referentially unchanged on a scene-only reducer action.

- [ ] **Step 5: Commit**

```powershell
git add roman_crisis_simulation/src/persistence/saveGame.ts roman_crisis_simulation/src/state/gameReducer.ts roman_crisis_simulation/src/App.tsx roman_crisis_simulation/src/tests/persistence.test.ts roman_crisis_simulation/src/tests/gameReducer.test.ts roman_crisis_simulation/src/tests/appTransactionContracts.test.ts
git commit -m "feat: persist private scene state"
```

### Task 6: Wire the transactional scene micro-loop and player UI

**Files:**
- Create: `roman_crisis_simulation/src/components/PrivateScene.tsx`
- Modify: `roman_crisis_simulation/src/perception/visibility.ts`
- Modify: `roman_crisis_simulation/src/App.tsx`
- Modify: `roman_crisis_simulation/src/design/components.css`
- Create: `roman_crisis_simulation/src/tests/privateSceneUi.test.tsx`
- Create: `roman_crisis_simulation/src/tests/privateSceneTransaction.test.tsx`
- Modify: `roman_crisis_simulation/src/tests/appTransactionContracts.test.ts`

**Interfaces:**
- Consumes: eligible target options, `continuePrivateScene`, pure model transitions, and `GameDomainState.privateScenes`.
- Produces: player-only `PrivateScenePlayerView` from `perception/visibility.ts`; save-before-dispatch handlers for invite, reply, end, last word, and skip.

- [ ] **Step 1: Write failing player-projection and UI tests**

Add a player projection that deliberately has no `npcPrivate`, `consequenceStatus`, or `consumedByTurn` key:

```ts
const playerView = projectPrivateSceneForPlayer(rawRecord);
expect(playerView).toEqual({
  sceneId: rawRecord.sceneId,
  npcId: rawRecord.npcId,
  npcName: rawRecord.npcName,
  status: rawRecord.status,
  transcript: rawRecord.transcript,
  npcResponseCount: rawRecord.npcResponseCount,
  closureReason: rawRecord.closureReason,
  lastWord: rawRecord.lastWord,
});
expect(JSON.stringify(playerView)).not.toContain('HIDDEN_INTENT_POISON');
```

Render and drive: eligible-only target list; accepted opening; in-character refusal; six-response cap; early end; last word and skip; completed history; draft restoration; no duplicate send; hidden-intent sentinel absent from DOM.

- [ ] **Step 2: Write failing transaction tests**

Use deferred provider/save fixtures to prove: provider failure consumes nothing; save occurs before dispatch; save failure preserves draft and previous record; stale/double responses cannot append; last word and early end make no provider call; active/awaiting scenes block macro submit and every other domain mutation entry point.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/privateSceneUi.test.tsx tests/privateSceneTransaction.test.tsx tests/appTransactionContracts.test.ts`

Expected: FAIL because the player projection, component, and handlers do not exist.

- [ ] **Step 4: Implement the player projection and dedicated scene component**

`PrivateScene.tsx` receives only `PrivateScenePlayerView[]`, eligible `{ entityId, displayName }[]`, draft strings, loading/error state, and callbacks. It renders an accessible dialog/panel opened by a **Private scene** button beside the macro composer. It never imports `PrivateSceneRecord` or reads entities, knowledge, world, relationships, or GM fields.

- [ ] **Step 5: Implement save-before-dispatch handlers**

For every command:

```ts
const candidate = transition.value;
const candidateScenes = replaceScene(privateScenes, candidate);
if (!saveGame(buildSaveState({ privateScenes: candidateScenes })).ok) {
  setPrivateSceneError('The scene could not be saved. Your words remain ready to retry.');
  return false;
}
dispatch({ type: 'PRIVATE_SCENES_COMMITTED', privateScenes: candidateScenes });
return true;
```

Wrap async commands in `runDomainMutation`; verify scene ID, macro turn, expected status/count, and current transaction immediately before candidate construction and immediately before save. Render only eligible targets rather than disabled inaccessible targets. Treat any active or awaiting-last-word record as a domain-wide interaction lock between exchanges.

- [ ] **Step 6: Run GREEN**

Run: `npx vitest run tests/privateSceneUi.test.tsx tests/privateSceneTransaction.test.tsx tests/appTransactionContracts.test.ts`

Expected: PASS with zero provider calls for end, skip, and last word.

- [ ] **Step 7: Commit**

```powershell
git add roman_crisis_simulation/src/components/PrivateScene.tsx roman_crisis_simulation/src/perception/visibility.ts roman_crisis_simulation/src/App.tsx roman_crisis_simulation/src/design/components.css roman_crisis_simulation/src/tests/privateSceneUi.test.tsx roman_crisis_simulation/src/tests/privateSceneTransaction.test.tsx roman_crisis_simulation/src/tests/appTransactionContracts.test.ts
git commit -m "feat: add transactional private scene UI"
```

### Task 7: Route participant memory and one pending outcome into the main turn

**Files:**
- Modify: `roman_crisis_simulation/src/privateScene/model.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/adjudication.ts`
- Modify: `roman_crisis_simulation/src/ai/prompts/npcMind.ts`
- Modify: `roman_crisis_simulation/src/ai/tools/npcMind.ts`
- Modify: `roman_crisis_simulation/src/ai/core/turn.ts`
- Modify: `roman_crisis_simulation/src/ai/mocks.ts`
- Modify: `roman_crisis_simulation/src/App.tsx`
- Test: `roman_crisis_simulation/src/tests/privateSceneModel.test.ts`
- Test: `roman_crisis_simulation/src/tests/submissionPrivacy.test.ts`
- Test: `roman_crisis_simulation/src/tests/npcMinds.test.ts`
- Test: `roman_crisis_simulation/src/tests/turnPipeline.test.ts`
- Test: `roman_crisis_simulation/src/tests/appTransactionContracts.test.ts`

**Interfaces:**
- Produces: `PrivateSceneAdjudicatorProjection` and `PrivateSceneNpcMemoryProjection` with no raw record/transcript sharing.
- Consumes: at most one closed pending scene and only the participating NPC's bounded completed outcomes.

- [ ] **Step 1: Write failing audience-isolation tests**

Assert the adjudication request contains attributed speech acts, closure, optional last word, and a separately labeled NPC-internal-intent block, but excludes the full transcript and every unrelated scene. Assert the participating NPC mind receives its own bounded scene memory; another NPC mind receives none. Both requests exclude player Private Intent.

Use contradictory literals:

```ts
const npcSpeech = 'Three cohorts have sworn to me.';
const npcHiddenIntent = 'Bluff; only one cohort is loyal.';
const unrelatedTruth = 'WORLD_TRUTH_SENTINEL: exactly one cohort exists.';
```

The adjudicator sees the first as an attributed claim and the second as NPC intent. Extract and assert specifically against the private-scene prompt block so unrelated ordinary simulation context cannot produce a false-positive sentinel failure.

- [ ] **Step 2: Write failing consumption-transaction tests**

Prove a failed/retried macro turn leaves the pending record unchanged; the successful prospective `TURN_COMMITTED` save and reducer action mark it consumed together; a later turn does not send it again; and only relation/world deltas emitted by main adjudication change state.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/privateSceneModel.test.ts tests/submissionPrivacy.test.ts tests/npcMinds.test.ts tests/turnPipeline.test.ts tests/appTransactionContracts.test.ts`

Expected: FAIL because no audience projection reaches the main turn or NPC mind.

- [ ] **Step 4: Add compact audience projections**

`PrivateSceneAdjudicatorProjection` contains participant IDs/names, closure, attributed speech acts, optional last word, and latest NPC internal intent. It contains no transcript. `PrivateSceneNpcMemoryProjection` contains the participating NPC's bounded recent speech acts, closure, last word, and its own private state. Select at most the three most recent completed records for that NPC and never records for another NPC.

- [ ] **Step 5: Wire prompt blocks and macro-turn consumption**

Pass named projections through `RunNewTurnOptions`; never pass `PrivateSceneRecord[]` into `runNewTurn`. Add explicit prompt rules: speech is not truth, internal intent is not an accomplished action, and only adjudication deltas can create consequences. In `App.tsx`, consume the pending record only after `runNewTurn` succeeds and include the consumed candidate list in the same `nextSaveState` and `TURN_COMMITTED` action as every other macro-turn slice.

- [ ] **Step 6: Run GREEN**

Run: `npx vitest run tests/privateSceneModel.test.ts tests/submissionPrivacy.test.ts tests/npcMinds.test.ts tests/turnPipeline.test.ts tests/appTransactionContracts.test.ts`

Expected: PASS; the pending outcome is consumed exactly once and never directly mutates mechanics.

- [ ] **Step 7: Commit**

```powershell
git add roman_crisis_simulation/src/privateScene/model.ts roman_crisis_simulation/src/ai/prompts/adjudication.ts roman_crisis_simulation/src/ai/prompts/npcMind.ts roman_crisis_simulation/src/ai/tools/npcMind.ts roman_crisis_simulation/src/ai/core/turn.ts roman_crisis_simulation/src/ai/mocks.ts roman_crisis_simulation/src/App.tsx roman_crisis_simulation/src/tests
git commit -m "feat: route private scene outcomes through adjudication"
```

### Task 8: Complete player history, GM inspection, journeys, and acceptance

**Files:**
- Modify: `roman_crisis_simulation/src/components/PrivateScene.tsx`
- Modify: `roman_crisis_simulation/src/components/GameMasterScreen.tsx`
- Modify: `roman_crisis_simulation/src/App.tsx`
- Modify: `roman_crisis_simulation/src/tests/gmScreenSmoke.test.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/harness.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/fixtures.ts`
- Create: `roman_crisis_simulation/src/tests/journeys/privateScene.journey.ts`
- Modify: `roman_crisis_simulation/src/tests/journeys/saveReload.journey.ts`

**Interfaces:**
- Player history consumes only `PrivateScenePlayerView[]`.
- GM console may consume raw `PrivateSceneRecord[]` and is the only rendered surface for `npcPrivate`.

- [ ] **Step 1: Write failing GM and journey tests**

Test that completed player history shows the full perceived transcript, closure, and last word but no hidden-intent/mechanics sentinel. Test that the GM console shows transcript, speech acts, sincerity, hidden intent, plans, pending/consumed state, and no prompt text persisted in the save.

Create a deterministic journey covering:

1. Known-but-inaccessible NPC omitted; co-located and network NPCs eligible.
2. Accepted opening counted as response 1.
3. Reload while active resumes the exact transcript and count.
4. NPC claim contradicts hidden intent without becoming world truth.
5. Six responses close naturally; one-way last word makes no call.
6. Next macro turn receives compact outcome and consumes it once.
7. Refusal on the next macro turn consumes that turn's allowance and preserves the last word across reload.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/gmScreenSmoke.test.ts`

Run: `npm run test:journeys -- tests/journeys/privateScene.journey.ts tests/journeys/saveReload.journey.ts`

Expected: FAIL because GM rendering and the end-to-end fixtures are incomplete.

- [ ] **Step 3: Implement history and GM rendering**

Pass raw records only to `GameMasterScreen`. Label the hidden partition **NPC private intent — GM only**. Keep the player history inside `PrivateScene.tsx`, using only the player projection. Do not add scene data to ordinary `Message` bubbles.

- [ ] **Step 4: Run focused GREEN**

Run: `npx vitest run tests/gmScreenSmoke.test.ts tests/privateSceneUi.test.tsx`

Run: `npm run test:journeys -- tests/journeys/privateScene.journey.ts tests/journeys/saveReload.journey.ts`

Expected: PASS; poison sentinels prove the information partition.

- [ ] **Step 5: Run the complete automated gate**

Run from `roman_crisis_simulation/src`, each command separately:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:journeys
npm run eval
npm run build
git diff --check
```

Expected: every command exits 0. Lint output must match the repository's exact accepted warning manifest; no warning identity may be added or substituted.

- [ ] **Step 6: Commit**

```powershell
git add roman_crisis_simulation/src/components/PrivateScene.tsx roman_crisis_simulation/src/components/GameMasterScreen.tsx roman_crisis_simulation/src/App.tsx roman_crisis_simulation/src/tests
git commit -m "test: verify private scene boundaries end to end"
```

- [ ] **Step 7: Interactive browser acceptance**

In real provider mode when a key is available, otherwise deterministic mock mode, verify: target filtering, accepted scene, refusal, exchange counter, sixth-response closure, early end, optional last word, no response to last word, reload/resume, completed player history, GM-only hidden intent, main-turn consequence handoff, and no browser console errors.

Record the exact mode, observed results, and any provider limitation in the SDD ledger. Browser smoke supplements the automated gate; it does not replace it.
