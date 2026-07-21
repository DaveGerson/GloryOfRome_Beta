# AI Prompts

Every prompt sent to Gemini lives here, one file per call family, instead
of as inline template literals scattered through `ai/core/turn.ts`,
`ai/core/engine.ts`, `ai/tools/intelligence.ts`, `ai/core/initiator.ts`, and
`ai/tools/characterCreator.ts`. Every call site routes through
`ai/core/geminiService.ts` (`generateStructured`/`generateText`), passing
one of the builders below.

## Prompt inventory

| Call name | Builder | Model | Zod schema | Gemini schema | Pipeline stage |
|---|---|---|---|---|---|
| `assessment` | `assessment.ts::buildActionAssessmentPrompt` | flash | `zActionAssessment` | `ActionAssessmentSchema` | `turn.ts` step 0 (resolution layer gatekeeper, concurrent with `storyRelevance`) |
| `adjudication` | `adjudication.ts::buildAdjudicationPrompt` | pro | `zAdjudication` | `AdjudicationSchema` | `turn.ts` step 2 (main turn) |
| `narration` | `narration.ts::buildNarrationPrompt` | pro | - (prose) | - | `turn.ts` step 5 |
| `playerMonologue` | `narration.ts::buildPlayerMonologuePrompt` | flash | - (prose) | - | `turn.ts` step 4 |
| `storyRelevance` | `intelligence.ts::buildStoryRelevancePrompt` | pro | `zStoryRelevance` | `StoryRelevanceSchema` | `turn.ts` step 0 (Director) |
| `updatedSimulationState` | `intelligence.ts::buildSimulationStateUpdatePrompt` | pro | `zSimulationState` | `SimulationStateSchema` | `turn.ts` step 2.5 |
| `relationshipUpdates` | `intelligence.ts::buildRelationshipUpdatesPrompt` | pro | `zRelationshipDeltas` | `RelationshipDeltasSchema` | `turn.ts` step 5.5 |
| `privateConversation` | `intelligence.ts::buildPrivateConversationPrompt` | pro | `zConversationSimulation` | `ConversationSimulationSchema` | `turn.ts` step 2.5 (off-screen sim) |
| `mortalityValidation` | `mortality.ts::buildMortalityValidationPrompt` | pro | `zMortalityValidation` | `MortalityValidationSchema` | `turn.ts` step 2.6 (`ai/core/mortality.ts::processMortality`, gate 1) |
| `mortalityOutcome` | `mortality.ts::buildMortalityOutcomePrompt` | pro | `zMortalityOutcome` | `MortalityOutcomeSchema` | `turn.ts` step 2.6 (`ai/core/mortality.ts::processMortality`, gate 3) |
| `investigation` | `intelligence.ts::buildInvestigationPrompt` | pro | `zInvestigationResult` | `buildInvestigationResultSchema(subject)` | Player-triggered intel action |
| `clarification` | `intelligence.ts::buildClarificationPrompt` | flash | - (prose) | - | Player-triggered intel action |
| `rawThoughts` | `intelligence.ts::buildRawThoughtsPrompt` | flash | - (prose) | - | Player-triggered intel action |
| `deepAnalysis` | `intelligence.ts::buildDeepAnalysisPrompt` | flash | - (prose) | - | Player-triggered intel action |
| `scenarioStructure` | `worldGen.ts::buildScenarioStructurePrompt` | pro | `zScenarioStructure` | `ScenarioStructureSchema` | `initiator.ts` Step 1 (world skeleton) |
| `entityBatch` | `worldGen.ts::buildEntityBatchPrompt` | pro | `zEntityBatch` | `EntityListSchema` | `initiator.ts` Step 2 (fill in entities) |
| `characterCreation` | `characterCreation.ts::buildCharacterCreationPrompt` | pro | `zEntity` | `CharacterCreationEntitySchema` | Player character creation |
| `ambitionInference` | `ambition.ts::buildAmbitionInferencePrompt` | flash | `zAmbitionInference` (local to `ai/tools/ambition.ts`) | `AmbitionInferenceSchema` (local to `ai/tools/ambition.ts`) | `App.tsx` `executeTurn`, every 3rd committed turn (D8, fire-and-forget) |
| `epilogue` | `epilogue.ts::buildEpiloguePrompt` | pro | - (prose) | - | `components/EpilogueScreen.tsx`, once per run on `GameState.GAME_OVER` |
| `evalJudge` | `evalJudge.ts::buildEvalJudgePrompt` | flash | `zEvalJudgeVerdict` | `EvalJudgeVerdictSchema` | Offline eval runner ONLY (`eval/judge.ts::judgeTurn` via `npm run eval`, D18) - never called from app code, and only invoked when a real API key is present |

`ambitionInference`'s zod/Gemini schemas are deliberately NOT in
`ai/core/zodSchemas.ts`/`ai/core/schemas.ts` - they're small, stable, and
owned entirely by the D8 ambition-inference feature, defined locally in
`ai/tools/ambition.ts` instead of touching those two shared files (owned by
a concurrent workstream as of Phase 2 Stage B). `epilogue` has no
`ai/tools/epilogue.ts` at all - the call is orchestrated directly inside
`EpilogueScreen.tsx`, since the "tool" here is small enough to live
alongside the component's own loading/fallback state rather than as a
separate wrapper.

(`entityBatch` runs once per parallel NPC batch at runtime; its actual
`callName` is suffixed per batch, e.g. `entityBatch:Player`,
`entityBatch:NPCs_1` - see `ai/core/initiator.ts::generateEntityBatch`.)

`fragments.ts` holds the shared, reusable text builders (entity briefs,
world-state summary, GM-intervention block, story-evolution block,
relationship serialization, the GM-secret secretly-alive-entities block)
that more than one prompt above pulls from - it is the one source of truth
for each fragment; nothing else re-serializes state inline.

## The mortality pipeline: the model never decides death

`mortalityValidation` and `mortalityOutcome` (`ai/prompts/mortality.ts`,
consumed by `ai/core/mortality.ts::processMortality`) are a deliberately
different shape from every other call family above: **the model never
decides an outcome, only narrates one the code already rolled**
(DESIGN_DECISIONS.md D2/D3/D4).

- `mortalityValidation` only dispositions whether a claimed death is real
  and earned (`valid: boolean`) - it does not choose what happens next.
- A hidden `Math.random()`-backed d20 (`ai/core/resolution.ts::rollD20`) is
  then resolved by a PURE function (`resolvePlayerDeathSave`/
  `resolveNpcFate`) into a band. This roll is never sent to, or requested
  from, the model, and never shown to the player - it's recorded in the
  turn's `mortalityTrace` (`MortalityEvent[]`, types.ts) for the GM console
  only.
- `mortalityOutcome` is only asked to dress an ALREADY-DECIDED band in
  concrete deltas and a one-line narration directive - it is told the band
  up front and must not contradict or reinterpret it.
- The narration call (`narration.ts::buildNarrationPrompt`) receives those
  directives as non-negotiable staging notes, plus a SANITIZED adjudication
  (`sanitizeAdjudicationForNarration` strips `gm_private` and any
  `secret_truth` trace) - see the CRITICAL LEAK-PREVENTION comment there for
  why: a "presumed dead" NPC's secret survival must never reach a
  player-facing prompt.

If you touch this pipeline, keep that direction of control intact: adding
a field the model could use to influence life/death would reopen the exact
hallucinated-death problem D2/D3 exist to close.

## The resolution layer: code decides WHETHER, the model decides HOW

`assessment` (`ai/prompts/assessment.ts`, consumed by
`ai/tools/assessment.ts::getActionAssessment`) and `ai/core/resolution.ts`'s
`resolveAction` are the general-purpose sibling of the mortality pipeline
above (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) - they share its exact
contract: **the model never decides whether an action succeeds, only
narrates a pre-decided outcome.**

- `assessment` runs on EVERY turn, launched CONCURRENTLY with
  `storyRelevance` via `Promise.all` in `ai/core/turn.ts` (both read only
  pre-turn state, so this costs zero extra wall-clock). It classifies the
  player's action - `is_consequential`, `action_category`, `relevant_skill`
  (`'oratory' | 'strategy' | 'intrigue' | null`), `difficulty` (5-25),
  `opposing_entity_id` - but decides nothing mechanical itself.
- Non-consequential actions (questions, idle conversation, pure information
  requests) skip rolling ENTIRELY: no dice, no `PLAYER ACTION OUTCOME` block
  in the adjudication prompt, no `resolutionTrace` on the turn's
  `TurnHistoryEntry` (types.ts). The adjudicator behaves exactly as it did
  before this feature existed.
- For a consequential action, `ai/core/turn.ts` resolves a HIDDEN
  `rollD20()` via `resolveAction` (`ai/core/resolution.ts`), using the
  player's own skill/personality (`derivePersonalityModifier`) and the
  opposing entity's directional stats toward the player
  (`deriveOppositionModifier` - `perceived_threat` raises their guard,
  `trust_level` toward the actor eases it). The resulting tier
  (`critical_failure` / `failure` / `partial_success` / `success` /
  `critical_success`) is injected into the adjudication prompt
  (`ai/prompts/adjudication.ts::buildPlayerActionOutcomeBlock`) as a
  PRE-DECIDED outcome - the adjudicator decides HOW it manifests (deltas,
  NPC reactions, headline wording), never WHETHER. Tier names are fine
  inside the prompt (GM-side only) but must never reach a headline or a
  delta's player-adjacent `reason` text - see that block's own wording.
- The same `resolveAction` machinery also resolves
  `ai/tools/intelligence.ts::getInvestigationResult`'s roll (a real dice
  check replacing the old prose "40% chance" line that was never actually
  wired to anything) - always rolled (no assessment call needed, an
  investigation is always consequential), with `difficulty` derived from
  the target's own paranoia/intrigue (`deriveInvestigationDifficulty`).
  `consequences` is enforced POST-HOC in code (not just prompt hope): always
  `null` on a success/critical-success tier, always a non-null string on a
  failure/critical-failure tier (falling back to a generic one if the model
  ignores the tier guidance).
- Every roll is recorded for the GM console ONLY, never shown to the player
  (D4): `ActionResolutionEvent` (types.ts) on the turn's `resolutionTrace`,
  plus a `[Resolution]` `gm_private` note.
- **Mock mode**: the assessment call is never reached at all -
  `runNewTurn` short-circuits into `mockRunNewTurn` before any resolution-
  layer code runs, so mock-mode turns never roll and never assess. (The
  `isMockMode` branch inside `getActionAssessment` itself is dead code from
  `turn.ts`'s call site, kept only for parity with its sibling `get*`
  functions in `ai/tools/intelligence.ts`, all of which follow the same
  pattern.)

## The Director: persistent intents, fed back every turn

`storyRelevance` (`intelligence.ts::buildStoryRelevancePrompt`) is the
Director (ROADMAP_PHASE_4.md 4C item 3): besides spotlight picks and
cast/location suggestions it emits `spotlight_intents` - one
`{entity_id, intent, continuity}` per spotlight, where `intent` is a
one-line statement of what that character is trying to accomplish next and
`continuity` (`'continue' | 'pivot' | 'new'`) is ruled against the PREVIOUS
turn's committed intents, which the prompt receives as an input block along
with each holder's `active_scheme` and the last `DIRECTOR_MEMORY_LINES`
of its perception-grounded memories (`Entity.memories` - the D10 stamp).

- This is NOT a new model call: the existing `storyRelevance` call was
  upgraded in place (latency discipline; the per-mind calls are a later
  stage).
- `ai/core/turn.ts::selectDurableIntents` filters the raw response to
  actual spotlight picks and caps at `MAX_NPC_INTENTS`; that bounded list
  is what the adjudication prompt's `SPOTLIGHT NPC INTENTS` block
  (`fragments.ts::buildDirectorIntentsBlock`) consumes, what the history
  entry records (`TurnHistoryEntry.npcIntents`, optional), and what the
  reducer persists (`npcIntents` slice, optional in the save) to feed the
  NEXT turn's Director - the continuity loop.
- The adjudicator must have each spotlight act in service of its stated
  intent; the contract is validated POST-HOC in code
  (`ai/core/turn.ts::buildIntentConsistencyNotes`): a spotlight holding an
  intent but no `entityAction` gets a `[Director]` `gm_private` note - a
  soft contract, never a hard failure or a synthesized action.
- Intents are GM-PRIVATE (D4/D5), same handling class as `gm_private`:
  they render only in `GameMasterScreen` and feed only prompts under
  `ai/` - never a player-facing surface.

## System vs. user split

Every builder returns `{ systemInstruction, prompt }`:

- **`systemInstruction`** — the STABLE role, task description, and
  format/output contract. Identical on every call for that call family;
  changing it is a deliberate behavior change, not a per-turn variation.
- **`prompt`** — the PER-TURN or per-call DYNAMIC state: world state,
  entity briefs, player action, history, narration text, target profile,
  etc. Rebuilt fresh every call.

When splitting an existing prompt, move text verbatim across this
boundary - do not rephrase rules/instructions while moving them. If a rule
needs to reference dynamic data inline (e.g. "the player's action
(\"${playerIntent}\")"), it's fine for that one sentence to live in
`systemInstruction` with the value interpolated in, as several of the
builders above do - the point is behavioral stability, not mechanical
purity of the split.

## The directional relationship-delta rule

One rule is deliberately duplicated verbatim in three places and must stay
in sync if it ever changes:

- `adjudication.ts` (the main turn's `RELATIONSHIP DELTAS` rule)
- `intelligence.ts` (`buildRelationshipUpdatesPrompt`'s equivalent rule)
- `ai/core/schemas.ts`'s `EventDeltaSchema.key` description

All three say the same thing: a `relation` delta keyed `A:B:attribute`
changes **A's perception of B only** (relationships are asymmetric); a
mutual change requires two deltas, one per direction.

## The rule: schema changes and prompt changes land together

If you change what a Gemini call is asked to return (add/rename/retype a
field), update in the same commit/PR:

1. The prompt builder here (what the model is told to produce).
2. The Gemini `responseSchema` in `ai/core/schemas.ts` (what the API
   enforces at generation time).
3. The zod schema in `ai/core/zodSchemas.ts` (what `geminiService`
   validates after parsing).

A prompt/schema pair that drifts out of sync produces either malformed
output the zod repair-retry can't fix, or output that validates but no
longer matches what the prompt actually asked for.
