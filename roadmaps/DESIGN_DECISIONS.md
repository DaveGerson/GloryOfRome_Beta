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
player *appears* to be pursuing from their actions. The persisted snapshot is
used only by `GameMasterScreen` for GM inspection and tuning. It never feeds
the player epilogue, NPC reactions, or any other player-facing surface.

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

---

Rulings D31–D34 are the Phase 5 round (July 2026): ship-gate decisions for
a public build, answering the Phase 5 grill (GM-intervention gating, GM
console exposure, and the public key/cost model). D31 amends the Phase 4
out-of-scope list (a settings surface is now sanctioned); D33 refines D7;
D34 supersedes the master plan's Phase 5.1 API-key proxy.

## D31 — A configuration menu is sanctioned
The game gets a user-facing configuration menu. This supersedes the Phase 4
"full settings surface stays out of scope" exclusion (G14). Initial
contents: the D23 pacing posture (already stored device-side in
`persistence/settings.ts`, until now with no UI surfacing it), the GM
intervention toggle (D32), the GM console availability toggle (D33), and
the player's own Gemini API key (D34). Configuration values are
device/browser preferences in the `persistence/settings.ts` /
`persistence/onboarding.ts` mold — never campaign state, never part of the
save blob.

## D32 — GM Intervention stays free, with a configuration toggle
GM Intervention (free-text reality editing) is NOT gated behind a cost —
there is no "Fortuna's Favor" economy for now. It remains free and open,
with a configuration-menu toggle controlling whether it is available
(default: available, preserving current behavior). A costed miracle
mechanic remains open future design — parked in the backlog, not rejected.
*Answers:* the master plan's Phase 5.5 ship decision.

## D33 — GM console availability is a configuration option
The GM console (Ctrl+Shift+G) stays, and whether it is available becomes an
option in the configuration menu (default: available and hidden until
toggled — current behavior). When disabled, the hotkey and the GM LOG
affordance do nothing.
*Refines:* D7 — still never env-gated away; availability is now a
user-visible preference rather than only a hotkey.

## D34 — Bring-your-own-key is the default interaction path
The game is primarily built for the owner's personal use, and the default,
preferred way to run it is with the player's OWN Gemini API key, entered in
the configuration menu and stored device-side (localStorage) — never
bundled into the build, never written to the save blob, never included in
any export or captured call record. This supersedes the Phase 5.1
serverless API-key proxy: there is no server component; the deploy
blocker/billing leak is closed by removing the build-time key injection
from production builds entirely (a dev-mode-only convenience may keep
reading `GEMINI_API_KEY` from `.env` for local development). No public
turn quota is needed — each player pays their own way. An owner-funded
hosted mode (proxy + quota policy + in-fiction limit framing) is parked in
the backlog.

---

Rulings D35–D36 are the Phase 6 player-input and observability round
(July 2026), answering the Phase 6 grill and its first addendum. They refine
D5, D8, D13, D21, and D25 without changing the hidden resolution or
relationship mechanics.

## D35 — Structured input guides one ordinary turn; it does not create a stronger action
Chat remains the default composer. The player may switch to a Structured
composer containing repeatable Actions, repeatable Messages or Orders,
Private Intent, and Question or Context. All populated fields form one
submission and one turn. Actions and orders are attempts, Private Intent is
player-owned context rather than an observable or modifier, and a question
asks the GM to answer from the avatar's present viewpoint without inventing
an investigation or acting for the avatar.

Each Message or Order row selects a recipient from entities the player is
already permitted to know, with a "Someone else..." option for free text.
The selector never receives the hidden roster; custom text does not prove
that its named recipient exists or is reachable. The canonical submission
is compact plaintext stored in the existing `playerIntent` history/save
field, with explicit audience projections before AI use. The complete
artifact is capped at 20,000 characters and is blocked, never truncated,
when over the limit. Save version 1 remains compatible. An exact retry
resends the normalized artifact and may commit the turn only once.

## D36 — The player reads relationships from sourced observations, never engine sentiment
Player-facing Personae surfaces show dated, sourced behavioral evidence and
conservatively attributed direct quotes. They do not show trust or respect
scores, bars, arrows, tiers, heat colors, synthesized relationship labels,
AI-authored "Raw Thoughts," live NPC goals, or live NPC state narratives.
Contradictory observations coexist; the player supplies the interpretation.

An entity that the player has not learned exists is absent from the roster
and recipient selector. Public roles become displayable only after the
entity itself is known. Relationship observations are selected from the
observable submission, the player-specific perception digest, sourced
reports, and paid investigation output. Player-owned narration is not an
evidence source because it may be shaped by Private Intent. Hidden numeric
relationship state and relationship deltas remain available to the engine
and GM console but never select player-facing prose or UI pulses. The MVP
adds no player-authored NPC notes.

---

Rulings D37-D40 are the Phase 6 private-scene and authority-boundary round
(July 2026). They supersede the earlier off-screen NPC-conversation wiring
and narrow D35's original Private Intent projection.

## D37 - Player Private Intent is player-owned, not adjudication evidence
Private Intent may shape only player-owned narration, inner monologue,
suggested actions, the author's collapsed history, and the GM ledger. It
does not enter objective adjudication, world state, NPC minds, relationship
mechanics, apparent ambition, knowledge, perception, or resolution. The
human player supplies the avatar's private interpretation; an omniscient
engine may not turn an unspoken thought into an objective cause.
*Narrows:* D35 and the Phase 6 grill's original adjudicator allowance.

## D38 - The main adjudicator alone owns ordinary-turn relationship consequences
The main adjudicator may emit directional relationship deltas while resolving
the turn's actual outcome. A second post-hoc Relationship Analyst may not infer
and apply another set from the attempted action alone. Player-facing
relationship observations remain a separate, perception-safe evidence
presentation layer and never write hidden numeric state.

## D39 - Private scenes are player-initiated micro-loops between macro turns
A private scene is a synchronous vignette between the human player's avatar
and one AI-controlled character while the macro world is frozen. NPCs never
initiate scenes and never run autonomous NPC-NPC scenes. The player may commit
at most one scene per macro turn, with a target who is known and either
co-located or already connected through the player's network. The invitee may
refuse; a committed refusal consumes the scene and returns an in-character
response. An accepted scene permits at most six NPC responses, may end early,
and closes with an optional one-way player last word that causes no model call.

No individual utterance changes world or relationship state. Closing produces
one compact outcome for the next main adjudication, which alone decides any
consequence.

## D40 - NPC speech, NPC hidden intent, and world truth are separate channels
The player sees the transcript and attributed speech acts. An NPC may lie,
withhold, or manipulate: its statements remain claims unless independently
established by simulation state. The NPC's sincerity, hidden intent, and
planned follow-through are durable GM-private participant memory and may guide
future NPC minds and the main adjudicator, but they are not world truth or an
already-resolved action. The main adjudicator receives a compact partitioned
outcome rather than the full transcript; the full transcript remains available
to the player, participating NPC memory, and GM console. No hidden NPC state is
rendered to the player.

---

## D41 - Player-authored text is delimited as DATA at every prompt boundary
Every prompt interpolation of player-authored free text (the meta-narrative
theme, the initial character concept, chat/structured turn submissions,
private-scene utterances, recent chosen-action intents fed back into later
calls, GM-intervention text, etc.) is passed through `asPromptData`
(`ai/prompts/fragments.ts`) rather than bare string interpolation or bare
`JSON.stringify`. `JSON.stringify` alone escapes quotes, backslashes, and
ordinary newlines, but leaves the JS line-separator characters U+2028/U+2029
unescaped (and, defensively, U+0085 NEL, which Unicode still classifies as a
line break even though JS's own regexes do not treat it as one); both a
model provider's own tokenizer/renderer and this codebase's `^`-anchored
multiline regexes treat an unescaped U+2028/U+2029 as a line break, so
leaving it raw lets player-authored text occupy line-start position inside a
prompt and forge a structural engine block (e.g. a fake "PLAYER ACTION
OUTCOME" or "STORY EVOLUTION SUGGESTIONS" line) that the model may then
follow as if it were the engine's own instruction. `asPromptData` closes
this: it JSON-quotes the value AND escapes U+2028/U+2029/U+0085 to their
`\uXXXX` forms, so the quoted value can never start or span a prompt line
while still round-tripping byte-identical through `JSON.parse`.
*Enforced at:* every prompt builder in `ai/prompts/*.ts` that interpolates
player-authored text - `adjudication.ts`, `privateScene.ts`, `assessment.ts`,
`npcMind.ts`, `noAttemptResponse.ts`, `relationshipObservations.ts`,
`evalJudge.ts`, `worldGen.ts`, `narration.ts`, `epilogue.ts`, `ambition.ts` -
guarded against regression by the directory-walking scan in
`tests/promptDataBoundary.test.ts`. Two further instances of the same
pattern (`ai/prompts/characterCreation.ts`'s `description`,
`ai/prompts/intelligence.ts`'s `event`/`question`) were found but not yet
closed; tracked in `BACKLOG.md` B7.

## D42 - Schema-declared per-field player-action attribution replaces clause-grammar inference
Every prose-bearing field in a provider's structured-output response
(headlines, delta `reason`, entityAction `notes`, narration/monologue text,
the simulation-state crisis line) carries a declared `actors: string[]` - the
entity ids whose ACTIONS the sibling text narrates. Merely mentioning an
entity as an object, victim, or bystander does not make it an actor; an empty
array means pure world/state description. This replaces the ~1,000-line
regex clause-decomposition grammar in `ai/core/playerBoundary.ts`
(subordinate-clause splitting, possessive-phrase classification, anaphora
scopes, passive-agent scanning) that could not close BACKLOG B7's two
prose-attribution gaps ("DECLARED GAP 1" and the possessive passive-agent
gap) without over-rejecting legitimate third-person prose about rivals.

Two enumerated surfaces carry a narrower carve-out. The no-attempt
evidence-selection payload (`ai/core/zodSchemas.ts`'s
`zNoAttemptEvidenceSelection`) carries `actors` per the same schema
convention, but the payload itself is ID-ONLY - `decision` is an enum and
`evidenceIds` merely selects among already-vetted evidence strings, with no
free-prose field of its own - so `ai/core/actorsBoundary.ts`'s
`stripActorsFromNoAttemptEvidenceSelection` strips `actors` unused.
Mortality-authored delta `reason` text is TRIPWIRE-ONLY, not
declaration-gated: `ai/core/mortality.ts` strips `actors` at PARSE time,
before the deltas ever reach the post-mortality `enforceNoAttemptBoundary`
call, so that call is declaration-blind for them and they rely on the flat
tripwire plus the mechanical layer alone - an accepted residual (mortality
outcomes are code-directed, not freely authored) documented in
`docs/superpowers/plans/task-4-design.md`'s "accepted residuals" note.

The no-attempt gate is DECLARATION-PRIMARY, with a FLAT TRIPWIRE as a
lie-catcher: a field whose `actors` names the player is redacted outright
(pure data, the prose itself is never parsed); a field that does NOT declare
the player is still redacted if some sentence opens on a player subject
whose head verb is outside the curated non-action verb lists. Those verb
lists (and the other curated word lists, e.g. the surviving `STATE_ADJECTIVES`
allowlist) remain flat DATA feeding the tripwire (~100 lines total); no
clause-decomposition machinery survives.

**Owner-accepted residual risk:** a field whose `actors` omits the player
while its prose narrates player conduct in a register the flat tripwire
cannot reach (a possessive agent, a passive clause, a mid-sentence subject)
slips past the gate. Bounding fact: the mechanical layer
(`playerOwnsDelta`/`assertNoPlayerRemoval`/entityAction-id identity checks)
still blocks every state effect regardless of the declaration, so a lying
declaration the tripwire misses costs at most one contradictory sentence on
the player-visible surface - an immersion blemish, never corruption,
resource loss, or death.

`actors` is INTERCHANGE-ONLY: `ai/core/actorsBoundary.ts`'s `stripActorsFromX`
helpers strip it at the commit boundary, immediately after the
declaration-aware gate runs and before the value reaches
engine/mortality/history/saves. Persisted shapes (`Adjudication`,
`EventDelta`, `EntityAction`, `SimulationState`, turnHistory, saves) are
unchanged; no save migration is needed.

Narration is ONE `generateContentStream` call in structured JSON mode
(`NarrationPayloadSchema`/`zNarrationPayload`), not a plain-text stream plus a
second attribution call: a pure incremental extractor
(`ai/core/streamSplit.ts`'s `extractPayloadTextPrefix`) decodes the prefix of
the top-level `"text"` value out of the accumulating raw JSON chunk by
chunk, feeding the existing `createNarrationStreamGate` ->
`createPlayerVisibleStreamGate` chain unchanged; the monologue call becomes a
non-streaming structured-output call the same way.

**Modal ruling:** `can`/`could`/`may`/`might`/`must`/`should` clear ANY verb
that follows - a hypothetical or bare capacity is not accomplished conduct
("You could seize the granary" is a suggestion, not conduct). `will`/`would`
are deliberately NOT widened the same way: they clear only the same curated
non-action verb groups the present tense clears, because a bare future verb
still authors player conduct ("You will dispatch spies." still trips) while a
future perception/cognition/feeling/intention still does not.
*Answers:* BACKLOG B7's "DECLARED GAP 1" and possessive passive-agent gap -
both become first-class declaration-contract cases instead of needing real
antecedent resolution. Spec:
`docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md`.
Design record: `docs/superpowers/plans/task-4-design.md`,
`docs/superpowers/plans/task-2-disposition-map.md`.
*Named follow-up (DONE):* `assertNoInventedPlayerAction` and
`assertPlayerVisibleAdjudicationSafe` (`ai/core/playerBoundary.ts`) are
widened to accept the `AdjudicationInterchange | Adjudication` union,
matching `redactInventedPlayerProse`'s existing precedent; the `as
Adjudication` casts at their call sites (`ai/core/turn.ts`'s
`enforceNoAttemptBoundary`, `ai/mocks.ts`'s `gatedAdjudication` gate) are
removed.

## D43 - The configuration menu is the single home for every option
The July 2026 options-consolidation pass (spec:
`docs/superpowers/specs/2026-07-29-ui-options-consolidation-design.md`)
supersedes D31's "Initial contents" list as a ceiling: the configuration
menu is now the SINGLE home for every option, each with a visible
description. The fixed bottom-right chrome (the D23 Fates pacing selector
and the LVX/NOX lighting toggle) is deleted from `App.tsx`; pacing and
lighting live in the menu as described cards. The dev-only Header pills
(Mock Mode, the D7 GM-console runtime switch) move into a dev-build-only
"Developer" card in the same menu; the Header keeps only the world stats
and the single Settings affordance. Ctrl+Shift+G (D33) is unchanged.
Storage contracts are untouched - every option remains a device/browser
preference, never campaign state.
*Supersedes:* D31's "exactly the initial contents" reading. *Refines:* D7
(the discoverable dev backup switch now lives in the Developer card).

## D44 - The visual enhancement pass: one owner per fact, and no number the player must not see
The July 2026 visual enhancement pass (handoff:
`design_handoff_glory_of_rome/README.md`, shipped as fifteen `design(WP-n):`
commits) settles four rules the audit exposed.

**One owner per fact.** No fact is rendered in two tabs. World owns the
week's briefing - macro state, the crisis, and where to look - and nothing
else; Empire owns regions, Events owns occurrences, Reports owns what
sources claim, Chronicle owns what you did, Personae owns who they are,
Assets owns what you hold. `isRegionKnownToPlayer` moves out of
`components/tabs/WorldStateTab.tsx` into `perception/visibility.ts`: a
sight rule belongs to the module that owns perception, not to a view.

**Ceremony is Roman, arithmetic is Arabic.** `toRoman` is reserved for the
week ribbon, the turn count, the Roman date and the epilogue. Prices,
balances and anything the player does arithmetic on are Arabic and tabular;
`toRoman(cost)` is gone from the dossier and must not return.

**A unit belongs to the resource, never to the value.** `ResourcesTab` used
to infer a percent suffix from `!Number.isInteger(value)`, printing 62.5 as
"62.5%" and 80 as "80". Label, unit and register are now declared per
resource in `components/tabs/resourceDescriptors.ts`, and an undeclared
resource is written exactly as stored rather than guessed at.

**No credibility number reaches the player (extends D25/D26).** The
corroboration verdict Reports now shows - "N sources agree" / "Accounts
conflict" - is derived inside `knowledge/credibilityFraming.ts` from D29's
player-safe `stance` and `topic` plus certainty RANK. `credibility` is read
only in that module and never re-emitted, so no player surface can leak the
figure. Crisis volume is graded the same way: from the four closed macro
enums (and an optional model-supplied `crisis_severity` that may only make
the banner LOUDER), never by reading the crisis prose.

*Deferred, deliberately:* the dossier's centre-zero relationship axes
(Trust/Threat/Respect/Dependency are ground truth on
`Entity.relationships`, GM-console-only - the player's relationship
knowledge is sourced prose with no scores), and Empire's province roster
(`WorldState.regions` holds only Rome's locations and `RegionState` has no
scope field, so a province list would mean changing the world model and its
AI contract).
*Refines:* D25/D26 (adds corroboration as a player-safe signal), D5 (the
sight rule's home), D14 (dossier prices in coin, not numerals).

---

## D45 — The failure pass and the five closed gaps (WP-16…WP-21)

The second half of the visual enhancement handoff: the private scene's
doorway and archive, the rite's specimens, Forge a New Destiny, the GM
console's three unbuilt panes, nine zero states, and every way the game can
fail. Five rules came out of it that outlive the pass.

**A failure states three things, or it states nothing.** What happened, in
the world's voice and specific to this failure. What is kept — name the last
safe thing: the draft, the week, the reign. And one thing to press that can
plausibly work. The single sentence this replaced ("The turn could not be
resolved. Your draft has been restored; retry when you are ready.") carried
only the middle clause, and said it identically for four unrelated failures.
The copy lives in `components/ui/FailureNotices.tsx`, never at the call
site, so the kinds cannot drift into four differently-worded versions of
"try again".

**Success is never announced as an error.** `gor-alert` has three tones.
Crimson and bronze keep `role="alert"`; **laurel takes `role="status"`**.
The half-commit line ("the turn was saved, but a follow-up step failed") is
reassurance, and a screen reader announcing it as an error was a defect, not
a styling choice. Corollary for tests: `role="status"` is NOT unique on a
screen — the composer's character count uses it — so a status assertion must
be scoped by what it says, never by counting.

**A failure never takes the room.** Nothing in this pass is modal. The
player's unsent words are the most valuable thing on the screen and stay
visible and editable in every failure state, offline included; while the
roads are shut the tablet still writes and only the send is held.

**A zero state names the cause, not the absence.** "No one has told you
anything yet", never "No data available" — an empty panel is a fact about
the world, not a gap in the software. Each register draws its own silhouette
in blanked vellum at FULL opacity (dimming reads as *disabled*, and nothing
there is disabled — see item 27), carries at most one affordance and only
where that affordance already exists, and a fresh reign gets its own state
rather than the empty one. `components/tabs/EmptyRegister.tsx` owns all nine.

**The save blob is spoiler material, not private material — and the export
was removed because it did not work, not because the blob is secret.**
`TurnHistoryEntry.proseRedactions` carries each removed span verbatim so the
GM console's Narration pane can render the boundary without parsing the
`[Boundary]` sentences back apart, and `persistence/saveGame.ts` drops it on
serialize as it drops captured prompt text. **That strip is not a privacy
boundary and must never be cited as one.** The same spans also reach
`adjudication.gm_private` as `[Boundary] … Removed text: "…"` notes, and that
field is required and persisted; the blob further carries `rawResponse`,
`truthLedger`, `npcIntents`, `npcPrivate`, `mortalityTrace`,
`resolutionTrace`, `turnSeed`, `npcMindResults` and `secret_truth`.

*Owner ruling (2026-08-05):* that content is fine to share. The GM-private
notes are not anyone's private thoughts — they are a gameplay artifact,
material communicated to the AI GM that sits below the player's line of
sight. A player who opens the file spoils their own game, the way a player
who reads the DM's notes behind the screen does; no privacy is breached. An
earlier version of this paragraph classified the blob as a leak and required
a "player-safe projection" before any export could return; that requirement
is void.

WP-21's "Take a copy of the reign" was still rightly removed, on the ground
that survives the reclassification: the app has no import path — no file
input, no `FileReader` — so the downloaded file could never be loaded back,
and a recovery affordance on a save-failure notice that cannot recover
anything is dishonest chrome. **Restoring it needs an import route, nothing
more** — with one, raw-blob export/import becomes an ordinary save-to-file
feature. The lesson generalises unchanged: a strip that removes one of
several copies proves nothing, and a test whose fixture does not mirror
production will happily agree with the code while both are wrong.

A turn restored from disk shows an empty boundary column, and the pane says
so rather than implying nothing was cut.

*Deviation, deliberate:* the design arms the transient retry after 15s and
states that number is a feel question rather than a spec. Not shipped. The
retry affordance is the existing "↻ Retry the last action", which also
serves a failed private scene and a failed observation commit; a second
timed button inside the notice would be two controls doing one job, and the
retry loop has already spent its backoff by the time anyone is told. The
notice carries the evidence instead — three attempts, spaced by the backoff
`retryTransient` actually sleeps. (An earlier draft of this paragraph said
"~7s" and "1s/2s/4s"; both were wrong. The loop throws at
`attempt >= MAX_ATTEMPTS` *before* its third sleep, so only two sleeps ever
occur. State what the code does, not what its constants suggest.)

**Ratified** on the residual review, and now pinned by a test in
`gmScreenSmoke.test.ts`: the arming will not ship. The decisive argument is
not the wait, it is the bypass — after a failure the draft is restored into
the composer and the composer stays enabled (this same decision requires it:
a failure never takes the room), so pressing Send with the restored draft is
the same act as pressing Retry. An armed Retry beside a live Send protects
nothing and merely looks careful, which is the class of dishonest chrome
this pass spent its time removing. Two further reasons: every press
re-enters the same retry budget (three attempts, two backoff sleeps — see
above), so there is no hammering to prevent; and
the single catch derives its kind from `AiServiceError.kind` with no record
of WHICH pipeline step failed, so "arm only for an exhausted turn budget"
cannot be scoped honestly without tagging errors by step. Arming this button
later must now confront the test and this paragraph together.

*Closed on the residual review:* the GM Narration pane's three deferrals.
The monologue is duplicated onto `TurnHistoryEntry.playerMonologue` rather
than read back off `messages`, because that list has no turn attribution and
inferring one from array position is what D44 forbids; it follows
`narration`'s existing precedent for the same duplication, and being
player-visible it is NOT stripped on serialize. The chunk count rides
`RawCallRecord.streamChunks` as `latencyMs`-class metadata. "Replay from the
mould" became buildable by inverting it: `ai/core/turnReplay.ts` re-draws
from the recorded seed and compares against the recorded rolls, which
**proves** the seed plaque's standing claim instead of asserting it — no
turn is re-run, no model is called. A control that verifies is worth
building where a control that merely gestures is not.

*Gap H, since closed:* narrow viewports were undrawn by the handoff and were
later designed rather than transcribed — two width stops in
`design/components.css`, split on whether the desktop layout OVERFLOWS its
container (768px) or is merely cramped (480px). Nothing was invented above
those stops; desktop is byte-identical.

*Still undrawn and uninvented:* handoff gaps **C** Consulting the Fates and
**I** the player dossier header.

*Refines:* D4/D5 (the session-side strip as the GM boundary), D7 (the Fates'
ledger deep-link only where the console is already enabled), D34 (the
keyless notice is device-side and names no key), D44 (ceremony Roman —
"safe up to Week XI" — while the attempt pips stay Arabic).
