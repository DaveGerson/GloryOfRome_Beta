import { describe, it, expect } from 'vitest';
import { createNarrationStreamGate, createPayloadTextExtractor, extractPayloadTextPrefix } from '../ai/core/streamSplit';

describe('createNarrationStreamGate', () => {
  it('passes through prose unchanged when no marker ever appears', () => {
    const gate = createNarrationStreamGate();
    expect(gate('The')).toBe('The');
    expect(gate('The Senate')).toBe('The Senate');
    expect(gate('The Senate convenes at dawn')).toBe('The Senate convenes at dawn');
  });

  it('cuts cleanly once the marker fully appears in one chunk', () => {
    const gate = createNarrationStreamGate();
    const result = gate('The Senate convenes at dawn.\nSUGGESTION: Address the crowd');
    expect(result).toBe('The Senate convenes at dawn.');
  });

  it('holds back a marker split across chunk boundaries instead of leaking a partial tag', () => {
    const gate = createNarrationStreamGate();

    // Chunk 1 ends mid-marker - the trailing "\nSUGGE" must never be shown
    // as if it were prose.
    const afterChunk1 = gate('The plot thickens.\nSUGGE');
    expect(afterChunk1).toBe('The plot thickens.');
    expect(afterChunk1).not.toContain('SUGGE');

    // Chunk 2 completes the marker - now everything from it onward is cut.
    const afterChunk2 = gate('The plot thickens.\nSUGGESTION: Investigate the senator\nSUGGESTION: Flee the city');
    expect(afterChunk2).toBe('The plot thickens.');
  });

  it('progressively withholds a growing candidate prefix, chunk by chunk', () => {
    const gate = createNarrationStreamGate();
    const base = 'A courier arrives at the gate.';

    // Feed the marker in one character at a time and make sure the visible
    // text never contains any fragment of "SUGGESTION:".
    const marker = '\nSUGGESTION:';
    for (let i = 1; i <= marker.length; i++) {
      const cumulative = base + marker.slice(0, i);
      const visible = gate(cumulative);
      expect(visible.startsWith(base) || base.startsWith(visible)).toBe(true);
      expect(visible).not.toMatch(/SUGGE|SUGGESTION/);
    }

    // Once the marker is complete and content follows, it's cut cleanly.
    const complete = gate(base + marker + ' Bribe the guard');
    expect(complete).toBe(base);
  });

  it('returns an empty string when the marker appears at the very start', () => {
    const gate = createNarrationStreamGate();
    const result = gate('\nSUGGESTION: Only suggestions, no narration at all');
    expect(result).toBe('');
  });

  it('is stateless/pure - a fresh gate on the same cumulative text yields the same result as an incrementally-fed one', () => {
    const incremental = createNarrationStreamGate();
    incremental('The city holds its breath');
    incremental('The city holds its breath.\nSUGGE');
    const incrementalResult = incremental('The city holds its breath.\nSUGGESTION: Wait and watch');

    const fresh = createNarrationStreamGate();
    const freshResult = fresh('The city holds its breath.\nSUGGESTION: Wait and watch');

    expect(incrementalResult).toBe(freshResult);
    expect(incrementalResult).toBe('The city holds its breath.');
  });

  it('trims the cut result but does not trim interim (no-marker) output', () => {
    const gate = createNarrationStreamGate();
    // Interim: no marker yet, so the raw (untrimmed) cumulative text is
    // returned as-is - trimming mid-stream would make trailing whitespace
    // flicker in and out as more chunks arrive.
    expect(gate('Leading prose ')).toBe('Leading prose ');
    // Final: once the marker is found, the narration portion is trimmed,
    // matching turn.ts's own `narrationParts[0].trim()` on the completed text.
    expect(gate('Leading prose \nSUGGESTION: act now')).toBe('Leading prose');
  });
});

/**
 * BACKLOG B7 item (a): `createPayloadTextExtractor` is the resumable form of
 * `extractPayloadTextPrefix`. The reference function stays the executable
 * specification - every assertion below is "the incremental extractor, fed
 * chunk by chunk, answers exactly what the reference answers on the
 * cumulative prefix", after EVERY chunk, across many random chunkings.
 */

/** mulberry32 - a tiny seeded PRNG so a failure reproduces from its seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `text` at random UTF-16 code-unit boundaries, so surrogate pairs and escapes split too. */
function randomChunks(text: string, rand: () => number, maxChunk: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const len = 1 + Math.floor(rand() * maxChunk);
    chunks.push(text.slice(i, i + len));
    i += len;
  }
  return chunks;
}

/** Feeds `chunks` to a fresh extractor, asserting parity with the reference after each one. */
function expectParity(chunks: string[], label: string): string {
  const extractor = createPayloadTextExtractor();
  let cumulative = '';
  let last = '';
  for (let k = 0; k < chunks.length; k++) {
    cumulative += chunks[k];
    last = extractor.push(chunks[k]);
    const expected = extractPayloadTextPrefix(cumulative);
    // Only build the failure message on an actual mismatch.
    if (last !== expected) {
      expect(last, `${label}: diverged after chunk ${k} (cumulative ${JSON.stringify(cumulative)})`).toBe(expected);
    }
  }
  return last;
}

const SAMPLE_PAYLOADS: string[] = [
  JSON.stringify({ text: 'The Senate convenes. Rain sweeps the forum.\nSUGGESTION: Wait', actors: [] }),
  JSON.stringify({ actors: ['npc_a', 'text'], text: 'Quiet week, "they" say \\ and / slashes.' }),
  // Every escape the decoder knows, \u escapes (BMP, and an astral
  // character as a surrogate PAIR of two escapes), and raw astral text.
  String.raw`{"text": "Tab\there\b\f\r\n A détente. Eagle 🦅 soars ` + '\u{1F3DB}' + String.raw` and — dash \/ \q unknown.", "actors": []}`,
  // Decoys: "text" as a value, a nested key, inside arrays.
  '{"title": "text", "meta": {"text": "decoy", "arr": ["text", {"text": "x"}]}, "actors": ["text"], "text": "Real prose."}',
  // Leading fence junk and a trailing fence.
  '```json\n{"text": "Fenced prose, with a comma, a } brace and a ] bracket.", "actors": []}\n```',
  // Malformed \u escapes the reference treats leniently.
  String.raw`{"text": "bad \uZZZZ hex, \u12\n short-then-escape, \uA nested, \u12\"q", "actors": []}`,
  // A key with an escaped quote, and near-miss keys, before the real one.
  String.raw`{"te\"xt": "no", "texts": "no", "Text": "no", "tex": "no", "text": "yes"}`,
  // No text key at all.
  '{"actors": ["a", "b"], "other": 1.5, "flag": true, "nil": null}',
  // A duplicate key: the first value is the payload, frozen once closed.
  '{"text": "done", "text": "second value ignored"}',
  // A stream that ends on a lone backslash, and one that ends mid-\u.
  '{"text": "ends mid-escape \\',
  String.raw`{"text": "ends mid-unicode \u00`,
];

describe('createPayloadTextExtractor (incremental; BACKLOG B7 item (a)) - equivalence with extractPayloadTextPrefix', () => {
  it('matches the reference on every sample fed whole, code unit by code unit, and at every single split point', () => {
    for (const [index, payload] of SAMPLE_PAYLOADS.entries()) {
      expectParity([payload], `sample ${index} whole`);
      expectParity(payload.split(''), `sample ${index} code unit by code unit`);
      for (let cut = 0; cut <= payload.length; cut++) {
        expectParity([payload.slice(0, cut), payload.slice(cut)], `sample ${index} cut at ${cut}`);
      }
    }
  });

  it('matches the reference across random chunkings of every sample (property-style, seeded)', () => {
    const rand = seeded(0xb7a);
    for (const [index, payload] of SAMPLE_PAYLOADS.entries()) {
      for (let run = 0; run < 200; run++) {
        const maxChunk = 1 + Math.floor(rand() * 12);
        expectParity(randomChunks(payload, rand, maxChunk), `sample ${index} run ${run}`);
      }
    }
  });

  it("matches the reference on random JSON-ish noise (a fuzz over the scanner's alphabet, seeded)", () => {
    const rand = seeded(20260923);
    const alphabet = ['{', '}', '[', ']', '"', ':', ',', ' ', '\\', 'u', 'n', '0', 'e', '9', 'a', 'Z', 't', 'x', '\ud83c', '\udfdb', '"text"', '{"text":"', '\\u00', '\\ud83d', '\\"'];
    for (let run = 0; run < 2000; run++) {
      let noise = '';
      const len = Math.floor(rand() * 60);
      for (let k = 0; k < len; k++) noise += alphabet[Math.floor(rand() * alphabet.length)];
      expectParity(randomChunks(noise, rand, 1 + Math.floor(rand() * 8)), `fuzz run ${run}`);
    }
  });

  it('decodes a surrogate pair split across chunks - even inside its second \\u escape - to the real character', () => {
    const payload = String.raw`{"text": "An eagle 🦅 rises.", "actors": []}`;
    const second = payload.indexOf(String.raw`\udd85`);
    const result = expectParity(
      [payload.slice(0, second - 3), payload.slice(second - 3, second + 3), payload.slice(second + 3)],
      'surrogate split',
    );
    expect(result).toBe('An eagle \u{1F985} rises.');
  });

  it('is frozen once the payload string closes - later chunks change nothing', () => {
    const extractor = createPayloadTextExtractor();
    expect(extractor.push('{"text": "Final.", ')).toBe('Final.');
    expect(extractor.push('"text": "not me"}')).toBe('Final.');
  });

  it('scales linearly: 128KB in small chunks costs about 8x what 16KB does, not the old rescan\'s ~64x', () => {
    const makePayload = (bytes: number): string => {
      const sentence = String.raw`The legions march at dawn, \"Ave\" they cry — the détente fails. `;
      return `{"actors": [], "text": "${sentence.repeat(Math.ceil(bytes / sentence.length))}"}`;
    };
    const timeFeed = (payload: string, chunkSize: number): number => {
      const start = performance.now();
      const extractor = createPayloadTextExtractor();
      for (let i = 0; i < payload.length; i += chunkSize) extractor.push(payload.slice(i, i + chunkSize));
      return performance.now() - start;
    };
    const small = makePayload(16 * 1024);
    const large = makePayload(128 * 1024);
    // Warm the JIT, then take the best of several runs to shrug off GC noise.
    timeFeed(large, 32);
    const best = (payload: string): number => Math.min(...[0, 1, 2, 3, 4].map(() => timeFeed(payload, 32)));
    const smallMs = best(small);
    const largeMs = best(large);
    // 8x the bytes: linear is ~8x, the old quadratic rescan ~64x. Generous
    // CI headroom that still rules quadratic out, plus an absolute ceiling
    // far below the reference rescan's measured ~267ms at 128KB.
    expect(largeMs).toBeLessThan(Math.max(smallMs, 0.25) * 24);
    expect(largeMs).toBeLessThan(50);
    // And the answer is still the reference's.
    const extractor = createPayloadTextExtractor();
    let last = '';
    for (let i = 0; i < large.length; i += 4096) last = extractor.push(large.slice(i, i + 4096));
    expect(last).toBe(extractPayloadTextPrefix(large));
  });
});
