# B2 — The intelligence surfaces (rumor feed, relationship map, dossier)

Date: 2026-08-06 · Status: implemented on `feature/b2-intelligence-surfaces`,
awaiting owner review · Author: Fable fork (delegated close-out)

The substrate has been built for two phases (knowledge store D21/D29,
credibility framing D25/D26, `deriveDossier` D14/D27, relationship
observations D13/D42). This pass builds the three player-facing VIEWS that
were the stated payoff, per BACKLOG B2. All three read the knowledge store
and player-visible slices ONLY — no surface receives `truthLedger`,
`gm_private`, `npcIntents`, `secret_truth`, or a raw credibility number.

## Where each surface lives (no new tab; the 7-tab pin stands)

- **Rumor feed** → a third register on the existing Reports tab
  (`ReportsTab` SubRail: By subject · By week · **Rumors**). The tab already
  owns "what you have been told"; the feed is the claim-timeline view of the
  same domain. `ReportsTab` gains a `knowledge: KnowledgeClaim[]` prop.
- **Relationship map** → the 0-byte `components/tabs/RelationshipsTab.tsx`
  is filled and mounted as a second register on the Personae tab
  (`DramatisPersonaeTab` gains a SubRail: **Figures** · Relationships).
  Default register `figures` renders exactly today's content, so every
  existing Personae test passes unedited.
- **Dossier** → inside each Personae entity card: `deriveDossier` output
  renders durably (frozen snapshot text + provenance + staleness stamps)
  where today only a session-local reveal shows. The purchase-moment UX is
  unchanged; what changes is that a held aspect SURVIVES tab switches and
  reloads, as D14 always promised.

## Surface contracts

### Rumor feed (D21, D25/D26)

Claims (report + digest channels; investigation/scheme stay in the dossier)
sorted by latest-update turn, newest first. Each claim card: subject line,
the frozen opening claim, then its full visible timeline — one row per
`KnowledgeUpdate`: week numeral, source lead ("Your scout", "The rumor
mill"…), the update text, and the certainty CLAUSE when the update carries
credibility (never the number; digest rows are binary-fidelity per D5 and
get the lead only). Structural stance/corroboration notes reuse the
existing framing helpers. Zero state (D45): "No word has reached you yet."
naming the cause, with the vellum silhouette idiom.

### Relationship map (D13)

Edge list grouped by unordered participant pair, built ONLY from claims
carrying `relationshipObservation` markers — the D42 declared-participants
contract. Interpretation and hearsay are distinguished by each update's
SOURCE (a turn-witnessed observation reads as your own eyes; a
rumor-sourced one reads as the rumor mill's word), which is exactly D13's
"can be wrong when a source lied": the map inherits the lie with its
provenance attached and never knows better. Every edge row: week numeral
(age), source lead, excerpt/text, and the trusted quote when the marker
carries one. Pairs sorted by most-recent edge. Zero state (D45): "You have
seen no one together, and no one has told you of any bond." Ground truth
(`entity.relationships`) is NEVER read here.

### Dossier (D14/D27, D25)

Per entity card, for each held aspect from `deriveDossier` (beliefs /
secrets; scheme keeps its dedicated section): the frozen `latestText`,
"First learned Week N · as of Week M" (Roman numerals, house style), and
the latest reading's source lead. When `currentTurn - lastRefreshedTurn >
DOSSIER_STALE_AFTER_TURNS = 6` (the D27 cold threshold, reused as wording
only while pricing stays dormant), an italic staleness clause: "The file
has aged; Rome has not stood still." The session-local reveal state stays
for the purchase moment and for deep analysis (not a dossier aspect); the
durable dossier line renders whenever the aspect is held and no fresher
session reveal covers it.

## B8 — proposed ruling (owner veto requested, not settled law)

B8 asked: keep the raw self-read Trust/Respect/Threat numbers, or fold them
into sourced framing? The visual-enhancement pass already REMOVED the
TrustBar meters/signed numbers from Personae, and
`dramatisPersonaeTab.test.tsx` forbids any meter/heat/tier rendering of the
hidden scores from returning under any label. Proposal: RATIFY that state —
the player's own reads surface exclusively through the sourced
relationship-observation timeline (source: what you yourself witnessed),
same framing as everything else on the map; raw ground-truth numbers stay
GM-console-only. This pass implements the ratification by building the map
on observations alone. BACKLOG B8 is updated to record the proposal as
pending owner veto.

## Test plan (red first, house mount idiom)

New `tests/b2IntelligenceSurfaces.test.tsx`: feed register renders
timelines chronologically and source-tagged with zero digits of
credibility anywhere; claims with multiple updates show all rows in turn
order; feed zero state; map groups by pair with provenance + week + quote;
rumor-sourced edge renders the rumor lead (the lie inherits its
provenance); map zero state; Personae register rail defaults to figures
(existing cards) and persists via the tabRegister allowlist; held dossier
aspect renders durably with stamps + source and its staleness clause past
the threshold; no meter/valuenow/progress anywhere on the three surfaces.
Existing suites must pass unedited — the 7-tab tablist pin, Personae card
pins, ReportsTab pins, panelRegisters.

## Open questions for the owner (veto queue)

1. The B8 ratification above.
2. Copy: "Rumors" register label; feed/map zero-state lines; the staleness
   clause; pair header em-dash format ("Aulus — Livia").
3. The feed shows digest-channel claims (things you witnessed) alongside
   reports; if the owner wants pure hearsay, drop `digest` from
   `FEED_CHANNELS` (one-line change, test updates).
4. Staleness threshold reuses D27's dormant 6-turn number as wording only.
