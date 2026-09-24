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

/**
 * Task 4 (task-4-design.md section 1): narration switches to ONE
 * structured-output STREAMING call (`generateStructuredStream`,
 * ai/core/geminiService.ts) whose raw response is the top-level JSON object
 * `{ "text": "...", "actors": [...] }` accumulating chunk by chunk. This
 * extractor pulls the decoded PREFIX of the "text" value out of a
 * (possibly incomplete) cumulative raw JSON string, so it can feed the
 * EXISTING `createNarrationStreamGate` -> `createPlayerVisibleStreamGate`
 * chain above byte-identically to the pre-Task-4 plain-text stream.
 *
 * De-risked in a scratch prototype before landing (see the design doc for
 * the cases proven: mid-key/mid-string chunk splits, key-order independence,
 * escaped quotes, split `\uXXXX` escapes, a trailing lone backslash, "text"
 * appearing as a value/nested-key/array-entry decoy, leading fence junk).
 * Pure and stateless like `createNarrationStreamGate`: it recomputes its
 * answer from scratch from the full cumulative text every call. That makes
 * it the executable SPECIFICATION; the live stream feeds the resumable
 * `createPayloadTextExtractor` below, which is pinned byte-identical to it.
 */

/**
 * Decodes a (possibly incomplete) JSON string body. A trailing incomplete
 * escape (`\` alone, or `\u` with <4 hex digits) is WITHHELD rather than
 * guessed at, so a chunk boundary landing mid-escape never releases a
 * mangled character.
 */
function decodeJsonStringPrefix(raw: string): string {
  let out = '';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (c !== '\\') { out += c; i++; continue; }
    if (i + 1 >= n) break; // trailing lone backslash - withhold
    const e = raw[i + 1];
    switch (e) {
      case '"': out += '"'; i += 2; break;
      case '\\': out += '\\'; i += 2; break;
      case '/': out += '/'; i += 2; break;
      case 'b': out += '\b'; i += 2; break;
      case 'f': out += '\f'; i += 2; break;
      case 'n': out += '\n'; i += 2; break;
      case 'r': out += '\r'; i += 2; break;
      case 't': out += '\t'; i += 2; break;
      case 'u': {
        if (i + 6 > n) return out; // incomplete \uXXXX - withhold
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { i += 2; break; }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        break;
      }
      default: out += e; i += 2; break; // lenient on unknown escapes
    }
  }
  return out;
}

/**
 * Returns the decoded prefix of the top-level `"text"` string value seen so
 * far in `cumulativeRawJson` - '' when the "text" value hasn't started yet
 * (or the cumulative text carries no complete top-level object at all). Only
 * a DEPTH-1 key literally named "text" is the payload; a nested `{"text":
 * ...}` key, a `"text"` VALUE of some other key, or an occurrence inside the
 * `actors` array is not (see the design doc's key-order/decoy prototype
 * cases). Tolerates leading junk before the opening `{` (e.g. a stray code
 * fence) by scanning forward to the first `{`.
 */
export function extractPayloadTextPrefix(cumulativeRawJson: string): string {
  const s = cumulativeRawJson;
  const n = s.length;
  let i = 0;
  while (i < n && s[i] !== '{') i++; // tolerate leading junk/fence
  if (i >= n) return '';
  i++;
  let depth = 1;
  let expectKey = true;    // at depth 1: the next string is a KEY
  let captureNext = false; // the next depth-1 VALUE is the text payload
  while (i < n) {
    const c = s[i];
    if (c === '"') {
      const start = i + 1;
      let j = start;
      let escaped = false;
      let closed = false;
      while (j < n) {
        const ch = s[j];
        if (escaped) { escaped = false; j++; continue; }
        if (ch === '\\') { escaped = true; j++; continue; }
        if (ch === '"') { closed = true; break; }
        j++;
      }
      const raw = s.slice(start, j);
      if (depth === 1 && captureNext && !expectKey) return decodeJsonStringPrefix(raw);
      if (!closed) return ''; // some other string still open at prefix end
      if (depth === 1 && expectKey) {
        captureNext = raw === 'text';
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ']') { depth--; i++; continue; }
    if (c === ',') { if (depth === 1) { expectKey = true; captureNext = false; } i++; continue; }
    i++; // ':', whitespace, numbers, literals
  }
  return '';
}

/**
 * One streaming narration call's resumable "text" extractor (BACKLOG B7
 * item (a), closed 2026-09-23). `extractPayloadTextPrefix` above rescans the
 * WHOLE cumulative raw JSON on every chunk - quadratic in the response
 * length (measured: ~0.5s of scanning for a 128KB payload in 256-char
 * chunks, ~4s in 32-char chunks; this extractor ~1ms either way). This is
 * the same state machine,
 * made resumable: `push` takes only the NEW chunk, carries the scanner's
 * state (depth, key/value position, open-string/escape status, a pending
 * half-arrived `\uXXXX`) across calls, and never revisits a byte. Total work
 * over a stream is linear.
 *
 * CONTRACT: `push(chunk)` returns EXACTLY what
 * `extractPayloadTextPrefix(allChunksSoFar)` would - byte-identical,
 * whatever the chunking (pinned property-style in
 * tests/streamSplit.test.ts against the reference function, which stays
 * exported as the executable specification). So the downstream
 * `createNarrationStreamGate` -> `createPlayerVisibleStreamGate` chain sees
 * no difference at all. Unlike the reference function it is NOT stateless:
 * one extractor per stream, fed every chunk exactly once, in order.
 */
export interface PayloadTextExtractor {
  /** Feeds the next raw-JSON chunk; returns the decoded "text" prefix so far. */
  push(chunk: string): string;
}

const HEX4 = /^[0-9a-fA-F]{4}$/;

export function createPayloadTextExtractor(): PayloadTextExtractor {
  // Scanner phase: before the first `{`, between tokens inside the object,
  // inside a string, or finished (the payload string closed - frozen).
  let phase: 'junk' | 'object' | 'string' | 'done' = 'junk';
  let depth = 0;
  let expectKey = true;
  let captureNext = false;
  // Open-string state.
  let escaped = false;      // the scanner's own close-quote bookkeeping
  let capturing = false;    // this string IS the depth-1 "text" value
  let keyRaw: string | null = null; // raw body of a depth-1 KEY, capped (only "text" matters)
  // Decoder state for the captured string (mirrors decodeJsonStringPrefix).
  let out = '';
  let pending = '';         // an escape still arriving: '\\', or '\\u' + <4 chars

  const decodeChar = (c: string): void => {
    if (pending === '') {
      if (c === '\\') pending = '\\';
      else out += c;
      return;
    }
    if (pending === '\\') {
      switch (c) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': pending = '\\u'; return;
        default: out += c; break; // lenient on unknown escapes
      }
      pending = '';
      return;
    }
    // Collecting a \uXXXX: complete it once four characters are in hand.
    pending += c;
    if (pending.length < 6) return;
    const hex = pending.slice(2);
    pending = '';
    if (HEX4.test(hex)) {
      out += String.fromCharCode(parseInt(hex, 16));
    } else {
      // Not hex: the reference drops the `\u` and decodes the four
      // characters that followed as ordinary string content (which may
      // themselves open an escape) - replay them through the decoder.
      for (let k = 0; k < hex.length; k++) decodeChar(hex[k]);
    }
  };

  return {
    push(chunk: string): string {
      const n = chunk.length;
      let i = 0;
      while (i < n && phase !== 'done') {
        if (phase === 'junk') {
          const brace = chunk.indexOf('{', i);
          if (brace === -1) return '';
          phase = 'object';
          depth = 1;
          i = brace + 1;
          continue;
        }

        if (phase === 'string') {
          if (capturing) {
            // Hot path: the payload string. Hand whole runs of ordinary
            // characters to the output in one slice when no escape is
            // pending, instead of character by character.
            while (i < n) {
              const c = chunk[i];
              if (escaped) { escaped = false; decodeChar(c); i++; continue; }
              if (c === '\\') { escaped = true; decodeChar(c); i++; continue; }
              if (c === '"') {
                // Closed: an escape still pending is withheld forever, as
                // the reference withholds a trailing incomplete one.
                phase = 'done';
                break;
              }
              if (pending === '') {
                let j = i + 1;
                while (j < n) {
                  const d = chunk[j];
                  if (d === '\\' || d === '"') break;
                  j++;
                }
                out += chunk.slice(i, j);
                i = j;
              } else {
                decodeChar(c);
                i++;
              }
            }
            continue;
          }
          // Any other string: find its close; remember a depth-1 key's body.
          while (i < n) {
            const c = chunk[i];
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') break;
            // Five characters already rule out "text"; stop collecting.
            if (keyRaw !== null && keyRaw.length < 5) keyRaw += c;
            i++;
          }
          if (i >= n) return ''; // some other string still open at prefix end
          if (keyRaw !== null) {
            captureNext = keyRaw === 'text';
            expectKey = false;
          }
          keyRaw = null;
          phase = 'object';
          i++;
          continue;
        }

        // phase === 'object': structural characters between tokens.
        const c = chunk[i];
        if (c === '"') {
          phase = 'string';
          escaped = false;
          capturing = depth === 1 && captureNext && !expectKey;
          keyRaw = !capturing && depth === 1 && expectKey ? '' : null;
        } else if (c === '{' || c === '[') {
          depth++;
        } else if (c === '}' || c === ']') {
          depth--;
        } else if (c === ',' && depth === 1) {
          expectKey = true;
          captureNext = false;
        }
        i++;
      }
      return phase === 'done' || (phase === 'string' && capturing) ? out : '';
    },
  };
}
