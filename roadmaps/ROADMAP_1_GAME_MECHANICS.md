# Roadmap: Game Mechanics

## 1. Vision
A political intrigue sim where the numbers *bite*: personality traits and skills feed a deterministic resolution layer, five-axis relationships and factions gate what you can attempt, information is a scarce resource you spend to pierce fog-of-war, and denarii/legitimacy pressure forces hard tradeoffs. Every turn compounds — schemes mature, betrayals land, and the run ends in a real win or a real death you can trace back to a choice. The LLM narrates a world the *code* is scoring, not the other way around.

## 2. Current State (honest)
The architecture is better than the game. `applyDeltas` (`ai/core/engine.ts:151-314`) is a clean, tested pure reducer, and the 5-axis relationship model (trust/respect/perceived_threat/ideological_alignment/dependency) is genuinely deep with real clamping and unit tests (`tests/engine.test.ts:76-140`). But mechanically the game is hollow:
- **No stakes.** No win/loss anywhere; a player entity going `status:'dead'` (`engine.ts:217-223`) is ignored — `App.tsx` keeps prompting turns.
- **Stats are decorative.** Zero arithmetic reads any trait/skill; grep confirms they're only interpolated into prompt strings (`engine.ts:6-10`). No `Math.random`, no rolls — the sole "40% chance" lives in a *prompt string* (`intelligence.ts:108`).
- **No persistence.** All state is `useState` in `App.tsx`; refresh destroys the run.
- **Dead/invisible systems.** `WorldStateTab.tsx` + `RelationshipsTab.tsx` are 0-byte files (verified); `SimulationState` is computed every turn (`intelligence.ts:255`) and shown *nowhere*; `getDeepAnalysis` + `deep_analyses` resource are fully wired but never called; `turnInvestigations` (`App.tsx:37`) is written, never read.
- **Thin content.** Two scripted events (`constants/events.ts`), both gated `player.position === 'Emperor'` (verified) — dead for 3 of 4 protagonists. Resources are unclamped; denarii can go infinitely negative with no consequence. `npm test` doesn't exist (no `test` script in `package.json`, verified).

## 3. Prioritized Initiatives

### P0 — Do first (gives the game teeth and stakes)

**P0.1 — Stakes & End-States (game-over engine)** · Effort: M
*Why:* A sim with no win/loss isn't a game. This converts already-computed state into consequence and is the single biggest "is this real?" upgrade.
*What:* Add a `checkEndConditions(player, entities, simulationState)` step in the turn loop after `applyAdjudication` (`App.tsx` ~line 122). Trigger loss on player `status` ∈ {dead, exiled, missing}; add ambition-based win goals per starting character (e.g. become Emperor, or drive `simulationState.imperial_status` to a target while surviving). Add a `GAME_OVER` value to the `GameState` enum (`types.ts:3-8`) and a `GameOverScreen` component that reads `turnHistory` for an epitaph. Wire `simulationState` transitions (imperial_status:'Vacant', military_status:'Rebellious') as escalating danger flags.

**P0.2 — Deterministic Resolution Layer** · Effort: L
*Why:* Makes the rich stat block *mean* something and makes outcomes learnable/auditable instead of pure prompt-craft. This is the mechanical spine everything else hangs on.
*What:* New module `ai/core/resolution.ts` exporting `resolveAction(actor, action, difficulty, opposingEntity?)`. Seeded RNG (add a `seed` to game state so runs are reproducible). Formula: weighted sum of relevant skills + personality modifiers vs. a difficulty target, producing an outcome tier (crit-fail / fail / partial / success / crit-success). Compute this *before* the narration call and inject the tier into the adjudication prompt (`turn.ts:48-56`) so the LLM narrates a pre-decided result rather than inventing it. Replace the prose "40% chance" in `intelligence.ts:108` with an actual roll. Start with investigation + one player-action category; expand.

**P0.3 — Persistence** · Effort: S
*Why:* The game is built for long emergent narratives; a refresh nuking the whole run is unacceptable and blocks real playtesting.
*What:* Serialize `{entities, worldState, simulationState, turnHistory, reports, triggeredEventIds, seed}` to `localStorage` after each turn in `App.tsx`; hydrate on mount; add a "Continue / New Game" gate on the setup screen. Guard against schema drift with a version key.

### P1 — High impact next

**P1.1 — Surface the invisible layers (WorldState + Relationships tabs)** · Effort: M
*Why:* `SimulationState` and the 5-axis relationship web are the game's best-computed data and the player literally can't see them. Exposing them makes intrigue legible and turns strengths into felt gameplay.
*What:* Build out the 0-byte `WorldStateTab.tsx` (render `simulationState.*` — imperial/senate/military status, plebeian mood, ongoing crisis) and `RelationshipsTab.tsx` (a matrix/graph of the 5 axes). Wire both into `SidePanel.tsx`'s tab list.

**P1.2 — Resource tension with floors & consequences** · Effort: M
*Why:* Scarcity only exists if the LLM chooses to narrate it — that's not a system. Real economic pressure forces the tradeoffs a strategy game lives on.
*What:* In the `resource` case of `applyDeltas` (`engine.ts:164-172`), clamp against per-resource floors; when denarii/legitimacy cross a threshold, emit a coded consequence (forced event, relationship penalties, a `bankruptcy`/`disgraced` flag feeding P0.1's end-check). Define a small resource registry rather than the freeform bag.

**P1.3 — Events with reach & recurrence** · Effort: M
*Why:* Authored crisis beats are content; right now they're dead for most of the roster. A living event pool creates the "world moves without you" pressure the design promises.
*What:* Remove/generalize the `position === 'Emperor'` gate in `constants/events.ts`; add role-conditioned and simulationState-conditioned events (military mutiny when military_status:'Rebellious', etc.). Allow recurring/weighted events (drop the permanent-retire in `App.tsx:263` for a `repeatable` flag + cooldown). Fix the turn-number bug in `events/engine.ts:49` (`Math.floor(week/4)+1` should be the real 1:1 counter).

**P1.4 — Investigation risk/reward feedback loop** · Effort: S
*Why:* The consequences of risky intel are generated and thrown away (`turnInvestigations`, `App.tsx:37`, never read). Closing this loop makes information asymmetry a real spend-and-risk mechanic.
*What:* Surface `turnInvestigations` consequences in the UI (a notification/report entry); route the outcome through P0.2's roll; wire the dead-but-complete `getDeepAnalysis`/`deep_analyses` as a higher-cost intel tier in `DramatisPersonaeTab.tsx`.

### P2 — Polish / later

**P2.1 — Region evolution** · Effort: S · Extend the `region` delta case (`engine.ts:235-241`) beyond hard-coded `stability` to `controlling_faction` and append/expire on `current_events`, so EmpireTab's Local Events stop going stale after world-gen.

**P2.2 — Faction systems with teeth** · Effort: L · Aggregate member relationships into faction-level standing; let factions take off-screen actions against the player based on collective perceived_threat. Depends on P0.2 + P1.1.

**P2.3 — GM Intervention as a diegetic resource** · Effort: S · Gate the always-free reality-editor (`GameMasterScreen.tsx:208-229`, injected as MUST-honor at `engine.ts:42-46`) behind a spendable "Fortuna's Favor" resource with a cost/cooldown, or move it behind a dev-mode flag. Ship decision needed.

**P2.4 — Scheme desync safety** · Effort: S · The JSON-in-`reason`-string smuggling for scheme/add_region (`engine.ts:257-271`) fails silently on parse error. Emit a visible report/flag on failure so narration and state can't diverge unnoticed.

## 4. Quick Wins (<1hr each)
- Add `"test": "vitest run"` + `"test:watch": "vitest"` to `package.json` scripts — the suite exists (`tests/engine.test.ts`) but has no run path.
- Add the `GAME_OVER` enum value + a dead-player `console.warn`→visible banner as a stopgap before full P0.1.
- Fix the `Math.floor(week/4)+1` turn label bug (`events/engine.ts:49`).
- Delete or stub-with-TODO the 0-byte `WorldStateTab.tsx`/`RelationshipsTab.tsx` so their intent is explicit.
- Update `turn_logic.md:83-98` to document the real 7-call chain (stale docs mislead cost/latency reasoning).
- Add a resource floor of 0 (or configurable) to the `resource` delta case as a one-line clamp before the full P1.2 economy.

## 5. Dependencies & Risks
- **P0.2 is the keystone.** P1.2 consequences, P1.4 risk rolls, P2.2 faction actions all want the resolution layer. Build its interface first even if scope is thin.
- **Cross-domain (AI/Prompting):** P0.2 changes the adjudication contract — the LLM must narrate a *given* outcome tier, not decide it. Coordinate with the AI-core domain so prompts in `turn.ts`/`schemas.ts` (`AdjudicationSchema`) are updated in lockstep, or the model will fight the code.
- **Cross-domain (UI/UX):** P0.1 game-over screen, P1.1 tabs, P1.4 feedback all need UI work; sequence with the UI roadmap.
- **Cross-domain (Content/Narrative):** P1.3 event authoring is design-writing effort, not just engineering.
- **Risk — over-constraining emergence:** the game's charm is LLM-driven surprise. Deterministic rolls must *seed* narration, not replace it; keep outcome tiers coarse (5 bands) so the model still has room to invent *how*. Don't build a rigid stat-check wall.
- **Risk — persistence schema drift:** P0.3 must version its blob or every future type change (P0.2 seed, P1.2 resource registry) breaks saved runs.

## What NOT to do yet
Don't build P2.2 faction AI, a tech/skill progression tree, multiplayer, or procedural event generation until P0 lands — stakes + a resolution layer + persistence are the foundation that makes any of that meaningful. Don't polish the delta reducer's edge cases (P2.4) before the game can be won or lost.
