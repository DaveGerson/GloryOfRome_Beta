import { defineConfig } from 'vitest/config';

/**
 * Dedicated vitest config for the journey smoke suite (`npm run
 * test:journeys` -> tests/journeys/**\/*.journey.ts). Mirrors the eval
 * harness's isolation discipline (vitest.eval.config.ts) so the journeys
 * NEVER run under the default `npm test`:
 *  - This filename is NOT one vitest auto-detects (vitest.config.* /
 *    vite.config.*), so the default `npm test` run never picks this config
 *    up and stays byte-identical.
 *  - The include glob below (`*.journey.ts`) never overlaps the default
 *    `*.test.ts` glob, so a journey file can never leak into the normal
 *    suite - and the normal suite never runs under this config.
 * Node is the default environment; the save/reload journey opts into jsdom
 * per-file with the `@vitest-environment jsdom` pragma (same pattern as
 * tests/persistence.test.ts). The generous timeout covers the seed-search
 * the dice-scripting layer performs per turn (tests/journeys/harness.ts).
 */
export default defineConfig({
  test: {
    include: ['tests/journeys/**/*.journey.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
