# Roadmap: Underlying AI Architecture

## 1. Vision
A living Rome where every named NPC is a small, persistent AI mind with private memory, a hidden agenda, and asymmetric knowledge — scheming off-screen against a separate "Director" that decides whose scheme gets screen time and adjudicates consequences. Turns are cheap, fast (streamed), never lose your game, and are fully replayable/debuggable because every prompt and response is captured. The model can never silently corrupt the world: outputs are schema-validated with automatic repair.

## 2. Current State (evidence-based)
The AI game-master is one monolithic client-side pipeline of 6-7 sequential Gemini calls per turn (`ai/core/turn.ts:runNewTurn`), not the "3 calls" the design doc claims (`ai/core/turn_logic.md:83-98` is stale). A single `AdjudicationSchema` call (`turn.ts:48-60`) is asked to simulate *every* NPC's proactive scheme AND adjudicate the player action AND every NPC reaction at once (`engine.ts:80-144`, Phase 1/Phase 2 in one prompt) — there is no per-NPC separation, only prompt instructions the model can freely ignore. "NPC minds vs. game-master" does not exist architecturally.

Real strengths to build on: genuine structured output (`responseSchema` from `schemas.ts` everywhere), a clean atomic delta model (`applyDeltas`/`applyAdjudication` in `engine.ts:151-361`, the one unit-tested piece — `tests/engine.test.ts`), a working off-screen sim (`simulatePrivateConversation`, `intelligence.ts:359`) and spotlight mechanism (`getStoryRelevance`), and sensible flash/pro tiering for flavor vs. state calls.

Critical gaps confirmed in code:
- **No runtime validation**: every call blindly casts, e.g. `JSON.parse(cleanedText) as Adjudication` (`turn.ts:60`). Off-schema-but-valid JSON dies as a swallowed `console.error` deep in `applyDeltas` (`engine.ts:308-310`) — the turn "succeeds" with missing consequences.
- **No retries/backoff** anywhere. Any transient failure is caught once at `App.tsx:143-148` → "Please refresh."
- **No persistence** (grep confirms zero `localStorage`/`IndexedDB` in app code) — so "refresh" destroys the entire campaign.
- **Fragile cleaner on the highest-stakes call**: the main adjudication uses the weakest inline regex cleaner (`turn.ts:59`), while `initiator.ts:cleanJson` has the better brace-hunting fallback. Three near-duplicate `cleanJson`s exist.
- **API key shipped in the client bundle** (`vite.config.ts:13-16`).
- **Unbounded O(N²) context**: `getEntityBrief` (`engine.ts:3-11`) serializes every relationship of every alive NPC every turn, while the game actively grows the cast (`add_entities`) with no pruning.
- **Zero replayability**: no temperature/seed on ~15 call sites; `TurnHistoryEntry` (`types.ts:216-222`) stores parsed output only, never raw prompt/response.

## 3. Prioritized Initiatives

### P0 — Foundation (do first; unblocks everything, stops session loss)

**P0.1 — Gemini service layer with validation + repair + retry** — *WHY:* today one flaky response silently corrupts state or kills the game; nothing else (multi-agent, streaming) is safe to build on a pipeline that can't trust its own JSON. *WHAT:* Create `ai/core/geminiService.ts` wrapping `ai.models.generateContent`. Add `zod` schemas mirroring `schemas.ts` 1:1; after `JSON.parse` run `schema.safeParse`. On failure, retry the same call with a repair suffix ("your last output violated the schema at <path>, regenerate valid JSON"). Wrap all calls in jittered exponential backoff for 429/5xx/network. Collapse the three `cleanJson`s + the inline `turn.ts:59` cleaner into one robust extractor (reuse `initiator.ts`'s brace-hunting). Type errors as `{transient|fatal}` so `App.tsx` can retry vs. surface. Route every call site in `turn.ts`, `intelligence.ts`, `initiator.ts`, `characterCreator.ts` through it. *Effort: M*

**P0.2 — Persistence + non-destructive failure** — *WHY:* the single biggest player-facing insult; a 40-turn campaign vanishes on any hiccup. *WHAT:* Snapshot `{entities, worldState, simulationState, turnHistory, reports, turnNumber}` to `localStorage` (later IndexedDB) *before* each turn's AI calls and after each success. Auto-load on mount. Change `App.tsx:143-148` from "Please refresh" to "The Fates falter — retry the turn?" restoring the pre-turn snapshot. Unblocks P0.1's retry-the-turn path. *Effort: S/M*

**P0.3 — Capture raw prompt + raw response per turn** — *WHY:* you cannot fix, tune, or trust what you can't see; prerequisite for eval (P1.4) and replay. *WHAT:* Extend `TurnHistoryEntry` (`types.ts:216-222`) with `rawCalls: {name, model, prompt, rawResponse, latencyMs}[]`. Have the P0.1 service push each call's raw text. Surface in `GameMasterScreen.tsx:176-180`'s "raw json" tab (currently shows only parsed adjudication). Set explicit `temperature` on all call configs so behavior is at least intentional. *Effort: S*

### P1 — The "dope" leap (high impact, needs P0)

**P1.1 — Split the monolith into Director + NPC minds** — *WHY:* this is the vision; separating "who acts" from "one call plays everyone" is what makes schemes feel independent and betrayals surprising. *WHAT:* Refactor `turn.ts` into: (a) **Director** call = current `getStoryRelevance` grown into a real orchestrator that picks 1-3 spotlight NPCs AND emits their *intents*; (b) per-spotlight **NPC-mind** calls, each given ONLY that NPC's brief + what they plausibly know (not the global world dump), returning that NPC's proactive `EventDelta[]` + private reasoning; (c) an **Adjudicator** call that takes player action + all NPC intents and resolves conflicts into the final `Adjudication`. Reuse `applyDeltas` unchanged. Run the NPC-mind calls with `Promise.all` — they're independent, so this *reduces* latency despite more calls. *Effort: L*

**P1.2 — Structured memory + context compression** — *WHY:* O(N²) briefs cap campaign length and rot quality as the cast grows; NPC minds need *their own* memory, not the whole world. *WHAT:* In `getEntityBrief` (`engine.ts:3-11`) send full detail only for spotlight + directly-related entities; one-line stubs for everyone else. Add a per-NPC memory store (already have `entity.memories`) with a periodic summarize-and-archive step (cheap flash call) collapsing old memories into a paragraph once past a threshold. Cap relationship serialization to top-K by salience. *Effort: M*

**P1.3 — Streaming narration** — *WHY:* the narration call (`turn.ts:123`) is the longest single wait and the most player-visible; streaming it makes turns *feel* 3x faster for free. *WHAT:* Switch the narration + suggested-actions call to `generateContentStream`; render tokens into Chat as they arrive. Keep structured calls non-streamed. *Effort: S/M*

**P1.4 — Narrative-quality eval harness** — *WHY:* once P0.3 captures raw turns, you can measure whether changes (P1.1, model swaps) make stories better or worse instead of guessing. *WHAT:* An offline script replaying saved prompt/response pairs; an LLM-judge (cheap model) scoring each turn on consequence-density, consistency with `simulationState`, and schema validity. Seed a golden-set of 10 turns from `tests/mockData.ts`. Gate refactors on non-regression. *Effort: M*

### P2 — Polish / later

- **P2.1 — Backend proxy for the API key** (`vite.config.ts:13-16`). Necessary before any public deploy, but irrelevant to local/experiment play — do NOT let it block P0/P1. *Effort: M*
- **P2.2 — Context caching** for the stable "world bible" re-serialized across pro-tier calls, once P1.1 has stabilized what's actually shared. *Effort: M*
- **P2.3 — Smarter private-conversation pairing**: replace hardcoded `spotlight_entities[0]/[1]` (`turn.ts:70-71`) with adversarial/scheme-complementary pairing, over >2 entities. Fold into P1.1's Director. *Effort: S*
- **P2.4 — Pin/version the model**: `gemini-3-pro-preview` is a preview id Google can retire; centralize it in P0.1's service as one constant with a fallback. *Effort: S*
- **P2.5 — Right-size `getInvestigationResult`** (`intelligence.ts:59-127`): a frequently-invoked side action on the expensive pro model; drop to flash unless quality demands otherwise. *Effort: S*

**Explicitly NOT yet:** native function-calling / autonomous tool-use (the current deterministic pipeline is fine once P1.1 splits it; function-calling adds nondeterminism before you have eval to catch regressions). Seed-based deterministic replay (Gemini seeds are unreliable; P0.3's raw-capture gives you replay debugging without it). A full backend rewrite.

## 4. Quick Wins (<1 hour each)
- Gate `runSmokeTest()` in `App.tsx`'s mount effect behind `isMockMode` — today it runs on every real-API load, validating mocks not the live path, adding startup latency + spurious `alert()`s (`tests/smokeTest.ts`).
- Swap the inline cleaner at `turn.ts:59` for `initiator.ts`'s brace-hunting `cleanJson` — one-line change protecting the highest-stakes call immediately (pre-P0.1 stopgap).
- `Promise.all` the two independent calls `getPlayerMonologue` (`turn.ts:98`) and narration (`turn.ts:123`) — pure latency win, no logic change.
- Add explicit `temperature` to the narration + adjudication configs so tone/consequence-density is tunable.
- Fix `turn_logic.md:83-98` to state the real pipeline (6-7 calls, `gemini-3-pro-preview` + `gemini-2.5-flash`) so it stops misleading contributors.
- Replace the `App.tsx:146` copy so it stops implying refresh (destructive) even before P0.2 lands.

## 5. Dependencies & Risks
- **P0.1 → everything.** Multi-agent (P1.1) multiplies call count; without validation+retry it multiplies failure surface. Build the service first.
- **P0.3 → P1.4.** No raw capture, no eval; no eval, P1.1 is a blind refactor of the single most important call.
- **Cross-domain (UI/State):** P0.2 persistence and P1.3 streaming both touch `App.tsx` state flow and Chat rendering — coordinate with the UI/State roadmap; snapshot shape must cover all `useState` in `App.tsx`.
- **Cost/latency risk:** P1.1 adds per-NPC calls. Mitigate by capping spotlight to ≤3, running them in parallel, and using flash for NPC-mind calls (reserve pro for the Adjudicator). Validate the cost with P1.4 before shipping.
- **Model risk:** the whole pipeline hardcodes preview model ids (`gemini-3-pro-preview`) across ~10 sites; a retirement breaks the game silently. P2.4 centralizes this — do it opportunistically inside P0.1.
- **Schema-drift risk:** zod schemas (P0.1) must stay in sync with `schemas.ts` Type.OBJECT trees; keep them in one file and add a test asserting shape parity.
- **Deploy risk:** the client-side key (P2.1) is a real abuse liability the moment this is public — acceptable for local play, a blocker for launch. Flag to owner as a go-live gate, not a now-task.
