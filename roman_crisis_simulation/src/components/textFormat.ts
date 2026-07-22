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
            segments.push({ bold: false, text: text.slice(lastIndex, match.index) });
        }
        segments.push({ bold: true, text: match[1] });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        segments.push({ bold: false, text: text.slice(lastIndex) });
    }

    return segments;
}
