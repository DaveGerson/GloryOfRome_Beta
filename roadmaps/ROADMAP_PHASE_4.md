# Phase 4 Roadmap — Richer Selves, Knowing Lies

**Governed by owner rulings D9–D30** (`DESIGN_DECISIONS.md`). Supersedes the
Phase 4 sketch in `ROADMAP_0_MASTER_PLAN.md`. Audit basis and the full
decision record: `PHASE_4_BRAINSTORM.md`. Two items carry no explicit owner
ruling and instead adopt the brainstorm's recommendations, marked *(adopted,
no ruling)* where they appear: the Chronicle's source of record (G9, item
4B.6) and the out-of-scope list (G14, final section). Baseline at adoption:
commit `4755035` + non-mechanical fixes, 208 tests green.

**Status: 4A COMPLETE** (commits `f3d5f8d`..`5a453ad`, suite at 305,
adversarially reviewed; cap values ratified). **4B substrate COMPLETE**:
the GM-private truth ledger (4B.1); the player knowledge store (4B.2) — now
an information GRAPH (D29): claims keyed subject+topic with deterministic
`about`/`corroborates`/`contradicts`/`derives-from` edges, the fix for the
flat-list over-merge; sourced-credibility framing with NO player-facing
number (D25/D26), verification returning a sourced (never
system-authoritative-false) result; persistent dossiers whose refresh is
staleness-decayed in the same resource (4B.3, D14/D27); a scheme perceived
only as "something afoot" whose nature is earned through accreting clues
(D28); and lies-in-play rumor planting/counterplay (part of 4B.5). **4C
items 1–4 COMPLETE**: NPC-side perception, load-bearing memories, the
Director's persistent intents, and per-spotlight minds — a mind now drives
the evolution of its own `active_scheme` as that entity's intent, not a
discardable hint (D30); 4C.5 voice and the judge's richness axes are
pending. **Ruling rounds D19–D24 and D25–D30 applied** to 4B–4D below. **The
two previously-OPEN 4B questions are now RULED and landed**: confidence
display → conveyed by source, never a number (D25/D26); dossier refresh
pricing → decays with staleness, paid in the same resource the first
investigation used (D27). What remains are the dedicated player-facing
VISUAL surfaces built ON this substrate and the deferred discovery
mini-game — see **Follow-on** below — not open design questions.

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
   never live entity ground truth.** *(RULED + LANDED: the store is now an
   information GRAPH (D29) — claims keyed subject+topic with deterministic
   structural edges — not a flat keyed list, closing the over-merge.
   Confidence is conveyed by SOURCE, never a number (D25/D26): the backend
   keeps ground-truth credibility, the player judges trust from who
   reported it and how they frame their own certainty. `ReportsTab` and the
   investigation surface show source framing only, no percentage.)*
3. **Persistent dossiers (D14, D27).** Investigation results write
   knowledge entries instead of component-local state (retiring the
   evaporates-on-tab-switch `uncoveredIntel`). Frozen snapshots stamped
   with turn + source; **refreshing a held dossier costs less than first
   acquisition, scaled by staleness**. `blackmail_on_*` folds in as an
   entry type (resource stays for engine compatibility). *(RULED + LANDED:
   refresh pricing decays with staleness (D27), paid in the SAME resource
   the first investigation used. A pure, unit-tested read model
   (`knowledge/store.ts::deriveDossier` — "what do I hold on entity X, as
   of when") and a pure decay-curve helper
   (`knowledge/dossierCost.ts::computeRefreshCost`, floor 0.2× → full over
   a 6-turn cold threshold, rationale in-code for owner veto) are wired
   into the investigation-cost path in `DramatisPersonaeTab`: first
   acquisition is full price, a warm refresh is a cheap/free top-up, a cold
   one pays full again. The rich per-NPC dossier VIEW is a follow-on — the
   accessor + cost mechanic landed here, not the visual.)*
4. **Relationship map (D13).** Fill the 0-byte `RelationshipsTab`: edges
   are *interpretation* (own outbound feelings; sensed impressions of
   others' stances toward you) and *hearsay* (claims about third-party
   ties), each with provenance and age. No ground-truth values — the map
   can be wrong when a source lied, not merely stale.
5. **Rumor feed + planting (D11, D19, D20 → D26).** Chronological feed over
   the knowledge store's claim entities, showing updates as they arrive
   (D21). Planting a false rumor is BOTH an NPC scheme verb and a player
   action (D19); planted lies are counterplay targets — spotting,
   tracing, refuting. The investigation spend is the verification counter.
   **D26 REVISES D20**: verification never returns a
   system-authoritative false "confirmed" — the system is an honest
   window. It returns a SOURCED result (your spy's confidence, your
   informant's oath); the SOURCE may be wrong, never the system's own
   voice, and the player chooses whether to trust it. The deception is
   real but always wears a face the player can distrust; ground-truth
   remains GM-ledger-only. *(The chronological rumor-feed VIEW itself is a
   follow-on surface — see Follow-on.)*
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
4. **Minds (D10, D22, D30).** One mind per spotlight character or per set
   of spotlight characters, with grouping kept open as the cost lever.
   Factions that act as a bloc (the Plebs, the Senate, gangs) may be
   modeled as collective NPCs with a single group mind (D22). Each mind
   sees only its own brief + memories + perceived digest, returns
   intent, private reasoning, and voice. **A mind now drives the evolution
   of its own `active_scheme` every turn — the scheme adjustment takes
   effect as that character's own evolving intent, not a hint the
   adjudicator may discard (D30)**; the adjudicator still owns the
   *outcomes* of actions in the shared world, the character's interior
   plan belongs to its mind. The Adjudicator consumes minds' outputs and
   resolves conflicts; `applyDeltas` unchanged. Slower and better is
   accepted (D16); richness axes join the 4A judge so the gain is
   *observed*, not assumed.
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

## Follow-on (built on the landed substrate, not open questions)

The D25–D30 round completed the information-model substrate: sourced
credibility with no player-facing number (D25/D26), the honest-window
verification model (D26), information-as-graph with topic tagging (D29),
scheme-as-"something afoot" + accreting clues (D28), minds evolving their
own schemes (D30), and dossier staleness-decay pricing (D27). What is
deliberately deferred:

- **The dedicated player-facing VISUAL surfaces.** The substrate is a pure,
  save-persisted read model; the surfaces that render it are the next build:
  the chronological **rumor feed** (4B.5), the **relationship-map tab**
  (4B.4, D13 — interpretation + hearsay edges, provenance-tagged, can be
  wrong not merely stale), and the **rich per-NPC dossier tab** (4B.3 — the
  frozen-snapshot view over `deriveDossier`; this round shipped only the
  accessor + refresh-cost mechanic wired into the existing intel panel, not
  a new visual).
- **The full clue-driven scheme-discovery mini-game (D28 forward
  direction).** Landed: an undiscovered-scheme claim that accretes clues
  toward a revealed nature. Deferred: the detective-style unraveling —
  clue-to-nature synthesis, partial reads, conflicting leads — that D28
  names as the fuller build, not this round's scope.
- **Journey smoke-harness integration.** Wire the landed knowledge/dossier/
  scheme paths into an end-to-end played-journey smoke run so the substrate
  is exercised in sequence, not only by unit tests.

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
