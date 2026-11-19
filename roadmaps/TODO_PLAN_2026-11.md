# Glory of Rome (Realmweaver) — Prioritized TODO Plan (2026-11)

> **Status:** `[ ] TODO` — Proposed engineering & storytelling roadmap prioritized by **Value × Effort × Subagent Resolvability**.
> **Base:** `main` (`5b79530`) · **Tracker:** [`BACKLOG.md`](./BACKLOG.md) · **Rulings:** [`DESIGN_DECISIONS.md`](./DESIGN_DECISIONS.md)

---

## Priority Matrix Overview

| ID | Item | Tier | Effort (Est. LOC) | Subagent Resolvability | Est. Parallel Wall-Clock | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1A** | Voice Cast Manner → Private-Scene Speech & Prompts | Tier 1: Quick Win | Small (~60 LOC) | 100% | ~12–15m | `[ ] TODO` |
| **1B** | D12 Modal-Weave Cooldown Gate | Tier 1: Quick Win | Small (~45 LOC) | 100% | ~12–15m | `[ ] TODO` |
| **1C** | Overturned-Death Headline Guard (D2) | Tier 1: Quick Win | Small (~50 LOC) | 100% | ~12–15m | `[ ] TODO` |
| **1D** | Wire Cross-Tab Save Conflict Banner (P1) | Tier 1: Quick Win | Small (~55 LOC) | 100% | ~12–15m | `[ ] TODO` |
| **1E** | Incremental Streaming Boundary Gate (A5) | Tier 1: Quick Win | Small (~65 LOC) | 100% | ~12–15m | `[ ] TODO` |
| **2A** | Shareable End-of-Reign Illustrated Scroll (P7) | Tier 2: High-Impact | Medium (~180 LOC) | 100% | ~18–20m | `[ ] TODO` |
| **2B** | Economy with Seasonal Momentum & ±1 Clamp (G2) | Tier 2: High-Impact | Medium (~110 LOC) | 95% | ~15–20m | `[ ] TODO` |
| **2C** | Turn Cancellation & `AbortSignal` Plumbing (A1) | Tier 2: High-Impact | Medium (~140 LOC) | 95% | ~18–22m | `[ ] TODO` |
| **3A** | Intel Currency Converter & Graded Dossier Pricing (B1 + D27) | Tier 3: Deeper System | Medium-Large (~220 LOC) | Needs design choices | ~30–40m | `[ ] TODO` |
| **3B** | Clue-Driven Scheme Deduction Board (B3 / G1) | Tier 3: Deeper System | Large (~300 LOC) | Needs design choices | ~40–50m | `[ ] TODO` |
| **3C** | Faction Collective Minds (B6 / G3) & Turned Spy Contacts (G4) | Tier 3: Deeper System | Large (~350 LOC) | Needs design spec | ~45–60m | `[ ] TODO` |

---

## Tier 1: Immediate Quick Wins

- [ ] **TODO (1A): Voice Cast Manner → Private-Scene Speech & Prompts**
  - **Effort:** Small (~60 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/prompts/privateScene.ts`
    - `roman_crisis_simulation/src/narration/sceneVoice.ts`
    - `roman_crisis_simulation/src/hooks/usePrivateSceneVoice.ts`
  - **Scope:** Thread `VoiceCast.style` into `buildPrivateScenePrompt` and use it as a fallback `<cue>` anchor in `sceneLineForSpeech` when `line.delivery` is absent.

- [ ] **TODO (1B): D12 Modal-Weave Cooldown Gate**
  - **Effort:** Small (~45 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/schemas.ts`
    - `roman_crisis_simulation/src/ai/core/zodSchemas.ts`
    - `roman_crisis_simulation/src/ai/prompts/adjudication.ts`
    - `roman_crisis_simulation/src/events/engine.ts`
  - **Scope:** Add optional `woven_event_ids?: string[]` to `AdjudicationSchema` so woven D24 events don't double-fire as modal popups on the same turn.

- [ ] **TODO (1C): Overturned-Death Headline Guard (D2)**
  - **Effort:** Small (~50 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/mortality.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
  - **Scope:** Post-mortality headline screen/rewrite when Two-Gate Mortality overturns a claimed death into survival.

- [ ] **TODO (1D): Wire Cross-Tab Save Conflict Banner (P1)**
  - **Effort:** Small (~55 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/persistence/crossTab.ts`
    - `roman_crisis_simulation/src/components/ui/FailureNotices.tsx`
    - `roman_crisis_simulation/src/hooks/useShellEffects.ts`
  - **Scope:** Wire existing `crossTab.ts` detection to a notice offering `"Reload that tab's reign"` vs `"Keep this tab's reign"`.

- [ ] **TODO (1E): Incremental Streaming Boundary Gate (A5)**
  - **Effort:** Small (~65 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~12–15m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/playerBoundary.ts`
    - `roman_crisis_simulation/src/tests/playerBoundary.test.ts`
  - **Scope:** Make `createNarrationStreamGate` incremental per completed sentence (`O(1)` per chunk), matching `createPayloadTextExtractor`.

---

## Tier 2: High-Impact Contained Features

- [ ] **TODO (2A): Shareable End-of-Reign Illustrated Scroll (P7)**
  - **Effort:** Medium (~180 LOC) · **Subagent Resolvability:** 100% · **Est. Time:** ~18–20m
  - **Target Seams:**
    - `roman_crisis_simulation/src/components/EpilogueScreen.tsx`
    - `roman_crisis_simulation/src/components/tabs/ChronicleTab.tsx`
    - `roman_crisis_simulation/src/persistence/reignScrollExport.ts` *(new)*
  - **Scope:** Export standalone styled HTML Roman Chronicle of the player's reign, marks, ties, fates, and epilogue.

- [ ] **TODO (2B): Economy with Seasonal Momentum & ±1 Clamp (G2)**
  - **Effort:** Medium (~110 LOC) · **Subagent Resolvability:** 95% · **Est. Time:** ~15–20m
  - **Target Seams:**
    - `roman_crisis_simulation/src/events/stabilityVocabulary.ts`
    - `roman_crisis_simulation/src/ai/core/engine.ts`
  - **Scope:** Clamp adjudicator `economic_stability` jumps to ±1 grade/turn and apply deterministic seasonal drift.

- [ ] **TODO (2C): Turn Cancellation & `AbortSignal` Plumbing (A1)**
  - **Effort:** Medium (~140 LOC) · **Subagent Resolvability:** 95% · **Est. Time:** ~18–22m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/core/geminiService.ts`
    - `roman_crisis_simulation/src/hooks/useExecuteTurn.ts`
    - `roman_crisis_simulation/src/components/TurnComposer.tsx`
  - **Scope:** Thread `AbortSignal` through turns with a `"Stay the courier's hand"` cancel button.

---

## Tier 3: Deeper Gameplay Systems (Needs Design Choices)

- [ ] **TODO (3A): Intel Currency Converter & Graded Dossier Pricing (B1 + D27)**
  - **Effort:** Medium-Large (~220 LOC) · **Subagent Resolvability:** Needs exchange rate & per-season cap choices · **Est. Time:** ~30–40m
  - **Target Seams:**
    - `roman_crisis_simulation/src/knowledge/pricing.ts` *(new; alongside existing `knowledge/dossierCost.ts`)*
    - `roman_crisis_simulation/src/ai/core/resources.ts`
    - `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
  - **Open Decisions:** Per-resource exchange rates, conversion friction/loss (T1 guardrail), and per-season cap.

- [ ] **TODO (3B): Clue-Driven Scheme Deduction Board (B3 / G1)**
  - **Effort:** Large (~300 LOC) · **Subagent Resolvability:** Needs accusation cost & UI home choice · **Est. Time:** ~40–50m
  - **Target Seams:**
    - `roman_crisis_simulation/src/knowledge/store.ts`
    - `roman_crisis_simulation/src/components/tabs/DramatisPersonaeTab.tsx`
    - `roman_crisis_simulation/src/state/gameReducer.ts`
  - **Open Decisions:** Accusation cost/consequence and where the deduction board lives in the UI.

- [ ] **TODO (3C): Faction Collective Minds (B6 / G3) & Turned Spy Contacts (G4)**
  - **Effort:** Large (~350 LOC) · **Subagent Resolvability:** Needs design spec · **Est. Time:** ~45–60m
  - **Target Seams:**
    - `roman_crisis_simulation/src/ai/tools/npcMind.ts`
    - `roman_crisis_simulation/src/perception/visibility.ts`
    - `roman_crisis_simulation/src/ai/core/turn.ts`
  - **Open Decisions:** Full design spec for faction-level mind aggregation and turned-spy contact mechanics.

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
