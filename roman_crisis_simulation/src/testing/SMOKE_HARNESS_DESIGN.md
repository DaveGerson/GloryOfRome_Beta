# Journey Smoke Harness — Design

**Status (against current HEAD — Phase-4 pipeline):** runnable, **4 journeys green**.
**Code:** `tests/journeys/` (harness + fixtures + `*.journey.ts` files), `vitest.journeys.config.ts`.
**Run:** `npm run test:journeys` (never part of `npm test` / CI's default run — the default suite stays at 589).

This harness was first prototyped against a PRE-Phase-4 snapshot (no minds, no
truth ledger, no knowledge store, ~201 tests). It has since been **ported and
adapted to the CURRENT pipeline** — `ai/core/turn.ts::runNewTurn` now threads
the D11 truth ledger and the 4C.3 Director intents, runs a per-spotlight
`npc_minds` stage, and draws every hidden die from ONE per-turn seeded
generator; `App.tsx::executeTurn` commits the D21 player knowledge store. All
of that is reflected below.

---

## 1. What this is, and what it is not

The unit suite (`tests/*.test.ts`, 589 tests) proves each mechanism in
isolation. What nothing proved before this harness existed is the thing the
game actually IS: a **loop** — many turns of the REAL `runNewTurn` pipeline,
state threaded turn-over-turn the way `App.tsx` threads it, with the
invariants that only mean anything *across* a playthrough:

- information asymmetry holding for a whole campaign, not one delta;
- deaths only ever sticking via validation + hidden dice;
- a secret survivor staying secret on every player-facing surface for
  multiple turns while the adjudicator is told;
- a save taken mid-campaign resuming into a mechanically identical world;
- the pre-decided-outcome contract (code decides, model narrates) surviving
  the full round trip from dice to prompt to committed state.

A JOURNEY is a scripted user story: a sequence of player intents plus canned,
schema-valid "model" responses and pre-decided d20 results, driven through the
**real** pipeline (`isMockMode: false` always — NOT the `ai/mocks.ts` path)
and asserted mechanic-by-mechanic each turn.

| Layer | What it exercises | Model calls | Speed |
|---|---|---|---|
| Unit suite (`npm test`) | one mechanism at a time | scripted/stubbed | seconds, in CI |
| **Journey harness (`npm run test:journeys`)** | **the whole loop, multi-turn, real pipeline** | **scripted** | **~2s, on demand** |
| Mock mode (`ai/mocks.ts`) | UI plumbing offline | none (bypasses pipeline) | interactive |
| Eval harness (`npm run eval`) | response *quality* with a live model | real | slow, costly |

The journey harness deliberately shares the eval-harness shape (own config,
own file glob, own npm script) so the three sit side by side without any of
them touching `npm test`.

## 2. The seam: a scripted client against the real pipeline

`ScriptedClient` (in `tests/journeys/harness.ts`) is a fake `GoogleGenAI` that
**classifies** every incoming call by its `systemInstruction` text — each
prompt builder in `ai/prompts/*.ts` has distinct, stable role wording. The
harness covers all **twelve** call kinds the current pipeline can make:

`storyRelevance` · `assessment` · **`npcMind`** · `adjudication` ·
`privateConversation` · `mortalityValidation` · `mortalityOutcome` ·
`simulationState` · `monologue` · `narration` · `relationshipUpdates` ·
`investigation` (the between-turns side call).

It **answers from per-kind queues** of canned responses (a two-spotlight turn
queues two `npcMind` decisions), **records every prompt/systemInstruction**,
and **throws on any unscripted call**. Fixtures are plain objects the harness
stringifies; the REAL `generateStructured` then JSON-parses **and
zod-validates** them, so a drifted fixture fails loudly (INV-SCHEMA).

### Dice: the seeded-RNG successor to the roll queue

The prototype spied `Math.random` with a queue of d20 results. The current
pipeline no longer works that way: it draws ONE 32-bit seed per turn
(`ai/core/resolution.ts::generateSeed` — the turn's only `Math.random` call in
a successful run), builds a `mulberry32` generator, and every hidden roll
draws from THAT generator in a fixed order (the resolution-layer action roll
first when consequential, then one mortality roll per **validated** death
claim in delta order). So the harness `findSeedForRolls([...])` searches seed
space for a seed whose generator's first draws are exactly the scripted
sequence, and pins `Math.random` to reproduce it. **INV-ROLL** then asserts
the committed traces (`resolutionTrace` + validated mortality rolls) carry
exactly the scripted rolls — a stronger, more faithful check than the old
"queue emptied" one, and the seam that makes save/reload dice reproducible.

## 3. The runner and the commit contract

`JourneyRunner` owns a `GameThread` seeded from the REAL base scenario
(`constants/baseScenario.ts`: Rome 235 CE, Severus Alexander), deep-cloned per
journey. `runTurn(def)`:

1. fills safe defaults for every unconditional pipeline call the script
   omitted (empty Director output **incl. `spotlight_intents`**,
   non-consequential assessment, no-op adjudication echoing the current turn
   number, echoed simulation state, plain narration with three SUGGESTION
   lines, empty relationship deltas);
2. runs the real `runNewTurn` with `isMockMode: false`, threading the thread's
   `truthLedger` and `npcIntents`;
3. **commits exactly as `App.tsx::executeTurn` does**: week/year advance,
   history entry with `postTurnEntities`, turn increment, the D11 updated
   truth ledger, the 4C.3 updated Director intents, and the D21 knowledge
   store recomputed from the SAME perceived digest via
   `knowledge/commit.ts::computeTurnKnowledge`;
4. computes the player's perceived digest exactly as `App.tsx` does
   (`buildPerceivedDigest` over the committed entry's deltas + post-turn
   entities + new world state);
5. enforces the invariant catalog (§4) and returns a `TurnOutcome`.

`runScriptedInvestigation` drives the real `getInvestigationResult`
(`ai/tools/intelligence.ts`) between turns and ingests the bought reveal into
the knowledge store exactly as `App.tsx::handleInvestigationOutcome` does
(`computeInvestigationKnowledge`).

Save/reload uses the REAL seam: `buildSaveStateFromThread` mirrors
`App.tsx::buildSaveState` field-for-field (including `truthLedger` /
`knowledge` / `npcIntents`), `saveGame`/`loadGame` run against jsdom's
`localStorage`, and `threadFromSave` rebuilds a runnable thread with the same
legacy-slice fallbacks `GAME_LOADED` uses. `equivalenceSnapshot` normalizes
the only nondeterminism (report/ledger ids embed `Date.now`) so a resumed
campaign can be `toEqual`-compared against a never-reloaded control run.

## 4. The invariant catalog (checked automatically, every turn)

| Invariant | What it guards |
|---|---|
| **INV-SHAPE** | `TurnStage` notifications fire once each, in canonical order; the conditional `npc_minds` / `private_conversation` / `mortality` stages fire exactly when their triggers exist; all mandatory stages present |
| **INV-SCHEMA** | every call the pipeline made was captured (`rawCalls` count matches) and every response parsed + zod-validated with zero repair retries |
| **INV-LEAK** (headline) | no GM-private datum reaches a player-facing surface — scanned surfaces: the narration & monologue **prompts and system instructions** (the true enforcement seam), narration/monologue/suggestions text, headlines, the perceived digest, new report claims, **and the committed player knowledge store**. Forbidden data: every `gm_private` note (full string); the `[Mortality]`/`[Resolution]`/`[Secret Meeting]`/`[Narrative Analyst]`/`[Director]`/`[Mind]`/`[Pacing]`/`GM-SECRET` markers; `secret_truth`/`actually_alive` + every secret motive; rumor `is_true`/`origin_id` fields; each mind's `private_reasoning`; every **non-player** entity's scheme name/goal/steps (D28 — the player's OWN scheme is self-knowledge and exempt); invalidated claims' validation reasoning; underscore-bearing band/tier tokens (`presumed_dead`, `survive_with_loss`, `partial_success`, …); and roll mechanics as prose (`/\broll(ed)? \d+/i`) |
| **INV-DIGEST** | every perceived change carries a source attribution (`self`/`witnessed`/`network`/`public`) |
| **INV-ROLL** | the dice the journey scripted are EXACTLY the dice the pipeline made and recorded, in draw order (`resolutionTrace` + validated mortality rolls) |
| **INV-SCRIPT** | every scripted response was requested (no leftover queue entries) |
| **INV-NO-SILENT** | no `console.error` during the turn (`applyDeltas` swallows per-delta failures that way) |

Band/tier tokens without underscores (`dies`, `survive`, `failure`,
`success`) are deliberately NOT scanned — they are legitimate prose words; the
mechanical identifiers all carry underscores.

## 5. The journeys shipped (all GREEN against current HEAD)

| File | Story | Journey-specific guards |
|---|---|---|
| `quietReign.journey.ts` | 3 turns of ordinary governance | treasury/relationship accumulation (directional, engine trust clamp respected); no dice on a non-consequential turn, exactly one on a consequential oration; the pre-decided TIER — not the model — reaches the adjudication prompt and the GM `resolutionTrace`; an off-network senator's finances (and whole scheme) commit as ground truth yet stay invisible in the digest and knowledge store for the whole journey |
| `schemeWar.journey.ts` | player plants a rumor; a spotlight mind evolves its own scheme; the player earns the scheme's nature through paid clues | truth-ledger vs believed-world divergence (rumor lives ONLY as a sub-1.0 source-attributed Report + a GM-only ledger entry; no entity's real resources/status move to match it); single spotlight fires `npc_minds` but NOT the private conversation; the mind evolves its OWN `active_scheme` (D30) which the player perceives only as "something afoot" (D28), never its name/steps; the **clue gate**: proximity awareness never advances the count, ONE paid scheme investigation is insufficient, and the nature is revealed only after `SCHEME_CLUES_TO_REVEAL` (3) paid clues — earned, not dumped; a failed investigation's consequence is code-substituted |
| `saveReload.journey.ts` | 4-turn campaign, autosave after turn 2, reload from real localStorage, play on | lossless envelope round-trip through the real seam (D11 ledger + D21 knowledge + 4C.3 intents survive); a consequential roll AND a planted rumor fall AFTER the save point, so the resumed campaign reproduces the exact hidden dice (seed round-trips) and the exact divergence; `equivalenceSnapshot` equality across entities/world/sim/ledger/knowledge/intents/reports/narrations/headlines after two further full-pipeline turns |
| `mortalityFates.journey.ts` | assassination the player survives, a vetoed hallucinated death, an NPC presumed dead (secretly alive), the player's death | every stuck death = validation + hidden roll; a vetoed claim never touches dice and preserves prior status; veto reasoning stays off every player surface; the 'survive' band needs no outcome call while 'presumed_dead' does; presumed-dead double bookkeeping (public record 'dead' everywhere the player can see; `secret_truth.actually_alive` + motive only on the committed entity, never leaked); player death ⇒ game over (D1) |

### Deferred / not yet covered

- A **presumed-dead NPC's later RETURN** (a `status: 'alive'` revival delta —
  not a death claim, so no mortality pass): the mortality journey stops at the
  presumed-dead beat; the revival leg is a natural extension.
- **Per-mind asymmetry scans** (assert each `npcMind` PROMPT contains only
  what that character plausibly knows): the scripted client already records
  every mind prompt, so this is assertion work, not harness surgery. Today
  the mind asymmetry contract is covered by `tests/npcMinds.test.ts`; the
  journey leak scan targets the player-facing surfaces only.
- A **GM-intervention fallout** end-to-end leg (the `gmIntervention` channel
  is wired through `runTurn` but no shipped journey exercises it yet).

## 6. How to run

```bash
cd roman_crisis_simulation/src
npm run test:journeys                 # all journeys, ~2s, no API key, no network
npx vitest run --config vitest.journeys.config.ts tests/journeys/mortalityFates.journey.ts   # one journey
```

`npm test` is untouched (589): the default include only matches
`*.test.*`/`*.spec.*`, and the journeys config only matches
`tests/journeys/**/*.journey.ts`. Default environment is `node`; the
save/reload journey opts into jsdom per-file with the `@vitest-environment
jsdom` pragma (same pattern as `tests/persistence.test.ts`).

## 7. How to add a journey

1. Create `tests/journeys/<name>.journey.ts`; one `describe`, one `it` per
   playthrough. `new JourneyRunner({ name })` seeds the real base scenario.
2. For each turn `await runner.runTurn({ intent, script, rolls })`:
   - script only what the story is about; defaults cover the rest;
   - build responses with the `fixtures.ts` helpers so they stay schema-valid
     (`scriptAdjudication(turnNumber, …)` MUST echo the current turn number;
     `scriptStoryRelevance` always emits `spotlight_intents`);
   - `rolls`: action roll first (only if you scripted a consequential
     assessment), then one roll per **validated** death claim in delta order.
     `rolls: []` asserts the turn touches no dice — INV-ROLL fails loudly on
     any mismatch;
   - ≥2 spotlight entities ⇒ you MUST script `privateConversation` AND one
     `npcMind` per spotlight (queue an array); 1 spotlight ⇒ one `npcMind`, no
     private conversation; any death delta ⇒ script `mortalityValidation` (and
     `mortalityOutcome` iff a validated claim lands in a band with
     `needsOutcomeContent`).
3. Assert on the returned `TurnOutcome`: committed state via
   `runner.entity()`/`runner.rel()` (directional!), prompts via
   `outcome.client.promptsFor(kind)`, perception via `outcome.digest`, player
   knowledge via `outcome.knowledge`, GM ledger via `outcome.entry`,
   termination via `outcome.gameOver`.
4. The seven catalog invariants run on every turn for free.

Dice/margin cheat-sheet (`ai/core/resolution.ts`): `total = roll + skill +
personality + opposition`, `margin = total − difficulty`; action tiers at `≤
−10 / < 0 / < 5 / < 10 / ≥ 10`. Player death save: 1-5 dies, 6-10
survive_with_loss, 11-17 survive, 18-20 survive_with_boon. NPC fate: 1-12
confirmed_dead, 13-15 gravely_wounded, 16-18 presumed_dead (secretly alive),
19-20 escapes_openly. Investigation difficulty: `12 + (paranoia−5) + (target
intrigue−5) + 2 if risky`, clamped 5–25.

## 8. Findings the harness surfaced against current HEAD

No **new** app-source bug was surfaced by this port: the current pipeline
passes the whole-journey leak scan, the seeded-dice replay, and the
presumed-dead double-bookkeeping guards as-is. Two observations worth an
explicit ruling (behavior PINNED by the journeys, not bugs):

1. **A rumor's `originId` is a bare entity id** — very often the player's own
   — so it is not itself a usable leak token (the player id is all over a
   player-facing prompt legitimately). The GM-only fact is the ASSOCIATION,
   carried by the `origin_id`/`is_true` FIELDS; those field names are the
   enforcement point INV-LEAK scans, and `ai/prompts/narration.ts` strips them
   per-delta. The harness deliberately does NOT forbid the bare id value.
2. **A presumed-dead NPC keeps its `active_scheme` (name + steps)** as GM
   ground truth after "death". The journey forbids those non-player scheme
   strings from every player surface and they never appear — but note the
   scheme is neither cleared nor advanced by the death itself; if a future fix
   clears a presumed-dead entity's scheme, `mortalityFates` will need its
   ground-truth expectation updated.
