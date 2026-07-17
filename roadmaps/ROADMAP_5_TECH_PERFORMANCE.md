# Roadmap: Technical Performance & Architecture

## 1. Vision
A turn should feel like a fast, reliable heartbeat: the player types an intent and gets responsive, streaming feedback in seconds — never a 30-second white-knuckle wait that can end in "Please refresh" and a lost playthrough. State is durable (auto-saved every turn, resumable across refreshes/crashes), the AI pipeline is parallel + retry-hardened, and the key never ships to the browser. "Truly dope" here is invisible: nothing about the plumbing ever pulls the player out of Rome.

## 2. Current State (honest, evidence-grounded)
The core is better than the plumbing. `ai/core/engine.ts` (`applyDeltas`/`applyAdjudication`) is a clean, pure, unit-tested delta engine — genuinely good. Everything around it is Google-AI-Studio-export scaffolding that never grew up:
- **All state in `App.tsx`** — 20+ `useState` hooks (`App.tsx:23-44`) prop-drilled through `SidePanel` → 6 tabs. No reducer, no context. Own README already flags this (`src/README.md:100-104`).
- **Fully serial AI pipeline** — `runNewTurn` (`ai/core/turn.ts:38-140`) awaits 5-7 Gemini calls back-to-back; `initiateWorld` (`ai/core/initiator.ts:191-207`) loops NPC batches sequentially. Zero `Promise.all` in the repo. A turn is tens of seconds of dead air.
- **No persistence** — zero `localStorage`/`IndexedDB`/backend. Refresh = total loss.
- **Key in the browser bundle** — `vite.config.ts:13-16` `define`s `GEMINI_API_KEY`; `App.tsx:47` calls Gemini client-side. Extractable by anyone. Hard deploy blocker.
- **One generic try/catch** (`App.tsx:102-148`) for the whole pipeline; no retry/backoff; 4 duplicated `cleanJson` regexes; no `zod`; no `ErrorBoundary`.
- **Perf defeated by design** — `applyDeltas` deep-clones via `JSON.parse(JSON.stringify(...))` (`engine.ts:157-158`) up to 3x/turn, so object identity never survives a turn; no `React.memo`/`useMemo` anywhere. `turnHistory` grows unbounded (`App.tsx:129-130`), each entry a full `postTurnEntities` snapshot.
- **Layout drift** — `package.json`/`vite.config.ts`/`tsconfig.json` live in `src/`; `tsconfig` has no `strict`; CDN Tailwind + leftover importmap in `index.html`; `vitest` in `dependencies` with no `test` script.

## 3. Prioritized Initiatives

### P0 — Do first (unblocks everything / biggest felt impact)

**P0.1 — Persistence + autosave (survive a refresh).** *(M)*
WHY: The single most player-facing failure. A crash or accidental tab-close today erases hours of emergent story — the exact thing this game exists to create. Nothing else matters if the playthrough is disposable.
WHAT: Add `src/persistence/saveGame.ts`. Serialize `{entities, worldState, simulationState, reports, turnNumber, playerCharacterId, turnHistory, eventHistory, metaNarrative, messages}` to IndexedDB (via `idb-keyval`; `localStorage` will blow its ~5MB quota once `turnHistory` grows). Autosave at the end of `executeTurn` (`App.tsx:118-141`). Add a "Continue" path on the `GameState.SETUP` screen and a manual save-slot list. `turnHistory` is already an append-only log — this is close to a drop-in.

**P0.2 — Server-side key proxy.** *(M)*
WHY: Ships-the-key-to-every-visitor is a hard blocker for any hosted deploy — the owner cannot share a link without leaking their billing. Removes the biggest security liability in one move.
WHAT: One serverless function (Vercel/Cloudflare Worker) at `/api/gemini` that holds `GEMINI_API_KEY` server-side and forwards `generateContent`/`generateContentStream` calls. Replace the direct `new GoogleGenAI({apiKey})` (`App.tsx:47`) with a thin client that POSTs to the proxy. Delete the `define` block in `vite.config.ts:13-16`. Keep `isMockMode` working offline so local dev needs no key. Pairs naturally with P0.3's AI-service extraction.

**P0.3 — AI service layer: parallelize + retry + validate.** *(L)*
WHY: This is the highest-leverage change for *feel*. Cutting a turn from ~7 serial calls to ~3 sequential stages, plus streaming the narration, is the difference between "sluggish tech demo" and "responsive game." Retries kill the "Please refresh" death.
WHAT: Create `src/ai/service.ts` as the one entry point for all model calls. (a) **Parallelize** independent legs of `runNewTurn` (`turn.ts`): `getPlayerMonologue`, `simulatePrivateConversation`, and `getRelationshipUpdates` don't depend on each other — `Promise.all` them; the true chain is only `getStoryRelevance → main adjudication → applyAdjudication`. `Promise.all` the NPC batch loop in `initiator.ts:193-207`. (b) **Retry/backoff** wrapper (3 tries, exponential, handle 429/5xx) around every call. (c) **Consolidate** the 4 duplicated `cleanJson` regexes (`turn.ts:59`, `initiator.ts`, `intelligence.ts`, `characterCreator.ts`) into one `parseModelJson()` that strips fences AND validates with `zod` schemas mirroring `ai/core/schemas.ts` before the result is allowed to mutate state. Invalid → retry, not crash.

**P0.4 — Resilience: ErrorBoundary + graceful turn failure.** *(S)*
WHY: A single malformed AI-generated entity (an `add_entities` NPC missing `personality`) render-crashes to a blank white screen with no recovery. Combined with no persistence, that's a rage-quit.
WHAT: Wrap the tree in a React `ErrorBoundary` (fallback + "reload last save" once P0.1 lands). Change `executeTurn`'s catch (`App.tsx:143-148`) to surface the real error, roll back to pre-turn state (don't half-commit), and let the player retry the same intent instead of ending the session.

### P1 — High impact next

**P1.1 — State management extraction.** *(L)*
WHY: `App.tsx` is a 337-line god-component; every new feature (from the other roadmaps) has to thread another prop through `SidePanel` → 6 tabs. This is the tax on all future work.
WHAT: Move game state into `useReducer` behind a `GameContext` (`src/state/gameReducer.ts`). Actions: `COMMIT_TURN`, `APPLY_EVENT_CHOICE`, `SPEND_RESOURCE`, `LOAD_SAVE`. Tabs consume context instead of drilled props. Do this *after* P0.1-P0.4 so persistence/proxy land against today's simpler shape, not a moving target.

**P1.2 — Streaming narration.** *(M)*
WHY: Even parallelized, the player waits. Streaming the narration call (`turn.ts:123-127`) turns the longest leg into progressive text — the game feels alive during the wait.
WHAT: Use `generateContentStream` through the P0.2 proxy for the narration/suggested-actions call; append tokens to the GM message in `Chat.tsx` as they arrive. Requires the proxy to stream (SSE passthrough).

**P1.3 — Bound `turnHistory` memory.** *(S)*
WHY: `postTurnEntities` full snapshots per turn (`App.tsx:129-130`) grow O(turns × entities) forever; a long game degrades and bloats every save (P0.1).
WHAT: Window in-memory `turnHistory` to the last ~15 turns for live use; keep older entries as lighter records (drop `postTurnEntities`, keep `narration`/`headlines`/`adjudication`). GM Log reads the full log from the persistence layer on demand.

**P1.4 — Render-performance pass.** *(M)*
WHY: Currently pointless to memoize because `applyDeltas` re-clones everything each turn (`engine.ts:157-158`), breaking all object identity. Fix the churn, then memoize.
WHAT: In `applyDeltas`, clone only touched entities/regions (structural sharing) instead of whole-tree `JSON.parse(JSON.stringify)`. Then add `React.memo` at the tab boundary (`SidePanel` → tabs) and `useMemo` for derived lists (spotlight/faction groupings in `DramatisPersonaeTab`). Order matters: churn fix first.

### P2 — Polish / later

**P2.1 — Project layout normalization.** *(M)* Move `package.json`/`vite.config.ts`/`tsconfig.json` to repo root (or make `roman_crisis_simulation/` the clear root); merge the two READMEs. Coordinate with the Maintainability roadmap (ROADMAP_6) to avoid double-work.

**P2.2 — Build hygiene.** *(S)* Remove the leftover `<script type="importmap">` and CDN Tailwind from `index.html`; wire Tailwind through PostCSS/Vite for CSS purging and a smaller bundle.

**P2.3 — Enable `strict` TypeScript.** *(M)* Turn on `strict` in `tsconfig.json`; expect churn around `WorldState`'s `[key:string]:any` (`types.ts:142`) and optional entity fields. Do it after P1.1 so the reducer types absorb some of it.

**P2.4 — Sanitize chat rendering.** *(S)* `Chat.tsx` renders model text via `dangerouslySetInnerHTML` (lines 24/32/37) after only a `**bold**` regex. Low risk locally, but sanitize (or render markdown safely) before any hosted deploy — the model is never told not to emit HTML.

## 4. Quick Wins (< 1 hour each)
- Add a `"test": "vitest run"` script to `package.json` and move `vitest` from `dependencies` → `devDependencies`.
- Delete the two dead empty files `components/tabs/WorldStateTab.tsx` and `RelationshipsTab.tsx`.
- Add a `beforeunload` warning so an accidental tab-close prompts before nuking the session (stopgap until P0.1 ships).
- `Promise.all` the NPC batch loop in `initiator.ts:193-207` — isolated, immediate world-gen speedup even before the full P0.3.
- Remove the leftover importmap block from `index.html` (P2.2 half).
- Log the real error text in `executeTurn`'s catch (`App.tsx:145`) into the GM message so failures are diagnosable today.

## 5. Dependencies & Risks
- **P0.2 (proxy) ↔ P0.3 (service layer)**: both rewrite the call boundary — do them together to avoid touching every call site twice. P1.2 streaming depends on the proxy supporting SSE.
- **P0.1 (persistence) ↔ P1.1 (reducer)**: define the serialized save shape once. Ship persistence against today's state, then have the reducer's `LOAD_SAVE` consume that same shape — don't invent two formats.
- **Cross-domain (ROADMAP_2 AI Architecture)**: P0.3 changes `turn.ts` orchestration; if the AI roadmap is also restructuring the turn pipeline (e.g., new call stages), coordinate — the service layer should be the shared seam, not two competing rewrites. `zod` schemas in P0.3 must track any schema changes in `ai/core/schemas.ts`.
- **Cross-domain (ROADMAP_6 Maintainability)**: P2.1 (layout) and `strict` TS overlap with maintainability work — assign to one roadmap to avoid collisions.
- **Cross-domain (ROADMAP_3 UX)**: streaming (P1.2) and retry-state need UI affordances (progress, "retrying…", "resume save") — hand those to the UX roadmap.
- **Risk — parallelization correctness**: `simulatePrivateConversation` mutates `updatedEntities`/`adjudication.gm_private` (`turn.ts:76-91`) mid-pipeline. Parallelizing requires making each leg produce *deltas* that are applied in a defined order afterward, not mutating shared state concurrently. Get the data-flow right or races corrupt state.
- **What NOT to do yet**: no full backend/DB, no multiplayer, no auth, no cloud saves. IndexedDB + one stateless proxy function covers the real needs. Don't enable `strict` before the reducer exists (you'll fix the same types twice). Don't add memoization before fixing the deep-clone churn (P1.4) — it does nothing.
