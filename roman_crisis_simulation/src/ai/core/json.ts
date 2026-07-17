/**
 * Shared JSON cleaning/parsing helpers for raw Gemini model output.
 *
 * Before this file existed, `cleanJson` was reimplemented 3+ times
 * (turn.ts, initiator.ts, intelligence.ts, characterCreator.ts) with
 * varying levels of robustness. The weakest version (a single fence-strip
 * regex, no brace-hunting fallback) happened to guard the highest-stakes
 * call site (the main turn adjudication in turn.ts). This module is the
 * one canonical implementation - based on initiator.ts's version, which
 * had the most robust fence-stripping + brace-hunting fallback - so every
 * call site gets the same, hardened behavior.
 */

const MAX_SNIPPET_LENGTH = 300;

/**
 * Cleans raw text returned by the model so it can be passed to JSON.parse.
 *
 * Steps:
 * 1. Strip a leading/trailing ```json ... ``` fence, if present.
 * 2. Strip a leading/trailing generic ``` ... ``` fence (in case the model
 *    omitted the "json" language tag).
 * 3. Fall back to locating the outermost `{ ... }` pair, discarding any
 *    conversational preamble/postamble the model added despite
 *    JSON-only instructions.
 */
export function cleanJson(text: string): string {
    let cleaned = (text ?? '').trim();

    // 1. Remove ```json ... ``` fences if present.
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

    // 2. Remove generic ``` ... ``` fences (covers a missing/odd language tag).
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

    // 3. Aggressively find the outer braces to ignore preamble/postamble text.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return cleaned;
}

function truncateSnippet(text: string): string {
    if (text.length <= MAX_SNIPPET_LENGTH) return text;
    return `${text.slice(0, MAX_SNIPPET_LENGTH)}... [truncated, ${text.length} total chars]`;
}

/**
 * Cleans raw model output and JSON.parses it, throwing an Error with a
 * truncated snippet of the offending text (post-cleaning) if parsing fails.
 * This makes malformed-JSON failures diagnosable instead of surfacing as a
 * bare `SyntaxError: Unexpected token ...` with no context on what was
 * actually returned.
 */
export function parseModelJson<T>(raw: string): T {
    const cleaned = cleanJson(raw);
    try {
        return JSON.parse(cleaned) as T;
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(
            `parseModelJson: failed to parse model output as JSON (${reason}). Offending text: "${truncateSnippet(cleaned)}"`
        );
    }
}
