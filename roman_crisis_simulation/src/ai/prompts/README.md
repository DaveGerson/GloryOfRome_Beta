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
| `assessment` | `assessment.ts::buildActionAssessmentPrompt` | flash | `zActionAssessment` | `ActionAssessmentSchema` | `turn.ts` step 0 (observable-attempt gatekeeper, concurrent with `storyRelevance`; skipped for question/private-only submissions) |
| `adjudication` | `adjudication.ts::buildAdjudicationPrompt` | pro | `zAdjudication` | `AdjudicationSchema` | `turn.ts` step 2 (main turn) |
| `narration` | `narration.ts::buildNarrationPrompt` | pro | - (prose) | - | `turn.ts` step 5 |
| `playerMonologue` | `narration.ts::buildPlayerMonologuePrompt` | flash | - (prose) | - | `turn.ts` step 4 |
| `storyRelevance` | `intelligence.ts::buildStoryRelevancePrompt` | pro | `zStoryRelevance` | `StoryRelevanceSchema` | `turn.ts` step 0 (Director) |
| `npcMind` | `npcMind.ts::buildNpcMindPrompt` | flash | `zNpcMindDecision` | `NpcMindDecisionSchema` | `turn.ts` step 1.5 (per-spotlight minds, between the Director and adjudication - up to `MAX_MINDS_PER_TURN` in one `Promise.all`) |
| `updatedSimulationState` | `intelligence.ts::buildSimulationStateUpdatePrompt` | pro | `zSimulationState` | `SimulationStateSchema` | `turn.ts` step 2.5 |
| `relationshipObservations` | `relationshipObservations.ts::buildRelationshipObservationsPrompt` | flash | `zRelationshipObservations` | `RelationshipObservationsSchema` | `App.tsx` turn and paid-investigation paths, before their atomic save/dispatch commits |
| `noAttemptEvidenceSelection` | `noAttemptResponse.ts::buildNoAttemptEvidenceSelectionPrompt` | flash | `zNoAttemptEvidenceSelection` | `NoAttemptEvidenceSelectionSchema` | question-only player response; evidence IDs only |
| `privateScene` | `privateScene.ts::buildPrivateScenePrompt` | pro | `zPrivateSceneModelResponse` | `PrivateSceneModelResponseSchema` | Player-initiated one-NPC private-scene micro-loop; bounded self brief and transcript only |
| `mortalityValidation` | `mortality.ts::buildMortalityValidationPrompt` | pro | `zMortalityValidation` | `MortalityValidationSchema` | `turn.ts` step 2.6 (`ai/core/mortality.ts::processMortality`, gate 1) |
| `mortalityOutcome` | `mortality.ts::buildMortalityOutcomePrompt` | pro | `zMortalityOutcome` | `MortalityOutcomeSchema` | `turn.ts` step 2.6 (`ai/core/mortality.ts::processMortality`, gate 3) |
| `investigation` | `intelligence.ts::buildInvestigationPrompt` | pro | `zInvestigationResult` | `buildInvestigationResultSchema(subject)` | Player-triggered intel action |
| `clarification` | `intelligence.ts::buildClarificationPrompt` | flash | - (prose) | - | Player-triggered intel action |
| `deepAnalysis` | `intelligence.ts::buildDeepAnalysisPrompt` | flash | - (prose) | - | Player-triggered intel action |
| `scenarioStructure` | `worldGen.ts::buildScenarioStructurePrompt` | pro | `zScenarioStructure` | `ScenarioStructureSchema` | `initiator.ts` Step 1 (world skeleton) |
| `entityBatch` | `worldGen.ts::buildEntityBatchPrompt` | pro | `zEntityBatch` | `EntityListSchema` | `initiator.ts` Step 2 (fill in entities) |
| `characterCreation` | `characterCreation.ts::buildCharacterCreationPrompt` | pro | `zEntity` | `CharacterCreationEntitySchema` | Player character creation |
| `ambitionInference` | `ambition.ts::buildAmbitionInferencePrompt` | flash | `zAmbitionInference` (local to `ai/tools/ambition.ts`) | `AmbitionInferenceSchema` (local to `ai/tools/ambition.ts`) | `App.tsx` `executeTurn`, every 3rd committed turn (D8, fire-and-forget) |
| `epilogue` | `epilogue.ts::buildEpiloguePrompt` | pro | - (prose) | - | `components/EpilogueScreen.tsx`, once per run on `GameState.GAME_OVER` |
| `narrationPerformance` | `narrationPerformance.ts::buildNarrationPerformancePrompt` | flash | - (prose; checked by `narration/performanceScript.ts::validatePerformance`, falls back on any failure) | - | `ai/tools/narrationVoice.ts`, on demand (or `auto` mode after a turn commits) for ONE committed GM narration; inserts `<...>` delivery directions only |
| `narrationVoice` | `narrationPerformance.ts::buildNarrationTtsPrompt` | tts (`GEMINI_TTS`, via `generateSpeech`) | - (audio) | - | `ai/tools/narrationVoice.ts`, right after `narrationPerformance`; the call log keeps an `[audio: N bytes, mime]` placeholder, never the audio |
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
`entityBatch:NPCs_1` - see `ai/core/initiator.ts::generateEntityBatch`.
`npcMind` follows the same convention, suffixed per character, e.g.
`npcMind:maximinus_thrax` - see `ai/tools/npcMind.ts`.)

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
  up front and must not contradict or reinterpret it. Its side effects keep
  the prompt's existing type-aware scope: resource/scheme keys target the
  candidate; a relation can place the candidate on either directional
  endpoint; a rumor concerns the candidate but may be spread by any real
  entity (or omit `origin_id` when genuinely organic). Status, unrelated
  entity, region, faction, and world effects are rejected before apply.
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

- `assessment` runs only when the canonical submission has an observable
  attempt. When present, it launches CONCURRENTLY with `storyRelevance` via
  `Promise.all` in `ai/core/turn.ts` (both read only pre-turn state, so this
  costs zero extra wall-clock). It classifies the player's action -
  `is_consequential`, `action_category`, `relevant_skill` (`'oratory' |
  'strategy' | 'intrigue' | null`), `difficulty` (5-25), and
  `opposing_entity_id` - but decides nothing mechanical itself.
- Structured question-only and private-only submissions skip assessment and
  rolling entirely. An assessed but non-consequential observable attempt
  (idle conversation or a pure information request) also skips rolling: no
  dice, no `PLAYER ACTION OUTCOME` block in the adjudication prompt, and no
  `resolutionTrace` on the turn's `TurnHistoryEntry` (types.ts).
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
  spotlight picks that are ALSO alive in the current roster (a dead/absent
  id may never carry durable direction) and caps at `MAX_NPC_INTENTS`; that bounded list
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

## The minds: bounded knowledge, decisions the adjudicator acts out

`npcMind` (`npcMind.ts::buildNpcMindPrompt`, consumed by
`ai/tools/npcMind.ts::getNpcMindDecision`) is the 4C.4 mind call
(DESIGN_DECISIONS.md D10/D22): each spotlight character - alive,
non-player, up to `MAX_MINDS_PER_TURN`, selected by
`ai/core/turn.ts::selectMindEntities` - is addressed IN CHARACTER on the
flash tier and decides its own move for the turn, all minds launched in a
single `Promise.all` between the Director and adjudication (the one added
latency leg D16 sanctions).

- **THE ASYMMETRY CONTRACT (the point):** a mind's prompt may contain ONLY
  what that character plausibly knows - its own full brief (own secrets,
  scheme, personality, skills, beliefs, relationships), its own memories,
  its own perceived digest of the previous turn's events
  (`perception/visibility.ts` run from ITS vantage), its own Director
  intent, and public knowledge (headlines + the D5-public macro world
  summary). NEVER another character's secrets, `active_scheme`,
  `gm_private`, `secret_truth`, rumor truth flags, or the player's private
  data. `npcMind.ts::buildMindSelfBrief` is a DEDICATED builder for
  exactly this reason - the omniscient adjudicator fragments
  (`fragments.ts::getEntityBrief` etc.) must never be reused for a mind.
  Pinned by tests/npcMinds.test.ts.
- The adjudicator receives the decisions via
  `fragments.ts::buildNpcMindDecisionsBlock` - entity_id, chosen_action,
  method ONLY, never `private_reasoning` (lean context, and a mind may be
  wrong about itself). Contract: a spotlight with a decision acts it out;
  the adjudicator resolves conflicts/consequences and still owns all
  deltas. Spotlights without a decision (cap overflow, or a failed mind
  call - caught per-mind, `[Mind]` gm_private note, never a turn failure)
  fall back to the Director-intents block, the pre-minds behavior.
- Mind outputs are GM-PRIVATE (D4/D5): the full decisions (reasoning
  included) render only in `GameMasterScreen` (the turn's
  `npcMindResults`, trimmed with the snapshot window) and feed only
  prompts under `ai/`.
- **D30 - a mind's `scheme_adjustment` is LOAD-BEARING:** it is the
  character's own evolving intent, not a hint the adjudicator may discard.
  After the adjudication call, `ai/core/turn.ts::buildMindSchemeDeltas`
  turns each mind's non-empty `scheme_adjustment` into a committed 'scheme'
  delta evolving THAT entity's own `active_scheme`
  (`evolveSchemeFromAdjustment` folds the one-liner in as the plan's next
  step, capped at `MAX_SCHEME_STEPS`, so engine.ts's `JSON.parse` of a full
  `Scheme` never breaks). SCHEME OWNERSHIP precedence: for a minded entity
  its own mind owns the evolution, so any competing adjudicator 'scheme'
  delta for the same entity is deduped away (no double-application) and the
  adjudication prompt's DYNAMIC SCHEMES rule tells the adjudicator not to
  emit one; the adjudicator still owns every NON-minded entity's scheme and
  all action outcomes. The applied delta flows through `applyDeltas` and D28
  perception like any other (a witness senses only 'something afoot').
- **D22 grouping seam:** one mind per spotlight CHARACTER today; grouping
  minds per set/faction later (the sanctioned cost lever) changes only
  `selectMindEntities` + the self-brief - see the seam notes in
  `ai/core/turn.ts` and `ai/tools/npcMind.ts`. Not built yet.

## Voice & epithet: minds and narration speak in character

`Entity.voice` (a compact speech-style directive, e.g. "clipped soldier's
Latin, contempt for senatorial flourish") and `Entity.epithet` (a short
public byname, e.g. "the Thracian") are OPTIONAL narrative-flavor fields
(ROADMAP_PHASE_4.md 4C item 5, D10) - kept in lockstep across `types.ts`,
`ai/core/schemas.ts` (`EntitySchema`/`CharacterCreationEntitySchema`), and
`ai/core/zodSchemas.ts` (`zEntity`). Not GM-private: an epithet is public
texture. Production and consumption:

- **Produced** by `worldGen.ts::buildEntityBatchPrompt` (requirement 7) and
  `characterCreation.ts` (instruction 13); authored by hand for the base
  cast in `constants/baseScenario.ts` (all entities carry both) and the
  mock entities in `ai/mocks.ts`.
- **Consumed** in exactly three places, each with a different slice:
  - `npcMind.ts::buildMindSelfBrief` - the character's OWN voice + epithet,
    so `chosen_action`/`private_reasoning` read in character.
  - `narration.ts::buildVoiceCastBlock` - voice + epithet for the BOUNDED
    on-stage cast only (`selectVoiceCast`: spotlight picks + this turn's
    acting entities, capped at `MAX_VOICE_CAST`, never the whole roster),
    with guidance to let quoted characters sound distinct.
  - `fragments.ts::getEntityBrief` - the epithet ONLY (one token of public
    flavor for the adjudicator); voice directives stay out of the
    omniscient briefs to save context.
- Because the fields are optional, every builder emits NOTHING for an
  absent field - a legacy entity/save renders exactly as before the fields
  existed, and the literal string "undefined" must never appear
  (pinned by tests/voice.test.ts).

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

One rule is deliberately duplicated verbatim in two places and must stay
in sync if it ever changes:

- `adjudication.ts` (the main turn's `RELATIONSHIP DELTAS` rule)
- `ai/core/schemas.ts`'s `EventDeltaSchema.key` description

Both say the same thing: a `relation` delta keyed `A:B:attribute`
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
