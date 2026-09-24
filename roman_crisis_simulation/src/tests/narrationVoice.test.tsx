/**
 * @vitest-environment jsdom
 *
 * tests/narrationVoice.test.tsx
 *
 * "Hear it performed": hooks/useNarrationVoice.ts + components/Chat.tsx's
 * NarrationVoiceControl, wired exactly as App.tsx wires them, plus the
 * narration/narrationPlayer.ts controller and the SettingsMenu preference.
 * jsdom has no media pipeline, so HTMLMediaElement play/pause and
 * URL.createObjectURL/revokeObjectURL are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GameState, type Message } from '../types';
import { ChatMessage, NARRATION_VOICE_COPY, StreamingNarrationBubble } from '../components/Chat';
import { useNarrationVoice, type UseNarrationVoiceArgs } from '../hooks/useNarrationVoice';
import { GEMINI_NARRATION_PREP, GEMINI_TTS, type GeminiClient } from '../ai/core/geminiService';
import { buildNarrationTtsPrompt } from '../ai/prompts/narrationPerformance';
import { fallbackTranscript } from '../narration/performanceScript';
import { NarrationPlayer } from '../narration/narrationPlayer';
import { getNarrationVoiceMode, setNarrationVoiceMode } from '../persistence/uiPrefs';
import SettingsMenu from '../components/SettingsMenu';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MODE_KEY = 'gloryOfRome:narrationVoiceMode';
const GM_A = 'The Senate waits. Maximinus says nothing.';
const GM_B = 'Rain falls on the Forum, and the grain barges are late.';

const MESSAGES: Message[] = [
  { sender: 'ribbon', text: 'Week I', ribbonDate: { week: 1, year: 235 } },
  { sender: 'player', text: 'I go to the Curia.' },
  { sender: 'gm', text: GM_A },
  { sender: 'player_monologue', text: 'They are watching me.' },
  { sender: 'gm', text: GM_B },
];
const GM_A_INDEX = 2;
const GM_B_INDEX = 4;

const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };

type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };

/** A client whose director answers with `director(narration prompt)` and whose TTS returns 4 bytes. */
function makeAi(director: (prompt: string) => string = prompt => `<grave> ${JSON.parse(prompt.split('\n')[1])}`) {
  const generateContent = vi.fn(async (params: ContentParams) => {
    if (params.model === GEMINI_TTS) return AUDIO_RESPONSE;
    return { text: director(params.contents) };
  });
  const ai: GeminiClient = { models: { generateContent } };
  return { ai, generateContent };
}

let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  createUrl = vi.fn(() => `blob:narration-${++n}`);
  revokeUrl = vi.fn();
  Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

interface HarnessProps {
  ai: GeminiClient;
  isMockMode?: boolean;
  apiKey?: string | null;
  messages?: Message[];
  gameState?: GameState;
  streaming?: string;
}

/** App.tsx's own wiring, minus everything else App does. */
const Harness: React.FC<HarnessProps> = ({ ai, isMockMode = false, apiKey = 'test-key', messages = MESSAGES, gameState = GameState.AWAITING_PLAYER_INPUT, streaming = '' }) => {
  const { toggleNarrationVoice, narrationVoiceStateFor } = useNarrationVoice({ ai, isMockMode, resolvedApiKey: apiKey, messages, gameState });
  return (
    <div role="log">
      {messages.map((msg, index) => (
        <ChatMessage key={index} message={msg} index={index} voiceState={narrationVoiceStateFor(msg, index)} onToggleVoice={toggleNarrationVoice} />
      ))}
      <StreamingNarrationBubble text={streaming} />
    </div>
  );
};

let host: HTMLDivElement;
let root: Root;

function mount(props: HarnessProps) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness {...props} />));
  return {
    rerender: (next: HarnessProps) => act(() => root.render(<Harness {...next} />)),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('.gor-voice-btn')];
const bubbleOf = (text: string) => [...host.querySelectorAll<HTMLElement>('.gor-msg')].find(el => el.textContent?.includes(text))!;
const buttonIn = (text: string) => bubbleOf(text).querySelector<HTMLButtonElement>('.gor-voice-btn');
const click = (button: HTMLButtonElement | null) => act(() => { button!.click(); });
/** Lets every pending promise in the pipeline settle. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('the control', () => {
  it('renders nothing while the voice is off (the default)', () => {
    const { ai } = makeAi();
    const view = mount({ ai });
    expect(getNarrationVoiceMode()).toBe('off');
    expect(buttons()).toHaveLength(0);
    view.unmount();
  });

  it('renders only on committed GM narration - not player, monologue, ribbon or the streaming bubble', () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai } = makeAi();
    const view = mount({ ai, streaming: 'The chronicler is still writ' });
    expect(buttons()).toHaveLength(2);
    expect(buttonIn(GM_A)).not.toBeNull();
    expect(buttonIn(GM_B)).not.toBeNull();
    expect(buttonIn('I go to the Curia.')).toBeNull();
    expect(buttonIn('They are watching me.')).toBeNull();
    expect(host.querySelector('.gor-nib')?.closest('.gor-msg')?.querySelector('.gor-voice-btn')).toBeNull();
    view.unmount();
  });

  it('has an accessible name, a pressed state and no press while idle', () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const view = mount({ ai: makeAi().ai });
    const button = buttonIn(GM_A)!;
    expect(button.textContent).toContain(NARRATION_VOICE_COPY.button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.type).toBe('button');
    view.unmount();
  });

  it('is disabled, with the existing no-key words, when there is no key and no Mock Mode - and calls nothing', () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai, apiKey: null });
    const button = buttonIn(GM_A)!;
    expect(button.disabled).toBe(true);
    expect(bubbleOf(GM_A).textContent).toContain('No token on this device');
    click(button);
    expect(generateContent).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('playback', () => {
  it('goes idle -> preparing -> playing -> idle', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    let releaseDirector!: () => void;
    const directorGate = new Promise<void>(resolve => { releaseDirector = resolve; });
    const generateContent = vi.fn(async (params: ContentParams) => {
      if (params.model === GEMINI_TTS) return AUDIO_RESPONSE;
      await directorGate;
      return { text: `<grave> ${GM_A}` };
    });
    const view = mount({ ai: { models: { generateContent } } });

    click(buttonIn(GM_A));
    const button = buttonIn(GM_A)!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(bubbleOf(GM_A).textContent).toContain(NARRATION_VOICE_COPY.preparing);
    expect(bubbleOf(GM_A).querySelector('.gor-voice-spinner')).not.toBeNull();

    releaseDirector();
    await settle();
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    expect(buttonIn(GM_A)!.hasAttribute('aria-busy')).toBe(false);
    expect(bubbleOf(GM_A).querySelector('.gor-voice-playing')).not.toBeNull();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect((createUrl.mock.calls[0][0] as Blob).type).toBe('audio/wav');

    const audio = playSpy.mock.contexts[0] as HTMLAudioElement;
    expect(audio.src).toBe('blob:narration-1');
    act(() => { audio.dispatchEvent(new Event('ended')); });
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('false');
    view.unmount();
  });

  it('pressing again stops the performance', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const view = mount({ ai: makeAi().ai });
    click(buttonIn(GM_A));
    await settle();
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    click(buttonIn(GM_A));
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('false');
    expect(pauseSpy).toHaveBeenCalled();
    view.unmount();
  });

  it('plays one clip at a time: starting another stops the first', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const view = mount({ ai: makeAi().ai });
    click(buttonIn(GM_A));
    await settle();
    const pausesBefore = pauseSpy.mock.calls.length;

    click(buttonIn(GM_B));
    expect(pauseSpy.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('false');
    await settle();
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('false');
    expect(buttonIn(GM_B)!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.gor-voice-btn[aria-pressed="true"]')).toHaveLength(1);
    // One element for the whole transcript, now carrying B's clip.
    expect(new Set(playSpy.mock.contexts).size).toBe(1);
    expect((playSpy.mock.contexts[1] as HTMLAudioElement).src).toBe('blob:narration-2');
    view.unmount();
  });

  it('reuses the cached clip: no second API call for the same message', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai });
    click(buttonIn(GM_A));
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(2); // director + voice
    click(buttonIn(GM_A)); // stop
    click(buttonIn(GM_A)); // play again
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('a double press while preparing never renders twice', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai });
    click(buttonIn(GM_A)); // preparing
    click(buttonIn(GM_A)); // stop
    click(buttonIn(GM_A)); // preparing again - joins the in-flight render
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('voices the plain narration when the director\'s script fails validation', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai, generateContent } = makeAi(() => `<Philip leans in> ${GM_A} And the heir hides in Emesa.`);
    const view = mount({ ai });
    click(buttonIn(GM_A));
    await settle();
    expect(generateContent.mock.calls[0][0].model).toBe(GEMINI_NARRATION_PREP);
    expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    const ttsCall = generateContent.mock.calls[1][0];
    expect(ttsCall.model).toBe(GEMINI_TTS);
    expect(ttsCall.contents).toBe(buildNarrationTtsPrompt(fallbackTranscript(GM_A)));
    expect(ttsCall.contents).not.toContain('Emesa');
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('shows the error state when the voice call fails, and a press retries', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    let fail = true;
    const generateContent = vi.fn(async (params: ContentParams) => {
      if (params.model === GEMINI_TTS) {
        if (fail) return { text: '' };
        return AUDIO_RESPONSE;
      }
      return { text: GM_A };
    });
    const view = mount({ ai: { models: { generateContent } } });
    click(buttonIn(GM_A));
    await settle();
    expect(bubbleOf(GM_A).textContent).toContain(NARRATION_VOICE_COPY.error);
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('false');
    fail = false;
    click(buttonIn(GM_A));
    await settle();
    expect(buttonIn(GM_A)!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('Mock Mode plays the synthesized tone with no network call', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai, isMockMode: true, apiKey: null });
    click(buttonIn(GM_A));
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(44 + 24000 * 0.4 * 2);
    view.unmount();
  });

  it('unmount stops playback and revokes every object URL', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const view = mount({ ai: makeAi().ai });
    click(buttonIn(GM_A));
    await settle();
    click(buttonIn(GM_B));
    await settle();
    view.unmount();
    expect(revokeUrl.mock.calls.map(call => call[0]).sort()).toEqual(['blob:narration-1', 'blob:narration-2']);
  });
});

describe('auto mode', () => {
  it('plays the newest GM narration once the turn commits - never mid-stream', async () => {
    localStorage.setItem(MODE_KEY, 'auto');
    const { ai, generateContent } = makeAi();
    const before = MESSAGES.slice(0, 3);
    const view = mount({ ai, messages: before });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();

    const pending: Message[] = [...before, { sender: 'player', text: 'I wait.' }];
    view.rerender({ ai, messages: pending, gameState: GameState.PROCESSING, streaming: 'Rain fa' });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();

    // TURN_COMMITTED lands the messages while still PROCESSING...
    const committed: Message[] = [...pending, { sender: 'gm', text: GM_B }];
    view.rerender({ ai, messages: committed, gameState: GameState.PROCESSING });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();

    // ...and the voice starts once the turn is over.
    view.rerender({ ai, messages: committed, gameState: GameState.AWAITING_PLAYER_INPUT });
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].contents).toContain('Rain falls on the Forum');
    expect(buttonIn(GM_B)!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('never autoplays a narration restored from a save', async () => {
    localStorage.setItem(MODE_KEY, 'auto');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai, messages: [], gameState: GameState.SETUP });
    view.rerender({ ai, messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    view.unmount();
  });

  it('a turn that rolls back (no new narration) plays nothing', async () => {
    localStorage.setItem(MODE_KEY, 'auto');
    const { ai, generateContent } = makeAi();
    const view = mount({ ai });
    view.rerender({ ai, gameState: GameState.PROCESSING });
    view.rerender({ ai, gameState: GameState.AWAITING_PLAYER_INPUT });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it('a blocked autoplay goes quietly back to idle, not to an error', async () => {
    localStorage.setItem(MODE_KEY, 'auto');
    playSpy.mockRejectedValue(new DOMException('play() needs a gesture', 'NotAllowedError'));
    const { ai } = makeAi();
    const view = mount({ ai, messages: MESSAGES.slice(0, 2) });
    view.rerender({ ai, messages: MESSAGES.slice(0, 2), gameState: GameState.PROCESSING });
    view.rerender({ ai, messages: MESSAGES, gameState: GameState.PROCESSING });
    view.rerender({ ai, messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT });
    await settle();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(buttonIn(GM_B)!.getAttribute('aria-pressed')).toBe('false');
    expect(bubbleOf(GM_B).textContent).not.toContain(NARRATION_VOICE_COPY.error);
    view.unmount();
  });
});

describe('hook contract', () => {
  it('keeps toggleNarrationVoice stable across renders, so memoised bubbles hold', () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai } = makeAi();
    const args: UseNarrationVoiceArgs = { ai, isMockMode: false, resolvedApiKey: 'k', messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT };
    const hook = renderHook(useNarrationVoice, args);
    const first = hook.current.toggleNarrationVoice;
    hook.rerender({ ...args, messages: [...MESSAGES], gameState: GameState.PROCESSING });
    hook.rerender({ ...args, isMockMode: true, resolvedApiKey: null });
    expect(hook.current.toggleNarrationVoice).toBe(first);
    expect(hook.current.narrationVoiceStateFor(MESSAGES[GM_A_INDEX], GM_A_INDEX)).toBe('idle');
    expect(hook.current.narrationVoiceStateFor(MESSAGES[1], 1)).toBeUndefined();
    hook.unmount();
  });

  it('persists the chosen mode and reads it back on the next mount', () => {
    const { ai } = makeAi();
    const args: UseNarrationVoiceArgs = { ai, isMockMode: true, resolvedApiKey: null, messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT };
    const hook = renderHook(useNarrationVoice, args);
    expect(hook.current.narrationVoiceMode).toBe('off');
    act(() => hook.current.handleSetNarrationVoiceMode('auto'));
    expect(hook.current.narrationVoiceMode).toBe('auto');
    expect(localStorage.getItem(MODE_KEY)).toBe('auto');
    hook.unmount();
    const again = renderHook(useNarrationVoice, args);
    expect(again.current.narrationVoiceMode).toBe('auto');
    expect(again.current.narrationVoiceStateFor(MESSAGES[GM_B_INDEX], GM_B_INDEX)).toBe('idle');
    again.unmount();
  });

  it('turning the voice off stops what is playing', async () => {
    localStorage.setItem(MODE_KEY, 'on_demand');
    const { ai } = makeAi();
    const args: UseNarrationVoiceArgs = { ai, isMockMode: false, resolvedApiKey: 'k', messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT };
    const hook = renderHook(useNarrationVoice, args);
    act(() => hook.current.toggleNarrationVoice(GM_A_INDEX, GM_A));
    await settle();
    expect(hook.current.narrationPlayback).toEqual({ index: GM_A_INDEX, status: 'playing' });
    act(() => hook.current.handleSetNarrationVoiceMode('off'));
    expect(hook.current.narrationPlayback).toEqual({ index: null, status: 'idle' });
    hook.unmount();
  });
});

describe('NarrationPlayer cache', () => {
  it('evicts least-recently-used clips past its cap and revokes their URLs', async () => {
    const render = vi.fn(async (text: string) => new Blob([text], { type: 'audio/wav' }));
    const player = new NarrationPlayer({ maxCached: 2 });
    player.setRenderer(render, 'test');
    await player.play(0, 'zero');
    await player.play(1, 'one');
    await player.play(0, 'zero'); // touch 0: now 1 is the oldest
    await player.play(2, 'two'); // evicts 1
    expect(player.cachedCount).toBe(2);
    expect(revokeUrl).toHaveBeenCalledWith('blob:narration-2');
    await player.play(0, 'zero');
    expect(render).toHaveBeenCalledTimes(3);
    await player.play(1, 'one');
    expect(render).toHaveBeenCalledTimes(4);
    player.dispose();
    expect(player.cachedCount).toBe(0);
  });

  it('keys on the text as well as the index: an edited message renders afresh', async () => {
    const render = vi.fn(async () => new Blob(['x'], { type: 'audio/wav' }));
    const player = new NarrationPlayer();
    player.setRenderer(render, 'test');
    await player.play(3, 'before');
    await player.play(3, 'after');
    expect(render).toHaveBeenCalledTimes(2);
    player.dispose();
  });
});

describe('settings', () => {
  it('uiPrefs defaults to off, round-trips, and rejects junk', () => {
    expect(getNarrationVoiceMode()).toBe('off');
    setNarrationVoiceMode('on_demand');
    expect(getNarrationVoiceMode()).toBe('on_demand');
    setNarrationVoiceMode('auto');
    expect(getNarrationVoiceMode()).toBe('auto');
    localStorage.setItem(MODE_KEY, 'loud');
    expect(getNarrationVoiceMode()).toBe('off');
  });

  it('uiPrefs never throws when storage does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(getNarrationVoiceMode()).toBe('off');
    expect(() => setNarrationVoiceMode('auto')).not.toThrow();
  });

  it('SettingsMenu offers the three modes as a radio group and reports a choice', () => {
    const onSetNarrationVoiceMode = vi.fn();
    const settingsHost = document.createElement('div');
    document.body.appendChild(settingsHost);
    const settingsRoot = createRoot(settingsHost);
    act(() => settingsRoot.render(
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
        narrationVoiceMode="off"
        onSetNarrationVoiceMode={onSetNarrationVoiceMode}
        isMockMode={false}
        onSetIsMockMode={vi.fn()}
        gmConsoleOpen={false}
        onSetGmConsoleOpen={vi.fn()}
        hasSavedReign={false}
        onExportReign={vi.fn()}
      />,
    ));
    const group = settingsHost.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Narrator\'s voice"]')!;
    expect(group).not.toBeNull();
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map(radio => radio.textContent)).toEqual(['SILENT', 'ON REQUEST', 'EVERY WEEK']);
    expect(radios.map(radio => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map(radio => radio.tabIndex)).toEqual([0, -1, -1]);
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('The narration is read, not heard.');

    act(() => radios[1].click());
    expect(onSetNarrationVoiceMode).toHaveBeenLastCalledWith('on_demand');
    act(() => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(onSetNarrationVoiceMode).toHaveBeenLastCalledWith('auto');

    act(() => settingsRoot.unmount());
    settingsHost.remove();
  });
});
