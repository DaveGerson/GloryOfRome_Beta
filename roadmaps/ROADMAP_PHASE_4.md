# Phase 4 Roadmap — Richer Selves, Knowing Lies

**Governed by owner rulings D9–D18** (`DESIGN_DECISIONS.md`). Supersedes the
Phase 4 sketch in `ROADMAP_0_MASTER_PLAN.md`. Audit basis and the full
decision record: `PHASE_4_BRAINSTORM.md`. Two items carry no explicit owner
ruling and instead adopt the brainstorm's recommendations, marked *(adopted,
no ruling)* where they appear: the Chronicle's source of record (G9, item
4B.6) and the out-of-scope list (G14, final section). Baseline at adoption:
commit `4755035` + non-mechanical fixes, 208 tests green.

Shape: **substrate first (D9)** — plumbing that makes mechanics observable
and iterable live, then the systems that need it. Four sub-phases; each
ships independently, CI-green, save-compatible (new persisted fields
optional per invariant 6).

---

## 4A — Plumbing & Housekeeping (D9, D17, D18)

*No visible gameplay change. This is the layer that lets every later
mechanic be watched, replayed, and tuned instead of guessed at.*

1. **State extraction first (D17).** `App.tsx` (971 lines, ~30 `useState`
   slices) → `useReducer` + `GameContext`. Mechanical, zero behavior
   change, existing 208 tests are the safety net. All new Phase 4 state
   (knowledge store, tension, truth ledger) lands in the reducer world
   only.
2. **Full call capture.** `RawCallRecord` gains `systemInstruction` and
   `prompt` text (today: `promptChars` count only — `geminiService.ts`).
   Bring the out-of-band calls (investigation, clarification, deep
   analysis, ambition, epilogue) inside the capture bracket.
3. **Reproducible rolls.** Per-turn seed generated in `turn.ts`, threaded
   through `resolution.ts`'s `rollD20`, persisted on `TurnHistoryEntry`
   (optional field). Closes the standing TODO at `resolution.ts:44-49`.
4. **Eval/tuning export (D18).** GM-console button: download the session's
   captured turns (prompts, responses, seeds, traces) as JSON files.
   Capture stays session-side — saves stay lean; `stripOldRawCalls`
   pressure drops instead of growing.
5. **Save bounding.** Cap `entity.memories` and
   `relationship.recent_interactions`; bound `postTurnEntities` (keep
   recent N full snapshots). Hygiene, not mechanics — memories become
   load-bearing in 4C.
6. **Eval harness MVP.** Offline script replaying exported turns; LLM
   judge (flash) scoring consequence-density, sim-state consistency,
   schema validity, and **information-asymmetry discipline** (did any
   surface leak what its viewer couldn't know). ~10 golden turns from
   real owner-played sessions (D18). Hand-run before prompt merges — not
   CI-gated; the judge itself is unvalidated.

## 4B — Truth & the Knowledge Layer (D11, D13, D14)

*The system learns what a lie is; the player gets a memory.*

1. **GM-private truth ledger (D11).** Every sourced claim (rumor delta,
   report, planted whisper) carries a truth disposition the engine
   tracks: **true or false, always** — the GM defines the simulation's
   reality, so it can and must rule on every claim at emission; per D11
   there is no tracked class of claims the engine cannot classify. Plus
   who originated it. Adjudication prompt updated in lockstep
   (invariant 2) so rumors are emitted *with* their truth flag. Truth flags are GM-private data,
   same class as `secret_truth` — grep-clean of player surfaces, rendered
   only in the GM console's true-vs-believed view (D7).
2. **Player knowledge store.** New persisted (optional) state: accreted
   entries `{claim, subject, source, turnLearned, confidence}` covering
   interpretations (own sensed impressions, digest entries) and hearsay
   (reports, rumors, bought intel). Written by the perception digest,
   investigations, and event outcomes. **New invariant: player-facing
   intelligence surfaces read ONLY this store, never live entity ground
   truth.**
3. **Persistent dossiers (D14).** Investigation results write knowledge
   entries instead of component-local state (retiring the
   evaporates-on-tab-switch `uncoveredIntel`). Dossier view per NPC:
   frozen snapshots stamped with turn + source; **refreshing a held
   dossier costs less than first acquisition**. `blackmail_on_*` folds in
   as an entry type (resource stays for engine compatibility).
4. **Relationship map (D13).** Fill the 0-byte `RelationshipsTab`: edges
   are *interpretation* (own outbound feelings; sensed impressions of
   others' stances toward you) and *hearsay* (claims about third-party
   ties), each with provenance and age. No ground-truth values — the map
   can be wrong when a source lied, not merely stale.
5. **Rumor feed + planting (D11).** Chronological feed over the knowledge
   store's sourced claims. Planting a false rumor becomes an NPC scheme
   verb (and a player action the adjudicator can resolve); the existing
   investigation spend is the verification counter.
6. **Chronicle rebuild** *(adopted, no ruling — G9)*. Persist the per-turn
   perceived digest (currently computed and discarded) and render the
   reign from it — intent → narration → what you perceived.
   Scripted-event choices fold in.

## 4C — Richer Selves (D10, D16)

*Not smarter NPCs — truer ones. Bounded knowledge, real interiority,
continuity of intent.*

1. **NPC-side perception.** Generalize `perception/visibility.ts` to any
   viewer (it's already pure; every entity has `visibility_network` +
   location). Each turn, compute per-NPC perceived digests code-side —
   what this character actually witnessed or heard.
2. **Memories become load-bearing.** Replace headline-name-matching
   memory stamps with each NPC's own perceived events; an NPC's mind is
   briefed from its own memory, not the global record.
3. **Director.** `storyRelevance` grows into a Director: picks the
   spotlight cast *and* carries forward persistent intents —
   `entityActions` becomes real state feeding the next turn instead of
   write-only schema baggage.
4. **Minds (D10).** Per-NPC — or per-*set* (faction, household, spotlight
   cast) as the cost lever — mind calls for the spotlight: each sees only
   its own brief + memories + perceived digest, returns intent, private
   reasoning, and voice. The Adjudicator consumes minds' outputs and
   resolves conflicts; `applyDeltas` unchanged. Slower and better is
   accepted (D16); richness axes join the 4A judge so the gain is
   *observed*, not assumed.
5. **Voice.** `voice`/`epithet` fields (optional, worldgen + narration in
   lockstep) so minds and narration speak in character.

## 4D — Pacing & Payoff (D12, D15)

1. **Soft tension meter (D15).** Code-tracked scalar from observable
   signals (delta volume, outcome tiers, deaths, scheme age); fed into
   adjudication as *light pacing direction* — guidance the model weighs,
   never a hard detonation threshold. GM console displays it (D7); the
   player only feels it (ambient copy, quiet-week texture).
2. **Events repurposed (D12).** The authored-event library becomes payoff
   *material*: sim-state-keyed, role-agnostic (Emperor gates dropped),
   repeatable with cooldowns — but mostly consumed as seeds/templates the
   adjudicator riffs on when tension calls for a payoff. Verbatim scripted
   firing is the exception, not the model. Deterministic fire-once
   triggers retire.
3. **Moment lines.** On scheme completion/detonation, a signature
   in-character line from the mind's voice — the screenshotable payoff.

---

## New invariants (join the standing eight)

9. Player-facing intelligence surfaces (dossiers, map, rumor feed,
   Chronicle) read only the knowledge store — never live entity ground
   truth.
10. Truth flags on sourced claims are GM-private, same handling class as
    `secret_truth`: they appear only in `GameMasterScreen` and `ai/`.
11. Rolls remain reproducible: any new randomness routes through the
    seeded generator.

## Explicitly out of scope *(adopted, no ruling — G14, one amendment)*

Interactive SVG map, settings surface, multi-slot saves, mobile layout,
portraits/audio, API-key proxy + output sanitization (Phase 5 gates),
full strict-TS sweep, IndexedDB migration, NPC-to-NPC autonomous
multi-call conversations **beyond the mind/Adjudicator contract** (the
bolded carve-out amends the brainstorm's blanket exclusion — 4C's minds
require it), and any quest-log-shaped UI (D8 stands).
