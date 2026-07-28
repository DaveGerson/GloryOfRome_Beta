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
 * 3. Extract the first complete top-level object or array, discarding any
 *    conversational preamble/postamble while respecting JSON strings,
 *    escapes, and nested containers.
 */
function firstCompleteJsonContainer(text: string): string {
    let start = -1;
    const expectedClosers: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (start === -1) {
            if (character !== '{' && character !== '[') continue;
            start = index;
            expectedClosers.push(character === '{' ? '}' : ']');
            continue;
        }

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === '{') {
            expectedClosers.push('}');
        } else if (character === '[') {
            expectedClosers.push(']');
        } else if (character === '}' || character === ']') {
            if (expectedClosers.at(-1) !== character) return text;
            expectedClosers.pop();
            if (expectedClosers.length === 0) return text.slice(start, index + 1);
        }
    }

    return text;
}

export function cleanJson(text: string): string {
    let cleaned = (text ?? '').trim();

    // 1. Remove ```json ... ``` fences if present.
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

    // 2. Remove generic ``` ... ``` fences (covers a missing/odd language tag).
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

    // 3. Extract exactly one balanced JSON container. If the first container
    // is malformed or no container exists, preserve the text so JSON.parse
    // fails loudly instead of salvaging a nested fragment.
    return firstCompleteJsonContainer(cleaned);
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
            `parseModelJson: failed to parse model output as JSON (${reason}). Offending text: "${truncateSnippet(cleaned)}"`,
            { cause: e }
        );
    }
}
