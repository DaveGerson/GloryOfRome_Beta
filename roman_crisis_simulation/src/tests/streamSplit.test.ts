import { describe, it, expect } from 'vitest';
import { createNarrationStreamGate } from '../ai/core/streamSplit';

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
