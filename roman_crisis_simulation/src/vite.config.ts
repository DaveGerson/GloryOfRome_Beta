import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // DESIGN_DECISIONS.md D34 - bring-your-own-key is the default path;
      // no server component, no build-time key injection into a
      // production bundle (that was the deploy blocker/billing leak this
      // ruling closes). `command === 'serve'` is true only for the local
      // dev server, never for `vite build` - so this convenience (reading
      // GEMINI_API_KEY from .env for the owner's own local play) never
      // reaches shipped output. App.tsx's dev-only read of this seam is
      // itself guarded by `import.meta.env.DEV` so a prod build never even
      // evaluates a `process` reference.
      define: command === 'serve' ? {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      } : {},
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // Task 4b (bundle-triage.md, FIX_NOW_DEFECT): split slow-changing
      // node_modules code into stable, package-keyed vendor chunks so a
      // first-party code deploy doesn't invalidate the vendor cache for
      // returning players. Build-output shaping only; no import, lazy-load,
      // or runtime behavior change.
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('node_modules/react-dom')) {
                  return 'vendor-react-dom';
                }
                if (id.includes('node_modules/react')) {
                  return 'vendor-react';
                }
                if (id.includes('node_modules/@google/genai')) {
                  return 'vendor-genai';
                }
                return 'vendor-other';
              }
            },
          },
        },
      },
    };
});
