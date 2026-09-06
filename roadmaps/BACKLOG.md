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

**Resolution (D46, 2026-09-06 — owner veto pending).** The two kinds now
meet at three seams, each of which answers the question above: (a) the
canonical registry (`ai/core/resourceRegistry.ts`) folds every model
spelling onto one key, so a soft resource the world generated is counted
under the same name the hard mechanics read; (b) the exchequer
(`ai/core/exchequer.ts`) states the rate and the friction — coin into
inquiries up to the agents' ceiling, a favour into an inquiry, three
inquiries into a deep analysis, coin into levies that arrive a week late;
(c) the conservation guard (`ai/core/economyGuard.ts`) is the guardrail
against minting — an unsourced windfall, free intel, a reputation leaping by
tens, or unpaid men are clamped to what a week can honestly yield, GM-noted,
never rejected. A new hard mechanic still has to answer the question; now it
answers it by adding a registry kind, an exchequer row, and a guard rule.

---

## Backlog items

### B1 — Currency converter: soft resources → investigations  *(owner-requested; LANDED 2026-09-06 as D46's exchequer — owner veto pending)*
Let the player exchange other currencies they hold — money/denarii, troops,
favors, standing, etc. — into investigation capacity. Investigations are a
hard gating currency but were unit-priced and scarce, with no way to trade a
surplus of one kind for intel. The converter is the T1 interoperability
bridge between the soft resource bag and the hard investigation mechanic.

- **Landed:** the Exchequer register on the Assets tab
  (`ai/core/exchequer.ts`, committed through `App.tsx`'s `handleExchange`).
  Rates, stated with their friction: 1,500 denarii → 1 investigation, bounded
  by the agents-driven ceiling (2 + one per three agents, max 8); 1 favour →
  1 investigation; 3 investigations → 1 deep analysis; 60 denarii a head in
  lots of ten → troops that muster and arrive NEXT week; 90 a head in fives →
  guards at once; 400 → an agent; coin repays debt or back pay at par; an
  estate or ship sells under duress for fifteen weeks of its yield. No
  conversion costs a turn; the levy's week-long delay is the one deliberate
  delay. Standing is NOT convertible — a reputation is spent in play, never
  at a counter.
- **Graded investigation pricing is live (D27):** a first acquisition or a
  cold refresh costs one investigation; a warm refresh is settled in denarii
  along the decay curve (300 rising toward the 1,500 exchequer price), gated
  on the treasury. See D46's flagged deviation from "the SAME resource".
- **Still open:** a broker — whether some conversions should need an NPC
  (tying intel-buying into the relationship system, so who you know gates
  what you can trade). The table is data; a broker would be a gate on a row.

### B2 — Player-facing intelligence VISUAL surfaces  *(LANDED 2026-08-06)*
The substrate was built (knowledge graph D29, sourced-credibility framing
D25/D26, truth ledger, dossiers); the views landed as spec
`docs/superpowers/specs/2026-08-06-b2-intelligence-surfaces-design.md`:
- **Rumor feed** — a third register on the Reports tab: claim timelines,
  chronological, source-tagged via `knowledgeSourceLead`, certainty as
  clause never figure (D21/D25).
- **Relationship map** — `RelationshipsTab` filled (was 0-byte) and mounted
  as a second register on Personae: observation edges grouped by pair with
  provenance + week on every edge; a rumor-sourced edge keeps the rumor's
  voice, so the map is wrong exactly when a source lied (D13/D11).
- **Durable dossier reading** — each Personae card renders `deriveDossier`
  output (frozen snapshot, First learned/as of stamps, source lead, and a
  worded staleness clause past D27's cold threshold) where before only a
  session-local reveal showed.
All three read the knowledge store / player-visible slices only; no truth
flag, gm_private field, ground-truth relationship, or credibility number is
reachable from their props. Copy is veto-queue (registers "Rumors",
zero-state lines, the staleness clause, pair em-dash headers). The feed
includes digest-channel (witnessed) claims alongside reports — drop
`digest` from `isFeedClaim` if pure hearsay is preferred.

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
- One remaining player-text prompt-interpolation gap (D41), found while closing
  out the rest of the sweep: `ai/prompts/intelligence.ts`'s
  `buildClarificationPrompt` `event`/`question` params (currently fed a headline
  and a hardcoded literal by their one call site,
  `components/tabs/CurrentEventsTab.tsx`, so not live today, but the signature
  accepts arbitrary text with no guarantee against a future player-text
  caller). It still interpolates inside a bare `"${value}"` with no
  `asPromptData` escaping. Tracked explicitly (not silently) in
  `tests/promptDataBoundary.test.ts`'s directory-walking guard, which lists
  it under `KNOWN_DEFERRED_GAPS`. (`ai/prompts/characterCreation.ts`'s
  `description` was the other half of this item and is now CLOSED - it was
  live player-typed text on the same CharacterSelection screen as
  worldGen.ts's `playerCharacterDescription`.) Closing the remainder needs the same
  `asPromptData` swap already applied everywhere else.
- `playerBoundary.test.ts` "DECLARED GAP 1" is now CLOSED - a third-person
  pronoun under a second-person possessive (`Your grip weakens because he
  burned the granary.`) no longer needs real antecedent resolution: the
  schema-declared per-field `actors` contract (D42) makes attribution data,
  not inference, so the sentence is a first-class declaration-contract case.
  See `docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md`.
- `playerBoundary.test.ts` possessive passive-agent gap is now CLOSED - `burned
  by my agents` / `burned by your agents` / `sealed by my predecessor` no
  longer depend on widening the passive-agent alias scan (which could never
  admit `my` without over-rejecting third parties merely related to the
  player): the same D42 declared-`actors` contract closes it for all persons
  at once. See
  `docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md`.
- Cross-tab play is last-writer-wins: `persistence/saveGame.ts` uses a
  single `localStorage` slot (`SAVE_KEY = 'gloryOfRome:autosave'`) with no
  `storage`-event or `BroadcastChannel` coordination between tabs. A second
  browser tab starting or loading a campaign can silently clobber the first
  tab's autosave on its next write. Recorded as an accepted risk / single-
  tab-at-a-time assumption, not a bug to fix reactively - no user-visible
  symptom exists until a player actually runs two tabs against the same
  save slot.
- Two optional hardening items from the D42 actors-contract adversarial
  review, neither blocking: (a) `ai/core/streamSplit.ts`'s
  `extractPayloadTextPrefix` re-scans the full cumulative raw JSON from the
  start on every chunk - quadratic in the response length. Measured cost is
  negligible at realistic narration sizes (~3-5ms at a ≤8KB payload) but
  grows to ~267ms at 128KB, so if narration payloads ever grow past typical
  provider caps, an incremental-state extractor (resuming from where the
  last chunk left off instead of re-scanning) would be worth building. (b) A
  provider response with a DUPLICATE top-level `"text"` key could in theory
  let the streamed (incremental) value diverge from the committed (final
  parse) value if the two occurrences disagree - implausible under
  constrained/schema-guided decoding (the whole point of structured-output
  mode), and even if it happened the committed value is still fully gated by
  the declaration/tripwire/mechanics boundary regardless of what streamed
  earlier. Not tracked with a test; noted here so a future maintainer
  doesn't have to rediscover it.

### B7a — Reign-import hardening notes  *(from the 2026-08-05 adversarial merge review)*
The import route ships with the boot-dereferenced fields validated
(`entities` array, `turnNumber` non-negative integer — the latter closing a
`1e999`→`Infinity`→`toRoman` boot hang). Three graded-NOTE residuals were
deliberately not fixed:
- **`entities[].name` non-string** passes the shallow validator, so
  `ImportResult.characterName` can silently violate its `string` type and
  boot's `(characterName || 'R').charAt(0)` crash-loops on such a file.
  Inside the documented hand-edit-parity carve-out; a deeper per-entity
  validator (or a `String(...)` coercion in both derives) closes it.
  **CLOSED 2026-08-05** - both derive sites (`persistence/saveGame.ts`'s
  `importSaveBlob`, `App.tsx`'s `loadSavedGameSummary`) now read
  `typeof name === 'string' ? name : 'Unknown'`, guarding the derive rather
  than widening the shallow validator. See
  `docs/superpowers/specs/2026-08-05-b7a-hardening-and-tablist-design.md` 1a.
- **A poisoned slot has no in-app escape** (pre-existing, structural):
  `ErrorBoundary`'s only affordance reloads into the same slot; nothing
  anywhere clears a slot that crashes render. Any future poisoning bug is
  unrecoverable without devtools. Wants a "begin anew" escape on the
  boundary, independent of import.
  **CLOSED 2026-08-05** - `components/ErrorBoundary.tsx` gained a secondary,
  confirm-gated "Abandon the reign and begin anew" action beside "Restore
  Last Save"; confirming clears the autosave slot and reloads. See the spec
  above, 1b.
- **The D8 ambition fire-and-forget tail** (`useExecuteTurn`'s deferred
  `updateSavedAmbition`) runs outside the domain-mutation lease and is not
  invalidated by an import: in the window between a confirmed mid-campaign
  import and its reload, a landing patch can stamp the OLD campaign's
  `inferredAmbition`/`savedAt` onto the freshly-imported slot. One GM-side
  field, no reign loss; a `campaignGenerationRef` bump on import closes it.
  **CLOSED 2026-08-05** - `App.tsx`'s `handleImportReign` wraps
  `importSaveBlob` and bumps `campaignGenerationRef` on `ok`; both import
  homes (`CharacterSelection`, `SettingsMenu`) now receive the wrapper,
  never the raw function. See the spec above, 1c.
- **Test gap:** the Settings import lock pins the trigger's `disabled`, but
  the Replace confirm's `disabled` (the actual half-commit seam) is
  implemented yet unpinned.
  **CLOSED 2026-08-05** - `tests/reignImportSurfaces.test.tsx`'s Settings
  lock test now stages the Replace confirm under `interactionLocked` and
  asserts `Replace` is `disabled` while `Keep my reign` is not; the
  implementation was already correct. See the spec above, 1d.

### B8 — Raw relationship numbers on the Personae tab  *(proposed ruling — owner veto pending)*
The question this item held ("keep the raw Trust/Respect/Threat
self-numbers, or fold them into sourced framing?") was half-answered in
code before B2 landed: the visual-enhancement pass already REMOVED the
`TrustBar` meters and signed numbers from Personae, and
`dramatisPersonaeTab.test.tsx` forbids any meter/heat/tier rendering of the
hidden scores from returning under any label. **Proposed ruling
(2026-08-06, with B2): ratify that state.** The player's own reads surface
exclusively through the sourced relationship-observation timeline and the
D13 map — "what you yourself witnessed" is just a source like any other —
and raw ground-truth numbers stay GM-console-only. B2's map is built on
observations alone, implementing the proposal. If the owner vetoes and
wants the self-numbers back, that is a revert of the TrustBar removal plus
a carve-out in the Personae player-safety test — nothing in B2 blocks it.

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

### B11 — ESLint warning inventory cleared  *(Phase 6 quality-gate ratchet)*
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

The final 17 warnings were fixed in the Phase 6 quality cleanup: unused catch
bindings and imports were removed, the mixed-mutability engine destructure was
split, the redundant onboarding reset effect was removed, shared UI primitives
now expose native element prop types, and the two test assertions use narrow
structural checks. `tooling/eslint-warning-baseline.json` now has an empty
inventory. `npm run lint` therefore fails loudly for every future ESLint
warning; no B11 warning remains accepted debt.

**Retired 2026-08-09:** the ratchet stayed locked at zero, so the
`tooling/lint-baseline.mjs` wrapper and its `test:lint-baseline` unit test
were retired (Q5); `lint` is now plain `eslint .` in package.json and CI.

### B12 — Task 4b vendor-chunk-split interactive preview smoke  *(RUN & PASSED 2026-08-05)*
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
player, not a subtle or silent gameplay-corruption failure.

**Closed 2026-08-05:** the interactive smoke ran against `npm run preview`
(port 4173) in a real Chrome session: full boot of the multi-chunk build,
character creation (preset destiny), one complete turn against canned
responses (Week I → II, autosave written and re-read), Ctrl+Shift+G → GM
Log → GM console open with all panes rendering — zero console errors or
exceptions across the whole session. The vendor-chunk split is verified
end-to-end in a real browser. One observation, not a defect: CDP screenshot
capture intermittently timed out (>30s) during heavy transitions while
in-page JS stayed instant throughout — an automation-pipeline artifact, and
worth knowing before blaming the app in a future browser pass.

---

## Veto queue (authored content awaiting owner review)
Nothing here blocks; all are one edit from rewording.
- **Voice/epithet lines** for the 9 base-cast entities.
- **Event text** — 3 new (Acclamation on the Rhine, Stirrings in Africa, The
  Donative Comes Due) + 2 reworked (grain shortage, whispers of mutiny).
- **FATES posture wording** — PATIENT / MEASURED / EAGER.
- **D27 decay numbers** (floor 0.2×, cold threshold 6 turns) — LIVE since
  D46 priced an investigation at 1,500 denarii: a warm refresh now costs
  300 rising toward 1,500 denarii. Review together with D46's tuning
  constants (wages, yields, 5% weekly interest, the 10,000 creditors'
  threshold, the guard's 2,000 / half-treasury windfall allowance).
- **D46 ledger and exchequer copy** — every ledger line, report claim,
  exchequer verb/gloss, zero state and the Assets tab's runway sentence are
  authored text; one edit each to reword.

---

## Residuals from the visual-enhancement pass (WP-1…WP-21 + adversarial review)

Nothing here blocks the merge. Each was found, verified, and deliberately not
fixed — with the reason, so the next person can disagree on the evidence
rather than rediscover it.

- **Reign export needs an import route — and only that.** WP-21 shipped
  "Take a copy of the reign" and it was removed, but the reason that survived
  was functional, not privacy: the app had **no import path at all** (no file
  input, no `FileReader`, until the route below landed), so the downloaded
  file could never be loaded back,
  and a recovery affordance that cannot recover is dishonest chrome. The
  owner ruled (2026-08-05) that the blob's GM-side content — `gm_private`,
  `truthLedger`, `npcIntents`, hidden rolls, `secret_truth` — is fine to
  share: a gameplay artifact below the player's line of sight, a spoiler if
  opened but nobody's private data. So no player-safe projection is
  required; build an import route and the raw-blob export can return as an
  ordinary save-to-file feature. See D45 (as amended). **CLOSED 2026-08-05** -
  `persistence/saveGame.ts` grew `importSaveBlob` (one validator shared with
  `loadGame`, so import acceptance and load acceptance can never drift) and
  export returned as `rawSaveBlob`/`downloadTheReign`. Two import homes:
  `components/CharacterSelection.tsx` ("Restore from a copy", both with and
  without a saved reign) and `components/SettingsMenu.tsx` (export +
  import, not DEV-gated); the save-failure notice
  (`components/ui/FailureNotices.tsx`'s `SaveFailureNotice`) regained its
  "Take a copy of the reign" action. See
  `docs/superpowers/specs/2026-08-05-reign-export-import-design.md`.
  One accepted residual from the adversarial merge review: the copy
  affordance gates at RENDER on the same `loadGame()` read as the notice
  copy, but `downloadTheReign` re-reads the slot at CLICK and silently
  no-ops if storage died in between (and its `JSON.parse` of the slot is
  unguarded against an external writer poisoning it in that window). The
  body is the deliberately-verbatim pre-`d8df778` restoration and the
  window is a render-to-click race in an already-broken-storage state;
  left as-is. A hardening pass would surface a notice on a null/unparsable
  click-time read instead of doing nothing.
- **`role="tablist"` is claimed and unkept in two more places.**
  `SidePanel.tsx`'s seven-tab dashboard bar and `GameMasterScreen.tsx`'s
  eleven-tab console bar both declare `role="tablist"`/`role="tab"` with no
  arrow keys, no roving tabindex, no `aria-controls` and no
  `role="tabpanel"`. Pre-existing, not from this pass. Unlike the sub-rails —
  which were converted to `aria-pressed` because they are filters, not tabs —
  **these two genuinely do control a panel**, so the right fix is to complete
  the contract rather than drop the roles. `ui/rovingRadio.ts` has the
  keyboard half already; it needs its selector generalised off `[role="radio"]`.
  **CLOSED 2026-08-05** - both bars now carry the full tabs contract: roving
  tabindex, automatic activation (arrow keys move focus AND selection, Home/
  End, wrap at both ends), one `role="tabpanel"` per bar with matching
  `aria-controls`/`aria-labelledby`. `ui/rovingRadio.ts`'s
  `radioGroupKeyDown` took a `{ role }` option (default `'radio'`), so every
  pre-existing radiogroup call site is untouched. See
  `docs/superpowers/specs/2026-08-05-b7a-hardening-and-tablist-design.md`,
  work item 2.
- **Offline holds the turn, but not the side quests.** The composer now
  refuses to send with the roads shut, on every path. Private-scene invites
  and replies, and the relationship-observation commit, still call the
  provider and fail. Behaviour is degraded-but-honest (an in-fiction notice,
  draft kept), which is why it was left — but it is inconsistent with the
  composer and should converge.
- **`EmptyRegister.action` is built, correct and unused.** WP-20 specified
  exactly one caller — the Reports zero state carrying a Personae row of
  unspent-investigation pips — and that row needs data `ReportsTab` does not
  hold. Kept rather than deleted because it is the only place D45 rule 4 ("at
  most one affordance") is enforced; delete it and the next implementer adds
  a button outside the component, which the rule forbids.
- **"Strike the mould again" has never been seen working by a human.** Mock
  Mode short-circuits before `turnSeed` is generated, so mock turns carry no
  dice and the control correctly never renders. It is reachable only with a
  real API key. Covered by `turnReplay.test.ts` and `gmNarrationPane.test.tsx`
  instead — but a real-key pass should confirm it once.
- **Mock Mode and the GM console ARE reachable in a production build — an
  earlier version of this entry claimed the opposite.** Only `SettingsMenu`'s
  Workshop section is `import.meta.env.DEV`-gated; both capabilities ship
  non-Workshop paths: the no-key gate offers "Play against canned responses"
  (`App.tsx`'s `onEnableMockMode`), and Ctrl+Shift+G enables the GM Log
  button in every build by design (the D7 hotkey effect, `App.tsx`, says so
  in its own comment). Both were exercised live in a `vite preview` build
  during the 2026-08-05 B12 smoke, so a production build CAN be QA'd
  end-to-end with no key and no console access.
- **One unreproduced flake.** `relationshipObservationCommit.test.ts` failed
  once in a full run and never again across 20 solo runs, 24 forks on 12
  cores, deliberate CPU contention and both shuffle modes. Two suspects are
  now ruled out with evidence: the retry budget is a TICK budget (immune to
  load, so raising it would be a placebo), and cross-file leakage is
  impossible under `pool: forks` with `isolate: true`. A trip-wire now
  attaches the app's own failure notice to the assertion error, so the next
  occurrence explains itself instead of being lost as the first one was.
- **`occurrenceSlug` can collide** (`knowledge/store.ts`): 60-char truncation,
  or an all-punctuation headline slugging to `''`, can merge two occurrences'
  findings under one claim key. Cosmetic misfiling, bounded.
- **Two content-box overhangs at desktop.** `.gor-private-scene` and its
  textareas are `width:100%` with padding and border and no `box-sizing`, so
  the textarea overhangs its dialog by 18px at EVERY width inside a container
  with `overflow:auto`. Fixed only inside the narrow-viewport queries, because
  gap H's brief forbade changing desktop. Wants a one-line fix outside any
  query.
- **Gaps C and I remain undrawn** — Consulting the Fates, and the player
  dossier header. Gap H was closed by this pass and is recorded in D45.
