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
