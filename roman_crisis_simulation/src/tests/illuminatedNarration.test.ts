import { describe, expect, it } from 'vitest';
import { illuminatedNarrationIndices } from '../components/Chat';
import type { Message } from '../types';

const msg = (sender: Message['sender'], text = 'x'): Message => ({ sender, text });

describe('illuminatedNarrationIndices (audit item 13 — one drop cap per week)', () => {
  it('illuminates the opening narration of a reign', () => {
    expect([...illuminatedNarrationIndices([msg('gm'), msg('player'), msg('gm')])]).toEqual([0]);
  });

  it('illuminates exactly one narration per week, at each ribbon', () => {
    const stream: Message[] = [
      msg('gm'),                 // 0 — week I opens
      msg('player'),             // 1
      msg('player_monologue'),   // 2
      msg('gm'),                 // 3 — same week, no drop cap
      msg('ribbon', 'Week II'),  // 4
      msg('player'),             // 5
      msg('gm'),                 // 6 — week II opens
      msg('gm'),                 // 7
      msg('ribbon', 'Week III'), // 8
      msg('gm'),                 // 9 — week III opens
    ];
    expect([...illuminatedNarrationIndices(stream)]).toEqual([0, 6, 9]);
  });

  it('never illuminates a player or monologue message', () => {
    const stream: Message[] = [msg('player'), msg('player_monologue'), msg('ribbon'), msg('player')];
    expect(illuminatedNarrationIndices(stream).size).toBe(0);
  });

  // A week that commits without a narration must not push its drop cap onto
  // the following week's second bubble.
  it('leaves a narration-less week unilluminated rather than deferring it', () => {
    const stream: Message[] = [msg('ribbon'), msg('player'), msg('ribbon'), msg('gm'), msg('gm')];
    expect([...illuminatedNarrationIndices(stream)]).toEqual([3]);
  });

  it('holds nothing on an empty stream', () => {
    expect(illuminatedNarrationIndices([]).size).toBe(0);
  });
});
