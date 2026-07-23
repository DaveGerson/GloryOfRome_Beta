/**
 * Pure text segmenter that replaces the old `md()` + `dangerouslySetInnerHTML`
 * rendering in components/Chat.tsx (Phase 5.2, XSS-safe chat rendering).
 *
 * The old path did a global regex replace of double-asterisk bold markers
 * with literal `<strong>` tags, then injected the result as raw HTML — any
 * markup in model/narration text
 * (or a hostile prompt-injected reply) would execute in the DOM.
 *
 * This helper only produces DATA: an ordered list of {bold, text} segments.
 * Chat.tsx renders each segment as a plain React text node (optionally
 * wrapped in <strong>), so React escapes the content by construction — no
 * HTML parsing ever happens on model output.
 */
export interface TextSegment {
    bold: boolean;
    text: string;
}

/**
 * Named HTML entities the model is expected to emit. Decoding is a plain
 * string replace producing literal characters as text DATA — the result is
 * still rendered by React as a text node, so a decoded `<script>` stays
 * inert (React escapes it back to `&lt;script&gt;` at render, it is never
 * parsed as markup). Unknown named entities (e.g. `&notarealentity;`) are
 * left untouched rather than guessed at.
 */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

const ENTITY_PATTERN = /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;

function decodeEntities(text: string): string {
    return text.replace(ENTITY_PATTERN, (match, body: string) => {
        if (body[0] === '#') {
            const codePoint = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
    });
}

/**
 * Splits `text` on `**...**` pairs, matching the old regex's greediness
 * (non-greedy `.*?`, left-to-right, no nesting) but returning literal text
 * instead of HTML. An unmatched trailing `**` (no closing pair) is left as
 * literal text in a non-bold segment, same as the old regex which simply
 * never matched it.
 *
 * Non-string input is coerced with `String(t)` first, matching the old
 * `md()` behavior (e.g. `toSegments(null)` sees `"null"`).
 */
export function toSegments(input: unknown): TextSegment[] {
    const text = String(input);
    const segments: TextSegment[] = [];
    const boldPattern = /\*\*(.*?)\*\*/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = boldPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ bold: false, text: decodeEntities(text.slice(lastIndex, match.index)) });
        }
        segments.push({ bold: true, text: decodeEntities(match[1]) });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        segments.push({ bold: false, text: decodeEntities(text.slice(lastIndex)) });
    }

    return segments;
}
