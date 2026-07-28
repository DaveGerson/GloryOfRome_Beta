# Phase 6 Player-Initiated Private Scenes Design

**Status:** Owner-approved mechanics captured from the Phase 6 grilling sequence on 2026-07-28.

**Goal:** Replace the autonomous off-screen NPC conversation step with a player-initiated, save-compatible private-scene micro-loop that preserves deception, NPC hidden intent, player agency, and the main adjudicator's exclusive authority over world and relationship consequences.

## Scope

This design adds one optional private scene between the human player's avatar and one AI-controlled character per macro turn. A scene is independent of macro-turn execution: the world and macro turn counter do not advance while the scene is active. Inside the scene, the player and NPC exchange dialogue synchronously. Closing the scene produces one compact structured outcome for the next main adjudication.

This design also removes two existing authority violations:

1. The autonomous NPC-NPC `simulatePrivateConversation` step inside `runNewTurn`, which currently applies model-authored deltas immediately.
2. The post-hoc `getRelationshipUpdates` call, which currently applies relationship deltas after the main adjudicator has already resolved the turn.

The main adjudicator becomes the sole authority for ordinary-turn relationship changes and for any world consequences arising from a completed private scene.

Mortality authorization, action resolution, action economy, event firing, victory conditions, and simulation rules are outside this design and must not change.

## Binding architecture invariants

1. Every Gemini call goes through `ai/core/geminiService.ts`. Call sites use the shared model-tier constants and never call `ai.models.generateContent` directly.
2. The private-scene prompt lives in its own `ai/prompts/` file and is inventoried in `ai/prompts/README.md`. Any output-contract change updates `ai/core/schemas.ts` and `ai/core/zodSchemas.ts` in the same commit.
3. Player-facing rendering receives only an explicit player projection. It never receives NPC hidden intent, `gm_private`, raw deltas, `secret_truth`, out-of-sight simulation state, or unfiltered entity data.
4. Rolls, resolution or mortality traces, dice values, and outcome tiers remain GM-only.
5. Only player death is terminal.
6. Save version 1 remains compatible. The new top-level persisted field is optional, absent fields normalize to an empty scene history, and every durable scene mutation is saved through `App.tsx::buildSaveState` before reducer commit.
7. Removing the obsolete `private_conversation` and `relationship_updates` turn stages changes `ai/core/turn.ts::TurnStage` and `components/Chat.tsx`'s exhaustive status record together.
8. Pure scene eligibility, projection, transition, and outcome helpers receive focused tests. No new UI-test dependency is added.

## Authority and privacy model

Private scenes maintain three distinct information layers. They must never be flattened into one prose field.

### 1. Player-observed dialogue

The transcript records exactly what the player and NPC said. It is true only that a speaker made the statement. Statements about the world remain attributed claims; conversation never certifies their contents as fact.

### 2. NPC hidden intent

The NPC response may contain a separately validated GM-private state describing sincerity, present intent, and planned follow-through. This state is durable NPC memory. It may inform that NPC's future mind calls and the main adjudicator, but it is not a resolved action, relationship delta, or world fact. It is never rendered on a player surface.

This is intentionally asymmetric with player Private Intent. The engine controls the NPC and therefore needs durable internal NPC state for coherent deception. The human controls the player, so the player's unspoken intent may shape only player-owned narration, inner monologue, suggestions, author-visible history, and the GM ledger. It must not enter objective adjudication, NPC reasoning, relationship mechanics, knowledge, perception, resolution, or world state.

### 3. World truth

Only committed simulation state and the main adjudicator establish objective events. If an NPC says that three cohorts support a coup, the outcome records an attributed claim. Existing ground truth may contradict it. The scene model cannot create those cohorts or resolve their allegiance.

## Scene lifecycle

### Eligibility and initiation

- Only the human player may initiate a scene. NPCs never initiate scenes or run scenes among themselves.
- At most one scene may be committed for a given macro-turn number. Only one scene may be active at a time.
- An eligible target must be alive, known to the player, and either co-located with the player or already connected to the player through an established relationship edge.
- Eligibility is derived by a pure allowlist helper from the player entity, perception-safe known-entity IDs, and the minimal target directory required for location and relationship-edge checks. Hidden roster entries never reach the selector.
- Starting a scene sends the player's opening line as an invitation. The NPC may accept or refuse in character.
- A provider failure, invalid response, or failed save does not consume the scene. The opening draft remains available for retry.
- A successfully committed acceptance or refusal consumes the one-scene allowance for that macro turn.

### Accepted scene

- The accepted opening response counts as NPC response 1.
- The scene permits at most six NPC responses total.
- The player or NPC may end the scene earlier.
- After the sixth NPC response, the scene closes naturally and no further exchange call is available.
- Individual utterances never mutate entities, relationships, the world, reports, truth records, mortality state, or the macro turn counter.
- Each provider response commits atomically only after its candidate scene state has been saved successfully.

### Refusal and last word

- A committed refusal consumes the scene and returns the NPC's in-character refusal.
- After either refusal or an accepted-scene close, the player may add one optional last word.
- The last word is one-way. It creates no NPC response and no additional Gemini call.
- The last word is persisted in the transcript, included in the player-visible scene outcome, and available to the participating NPC's future memory.
- Omitting the last word finalizes the same outcome without an extra utterance.

### Reload and transaction behavior

- Active and completed scenes are durable save state so a reload can resume the active vignette or revisit completed transcripts.
- The macro composer is disabled while a scene is active or a scene request is in flight. It becomes available after the scene outcome is finalized.
- A failed exchange preserves the last committed transcript and restores the unsent player draft.
- The next successful macro-turn commit marks the pending scene outcome consumed in the same save/reducer transaction as the turn. A failed or rolled-back macro turn leaves it pending for exact retry.

## Data contracts

The implementation should use focused domain types equivalent to the following semantic contract. Exact TypeScript names may be adjusted in the implementation plan only to fit existing naming conventions; the privacy partitions may not be collapsed.

### Transcript record

- Stable scene ID and authoritative macro-turn number.
- Player entity ID and NPC participant ID.
- Status: active, refused-awaiting-last-word, closed-awaiting-last-word, or completed.
- Ordered utterances containing speaker ID, player-visible text, and sequence number.
- NPC response count, bounded from zero through six.
- Optional completed outcome.
- Optional macro-turn number that consumed the outcome.

Player-authored utterances are blocked above a small scene-specific character limit and never silently truncated. Provider replies are validated to a corresponding maximum so fifty scenes cannot silently exhaust the localStorage save budget. This limit is separate from the 20,000-character structured macro-turn limit.

### Private-scene model response

- Invitation disposition for the opening call: accepted or refused.
- NPC's player-visible reply.
- Whether the NPC ends an accepted scene with this response.
- Attributed speech acts produced in this exchange. Allowed kinds are claim, disclosure, request, promise, agreement, refusal, and threat.
- GM-private NPC state: sincerity, present intent, and planned follow-through.

The response contains no `EventDelta`, numeric relationship change, roll, tier, trace, mortality decision, world-state patch, or assertion that a claim is true.

### Completed `PrivateSceneOutcome`

The outcome is assembled deterministically from validated exchange records; closing a scene does not require an extra model call.

The player-visible partition contains:

- Scene and participant IDs.
- Attributed speech acts accumulated across exchanges.
- Closure reason: refused, player ended, NPC ended, or response limit reached.
- Optional one-way player last word.

The GM-private partition contains the NPC's latest validated sincerity, present intent, and planned follow-through. It is labeled as NPC internal state, not world truth.

The full transcript remains on the scene record for player history, participant memory, and the GM console. It is not copied into the outcome sent to the next adjudication.

## AI boundaries

### Private-scene call family

The independent scene capability lives outside `ai/core/turn.ts`, preferably in focused `ai/tools/privateScene.ts` and `ai/prompts/privateScene.ts` modules. It receives:

- The participating NPC's own bounded self-knowledge and durable private-scene memory.
- The player's visible identity and the dialogue transcript.
- Player-known public context necessary to conduct the scene.

It never receives player Private Intent, the hidden roster, another NPC's secrets or plans, raw adjudication, raw deltas, truth-ledger flags, rolls, tiers, mortality traces, or unrestricted `SimulationState`.

### Main adjudicator

The next macro turn receives at most one pending, compact `PrivateSceneOutcome`. The adjudication prompt presents the player-visible speech acts and GM-private NPC state in separately labeled blocks and explicitly says:

- Claims remain claims unless existing world state independently establishes them.
- NPC hidden intent guides behavior but is not an accomplished action.
- Only the adjudicator may choose and emit resulting deltas.
- The private scene cannot independently change a relationship or establish a world event.

The full transcript is not sent to the main adjudicator. This limits prompt growth and prevents unaudited prose from being semantically laundered into ground truth.

### NPC continuity

Future mind calls for the participating NPC receive a bounded set of that NPC's completed private-scene outcomes, including its own GM-private intent and the player's last word. Other NPC minds receive none of it unless ordinary perception or later adjudication makes information observable to them.

### Relationship authority

The main adjudicator already owns `relation` deltas during ordinary turn resolution and remains the sole authority. The post-hoc Relationship Analyst call and its application path are removed. Player-facing relationship observations remain a separate perception-safe presentation pipeline; they describe evidence and never write hidden numeric relationship state.

## UI behavior

- A secondary **Private scene** action sits beside the macro composer while the game awaits player input.
- It opens an accessible panel or dialog containing only eligible known targets. If no target is eligible, the UI explains that no known contact is currently within reach.
- The opening view contains the target selector and one dialogue field. Sending it commits nothing until the validated NPC response and candidate save both succeed.
- An accepted scene switches to a compact transcript-and-reply view with an explicit response counter and **End scene** control.
- A refusal shows the in-character response and the optional last-word control.
- A completed scene remains revisitable from the same panel as player history. The player sees transcript and attributed speech only, never the GM-private NPC state.
- Processing states disable duplicate sends. Errors are plain-language, retain the draft, and permit retry.
- The GM console receives the full transcript, structured speech acts, closure, and NPC hidden state under an explicitly GM-private section.

## Error handling and safety

- Validate target eligibility again at command execution, not only when rendering the selector.
- Ignore stale async results using the existing domain-mutation transaction guard.
- Save before reducer commit for every durable scene transition. If save fails, keep the last committed scene state and surface a retryable error.
- Reject invalid speaker IDs, unknown speech-act kinds, excess response counts, missing refusal text, and hidden-state fields in player projections.
- The last-word path must be pure/local and its tests must prove no Gemini call occurs.
- No scene path may set `GameState.GAME_OVER`, increment the macro turn, apply a delta, or run mortality.

## Verification

The merge gate requires:

1. RED/GREEN unit tests for eligibility, lifecycle transitions, six-response enforcement, refusal consumption, one-way last word, outcome partitioning, pending-outcome consumption, and old-save normalization.
2. Captured-call privacy tests proving player Private Intent and every forbidden GM/raw sentinel are absent from the scene call; proving the main adjudicator receives only the compact outcome; and proving other NPC minds do not receive the participant's memory.
3. Transaction tests proving provider/save failure consumes no allowance, retry commits once, macro-turn failure leaves the outcome pending, and macro-turn success consumes it atomically.
4. UI tests for eligible target rendering, accepted/refused paths, response cap, last word, draft restoration, reload/resume, completed-history display, and hidden-intent non-rendering.
5. A journey covering private scene to macro adjudication to save/reload, with a lying NPC claim kept distinct from NPC hidden intent and world truth.
6. Full `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:journeys`, and `npm run build` from `roman_crisis_simulation/src`.
7. Independent task reviews, one broad whole-branch review, an adversarial privacy review, and interactive browser acceptance.

## Explicit exclusions

- Autonomous NPC-NPC scenes.
- More than one participant NPC.
- More than one scene per macro turn.
- More than six NPC responses.
- Scene-generated relationship deltas, world deltas, mortality, dice, tiers, or action resolution.
- Player-visible summaries of NPC sincerity or hidden intent.
- Treating an NPC statement as ground truth.
- Background scene simulation, NPC-initiated invitations, multiplayer, or queued concurrent scenes.
