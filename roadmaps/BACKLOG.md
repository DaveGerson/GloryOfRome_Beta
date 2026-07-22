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

### B4 — Journey smoke-harness integration  *(LANDED)*
Done: the multi-turn journey suite runs the real turn pipeline via scripted
fake clients (`tests/journeys/` — quietReign, schemeWar, mortalityFates,
saveReload — over `harness.ts`), invoked on demand as `npm run test:journeys`
(separate from `npm test`). Landed in the pre-Phase-5 close-out (commit
`0831889`). Kept here as memory; new substrate paths should gain journey
coverage as they land.

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
- A presumed-dead NPC keeps its `active_scheme` as GM ground truth (never
  leaked to the player; pinned by the `mortalityFates` journey). Kept as-is;
  if a future fix clears it on revival, update that journey's expectation.
  Related to the `secret_truth`-not-cleared-on-revival item above.
- *(Phase 5 adversarial-review flags, July 2026:)* Chat now renders HTML
  entities literally (`&amp;` shows as `&amp;`) since the
  escape-by-construction fix — if the model emits entities often, add a
  decode-then-escape single pass in `components/textFormat.ts`. Ctrl+Shift+G
  still `preventDefault`s when the GM console is disabled in settings
  (keystroke swallowed, nothing shown). `ROADMAP_6_MAINTAINABILITY.md`
  references a pre-archive DesignDocs path (historical doc, cosmetic).

### B8 — Raw relationship numbers on the Personae tab  *(ruling needed)*
`DramatisPersonaeTab` renders the player's own Trust/Respect/Threat/
Alignment/Dependency toward each NPC as raw signed numbers + bars
(`TrustBar`). These are the player's OWN relationship reads (arguably D5
'self'-visible, so legitimate) — but they are the kind of raw ground-truth
number D13's relationship map is meant to reframe as interpretation with
provenance. Decide when B2's relationship map is built: keep the raw
self-numbers, or fold them into sourced/interpretive framing (the D13/D25
no-bare-numbers spirit). Not a bug — a consistency call. Surfaced by the
close-out UI pass.

### B9 — Owner-funded hosted mode (key proxy + quota policy)
Superseded-for-now by D34 (bring-your-own-key is the default path; no server
component). If the game ever ships with the owner's key footing the bill for
visitors: a serverless pass-through proxy holding `GEMINI_API_KEY` (strict
model-endpoint allowlist, SSE passthrough for streaming), plus the quota
policy design that was deliberately not ruled on in the Phase 5 grill —
per-session/IP turn caps, in-fiction limit framing ("The Fates rest —
return at dawn"), and whether public turns stay pro-tier (D16's
slower-and-better instinct says yes; cap turns instead of downgrading).

### B10 — "Fortuna's Favor" — costed GM intervention as a player mechanic
Parked by D32 (intervention stays free, toggleable). If it ever becomes a
player-facing miracle system, the open design from the Phase 5 grill: cost
source (denarii via temple rites rides D6 and the T1 anti-minting friction;
an earned "Pietas" resource risks quest-log smell under D8; free-but-visible
makes every use spawn omens in the rumor graph that NPCs react to — a
denarii + omens hybrid was the leading candidate); scope bounds (probability
nudges compose with `resolution.ts` seeded rolls per invariant 11; raw fact
edits need fiat-truth handling in the D11 ledger to avoid breaking D26's
honest window); and who "witnessed" a miracle, for the perception layer.

---

## Veto queue (authored content awaiting owner review)
Nothing here blocks; all are one edit from rewording.
- **Voice/epithet lines** for the 9 base-cast entities.
- **Event text** — 3 new (Acclamation on the Rhine, Stirrings in Africa, The
  Donative Comes Due) + 2 reworked (grain shortage, whispers of mutiny).
- **FATES posture wording** — PATIENT / MEASURED / EAGER.
- **D27 decay numbers** (floor 0.2×, cold threshold 6 turns) — moot while
  dormant; revisit alongside B1.
