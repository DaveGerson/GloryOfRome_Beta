# Phase 4 Roadmap — Richer Selves, Knowing Lies

**Governed by owner rulings D9–D18** (`DESIGN_DECISIONS.md`). Supersedes the
Phase 4 sketch in `ROADMAP_0_MASTER_PLAN.md`. Audit basis and the full
decision record: `PHASE_4_BRAINSTORM.md`. Two items carry no explicit owner
ruling and instead adopt the brainstorm's recommendations, marked *(adopted,
no ruling)* where they appear: the Chronicle's source of record (G9, item
4B.6) and the out-of-scope list (G14, final section). Baseline at adoption:
commit `4755035` + non-mechanical fixes, 208 tests green.

**Status: 4A COMPLETE** (commits `f3d5f8d`..`5a453ad`, suite at 305,
adversarially reviewed; cap values ratified). **4B substrate COMPLETE**:
the GM-private truth ledger (4B.1), the player knowledge store (4B.2), and
lies-in-play rumor planting/counterplay (part of 4B.5) are landed; the
remaining 4B player surfaces (dossier view, relationship map, rumor feed,
Chronicle rebuild) are blocked on the OPEN owner questions below. **4C
items 1–4 COMPLETE**: NPC-side perception, load-bearing memories, the
Director's persistent intents, and per-spotlight minds; 4C.5 voice and the
judge's richness axes are pending. **Second ruling round D19–D24 applied**
to 4B–4D below. Two 4B questions remain OPEN and block only the items that
cite them: how confidence is displayed to the player (numbers vs
in-fiction wording), and dossier refresh pricing (how much cheaper, paid in
what).

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
2. **Player knowledge store — information as a living entity (D21).**
   New persisted (optional) state where each unit is a CLAIM entity:
   `{id, claim, subject, firstLearnedTurn, updates: [{turn, source,
   restatement, confidence}]}` — time-dated at every step, accreting
   updates as the rumor mill re-reports (the player sees a claim's
   evolution, not just its first arrival). Interpretations (own sensed
   impressions, digest entries) and hearsay (reports, rumors, bought
   intel) both write into it. Per D14, an acquired snapshot stays frozen
   at its stamp while its claim keeps gaining sourced updates. **New
   invariant: player-facing intelligence surfaces read ONLY this store,
   never live entity ground truth.** *(OPEN: whether confidence renders
   as numbers or in-fiction wording.)*
3. **Persistent dossiers (D14).** Investigation results write knowledge
   entries instead of component-local state (retiring the
   evaporates-on-tab-switch `uncoveredIntel`). Dossier view per NPC:
   frozen snapshots stamped with turn + source; **refreshing a held
   dossier costs less than first acquisition**. `blackmail_on_*` folds in
   as an entry type (resource stays for engine compatibility). *(OPEN:
   refresh discount size and currency.)*
4. **Relationship map (D13).** Fill the 0-byte `RelationshipsTab`: edges
   are *interpretation* (own outbound feelings; sensed impressions of
   others' stances toward you) and *hearsay* (claims about third-party
   ties), each with provenance and age. No ground-truth values — the map
   can be wrong when a source lied, not merely stale.
5. **Rumor feed + planting (D11, D19, D20).** Chronological feed over the
   knowledge store's claim entities, showing updates as they arrive
   (D21). Planting a false rumor is BOTH an NPC scheme verb and a player
   action (D19); planted lies are counterplay targets — spotting,
   tracing, refuting. The investigation spend is the verification
   counter, and **verification itself rolls: a bad outcome can return a
   false confirmation (D20)** — narrated with full confidence, truth
   recorded only in the GM ledger.
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
4. **Minds (D10, D22).** One mind per spotlight character or per set of
   spotlight characters, with grouping kept open as the cost lever.
   Factions that act as a bloc (the Plebs, the Senate, gangs) may be
   modeled as collective NPCs with a single group mind (D22). Each mind
   sees only its own brief + memories + perceived digest, returns
   intent, private reasoning, and voice. The Adjudicator consumes minds'
   outputs and resolves conflicts; `applyDeltas` unchanged. Slower and
   better is accepted (D16); richness axes join the 4A judge so the gain
   is *observed*, not assumed.
5. **Voice.** `voice`/`epithet` fields (optional, worldgen + narration in
   lockstep) so minds and narration speak in character.

## 4D — Pacing & Payoff (D12, D15)

1. **Adjudicator-judged pacing (D23, supersedes D15's meter).** No
   code-side tension scalar. The adjudicator itself tracks pacing and
   makes an intentional choice to step in, and only when it judges it
   required — default posture is non-intervention, letting dramatic
   circumstance generate dynamics naturally, with *light directing* when
   it does act. Its pacing reasoning lands in `gm_private` so the GM
   console shows the judgment (D7); the player only feels it. A
   user-facing configuration setting tunes the pacing posture (placement
   decided at implementation; a full settings surface stays out of
   scope).
2. **Events repurposed (D12, D24).** The authored-event library becomes
   payoff *material*: sim-state-keyed, role-agnostic (Emperor gates
   dropped), repeatable with cooldowns. When the adjudicator judges a
   payoff due, it **prefers a historical/authored event whose time has
   plausibly come; otherwise it crafts a custom crisis** (D24). Verbatim
   scripted firing is the exception, not the model. Deterministic
   fire-once triggers retire.
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
