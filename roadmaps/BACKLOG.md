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
saveReload — over `harness.ts`), invoked as `npm run test:journeys` (a
separate vitest config from `npm test`) and CI-gated on every push/PR since
commit `609505e`. Landed in the pre-Phase-5 close-out (commit `0831889`).
Kept here as memory; new substrate paths should gain journey coverage as
they land.

### B5 — Golden turns + judge calibration
The eval judge (5 axes incl. `character_richness`) is wired but uncalibrated.
It needs ~10 golden turns from a real owner-played session (export via the GM
console, Ctrl+Shift+G). Only the owner can produce these — the judge is a
scorer with nothing to score until then.

Once the golden-turn corpus lands, also check in one representative corpus
fixture and add a CI step running only `eval`'s deterministic-checks leg
(`GOR_EVAL_CORPUS=<fixture path> npx vitest run --config vitest.eval.config.ts -t "deterministic checks"`)
against it — the LLM-judge leg stays manual/local given three still-open
blockers: uncalibrated scoring (no baseline to compare against yet), real
recurring Gemini API cost/non-determinism per run, and fork-PR secret-exposure
risk from wiring `GEMINI_API_KEY` into a workflow that triggers on
`push`/`pull_request` with no fork restriction. Revisit the judge leg only
once the corpus exists, its scores have been manually validated as a
baseline, and a deliberate decision is made to accept the recurring cost and
adopt fork-safe secret handling (e.g. `pull_request_target` with explicit
review gating, or a manual/scheduled workflow instead of every push).

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

### B11 — Accepted lint debt: 17 ESLint warnings triaged and tracked  *(Phase 6 quality-gate ratchet)*
Task 5 landed a non-disruptive ESLint flat-config gate that surfaced 82
warnings at 0 errors (commit `9ca98c7` against parent `1cef76e`). The
dedicated Task 5 review (`.superpowers/sdd/task-5-review.md`) read every
occurrence individually and initially accepted 52. Subsequent Phase 6 work
resolved 35 of those warnings: the App, mock, eval, and smoke-test unused
bindings; the `geminiService`, `Game`, eval, and additional test `any` sites;
the turn/mock `prefer-const` sites; `preserve-caught-error`; the App and
SidePanel state-in-effect sites; and both exhaustive-deps findings no longer
appear in current lint output. Those fixes lower the ratchet rather than
leaving stale capacity behind.

A dedicated Terra-medium debt triage read the exact remaining 17 occurrences
and assigned every group the binary ACCEPT disposition below. This inventory
is enforced, not advisory: `npm run lint` compares ESLint output to the exact
file, location, rule, and message fingerprints in
`tooling/eslint-warning-baseline.json`. Any added, removed, or substituted
warning fails the gate loudly, as does any ESLint error. A resolved warning
must lower both the manifest and this ledger; a new warning requires a new
deliberate binary triage before the manifest can change.

- **ACCEPT — unused/dead bindings (4 occurrences:
  `ai/core/engine.ts:343,353`; `ai/core/initiator.ts:5`;
  `events/engine.ts:1`).** The two engine catch bindings are never read, and
  both imports are dead. They cannot change runtime output because no
  execution path consumes the names; there is therefore no loud or silent
  functional failure and the blast radius is zero. Keeping them does leave
  local intent noisier for maintainers, but removing them has no player,
  save, prompt, or mechanics effect. Accept until one of these files is
  substantively edited, then convert the catches to `catch {}` and remove the
  imports under the file's normal characterization gate.
- **ACCEPT — `no-explicit-any` (9 occurrences: `components/ui/Core.tsx` ×4;
  `components/ui/Forms.tsx` ×3; `tests/director.test.ts`;
  `tests/engine.test.ts`).** The two test occurrences never ship. The seven UI
  occurrences widen generic rest-prop buckets, so TypeScript cannot reject a
  misspelled or incompatible extra prop before runtime; that is a silent
  loss of compile-time protection, not a known runtime defect. React and the
  browser still enforce their actual DOM behavior, and all explicitly named
  component props remain typed. The potential blast radius is limited to
  callers of these small UI primitives; game state, saves, AI prompts, and
  mechanics are unaffected. Accept because there is no observed bad caller
  and a proper fix requires deliberately retyping the component prop surfaces
  rather than assertion-casting the warning away. Revisit in a scoped UI type
  hygiene pass or immediately if an invalid rest prop causes a real defect.
- **ACCEPT — `prefer-const` (3 occurrences: `ai/core/engine.ts:459`).** These
  names share one destructuring statement with a sibling that is reassigned,
  but the three warned bindings are not themselves mutated. `let` versus
  `const` changes only the static mutability guarantee, so there is no runtime
  failure mode and the blast radius is zero. Accept because splitting the
  engine destructure solely for style would touch a mechanics-critical module
  without functional benefit. Revisit when that statement is already under
  characterization-tested substantive change.
- **ACCEPT — `react-hooks/set-state-in-effect` (1 occurrence:
  `components/OnboardingOverlay.tsx:69`).** Opening the overlay synchronously
  resets its local step to the beginning, but effects run after render.
  Reopening can therefore briefly render the retained old step before the
  effect resets it, and assistive technology may briefly announce that stale
  step. The degradation is a silent, localized visual/accessibility mismatch
  plus one extra render; the state then converges and no update loop is
  present. The blast radius is limited to onboarding-overlay reopen timing
  and cannot affect game state, saves, AI prompts, or mechanics. Accept
  because no user-visible complaint is observed and the real fix is an
  event-driven state-lifecycle redesign that needs focused component
  characterization, not warning suppression. Revisit immediately if the
  stale-step flash/announcement is observed or the open/reset lifecycle is
  redesigned.

### B12 — Task 4b vendor-chunk-split interactive preview smoke: not yet run
When Task 4b split the single oversized JS bundle into deterministic vendor
chunks (`vite.config.ts`'s `manualChunks`, commit `1cef76e`), the task brief
called for an interactive preview smoke check afterward — start `npm run
preview`, walk character creation through one turn, toggle the GM console via
Ctrl+Shift+G, and confirm no console errors — as direct, DOM-level evidence
that the multi-chunk build actually boots correctly in a real browser. The
controller started the production preview on `127.0.0.1:4173` and confirmed
it served HTTP 200, but the browser-control runtime reported that no in-app or
Chrome browser backend was available in that session, so the interactive
walkthrough itself could not be executed
(`.superpowers/sdd/task-4b-report.md` §8).

This is recorded as an explicit verification-evidence gap, not accepted code
debt and not a claimed pass. The evidence that does exist bounds the risk
without closing it: an independent reviewer verified the emitted inter-chunk
imports form a clean DAG, `dist/index.html` preloads all required vendor
chunks, the production preview serves successfully, `npm run typecheck`
passes, and all 665 tests pass. None of that substitutes for actually loading
the app in a browser and watching it run. If a defect exists that this
evidence can't see — a runtime-only ESM chunk-loading failure that only
manifests once a real browser parses and executes the split bundles — its
consequence would be loud and global: the app would fail to boot for every
player, not a subtle or silent gameplay-corruption failure. Trigger to
revisit: rerun the interactive smoke (character creation → one turn →
Ctrl+Shift+G toggle → confirm zero console errors) the next time a session
has a working browser backend available, and treat it as blocking before
treating the vendor-chunk split as fully verified end-to-end.

---

## Veto queue (authored content awaiting owner review)
Nothing here blocks; all are one edit from rewording.
- **Voice/epithet lines** for the 9 base-cast entities.
- **Event text** — 3 new (Acclamation on the Rhine, Stirrings in Africa, The
  Donative Comes Due) + 2 reworked (grain shortage, whispers of mutiny).
- **FATES posture wording** — PATIENT / MEASURED / EAGER.
- **D27 decay numbers** (floor 0.2×, cold threshold 6 turns) — moot while
  dormant; revisit alongside B1.
