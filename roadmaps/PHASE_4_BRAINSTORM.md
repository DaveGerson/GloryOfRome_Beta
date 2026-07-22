# Phase 4 Brainstorm — The Grill (pre-decision)

**Status: RESOLVED (July 2026).** The owner ruled on the ten headline
questions; the rulings are recorded as **D9–D18** in `DESIGN_DECISIONS.md`
and the resulting plan is `ROADMAP_PHASE_4.md`. Two questions (G9, G14)
received no explicit ruling — the plan adopts this document's own
recommendations for those, flagged as such there. This document is kept as
the audit and decision record.

Originally: brainstorm, not a plan. Produced from a full code audit at commit
`4755035` (post-PR #4: engine merge + design-system re-skin). Baseline:
typecheck clean, **201/201 tests green**. Companion to
`ROADMAP_0_MASTER_PLAN.md` Phase 4 ("Make It Deep: The Dope Leap") and
`DESIGN_DECISIONS.md` D1–D8. Open questions below are numbered **G1–G14**;
answers graduate into `DESIGN_DECISIONS.md` as **D9+** rulings.

---

## 1. Where the code actually is — the master plan's Phase 4 premises, audited

The master plan was written several phases ago. Every one of its Phase 4 items
rests on a premise about the code; several are now wrong in ways that change
the plan. Line references are current as of `4755035`.

### 1.1 "Eval harness first — requires AI-P0.3 raw capture from Phase 1"

**Premise half-true.** `geminiService.ts` captures per-call records
(`RawCallRecord`, `types.ts:287-295`) — but only the **response**
(`rawResponse`, truncated at ~20k chars) plus `promptChars`, a character
*count*. The prompt and systemInstruction text are **never stored**
(`geminiService.ts:325,349,431,521`). Out-of-band calls — investigations,
clarifications, deep analysis, ambition, epilogue — run outside the capture
bracket and are not recorded at all (`geminiService.ts:150-153`). And
`rollD20()` is raw `Math.random` (`resolution.ts:50-52`; seeding is an
explicit TODO at `:44-49`), so no turn is reproducible even with full capture.
**The harness's prerequisite is unbuilt, not built.**

### 1.2 "Split the monolith: Director → NPC minds → Adjudicator"

**More proto-structure exists than the plan assumed, and one key enabler the
plan never noticed.**

- `storyRelevance` already *is* a proto-Director: it picks 2–4 spotlight
  entities and suggests cast/location churn (`tools/intelligence.ts:142`). It
  does not emit intents.
- Adjudication is one two-phase pro-tier call (`prompts/adjudication.ts:41-53`)
  receiving **full briefs for every alive NPC every turn**
  (`adjudication.ts:145-177`, `fragments.ts:66-81`) — no top-K, no stubs.
- `Adjudication.entityActions` is **write-only**: required by schema, rendered
  in the GM console, and ignored by `applyAdjudication` (`engine.ts:305`).
  NPC "actions" only exist insofar as the same call also emitted deltas.
- Cross-turn secret continuity is thinner than it looks: the adjudicator's
  history window is `turnHistory.slice(-6)` rendered as **player-visible
  narration/headlines** (`turn.ts:193`). Past `gm_private` notes (secret
  meetings, mortality secret motives) are never fed forward. Scheming
  continuity rides entirely on `active_scheme` + `secret_truth` entity fields.
- **The unnoticed enabler:** `classifyDelta` is pure and takes the viewer as a
  parameter (`perception/visibility.ts:156`), and *every* NPC already has a
  populated `visibility_network` + location (`types.ts:114`,
  `baseScenario.ts`). Per-NPC perception — "what does Maximinus actually
  know?" — is computable **code-side, today, for free**. Information asymmetry
  does not require the multi-call split.

### 1.3 "Structured memory + context compression kills O(N²) growth"

**The plan aims at the wrong target.** `entity.memories` and
`relationship.recent_interactions` are written every turn (`engine.ts:316-327`,
`:129-131`) and read by **nothing but the GM console** — they feed no prompt
(`getEntityBrief` omits both, `fragments.ts:33-42`). They are save-bloat, not
prompt-bloat. The *actual* prompt growth is full-cast briefs × one relationship
clause per known counterpart. The *actual* save growth is
`TurnHistoryEntry.postTurnEntities` — a deep copy of **all** entities every
turn (`turn.ts:414`) — plus unbounded memories and rawCalls; localStorage
already has an emergency quota path (`saveGame.ts:151-166`,
`stripOldRawCalls`). "Memory compression" is really two separate decisions:
make memories load-bearing or cull them (G5), and bound the save (G3).

### 1.4 "The intelligence dashboard"

**Nothing accretes. Everything player-known is either recomputed from ground
truth each render, or evaporates.**

- `RelationshipsTab.tsx` is a **0-byte file, imported nowhere**. The five
  relationship axes exist on every entity pair (`types.ts:57-66`) but surface
  only as the player's own outbound list in `DramatisPersonaeTab:237-247`.
- Bought intel (beliefs/schemes/secrets/deep analysis) lives in
  component-local `useState` (`DramatisPersonaeTab.tsx:167`) — switching tabs
  **unmounts and discards it**; it is never saved. The only persistent trace
  is `blackmail_on_<id>` resources (`App.tsx:693-696`).
- `ChronicleTab` renders `eventHistory` — the scripted-event choice log — not
  the reign. Ordinary turns never appear in it.
- The only can-be-wrong channel is rumor→`Report` (credibility 0–1,
  `engine.ts:230-240`), but **nothing records whether a rumor is true**, and
  the game never reconciles one. The perceived digest is explicitly
  provenance-only, fidelity binary (`visibility.ts:14-19`,
  `DispatchesDigest.tsx:5-13`).

### 1.5 "NPC voice & pacing" / "Events with reach"

No `voice`/`epithet` fields, no tension mechanism — as expected. Events:
**two** authored events, **both** Emperor-gated (`constants/events.ts:10,44`),
fire-once with no cooldown (`events/engine.ts:17`). Triggers are typed JS
predicates, not string matches (roadmap claim stale). The `world` delta
shipped (`engine.ts:211-229`), so `grain_shortage` *can* now fire — if the
model ever drives `economic_stability` to `Failing`.

### 1.6 "Codebase keeps pace"

`App.tsx` is **971 lines with ~30 `useState` slices** and no reducer/context.
Phase 4 as scoped adds at least three new state slices (knowledge store,
tension, dossiers). Save format is v1 in localStorage.

---

## 2. The central observation

**All three headline items of master-plan Phase 4 are blocked on the same
missing thing: a knowledge layer.**

- The **eval harness** needs a recorded corpus (prompts + seeds) that doesn't
  exist.
- The **intelligence dashboard** needs persisted *player* knowledge
  (dossiers, learned edges, heard rumors) that doesn't exist — today's UI can
  only filter live ground truth, so a relationship map or rumor feed built
  now would either violate D5 or be rebuilt later.
- The **NPC minds** need per-NPC knowledge ("what does this character
  plausibly know") that doesn't exist — though the perception layer can be
  generalized to produce it cheaply.

The phase's real product may not be either headline feature, but the substrate
both stand on: **recorded truth (eval corpus), accreted player belief
(knowledge store), and bounded NPC belief (viewer-generalized perception)** —
with the flashy surfaces as views over it. That is the thesis to grill.

---

## 3. The Grill — G1–G14

Each question: context, the fork, and a stated position to push against.
Rulings graduate to `DESIGN_DECISIONS.md` as D9+.

### G1. What is the ONE thing Phase 4 must prove?

The master plan's checkpoint — "NPCs scheme independently off-screen and the
player has the tools to detect it" — is **two products**: an invisible brain
upgrade and a visible intelligence UI. If the phase slips (the "2–3 weeks"
estimate is optimistic; see §4), which half survives the cut? Note the trap:
the brain upgrade is *unverifiable* without the harness, and the UI is
*hollow* without persisted knowledge.
**Position:** the deliverable is the substrate; both headline features are
views over it. If forced to pick a demo moment: a dossier that remembers
something the world has since changed — fog you can feel.

### G2. Eval harness — how much harness, really?

To be more than a vibe check it needs: (a) prompt+systemInstruction capture,
(b) a per-turn seed persisted so rolls replay (`turnSeed` on
`TurnHistoryEntry`), (c) a golden set — from whose playthroughs? mockData is
synthetic and stale the day the prompts change, (d) an LLM judge (flash?) with
axes (consequence-density, sim-state consistency, schema validity, and — new —
*information-asymmetry discipline*: did anything leak that the viewer couldn't
know?), (e) a gate: CI-blocking, or a hand-run script before prompt merges?
**Position:** capture + seed + a hand-run judge script + ~10 goldens exported
from real play. Do **not** wire it into CI this phase — the judge itself is
unvalidated; gating merges on an unvalidated judge is process theater.

### G3. Where does the eval corpus live? (save-quota collision)

Capturing prompts means tens of KB per turn × 10 calls. localStorage already
hits quota (the `stripOldRawCalls` emergency path exists because it happened).
Fork: (a) persist capture in saves and migrate to IndexedDB (`idb-keyval`)
now; (b) keep capture **session-only** with a GM-console "export eval corpus"
button that downloads JSON — saves stay small, the harness gets files, no
migration.
**Position:** (b). The harness needs *files*, not saves. IndexedDB is a
Phase 5-adjacent chore; don't pay it to ship a corpus. (Independently: bound
`postTurnEntities` and `memories` regardless — that's save hygiene, G5/G13.)

### G4. NPC minds — where is the evidence the monolith is broken?

There is none — that's what the harness is for. Meanwhile the split's three
real value propositions are separable:
1. **Information asymmetry** — attainable in the monolith by feeding per-NPC
   knowledge blocks (viewer-generalized perception, §1.2) into the ONE
   adjudication prompt: "Maximinus knows only: …".
2. **Persistent intent** — attainable by making `entityActions` real: persist
   spotlight intents GM-side, feed them to next turn's Director/adjudicator.
   (Or delete the field — it's dead weight today. Keeping a schema-required,
   never-applied field is the worst of both.)
3. **Parallel flash-tier cost structure** — the only one that truly requires
   the split.
Fork: full split now / asymmetric monolith now, split later gated on harness
evidence / split now but only for the 1–3 spotlights, monolith handles the
rest.
**Position:** asymmetric monolith first. It's ~80% of the fiction ("NPCs act
on what they'd plausibly know") for ~20% of the risk, it makes `entityActions`
real instead of deleting it, and it produces the baseline the harness needs
before a split can be judged an improvement. The split stays on the menu as
4C, evidence-gated.

### G5. What do NPCs get to know — and are memories load-bearing?

If minds (or asymmetric briefs) see "only what that NPC plausibly knows":
reuse `classifyDelta` with viewer=NPC (crude v1 rules: own location, own
network, public)? Does an NPC mind see other NPCs' `secret_truth` /
`active_scheme`? (Today the single adjudicator sees *everything* — the split's
honesty is also its risk: less-informed minds may scheme dumber.) And
`entity.memories`: today write-only noise stamped by headline-name-matching.
Fork: make memories the NPC-side knowledge store (mind context = brief + own
memories + own perceived digest; upgrade memory-writing to per-NPC perceived
events) — or cull them and cap the array.
**Position:** memories become load-bearing *only if* G4 lands asymmetry;
otherwise cap at ~20 and move on. Secrets: an NPC mind sees its own secrets
and only *learned* facts about others — that's the whole point.

### G6. The relationship map vs D5 — whose edges does the player see?

The five axes exist for every pair, but D5 forbids omniscience. Ladder:
(a) own outbound edges only — objectively knowable, and objectively boring;
(b) + NPC→player as *sensed impressions* — the digest already narrates "you
sense his trust shifting" (`visibility.ts:248-249`), so a numeric-ish stale
snapshot arguably just persists what D5 already leaks;
(c) + NPC↔NPC edges **only when learned** (witnessed / network / bought),
each edge carrying source + turn-learned + confidence, going stale as the
world moves.
And the sharp edge: **can a displayed edge be wrong** (planted rumor), or only
stale?
**Position:** (c), and yes-wrong-eventually — it's the paranoia payoff and the
reason the map must be a *knowledge-store view*, not a filtered-truth view.
(a) alone isn't worth building; it's already the Personae list.

### G7. Does fidelity stop being binary in Phase 4?

D5 explicitly deferred "sourced reports that can be wrong" until GM tuning
tools exist — and the GM console now exists. Meanwhile, de facto, rumors can
*already* be false (the adjudicator invents them freely; nothing tracks
truth). The upgrade is: (a) GM-private truth flags on rumor/report claims,
(b) *deliberate* planting as an NPC scheme verb, (c) a player verification
verb (the investigation spend already exists and fits), (d) GM-console
visibility of true-vs-believed. Fork: land all of it / land truth-*tracking*
only, planting later / stay binary this phase.
**Position:** land truth-tracking + planting. It's cheap (a GM-private field
+ prompt guidance + the existing investigation verb as the counter), it makes
the rumor feed a game system instead of a skin over `ReportsTab`, and it's
the first thing the GM console can actually *tune*. The scary version —
false *witnessed* events — stays out of scope; only sourced claims can lie.

### G8. Dossier truth semantics — snapshot or live?

Player buys "beliefs" on turn 8; NPC's beliefs change on turn 12. Does the
dossier show the turn-8 snapshot (staleness = fog of war) or live-update
(omniscience creep, D5 violation)? Where do dossiers persist (new optional
save field — v1-compatible per invariant 6)? Do `blackmail_on_*` resources
fold into the dossier as leverage entries, or stay a resource hack?
**Position:** snapshots, stamped with turn + source + confidence, never
auto-updated — staleness is the *product*. Blackmail folds in as a dossier
entry type; the resource stays for engine compatibility.

### G9. The Chronicle — which record is it a view of?

UX-P1.2 says "build it from `turnHistory`" — but `turnHistory` is ground
truth (`postTurnEntities`, raw adjudication). A player-facing chronicle must
be built from the **perceived** record, which today is computed transiently
each turn and thrown away. Fork: persist a per-turn perceived digest
(knowledge store again) / rebuild perception retroactively at render time
(fragile — the player's vantage moved) / keep the choice-log Chronicle.
**Position:** persist the perceived record per turn — it's the same substrate
G6/G8 need, and it's the only honest source for "the reign as you lived it."
This also finally gives `narration` + player intent a player-facing archive.

### G10. Tension budget — who owns pacing, code or model?

FUN-P1.4 wants quiet weeks then detonations. Fork on ownership: code-side
scalar from measurable signals (delta counts, outcome tiers, deaths, scheme
completions) injecting a PAYOFF directive past threshold — vs asking the
model to self-assess tension. And the no-op guard: a payoff turn must be
backed by ≥1 *deterministic* consequence. What is it concretely — force-fire
an authored event? force a ripe `active_scheme`'s completion deltas through
the engine?
**Position:** code-owned accumulator, GM-console-visible (D7), player-facing
only as ambience (UI-7.5). The deterministic backstop is "detonate a ripe
scheme": pick the spotlight NPC whose scheme is oldest and force its
completion deltas — which neatly requires intents/schemes to be real (G4).

### G11. Scripted events — invest, fold, or repurpose?

Two events, both Emperor-locked, one gated on a field the model only started
being able to move recently. Fork: (a) invest per MECH-P1.3 (6–10 authored,
sim-keyed, repeatable, all roles); (b) kill the modal system — the
adjudicator + tension budget generate crises, which is philosophically
on-brand (the README's whole thesis is that authored rules can't cover human
complexity); (c) **repurpose**: the event system becomes the tension budget's
deterministic payoff arsenal — sim-state-keyed, role-agnostic, repeatable
with cooldowns, fired *by* G10 rather than polled every turn.
**Position:** (c). It keeps authored quality beats exactly where the
simulation is weakest (guaranteeing payoffs land) and stops pretending the
event library is a content pipeline anyone is going to fill.

### G12. What is the per-turn cost/latency budget?

A maximal turn is already ~10 calls, mostly pro-tier with thinking budgets.
NPC-mind splitting adds 1–3+; dossier/rumor systems tempt more. Is there a
ceiling (wall-clock p50, $/turn) the phase must respect? Related ordering
question: does brief compression (full briefs for spotlight + involved,
one-line stubs otherwise; top-K relationships by |trust|+|threat| salience)
land **before** any call-count growth, to pay for it?
**Position:** compression first, net call count flat in 4A/4B, and any 4C
split must arrive cost-neutral (flash minds + slimmer adjudicator context) or
show harness evidence it's worth paying for.

### G13. Does the App.tsx refactor precede or trail the features?

971 lines, ~30 slices, and Phase 4 wants to add knowledge store + tension +
dossier state. The master plan lists the reducer/context extraction as item 7
("keeps pace"); the code says it's a prerequisite — every new slice added to
the god component raises the extraction cost later. Also in this bucket:
bound `postTurnEntities` (cap or diff), cap `memories`/`recent_interactions`.
**Position:** extract the reducer *first* (mechanical, zero-behavior-change,
tests exist), add new Phase 4 state only to the reducer world. Save-shape
additions stay optional fields per invariant 6.

### G14. What does Phase 4 explicitly NOT do?

Proposed exclusions, to pre-empt scope creep: interactive SVG empire map
(UI-8.5), settings surface (12.3), multi-slot saves (12.1), mobile/responsive
(10.2), portraits/audio (11.x), API-key proxy + sanitization (Phase 5 gates),
full strict-TS sweep, IndexedDB migration (unless G3 goes the other way),
NPC-to-NPC autonomous multi-call conversations, and any quest-log-shaped UI
(D8 stands).
**Position:** adopt as written; revisit only if a G-ruling forces one in.

---

## 4. Three candidate phase shapes

### Shape A — Plan-faithful
Run master-plan Phase 4 as written: harness → split → memory → dashboard →
voice → events → codebase.
*Risk:* the harness stalls immediately on the capture gap (§1.1); the
dashboard gets built on filtered ground truth and rebuilt later on the
knowledge store; the split lands unverifiable. The 2–3wk estimate is really
4–5 at this scope.

### Shape B — Substrate-first (recommended)
- **4A — Instrument & bound (~1wk):** prompt+systemInstruction capture;
  per-turn seed through `resolution.ts`; GM-console corpus export; harness
  MVP (hand-run judge, ~10 goldens); reducer extraction; brief compression +
  save bounding. *No visible gameplay change — this is the trust layer.*
- **4B — The knowledge layer (~1–1.5wk):** persisted player-knowledge store
  (claims/impressions with subject, source, turn, confidence; optional save
  field). Views over it: persistent dossiers (G8), relationship map with
  learned edges (G6), rumor feed with truth-tracking + planting per G7,
  Chronicle from the persisted perceived record (G9).
- **4C — Asymmetric minds (~1wk):** viewer-generalized perception feeding
  per-NPC knowledge blocks; `entityActions`/intents made real and persistent;
  *then* judge the full Director→minds→Adjudicator split against the 4A
  harness before paying for it.
- **4D — Voice & pressure (~1wk):** `voice`/`epithet` + moment lines; tension
  accumulator with scheme-detonation backstop (G10); event system repurposed
  as the payoff arsenal (G11).
*Each sub-phase ships independently and CI-green; 4B is the first visible
payoff, and the D5 story gets stronger, never weaker.*

### Shape C — Spectacle-first
Build the dashboard + voice/pacing now against filtered ground truth;
substrate later.
*Payoff:* visible wins in days. *Risk:* the map either violates D5 or shows
only own-outbound edges (boring); dossiers stay ephemeral or get a throwaway
persistence hack; all of it is rebuilt in the next phase. Choose only if the
priority is a demo.

---

## 5. Invariants carried forward (unchanged, one correction)

The eight architecture invariants from the Phase 4 kickoff note all stand
(service-layer routing, prompts-in-`ai/prompts/`, D5 perception filtering,
D4 hidden rolls, D1 death-only-terminal, optional-field save compatibility,
exhaustive `TurnStage` record, green CI). One correction: the suite is now
**201 tests**, not 197. New invariant candidates if Shape B lands: the
knowledge store is the ONLY source player-facing intelligence surfaces may
read (never live entity ground truth), and truth flags on claims are
GM-private in the same class as `secret_truth`.
