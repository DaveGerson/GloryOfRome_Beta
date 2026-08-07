/**
 * Main-suite baseline: a device key is PRESENT, and it is plainly fake.
 *
 * vite.config.ts used to define-inject the owner's real GEMINI_API_KEY into
 * every Vitest process (Vitest maps `process.env.*` define entries onto the
 * real runtime env), so the whole suite silently ran "with a key". The
 * config now guards that seam with `!process.env.VITEST` — the owner's
 * credential must never reach a test process — and this setup file restores
 * the same key-present baseline hermetically. App.tsx's readDevApiKey reads
 * this at runtime, so key-absence tests (tests/gmScreenSmoke.test.ts) can
 * still delete/restore the variable per test exactly as before.
 */
process.env.API_KEY = 'gor-vitest-fake-key';
process.env.GEMINI_API_KEY = 'gor-vitest-fake-key';
