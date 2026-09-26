/**
 * @vitest-environment jsdom
 *
 * tests/narrationLog.test.tsx
 *
 * The narration log (narration/narrationLog.ts): every performance kept as
 * text on the device - recorded by the chronicle voice, the Imperial
 * Dispatch and (tests/privateSceneVoice.test.tsx) private-scene lines -
 * capped, persisted, tolerant of broken storage; transcript reuse that skips
 * the prep call; and the log panel (components/NarrationLog.tsx): opening,
 * listing, replaying, copying, clearing, focus trap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState, type Message } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import {
  MAX_NARRATION_LOG_ENTRIES,
  NarrationLogStore,
  SOURCE_EXCERPT_CHARS,
  sourceExcerpt,
  type NarrationLogInput,
} from '../narration/narrationLog';
import { NARRATION_LOG_KEY } from '../persistence/uiPrefs';
import { DRAMATIC_READER_NARRATOR } from '../narration/narrators';
import { fallbackTranscript } from '../narration/performanceScript';
import { useNarrationVoice, chronicleSourceLabel, weekOfMessage, type UseNarrationVoiceArgs } from '../hooks/useNarrationVoice';
import { useNarrationLog } from '../hooks/useNarrationLog';
import { useImperialDispatch } from '../hooks/useImperialDispatch';
import { NarrationLog } from '../components/NarrationLog';
import { renderHook } from './renderHook';
import { makeEntity, makeSimulationState, makeWorldState } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NARRATION = 'The Praetorians mutter in their camp. Maximinus raises a cup. The Senate waits.';
const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };

function makeAi(retelling = 'The Praetorians mutter in their camp, restless. At the gate, Philip gathers his cohorts. Maximinus raises a cup, and the Senate waits.') {
  const generateContent = vi.fn(async (params: ContentParams) => (params.config?.responseModalities ? AUDIO_RESPONSE : { text: retelling }));
  const ai: GeminiClient = { models: { generateContent } };
  const tts = () => generateContent.mock.calls.filter(c => c[0].config?.responseModalities);
  const prep = () => generateContent.mock.calls.filter(c => !c[0].config?.responseModalities);
  return { ai, generateContent, tts, prep };
}

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

function input(overrides: Partial<NarrationLogInput> = {}): NarrationLogInput {
  return {
    kind: 'chronicle', sourceLabel: 'Week III narration', sourceText: NARRATION, narratorKey: 'k', narratorName: 'The Dramatic Reader',
    voice: 'Enceladus', voiceStyle: null, transcript: 'Rome waits.', patchedOut: [], usedFallback: false, week: 3, turn: 2, ...overrides,
  };
}

function mockAudio() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:l-${++n}`), revokeObjectURL: vi.fn() });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the log store', () => {
  it('records newest first, with an excerpt and a hash of the source, never the source whole', () => {
    const log = new NarrationLogStore({ now: () => new Date('2026-09-25T10:00:00Z') });
    const long = `${'The Senate waits in silence while the torches gutter. '.repeat(6)}END`;
    log.record(input({ sourceText: long }));
    log.record(input({ kind: 'dispatch', sourceLabel: 'Imperial Dispatch, Week III', transcript: 'The treasury holds.' }));
    const [newest, oldest] = log.getSnapshot();
    expect(newest).toMatchObject({ kind: 'dispatch', seq: 2, at: '2026-09-25T10:00:00.000Z' });
    expect(oldest.sourceExcerpt.length).toBeLessThanOrEqual(SOURCE_EXCERPT_CHARS + 1);
    expect(oldest.sourceExcerpt.endsWith('…')).toBe(true);
    expect(JSON.stringify(oldest)).not.toContain('END');
    expect(sourceExcerpt('**Rome**  waits.')).toBe('Rome waits.');
  });

  it(`caps at ${MAX_NARRATION_LOG_ENTRIES}, dropping the oldest first`, () => {
    const log = new NarrationLogStore();
    for (let i = 1; i <= MAX_NARRATION_LOG_ENTRIES + 5; i++) log.record(input({ transcript: `Performance ${i}.` }));
    const entries = log.getSnapshot();
    expect(entries).toHaveLength(MAX_NARRATION_LOG_ENTRIES);
    expect(entries[0].transcript).toBe(`Performance ${MAX_NARRATION_LOG_ENTRIES + 5}.`);
    expect(entries[entries.length - 1].transcript).toBe('Performance 6.');
    expect(JSON.parse(localStorage.getItem(NARRATION_LOG_KEY)!)).toHaveLength(MAX_NARRATION_LOG_ENTRIES);
  });

  it('persists on the device and reloads, dropping anything malformed', () => {
    const log = new NarrationLogStore();
    log.record(input({ patchedOut: ['At the gate, Philip gathers his cohorts.'] }));
    const stored = JSON.parse(localStorage.getItem(NARRATION_LOG_KEY)!);
    localStorage.setItem(NARRATION_LOG_KEY, JSON.stringify([...stored, { ...stored[0], kind: 'gm_private' }, 'junk', { ...stored[0], extra: 1 }]));
    const reloaded = new NarrationLogStore();
    expect(reloaded.getSnapshot()).toEqual(log.getSnapshot());
    localStorage.setItem(NARRATION_LOG_KEY, '{broken');
    expect(new NarrationLogStore().getSnapshot()).toEqual([]);
  });

  it('records dropped cues, and still loads an entry logged before cues could be dropped', () => {
    const log = new NarrationLogStore();
    expect(log.record(input({ droppedCues: ['<Philip whispers>'] })).droppedCues).toEqual(['<Philip whispers>']);
    expect(log.record(input()).droppedCues).toEqual([]);
    const stored = JSON.parse(localStorage.getItem(NARRATION_LOG_KEY)!);
    // The newest entry, stored as an entry from before `droppedCues` existed.
    const { droppedCues: _dropped, ...older } = stored[0];
    localStorage.setItem(NARRATION_LOG_KEY, JSON.stringify([older, stored[1]]));
    const reloaded = new NarrationLogStore().getSnapshot();
    expect(reloaded).toHaveLength(2);
    expect(reloaded[1].droppedCues).toEqual(['<Philip whispers>']);
    expect(reloaded[0].droppedCues).toEqual([]);
  });

  it('never crashes on storage that throws: it simply forgets', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const log = new NarrationLogStore();
    expect(log.getSnapshot()).toEqual([]);
    expect(() => log.record(input())).not.toThrow();
    expect(log.getSnapshot()).toHaveLength(1);
    expect(() => log.clear()).not.toThrow();
  });

  it('finds a reusable transcript only for the same source and narrator, and never a fallback', () => {
    const log = new NarrationLogStore();
    log.record(input({ narratorKey: 'fallback', usedFallback: true }));
    log.record(input({ narratorKey: 'k', transcript: 'The retelling.' }));
    expect(log.findReusable(`  ${NARRATION.replace(/ /g, '  ')} `, 'k')?.transcript).toBe('The retelling.');
    expect(log.findReusable(NARRATION, 'other')).toBeUndefined();
    expect(log.findReusable('Another narration.', 'k')).toBeUndefined();
    expect(log.findReusable(NARRATION, 'fallback')).toBeUndefined();
  });
});

describe('recording from the voices', () => {
  function mountVoice(log: NarrationLogStore, ai: GeminiClient, messages: Message[]) {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const args: UseNarrationVoiceArgs = {
      ai, isMockMode: false, resolvedApiKey: 'k', messages, gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR], log, week: 12, turnNumber: 11,
      playerEntity: { name: 'Severus Alexander', position: 'Emperor' } as UseNarrationVoiceArgs['playerEntity'],
    };
    return renderHook(useNarrationVoice, args);
  }
  const messages: Message[] = [
    { sender: 'ribbon', text: 'Week XI', ribbonDate: { week: 11, year: 235 } },
    { sender: 'gm', text: NARRATION },
  ];

  it('labels a chronicle narration by the week it belongs to', () => {
    expect(weekOfMessage(messages, 1, 12)).toBe(11);
    expect(weekOfMessage([{ sender: 'gm', text: 'x' }], 0, 12)).toBe(12);
    expect(chronicleSourceLabel(11)).toBe('Week XI narration');
  });

  it('records the patched transcript, what was cut, the narrator, voice and style', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    const { ai } = makeAi();
    const hook = mountVoice(log, ai, messages);
    act(() => hook.current.handleSetVoiceStyle({ preset: 'newsreader' }));
    act(() => hook.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(log.getSnapshot()).toHaveLength(1);
    expect(log.getSnapshot()[0]).toMatchObject({
      kind: 'chronicle', sourceLabel: 'Week XI narration', week: 11, turn: 11,
      narratorName: 'The Dramatic Reader', voice: 'Enceladus', voiceStyle: { preset: 'newsreader' },
      transcript: 'The Praetorians mutter in their camp, restless. Maximinus raises a cup, and the Senate waits.',
      patchedOut: ['At the gate, Philip gathers his cohorts.'], usedFallback: false,
    });
    expect(log.getSnapshot()[0].sourceExcerpt).toBe(NARRATION);
    hook.unmount();
  });

  it('reuses a logged transcript: pressing play after a reload makes no prep call, only the voice', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    const first = makeAi();
    const hook = mountVoice(log, first.ai, messages);
    act(() => hook.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(first.prep()).toHaveLength(1);
    hook.unmount();

    // A fresh hook: no in-memory audio, but the log remembers the words.
    const second = makeAi('This retelling must never be asked for.');
    const again = mountVoice(log, second.ai, messages);
    act(() => again.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(second.prep()).toHaveLength(0);
    expect(second.tts()).toHaveLength(1);
    expect(second.tts()[0][0].contents).toBe('## Transcript:\nThe Praetorians mutter in their camp, restless. Maximinus raises a cup, and the Senate waits.');
    expect(log.getSnapshot()).toHaveLength(1);

    // Another style is another retelling: the style shaped the words.
    act(() => again.current.handleSetVoiceStyle({ preset: 'newsreader' }));
    act(() => again.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(second.prep()).toHaveLength(1);
    act(() => again.current.handleSetVoiceStyle(null));

    // Another narrator is another retelling.
    act(() => again.current.handleSaveCustomNarrator({ name: 'Herald', description: '', brief: 'A crier.', voiceName: 'Orus', voiceStyle: null }));
    act(() => again.current.handleSetNarrator(again.current.customNarrators[0].id));
    act(() => again.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(second.prep()).toHaveLength(2);
    again.unmount();
  });

  it('the Imperial Dispatch is recorded too', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    const { ai } = makeAi('The treasury holds and the legions wait.');
    const hook = renderHook(useImperialDispatch, {
      ai, isMockMode: false, resolvedApiKey: 'k', worldState: makeWorldState({ week: 4 }), simulationState: makeSimulationState(),
      entities: [makeEntity()], reports: [], currentEvents: [], playerEntity: makeEntity(), turnNumber: 3, log,
    });
    act(() => hook.current.toggleDispatch());
    await settle();
    expect(log.getSnapshot()[0]).toMatchObject({
      kind: 'dispatch', sourceLabel: 'Imperial Dispatch, Week IV', narratorName: 'The Imperial Chancellery', voice: 'Sadaltager',
      transcript: 'The treasury holds and the legions wait.', usedFallback: false, week: 4, turn: 3,
    });
    hook.unmount();
  });

  it('Mock Mode records too, offline, and never reuses a fallback', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    const { ai, generateContent } = makeAi();
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const hook = renderHook(useNarrationVoice, {
      ai, isMockMode: true, resolvedApiKey: null, messages, gameState: GameState.AWAITING_PLAYER_INPUT, narrators: [DRAMATIC_READER_NARRATOR], log, week: 11,
    });
    act(() => hook.current.toggleNarrationVoice(1, NARRATION));
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(log.getSnapshot()[0]).toMatchObject({ usedFallback: true, transcript: fallbackTranscript(NARRATION) });
    expect(log.findReusable(NARRATION, log.getSnapshot()[0].narratorKey)).toBeUndefined();
    hook.unmount();
  });
});

describe('the log panel', () => {
  function Harness({ log, ai }: { log: NarrationLogStore; ai: GeminiClient }) {
    const { narrationLogEntries, toggleReplay, replayStateFor, stopReplay, clearLog } = useNarrationLog({ ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand', log });
    return <NarrationLog entries={narrationLogEntries} stateFor={replayStateFor} onToggle={toggleReplay} onClear={clearLog} onClose={stopReplay} />;
  }

  function mount(log: NarrationLogStore, ai: GeminiClient) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Harness log={log} ai={ai} />));
    return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
  }
  const opener = (host: HTMLElement) => [...host.querySelectorAll('button')].find(b => b.textContent === 'Narration log')!;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="narration-log-title"]');

  function seeded() {
    const log = new NarrationLogStore({ load: false });
    log.record(input({ sourceLabel: 'Week II narration', transcript: 'Older words.' }));
    log.record(input({ sourceLabel: 'Week III narration', transcript: 'Newer words.', patchedOut: ['At the gate, Philip gathers his cohorts.'], voiceStyle: { preset: 'tragedian' } }));
    return log;
  }

  it('opens as a modal dialog listing entries newest first, with source, narrator, voice, words and what was omitted', () => {
    const { ai } = makeAi();
    const view = mount(seeded(), ai);
    const open = opener(view.host);
    open.focus();
    act(() => open.click());
    const panel = dialog()!;
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement && panel.contains(document.activeElement)).toBe(true);
    const items = [...panel.querySelectorAll('.gor-narration-log-entry')];
    expect(items.map(i => i.querySelector('h3')!.textContent)).toEqual(['Week III narration', 'Week II narration']);
    expect(items[0].textContent).toContain('The Dramatic Reader · Enceladus · Epic stage tragedian');
    expect(items[0].textContent).toContain('Newer words.');
    expect(items[0].querySelector('summary')!.textContent).toBe('Omitted: 1 line the chronicle did not support');
    expect(items[1].querySelector('summary')).toBeNull();
    view.cleanup();
  });

  it('shows the cues the guard dropped, gently, apart from the cut lines', () => {
    const log = new NarrationLogStore({ load: false });
    log.record(input({ transcript: 'Rome waits.', droppedCues: ['<Philip whispers>'] }));
    const { ai } = makeAi();
    const view = mount(log, ai);
    act(() => opener(view.host).click());
    const entry = dialog()!.querySelector('.gor-narration-log-entry')!;
    const summaries = [...entry.querySelectorAll('summary')].map(s => s.textContent);
    expect(summaries).toEqual(['Omitted: 1 cue the chronicle did not support']);
    expect(entry.querySelector('details li')!.textContent).toContain('Philip whispers');
    view.cleanup();
  });

  it('replays the logged words through the voice alone - the words and nothing else, whatever style wrote them; pressing again stops', async () => {
    mockAudio();
    const { ai, prep, tts } = makeAi();
    const view = mount(seeded(), ai);
    act(() => opener(view.host).click());
    const play = dialog()!.querySelector<HTMLButtonElement>('.gor-narration-log-entry .gor-voice-btn')!;
    act(() => play.click());
    await settle();
    expect(prep()).toHaveLength(0);
    expect(tts()).toHaveLength(1);
    expect(tts()[0][0].contents).toBe('## Transcript:\nNewer words.');
    expect(play.getAttribute('aria-pressed')).toBe('true');
    act(() => play.click());
    expect(play.getAttribute('aria-pressed')).toBe('false');
    act(() => play.click());
    await settle();
    expect(tts()).toHaveLength(1); // the clip was cached in memory
    view.cleanup();
  });

  it('copies the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { ai } = makeAi();
    const view = mount(seeded(), ai);
    act(() => opener(view.host).click());
    const copy = [...dialog()!.querySelectorAll('button')].find(b => b.textContent === 'Copy text')!;
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledWith('Newer words.');
    expect(dialog()!.textContent).toContain('Copied.');
    view.cleanup();
  });

  it('sets each performance cue of an acted script apart, and copies the script with its cues', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const script = '<a low, bitter laugh> "So the Senate waits..." <a long pause, then quietly> Rome holds its breath.';
    const log = new NarrationLogStore({ load: false });
    log.record(input({ sourceLabel: 'Week IV narration', transcript: script }));
    const { ai } = makeAi();
    const view = mount(log, ai);
    act(() => opener(view.host).click());
    const transcript = dialog()!.querySelector('.gor-narration-log-transcript')!;
    const cues = [...transcript.querySelectorAll('em.gor-narration-log-cue')];
    expect(cues).toHaveLength(2);
    expect(cues[0].textContent).toBe('Performance cue: ‹a low, bitter laugh›');
    expect(cues[0].querySelector('.gor-sr-only')!.textContent).toBe('Performance cue: ');
    expect([...cues[0].querySelectorAll('[aria-hidden="true"]')].map(el => el.textContent)).toEqual(['‹', '›']);
    // The spoken words stay plain text.
    expect(transcript.textContent).toContain('"So the Senate waits..."');
    expect(transcript.textContent).toContain('Rome holds its breath.');
    const copy = [...dialog()!.querySelectorAll('button')].find(b => b.textContent === 'Copy text')!;
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledWith(script);
    view.cleanup();
  });

  it('an entry with no cues (logged before scripts carried them) reads exactly as its text', () => {
    const { ai } = makeAi();
    const view = mount(seeded(), ai);
    act(() => opener(view.host).click());
    const transcripts = [...dialog()!.querySelectorAll('.gor-narration-log-transcript')];
    expect(transcripts.map(t => t.textContent)).toEqual(['Newer words.', 'Older words.']);
    expect(transcripts.map(t => t.innerHTML)).toEqual(['Newer words.', 'Older words.']);
    expect(dialog()!.querySelector('.gor-narration-log-cue')).toBeNull();
    view.cleanup();
  });

  it('clears in two steps, and says so when empty', () => {
    const { ai } = makeAi();
    const log = seeded();
    const view = mount(log, ai);
    act(() => opener(view.host).click());
    const button = (text: string) => [...dialog()!.querySelectorAll('button')].find(b => b.textContent === text)!;
    act(() => button('Clear log').click());
    expect(dialog()!.textContent).toContain('Clear every entry? This cannot be undone.');
    act(() => button('Keep').click());
    expect(log.getSnapshot()).toHaveLength(2);
    act(() => button('Clear log').click());
    act(() => button('Clear').click());
    expect(log.getSnapshot()).toHaveLength(0);
    expect(localStorage.getItem(NARRATION_LOG_KEY)).toBeNull();
    expect(dialog()!.textContent).toContain('Nothing has been performed yet.');
    view.cleanup();
  });

  it('traps Tab inside, closes on Escape, and returns focus to the opener', () => {
    const { ai } = makeAi();
    const view = mount(seeded(), ai);
    const open = opener(view.host);
    open.focus();
    act(() => open.click());
    const panel = dialog()!;
    const focusables = [...panel.querySelectorAll<HTMLElement>('button, summary')].filter(el => el.tagName === 'BUTTON');
    const last = focusables[focusables.length - 1];
    last.focus();
    act(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(panel.querySelector('button'));
    act(() => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(open);
    view.cleanup();
  });
});

describe('SILENT holds in the log (PR #12 review)', () => {
  it('while the voice is off, replay is silenced: the words stay readable, and no paid call is made', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    log.record(input());
    const { ai, tts } = makeAi();
    const hook = renderHook(useNarrationLog, { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'off' as const, log });
    const [entry] = hook.current.narrationLogEntries;
    expect(entry.transcript).toBe('Rome waits.');
    expect(hook.current.replayStateFor(entry)).toBe('silenced');
    act(() => hook.current.toggleReplay(entry));
    await settle();
    expect(tts()).toHaveLength(0);
    hook.unmount();
  });

  it('turning the voice off stops a replay already playing', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    log.record(input());
    const { ai, tts } = makeAi();
    const args = { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand' as 'on_demand' | 'off', log };
    const hook = renderHook(useNarrationLog, args);
    const [entry] = hook.current.narrationLogEntries;
    act(() => hook.current.toggleReplay(entry));
    await settle();
    expect(tts()).toHaveLength(1);
    expect(hook.current.replayStateFor(entry)).toBe('playing');
    hook.rerender({ ...args, narrationVoiceMode: 'off' });
    expect(hook.current.replayStateFor(entry)).toBe('silenced');
    act(() => hook.current.toggleReplay(entry));
    await settle();
    expect(tts()).toHaveLength(1);
    hook.unmount();
  });

  it('the panel disables replay and says why', () => {
    const log = new NarrationLogStore({ load: false });
    log.record(input());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<NarrationLog entries={log.getSnapshot()} stateFor={() => 'silenced'} onToggle={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />));
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Narration log')!.click());
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="narration-log-title"]')!;
    const replay = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Hear it again'))!;
    expect(replay.disabled).toBe(true);
    expect(panel.textContent).toContain('The voice is silent. Turn it on in Settings to hear this again.');
    // The hint describes the disabled replay button.
    expect(document.getElementById(replay.getAttribute('aria-describedby')!)?.textContent).toBe('The voice is silent. Turn it on in Settings to hear this again.');
    act(() => root.unmount());
    host.remove();
  });
});

describe('SILENT holds for the Imperial Dispatch too', () => {
  it('while the voice is off the Dispatch is silenced: no call, and a reading in progress stops', async () => {
    mockAudio();
    const log = new NarrationLogStore({ load: false });
    const { ai, generateContent } = makeAi('The treasury holds and the legions wait.');
    const base = {
      ai, isMockMode: false, resolvedApiKey: 'k', worldState: makeWorldState({ week: 4 }), simulationState: makeSimulationState(),
      entities: [makeEntity()], reports: [], currentEvents: [], playerEntity: makeEntity(), turnNumber: 3, log,
    };
    const silent = renderHook(useImperialDispatch, { ...base, narrationVoiceMode: 'off' as const });
    expect(silent.current.dispatchStatus).toBe('silenced');
    act(() => silent.current.toggleDispatch());
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    silent.unmount();

    const args = { ...base, narrationVoiceMode: 'on_demand' as 'on_demand' | 'off' };
    const live = renderHook(useImperialDispatch, args);
    act(() => live.current.toggleDispatch());
    await settle();
    expect(live.current.dispatchStatus).toBe('playing');
    live.rerender({ ...args, narrationVoiceMode: 'off' });
    expect(live.current.dispatchStatus).toBe('silenced');
    live.unmount();
  });
});
