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
 *  - Centralize the model id constants (GEMINI_PRO / GEMINI_FLASH /
 *    GEMINI_TTS / GEMINI_NARRATION_PREP).
 *  - One structured-output entry point (`generateStructured`), one
 *    plain-prose entry point (`generateText`), and one audio entry point
 *    (`generateSpeech`, the optional narration voice).
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
import { base64ToBytes, concatBytes } from '../../narration/wav';
import { logAiFailure } from '../../diagnostics/logger';

/**
 * Centralized model ids. `gemini-3-pro-preview` is a preview id Google can
 * retire at any time; `gemini-2.5-flash` is used for cheap/flavor calls.
 * Previously hardcoded at ~14 call sites (10 for the pro tier alone, per
 * ROADMAP_2_AI_ARCHITECTURE.md's dependency notes) - now a one-line change
 * if either model is retired or swapped.
 */
export const GEMINI_PRO = 'gemini-3.8-flash';
export const GEMINI_FLASH = 'models/gemini-3.8-flash';
/**
 * GA (non-preview) pro-tier model, used as an automatic fallback if
 * `GEMINI_PRO` (a preview id) is retired out from under us. Google gives no
 * advance notice when a preview id stops resolving - every pro-tier call
 * (adjudication, narration, ...) would otherwise start failing 404 with no
 * code path to recover, bricking the game. See Phase 5.5c. `GEMINI_FLASH` is
 * already GA, so it needs no fallback of its own.
 */
export const GEMINI_PRO_FALLBACK = 'gemini-pro-latest';
/**
 * Text-to-speech tier for the optional "hear it performed" narration voice
 * (narration/, ai/tools/narrationVoice.ts). Audio-only: it is only ever
 * called through `generateSpeech` below, never `generateText`/`generateStructured`.
 */
export const GEMINI_TTS = 'gemini-3.8-flash-tts';
/** The prebuilt voice the narrator performs in: Enceladus, a deep, calm, authoritative senatorial baritone. */
export const DEFAULT_NARRATOR_VOICE = 'Enceladus';
/**
 * The narration voice's intermediary prep model: the narrator that turns
 * one committed narration (or, for the Imperial Dispatch, the tabs' fact
 * summary) into an acted script (for the Dispatch, a plain briefing) before
 * the TTS call
 * (ai/tools/narrationVoice.ts). It tracks the flash tier, run at LOW
 * thinking - a spoken retelling wants a short think, not deep reasoning,
 * so latency stays close to the voice's own. A deployed narrator profile
 * (narration/narrators.ts) may name its own prep model, including a tuned
 * one (`tunedModels/...`).
 */
export const GEMINI_NARRATION_PREP = GEMINI_FLASH;
/** The thinking level the prep model runs at unless a narrator profile says otherwise. */
export const NARRATION_PREP_THINKING_LEVEL = 'low';

/**
 * One inline-data part of a model response, as the SDK's `Part.inlineData`
 * (a `Blob`: base64 `data` plus its `mimeType`). Only `generateSpeech`
 * reads it.
 */
export interface InlineDataPartLike {
  inlineData?: { data?: string; mimeType?: string };
}

/**
 * The slice of a `GenerateContentResponse` this service reads. `candidates`
 * is optional and additive, so every existing plain `{ text }` test mock
 * still satisfies it; a real SDK response satisfies it structurally.
 */
export interface GeminiResponseLike {
  text?: string;
  candidates?: Array<{ content?: { parts?: InlineDataPartLike[] } }>;
}

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
    }) => Promise<GeminiResponseLike>;
    /**
     * Streaming counterpart of `generateContent`, used by `generateTextStream`
     * below. Optional so existing plain-object test mocks (e.g.
     * `{ models: { generateContent: vi.fn() } }`) keep structurally
     * satisfying this interface without also having to stub streaming - any
     * real `GoogleGenAI` instance always has it. Each yielded item's `.text`
     * is that CHUNK's own incremental text (per the SDK: "the response
     * yielded in chunks"), not the cumulative text so far - callers are
     * responsible for accumulating, exactly like `generateTextStream` does.
     */
    generateContentStream?: (params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }) => Promise<AsyncIterable<{ text?: string }>>;
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
 *
 * `message` must never contain raw model output: App.tsx surfaces it
 * verbatim in player-facing chat on a fatal error, and for
 * adjudication-family calls the raw text can carry gm_private material
 * (DESIGN_DECISIONS.md D4/D5). Diagnostic snippets of the offending output
 * go in `debugSnippet` instead.
 */
export class AiServiceError extends Error {
  readonly kind: 'transient' | 'fatal';
  readonly callName: string;
  readonly cause?: unknown;
  /**
   * Truncated snippet of the offending raw model output (or parse-failure
   * detail quoting it), for GM/console-side diagnostics only. Deliberately
   * kept OFF `message` - see the class doc above - so no player-facing
   * surface may ever render this field or fold it into display text.
   */
  readonly debugSnippet?: string;

  constructor(kind: 'transient' | 'fatal', callName: string, message: string, cause?: unknown, debugSnippet?: string) {
    super(message);
    this.name = 'AiServiceError';
    this.kind = kind;
    this.callName = callName;
    this.cause = cause;
    this.debugSnippet = debugSnippet;
  }
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000; // sleeps ~1s then ~2s; the loop throws before a third sleep
const MAX_RAW_RESPONSE_CHARS = 20_000;
/**
 * Cap on captured prompt/system-instruction text per record. Generous on
 * purpose - the capture exists so a call can be replayed/evaluated verbatim,
 * so truncation should only ever fire on a pathological outlier.
 */
export const MAX_CAPTURED_PROMPT_CHARS = 50_000;
/**
 * Bound on the session-wide call log below; oldest records are evicted
 * first. Sized for the 4C pipeline: up to MAX_MINDS_PER_TURN extra
 * flash-tier mind calls per turn churn the log ~25% faster than the
 * pre-minds pipeline did, and the eval-corpus export (D18) rides this log -
 * the window must keep covering a comparable number of turns.
 */
export const MAX_SESSION_CALL_RECORDS = 800;

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

/**
 * Session-wide sticky flag: once a `GEMINI_PRO` call has actually hit the
 * fallback (see `isProUnavailableError`), every later pro-tier call goes
 * straight to `GEMINI_PRO_FALLBACK` without re-attempting the retired
 * preview id first. In-memory only, like `sessionCallLog` - does not
 * survive a reload, and a fresh session always starts by trusting the
 * preview id again.
 */
let proFallbackActive = false;

/** Test-only reset for the sticky pro-fallback flag (see `proFallbackActive`). */
export function resetProFallback(): void {
  proFallbackActive = false;
}

/** Whether the sticky pro-fallback flag is currently set. */
export function isProFallbackActive(): boolean {
  return proFallbackActive;
}

/** Resolves the model id to actually request, honoring the sticky fallback for `GEMINI_PRO`. */
function resolveModel(model: string): string {
  return model === GEMINI_PRO && proFallbackActive ? GEMINI_PRO_FALLBACK : model;
}

/**
 * Detects "this model id no longer resolves" - as opposed to a transient
 * 429/5xx or an unrelated 4xx - so the pro-tier fallback only fires on an
 * actual retirement of the preview id, never on rate limits, server errors,
 * or a genuinely bad request. Per the SDK's `ApiError` shape (status: number,
 * message: string), Google surfaces this either as HTTP 404 or as a message
 * carrying "NOT_FOUND"/"is not found" - checked defensively since neither
 * documents which one it'll be for a retired preview id.
 */
function isProUnavailableError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status === 404) return true;
  return /NOT_FOUND|is not found/i.test(e.message);
}

/** Whether `error` (thrown by `retryTransient` for `resolvedModel`) warrants a one-shot pro-fallback retry. */
function canAttemptProFallback(resolvedModel: string, error: unknown): boolean {
  if (resolvedModel !== GEMINI_PRO) return false; // not the preview id (already on fallback, or a non-pro call)
  const cause = error instanceof AiServiceError ? error.cause : error;
  return isProUnavailableError(cause);
}

/** Wraps a fallback-attempt failure exactly like `retryTransient` would, without re-entering its retry loop. */
function wrapFallbackFailure(callName: string, error: unknown, attempts: number): AiServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (isTransientError(error)) {
    return new AiServiceError(
      'transient',
      callName,
      `Gemini call '${callName}' failed after ${attempts} attempt(s) (including the pro-tier fallback): ${message}`,
      error
    );
  }
  return new AiServiceError(
    'fatal',
    callName,
    `Gemini call '${callName}' failed on the pro-tier fallback model: ${message}`,
    error
  );
}

interface ProFallbackResult<T> {
  value: T;
  attempts: number;
  latencyMs: number;
  model: string;
}

/**
 * Shared by every request path (`generateStructured`, `generateText`, and
 * `generateTextStream`'s stream-acquisition phase): runs `invoke` against
 * the resolved model through the normal transient-retry loop, and - only
 * when the call was against the still-live `GEMINI_PRO` preview id AND the
 * failure is specifically "model not found" - makes exactly ONE additional
 * bare attempt against `GEMINI_PRO_FALLBACK` (no nested retry loop, so a
 * fallback that itself fails can't recurse or loop) before giving up. On
 * that first successful fallback call, sets the sticky flag so every later
 * pro-tier call in the session resolves straight to the fallback.
 *
 * Transient 429/5xx handling for the ORIGINAL model, and any non-model
 * error (400, zod, unparseable JSON - those aren't even seen here, since
 * they only surface after this resolves), are untouched: this only ever
 * intercepts the specific "preview id retired" failure.
 */
async function invokeWithProFallback<T>(
  callName: string,
  model: string,
  invoke: (model: string) => Promise<T>
): Promise<ProFallbackResult<T>> {
  const resolvedModel = resolveModel(model);
  const start = Date.now();
  try {
    const { value, attempts } = await retryTransient(callName, () => invoke(resolvedModel));
    return { value, attempts, latencyMs: Date.now() - start, model: resolvedModel };
  } catch (e) {
    if (!canAttemptProFallback(resolvedModel, e)) {
      logAiFailure(callName, resolvedModel, e);
      throw e;
    }
    proFallbackActive = true;
    try {
      const value = await invoke(GEMINI_PRO_FALLBACK);
      return { value, attempts: 2, latencyMs: Date.now() - start, model: GEMINI_PRO_FALLBACK };
    } catch (fallbackError) {
      const wrapped = wrapFallbackFailure(callName, fallbackError, 2);
      logAiFailure(callName, GEMINI_PRO_FALLBACK, wrapped);
      throw wrapped;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with +/-30% jitter: ~1s for attempt 1, ~2s for attempt
 * 2. The math extends to a 4s attempt-3 leg, but no caller ever reaches it -
 * `retryTransient` throws before a third sleep.
 */
function jitteredBackoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function truncateForCapture(text: string, maxChars: number = MAX_RAW_RESPONSE_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated, ${text.length} total chars]`;
}

// --- Raw call capture -------------------------------------------------
//
// Two channels, both GM-console/eval-side only - captured prompts and
// responses must never reach a player-facing surface (DESIGN_DECISIONS.md
// D4/D5) and must never be written into the persisted save blob (saves stay
// lean per D18; persistence/saveGame.ts strips the text fields on
// serialize):
//
//  - Turn bracket: a turn makes several AI calls (adjudication, simulation
//    state, monologue, narration, etc). `beginTurnCapture`/
//    `endTurnCapture` let turn.ts bracket the whole pipeline and collect
//    every call made in between into one array, without threading a
//    capture parameter through every intelligence.ts/turn.ts function
//    signature.
//  - Session log: EVERY call - bracketed or not (e.g. DramatisPersonaeTab's
//    ad-hoc investigation calls, clarifications, deep analysis, ambition
//    inference, the epilogue) - is also appended to a module-level,
//    session-scoped log bounded at MAX_SESSION_CALL_RECORDS (oldest
//    evicted first). In-memory only; it does not survive a reload.

interface TurnCapture {
  records: RawCallRecord[];
  open: boolean;
}

interface CallLogOwner {
  turnCapture: TurnCapture | null;
  sessionGeneration: number;
}

let activeCapture: TurnCapture | null = null;
let sessionCallLog: RawCallRecord[] = [];
let sessionGeneration = 0;

/** Starts collecting raw call records for the current turn. */
export function beginTurnCapture(): void {
  if (activeCapture) activeCapture.open = false;
  activeCapture = { records: [], open: true };
}

/** Stops collecting and returns everything captured since `beginTurnCapture`. */
export function endTurnCapture(): RawCallRecord[] {
  const capture = activeCapture;
  if (!capture) return [];
  capture.open = false;
  activeCapture = null;
  return capture.records;
}

/** Snapshot (oldest first) of the bounded session-wide call log. */
export function getSessionCallLog(): RawCallRecord[] {
  return [...sessionCallLog];
}

/** Empties the session-wide call log. Does not touch an active turn bracket. */
export function resetSessionCallLog(): void {
  sessionCallLog = [];
  sessionGeneration += 1;
}

function currentCallLogOwner(): CallLogOwner {
  return { turnCapture: activeCapture, sessionGeneration };
}

function recordCall(record: RawCallRecord, owner: CallLogOwner): void {
  const bounded: RawCallRecord = {
    ...record,
    rawResponse: truncateForCapture(record.rawResponse),
  };
  if (bounded.promptText !== undefined) {
    bounded.promptText = truncateForCapture(bounded.promptText, MAX_CAPTURED_PROMPT_CHARS);
  }
  if (bounded.systemInstruction !== undefined) {
    bounded.systemInstruction = truncateForCapture(bounded.systemInstruction, MAX_CAPTURED_PROMPT_CHARS);
  }
  if (owner.sessionGeneration === sessionGeneration) {
    sessionCallLog.push(bounded);
    if (sessionCallLog.length > MAX_SESSION_CALL_RECORDS) {
      sessionCallLog.splice(0, sessionCallLog.length - MAX_SESSION_CALL_RECORDS);
    }
  }
  if (owner.turnCapture?.open && activeCapture === owner.turnCapture) {
    owner.turnCapture.records.push(bounded);
  }
}

// --- Network layer with retry/backoff ----------------------------------

interface NetworkResult {
  text: string;
  attempts: number;
  latencyMs: number;
  /** The model id actually used - may differ from the requested one, see `invokeWithProFallback`. */
  model: string;
}

interface RetryResult<T> {
  value: T;
  attempts: number;
  latencyMs: number;
}

/**
 * Generic transient-retry loop: jittered exponential backoff on a transient
 * failure (see `isTransientError`), immediate `fatal` AiServiceError on
 * anything else, `transient` AiServiceError once `MAX_ATTEMPTS` is
 * exhausted. Shared by `callWithRetry` (plain-text/JSON calls) and
 * `generateTextStream`'s stream-acquisition step below - the two differ
 * only in what `invoke` resolves to (a response object vs. an async
 * generator), not in the retry semantics themselves.
 */
async function retryTransient<T>(callName: string, invoke: () => Promise<T>): Promise<RetryResult<T>> {
  const start = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      const value = await invoke();
      return { value, attempts: attempt, latencyMs: Date.now() - start };
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

/**
 * Phase 2 of both streaming entry points: drains an acquired stream,
 * handing each text-bearing chunk to `onText` (with the cumulative text
 * and the chunk's own text), and returns the full text plus how many
 * text-bearing chunks arrived.
 *
 * ERROR ATTRIBUTION: only a failure of the STREAM itself (the provider/
 * network dropping mid-response) becomes the `transient` AiServiceError the
 * "no mid-stream retry" ruling describes. An exception thrown by the
 * CONSUMER's `onText` - in practice turn.ts's player-visible stream gate
 * refusing a leaked mechanic - is not a provider failure and propagates
 * UNCHANGED, so it is classified exactly as the same gate's verdict on the
 * completed text would be (fatal), never dressed up as a dropped
 * connection the player is invited to retry. Breaking out of the
 * `for await` on such a throw still closes the stream (the iterator's
 * `return()` runs), so nothing keeps downloading behind the failure.
 */
async function consumeStream(
  callName: string,
  stream: AsyncIterable<{ text?: string }>,
  onText: (textSoFar: string, chunkText: string) => void
): Promise<{ text: string; chunks: number }> {
  let textSoFar = '';
  let chunks = 0;
  let consumerFailure: { error: unknown } | null = null;
  try {
    for await (const chunk of stream) {
      if (!chunk.text) continue;
      textSoFar += chunk.text;
      chunks++;
      try {
        onText(textSoFar, chunk.text);
      } catch (e) {
        consumerFailure = { error: e };
        break;
      }
    }
  } catch (e) {
    const streamErr = new AiServiceError(
      'transient',
      callName,
      `Gemini call '${callName}' failed mid-stream: ${e instanceof Error ? e.message : String(e)}`,
      e
    );
    logAiFailure(callName, 'stream', streamErr);
    throw streamErr;
  }
  if (consumerFailure) throw consumerFailure.error;
  return { text: textSoFar, chunks };
}

async function callWithRetry(
  callName: string,
  model: string,
  invoke: (model: string) => Promise<{ text?: string }>
): Promise<NetworkResult> {
  const { value, attempts, latencyMs, model: usedModel } = await invokeWithProFallback(callName, model, invoke);
  return { text: value.text || '', attempts, latencyMs, model: usedModel };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod's concrete Input and Internals vary by schema.
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
  const callLogOwner = currentCallLogOwner();
  let currentPrompt = req.prompt;

  for (let repairAttempt = 0; repairAttempt <= 1; repairAttempt++) {
    const config = buildConfig({
      systemInstruction: req.systemInstruction,
      responseSchema: req.responseSchema,
      thinkingConfig: req.thinkingConfig,
      temperature: req.temperature,
      json: true,
    });

    const network = await callWithRetry(callName, model, (resolvedModel) =>
      ai.models.generateContent({ model: resolvedModel, contents: currentPrompt, config })
    );

    let parsed: T;
    try {
      parsed = parseModelJson<T>(network.text);
    } catch (e) {
      recordCall({
        callName,
        model: network.model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        promptText: currentPrompt,
        systemInstruction: req.systemInstruction,
        rawResponse: network.text,
        validated: false,
      }, callLogOwner);
      if (repairAttempt === 0) {
        const message = e instanceof Error ? e.message : String(e);
        currentPrompt = `${req.prompt}${formatRepairSuffix([`(unparseable JSON: ${message})`])}`;
        continue;
      }
      // The parse error's message quotes the offending model text
      // (ai/core/json.ts::parseModelJson) - console + debugSnippet only,
      // never the thrown message (see AiServiceError's doc).
      const parseDetail = e instanceof Error ? e.message : String(e);
      logAiFailure(callName, network.model, new Error(`Unparseable JSON: ${parseDetail}`));
      console.error(`Gemini call '${callName}' returned unparseable JSON even after a repair retry:`, parseDetail);
      throw new AiServiceError(
        'fatal',
        callName,
        `Gemini call '${callName}' returned unparseable JSON even after a repair retry.`,
        e,
        parseDetail
      );
    }

    if (!zodSchema) {
      recordCall({
        callName,
        model: network.model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        promptText: currentPrompt,
        systemInstruction: req.systemInstruction,
        rawResponse: network.text,
        validated: true,
      }, callLogOwner);
      return parsed;
    }

    const result = zodSchema.safeParse(parsed);
    if (result.success) {
      recordCall({
        callName,
        model: network.model,
        latencyMs: network.latencyMs,
        attempts: network.attempts,
        promptChars: currentPrompt.length,
        promptText: currentPrompt,
        systemInstruction: req.systemInstruction,
        rawResponse: network.text,
        validated: true,
      }, callLogOwner);
      return result.data;
    }

    const issuePaths = result.error.issues.map(issue => issue.path.join('.') || '(root)');
    recordCall({
      callName,
      model: network.model,
      latencyMs: network.latencyMs,
      attempts: network.attempts,
      promptChars: currentPrompt.length,
      promptText: currentPrompt,
      systemInstruction: req.systemInstruction,
      rawResponse: network.text,
      validated: false,
    }, callLogOwner);

    if (repairAttempt === 0) {
      currentPrompt = `${req.prompt}${formatRepairSuffix(issuePaths)}`;
      continue;
    }

    // Schema paths are safe to surface; the raw output itself is console +
    // debugSnippet only, never the thrown message (see AiServiceError's doc).
    const offendingSnippet = truncateForCapture(network.text).slice(0, 300);
    logAiFailure(callName, network.model, new Error(`Schema violation at [${issuePaths.join(', ')}]. Offending snippet: ${offendingSnippet}`));
    console.error(`Gemini call '${callName}' violated its schema at [${issuePaths.join(', ')}] even after a repair retry. Offending output:`, offendingSnippet);
    throw new AiServiceError(
      'fatal',
      callName,
      `Gemini call '${callName}' violated its schema at [${issuePaths.join(', ')}] even after a repair retry.`,
      result.error,
      offendingSnippet
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
  const callLogOwner = currentCallLogOwner();
  const config = buildConfig({
    systemInstruction: req.systemInstruction,
    thinkingConfig: req.thinkingConfig,
    temperature: req.temperature,
    json: false,
  });

  const network = await callWithRetry(callName, model, (resolvedModel) =>
    ai.models.generateContent({ model: resolvedModel, contents: req.prompt, config })
  );

  recordCall({
    callName,
    model: network.model,
    latencyMs: network.latencyMs,
    attempts: network.attempts,
    promptChars: req.prompt.length,
    promptText: req.prompt,
    systemInstruction: req.systemInstruction,
    rawResponse: network.text,
    validated: true,
  }, callLogOwner);

  return network.text;
}

// --- Audio (text-to-speech) calls ----------------------------------------

export interface GenerateSpeechRequest {
  callName: string;
  model: string;
  /** The full TTS prompt: style note plus the performed transcript. */
  prompt: string;
  /** A prebuilt voice name, e.g. `DEFAULT_NARRATOR_VOICE`. */
  voiceName: string;
  temperature?: number;
}

export interface SpeechResult {
  /** Raw PCM, every returned audio part decoded and concatenated in order. */
  pcm: Uint8Array<ArrayBuffer>;
  /** The first audio part's mime type, e.g. `audio/L16;codec=pcm;rate=24000`. */
  mimeType: string;
}

/** What the TTS endpoint reports when a part omits its mime type. */
export const DEFAULT_SPEECH_MIME_TYPE = 'audio/L16;codec=pcm;rate=24000';

/**
 * Runs a text-to-speech call (the optional narration voice; see
 * ai/tools/narrationVoice.ts). Non-streaming `generateContent` in AUDIO
 * modality with a single prebuilt voice, through the same transient
 * retry/backoff as every other call. The response's inline-data parts are
 * base64 PCM; they are decoded and concatenated here and handed back raw -
 * wrapping them in a WAV header is narration/wav.ts's job, not the
 * network layer's.
 *
 * The call log gets a short `[audio: N bytes, mime]` placeholder as its
 * `rawResponse`, never the base64 itself: the session log rides into the
 * GM console and the eval-corpus export (D18), and neither has any use for
 * megabytes of audio.
 *
 * No audio at all in a successful response is a `fatal` AiServiceError -
 * the same request is unlikely to do better on a retry.
 */
export async function generateSpeech(ai: GeminiClient, req: GenerateSpeechRequest): Promise<SpeechResult> {
  const { callName, model } = req;
  const callLogOwner = currentCallLogOwner();
  const config: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceName } } },
  };
  if (req.temperature !== undefined) config.temperature = req.temperature;

  const { value: response, attempts, latencyMs, model: usedModel } = await invokeWithProFallback(callName, model, (resolvedModel) =>
    ai.models.generateContent({ model: resolvedModel, contents: req.prompt, config })
  );

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const chunks: Uint8Array[] = [];
  let mimeType: string | undefined;
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (!data) continue;
    chunks.push(base64ToBytes(data));
    mimeType ??= part.inlineData?.mimeType;
  }
  const pcm = concatBytes(chunks);
  const resolvedMime = mimeType || DEFAULT_SPEECH_MIME_TYPE;

  recordCall({
    callName,
    model: usedModel,
    latencyMs,
    attempts,
    promptChars: req.prompt.length,
    promptText: req.prompt,
    rawResponse: pcm.length > 0 ? `[audio: ${pcm.length} bytes, ${resolvedMime}]` : '[audio: none]',
    validated: pcm.length > 0,
  }, callLogOwner);

  if (pcm.length === 0) {
    throw new AiServiceError('fatal', callName, `Gemini call '${callName}' returned no audio.`);
  }
  return { pcm, mimeType: resolvedMime };
}

/**
 * Streaming counterpart of `generateStructured` (Task 4 of the
 * actors-attribution refactor, task-4-design.md section 1/2 - the narration
 * structured-streaming decision). Same acquisition/consumption split as
 * `generateTextStream` below (jittered-backoff retry while ACQUIRING the
 * stream, no retry once chunks are flowing), but in JSON mode
 * (`responseMimeType: application/json`) and with `onChunk` receiving the
 * CUMULATIVE RAW JSON text rather than decoded prose - callers pull the
 * decoded prose prefix out of it themselves (ai/core/streamSplit.ts's
 * `extractPayloadTextPrefix`).
 *
 * RULING (accepted residual, task-4-design.md "Failure policy"): NO
 * repair-retry on a final parse/zod failure, unlike `generateStructured`.
 * By the time the stream ends, bytes have already been released to the
 * bubble - the existing streaming ruling ("no mid-stream retry; callers
 * already have a retry-the-turn affordance") extends naturally to a
 * malformed final payload. A final parse/zod failure is a `fatal`
 * AiServiceError.
 */
export async function generateStructuredStream<T>(
  ai: GeminiClient,
  req: GenerateStructuredRequest<T>,
  // `chunkText` is just this chunk's own new text (the suffix `rawJsonSoFar`
  // gained), for consumers that keep resumable state instead of rescanning
  // the cumulative text - see streamSplit.ts's `createPayloadTextExtractor`.
  onChunk: (rawJsonSoFar: string, chunkText: string) => void
): Promise<T> {
  const { callName, model, zodSchema } = req;
  const callLogOwner = currentCallLogOwner();
  const streamFn = ai.models.generateContentStream;
  if (!streamFn) {
    throw new AiServiceError(
      'fatal',
      callName,
      `Gemini call '${callName}' requested a streaming response but this client has no generateContentStream implementation.`
    );
  }

  const config = buildConfig({
    systemInstruction: req.systemInstruction,
    responseSchema: req.responseSchema,
    thinkingConfig: req.thinkingConfig,
    temperature: req.temperature,
    json: true,
  });

  const totalStart = Date.now();

  // Phase 1: acquire the stream - identical retry/fallback semantics to
  // generateTextStream's own acquisition phase.
  const { value: stream, attempts, model: usedModel } = await invokeWithProFallback(callName, model, (resolvedModel) =>
    streamFn({ model: resolvedModel, contents: req.prompt, config })
  );

  // Phase 2: consume it. No retry here by design (see doc comment above) -
  // a stream failure at this point is surfaced as transient, since the
  // stream was already successfully acquired (an `onChunk` throw is the
  // consumer's own verdict and propagates unchanged - see consumeStream).
  // `streamChunks` counts text-bearing chunks only - one per chunk actually
  // fed to `onChunk`, so an empty chunk counts for nothing. Round-trip
  // metadata of the same class as `latencyMs`, recorded on every branch
  // below via `baseRecord`.
  const { text: rawSoFar, chunks: streamChunks } = await consumeStream(callName, stream, onChunk);

  const baseRecord = {
    callName,
    model: usedModel,
    latencyMs: Date.now() - totalStart,
    attempts,
    promptChars: req.prompt.length,
    promptText: req.prompt,
    systemInstruction: req.systemInstruction,
    rawResponse: rawSoFar,
    streamChunks,
  };

  let parsed: T;
  try {
    parsed = parseModelJson<T>(rawSoFar);
  } catch (e) {
    recordCall({ ...baseRecord, validated: false }, callLogOwner);
    const parseDetail = e instanceof Error ? e.message : String(e);
    console.error(`Gemini call '${callName}' returned unparseable JSON (streaming - no repair retry):`, parseDetail);
    throw new AiServiceError(
      'fatal',
      callName,
      `Gemini call '${callName}' returned unparseable JSON.`,
      e,
      parseDetail
    );
  }

  if (!zodSchema) {
    recordCall({ ...baseRecord, validated: true }, callLogOwner);
    return parsed;
  }

  const result = zodSchema.safeParse(parsed);
  if (result.success) {
    recordCall({ ...baseRecord, validated: true }, callLogOwner);
    return result.data;
  }

  const issuePaths = result.error.issues.map(issue => issue.path.join('.') || '(root)');
  recordCall({ ...baseRecord, validated: false }, callLogOwner);
  const offendingSnippet = truncateForCapture(rawSoFar).slice(0, 300);
  console.error(`Gemini call '${callName}' violated its schema at [${issuePaths.join(', ')}] (streaming - no repair retry). Offending output:`, offendingSnippet);
  throw new AiServiceError(
    'fatal',
    callName,
    `Gemini call '${callName}' violated its schema at [${issuePaths.join(', ')}].`,
    result.error,
    offendingSnippet
  );
}

/**
 * Streaming counterpart of `generateText` (ROADMAP_0_MASTER_PLAN.md Phase 3
 * item 2 - "the narration call uses generateContentStream; the GM's
 * dispatch types onto the page"). Same call shape (`GenerateTextRequest`),
 * plus an `onChunk` callback invoked with the CUMULATIVE text received so
 * far after every chunk that carries new text.
 *
 * Retry semantics are deliberately asymmetric across the two phases of a
 * streaming call, per ROADMAP_0_MASTER_PLAN.md Phase 3 item 2's spec:
 *
 *  - ACQUIRING the stream (the `generateContentStream` call itself, before
 *    the first chunk has been read) is retried exactly like
 *    `generateText`/`generateStructured` - jittered backoff on a transient
 *    429/5xx/network failure, immediate `fatal` AiServiceError on anything
 *    else, `transient` AiServiceError once `MAX_ATTEMPTS` is exhausted.
 *  - Once chunks have started flowing, a failure mid-stream is surfaced
 *    directly as a `transient` AiServiceError with NO retry - re-issuing a
 *    partially-consumed prompt and somehow resuming mid-narration is not
 *    worth the complexity; callers (App.tsx) already have a uniform
 *    "offer to retry the whole turn" affordance for any transient error.
 *
 * The full concatenated text is what feeds the raw-call capture
 * (`recordCall`), with `attempts` reflecting only the acquisition retries
 * (a successful stream is always consumed in one pass) and `latencyMs`
 * spanning acquisition-through-final-chunk, mirroring `generateText`.
 */
export async function generateTextStream(
  ai: GeminiClient,
  req: GenerateTextRequest,
  onChunk: (textSoFar: string) => void
): Promise<string> {
  const { callName, model } = req;
  const callLogOwner = currentCallLogOwner();
  const streamFn = ai.models.generateContentStream;
  if (!streamFn) {
    throw new AiServiceError(
      'fatal',
      callName,
      `Gemini call '${callName}' requested a streaming response but this client has no generateContentStream implementation.`
    );
  }

  const config = buildConfig({
    systemInstruction: req.systemInstruction,
    thinkingConfig: req.thinkingConfig,
    temperature: req.temperature,
    json: false,
  });

  const totalStart = Date.now();

  // Phase 1: acquire the stream, retrying transient failures exactly like
  // callWithRetry does for a non-streaming call (and, like callWithRetry,
  // eligible for the same one-shot pro-tier fallback - narration runs on
  // GEMINI_PRO and streams when App.tsx opts into onNarrationChunk).
  const { value: stream, attempts, model: usedModel } = await invokeWithProFallback(callName, model, (resolvedModel) =>
    streamFn({ model: resolvedModel, contents: req.prompt, config })
  );

  // Phase 2: consume it. No retry here by design (see doc comment above) -
  // a stream failure at this point (including on the very first chunk) is
  // surfaced as transient, since the stream was already successfully
  // acquired. An `onChunk` throw propagates unchanged (see consumeStream).
  const { text: textSoFar } = await consumeStream(callName, stream, (soFar) => onChunk(soFar));

  recordCall({
    callName,
    model: usedModel,
    latencyMs: Date.now() - totalStart,
    attempts,
    promptChars: req.prompt.length,
    promptText: req.prompt,
    systemInstruction: req.systemInstruction,
    rawResponse: textSoFar,
    validated: true,
  }, callLogOwner);

  return textSoFar;
}
