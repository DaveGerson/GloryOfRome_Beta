import { describe, expect, it } from 'vitest';
import {
  buildChronicleScrollHtml,
  escapeHtml,
  scrollExportFilename,
} from '../persistence/chronicleExport';
import { makeAdjudication, makeEntity, makeTurnHistoryEntry, makeWorldState } from './factories';

describe('2A: Illustrated Chronicle & Stele Scroll Export', () => {
  it('escapes HTML and script injection in player fields, narration, headlines, and epitaph', () => {
    const player = makeEntity({
      entity_id: 'player_1',
      name: 'Severus <script>alert(1)</script>',
      position: 'Emperor & Pontifex',
      location: 'Palatine "Hill"',
      status: 'dead',
    });
    const entry = makeTurnHistoryEntry({
      turnNumber: 3,
      playerIntent: 'Inspect the <b>granaries</b>',
      adjudication: makeAdjudication({
        turn: 3,
        headlines: ['Grain ships <img src=x onerror=alert(2)> dock at Ostia.'],
        gm_private: ['SECRET_GM_ROLL_NEVER_EXPORTED'],
      }),
      narration: 'Ash drifts across <script>evil()</script> the Forum.',
      playerMonologue: 'They think I cannot see.',
      rawCalls: [{
        callName: 'adjudication',
        model: 'gemini-3-pro-preview',
        latencyMs: 50,
        attempts: 1,
        promptChars: 10,
        rawResponse: 'SECRET_RAW_CALL_RESPONSE',
        validated: true,
      }],
    });

    const html = buildChronicleScrollHtml({
      player,
      worldState: makeWorldState({ year: 235, week: 12, economic_stability: 'Strained', political_climate: 'Tense' }),
      turnHistory: [entry],
      eventHistory: [{ eventId: 'e1', eventTitle: 'Grain Shortage <test>', choiceText: 'Open reserves', turnNumber: 3 }],
      epitaph: 'He fell <script>bad</script> with sword in hand.',
      exportedAt: '2026-11-23',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain(escapeHtml('Severus <script>alert(1)</script>'));
    expect(html).toContain(escapeHtml('Ash drifts across <script>evil()</script> the Forum.'));
    expect(html).toContain('In Memoriam');
    expect(html).toContain('Open reserves');
    expect(html).not.toContain('SECRET_GM_ROLL_NEVER_EXPORTED');
    expect(html).not.toContain('SECRET_RAW_CALL_RESPONSE');
  });

  it('handles empty chronicles and derives clean filenames', () => {
    const player = makeEntity({ name: 'Julia Mamaea', status: 'alive' });
    const html = buildChronicleScrollHtml({
      player,
      turnHistory: [],
      eventHistory: [],
    });
    expect(html).toContain('Chronicle of Julia Mamaea');
    expect(html).toContain('The annals are not yet inscribed');
    expect(html).not.toContain('In Memoriam');
    expect(scrollExportFilename('Julia Mamaea', 235)).toBe('chronicle-julia-mamaea-ad-235.html');
  });
});
