import { defineConfig } from 'vitest/config';

/**
 * Dedicated vitest config for the offline eval runner (`npm run eval` ->
 * eval/runEval.eval.ts). Two isolation guarantees, both load-bearing:
 *  - This filename is NOT one vitest auto-detects (vitest.config.* /
 *    vite.config.*), so the default `npm test` run never picks this config
 *    up and stays byte-identical.
 *  - The include glob below (`*.eval.ts`) never overlaps the default
 *    `*.test.ts` glob, so the eval runner can never leak into the normal
 *    suite - and the normal suite never runs under this config.
 * The generous timeout exists for the LLM judge leg, which makes one real
 * model call per corpus turn when an API key is present.
 */
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
