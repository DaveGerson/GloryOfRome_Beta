# Glory of Rome (Realmweaver) — Prioritized TODO Plan (2026-11)

> **Status:** `[x] Shipped (1A–3A)` · `[~] Partial (3B, 3C — G1/G4 deferred)` — Engineering & storytelling roadmap prioritized by **Value × Effort × Subagent Resolvability**.
> **Base:** `main` (`5b79530`) · **Tracker:** [`BACKLOG.md`](./BACKLOG.md) · **Rulings:** [`DESIGN_DECISIONS.md`](./DESIGN_DECISIONS.md)

---

## Priority Matrix Overview

| ID | Item | Tier | Effort (Est. LOC) | Subagent Resolvability | Est. Parallel Wall-Clock | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1A** | Voice Cast Manner → Private-Scene Speech & Prompts | Tier 1: Quick Win | Small (~60 LOC) | 100% | ~12–15m | `[x] Done` |
| **1B** | D12 Modal-Weave Cooldown Gate | Tier 1: Quick Win | Small (~45 LOC) | 100% | ~12–15m | `[x] Done` |
| **1C** | Overturned-Death Headline Guard (D2) | Tier 1: Quick Win | Small (~50 LOC) | 100% | ~12–15m | `[x] Done` |
| **1D** | Wire Cross-Tab Save Conflict Banner (P1) | Tier 1: Quick Win | Small (~55 LOC) | 100% | ~12–15m | `[x] Done` |
| **1E** | Incremental Streaming Boundary Gate (A5) | Tier 1: Quick Win | Small (~65 LOC) | 100% | ~12–15m | `[x] Done` |
| **2A** | Shareable End-of-Reign Illustrated Scroll (P7) | Tier 2: High-Impact | Medium (~180 LOC) | 100% | ~18–20m | `[x] Done` |
| **2B** | Economy with Seasonal Momentum & ±1 Clamp (G2) | Tier 2: High-Impact | Medium (~110 LOC) | 95% | ~15–20m | `[x] Done` |
| **2C** | Turn Cancellation & `AbortSignal` Plumbing (A1) | Tier 2: High-Impact | Medium (~140 LOC) | 95% | ~18–22m | `[x] Done` |
| **3A** | Intel Currency Converter & Graded Dossier Pricing (B1 + D27) | Tier 3: Deeper System | Medium-Large (~220 LOC) | Resolved & shipped | ~30–40m | `[x] Done` |
| **3B** | Clue-Driven Scheme Deduction Board (B3 / G1) | Tier 3: Deeper System | Large (~300 LOC) | Board shipped; G1 deferred | ~40–50m | `[~] Partial` |
| **3C** | Faction Collective Minds (B6 / G3) & Turned Spy Contacts (G4) | Tier 3: Deeper System | Large (~350 LOC) | Per-viewer climates shipped; G4 deferred | ~45–60m | `[~] Partial` |

---

## Tier 1: Immediate Quick Wins

- [x] **TODO (1A): Voice Cast Manner → Private-Scene Speech & Prompts** *(Done)*
  - **Effort:** Small (~60 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/prompts/privateScene.ts`
    - `roman_crisis_simulation/src/hooks/usePrivateSceneController.ts`
    - `roman_crisis_simulation/src/narration/sceneVoice.ts`
  - **Scope:** Thread `VoiceCast.style` (`castManner`) into `buildPrivateScenePrompt` via `hooks/usePrivateSceneController.ts` so NPC scene lines reflect cast delivery style without duplicating cast manner as spoken TTS `<cue>` fallback in `sceneVoice.ts`.

- [x] **TODO (1B): D12 Modal-Weave Cooldown Gate** *(Done)*
  - **Effort:** Small (~45 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/schemas.ts`
    - `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
    - `roman_crisis_simulation/src/ai/prompts/adjudication.ts`
    - `roman_crisis_simulation/src/ai/prompts/narration.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
    - `roman_crisis_simulation/src/events/engine.ts`
    - `roman_crisis_simulation/src/hooks/useEventFlow.ts`
  - **Scope:** Add optional `woven_event_ids?: string[]` to `AdjudicationSchema` (stripped from narration context and recorded via `recordWovenEvents`) so woven D24 events respect `cooldownTurns` and don't double-fire as modal popups on the same turn.

- [x] **TODO (1C): Overturned-Death Headline Guard (D2)** *(Done)*
  - **Effort:** Small (~50 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/mortality.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
  - **Scope:** Post-mortality headline screen/rewrite when Two-Gate Mortality overturns a claimed death into survival, using Unicode word boundaries and Roman nomen/title disambiguation.

- [x] **TODO (1D): Wire Cross-Tab Save Conflict Banner (P1)** *(Done)*
  - **Effort:** Small (~55 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/persistence/crossTab.ts`
    - `roman_crisis_simulation/src/hooks/useCampaignTransactions.ts`
    - `roman_crisis_simulation/src/hooks/useShellEffects.ts`
    - `roman_crisis_simulation/src/components/ui/FailureNotices.tsx`
    - `roman_crisis_simulation/src/App.tsx`
  - **Scope:** Wire `crossTab.ts` conflict detection, pause autosaves on conflict (`autosavePausedRef`), and surface a notice offering `"Reload that tab's reign"` / `"Reload cleared device"` vs `"Keep this tab's reign"`.

- [x] **TODO (1E): Incremental Streaming Boundary Gate (A5)** *(Done)*
  - **Effort:** Small (~65 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/playerBoundary.ts`
    - `roman_crisis_simulation/src/ai/core/streamSplit.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
    - `roman_crisis_simulation/src/tests/playerBoundary.test.ts`
    - `roman_crisis_simulation/src/tests/streamSplit.test.ts`
  - **Scope:** Add `O(1)`-per-chunk `pushChunk(delta)` fast path alongside exact `startsWith` cumulative verification in both stream boundary gates.

---

## Tier 2: High-Impact Contained Features

- [x] **TODO (2A): Shareable End-of-Reign Illustrated Scroll (P7)** *(Done)*
  - **Effort:** Medium (~180 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~18–20m
  - **Target Seams:**
    - `roman_crisis_simulation/src/components/EpilogueScreen.tsx`
    - `roman_crisis_simulation/src/components/tabs/ChronicleTab.tsx`
    - `roman_crisis_simulation/src/persistence/chronicleExport.ts` *(new)*
    - `roman_crisis_simulation/src/App.tsx`
  - **Scope:** Export a standalone, CSP-hardened styled HTML Roman Chronicle of the player's reign, marks, ties, fates, and epilogue.

- [x] **TODO (2B): Economy with Seasonal Momentum & ±1 Clamp (G2)** *(Done)*
  - **Effort:** Medium (~110 LOC) · **Subagent Resolvability:** 95% · **Est. Time:** ~15–20m
  - **Target Seams:**
    - `roman_crisis_simulation/src/events/stabilityVocabulary.ts`
    - `roman_crisis_simulation/src/ai/core/engine.ts`
  - **Scope:** Clamp adjudicator `economic_stability` jumps to ±1 grade/turn, apply deterministic seasonal drift when flat, and sync effective grades onto committed deltas and perceptions.

- [x] **TODO (2C): Turn Cancellation & `AbortSignal` Plumbing (A1)** *(Done)*
  - **Effort:** Medium (~140 LOC) · **Subagent Resolvability:** 95% · **Est. Time:** ~18–22m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/geminiService.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
    - `roman_crisis_simulation/src/hooks/useExecuteTurn.ts`
    - `roman_crisis_simulation/src/hooks/useTurnFlow.ts`
    - `roman_crisis_simulation/src/components/TurnComposer.tsx`
  - **Scope:** Thread `AbortSignal` through turns, streams, and parallel stages with a `"Stay the courier's hand"` cancel button preserving the player's draft.

---

## Tier 3: Deeper Gameplay Systems (Needs Design Choices)

- [x] **TODO (3A): Intel Currency Converter & Graded Dossier Pricing (B1 + D27)** *(Done)*
  - **Effort:** Medium-Large (~220 LOC) · **Subagent Resolvability:** Resolved & shipped · **Est. Time:** ~30–40m
  - **Target Seams:**
    - `roman_crisis_simulation/src/knowledge/pricing.ts` *(new; alongside `knowledge/dossierCost.ts`)*
    - `roman_crisis_simulation/src/hooks/useIntelCommits.ts`
    - `roman_crisis_simulation/src/components/tabs/dramatisPersonaeIntel.ts`
    - `roman_crisis_simulation/src/components/tabs/useIntelGathering.ts`
    - `roman_crisis_simulation/src/components/tabs/dramatisPersonaeUi.tsx`
    - `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
    - `roman_crisis_simulation/src/components/SidePanel.tsx`
    - `roman_crisis_simulation/src/state/gameReducer.ts`
    - `roman_crisis_simulation/src/App.tsx`
  - **Implemented Decisions:** `CONVERSION_RATES` (`denarii: 2500`, `senatorial_support: 10`, `legion_support: 10`) with `1.25×` T1 friction (`CONVERSION_FRICTION_FACTOR`) via the `"Fund Agents"` drawer in Personae, D6 low-treasury warnings via `SYSTEMIC_RESOURCES.denarii`, and active D27 graded coin fallback + warm refresh pricing (`20%` floor at same-turn refresh rising linearly to full price at 6-turn cold threshold).

- [~] **TODO (3B): Clue-Driven Scheme Deduction Board (B3 / G1)** *(Partial — Board Shipped; G1 Accusation Mini-Game Deferred)*
  - **Effort:** Large (~300 LOC) · **Subagent Resolvability:** Board shipped; G1 deferred · **Est. Time:** ~40–50m
  - **Target Seams:**
    - `roman_crisis_simulation/src/knowledge/schemeDeduction.ts` *(new; reads `knowledge/store.ts` & `knowledge/credibilityFraming.ts`)*
    - `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
    - `roman_crisis_simulation/src/tests/schemeDeduction.test.ts` *(new)*
  - **Shipped vs. Deferred:** Read-only `deriveSchemeBoard` / `evaluateDeductionHypothesis` over player knowledge claims and the `"Conspiracy & Leads"` board + interactive `"Cross-check associate"` selector in Personae are shipped. **Deferred (G1):** formal public accusation mini-game (accusation cost, Curia/tribunal resolution, and false-accusation fallout) awaits a full design spec.

- [~] **TODO (3C): Faction Collective Minds (B6 / G3) & Turned Spy Contacts (G4)** *(Partial — Per-Viewer Climates Shipped; G4 & Full Spotlight Faction Minds Deferred)*
  - **Effort:** Large (~350 LOC) · **Subagent Resolvability:** Per-viewer climates shipped; G4 deferred · **Est. Time:** ~45–60m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/factionMood.ts` *(new)*
    - `roman_crisis_simulation/src/ai/core/turn.ts`
    - `roman_crisis_simulation/src/ai/prompts/npcMind.ts`
    - `roman_crisis_simulation/src/ai/tools/npcMind.ts`
    - `roman_crisis_simulation/src/tests/factionMood.test.ts` *(new)*
    - `roman_crisis_simulation/src/tests/npcMinds.test.ts`
  - **Shipped vs. Deferred:** Per-viewer D10/D41-isolated Collective Faction Climates (`deriveFactionMoodsForViewer` + `buildFactionMoodBlock`) summarizing own bloc cohesion/agendas and public-only views of known blocs are shipped. **Deferred (G4 / B6):** turned spy contacts & disinformation mechanics (needs safe epistemic/disinformation spec) and autonomous spotlight faction-mind decision calls.

---

## Parallel Execution Topology

A 4-subagent wave layout keeps file seams disjoint so workers can run in isolated worktrees/shares without merge conflicts:

- **Tier 1 Wave (~15–18m wall-clock):**
  - **Worker 1:** `1A` (`privateScene.ts`, `sceneVoice.ts`, `usePrivateSceneVoice.ts`)
  - **Worker 2:** `1B` (`schemas.ts`, `zodSchemas.ts`, `adjudication.ts`, `events/engine.ts`)
  - **Worker 3:** `1C` + `1E` (`mortality.ts`, `turn.ts`, `playerBoundary.ts`, `playerBoundary.test.ts`)
  - **Worker 4:** `1D` (`crossTab.ts`, `FailureNotices.tsx`, `useShellEffects.ts`)
- **Tier 1 + Tier 2 Combined (~22–28m wall-clock including `npm run verify` + merge):**
  - Follow the Tier 1 wave with `2A`, `2B`, and `2C` across 3 parallel workers (disjoint seams: `EpilogueScreen.tsx`/`ChronicleTab.tsx`/`reignScrollExport.ts`, `stabilityVocabulary.ts`/`ai/core/engine.ts`, and `geminiService.ts`/`useExecuteTurn.ts`/`TurnComposer.tsx`), then run `npm run verify` and merge.
- **Tier 3:** Resolve open design choices (`3A`, `3B`, `3C`) via `/grill-me` or spec before dispatching implementation waves.
