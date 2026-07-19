/**
 * ai/core/streamSplit.ts
 *
 * The narration call's raw response is prose followed by zero or more
 * `\nSUGGESTION: ...` lines (see turn.ts, which splits the completed text on
 * the literal string `'SUGGESTION:'` into `narration` + `suggestedActions`).
 * That split is trivial once the FULL response is in hand, but streaming
 * narration onto the page (ROADMAP_0_MASTER_PLAN.md Phase 3 item 2) means we
 * only ever have a PREFIX of the eventual response - and that prefix must
 * never let a suggestion line flash on screen as if it were part of the
 * story, even for a single chunk.
 *
 * `createNarrationStreamGate` is the pure, narration-specific answer to
 * that: given the cumulative text received so far, it returns only the
 * portion that's safe to render as narration right now.
 */

/**
 * The exact marker `turn.ts` splits the completed narration response on.
 * Includes the leading newline so a marker that happens to start a fresh
 * line mid-prose can't be mistaken for narration text that merely contains
 * the word "SUGGESTION".
 */
const SUGGESTION_MARKER = '\nSUGGESTION:';

/**
 * Creates a gate function scoped to one streaming narration call. The
 * returned function is pure and stateless - it recomputes its answer from
 * scratch from the full cumulative text passed in every time, so calling it
 * out of order or more than once with the same text is always safe. It's
 * wrapped in this factory purely so a caller can hold one stable reference
 * across a stream's lifetime (`const gate = createNarrationStreamGate();`
 * then `gate(textSoFar)` per chunk), mirroring how a component might hold a
 * memoized callback.
 *
 * Behavior:
 *  - If `\nSUGGESTION:` has fully arrived in `cumulativeText`, returns
 *    everything before it (trimmed) - cutting cleanly the instant the
 *    marker completes, no matter how many further SUGGESTION lines follow.
 *  - Otherwise, holds back the longest trailing suffix of `cumulativeText`
 *    that is itself a PREFIX of the marker (e.g. a buffer ending in
 *    "...arrives.\nSUGGE" must not render "SUGGE" as prose) - buffer-
 *    boundary safety for a marker that arrived split across two or more
 *    stream chunks. That suffix is re-evaluated fresh on every call, so it
 *    either gets swallowed into a completed marker on a later call, or
 *    turns out to have been ordinary prose all along and is released once
 *    more text proves it isn't the marker.
 */
export function createNarrationStreamGate(): (cumulativeText: string) => string {
  return (cumulativeText: string): string => {
    const markerIndex = cumulativeText.indexOf(SUGGESTION_MARKER);
    if (markerIndex !== -1) {
      return cumulativeText.slice(0, markerIndex).trim();
    }

    // No complete marker yet - find the longest suffix of what we have that
    // could still grow into the marker, and withhold it. Checked longest
    // first so e.g. a trailing "\nSUGGESTION" (11 chars) isn't reported as
    // just its own trailing "N" (1 char) being held back.
    const maxCheck = Math.min(SUGGESTION_MARKER.length - 1, cumulativeText.length);
    for (let len = maxCheck; len > 0; len--) {
      const suffix = cumulativeText.slice(cumulativeText.length - len);
      if (SUGGESTION_MARKER.startsWith(suffix)) {
        return cumulativeText.slice(0, cumulativeText.length - len);
      }
    }

    return cumulativeText;
  };
}
