# Q3–Q10 Execution Design — three batches by risk

**Provenance:** `roadmaps/TECH_DEBT_QUESTIONNAIRE.md` (Q1/Q2 already executed and merged:
`a966f32`, `9b14094`). Owner approved this design 2026-08-09 after brainstorming: batch
topology (3 by risk), Q4 hook scope (async core only), Q8 policy (probe + auto-apply),
cadence (auto-chain, Fable review gating each merge).

**Pipeline per batch:** isolated worktree off current master → workflow (Sonnet executors,
Opus verification; Opus TDD where new tests lead) → Fable independent review + gate →
`--no-ff` merge → questionnaire ledger update. A batch that fails its gate stays unmerged
in its worktree and is reported, never force-fixed.

All paths below are relative to the npm project root `roman_crisis_simulation/src` unless
they name repo-root files (`roadmaps/`, `.github/`, `docs/`).

## Batch 1 — Tooling & subtraction (Q3, Q5, Q6, Q10)

- **Q3:** delete the zero-consumer design-system primitives `Divider`, `Meter`, `Radio`
  (components/ui modules). Precondition each deletion with a fresh zero-reference grep
  over app + tests. Git history is the archive.
- **Q5:** retire the lint-baseline machinery: delete `tooling/lint-baseline.mjs` and its
  unit test; remove the `test:lint-baseline` script and drop it from the `verify` chain
  in package.json; remove both CI steps from `.github/workflows/ci.yml`; update the B11
  backlog note to record the retirement. `lint` remains plain `eslint .`.
- **Q6:** add the deterministic eval leg to CI (the judge self-skips with no key set).
  Prove locally first: run the eval suite with no judge key and confirm self-skip plus
  exit 0 before writing the CI step.
- **Q10:** gate the `[InitWorld…]`/`[CharCreator…]` `console.log` progress lines in
  `ai/core/initiator.ts` and `ai/tools/characterCreator.ts` behind
  `import.meta.env.DEV`. `console.error` paths stay unconditional.
- **Shape:** two parallel Sonnet executors on disjoint files (src edits vs
  tooling/CI edits), one Opus verifier (scope + full gate + CI-yaml sanity), Fable review.
  No arch phase — the questionnaire rows are the spec.

## Batch 2 — Type-safety (Q7, Q8, Q9)

- **Q7:** refactor the two compiler-unenforced non-null assertions at
  `knowledge/relationships.ts:160,181` into type-safe forms; the five locally-provable
  assertions elsewhere stay. Existing tests are the behavior pin.
- **Q8 (probe + auto-apply):** remove the stale `declare props` workaround in
  `components/ErrorBoundary.tsx` and flip `useDefineForClassFields`; keep whatever the
  full gate proves dead, revert whatever it proves load-bearing. Both outcomes are
  documented in the commit message. The gate is the referee.
- **Q9:** add key-set pin tests for the four high-traffic unpinned Zod↔TS pairs
  (`zRelationship`, `zMemory`, `zScheme`, `zWorldState`) in the same pattern as the
  existing trio pins. A failing pin means live drift: it is reported to Fable as a
  finding, not silently patched.
- **Shape:** Opus writes pins first (they double as the TDD leg), Sonnet executes Q7/Q8,
  Opus verifies semantics + gate, Fable review.

## Batch 3 — The refactor (Q4)

- **`useIntelGathering`, async core only**, co-located with its consumer
  (`components/tabs/`): the hook absorbs `uncoveredIntel`, `loadingState`,
  `requestError`, `mountedRef`, and `handleRequest` from `EntityDetails` in
  `DramatisPersonaeTab.tsx`. Pure derivations (`deriveDossier`, `heldReadingFor`,
  pricing) stay in the component.
- **Contract:** input `{ entity, playerEntity, knowledge, ai, isMockMode,
  interactionLocked, runDomainMutation, onSpendDeepAnalysis, onInvestigationOutcome }`;
  output `{ uncoveredIntel, loadingState, requestError, handleRequest }`. Effective
  behavior at every call site is unchanged.
- **TDD:** Opus writes RED hook tests (new fixture vocabulary from `tests/factories.ts`)
  before the hook file exists; extraction turns them green.
  `tests/dramatisPersonaeIntel.test.ts` stays green untouched as the integration pin.
- **Risk center:** the liveness guard (`mountedRef` + `transaction.isCurrent()`
  composition into `DomainMutationContext`). The Opus verify phase targets it explicitly:
  unmount-mid-request and stale-transaction cases must behave identically pre/post.
- **Cleanup:** strike the completed TODO from README.md in the same commit.

## Out of scope

Everything not named above — no opportunistic refactors, no new dependencies, no config
changes beyond the files each batch names.
