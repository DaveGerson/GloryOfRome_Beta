import { defineConfig, mergeConfig } from 'vitest/config';
import evalConfig from './vitest.eval.config';

/**
 * `npm run eval:ci` - the deterministic, offline eval leg that CI and
 * `npm run verify` both run. Same runner as `npm run eval`
 * (vitest.eval.config.ts), with the env pinned inside the config instead of
 * the shell, so it behaves identically on every platform:
 *  - GOR_EVAL_CORPUS points at the committed fixture corpus, so
 *    eval/harness.ts's offline checks actually execute.
 *  - GEMINI_API_KEY is forced empty, so the paid, non-deterministic LLM
 *    judge self-skips even on a developer machine that has a key exported.
 *    The judged run stays an explicit local `npm run eval`.
 */
export default mergeConfig(
  evalConfig,
  defineConfig({
    test: {
      env: {
        GOR_EVAL_CORPUS: 'eval/fixtures/ci-corpus.json',
        GEMINI_API_KEY: '',
      },
    },
  }),
);
