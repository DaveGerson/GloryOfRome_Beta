# Tech-Debt Questionnaire — the calls the sweep could not make alone

**Provenance:** 2026-08-07 tech-debt sweep (four parallel explorers over the whole tree).
Everything mechanical the sweep found was fixed and merged in `chore(tech-debt)` (cf0540a).
These nine items survived because each one is a **policy or design call, not a code call**.

**How to use offline:** tick one box per question (add a note under any answer where the
options don't fit). Then hand this file to a session with: *"execute the answered
questionnaire in roadmaps/TECH_DEBT_QUESTIONNAIRE.md"* — each question names exactly
where the work lands, so execution is mechanical once you've ruled.

**2026-08-08 obvious-call pass (per owner request):** Q3–Q10 are pre-answered with the
recommended option — each is cheap, reversible, and gate-refereed, so there was no real
trade-off to weigh.

**2026-08-08 (later): the owner ruled Q1-A and Q2-A; both are EXECUTED and merged**
(Q2 → `a966f32`, Q1 → `9b14094`).

**2026-08-09: Q3–Q10 execution approved as three batches**
(spec: `docs/superpowers/specs/2026-08-09-q3-q10-batches-design.md`).
Batch 1 (Q3, Q5, Q6, Q10) EXECUTED and merged → `37e7dda`. Batch 2 (Q7, Q8, Q9)
EXECUTED and merged → `719976e` (both Q8 probes proved dead; Q9 found no drift).
Batch 3 (Q4) EXECUTED and merged → `73b3b4a`.

**ALL TEN QUESTIONS ARE RULED, EXECUTED, AND MERGED. This file is now a record,
not a work queue.**

---

## Structure

### Q1 — Split `GameMasterScreen.tsx` (1,427 lines)? **[RULED A — executed, merged 9b14094]**

**Owner ruled 2026-08-08:** break apart the monolith with an aggressive TDD plan.
Executed via staged-pipeline workflow (Fable arch → Opus RED tests → Sonnet code
motion → Opus purity audit + gate): shell now 417 lines, 16 views + shared.tsx under
`components/gm/`, 63 new characterization tests, credibility surface-guard tightened.

**Context:** ~17 self-contained `XView` components + the shell share one file. The seam is
clean: every view reads only its own props plus 4 shared display consts (`GOLD`/`DIM`/`lbl`/`well`).
A mechanical split → `components/gm/` (one view per file, `shared.ts` for the consts) cuts the
largest file in the tree to <400 lines with zero behavior risk — at the cost of ~20 new files
and one review-heavy diff.

- [ ] **A — Split fully into `components/gm/`** *(recommended: the seam won't get cleaner than it is today)*
- [ ] **B — Split only the two already-exported, directly-tested views** (`NarrationView`, `FixturesView`)
- [ ] **C — Leave it whole** (one file per screen is a defensible convention)

### Q2 — Consolidate the copy-pasted test fixture factories? **[RULED A — executed, merged a966f32]**

**Owner ruled 2026-08-08:** get a single fixture vocabulary in place. Executed via
staged-pipeline workflow (inventory → Fable arch → Opus TDD → Sonnet migration →
Opus adversarial default-diff + gate): `tests/factories.ts` (21 canonical factories +
43-test pin suite), 34 files migrated, 38 thin wrappers preserve divergent defaults,
zero assertion lines changed, net −533 lines.

**Context:** `makeEntity` is hand-reimplemented in **18** test files (`makePlayer` ×6,
`makeMockAi` ×5, `makeRawCall` ×3, `makeAppSave` ×3). `tests/mockData.ts` exists but exports
no factory; `tests/journeys/` already has the shared-harness precedent. **The risk:** the 18
copies have subtly different defaults — a naive merge silently changes fixture semantics under
passing tests.

- [ ] **A — Consolidate into `tests/factories.ts` via the staged pipeline** (Sonnet migrates per-file, Opus adversarially diffs each fixture's effective defaults before/after) *(recommended)*
- [ ] **B — Consolidate only the byte-identical subset**, leave divergent copies local
- [ ] **C — Accept the duplication** (test-local fixtures are self-documenting)

## Inventory

### Q3 — Dead design-system primitives: `Divider`, `Meter`, `Radio`? **[EXECUTED 37e7dda]**

**Context:** all three are exported from the design-system modules with **zero consumers**
(checked app + tests). Siblings in the same files are live, so these are held inventory from
the claude.ai/design "Glory of Rome Design System" — not an abandoned file. Note the hazard
this already caused: `ResourcesTab` duplicated `Meter` rather than importing it, and the copy
dropped the ARIA contract (fixed in the sweep, but the drift pattern is the argument).

- [x] **A — Delete all three; git history is the archive** *(recommended: unused exports invite exactly the drift we just repaired)*
- [ ] **B — Keep as inventory** for near-future UI work
- [ ] **C — Keep `Meter` only** (most likely to be wanted), delete `Divider`/`Radio`

### Q4 — The README's live TODO: extract `DramatisPersonaeTab`'s intel logic into a hook? **[EXECUTED 73b3b4a — useIntelGathering, TDD-first]**

**Context:** README.md's TODO section has one item left and it is still accurate —
`uncoveredIntel`/`loadingState` and the intelligence-gathering flow live inline in the
component. It's a real refactor (state + async + cancellation), not a rename.

- [x] **A — Schedule it** as the next maintenance-window item (a `useIntelGathering` hook) *(recommended)*
- [ ] **B — Keep the TODO standing** (accurate, not urgent)
- [ ] **C — Strike it** (won't-do; the inline form is acceptable)

## Tooling policy

### Q5 — Retire the lint-baseline machinery now that the ratchet is locked? **[EXECUTED 37e7dda]**

**Context:** all six formerly-`warn` rules are now `error` and the baseline manifest is empty,
so the ~150-line wrapper (`tooling/lint-baseline.mjs`), its unit test, and two CI steps now
tolerate a class of debt that can no longer exist. The sweep kept it as an escape hatch; that
was the conservative call, yours to overrule.

- [x] **A — Delete it:** `lint` becomes plain `eslint .`, drop `test:lint-baseline` + both CI steps + the B11 note *(recommended: its reason-to-exist is gone; git can resurrect it)*
- [ ] **B — Keep it** as the documented escape hatch for the next deliberate exception

### Q6 — CI has no eval leg — leave it that way? **[EXECUTED 37e7dda — deterministic leg added]**

**Context:** `npm run eval` is excluded from CI (now documented in ci.yml: real model calls,
paid, non-deterministic). The deterministic *half* of the eval harness, though, could run in
CI against fixtures with the judge skipped — it already skips itself when no key is set.

- [x] **A — Add the deterministic eval leg to CI** (judge auto-skips; catches harness rot) *(recommended)*
- [ ] **B — Keep eval fully local** (CI stays cheap and byte-identical to today)

## Type safety

### Q7 — The seven compiler-unenforced non-null assertions? **[EXECUTED 719976e]**

**Context:** `knowledge/relationships.ts:160,181`, `ai/core/mortality.ts:263,334-335`,
`ai/prompts/fragments.ts:257`. All provably safe **today** via upstream filters — but the
invariant lives in reading the logic, not in the types; a future refactor can silently
reintroduce an `undefined` crash. The two in `relationships.ts` sit farthest from their
guards; the other five are locally obvious.

- [x] **A — Refactor the two in `relationships.ts`, leave the five locally-provable ones** *(recommended)*
- [ ] **B — Refactor all seven**
- [ ] **C — Leave all** (the assertions are commented and reviewed)

### Q8 — Probe the stale `ErrorBoundary` workaround? **[EXECUTED 719976e — both probes dead, removed]**

**Context:** `components/ErrorBoundary.tsx:51-58` justifies a `declare props` workaround with
"no `@types/react` in this project" — false since commit 4ecc2d1 (2026-07-23) added the types.
tsconfig's `useDefineForClassFields: false` leans on the same era. A cheap probe (remove
workaround, flip flag, typecheck + suite) settles whether either is still load-bearing.

- [x] **A — Probe and remove whatever proves dead** *(recommended: ten-minute experiment, full gate as referee)*
- [ ] **B — Leave both** (working code, low traffic)

### Q9 — Drift protection for the ~15 unpinned Zod↔TS schema pairs? **[EXECUTED 719976e — no drift found]**

**Context:** the three hand-maintained *trios* (Entity, NpcMindDecision, EvalJudgeVerdict) now
all have lockstep pin tests. But ~15 non-Interchange Zod schemas (`zRelationship`, `zMemory`,
`zScheme`, `zWorldState`, …) validate hand-written `types.ts` interfaces with **no** `z.infer`
bridge and **no** pin — nobody gets a compile error if one silently diverges. Migrating to
`z.infer` would fight the codebase's documented nullable-vs-optional boundary design; pins
don't.

- [x] **A — Add key-set pin tests for the high-traffic pairs** (Relationship, Memory, Scheme, WorldState) *(recommended: same cheap pattern as the trio pins)*
- [ ] **B — Migrate selected schemas to `z.infer` as source of truth** (bigger, fights the boundary design)
- [ ] **C — Accept the risk** (the schemas move rarely)

## Hygiene (footnote-tier)

### Q10 — Ungated `console.log` in `ai/core/initiator.ts` / `ai/tools/characterCreator.ts`? **[EXECUTED 37e7dda]**

**Context:** `[InitWorld…]`/`[CharCreator…]` progress logs run unconditionally in production
paths (unlike the intentionally-loud mocks/eval logs).

- [x] **A — Gate behind `import.meta.env.DEV`** *(recommended: keeps the telemetry, silences prod)*
- [ ] **B — Remove them**
- [ ] **C — Leave them** (world-gen is rare and the logs are useful)
