# Phase 6 No-Attempt Evidence Response Design

**Status:** Approved on 2026-07-25.

**Purpose:** Close the player-output boundary for structured submissions that contain no observable attempt. Question-only turns answer from evidence the avatar can already perceive; private-intent-only turns receive a fixed acknowledgement. Neither path lets a prose model invent an avatar action or expose hidden mechanics.

## Scope

This design applies only when `projectForResolution(submission)` returns `null`:

- A structured submission with `questionOrContext` is a **question response**.
- A structured submission with only `privateIntent` is a **private acknowledgement**.
- If both fields are present, the question response wins and Private Intent remains excluded from the answer selector.

Freeform Chat submissions and structured submissions containing an Action or Message/Order keep the current fully agentic narration, monologue, suggestion, adjudication, and resolution path.

Every valid submission still advances one turn. The adjudicator, NPC/world simulation, mortality pipeline, state application, and save transaction remain intact. This subsystem changes the authorship and projection of the no-attempt player response; it does not change game mechanics or authorize new player actions.

## Product Contract

### Question response

1. The composition root builds a bounded, numbered evidence list from the player knowledge store after the current turn's perception-safe digest, new Reports, and validated relationship observations have been ingested into the prospective next store.
2. Each evidence item contains only an opaque local ID, its player-visible source label, and exact player-visible text. No Entity object, raw delta, adjudication, headline, `SimulationState`, trace, roll, outcome tier, `gm_private`, `secret_truth`, truth-ledger field, or Private Intent crosses this boundary.
3. The model receives the player's Question/Context plus that evidence list. It returns only a strict selection object: `decision` (`answer` or `no_answer`) and zero or more evidence IDs. It cannot return answer prose.
4. Code validates the selection against the offered evidence, rejects duplicates and unknown IDs, caps an answer at five items, and restores the selected items to canonical evidence order so the model cannot control presentation order.
5. Code renders the response from the canonical evidence text. The model never controls a displayed word.
6. The response begins with `What you can currently tell:` and lists the selected observations. Source framing is a fixed local label; evidence text is copied exactly.
7. Empty evidence, an explicit `no_answer`, invalid semantic output, schema failure, or provider failure renders the same fixed no-answer response: `Nothing in your current observations answers that yet.`
8. Provider/schema/semantic fallback is recorded as a content-free GM diagnostic. It never includes the question, evidence text, raw model output, or provider error detail.

### Private acknowledgement

1. A private-intent-only submission makes no answer-selection call.
2. The GM response is the fixed acknowledgement `Your private intent is noted. No action is taken on your behalf.`
3. No generated Inner Thoughts bubble is added. The player's own Private Intent remains available only through the already-approved collapsed history view and GM console.
4. Suggested-action pills use deterministic existing defaults; no no-attempt narration response is mined for suggestions.

### Mixed or observable submission

The presence of an Action or Message/Order is an observable attempt. Question/Context and Private Intent continue to guide the existing player-owned AI projections, while the ordinary streamed narration, monologue, and suggestion path remains unchanged.

## Architecture

```text
TurnSubmission
      |
      +-- observable attempt? -- yes --> existing runNewTurn prose path
      |
      `-- no --------------------------> full world turn still resolves
                                             |
                                    perception-safe next knowledge
                                             |
                         +-------------------+------------------+
                         |                                      |
                   question present                      private only
                         |                                      |
              strict evidence-ID selector                fixed response
                         |
              local semantic validation
                         |
              deterministic renderer
```

The seams are deliberately narrow:

- `playerInput/turnSubmission.ts` owns a named projection that classifies the no-attempt response mode without exposing Private Intent to the question selector.
- A pure `playerView/noAttemptResponse.ts` module builds bounded evidence, validates selections, renders answers, and owns fixed copy. It has no React, Gemini, state mutation, or game-mechanics dependency.
- `ai/prompts/noAttemptResponse.ts` owns the complete selector prompt family.
- `ai/core/schemas.ts` and `ai/core/zodSchemas.ts` define the same strict selector output shape in one change.
- `ai/tools/noAttemptResponse.ts` is the only AI adapter for this subsystem and calls `generateStructured` through `ai/core/geminiService.ts` with the centralized flash model constant.
- `ai/core/turn.ts` suppresses freeform narration and monologue generation only for no-attempt submissions. It still resolves and applies the world turn.
- `App.tsx` is the composition root: it builds the prospective player knowledge, invokes the selector, finalizes the history/chat response, and commits everything atomically through `buildSaveState`.
- `state/gameReducer.ts` accepts an optional monologue message so no-attempt turns do not manufacture an Inner Thoughts bubble. Observable turns keep the existing message sequence.

## Evidence Construction

The prospective `KnowledgeClaim[]` is the single input. This store is already constrained to perception-filtered digests, player-visible Reports, investigation reports, and validated relationship observations.

Evidence is built deterministically:

- Flatten each claim's updates into `{ id, source, text, turn }` records by copying fields one by one.
- Order newest turn first, then claim and update order for stable ties.
- Deduplicate exact `(source, text)` pairs.
- Keep at most the newest 60 items. This bounds prompt size without adding a persisted field or changing any game rule.
- Assign local IDs such as `evidence-1`; persisted knowledge IDs are not sent to the model or rendered.

The question is not evidence and cannot establish a fact. Private Intent is not an input to evidence construction, prompt construction, selection, validation, or rendering.

## Selection and Fallback Semantics

The model output contract is:

```ts
interface NoAttemptEvidenceSelection {
  decision: 'answer' | 'no_answer';
  evidenceIds: string[];
}
```

Valid `answer` output contains one to five unique IDs, all present in the offered list. Valid `no_answer` output contains no IDs. Any other combination is invalid and becomes the fixed no-answer fallback. Valid selections render in the evidence list's canonical order, never the provider's returned order.

In mock mode, the adapter deterministically selects the first available evidence item, or returns `no_answer` when the list is empty. This keeps journeys off the network while exercising the real evidence builder, validator, renderer, transaction, persistence, and UI.

No fallback throws after the world turn has already resolved. The fallback is a safe, explicit product behavior, while the content-free GM diagnostic prevents a selector outage from becoming operationally silent.

## Transaction and Persistence

The selector runs after the prospective next knowledge store exists but before save or reducer commit. Cancellation or a superseding transaction discards its result. The final response is written into the existing `TurnHistoryEntry.narration`, the GM chat message, reducer state, and `buildSaveState` payload in the same commit.

No new persisted field is required. `SAVE_VERSION` remains `1`, and old saves load unchanged.

## Security and Privacy Invariants

- All Gemini calls route through `ai/core/geminiService.ts`; model IDs remain centralized.
- Prompt text lives only in `ai/prompts/noAttemptResponse.ts`, and the prompt inventory changes with it.
- The selector sees only the player knowledge projection; it never sees raw adjudication or hidden state.
- The selector cannot author player-visible prose, dice, outcomes, mechanics, or self-interpretation.
- Private Intent never reaches the selector, NPC minds, relationship mechanics, apparent ambition, knowledge, or perception.
- No raw provider error or output reaches player copy or GM diagnostic text.
- Only player death remains terminal.
- `TurnStage` does not change.

## Verification Strategy

The implementation must be regression-first:

1. Pure contract tests prove classification, evidence allowlisting/bounds/deduplication, strict selection semantics, deterministic exact-text rendering, and fixed fallbacks.
2. Prompt/tool tests capture the actual Gemini-service request and prove it contains the question and only offered evidence fields; poison sentinels for Private Intent, raw deltas, `gm_private`, `secret_truth`, rolls, tiers, and narration must be absent.
3. Turn-pipeline tests prove question/private-only submissions do not call narration or player-monologue generation, while action/mixed submissions still do.
4. App transaction tests prove the selector runs before commit, failures fall back without partial state, the finalized response is saved atomically, and no empty Inner Thoughts message renders.
5. Journey and browser tests prove question-only, private-only, and mixed behavior through the real composer, history, save/reload, and player UI.
6. Full `typecheck`, unit tests, journey tests, build, lint, and an independent whole-branch privacy review gate integration.

## Non-Goals

- Redesigning adjudication, NPC behavior, mortality, action resolution, relationship mechanics, world simulation, or visibility policy.
- Giving questions investigative powers or treating Private Intent as an action.
- Generating a prose answer and attempting to sanitize it afterward.
- Adding a quest log, win state, new turn stage, dependency, or save-version bump.
- Replacing normal agentic narration for observable submissions.
