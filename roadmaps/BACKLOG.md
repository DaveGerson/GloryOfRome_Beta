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

### B11 — Accepted lint debt: 52 ESLint warnings triaged and tracked  *(Task 5 review, Phase 6)*
Task 5 landed a non-disruptive ESLint flat-config gate that surfaced 82
warnings at 0 errors (commit `9ca98c7` against parent `1cef76e`). The
dedicated Task 5 review (`.superpowers/sdd/task-5-review.md`) read every
occurrence individually, since the original task report had left all 82 rows
at a non-terminal "left as-is/deferred" disposition, which this project's
guardrail does not accept as final. The review produced a binary triage: 30
occurrences resolved to a fix (either bundled into a small mechanic-neutral
follow-up task already executed — commits `e38c29e`, `6caf233`, `992a653` —
or already fixed by Task 6's stage 4, commit `99e9804`), and the remaining 52
to durable, tracked debt. Recorded here group by group so no occurrence is
left living only inside a review document. The 52-warning inventory is
enforced, not advisory: the lint script runs `eslint . --max-warnings 52`
(Phase 6 final review), so a new warning of any allowed class fails the gate
loudly instead of silently growing this list — shrinking the count is always
fine; growing it requires a deliberate triage plus a ratchet bump.

- **Dead imports, unused catch bindings, and mock-interface-parity params (13
  occurrences: `App.tsx:3`; `ai/core/engine.ts:343,353`;
  `ai/core/initiator.ts:5`; `ai/mocks.ts:184,218,390` ×6;
  `events/engine.ts:1`; `tests/evalHarness.test.ts:546`;
  `tests/smokeTest.ts:17`).** No runtime degradation: every flagged name is
  confirmed dead, or exists only so a mock function's signature mirrors the
  real function it stands in for; there is no execution path through any of
  them. No failure mode exists, loud or silent, because nothing depends on
  these bindings executing. Blast radius is zero — none of these names touch
  production behavior, the save format, an AI prompt, or a player-visible
  surface. Accepted now because a real fix requires a coordinated
  rename/removal sweep across seven files spanning production, mocks, and
  tests for zero functional benefit, while Phase 6 already has
  source-touching work landed (Task 6, commit `99e9804`) and a Task 7
  candidate queued that will need the same characterization-test discipline
  first. Trigger to revisit: fold this
  in the next time one of those seven files is already open for a
  substantive reason — remove the dead imports, convert the unused catch
  bindings to `catch {}`, and prefix the intentionally-unused mock/test
  params with `_` alongside adding `argsIgnorePattern: '^_'` to
  `eslint.config.js`. Not worth a standalone task on its own.
- **`no-explicit-any`, not covered by Task 6, genuinely low priority (21
  occurrences: `ai/core/geminiService.ts:442` ×2; `components/ui/Core.tsx`
  ×4; `Forms.tsx` ×3; `Game.tsx` ×1; `eval/harness.ts` ×6; and 5 occurrences
  across `tests/director.test.ts`, `tests/engine.test.ts`,
  `tests/geminiService.test.ts` ×2, `tests/smokeTest.ts`).** No observable
  degradation: the `geminiService.ts` pair is a documented, intentional zod
  v4 generic-parameter escape hatch that should never be "fixed"; the UI
  components' `any` only widens the type of a rest-spread prop bucket, while
  the browser and React still enforce real DOM prop semantics at runtime
  regardless of what TypeScript believes about the type; `eval/harness.ts`
  and the test files never ship to a player. No loud or silent failure mode
  rides on any of these — there is no known bug class behind the typing gap.
  Blast radius is zero for `geminiService.ts` and the eval/test files
  (permanent by design), and low-but-nonzero for the three UI components (a
  stricter type would only catch a caller passing a garbage prop name into
  the untyped rest-spread bucket; every explicitly named prop is already
  typed). Accepted now because hand-typing five components' prop shapes and
  two tooling files buys a cosmetic typing win with no known defect behind
  it. Trigger to revisit: `geminiService.ts`'s two occurrences and everything
  under `eval/`/`tests/` need no action ever — re-confirm only if zod's major
  version changes; the three UI components should be retyped via
  `React.ComponentPropsWithoutRef<'element'>` only if a lint-hygiene sweep is
  ever prioritized as a batch alongside the dead-imports and prefer-const
  groups below.
- **`prefer-const` (10 occurrences: `ai/core/engine.ts:459` ×3,
  `ai/core/turn.ts:705` ×4, `ai/mocks.ts:324` ×3).** No degradation: each
  site is a single destructuring statement where only one field is
  reassigned later in the function, and TypeScript/JavaScript syntax has no
  way to mark the other three or four destructured names `const`
  individually within that one statement — none of the flagged names are
  ever actually mutated. No failure mode; `let` vs `const` here is a
  mutability guarantee, not a behavior difference. Blast radius is zero, a
  style signal only. Accepted now because the mechanical fix (splitting the
  statement or reordering the destructure) touches `ai/core/engine.ts` and
  `ai/core/turn.ts`, both part of the "pure and testable" engine module that
  global constraint 9 requires characterization coverage for before any
  edit — disproportionate cost for a change with no runtime effect. Trigger
  to revisit: fold in only if one of those two files is already being opened
  for a substantive reason; not bundled automatically just because a future
  task touches a different function in the same file.
- **`preserve-caught-error`, dev-only script (1 occurrence:
  `tests/smokeTest.ts:163`).** No degradation: the original error is already
  passed to `console.error` on the line immediately before the rethrow, so
  the diagnostic information this rule protects is not actually lost — only
  the formal `.cause` chain link is missing. No failure mode; this script is
  not part of `npm test` and is never run in CI or shipped to players. Blast
  radius nil. Accepted now because the loss this rule warns against does not
  actually occur here. Trigger to revisit: none anticipated; re-confirm only
  if `smokeTest.ts` is ever promoted from a standalone dev script into a
  CI-run path.
- **`react-hooks/set-state-in-effect` (5 occurrences: `App.tsx:383,433,459`,
  `OnboardingOverlay.tsx:69`, `SidePanel.tsx:65`).** Each is the standard
  "synchronize local UI state with a prop or mount-condition change" idiom;
  the Task 5 review traced all five individually and found no update loop
  (React's synchronous batching bounds each to one render cascade, and
  `App.tsx:459` sets the exact flag that gates its own effect, terminating
  the cycle rather than continuing it) and no stale-closure or correctness
  bug. Degradation, if any, is an extra render pass per state-sync — a
  performance/architecture smell, not a functional break; if it ever
  mattered the failure mode would be silent (a wasted render), but there is
  no evidence it matters at this app's scale. Blast radius is client-side
  render timing only — it does not touch game mechanics, state semantics,
  the save format, or an AI prompt/schema; global constraint 1 governs
  game-system semantics, not React re-render cadence. Accepted now because
  the real fix (moving to event-driven state updates) is a genuine future
  modernization but requires a careful, characterization-tested refactor
  across three components per constraint 9, and no defect rides on top of
  the current behavior today. Trigger to revisit: a candidate future React
  effect-cleanup pass across `App.tsx` (×3), `OnboardingOverlay.tsx`, and
  `SidePanel.tsx`, gated on writing characterization tests first; not
  scheduled, revisit if `eslint-plugin-react-hooks` majors again or a real
  render-performance complaint surfaces.
- **`react-hooks/exhaustive-deps` (2 occurrences: `App.tsx:746` inside
  `executeTurn`, `App.tsx:967` inside the `handleEventChoice` region) —
  confirmed false positive, not real debt.** Both callbacks already list
  `state` in their dependency array, and every field ESLint flags as
  "missing" is destructured directly from that same `state` object; because
  `state` is immutable per-dispatch, each of those fields changes if and
  only if `state` changes, so the callback cannot observe a stale value of
  any of them. No degradation, no failure mode, zero blast radius. Accepted
  now, indefinitely, because listing all 15 (then 8) individual field names
  would be strictly redundant with zero behavior change, while touching
  `App.tsx`'s two largest, most turn-critical callbacks purely to silence a
  false alarm carries nonzero fat-finger risk for no benefit. Trigger to
  revisit: none expected; if ever revisited, resolve with a scoped
  `eslint-disable-next-line` plus a one-line comment rather than expanding
  the dependency array.

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
