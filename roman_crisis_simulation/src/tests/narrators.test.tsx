/**
 * @vitest-environment jsdom
 *
 * tests/narrators.test.tsx
 *
 * Narrator profiles (narration/narrators.ts) and the intermediary prep
 * model: the schema and every deployed profile, the loader's refusals, how
 * a profile reaches both calls in ai/tools/narrationVoice.ts, the device
 * preference and the Settings picker, and the tuning harness core
 * (narration/tuning/tuneNarrator.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState, type Message } from '../types';
import {
  GEMINI_NARRATION_PREP,
  GEMINI_TTS,
  DEFAULT_NARRATOR_VOICE,
  type GeminiClient,
} from '../ai/core/geminiService';
import {
  DEFAULT_NARRATOR_ID,
  LAMPLIGHT_NARRATOR,
  NARRATORS,
  loadNarratorProfiles,
  narratorById,
  narratorProfileSchema,
  type NarratorProfile,
} from '../narration/narrators';
import { buildDirectorSystemInstruction, buildNarrationPerformancePrompt, buildNarrationTtsPrompt } from '../ai/prompts/narrationPerformance';
import { performNarration } from '../ai/tools/narrationVoice';
import { fallbackTranscript } from '../narration/performanceScript';
import { countDirections, formatTuningReport, runNarratorTuning, summarizeTuning } from '../narration/tuning/tuneNarrator';
import { getNarratorProfileId, setNarratorProfileId } from '../persistence/uiPrefs';
import { useNarrationVoice, type UseNarrationVoiceArgs } from '../hooks/useNarrationVoice';
import SettingsMenu from '../components/SettingsMenu';
import { renderHook } from './renderHook';
import template from '../narration/tuning/narrator.template.json';
import fixtures from '../narration/tuning/fixtures.json';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NARRATION = 'The Senate waits. Maximinus says nothing.';
const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };

const HERALD: NarratorProfile = {
  id: 'forum-herald',
  name: 'The Forum Herald',
  description: 'A crier on the Rostra, loud and quick.',
  prep: { model: 'tunedModels/rome-director-1', thinkingLevel: 'minimal', temperature: 0.4, directorNotes: 'Punch the ends of sentences.' },
  voice: { model: 'gemini-3.8-flash-tts', voiceName: 'Herald', temperature: 0.8, styleNote: 'Read this as a herald crying news on the Rostra.' },
};

/** A client whose TTS model answers with audio and whose other models echo `<grave>` + the narration. */
function makeAi(ttsModels: readonly string[] = [GEMINI_TTS, HERALD.voice.model]) {
  const generateContent = vi.fn(async (params: ContentParams) => {
    if (ttsModels.includes(params.model) && params.config?.responseModalities) return AUDIO_RESPONSE;
    const quoted = params.contents.split('\n')[1];
    return { text: `<grave> ${JSON.parse(quoted)}` };
  });
  const ai: GeminiClient = { models: { generateContent } };
  return { ai, generateContent };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('narrator profiles', () => {
  it('the built-in runs the prep model at LOW thinking and the reference voice', () => {
    expect(narratorProfileSchema.parse(LAMPLIGHT_NARRATOR)).toEqual(LAMPLIGHT_NARRATOR);
    expect(LAMPLIGHT_NARRATOR.prep).toMatchObject({ model: GEMINI_NARRATION_PREP, thinkingLevel: 'low' });
    expect(GEMINI_NARRATION_PREP).toBe('gemini-3.8-flash');
    expect(LAMPLIGHT_NARRATOR.voice).toMatchObject({ model: GEMINI_TTS, voiceName: DEFAULT_NARRATOR_VOICE, temperature: 1 });
    expect(NARRATORS[0]).toBe(LAMPLIGHT_NARRATOR);
    expect(DEFAULT_NARRATOR_ID).toBe('lamplight');
  });

  it('every deployed profile validates, and ids are unique (a bad file fails the build here)', () => {
    const deployed = import.meta.glob('../narration/narrators/*.json', { eager: true, import: 'default' });
    for (const [file, profile] of Object.entries(deployed)) {
      const parsed = narratorProfileSchema.safeParse(profile);
      expect(parsed.success, `${file}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
    expect(NARRATORS).toHaveLength(1 + Object.keys(deployed).length);
    expect(new Set(NARRATORS.map(n => n.id)).size).toBe(NARRATORS.length);
  });

  it('the authoring template is itself a valid profile', () => {
    expect(narratorProfileSchema.safeParse(template).success).toBe(true);
  });

  it('accepts a tuned prep model resource name', () => {
    expect(narratorProfileSchema.safeParse(HERALD).success).toBe(true);
  });

  it('refuses malformed profiles: bad ids, unknown fields, out-of-range values, oversized notes', () => {
    const bad: unknown[] = [
      { ...HERALD, id: 'Forum Herald' },
      { ...HERALD, extra: true },
      { ...HERALD, prep: { ...HERALD.prep, thinkingLevel: 'extreme' } },
      { ...HERALD, prep: { ...HERALD.prep, temperature: 3 } },
      { ...HERALD, prep: { ...HERALD.prep, model: 'bad model id' } },
      { ...HERALD, prep: { ...HERALD.prep, directorNotes: 'x'.repeat(1201) } },
      { ...HERALD, voice: { ...HERALD.voice, voiceName: 'no spaces allowed' } },
      { ...HERALD, voice: { ...HERALD.voice, styleNote: '' } },
    ];
    for (const profile of bad) expect(narratorProfileSchema.safeParse(profile).success).toBe(false);
  });

  it('the loader drops invalid files and id collisions, keeping the built-in first', () => {
    const loaded = loadNarratorProfiles({
      './narrators/b.json': { default: HERALD },
      './narrators/a.json': { default: { ...HERALD, id: 'broken', voice: {} } },
      './narrators/c.json': { ...HERALD, name: 'Impostor' },
      './narrators/d.json': { ...LAMPLIGHT_NARRATOR, name: 'Shadow of the built-in' },
    });
    expect(loaded.map(n => n.id)).toEqual(['lamplight', 'forum-herald']);
    expect(loaded[1].name).toBe('The Forum Herald');
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('narratorById falls back to the built-in for unknown, retired or missing ids', () => {
    const narrators = [LAMPLIGHT_NARRATOR, HERALD];
    expect(narratorById('forum-herald', narrators)).toBe(HERALD);
    expect(narratorById('retired-one', narrators)).toBe(LAMPLIGHT_NARRATOR);
    expect(narratorById(null, narrators)).toBe(LAMPLIGHT_NARRATOR);
  });
});

describe('prompts', () => {
  it("appends the narrator's director notes beneath the hard rules, never in place of them", () => {
    const base = buildDirectorSystemInstruction({ ...HERALD, prep: { ...HERALD.prep, directorNotes: '' } });
    const withNotes = buildDirectorSystemInstruction(HERALD);
    expect(withNotes.startsWith(base)).toBe(true);
    expect(withNotes).toContain('Punch the ends of sentences.');
    expect(withNotes.indexOf('Hard rules')).toBeLessThan(withNotes.indexOf('Punch the ends'));
    expect(buildNarrationPerformancePrompt(NARRATION, HERALD).systemInstruction).toBe(withNotes);
  });

  it("frames the TTS transcript with the narrator's style note and the directions rule", () => {
    const prompt = buildNarrationTtsPrompt('<grave> Rome waits.', HERALD);
    expect(prompt.startsWith('Read this as a herald crying news on the Rostra.')).toBe(true);
    expect(prompt).toContain('never read them aloud');
    expect(prompt.endsWith('## Transcript:\n<grave> Rome waits.')).toBe(true);
  });
});

describe('the pipeline follows the profile', () => {
  it('the built-in: prep model at LOW thinking, then the reference voice', async () => {
    const { ai, generateContent } = makeAi();
    await performNarration(ai, NARRATION, false);
    const [prep, voice] = generateContent.mock.calls.map(call => call[0]);
    expect(prep).toMatchObject({ model: GEMINI_NARRATION_PREP, config: { thinkingConfig: { thinkingLevel: 'LOW' }, temperature: 0.7 } });
    expect(voice).toMatchObject({
      model: GEMINI_TTS,
      config: { temperature: 1, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Brio' } } } },
    });
  });

  it('a deployed profile: its tuned prep model, thinking level, voice and style note', async () => {
    const { ai, generateContent } = makeAi();
    const result = await performNarration(ai, NARRATION, false, HERALD);
    const [prep, voice] = generateContent.mock.calls.map(call => call[0]);
    expect(prep).toMatchObject({ model: 'tunedModels/rome-director-1', config: { thinkingConfig: { thinkingLevel: 'MINIMAL' }, temperature: 0.4 } });
    expect(prep.config?.systemInstruction).toContain('Punch the ends of sentences.');
    expect(voice).toMatchObject({ model: HERALD.voice.model, config: { temperature: 0.8, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Herald' } } } } });
    expect(voice.contents).toBe(buildNarrationTtsPrompt(`<grave> ${NARRATION}`, HERALD));
    expect(result.usedFallback).toBe(false);
  });

  it('no profile can loosen the guard: a word-changing script is still refused', async () => {
    const generateContent = vi.fn(async (params: ContentParams) => (params.config?.responseModalities
      ? AUDIO_RESPONSE
      : { text: `<grave> The Senate waits. Maximinus says the Guard is his.` }));
    const result = await performNarration({ models: { generateContent } }, NARRATION, false, HERALD);
    expect(result).toMatchObject({ usedFallback: true, transcript: fallbackTranscript(NARRATION) });
  });
});

describe('the narrator preference', () => {
  it('round-trips a valid id and ignores a malformed stored value', () => {
    expect(getNarratorProfileId()).toBeNull();
    setNarratorProfileId('forum-herald');
    expect(getNarratorProfileId()).toBe('forum-herald');
    localStorage.setItem('gloryOfRome:narratorProfile', '<script>');
    expect(getNarratorProfileId()).toBeNull();
  });

  it('the hook performs with the chosen narrator, persists it, and keys the cache by narrator', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let n = 0;
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:n-${++n}`), revokeObjectURL: vi.fn() });
    const { ai, generateContent } = makeAi();
    const messages: Message[] = [{ sender: 'gm', text: NARRATION }];
    const args: UseNarrationVoiceArgs = {
      ai, isMockMode: false, resolvedApiKey: 'k', messages, gameState: GameState.AWAITING_PLAYER_INPUT, narrators: [LAMPLIGHT_NARRATOR, HERALD],
    };
    const hook = renderHook(useNarrationVoice, args);
    expect(hook.current.narratorId).toBe('lamplight');

    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    expect(generateContent.mock.calls.at(-1)?.[0].model).toBe(GEMINI_TTS);

    act(() => hook.current.handleSetNarrator('forum-herald'));
    expect(hook.current.narratorId).toBe('forum-herald');
    expect(getNarratorProfileId()).toBe('forum-herald');
    expect(hook.current.narrationPlayback.status).toBe('idle');

    const callsBefore = generateContent.mock.calls.length;
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    // A new narrator is a new performance, not the lamplit clip from the cache.
    expect(generateContent.mock.calls.length).toBe(callsBefore + 2);
    expect(generateContent.mock.calls[callsBefore][0].model).toBe('tunedModels/rome-director-1');

    act(() => hook.current.handleSetNarrator('never-deployed'));
    expect(hook.current.narratorId).toBe('lamplight');
    hook.unmount();
  });
});

describe('Settings: the narrator picker', () => {
  function renderSettings(props: Partial<React.ComponentProps<typeof SettingsMenu>>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(
      <SettingsMenu
        onClose={vi.fn()}
        apiKey={null}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        pacingPosture="balanced"
        onSetPacingPosture={vi.fn()}
        isNox={false}
        onSetIsNox={vi.fn()}
        gmConsoleEnabled
        onSetGmConsoleEnabled={vi.fn()}
        gmInterventionEnabled
        onSetGmInterventionEnabled={vi.fn()}
        narrationVoiceMode="on_demand"
        onSetNarrationVoiceMode={vi.fn()}
        isMockMode={false}
        onSetIsMockMode={vi.fn()}
        gmConsoleOpen={false}
        onSetGmConsoleOpen={vi.fn()}
        hasSavedReign={false}
        onExportReign={vi.fn()}
        {...props}
      />,
    ));
    return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
  }
  const picker = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Narrator"]');

  it('stays hidden with only the built-in deployed, or while the voice is silent', () => {
    const single = renderSettings({ narrators: [LAMPLIGHT_NARRATOR], narratorId: 'lamplight', onSetNarrator: vi.fn() });
    expect(picker(single.host)).toBeNull();
    single.cleanup();
    const silent = renderSettings({ narrationVoiceMode: 'off', narrators: [LAMPLIGHT_NARRATOR, HERALD], narratorId: 'lamplight', onSetNarrator: vi.fn() });
    expect(picker(silent.host)).toBeNull();
    silent.cleanup();
  });

  it('offers each deployed narrator, describes the chosen one, and reports a choice', () => {
    const onSetNarrator = vi.fn();
    const view = renderSettings({ narrators: [LAMPLIGHT_NARRATOR, HERALD], narratorId: 'forum-herald', onSetNarrator });
    const group = picker(view.host)!;
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map(r => r.textContent)).toEqual(['The Lamplit Storyteller', 'The Forum Herald']);
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe(HERALD.description);
    act(() => radios[0].click());
    expect(onSetNarrator).toHaveBeenLastCalledWith('lamplight');
    view.cleanup();
  });
});

describe('the tuning harness core', () => {
  it('reports acceptance, refusals with the verbatim script, call failures and audio', async () => {
    const scripts = [
      (n: string) => `<low> ${n}`, // accepted
      (n: string) => `<low> ${n} And the Guard marches.`, // adds words: refused
      () => { throw new Error('rate limited'); }, // no script
    ];
    let call = 0;
    const generateContent = vi.fn(async (params: ContentParams) => {
      if (params.config?.responseModalities) return AUDIO_RESPONSE;
      const narration = JSON.parse(params.contents.split('\n')[1]) as string;
      const script = scripts[call++];
      return { text: script(narration) };
    });
    const clock = { t: 0 };
    const narrations = ['Rome waits.', 'The Senate is silent.', 'Night falls.'];
    const results = await runNarratorTuning({
      ai: { models: { generateContent } }, narrator: LAMPLIGHT_NARRATOR, narrations, withAudio: true, now: () => (clock.t += 10),
    });

    expect(results.map(r => r.accepted)).toEqual([true, false, false]);
    expect(results[1]).toMatchObject({ rejection: expect.any(String), directorOutput: '<low> The Senate is silent. And the Guard marches.' });
    expect(results[1].transcript).toBe(fallbackTranscript('The Senate is silent.'));
    expect(results[2]).toMatchObject({ rejection: 'director_call_failed', directorOutput: null });
    for (const r of results) expect(r.audio && 'wav' in r.audio && r.audio.wav.length).toBe(44 + 4);

    const summary = summarizeTuning(LAMPLIGHT_NARRATOR, results);
    expect(summary).toMatchObject({ narratorId: 'lamplight', prepModel: GEMINI_NARRATION_PREP, passages: 3, accepted: 1, meanDirectionsPerAcceptedScript: 1 });
    expect(summary.acceptanceRate).toBeCloseTo(1 / 3);
    expect(summary.rejections.director_call_failed).toBe(1);

    const report = formatTuningReport(summary, results);
    expect(report).toContain('Accepted: 1/3 (33%)');
    expect(report).toContain('And the Guard marches.');
    expect(report).toContain('Audio: 48 bytes');
  });

  it('counts directions and ships a usable fixture set', () => {
    expect(countDirections('<a> one <b> two <c>')).toBe(3);
    expect(countDirections('no directions')).toBe(0);
    expect(fixtures.narrations.length).toBeGreaterThanOrEqual(6);
    for (const passage of fixtures.narrations) expect(passage.trim().length).toBeGreaterThan(0);
  });
});
