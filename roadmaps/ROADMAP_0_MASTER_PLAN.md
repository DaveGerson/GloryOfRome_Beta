# Glory of Rome — Master Phased Roadmap

**Goal: rapidly take this from a fun experiment to dope as hell.**

This plan synthesizes the six domain roadmaps in this directory:

| # | Domain | File |
|---|--------|------|
| 1 | Game Mechanics | `ROADMAP_1_GAME_MECHANICS.md` |
| 2 | AI Architecture | `ROADMAP_2_AI_ARCHITECTURE.md` |
| 3 | UX & Interactions | `ROADMAP_3_UX_INTERACTIONS.md` |
| 4 | Funness | `ROADMAP_4_FUNNESS.md` |
| 5 | Tech Performance & Architecture | `ROADMAP_5_TECH_PERFORMANCE.md` |
| 6 | Maintainability | `ROADMAP_6_MAINTAINABILITY.md` |

Items below cite their source as `<Domain>-<Priority>` (e.g. `AI-P0.1` = Roadmap 2, initiative P0.1).

## Status (July 2026)

Phases 0–3 are shipped. PR #4 additionally landed a full design-system re-skin
(LVX/NOX day/night themes, `gor-*` component classes, Tailwind removed) —
not originally scoped in this plan, but folded in alongside the Phase 2/3
engine work. The suite is 208 tests, all green, running in CI
(`.github/workflows/ci.yml`) on every push.

Phase 4 as drafted below is stale against the current code and has been
re-planned: `PHASE_4_BRAINSTORM.md` holds the audited premises and decision
record, the owner's rulings are `DESIGN_DECISIONS.md` D9–D18, and the
superseding plan is `ROADMAP_PHASE_4.md`.

The six domain roadmaps (`ROADMAP_1`–`ROADMAP_6`) are historical analyses of
the pre-Phase-0 codebase. They are intentionally left un-updated — they're
the diagnosis that produced this plan, not a live tracker — so read their
line references and code claims as a snapshot of where the project used to
be.

## The headline diagnosis (where all six roadmaps converge)

Six independent analyses reached the same conclusion: **the engine already simulates the hard part — the game just hides it, can't be won, and can't survive a refresh.**

1. **No stakes.** There is no win/loss anywhere; a dead player keeps taking turns (`engine.ts:217`, `App.tsx:90-149`). Flagged by Mechanics, Funness, UX. *(since fixed — Phase 2: death is real via the mortality pipeline, `GameState.GAME_OVER` + `EpilogueScreen`; per D1 there's still no "win," survival-only by design.)*
2. **No persistence.** All state is `useState` in `App.tsx`; any error says "Please refresh," which destroys the campaign. Flagged by *all six* domains — the single most-agreed-on fix in the project. *(since fixed — Phase 1: versioned save/load in `persistence/saveGame.ts` (`SAVE_VERSION`), non-destructive failure with a retry affordance instead of "please refresh".)*
3. **The drama is computed, then thrown away.** `SimulationState` is recomputed every turn and read by zero components; `adjudication.deltas` are rich and shown only in a debug screen; two tab files are 0 bytes; `deep_analyses` and `turnInvestigations` are wired and never consumed. *(partially fixed — Phase 2/3: `WorldStateTab`/`CrisisBanner` surface `SimulationState`, and the investigation loop (`deep_analyses`/`turnInvestigations`) is closed. `RelationshipsTab.tsx` is still a 0-byte stub — that's Phase 4 work, not yet done.)*
4. **The AI pipeline is fragile and slow.** 6–7 sequential Gemini calls per turn, zero validation (`JSON.parse(...) as X`), zero retries, 3+ duplicate `cleanJson`s, model id hardcoded at ~10 sites, tens of seconds of dead air with no progress signal. *(since fixed — Phase 1: single `ai/core/geminiService.ts` layer with one model constant, zod validation + schema-repair retry, backoff; Phase 3: streaming narration + staged turn theater + parallelized legs cut the dead air.)*
5. **Stats are decorative.** No arithmetic reads any trait or skill; the only "dice roll" is a prose string inside a prompt (`intelligence.ts:108`). *(since fixed — Phase 3: `ai/core/resolution.ts` deterministic skill/trait-weighted checks with tiered outcomes; `ai/core/mortality.ts` for death saves/NPC fate. Rolls are not yet seeded/reproducible — that's Phase 4A work, `ROADMAP_PHASE_4.md`.)*
6. **No safety net.** The good test suite (`engine.test.ts`) cannot run: no `test` script, `jsdom` missing, `vitest` in the wrong dependency block, no CI. Plus a confirmed bug: `includes('dead')` never matches "died" (`engine.ts:219`). *(since fixed — Phase 0/1: `test`/`typecheck` scripts + `jsdom` in `package.json`, `.github/workflows/ci.yml` running `npm ci && typecheck && test && build`; the string-parsing bug is gone, replaced by a structured `new_status` enum. Suite is now 208 tests, all green.)*

The phases below fix these in dependency order, front-loading player-felt impact.

---

## Phase 0 — The Quick-Win Blitz (≈1 day)

Every item is <1 hour, independently shippable, and either fixes a lie or lays a foundation stone. Do them all in one sitting.

- [x] Add `"test": "vitest run"` + `"typecheck": "tsc --noEmit"` scripts; move `vitest` to `devDependencies`; add `jsdom`. Confirm `engine.test.ts` is green. *(MAINT-P0.1 down payment)* — verified in `package.json`; suite is now 208 tests, all green.
- [x] Add `.gitignore` (`node_modules`, `.idea/`, `.env`, `dist`) + `git rm -r --cached .idea/`; add `.env.example`. *(MAINT quick wins)* — verified: `.gitignore` covers all four, no `.idea/` tracked, `.env.example` present at repo root.
- [x] Stopgap the `died`/`dead` bug: `|| newStatus.includes('died')` at `engine.ts:219`. *(MAINT-P0.2 stopgap)* — superseded by the full Phase 1 fix (structured `new_status` enum in `types.ts`), not just the substring stopgap.
- [x] Swap the weak inline JSON cleaner at `turn.ts:59` for `initiator.ts`'s brace-hunting `cleanJson` — protects the highest-stakes call today. *(AI quick win)* — superseded by Phase 1's shared `ai/core/json.ts`, which `turn.ts` now goes through via `geminiService.ts`.
- [x] Change the `App.tsx:146` error copy to stop saying "Please refresh"; log the real error; don't clear the player's input until the turn succeeds (stash `lastAction`). *(UX quick wins)* — verified: no "please refresh" copy remains; failed turns restore the action via a `retryAction` stash and offer a one-click Retry.
- [x] Gate the startup `alert()` smoke test and Mock Mode toggle behind `import.meta.env.DEV`. *(UX-P0.4 down payment)* — verified in `App.tsx` and `components/Header.tsx`.
- [x] Staged loading copy cycling in the `PROCESSING` placeholder ("Whispers cross the Senate floor…"). *(FUN-P2.2 stopgap until Phase 3)* — verified: `STAGE_STATUS_COPY` in `components/Chat.tsx`, later hooked up to real `onStage` events in Phase 3.
- [x] Render `simulationState.major_ongoing_crisis` as a banner when non-null. *(FUN-P0.2 down payment)* — verified: `components/CrisisBanner.tsx`, wired in `App.tsx`.
- [x] `Promise.all` the NPC batch loop in `initiator.ts:193-207` — immediate world-gen speedup. *(TECH quick win)* — verified in `ai/core/initiator.ts`.
- [x] `beforeunload` warning so a tab-close prompts before nuking the session (dies in Phase 1 when saves land). *(TECH quick win)* — verified in `App.tsx`; superseded in spirit by Phase 1 persistence, but the listener is still in place.
- [x] Fix the `Math.floor(week/4)+1` turn-label bug (`events/engine.ts:49`). *(MECH quick win)* — verified in `events/engine.ts`.
- [x] Update `turn_logic.md` to document the real 6–7-call pipeline. *(AI quick win)* — verified: `ai/core/turn_logic.md` documents all 7 calls in detail. Note: it predates the Phase 2/3 additions (mortality, `resolution.ts`, streaming) and is now itself a historical snapshot, same as the six domain roadmaps.

**Checkpoint:** tests run, the repo is hygienic, the worst first-run embarrassments are gone.

## Phase 1 — Bedrock: Unlosable & Unbreakable (≈1 week)

Nothing dope can be built on a pipeline that silently corrupts state and a game that evaporates on refresh. Every later phase depends on this one.

1. **CI wall.** `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run test` on every push. Commit a lockfile. No later refactor merges without it. *(MAINT-P0.1)*
2. **One Gemini service layer** — built ONCE (three roadmaps each specced their own; this is the shared seam). `ai/core/geminiService.ts`: single model constant (kills 10 hardcoded `gemini-3-pro-preview` sites), one canonical `cleanJson`, zod validation mirroring `schemas.ts` with a one-shot schema-repair retry, jittered exponential backoff on 429/5xx, typed errors (`transient` vs `fatal`), explicit `temperature`, and **raw prompt/response capture per call** (extend `TurnHistoryEntry` — this is the prerequisite for the Phase 4 eval harness). Route `turn.ts`, `intelligence.ts`, `initiator.ts`, `characterCreator.ts` through it; keep `isMockMode` branching at this boundary. *(AI-P0.1 + AI-P0.3 + TECH-P0.3b/c + MAINT-P0.3)*
3. **Persistence + save/load.** Snapshot the full state bundle (`entities`, `worldState`, `simulationState`, `reports`, `turnHistory`, `messages`, `turnNumber`, `playerCharacterId`, `eventHistory`, `metaNarrative`, `triggeredEventIds`) **before** each turn's AI calls and after each success. `localStorage` first; move to IndexedDB (`idb-keyval`) when `turnHistory` grows. **Version the blob** — schemas will drift in Phases 2–4. "Continue your reign" on `CharacterSelection`. *(All six domains' P0)*
4. **Non-destructive failure.** Typed errors surfaced as in-fiction chat bubbles ("The Fates falter — retry?") with a Retry that restores the pre-turn snapshot and re-runs the stashed action. React `ErrorBoundary` with a "reload last save" fallback. *(UX-P0.3 + TECH-P0.4 + AI-P0.2)*
5. **Status becomes a contract.** Replace `includes('dead')` substring parsing with a structured `new_status` enum on the `status` EventDelta in `types.ts` + `schemas.ts` + prompts + mocks + unit tests. *(MAINT-P0.2 — first exercise of the new CI + service layer)*

**Checkpoint:** a 40-turn campaign survives refreshes, crashes, and flaky API responses. You can now ask friends to playtest without apologizing.

## Phase 2 — Make It a Game: Mortality, Perception & Pressure (≈1–2 weeks)

**REVISED per owner rulings — see `DESIGN_DECISIONS.md` (D1–D8), which overrides the original draft of this phase.** No win conditions: survival-only simulation (D1). The player is never omniscient (D5). Rolls are hidden (D4).

1. **Mortality pipeline.** Any declared death is dispositioned by a second, independent validation call; then a hidden code-side roll: player d20 death save with four bands (1–5 die / 6–10 survive with a real loss / 11–17 survive / 18–20 survive with a boon) per D2, and a separate **NPC fate table** per D3 whose outcomes include *presumed dead* — secretly alive in hiding, may return as a nemesis (GM-private state, fed back to the adjudicator, never leaked to player-facing surfaces). The model narrates pre-decided outcomes. Player death → `GameState.GAME_OVER` + a Tacitus-style `EpilogueScreen` from `turnHistory`. *(MECH-P0.1 + FUN-P0.1, redesigned)*
2. **Perception layer (crude v1).** A code-side visibility filter (witnessed / own location / `visibility_network` / public headlines) governs BOTH the world-status display (build `WorldStateTab` as the player's intelligence picture; empire-level macro status counts as public knowledge) and the perceived "what changed" feed (filtered deltas with source tags — never raw global truth). Fidelity is binary in v1; lying sources come in Phase 3/4 once the GM console can tune them. *(FUN-P0.2/P0.3 + MECH-P1.1a, redesigned per D5)*
3. **Systemic resource registry.** Denarii first (D6): own treasury objectively knowable, engine-enforced floors/thresholds, and debt-to-a-person as the bankruptcy consequence (a creditor who owns you feeds the relationship system) rather than a bare zero floor. The freeform resource bag stays for everything else. Unfreeze the dead Header meters via a `world` delta type. *(MECH-P1.2 + FUN-P2.1a)*
4. **GM console as tuning instrument (D7).** Runtime toggle (hidden by default, not env-gated away) — home of ALL ground truth: unfiltered deltas, true `SimulationState`, raw AI calls, mortality rolls and validation traces.
5. **Inferred ambition (D8).** A cheap periodic model call infers what the player *appears* to be pursuing; its persisted result feeds only the GM console for inspection and tuning, never the player epilogue, NPC reactions, or a quest log.

**Checkpoint:** death is real (but dramatic), the world is seen through your character's eyes, and every run ends in an epitaph worth screenshotting.

## Phase 3 — Make It Feel Alive: Speed, Spectacle & Teeth (≈1–2 weeks)

1. **Staged "thinking" theater.** `onStage` callback from `runNewTurn` drives themed live status in a chat bubble ("Your rivals move in the dark…") for each of the 7 stages. *(UX-P0.1a)*
2. **Streaming narration.** Swap the narration call to `generateContentStream`; the GM's dispatch types onto the page. **Land streaming before parallelization** — `simulatePrivateConversation`/`getRelationshipUpdates` mutate shared state (`adjudication.gm_private`), so parallel legs must return deltas applied in defined order, not mutate concurrently. *(UX-P0.1b → then UX-P1.1 + TECH-P0.3a, AI-P1.3)*
3. **Parallelize the independent legs.** `Promise.all` monologue + narration; start `getStoryRelevance` early. Real latency −30–40%, compounding with the perceived win. *(TECH-P0.3a)*
4. **Deterministic resolution layer — the mechanical spine.** `ai/core/resolution.ts`: seeded RNG, skill/trait/relationship-weighted checks producing a coarse outcome tier (crit-fail → crit-success) computed *before* the narration call; the LLM narrates a pre-decided result. **Phase 2's mortality pipeline (death save + NPC fate table) is this module's first consumer — extend it, don't fork it.** Feed skills into `getEntityBrief`; replace the prose "40% chance" with a real roll. Per D4, rolls stay hidden — odds may be shown *before* a gamble, outcomes only through narration. ⚠️ **This rewrites the adjudication contract — mechanics + AI prompts (`turn.ts`, `schemas.ts`) must change in lockstep, and tiers stay coarse so the model keeps room to invent *how*.** *(MECH-P0.2 + FUN-P1.1/P1.2)*
5. **Close the investigation loop.** Surface `turnInvestigations` consequences (written, never read); wire the dead-but-complete `getDeepAnalysis`/`deep_analyses` as a higher-cost intel tier — or cut it, but don't leave it half-wired. *(MECH-P1.4 + FUN-P1.5)*
6. **Onboarding.** Dismissable 3-step intro on first input; seed starter suggested actions so turn 1 isn't a blank page. *(UX-P1.4)*

**Checkpoint:** turns feel fast and dramatic, dice are real, character builds matter. The game *feels* alive.

## Phase 4 — Make It Deep: The Dope Leap (≈2–3 weeks)

The differentiator: NPCs as independent scheming minds, and an intelligence UI that rewards paranoia.

1. **Eval harness first.** Offline replay of Phase-1's captured raw turns; LLM-judge scoring consequence-density, consistency, schema validity; golden set of ~10 turns. Gate the refactor below on non-regression — otherwise it's a blind rewrite of the game's most important call. *(AI-P1.4, requires AI-P0.3 from Phase 1)*
2. **Split the monolith: Director → NPC minds → Adjudicator.** Director picks 1–3 spotlight NPCs + intents; per-NPC mind calls (flash tier, `Promise.all`, each seeing only what that NPC plausibly knows) return schemes + private reasoning; a pro-tier Adjudicator resolves conflicts into the final `Adjudication`. `applyDeltas` unchanged. *(AI-P1.1)*
3. **Structured memory + context compression.** Full briefs only for spotlight + related entities; periodic flash-call summarization of old memories; top-K relationship serialization. Kills the O(N²) context growth that caps campaign length. *(AI-P1.2)*
4. **The intelligence dashboard.** Build `RelationshipsTab` as a player-centric relationship map (5 axes → edge color/weight); add a deliberately-unreliable Rumor Feed sourced from headlines + private-conversation leaks (so betrayal is *felt* brewing); persistent per-NPC dossiers that accrete across turns; a player-facing illuminated-manuscript Chronicle from `turnHistory`. *(UX-P1.2/P1.3 + MECH-P1.1b + FUN-P1.3 leak channel)*
5. **NPC voice & pacing.** `voice`/`epithet` fields feeding narration; signature "moment" lines on scheme completion; a `tensionBudget` scalar that lets quiet weeks breathe then forces payoff turns — backed by at least one deterministic consequence so a payoff can't silently no-op. *(FUN-P1.3/P1.4)*
6. **Events with reach.** Drop the Emperor-only gate (dead content for 3 of 4 protagonists); key 6–10 events off `simulationState` instead of brittle string matches; repeatable events with cooldowns. *(MECH-P1.3 + FUN-P2.1b)*
7. **Codebase keeps pace.** `useReducer`+`GameContext` extraction of the 337-line `App.tsx` god-component; then incremental `strict` TS (kill `WorldState`'s `[key:string]:any`); zod as single source of truth with contract tests against mocks; bound `turnHistory` memory; fix `applyDeltas` deep-clone churn *then* memoize. Order: reducer → strict → hooks; churn fix → memo. *(MAINT-P1.1–P1.4 + TECH-P1.1/P1.3/P1.4)*

**Checkpoint:** NPCs scheme independently off-screen and the player has the tools to detect it. "You won't believe what Maximinus did" moments happen and can be screenshotted.

## Phase 5 — Ship It: Public-Ready (≈1 week, gate before any public link)

Deliberately last — all six roadmaps agree these are launch gates, not now-tasks. **Nothing in this phase blocks local play; all of it blocks a public URL.**

1. **API-key proxy.** One serverless function holds `GEMINI_API_KEY` (with SSE passthrough for streaming); delete the `vite.config.ts` define block. The client-bundled key is a hard deploy blocker and billing leak. *(TECH-P0.2 + AI-P2.1 + flagged by UX & MAINT)*
2. **Sanitize LLM output.** Replace the `dangerouslySetInnerHTML` bold-regex in `Chat.tsx` with escape-then-format. *(TECH-P2.4 + UX-P2.2)*
3. **Bundle hygiene.** Move Tailwind/React/genai off CDN/importmap into the Vite build; normalize project layout (config files out of `src/`); archive the stale Python-era design docs with a SUPERSEDED banner. *(TECH-P2.1/P2.2 + MAINT-P2.1 + UX-P2.3)*
4. **A11y + responsive pass.** Dialog roles, focus traps, `aria-live` on the message list; stacked mobile layout. *(UX-P2.1/P2.2)*
5. **Ship decisions.** Gate the free reality-editing GM Intervention behind a cost ("Fortuna's Favor") or a dev flag; context caching for the stable world bible; pin/fallback the preview model id (should already be one constant from Phase 1). *(MECH-P2.3 + AI-P2.2/P2.4)*

**Checkpoint:** you can post the link publicly without leaking your API key or your dignity.

---

## Cross-cutting rules (conflict resolutions between the domain roadmaps)

1. **One service layer.** Roadmaps 2, 5, and 6 each specced a Gemini wrapper. Build it once in Phase 1; every later AI change goes through it.
2. **The resolution-layer contract is co-owned.** Mechanics decides outcomes; AI narrates them. Prompts in `turn.ts`/`schemas.ts` change in lockstep with `resolution.ts` or the model will fight the code.
3. **Stream before you parallelize.** Shared-state mutation in `turn.ts` makes naive `Promise.all` a race; refactor legs to return deltas first.
4. **Persistence blob is versioned from day one.** Phases 2–4 all mutate the save shape; save-format v1 + graceful mismatch handling is non-negotiable.
5. **Key proxy is a launch gate, not a now-task.** (Tech ranked it P0, AI ranked it P2 — resolved: it blocks a public URL, not local play. Phase 5.)
6. **Surface computed data before making new AI calls.** The cheapest fun in the codebase is data already paid for (`SimulationState`, deltas, private conversations). New round-trips fight the latency budget.
7. **No refactor without green CI.** Phase 1 item 1 precedes everything structural.

## What NOT to do (yet) — unanimous across roadmaps

Multiplayer, accounts/cloud saves, a full backend rewrite, native LLM function-calling, procedural event generation at scale, a tech-tree, mobile layout before the loop feels alive, and big content authoring before Phase 2 lands (content poured into a loop with no stakes is wasted).
