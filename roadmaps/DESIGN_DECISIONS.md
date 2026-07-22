# Design Decisions (Owner Rulings)

Binding design rulings from the project owner. These override anything to the
contrary in the domain roadmaps. Each decision notes what it changes.

## D1 — No win conditions. Survival-only simulation.
There is no such thing as "winning." You play the simulation; the run ends
when your character's story ends. Death is real. Exile is survivable (an
exiled character can keep playing — a run ends only on death).
*Changes:* Phase 2 drops authored win conditions entirely. The epilogue is
the payoff artifact for every run, however it ends.

## D2 — The mortality pipeline (player)
Any agent-declared player death goes through two gates before it sticks:
1. **Validation**: a second, independent adjudication call dispositions the
   declared death — is this outcome real and earned given the world state,
   or a model hallucination/overreach?
2. **Death save**: a hidden d20 roll (code-side, never shown to the player):
   - **1–5** — dies. The run ends.
   - **6–10** — survives, but suffers a real loss (applied as validated
     deltas: a resource, a relationship, an exposed scheme — not just prose).
   - **11–17** — survives somehow. Narration explains the escape.
   - **18–20** — survives AND gains a boon (applied as validated deltas).
The model narrates the *pre-decided* outcome; it does not decide it.
*Changes:* This is the first deterministic dice mechanic — deliberately
built as the first consumer of the Phase 3 resolution layer
(`ai/core/resolution.ts`), not a one-off.

## D3 — NPC fate table (different system from the player's)
Validated NPC deaths roll on a separate fate table rather than a save.
Outcomes include: confirmed dead; gravely wounded (survives publicly,
weakened); **presumed dead** — the world and player believe them dead, but
they are secretly alive in hiding and may return as a nemesis; escapes
openly. Rolls are hidden. An NPC who "comes back after you think they are
dead" is a desired outcome, not a bug.
*Changes:* Requires a GM-private secret-survival state on entities, kept out
of all player-facing surfaces, fed back to the adjudicator so returns can be
plotted.

## D4 — Rolls are never shown to the player
All mortality rolls (player and NPC) are hidden. Only the narration conveys
the outcome. Rolls ARE recorded in the GM console for tuning.

## D5 — The player is not omniscient: perception layer
The player sees only what they objectively know from their vantage point —
this governs BOTH the world-status display and any "what changed" feedback.
No raw global truth in player-facing UI. They can explore or send
individuals out for information, with **no guarantee of fidelity**.
*Near-term (agreed):* a code-side visibility filter (witnessed / in their
location / via visibility_network / public headlines), where fidelity is
binary — you see it or you don't. *Later:* sourced reports that can be
wrong, not just absent (needs GM-console tuning tools first).
*Crude v1 convention:* empire-level macro status (e.g. "the throne is
vacant") is treated as public knowledge; NPC- and region-level intrigue is
filtered.

## D6 — Resources: dynamic bag stays, plus a small systemic registry
Most resources remain freeform/narrative for flexibility. A small set are
hard-coded systems with engine-enforced rules. **Money (denarii) is the
first**: it is knowable (your own treasury, objectively) and systemic
(floors/thresholds/consequences in code). Other entities' treasuries are
NOT knowable (perception layer applies).

## D7 — GM console stays, toggleable
The GM log/debugger is critical while the story is being tuned and the app
is being developed. It is NOT removed or env-gated away; it gets a runtime
toggle (hidden by default for a clean player view) and becomes the home of
all ground truth: unfiltered deltas, true SimulationState, raw AI calls,
mortality rolls/traces.

## D8 — Player ambition is inferred, never declared
No quest log, no chosen goals. A cheap periodic model call infers what the
player *appears* to be pursuing from their actions. Used for: epilogue
framing, and NPC reactions to the player's apparent (not actual) agenda.

---

Rulings D9–D18 answer the Phase 4 grill questions in
`PHASE_4_BRAINSTORM.md` (July 2026). Two questions received no explicit
owner ruling: G9 (Chronicle's source of record) and G14 (the out-of-scope
list) — the plan adopts the brainstorm's own recommendations for those
two, flagged as such in `ROADMAP_PHASE_4.md`. The resulting plan is
`ROADMAP_PHASE_4.md`.

## D9 — Plumbing first, so mechanics can be brainstormed live
Phase 4 builds the substrate before the headline features: call capture,
reproducible rolls, the eval/tuning export, the knowledge layer, and the
state-refactor. The stated purpose is not engineering hygiene for its own
sake — it is that with instrumentation in place, mechanics can be iterated
and observed *live* instead of argued about in the abstract.
*Answers:* G1 (the phase's product is the substrate), Shape B adopted.

## D10 — NPCs get their own brains: richer selves, not smarter play
Each NPC — or a *set* of NPCs (a faction, a household, the spotlight cast)
— gets its own simulated mind. The point is explicitly NOT tactical
intelligence; it is that each simulated self becomes *richer*: a bounded
knowledge of the world (what that character actually witnessed or heard),
their own motives, voice, and continuity of intent from week to week.
Grouping minds per-set rather than per-individual is an acceptable cost
lever; dumber-but-truer characters beat smarter-but-omniscient ones.
*Answers:* G4/G5. *Changes:* the full mind split is committed (not
evidence-gated), but lands after the D9 substrate; per-NPC knowledge
bounds come from generalizing `perception/visibility.ts` to any viewer.

## D11 — The system may lie, but must always know it is lying
Sourced information (rumors, reports, hearsay) can be deliberately false.
Precondition, ruled explicitly: the system must know what a lie is *for
its own sake* — ground truth with GM-private truth flags is mandatory
bookkeeping, so a falsehood is only ever presented knowingly and
trackably, never as an accident of generation the engine itself cannot
distinguish from fact. The GM console shows true-vs-believed. Witnessed
events do not lie.
*Answers:* G7. *Changes:* fidelity stops being binary; truth flags join
`secret_truth` in the GM-private data class (grep-clean of player
surfaces).

## D12 — Events repurposed as mostly non-deterministic payoff material
The authored-event system stops being a fire-once trigger library and
becomes source material for payoff moments — but payoffs are, for the
most part, NOT deterministic scripts. When the pacing layer (D15) calls
for a payoff, the content is generated/adjudicated with directives;
authored events serve as seeds and templates, fired verbatim only as the
exception.
*Answers:* G11.

## D13 — The relationship map shows interpretation and hearsay only
The map is a rendering of two things only: what the player *interprets*
(their own readings and sensed impressions) and what they have *heard*
(sourced claims). Every edge carries its provenance. Ground-truth
relationship values never render there — and because heard things can be
lies (D11), the map can be wrong, not merely stale.
*Answers:* G6.

## D14 — Dossiers freeze at acquisition; refreshing costs less
Intel snapshots at the turn it was learned and does not auto-update —
staleness is fog of war. Re-investigating a target you already hold a
dossier on costs less than the first acquisition (an update discount),
so keeping files current is a cheaper, ongoing practice rather than
repeated full price.
*Answers:* G8. *Changes:* dossiers persist in the save (optional field);
the ephemeral component-local intel state is retired.

## D15 — Tension is a soft meter, lightly directing adjudication
A tension value is tracked code-side and fed into the adjudication
process as *light* direction to maintain pace — pacing guidance the
model weighs, not a hard threshold that forcibly detonates content.
(Read of the owner's ruling "love directing" as "light directing" —
flagged for confirmation.) GM console displays the meter (D7); the
player only ever feels it.
*Answers:* G10, softened per D12's non-determinism preference.

## D16 — Slower and better is fine
There is no hard per-turn cost/latency ceiling for Phase 4. Where an
added call or larger context buys a richer simulation (D10), the trade
is accepted. Context compression remains permitted hygiene, not a gate.
*Answers:* G12.

## D17 — Housekeeping happens now
The `App.tsx` state extraction (reducer/context) and save bounding land
at the start of Phase 4, before new systems add state. New persisted
fields stay optional per the save-compatibility invariant.
*Answers:* G13.

## D18 — The eval/tuning export lands now
Raw call capture (prompts and responses, plus per-turn seeds) is
exported from the GM console as files for tuning and evaluation; saves
stay lean (capture is session-side, not part of the persisted save
blob). Golden turns for the judge come from real owner-played sessions.
*Answers:* G2/G3.

---

Rulings D19–D24 are the second Phase 4 round (July 2026), answering the
granular 4B–4D design questions. Two questions from that round remain
open — confidence display (numbers vs in-fiction) and dossier refresh
pricing — tracked in `ROADMAP_PHASE_4.md`. The 4A save-bounding cap
values (40 memories / 20 interactions / 10 snapshots) were ratified in
this round.

## D19 — Planting lies is a player verb, and lies invite counterplay
Planting a false rumor is not NPC-only: the player can do it as an
action. Planted lies — whoever planted them — are game objects others
can act against; spotting, tracing, and refuting them is part of play.
*Extends:* D11 (the engine always knows what is a lie, regardless of
who planted it).

## D20 — Verification can deceive — REVISED BY D26
Original ruling: paying to verify a claim is itself a roll, and a bad
outcome could return a false "confirmed." **D26 revises this:** the
*system* never returns a system-authoritative false confirmation (that
would be the honest window lying). Verification instead returns a
*sourced* result — your spy's confidence, your informant's oath — and the
SOURCE, never the system, may be wrong. The deception is real; it just
always wears a face the player can choose to distrust. See D26.

## D21 — Information is a time-dated, living entity
Every piece of information the player holds is stamped with when it was
learned AND continues to live: as weeks pass, the rumor mill issues
updates that adjust or restate existing claims, and the player sees a
claim's evolution, not just its first arrival. Modeling information as
an entity — a claim with an update timeline — is the sanctioned shape.
Coexists with D14: what you *acquired* stays frozen at its stamp; the
claim it belongs to keeps accreting new sourced updates.
*Changes:* the 4B knowledge store becomes an information-entity store
(claims with update histories), not a flat log.

## D22 — Minds per spotlight character or set; factions may be one mind
One mind per spotlight character, or per set of spotlight characters,
with the door deliberately open to grouping minds for cost. Factions
that plausibly act as a bloc (the Plebs, the Senate, gangs) may be
modeled as a collective NPC with a single group mind.
*Refines:* D10.

## D23 — Pacing is the adjudicator's intentional judgment, not a score
Supersedes D15's mechanism: quiet tolerance is not a number the code
accumulates. The adjudicator itself intelligently tracks pacing and
makes an *intentional choice* to step in, only when it judges it
required — the default posture is non-intervention, because dramatic
circumstance should generate dynamics naturally. "Light directing" is
confirmed as the correct D15 reading. A user-facing configuration
setting makes the pacing posture tunable.
*Supersedes:* D15's code-side meter (the light-touch principle stands).

## D24 — Payoffs prefer a due historical event, else custom
When the adjudicator judges a payoff is warranted, it should prefer a
historical/authored event whose time has plausibly come; otherwise it
crafts a custom crisis.
*Refines:* D12.

---

Rulings D25–D30 are the third Phase 4 round (July 2026): they answer the
remaining 4B/4C questions and reshape the information model. They revise
D11/D20/D21 where noted. The 4D polish items (posture wording, event
text, modal-suppression, the `economic_stability` vocabulary) were left
to implementer judgment — the owner declined to rule, citing unfamiliar
jargon; all remain vetoable later.

## D25 — Confidence is conveyed by source, never a number
No quantitative credibility (no "82%", no percentage, no bar) ever
reaches the player. The ground-truth credibility is recorded in the
backend and GM console only. The player judges how far to trust a
datapoint from its SOURCE(s) — who reported it and how that source frames
its own certainty — and corroborating or conflicting sources are the
signal. A bare number reads as out of character and implies a false
precision the model is not actually computing.
*Answers:* the confidence-display question. ReportsTab and every intel
surface drop the percentage in favor of source framing.

## D26 — The system is an honest window; only the fiction lies
The load-bearing principle behind D25 and the whole verification model.
The player perceives the world through their avatar's viewpoint and acts
on it. NPCs may lie; the player may misread a situation; but the
SIMULATION ITSELF is always an accurate window into the avatar's
situation. Nothing presented in the system's own voice is ever false.
Every uncertain or false datum is attributed to an in-fiction source the
player may choose to distrust — the player, not the system, decides
whether to take what the window shows at face value. A value that looks
system-generated must never be a lie.
*Revises D20:* verification returns a sourced result, never a
system-authoritative false confirmation. *Reinforces D5/D11:* the truth
ledger (backend) is where the system's honesty lives; the player surface
shows only sourced, distrustable framing.

## D27 — Dossier refresh decays with staleness
Refreshing a held dossier costs less than first acquisition, scaled by
how stale the intel is: a recently-refreshed file is cheap to top up, a
long-cold one approaches full price. The chosen decay rate and its
rationale are written into the code comments for later reference. Paid in
the same resource the first investigation used.
*Answers:* the refresh-pricing question.

## D28 — A scheme is perceived as "something afoot"; its nature is earned
Perception (proximity, witnessing) reveals only THAT a character is
plotting — never the scheme's name or nature. The true nature is uncovered
by accumulating clues: a detective-style unraveling of the situation. The
near-term data model is an undiscovered-scheme claim that accretes clues
toward revelation; the fuller clue-driven discovery mini-game is a stated
forward direction, not this round's build.
*Answers:* the scheme-visibility question. Replaces the crude-v1 rule
that leaked a scheme's name to co-located bystanders.

## D29 — Information is a graph, not a list
Rumors and datapoints are many, simultaneous, and interconnected; signals
mix and get misread — which is precisely how rumor becomes confusion.
Information is modeled as a graph: claims, topics, entities, and sources
as nodes; about / corroborates / contradicts / derives-from as edges.
Topic mapping and tagging is the concrete near-term step and the fix for
the over-merging flat-list keying.
*Revises D21:* the living claims become nodes in the graph rather than a
flat keyed list.

## D30 — Minds continuously evolve their own schemes
A spotlight NPC's mind drives the evolution of its `active_scheme` every
turn, because the scheme reflects that character's own interests. The
mind's scheme adjustment takes effect as the character's evolving intent —
applied as that entity's own scheme, not merely a hint the adjudicator
may discard. The adjudicator still owns the *outcomes* of actions in the
shared world; the character's interior plan belongs to its mind.
*Revises:* the earlier hint-only wiring of the mind's `scheme_adjustment`.
