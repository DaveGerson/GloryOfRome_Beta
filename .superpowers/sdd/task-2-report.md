# Task 2 routing fixes - evidence

## Red

`npx vitest run tests/turnSubmission.test.ts tests/turnPipeline.test.ts`
initially failed as intended:

- The new real `runNewTurn` consequential-assessment plus adjudication
  death-claim regression captured `mortalityValidation` and found the full
  canonical `GOR_TURN_SUBMISSION/1` artifact, including the private-intent
  and question sentinels, interpolated through the resolution GM note.
- The new serialization-contract tests failed because the reserved-artifact
  classifier and shared `TurnSubmission | string` normalization helper did
  not exist.

## Green

- Resolution notes now use only `projectForResolution`'s observable attempt;
  the end-to-end regression proves `mortalityValidation` receives that
  attempt and the `[Resolution]` context but never the canonical envelope,
  private intent, or question/context sentinels.
- `turnSubmission.ts` owns and exports reserved-namespace classification,
  canonical runtime-input normalization, and the named adjudication
  projection type. Real and mock turn paths both use the one helper;
  ambition uses the owned classifier; adjudication imports the type only.
- Existing adjudication, narration, and player-monologue projections remain
  unchanged and their focused/full coverage is green.

## Verification

- `npx vitest run tests/turnSubmission.test.ts tests/ambition.test.ts tests/turnPipeline.test.ts tests/mortality.test.ts` - 4 files, 87 tests passed.
- `npm run typecheck` - exit 0.
- `npx eslint ai/core/turn.ts ai/mocks.ts ai/prompts/adjudication.ts ai/tools/ambition.ts playerInput/turnSubmission.ts tests/turnPipeline.test.ts tests/turnSubmission.test.ts --max-warnings 0` - exit 0.
- `npm test` - 39 files, 737 tests passed.
- `git diff --check` - exit 0.
