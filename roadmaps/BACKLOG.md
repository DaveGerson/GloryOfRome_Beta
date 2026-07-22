# Glory of Rome — Backlog Tracker

A durable parking lot for deferred work, follow-ons, veto items, and the
cross-cutting design tensions that keep resurfacing. Each entry carries
enough context to pick it up cold. Binding rulings live in
`DESIGN_DECISIONS.md`; the active plan in `ROADMAP_PHASE_4.md`. This file is
not a commitment or a schedule — it's the memory so nothing gets lost.

---

## Design tensions (recurring, cross-cutting)

### T1 — Soft/stochastic resources ↔ hard structured mechanics
The game deliberately runs two resource kinds side by side:

- **Soft resources** — freeform/narrative, generated *stochastically* by the
  simulation (the dynamic bag, D6): troops raised in a good week, favors
  owed, blackmail material, standing, goodwill. Flexible, emergent, but
  unstructured.
- **Hard resources** — a small set of engine-enforced systemic mechanics
  that give the game *structure* (denarii with floors/thresholds, D6;
  investigations as a gating intel currency). Legible and rule-bound, but
  rigid.

**The standing challenge: these must interoperate.** A soft resource the
world happened to generate should be spendable against, or convertible into,
the hard mechanics — without either (a) letting freeform generation trivially
mint hard-currency advantage (inflation / structure erosion), or (b) leaving
the hard mechanics feeling disconnected from the lived narrative. Every new
hard mechanic should ask: *what soft resources feed it, at what exchange rate,
and with what friction?* Surfaced while pricing investigations (see B1); it
will recur for every systemic mechanic added.

---

## Backlog items

### B1 — Currency converter: soft resources → investigations  *(owner-requested)*
Let the player exchange other currencies they hold — money/denarii, troops,
favors, standing, etc. — into investigation capacity. Investigations are a
hard gating currency but are currently unit-priced and scarce, with no way to
trade a surplus of one kind for intel. A converter is the T1 interoperability
bridge between the soft resource bag and the hard investigation mechanic.

- **Unlocks graded investigation pricing.** Once investigations have a real
  (non-unit) cost via conversion, the currently-dormant dossier-refresh decay
  curve (`knowledge/dossierCost.ts`, D27) becomes meaningful again — a warm
  refresh can cost genuinely less than a cold one. **Until the converter
  lands, investigations stay flat/simple ("as is") and the decay curve is
  preserved-but-dormant.** The converter is therefore the prerequisite that
  makes D27's graded pricing worth having.
- **Open design:** per-resource exchange rates; friction/loss on conversion
  (to prevent trivial minting — the T1 guardrail); whether conversion is
  instant or costs a turn; whether some conversions need an NPC/broker (tying
  intel-buying into the relationship system, so who you know gates what you
  can trade).

### B2 — Player-facing intelligence VISUAL surfaces
The substrate is built (knowledge graph D29, sourced-credibility framing
D25/D26, truth ledger, dossiers). The *views* are the payoff layer:
- **Rumor feed** — chronological, source-tagged, showing claims evolve (D21).
- **Relationship map** — fill the 0-byte `RelationshipsTab`: interpretation +
  hearsay edges with provenance and age (D13), can be wrong when a source
  lied.
- **Rich per-NPC dossier tab** — render `deriveDossier` output (frozen
  snapshots, source, staleness) instead of the current inline reveal.
All read the knowledge store only, never live ground truth.

### B3 — Clue-driven scheme-discovery mini-game  *(D28 forward direction)*
The data model is built (awareness vs earned nature, clue accretion, reveal
threshold). The forward direction is the fuller detective loop: unravel
accumulated clues to *deduce* a scheme's true nature, rather than a threshold
flip.

### B4 — Journey smoke-harness integration
Fable designed and prototyped a user-journey smoke harness (driving the real
turn pipeline via scripted fake clients, with six per-turn invariants incl. a
whole-journey GM-private leak scan). The prototype was built in a worktree off
a pre-Phase-4 snapshot — reconcile it to current HEAD and integrate as an
on-demand `test:journeys` suite (separate from `npm test`). It's the
end-to-end guard the unit suite structurally can't provide.

### B5 — Golden turns + judge calibration
The eval judge (5 axes incl. `character_richness`) is wired but uncalibrated.
It needs ~10 golden turns from a real owner-played session (export via the GM
console, Ctrl+Shift+G). Only the owner can produce these — the judge is a
scorer with nothing to score until then.

### B6 — Faction-level collective minds  *(D22 seam)*
The mind system has a documented seam for modeling a bloc (Plebs, Senate,
gangs) as one collective mind. Build when a faction matters as a spotlight
actor in its own right.

### B7 — Deferred edge cleanups
- `secret_truth` is not cleared on NPC revival — a publicly-returned NPC stays
  in the GM secret-survivors block.
- The D29 report-claim keying change (`report:{about}:{source}` →
  `report:{about}:{topic}:{source}`) orphans legacy rumor-claim timelines; no
  released saves are affected pre-merge, so migration is deferred.
- Fork-key collision under 300+ claims with eviction (theoretical; a monotonic
  fork counter closes it).
- The modal-weave same-turn double-hit (D12) has no suppression gate.
- `economic_stability` free-string triggers can go dormant when the model
  writes a synonym ("Collapsing" vs "Failing") — no canonical vocabulary
  enforced, so some authored events may never fire.

---

## Veto queue (authored content awaiting owner review)
Nothing here blocks; all are one edit from rewording.
- **Voice/epithet lines** for the 9 base-cast entities.
- **Event text** — 3 new (Acclamation on the Rhine, Stirrings in Africa, The
  Donative Comes Due) + 2 reworked (grain shortage, whispers of mutiny).
- **FATES posture wording** — PATIENT / MEASURED / EAGER.
- **D27 decay numbers** (floor 0.2×, cold threshold 6 turns) — moot while
  dormant; revisit alongside B1.
