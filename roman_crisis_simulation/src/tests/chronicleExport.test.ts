/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChronicleScrollHtml,
  escapeHtml,
  scrollExportFilename,
  triggerHtmlDownload,
} from '../persistence/chronicleExport';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import { makeAdjudication, makeEntity, makeTurnHistoryEntry, makeWorldState } from './factories';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
    expect(scrollExportFilename('Julia Mamaea', Number.NaN)).toBe('chronicle-julia-mamaea.html');
  });

  it('adds CSP, escapes injected turnNumber/year, enforces D44 Turn wording, excludes privateIntent, renders marks/ties and trailing fatal fates, and caps numerals', () => {
    const structuredIntent = serializeTurnSubmission({
      version: 1,
      kind: 'structured',
      actions: ['Inspect the eastern granaries.'],
      messagesOrOrders: [{ recipient: { kind: 'free_text', text: 'Prefect' }, command: 'Hold the gate.' }],
      privateIntent: 'SECRET_PRIVATE_INTENT_MARKER',
      questionOrContext: 'QUESTION_CONTEXT_MARKER',
    });
    const entry = makeTurnHistoryEntry({
      turnNumber: '<img src=x onerror=alert(9)>' as unknown as number,
      playerIntent: structuredIntent,
      adjudication: makeAdjudication({ turn: 1, headlines: ['Grain arrives.'] }),
      narration: 'Dawn broke.',
    });
    const html = buildChronicleScrollHtml({
      player: makeEntity({ name: 'Gordian II', status: 'dead' }),
      worldState: {
        ...makeWorldState({ week: 12 }),
        year: '<script>alert(8)</script>' as unknown as number,
      },
      turnHistory: [
        entry,
        makeTurnHistoryEntry({ turnNumber: 1_000_000_000, playerIntent: 'March north.', adjudication: makeAdjudication({ turn: 1_000_000_000, headlines: [] }) }),
      ],
      eventHistory: [
        // Stamped on post-commit turnNumber greater than last regular recorded turn (simulating fatal fate after Turn 1).
        { eventId: 'mutiny', eventTitle: 'Fatal Mutiny', choiceText: 'Stand fast', turnNumber: 2 },
      ],
      marks: ['a jagged scar <b/>'],
      ties: ['Oath of the Senate'],
      epitaph: 'Line one.\r\n\r\nLine two.',
    });

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).not.toContain('<script>alert(8)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(9)>');
    expect(html).toContain(escapeHtml('<script>alert(8)</script>'));
    expect(html).toContain('Turn I');
    expect(html).toContain('Turns Recorded: 2');
    expect(html).toContain('Inspect the eastern granaries.');
    expect(html).toContain('To Prefect: Hold the gate.');
    expect(html).not.toContain('SECRET_PRIVATE_INTENT_MARKER');
    expect(html).not.toContain('QUESTION_CONTEXT_MARKER');
    expect(html).toContain('Fatal Mutiny');
    expect(html).toContain('Marks Carried:');
    expect(html).toContain(escapeHtml('a jagged scar <b/>'));
    expect(html).toContain('Professed Ties:');
    expect(html).toContain('Oath of the Senate');
    expect(html).toContain('<p>Line one.</p><p>Line two.</p>');
    expect(html).toContain('1000000000');
  });

  it('defers URL.revokeObjectURL in triggerHtmlDownload so Firefox and Safari complete downloads', () => {
    vi.useFakeTimers();
    const createSpy = vi.fn(() => 'blob:chronicle-1');
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    triggerHtmlDownload('scroll.html', '<html></html>');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeSpy).toHaveBeenCalledWith('blob:chronicle-1');
  });
});
