import { afterEach } from 'vitest';

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

/**
 * The document outlives each test in a file, so page-level state the app
 * paints onto <html> (hooks/useSettings.ts's lighting, hooks/useReadingPrefs.ts's
 * text size and motion) or <head> (the NOX stylesheet link) is reset between
 * tests - one test's lighting or reading scale is never the next one's
 * starting point.
 */
afterEach(() => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.removeAttribute('data-gor-dusk');
  root.removeAttribute('data-gor-reading');
  root.removeAttribute('data-gor-motion');
  document.getElementById('nox-css')?.remove();
});
