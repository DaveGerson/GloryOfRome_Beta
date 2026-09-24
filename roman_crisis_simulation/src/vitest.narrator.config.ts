import { defineConfig } from 'vitest/config';

/**
 * Dedicated vitest config for the narrator tuning harness
 * (`npm run narrator:tune` -> narration/tuning/tuneNarrator.tune.ts). Same
 * isolation as vitest.eval.config.ts: a filename vitest never auto-detects,
 * and a `*.tune.ts` glob no other config includes, so the paid,
 * non-deterministic run never leaks into `npm test`, `verify` or CI.
 */
export default defineConfig({
  test: {
    include: ['narration/tuning/**/*.tune.ts'],
    environment: 'node',
    testTimeout: 900_000,
  },
});
