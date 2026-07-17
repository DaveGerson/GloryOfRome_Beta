# Roadmap: Funness

## 1. Vision
Glory of Rome should feel like *directing your own season of a political thriller* — quiet weeks of maneuvering punctuated by an assassination you half-saw coming, a betrayal you *feel* in your gut because you watched the trust meter bleed out over five turns, and a final reckoning where your reign ends in purple glory or a knife in the Curia. Every session is a 30–60 min arc with a real ending and a story you want to screenshot and send to a friend: "you won't believe what Maximinus did."

## 2. Current State (honest, evidence-grounded)
The engine already simulates the *hard* part — proactive scheming NPCs, off-screen private conversations (`turn.ts:68-93`), information asymmetry (`intelligence.ts`), dynamic schemes (`engine.ts:130`). But almost none of that drama reaches the player. Concretely:
- **No ending.** `GameState` (`types.ts:3-8`) has no `GAME_OVER`. `applyDeltas` can mark the player `dead` (`engine.ts:217-234`) and `executeTurn` (`App.tsx:90-149`) never checks `playerEntity.status`. A dead character keeps taking turns. No win condition exists.
- **The drama is computed, then hidden.** `SimulationState` (`imperial_status`, `major_ongoing_crisis`, etc., `types.ts:271-277`) is recomputed every turn by a dedicated Gemini call (`getUpdatedSimulationState`, `intelligence.ts:255-301`) and read by *zero* components.
- **Consequences are invisible.** Rich `EventDelta` objects (`types.ts:171-176`) surface only in the debug `GameMasterScreen`. Players get one prose blob (`Chat.tsx:24`, bold-only) and must hand-diff 6 SidePanel tabs.
- **Frozen headline meters.** `economic_stability`/`political_climate` (Header, `Header.tsx:29-30`) can never change — no `EventDeltaType` touches top-level `WorldState` (`EventDeltaTypeEnum`, `types.ts:152`).
- **Fake dice.** "Do nothing… risk of a riot is high" (`events.ts:31`) deterministically sets `Riots` (`events.ts:33`). Only 2 authored events exist, gated on brittle string matches that rarely fire.
- **Dead systems.** Player `skills` never enter any prompt (`getEntityBrief`, `engine.ts:3-11`). `deep_analyses` is a resource with no consumer.
- **Fragile & unforgiving.** 7 sequential Gemini calls (`turn.ts`), any JSON hiccup → "Please refresh" (`App.tsx:143-148`) → whole session lost (no persistence anywhere).

The bones are excellent; the game hides its own best moments and has no shape.

## 3. Prioritized Initiatives

### P0 — Do first (unlocks stakes, feedback, and trust that the game works)

**P0.1 — Endings & Fail State ("the run means something")** — L
- WHY: This is the single biggest fun lever. Irreversible deltas (death, exile, faction collapse) currently do nothing. Without a fail/win state there are no stakes and no closure — the game just drifts.
- WHAT: Add `GameState.GAME_OVER` to `types.ts:3-8`. In `executeTurn` (`App.tsx:118-141`), after committing state, check `result.updatedEntities` for the player's `status !== 'alive'` AND check win conditions (e.g. `simulationState.imperial_status === 'Stable'` while player `position === 'Emperor'` for N turns, or player-defined victory goal). Build an `EpilogueScreen` component that reads `turnHistory`/`eventHistory` and renders a Tacitus-style obituary — grand ("Deified by the Senate") or ignominious ("Struck down in the Curia, name damned") based on how the crisis resolved. Reuse the Chronicle data.

**P0.2 — Surface SimulationState as the Drama Meter** — S
- WHY: Highest impact-per-hour in the whole codebase. The escalation drama is *already computed every turn* and thrown away. Wiring it in is nearly free and instantly makes the world feel alive.
- WHAT: Render `simulationState` in the Header/banner. When `imperial_status` flips to `Vacant` or `major_ongoing_crisis` becomes non-null, show a full-width alert banner ("SUCCESSION CRISIS — THE THRONE IS VACANT"). Add a `WorldStateTab` panel showing all 5 fields with color-coded severity. Data path already exists in `App.tsx` state; only UI is missing.

**P0.3 — "What Changed This Turn" Digest + Juice** — M
- WHY: Feedback is the core of any game loop, and this game produces gorgeous structured data (`adjudication.deltas`) then shows the player a paragraph. Make consequences legible and satisfying.
- WHAT: Between the player message and the narration in `executeTurn` (`App.tsx:133`), render a compact digest built from `result.newHistoryEntry.adjudication.deltas`: "Trust with Maximinus −3 · Denarii −20,000 · The Suburra → Riots", each mapped to a friendly label + red/green color. On any resource/relationship delta, pulse the relevant SidePanel tab icon (`SidePanel.tsx:32-39`). This turns existing data into "juice" with zero new AI calls.

**P0.4 — Persistence + Turn-Level Resilience** — M
- WHY: A game whose pitch is a multi-turn narrative arc currently deletes the whole arc on any of 7 JSON parses failing. That is a trust-killer; players won't invest emotionally in a run that can vanish.
- WHAT: Snapshot `{entities, worldState, simulationState, reports, turnHistory, messages, turnNumber}` to `localStorage` after every successful turn in `executeTurn`. On load, offer "Continue your reign." Change the catch block (`App.tsx:143-148`) to restore the last snapshot and say "The Fates faltered — your last action was undone. Try again." Add a single shared `cleanJson`+parse-with-retry helper (dedupe the 3 copies in `turn.ts:59`, `initiator.ts`, `intelligence.ts`) that re-prompts once on parse failure before giving up.

### P1 — High impact next (depth, character, pacing)

**P1.1 — Skills Actually Matter** — S
- WHY: A statted RPG sheet that never influences outcomes is a lie the player eventually catches. Making skills load-bearing gives "build a character" meaning and makes wins feel earned, not just well-phrased.
- WHAT: Include player+NPC `skills` in `getEntityBrief` (`engine.ts:3-11`). Add a rule to the adjudication prompt (`engine.ts:122-141`): weigh the acting entity's relevant skill (oratory for persuasion, intrigue for schemes, strategy for military) against difficulty when resolving success/failure. Same for `getInvestigationResult` (`intelligence.ts:97-113`) — an intrigue-heavy player should trip the 40% consequence roll less often.

**P1.2 — Real Risk/Reward Gambles** — M
- WHY: "Fake dice" (`events.ts:31-36`) undercut the thriller fantasy. Genuine uncertainty is what makes gambles fun and stories shareable.
- WHAT: Give `PlayerEventChoice` and skill-checked intents an actual roll: success probability derived from relevant skill + relationship state, resolved with `Math.random()`, branching to different delta sets. Show the odds ("~70% the Guard holds") before committing. Surface the outcome ("The dice of the gods land against you") in the digest.

**P1.3 — Named NPC Voice & Memorable Personalities** — M
- WHY: "You won't believe what Maximinus did" requires NPCs with a *voice*, not stat blocks. The scheming exists; the personality expression doesn't reach the player.
- WHAT: Add a short `voice`/`epithet` field to entities in `baseScenario.ts` and feed it to narration (`turn.ts:101-122`) so NPCs speak in character. When a spotlight NPC completes a scheme, generate a signature "moment" line attributed to them. Give the private-conversation trace (`turn.ts:90`) a player-facing (but deniable) leak channel: a rumor or spy report so the player *feels* the betrayal brewing.

**P1.4 — Deliberate Pacing: Quiet Turns Then Explosions** — M
- WHY: Currently the prompt just begs the LLM for drama every turn (`engine.ts:123`) with nothing backing it — either monotonous escalation or random flatness. Real drama needs rhythm.
- WHAT: Add a lightweight `tensionBudget` to game state that rises during quiet turns and, past a threshold, injects a "PAYOFF TURN" instruction into the adjudication prompt (a scheme detonates, a crisis breaks). Between payoffs, allow genuinely quiet weeks. This is a scalar + one conditional prompt block, not new AI calls.

**P1.5 — Finish or Cut `deep_analyses`** — S
- WHY: A handed-out resource with no consumer reads as broken the moment anyone tries it.
- WHAT: Wire `getDeepAnalysis` (`intelligence.ts:46-57`) into `DramatisPersonaeTab` as a higher-tier intel option (deeper read on motives/schemes), spending the resource via `handleSpendResource` (`App.tsx:206-216`). If deprioritized, remove the resource + tooltip instead — do not leave it half-wired.

### P2 — Polish / later

**P2.1 — Expand the Event Library + `world` Delta Type** — M
- WHY: 2 rarely-firing set-pieces starve the "special moment" system. But this is lower priority than making the *base* loop feel great — don't author content into a loop that doesn't yet reward the player.
- WHAT: Add `'world'` to `EventDeltaTypeEnum` (`types.ts:152`) + a case in `applyDeltas` that writes `economic_stability`/`political_climate` (fixes the frozen Header meters too). Then author 6–10 crisis events with broad, robust triggers keyed off `simulationState` rather than brittle free-text string matches.

**P2.2 — Perceived-Latency Staging** — S
- WHY: Long dead air is a fun-killer, but real fix (parallelization) is a *Performance* domain concern; the cheap perceptual win belongs here.
- WHAT: Add staged loading copy ("The Senate reacts…", "Chronicling the week…", "Whispers in the dark…") cycling in `Chat.tsx:75` while `PROCESSING`. Costs nothing, hides the wait.

**P2.3 — Scannable Transcript** — S
- WHY: A wall of identical prose blobs is hard to reread and unshareable.
- WHAT: Extend `Chat.tsx:24` rendering: style headlines, rumors, dialogue, and monologue distinctly (icons/color/typography). Make the "Inner Thoughts" and source-cited intel visually distinct beats.

## 4. Quick Wins (< 1 hour each)
- **Add `GameState.GAME_OVER` enum + a `playerEntity.status !== 'alive'` check** in `executeTurn` that at minimum locks input and shows "Your story has ended." (skeleton for P0.1).
- **Render `simulationState.major_ongoing_crisis` as a banner** when non-null (down payment on P0.2).
- **Staged loading text** in the "Awaiting Game Master…" state (`Chat.tsx:75`) — P2.2.
- **localStorage snapshot** of core state after each turn (down payment on P0.4) — even without restore UI, it stops total loss.
- **Change the error message** (`App.tsx:146`) from "Please refresh" to a non-destructive retry that preserves state.
- **Dedupe `cleanJson`** into one shared helper imported by `turn.ts`/`initiator.ts`/`intelligence.ts`.

## 5. Dependencies & Risks
- **P0.3 & P2.3 depend on the UX/Presentation domain** for tab-pulse animation and message styling — coordinate so digest + juice land together.
- **P0.4 & P2.2 overlap the Performance/Reliability domain.** Parallelizing the 7 calls (`turn.ts`) and schema-validated retries belong there; this roadmap only needs the *perceptual* and *persistence* slices. Don't duplicate the retry helper — build it once, shared.
- **P1.1/P1.2 depend on prompt-engineering discipline.** Injecting skills + dice into adjudication risks the LLM ignoring or over-indexing on them. Mitigate with explicit, bounded rules in `engine.ts` and test via `engine.test.ts`/`smokeTest.ts` before shipping.
- **Risk — LLM non-compliance with pacing (P1.4).** The `tensionBudget` payoff instruction is still advisory to the model; back it with at least one *deterministic* consequence (e.g. force a scheme-completion delta) so a payoff turn can't silently no-op.
- **What NOT to do yet:** Do **not** author a large event library (P2.1) or chase full call-parallelization before P0 ships — content and speed are wasted on a loop that still hides its consequences and has no ending. Fix stakes + feedback + resilience first; everything else compounds off that.
