# Roadmap: Maintainability

## 1. Vision
A codebase where adding a new intrigue mechanic, AI tool, or UI tab is a one-file, one-schema, one-test change — not an archaeology expedition. Types and Gemini schemas flow from a single source, the AI/rules/UI boundaries are clean enough that a contributor can touch narration without fearing state math, and a green CI on every push makes "does it still work?" a settled question rather than a hope.

## 2. Current State
Solid bones, broken safety net. `types.ts` is a well-documented domain source of truth, `ai/core/engine.ts` is pure and testable, and `engine.test.ts` (~25 real cases) is genuinely good. But the one test file **cannot run**: it declares `@vitest-environment jsdom` while `jsdom` is absent from `package.json`, there is no `"test"` script (only `dev`/`build`/`preview`), and `vitest` sits under `dependencies` not `devDependencies`. No CI, no lockfile, no `.gitignore`, `.idea/` is committed, and `tsconfig.json` sets **zero strict flags**. Duplication is systemic: the `gemini-3-pro-preview` model id is hardcoded at **10 call sites** (turn.ts, initiator.ts, intelligence.ts ×5, characterCreator.ts), `cleanJson` is reimplemented 3+ ways, and the Scheme/Relationship JSON schema is hand-copied across `schemas.ts`, `characterCreator.ts`, and `intelligence.ts`. Confirmed correctness bug: `engine.ts:219` does `newStatus.includes('dead')`, so "has died" (d-i-e-d) never matches and the entity stays `alive`. Two tab files (`RelationshipsTab.tsx`, `WorldStateTab.tsx`) are 0 bytes and unwired. Root `README.md` and `DesignDocs/archive/roman-crisis-tech-design.md` document a never-built Python/CLI app — pure drift. `App.tsx` (337 lines, ~20 `useState`) and `DramatisPersonaeTab.tsx` (335 lines, embedded AI calls) are the god-objects the team's own `src/README.md` TODO already names.

## 3. Prioritized Initiatives

### P0 — Do first (restores the safety net; unblocks everything else)

**P0.1 — Make the test suite runnable + wire CI** (S)
- WHY: Right now zero automated verification runs. Every other refactor below is risky until a green bar exists. This is the cheapest highest-leverage fix in the whole report.
- WHAT: Add `jsdom` to `devDependencies`, move `vitest` from `dependencies` → `devDependencies`, add `"test": "vitest run"` and `"typecheck": "tsc --noEmit"` scripts to `src/package.json`. Commit a lockfile. Add `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run test` on push/PR. Confirm the existing `engine.test.ts` goes green.
- Effort: S

**P0.2 — Fix the `status` delta parser + make it a contract** (S)
- WHY: A core state transition silently no-ops on natural AI phrasing ("died"). Characters that should die stay alive — a gameplay-breaking bug hiding in stringly-typed glue.
- WHAT: Replace the `includes('dead')/('exiled')/('missing')` substring branches in `engine.ts:217-234` with a structured `new_status` enum field on the `status` EventDelta (`'dead'|'exiled'|'missing'|'alive'`) plus an optional `new_location`, defined in `types.ts` and mirrored in `schemas.ts`. Update the mock and add unit tests covering each status + the "moves to" location path. Delete freeform reason-string interpretation for control flow (keep `reason` as display text only).
- Effort: S

**P0.3 — AI Service Layer: one Gemini wrapper** (M)
- WHY: The model id lives in 10 places and `cleanJson` in 3 — a model rollback or a retry/error-handling improvement is currently a multi-file hunt. This is the single change that most reduces future friction, and the team already specced it in `src/README.md`.
- WHAT: Create `ai/geminiService.ts` exporting one `generateStructured({ prompt, schema, thinkingConfig })` that centralizes the model constant (`export const GEMINI_MODEL = 'gemini-3-pro-preview'`), the `responseMimeType`/`responseSchema` boilerplate, and ONE canonical `cleanJson` (adopt initiator.ts's 3-step version as the base). Route turn.ts, initiator.ts, intelligence.ts, characterCreator.ts through it. Keep `isMockMode` branching at the service boundary so the mock swap stays a single seam.
- Effort: M

### P1 — High impact next

**P1.1 — Single source of truth for schemas (types → Gemini schema)** (M)
- WHY: Scheme/Relationship/Entity shapes are hand-maintained in 3+ places; renaming a field in `types.ts` raises no error anywhere. This is a recurring silent-drift bug factory.
- WHAT: Adopt `zod` as the source of truth for the AI-boundary types, derive TS types via `z.infer`, and write a small zod→Gemini-`responseSchema` adapter. Start with `Scheme` and `Relationship` (the most-duplicated), collapsing the inline literals in `characterCreator.ts:17-108` and `intelligence.ts:65-95` into `schemas.ts`. Do NOT rewrite all of `types.ts` at once — migrate the AI-boundary types only.
- Effort: M

**P1.2 — Turn on TypeScript strictness + kill the `any` escape hatches** (M)
- WHY: `tsconfig` has no strict flags, and `WorldState`'s `[key: string]: any` (types.ts:142) plus `reportData: any` (intelligence.ts:59) and `(rel as any)[attr]` casts (engine.ts:196-206) mean typos type-check clean. Strictness turns silent runtime failures into compile errors CI catches.
- WHAT: Set `"strict": true`, `"noUncheckedIndexedAccess": true` in `tsconfig.json`. Remove `WorldState`'s index signature and name the real fields. Convert `getInvestigationResult`'s `reportData: any` into a discriminated union (`{ kind: 'thoughts'; data: string[] } | { kind: 'scheme'; data: Scheme }`) so `DramatisPersonaeTab.tsx:70` stops duck-typing with `'overall_goal' in`. Fix fallout incrementally; CI gates it.
- Effort: M

**P1.3 — AI-output contract tests** (M)
- WHY: The turn pipeline, world initiator, and 7 intelligence functions have zero tests. The mock layer already gives deterministic AI output — the perfect fixture source for contract tests that lock the AI→state boundary.
- WHAT: Add `turn.test.ts` and `initiator.test.ts` that run the real orchestration against `ai/mocks.ts` output, asserting: deltas produced are well-formed EventDeltas, JSON-repair fallback in `initiator.ts` recovers from a malformed chunk, and every mock's shape satisfies the (now zod) schema. Add an `events/engine.test.ts` for trigger matching + `PLAYER_CHARACTER` substitution. This is the "meaningful test suite" the mission asks for.
- Effort: M

**P1.4 — Extract `useGameState` + `useIntelligence` hooks** (L)
- WHY: `App.tsx` (337 lines, ~20 `useState`) and `DramatisPersonaeTab.tsx` (embedded AI calls + 4 inline sub-components) are where velocity dies as the game grows. The target design is already written in `src/README.md` TODO — this is execution, not design.
- WHAT: Move App.tsx's turn-execution flow, resource/secret mutators, and event-choice handling into a `useGameState` reducer hook. Pull `DramatisPersonaeTab`'s `handleRequest` (getRawThoughts/getInvestigationResult + resource mutation) into `useIntelligence(targetEntity)`, and split TrustBar/SchemeIntelDisplay/IntelSection/EntityDetails into their own files. Do this AFTER P1.2 so the reducer is strictly typed.
- Effort: L

### P2 — Polish / later

**P2.1 — Docs that match reality** (S): Move root `README.md` + `DesignDocs/roman-crisis-tech-design.md` into `DesignDocs/archive/` with a header banner "SUPERSEDED — historical Python vision, not the shipped app." Promote `roman_crisis_simulation/src/README.md` to canonical; link it from a new short root README.

**P2.2 — Resolve the empty tabs** (S): Either delete `RelationshipsTab.tsx`/`WorldStateTab.tsx` or build the Relationships tab into a real showcase of the relationship graph from `types.ts` (wire it into `SidePanel.tsx:32-39`). Decide before they rot further.

**P2.3 — Lint gate** (S): Add ESLint (or Biome) with `@typescript-eslint`, run it in CI. Only after P1.2 so the two land together.

**P2.4 — Unify the `relation` key format** (S): Migrate the 2-part `entityA:entityB` legacy shape to always-3-part `entityA:entityB:attribute` (engine.ts:174-177), removing the split-length branch. Low urgency — it's tested and works.

**P2.5 — Clean `index.html`** (S): Remove the runtime Tailwind CDN script, the dead `importmap` pinning to aistudiocdn.com, and the broken `/index.css` reference (no such file exists). Vite already bundles everything.

## 4. Quick Wins (< 1 hour each)
- Add `.gitignore` (`node_modules`, `.idea/`, `.env`, `dist`) and `git rm -r --cached .idea/`.
- Add `.env.example` documenting `GEMINI_API_KEY`, plus a one-line README note that the key is inlined into the client bundle at build (`vite.config.ts:6,14-15`) — a security caveat, not just docs.
- Fix the `died`/`dead` bug as a stopgap even before P0.2: add `|| newStatus.includes('died')` (do the proper enum fix in P0.2).
- Move `vitest` to `devDependencies` (part of P0.1 but trivially standalone).
- Delete the two 0-byte tab files if the P2.2 decision is "delete."
- Add `"test"` and `"typecheck"` npm scripts.

## 5. Dependencies & Risks
- **P0.1 unblocks everything.** No refactor (P0.3, P1.x) should merge before CI is green — otherwise the same class of silent breakage recurs.
- **Ordering:** P1.2 (strict) before P1.4 (hooks) so the reducer is typed; P1.1 (zod) before/with P1.3 so contract tests assert against the real schema; P2.3 (lint) rides with P1.2.
- **Cross-domain — AI/Prompts:** P0.2 and P1.1 change the Gemini `responseSchema`, which means prompts must be updated in lockstep. Coordinate with whoever owns the AI-behavior/prompt-quality roadmap; a schema change with a stale prompt produces malformed AI output that the new contract tests will (correctly) reject.
- **Cross-domain — Gameplay/UX:** P2.2's "build the Relationships tab" overlaps the UX/feature roadmap — decide there whether the relationship graph is a planned feature before investing; otherwise just delete the stubs.
- **Cross-domain — Security:** the API-key-in-bundle caveat (Quick Wins) belongs to any Security/Deployment domain; flag it there, don't solve it here.
- **Risk — strict mode blast radius:** turning on `strict` + removing `WorldState`'s `any` index signature may surface a wide error count. Mitigate by enabling flags incrementally (`noImplicitAny` first) rather than all at once, keeping each PR CI-green.
- **Risk — zod adoption:** adds a runtime dependency and a schema-adapter to maintain; keep it scoped to the AI boundary, not the whole domain model, to avoid over-engineering.
