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
