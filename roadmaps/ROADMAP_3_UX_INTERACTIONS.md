# Roadmap: User Experience & Interactions

## 1. Vision
Playing Glory of Rome should feel like commanding a room full of liars: you type an intent, the screen *breathes* while the court schemes off-screen, and the response arrives as a dramatic, streaming dispatch — narration, an inner monologue, shifting loyalties, a fresh rumor. Every scrap of information lives in a legible intelligence dashboard (dossiers, rumor feed, relationship map) that rewards paranoia. It should read as a polished political-intrigue game, never a dev console — and it should survive a browser refresh.

## 2. Current State (grounded)
Solid bones, dev-tool skin. `App.tsx` is a two-pane hand-rolled layout (chat 2/3, `SidePanel` 1/3) with two overlay modals and zero routing. The turn loop works and the result presentation is genuinely good: distinct GM bubble, dashed "Inner Thoughts" monologue, and 3 `ActionPills` (`Chat.tsx:5-42,104-118`). But:
- **The wait is invisible.** `executeTurn` (`App.tsx:90-149`) sets `PROCESSING`, which only disables the textarea and swaps its placeholder to "Awaiting Game Master…" (`Chat.tsx:75`). Meanwhile `runNewTurn` (`turn.ts:8-167`) fires **7 sequential awaited** Gemini calls (`getStoryRelevance` → adjudication → `getUpdatedSimulationState` → optional `simulatePrivateConversation` → `getPlayerMonologue` → narration → `getRelationshipUpdates`). Tens of seconds of frozen UI, no spinner, no signal it's even alive.
- **No persistence.** All state is `useState` in `App.tsx`; the error path literally says "Please refresh" (`App.tsx:146`), which nukes the entire game.
- **Dev scaffolding is shipped to players.** Permanent "Mock Mode" checkbox in `Header.tsx:12-23`; a smoke test that can `window.alert()` on every mount before character select (`App.tsx:49-65`); "GM LOG" reads as a debugger.
- **One generic error** covers API-key/JSON-parse/network (`App.tsx:146`, no try/catch around `JSON.parse` at `turn.ts:60`).
- Two dead tab files (`RelationshipsTab.tsx`, `WorldStateTab.tsx` — 0 bytes, unimported). No mobile layout, minimal a11y, `dangerouslySetInnerHTML` on LLM text (`Chat.tsx:24,32,37`).

## 3. Prioritized Initiatives

### P0 — Do first (unblocks the whole feel of the game)

**P0.1 — Staged "thinking" progress + streaming narration** · Effort: **M**
WHY: This is the single biggest perceived-quality lever. The 7 calls in `turn.ts` are already discrete awaited stages — surfacing them as live status turns dead air into suspense.
WHAT: Add an `onStage?: (stage: TurnStage) => void` callback param to `runNewTurn` and call it before each of the 7 stages with themed copy ("Whispers cross the Senate floor…", "Your rivals move in the dark…", "The chronicler sets down the day…"). In `App.tsx`, hold `turnStage` state and render a dedicated processing bubble in the chat stream (replace the invisible placeholder). Then make the **narration call stream**: swap `generateContent` at `turn.ts:123-127` for `generateContentStream` and push tokens into the GM bubble as they arrive (append-to-last-message in `App.tsx`). Streaming the ~2-3 paragraph narration is where the drama lives.

**P0.2 — Persistence + save/load** · Effort: **M**
WHY: "Refresh to recover" currently destroys progress (`App.tsx:146` vs. zero storage). No serious game loses state on reload. This also unblocks replay/story-so-far.
WHAT: Serialize the App state bundle (`entities`, `worldState`, `simulationState`, `reports`, `turnNumber`, `turnHistory`, `messages`, `playerCharacterId`, `eventHistory`, `metaNarrative`, `triggeredEventIds`) to `localStorage` on every commit in `executeTurn`/`handleEventChoice`, keyed by a save slot. Add a `useSaveGame` hook, a "Continue" button on `CharacterSelection.tsx`, and autosave-on-turn. Version the blob (`{version, savedAt, state}`) so schema drift is detectable.

**P0.3 — Typed, actionable errors with retry** · Effort: **S/M**
WHY: A first-run player with no `GEMINI_API_KEY` hits the generic wall on turn 1 with no clue why. Retry preserves the (now-persisted) game.
WHAT: Wrap `JSON.parse` at `turn.ts:60` in try/catch; throw typed errors (`ApiKeyError`, `MalformedResponseError`, `NetworkError`). In `executeTurn`'s catch (`App.tsx:143-148`), map to a chat bubble with a specific message and a **Retry** button that re-runs `executeTurn(playerActionText)` (do NOT lose the input — currently `handleSendMessage` clears it at `App.tsx:154`; stash `lastAction`). Never say "refresh" once P0.2 exists.

**P0.4 — De-dev the shell (env-gate Mock Mode, smoke test, GM Log framing)** · Effort: **S**
WHY: Mock Mode silently swapping in canned data (`Header.tsx:12-23`) and a blocking `alert()` on load (`App.tsx:59`) are trust-destroying for a real player.
WHAT: Gate `isMockMode` toggle and `runSmokeTest()` behind `import.meta.env.DEV`. In prod, smoke-test failure logs to console only (never `alert`). Rebrand "GM LOG" → "Chronicle / The Record" and drop the "debug console" tone (see P1.2). This is mostly deletion — highest ratio of polish-per-line.

### P1 — High impact next

**P1.1 — Parallelize independent turn calls** · Effort: **M**
WHY: Cuts real latency ~30-40%, compounding with P0.1's perceived-latency win.
WHAT: In `turn.ts`, `getPlayerMonologue` (`:98`) and the narration call (`:123`) both depend only on `updatedEntities`/`adjudication` — run them with `Promise.all`. `getStoryRelevance` (`:39`) has no dependency on the adjudication and can start concurrently with prompt compilation. Keep the true chain (adjudication → sim-state → deltas) sequential. Guard against streaming (P0.1) — stream narration while monologue resolves in parallel.

**P1.2 — Player-facing Chronicle / story timeline** · Effort: **M**
WHY: `turnHistory` (rich `TurnHistoryEntry` data) is buried in a dev screen. Players want to reread their saga.
WHAT: Build a real Chronicle view from `turnHistory` + `eventHistory`: per-turn card with the player's intent, the narration, and headline outcomes — styled as an illuminated manuscript, not JSON. Reuse `ChronicleTab.tsx` as the mount. Keep `GameMasterScreen.tsx`'s raw-JSON/deltas tabs but move them behind the dev gate (P0.4).

**P1.3 — Intelligence architecture: dossiers, rumor feed, relationship map** · Effort: **L**
WHY: This is the game's core loop (scheming) and the current UI under-serves it. `DramatisPersonaeTab` is good but flat; there's no rumor feed and no relationship graph.
WHAT: (a) Fill the dead `RelationshipsTab.tsx` with a node-link **relationship map** (player-centric web, edge color = trust, edge weight = dependency, using the 5 axes already in the entity schema). (b) Add a **Rumor Feed** — a chronological, deliberately-unreliable stream sourced from `adjudication.headlines` + the "Source Information" the narration prompt already generates (`turn.ts:118`), tagged by reliability. (c) Promote per-NPC **dossiers**: expand `DramatisPersonaeTab` reveals (beliefs/scheme/secrets already paywalled behind `investigations`) into a persistent, growing per-target file that accretes across turns rather than resetting (`turnInvestigations` clears each turn at `App.tsx:137`).

**P1.4 — Onboarding + first-turn guidance** · Effort: **S/M**
WHY: A new player isn't told how turns work, what `investigations`/`deep_analyses` do, or that a Chronicle exists.
WHAT: A dismissable 3-step intro overlay on first `AWAITING_PLAYER_INPUT` (how to act, what the panel tabs are, what resources buy). Seed 2-3 starter `suggestedActions` before turn 1 so the input isn't a blank page. Store "seen" flag in localStorage (P0.2).

### P2 — Polish / later

**P2.1 — Responsive/mobile layout** · Effort: **L**. Collapse the `w-2/3`/`w-1/3` split (`App.tsx:273,311`) into a stacked single column with a bottom tab-switcher (Chat ↔ Intel) under a `md:` breakpoint; make `GameMasterScreen`/`EventModal` full-screen on narrow viewports.

**P2.2 — Modal a11y + sanitization** · Effort: **S/M**. Add `role="dialog"`, `aria-modal`, focus-trap, Escape-to-close to `EventModal.tsx` and `GameMasterScreen.tsx`; `aria-live="polite"` on the message list; `role="tablist"`/`aria-selected` on tab buttons. Replace the raw `dangerouslySetInnerHTML` bold-regex in `Chat.tsx:24` with a tiny sanitizer (escape HTML, then apply `**bold**`).

**P2.3 — Bundle the CDN deps & stop shipping the API key** · Effort: **M**. (Cross-domain — see Risks.) Move Tailwind/React/genai out of `index.html` CDNs into the Vite bundle; the client-embedded `API_KEY` (`vite.config.ts` define block) is a security issue better solved by a backend proxy — flag to the infra/backend domain.

**P2.4 — EventModal drama** · Effort: **S**. Give scripted events a portentous entrance (dim + fade), stakes framing, and consequence preview — right now they're a plain choice list.

## 4. Quick Wins (< 1 hour each)
- Delete the two dead 0-byte files `RelationshipsTab.tsx` / `WorldStateTab.tsx` (or scaffold P1.3 into them). 
- Wrap `JSON.parse` at `turn.ts:60` in try/catch (down-payment on P0.3).
- Change the `App.tsx:146` error copy to stop saying "Please refresh."
- `import.meta.env.DEV` guard around the `alert()` at `App.tsx:59`.
- Add an animated spinner/pulse to the disabled SEND button + a "…" typing indicator bubble while `PROCESSING` (stopgap before full P0.1).
- Don't clear `inputValue` until the turn succeeds — stash `lastAction` for retry.
- Add `aria-live="polite"` to the `<main>` message list (`App.tsx:278`).

## 5. Dependencies & Risks
- **P0.1 (streaming) touches the AI-core domain**: swapping to `generateContentStream` and threading `onStage` callbacks changes `runNewTurn`'s signature — coordinate with whoever owns `turn.ts`/`intelligence.ts`. The narration call must stay the streamed one; don't stream the JSON-schema adjudication call.
- **P1.1 (parallelization) can race with P0.1**: if narration streams while `getRelationshipUpdates` mutates `adjudication.gm_private` (`turn.ts:139`), ensure UI reads a stable snapshot. Sequence the work: land P0.1 first, then parallelize.
- **P0.2 persistence + schema drift**: `TurnHistoryEntry`/`Entity` schemas are actively evolving (the `turn_logic.md` doc already lags reality at 3 vs. 7 calls). Version the save blob and fail gracefully on mismatch, or old saves crash.
- **P2.3 is really an infra/security item**, not pure UX — the embedded API key means any playable public deploy leaks the key. Bundling the CDNs is a prerequisite for a robust offline-capable first paint but is cross-domain work; don't block UX P0s on it.
- **What NOT to do yet**: full router/multi-screen navigation, backend accounts/cloud saves, mobile layout (P2.1), and the relationship-graph viz (P1.3b) are all premature until the turn loop *feels* alive (P0.1) and survives refresh (P0.2). Legibility and drama first; breadth later.
