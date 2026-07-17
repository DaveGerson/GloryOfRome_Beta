/**
 * ai/core/geminiService.ts
 *
 * The one chokepoint for every Gemini model call in the app. Before this
 * file existed, ~14 call sites across turn.ts/intelligence.ts/initiator.ts/
 * characterCreator.ts each hardcoded a model id, built their own
 * `ai.models.generateContent` config, and blindly cast the parsed JSON with
 * no runtime validation, no retries, and no record of what was actually
 * sent/received. See ROADMAP_2_AI_ARCHITECTURE.md P0.1 and
 * ROADMAP_6_MAINTAINABILITY.md P0.3.
 *
 * Responsibilities:
 *  - Centralize the model id constants (GEMINI_PRO / GEMINI_FLASH).
 *  - One structured-output entry point (`generateStructured`) and one
 *    plain-prose entry point (`generateText`).
 *  - Jittered exponential backoff on transient failures (429/5xx/network).
 *  - Zod validation with a single automatic repair-retry on schema
 *    violations, so a malformed response doesn't silently corrupt game
 *    state (previously: swallowed `console.error` deep in `applyDeltas`).
 *  - Raw prompt/response capture per call, for the GM screen's raw-JSON
 *    tab and future replay/eval tooling.
 *
 * Deliberately NOT here: `isMockMode` branching. Each call site still
 * checks `isMockMode` and returns its mock before ever reaching this
 * service, exactly as before - the mock swap stays a single seam at the
 * call site, not buried inside the network layer.
 */

import type { ZodType } from 'zod';
import { ApiError } from '@google/genai';
import type { RawCallRecord } from '../../types';
import { parseModelJson } from './json';

/**
 * Centralized model ids. `gemini-3-pro-preview` is a preview id Google can
 * retire at any time; `gemini-2.5-flash` is used for cheap/flavor calls.
 * Previously hardcoded at ~14 call sites (10 for the pro tier alone, per
 * ROADMAP_2_AI_ARCHITECTURE.md's dependency notes) - now a one-line change
 * if either model is retired or swapped.
 */
export const GEMINI_PRO = 'gemini-3-pro-preview';
export const GEMINI_FLASH = 'gemini-2.5-flash';

/**
 * The minimal structural shape this service needs from a Gemini client.
 * Deliberately narrower than the `GoogleGenAI` class (which has private
 * fields and therefore can't be satisfied by a plain object) so that tests
 * can pass a bare `{ models: { generateContent: vi.fn() } }` mock without
 * fighting TypeScript's nominal typing of classes. Any real `GoogleGenAI`
 * instance satisfies this interface structurally.
 */
export interface GeminiClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }) => Promise<{ text?: string }>;
  };
}

/** Loosely-typed thinking config to avoid a hard dependency on the SDK's exact shape here. */
export interface ThinkingConfigLike {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
}

/**
 * Typed error thrown by this service once all recourse (retries, and for
 * generateStructured, the single repair-retry) is exhausted.
 *
 *  - 'transient': a network/429/5xx failure that persisted across all retry
 *     attempts. Callers (e.g. App.tsx) can offer "retry the turn" for these.
 *  - 'fatal': the model responded, but the output could not be parsed as
 *     JSON, or (when a zodSchema was supplied) failed schema validation
 *     even after the repair-retry. Retrying the exact same request is
 *     unlikely to help without a different prompt/approach.
 */
export class AiServiceError extends Error {
  readonly kind: 'transient' | 'fatal';
  readonly callName: string;
  readonly cause?: unknown;

  constructor(kind: 'transient' | 'fatal', callName: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'AiServiceError';
    this.kind = kind;
    this.callName = callName;
    this.cause = cause;
  }
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000; // ~1s / 2s / 4s before jitter
const MAX_RAW_RESPONSE_CHARS = 20_000;

/**
 * Detects whether an error from the network/SDK layer is worth retrying:
 * HTTP 429 (rate limited), any 5xx (server error), or a generic
 * network/fetch failure (no HTTP status at all - the request never
 * reached/returned from the server).
 */
function isTransientError(e: unknown): boolean {
  if (e instanceof ApiError) {
    return e.status === 429 || (e.status >= 500 && e.status < 600);
  }
  // `fetch` throws a bare TypeError on network failure (browser & Node 18+).
  if (e instanceof TypeError) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Exponential backoff (1s/2s/4s for attempts 1/2/3) with +/-30% jitter. */
function jitteredBackoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function truncateForCapture(text: string): string {
  if (text.length <= MAX_RAW_RESPONSE_CHARS) return text;
  return `${text.slice(0, MAX_RAW_RESPONSE_CHARS)}... [truncated, ${text.length} total chars]`;
}

// --- Raw call capture -------------------------------------------------
//
// A turn makes several sequential AI calls (adjudication, narration,
// relationship updates, etc). `beginTurnCapture`/`endTurnCapture` let
// turn.ts bracket the whole pipeline and collect every call made in
// between into one array, without threading a capture parameter through
// every intelligence.ts/turn.ts function signature. Calls made outside a
// begin/end bracket (e.g. DramatisPersonaeTab's ad-hoc investigation
// calls) simply aren't captured - there's no turn to attach them to.

let activeCapture: RawCallRecord[] | null = null;

/** Starts collecting raw call records for the current turn. */
export function beginTurnCapture(): void {
  activeCapture = [];
}

/** Stops collecting and returns everything captured since `beginTurnCapture`. */
export function endTurnCapture(): RawCallRecord[] {
  const records = activeCapture ?? [];
  activeCapture = null;
  return records;
}

function recordCall(record: RawCallRecord): void {
  if (activeCapture) {
    activeCapture.push({ ...record, rawResponse: truncateForCapture(record.rawResponse) });
  }
}

// --- Network layer with retry/backoff ----------------------------------

interface NetworkResult {
  text: string;
  attempts: number;
  latencyMs: number;
}

async function callWithRetry(
  callName: string,
  invoke: () => Promise<{ text?: string }>
): Promise<NetworkResult> {
  const start = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      const response = await invoke();
      return { text: response.text || '', attempts: attempt, latencyMs: Date.now() - start };
    } catch (e) {
      lastError = e;
      if (!isTransientError(e)) {
        throw new AiServiceError(
          'fatal',
          callName,
          `Gemini call '${callName}' failed with a non-transient error: ${e instanceof Error ? e.message : String(e)}`,
          e
        );
      }
      if (attempt >= MAX_ATTEMPTS) {
        throw new AiServiceError(
          'transient',
          callName,
          `Gemini call '${callName}' failed after ${attempt} attempt(s): ${e instanceof Error ? e.message : String(e)}`,
          e
        );
      }
      await sleep(jitteredBackoffMs(attempt));
    }
  }

  // Unreachable (loop always returns or throws), but keeps TS happy.
  throw new AiServiceError('transient', callName, `Gemini call '${callName}' failed unexpectedly`, lastError);
}

// --- Structured (JSON) calls --------------------------------------------

export interface GenerateStructuredRequest<T> {
  callName: string;
  model: string;
  systemInstruction?: string;
  prompt: string;
  responseSchema?: object;
  // `ZodType<T, any, any>`: zod v4 types each concrete schema (ZodObject,
  // ZodArray, ...) with its own `Internals` type parameter, which isn't
  // structurally assignable to the single-type-param `ZodType<T>` shorthand
  // (even for a plain `z.object({...})` with no transforms). Loosening the
  // 2nd/3rd params to `any` is the documented escape hatch for "accept any
  // zod schema that outputs T" without losing `T` itself.
  zodSchema?: ZodType<T, any, any>;
  thinkingConfig?: ThinkingConfigLike;
  temperature?: number;
}

function buildConfig(req: {
  systemInstruction?: string;
  responseSchema?: object;
  thinkingConfig?: ThinkingConfigLike;
  temperature?: number;
  json: boolean;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (req.systemInstruction) config.systemInstruction = req.systemInstruction;
  if (req.json) config.responseMimeType = 'application/json';
  if (req.responseSchema) config.responseSchema = req.responseSchema;
  if (req.thinkingConfig) config.thinkingConfig = req.thinkingConfig;
  if (req.temperature !== undefined) config.temperature = req.temperature;
  return config;
}

/**
 * Formats a zod safeParse failure's issue paths into the repair-suffix
 * wording used to ask the model to correct itself.
 */
function formatRepairSuffix(issuePaths: string[]): string {
  const paths = issuePaths.length > 0 ? issuePaths.join(', ') : '(root)';
  return `\n\nYour previous output violated the schema at ${paths}. Return ONLY corrected valid JSON.`;
}

/**
 * Runs a structured (JSON) Gemini call: sends the prompt, parses the
 * response as JSON via `parseModelJson`, and - if `zodSchema` is supplied -
 * validates the parsed shape. On a JSON-parse failure OR a zod validation
 * failure, retries ONCE with a repair suffix appended to the prompt asking
 * the model to correct itself. If that repair attempt also fails, throws a
 * `fatal` AiServiceError carrying the offending snippet.
 *
 * Each network round-trip (original + repair) is independently retried for
 * transient failures (see `callWithRetry`) and independently captured (see
 * `recordCall`) so both the malformed and corrected responses are visible
 * in the raw-call log.
 */
export async function generateStructured<T>(ai: GeminiClient, req: GenerateStructuredRequest<T>): Promise<T> {
  const { callName, model, zodSchema } = req;
  let currentPrompt = req.prompt;

  for (let repairAttempt = 0; repairAttempt <= 1; repairAttempt++) {
    const config = buildConfig({
      systemInstruction: req.systemInstruction,
      responseSchema: req.responseSchema,
      thinkingConfig: req.thinkingConfig,
      temperature: req.temperature,
      json: true,
    });

    const network = await callWithRetry(callName, () =>
      ai.models.generateContent({ model, contents: currentPrompt, config })
    );

    let parsed: T;
    try {
      parsed = parseModelJson<T>(network.text);
    } catch (e) {
      recordCall({
        callName,
        model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        rawResponse: network.text,
        validated: false,
      });
      if (repairAttempt === 0) {
        const message = e instanceof Error ? e.message : String(e);
        currentPrompt = `${req.prompt}${formatRepairSuffix([`(unparseable JSON: ${message})`])}`;
        continue;
      }
      throw new AiServiceError(
        'fatal',
        callName,
        `Gemini call '${callName}' returned unparseable JSON even after a repair retry: ${e instanceof Error ? e.message : String(e)}`,
        e
      );
    }

    if (!zodSchema) {
      recordCall({
        callName,
        model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        rawResponse: network.text,
        validated: true,
      });
      return parsed;
    }

    const result = zodSchema.safeParse(parsed);
    if (result.success) {
      recordCall({
        callName,
        model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        rawResponse: network.text,
        validated: true,
      });
      return result.data;
    }

    const issuePaths = result.error.issues.map(issue => issue.path.join('.') || '(root)');
    recordCall({
      callName,
      model,
      latencyMs: network.latencyMs,
      attempts: network.attempts,
      promptChars: currentPrompt.length,
      rawResponse: network.text,
      validated: false,
    });

    if (repairAttempt === 0) {
      currentPrompt = `${req.prompt}${formatRepairSuffix(issuePaths)}`;
      continue;
    }

    throw new AiServiceError(
      'fatal',
      callName,
      `Gemini call '${callName}' violated its schema at [${issuePaths.join(', ')}] even after a repair retry. Offending output: ${truncateForCapture(network.text).slice(0, 300)}`,
      result.error
    );
  }

  // Unreachable: the loop above always returns or throws.
  throw new AiServiceError('fatal', callName, `Gemini call '${callName}' failed unexpectedly`);
}

// --- Plain-prose calls ---------------------------------------------------

export interface GenerateTextRequest {
  callName: string;
  model: string;
  systemInstruction?: string;
  prompt: string;
  thinkingConfig?: ThinkingConfigLike;
  temperature?: number;
}

/**
 * Runs a plain-prose Gemini call (narration, monologues, flavor text) - no
 * JSON parsing, no schema. Still goes through the same retry/backoff and
 * raw-call capture as `generateStructured`.
 */
export async function generateText(ai: GeminiClient, req: GenerateTextRequest): Promise<string> {
  const { callName, model } = req;
  const config = buildConfig({
    systemInstruction: req.systemInstruction,
    thinkingConfig: req.thinkingConfig,
    temperature: req.temperature,
    json: false,
  });

  const network = await callWithRetry(callName, () =>
    ai.models.generateContent({ model, contents: req.prompt, config })
  );

  recordCall({
    callName,
    model,
    latencyMs: network.latencyMs,
    attempts: network.attempts,
    promptChars: req.prompt.length,
    rawResponse: network.text,
    validated: true,
  });

  return network.text;
}
