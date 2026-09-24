/**
 * Developer diagnostics and client-to-dev-server log relay.
 *
 * During local development (`import.meta.env.DEV`), errors and failures occurring
 * in the client SPA (AI call failures, unhandled exceptions, unhandled promise rejections,
 * or turn rollbacks) are automatically relayed to the Vite dev server via `POST /__gor_log`.
 *
 * This ensures developers running `npm run dev` in a terminal immediately see clear,
 * actionable diagnostics without having to inspect browser DevTools F12.
 *
 * In production builds or Vitest suites, relaying is disabled.
 */

export interface LogPayload {
  level?: 'error' | 'warn' | 'info';
  tag?: string;
  message: string;
  details?: Record<string, unknown> | string;
  stack?: string;
}

/**
 * Sends a structured log message to the Vite dev server logger endpoint.
 */
export function relayToDevServer(payload: LogPayload): void {
  // Vitest runner guard: never make network calls during test suites
  if (typeof process !== 'undefined' && process.env?.VITEST) {
    return;
  }

  // Browser & dev-mode only
  if (typeof window === 'undefined') return;
  try {
    if (!import.meta.env.DEV) return;
  } catch {
    return;
  }

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/__gor_log', blob);
    } else if (typeof fetch === 'function') {
      fetch('/__gor_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // Dev server may not be listening or may have restarted
      });
    }
  } catch {
    // Non-fatal: dev relay must never crash the app
  }
}

/**
 * Specifically logs AI call failures (model 404, quota 429, schema violations, network drops).
 */
export function logAiFailure(callName: string, model: string, error: unknown): void {
  const errMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[gor:ai] Call '${callName}' (${model}) failed:`, error);

  relayToDevServer({
    level: 'error',
    tag: 'ai-error',
    message: `AI call '${callName}' [model: ${model}] failed: ${errMsg}`,
    details: {
      callName,
      model,
      errorName: error instanceof Error ? error.name : typeof error,
    },
    stack,
  });
}

/**
 * Logs general runtime, turn, or transaction errors.
 */
export function logDevError(tag: string, message: string, error?: unknown): void {
  const errMsg = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[gor:${tag}] ${message}`, error ?? '');

  relayToDevServer({
    level: 'error',
    tag,
    message: errMsg ? `${message}: ${errMsg}` : message,
    stack,
  });
}

let installed = false;

/**
 * Installs global error and unhandled rejection hooks on window.
 */
export function installGlobalDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  try {
    if (!import.meta.env.DEV) return;
  } catch {
    return;
  }
  installed = true;

  window.addEventListener('error', (event) => {
    relayToDevServer({
      level: 'error',
      tag: 'uncaught-error',
      message: event.message || 'Uncaught error in window',
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    relayToDevServer({
      level: 'error',
      tag: 'unhandled-rejection',
      message: `Unhandled promise rejection: ${message}`,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
