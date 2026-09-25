/**
 * @vitest-environment jsdom
 *
 * tests/privateSceneVoice.test.tsx
 *
 * "Hear them speak" (hooks/usePrivateSceneVoice.ts, narration/sceneVoice.ts):
 * a private-scene NPC's committed lines voiced in their own deterministic
 * voice - no prep call, committed player-visible lines only, NPC lines
 * only, offered only while the narration voice is on and off by default,
 * logged as "Private scene with <name>".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GeminiClient } from '../ai/core/geminiService';
import { cleanSceneLineForSpeech, npcVoiceFor } from '../narration/sceneVoice';
import { NARRATOR_VOICES, getSceneVoicesEnabled } from '../persistence/uiPrefs';
import { NarrationLogStore } from '../narration/narrationLog';
import { usePrivateSceneVoice, type UsePrivateSceneVoiceArgs, type PrivateSceneNpcVoice } from '../hooks/usePrivateSceneVoice';
import { PrivateScene } from '../components/PrivateScene';
import { projectPrivateSceneForPlayer, type PrivateScenePlayerView } from '../perception/visibility';
import type { PrivateSceneRecord } from '../privateScene/model';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };

const rawScene: PrivateSceneRecord = {
  sceneId: 'scene-2-julia', macroTurn: 2, playerId: 'player', npcId: 'julia',
  playerName: 'Severus', npcName: 'Julia Mamaea', status: 'active',
  transcript: [
    { sequence: 1, speaker: 'player', text: 'Speak plainly, mother.' },
    { sequence: 2, speaker: 'npc', text: '*She sets down her cup.* My son trusts you. **Do not** make me regret it.' },
  ],
  npcResponseCount: 1, speechActs: [],
  npcPrivate: { sincerity: 'NPC_PRIVATE_SINCERITY', hiddenIntent: 'NPC_PRIVATE_INTENT', plannedFollowThrough: ['NPC_PRIVATE_PLAN'] },
  consequenceStatus: 'pending',
};
const view = projectPrivateSceneForPlayer(rawScene);

function makeAi() {
  const generateContent = vi.fn(async (params: ContentParams) => (params.config?.responseModalities ? AUDIO_RESPONSE : { text: 'never' }));
  const ai: GeminiClient = { models: { generateContent } };
  return { ai, generateContent };
}

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:s-${++n}`), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the NPC voice', () => {
  it('is deterministic per entity, always a curated voice, and avoids the narrator\'s voice', () => {
    const curated = NARRATOR_VOICES.map(v => v.id as string);
    for (const id of ['julia', 'maximinus', 'npc_venena', 'x']) {
      expect(npcVoiceFor(id)).toBe(npcVoiceFor(id));
      expect(curated).toContain(npcVoiceFor(id));
      for (const narrator of curated) expect(npcVoiceFor(id, narrator)).not.toBe(narrator);
    }
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(id => npcVoiceFor(id)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('cleans a committed line for speech: stage business, bold and bracketed asides go; the words stay', () => {
    expect(cleanSceneLineForSpeech('*She sets down her cup.* My son trusts you. **Do not** make me regret it.')).toBe('My son trusts you. Do not make me regret it.');
    expect(cleanSceneLineForSpeech('[aside] Go <softly> now , friend.')).toBe('Go now, friend.');
    expect(cleanSceneLineForSpeech('*silence*')).toBe('');
    expect(cleanSceneLineForSpeech('Plain words.')).toBe('Plain words.');
  });
});

describe('the hook', () => {
  function mount(extra: Partial<UsePrivateSceneVoiceArgs> = {}) {
    const { ai, generateContent } = makeAi();
    const log = new NarrationLogStore({ load: false });
    const args: UsePrivateSceneVoiceArgs = { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand', narratorVoice: 'Enceladus', week: 2, log, ...extra };
    return { hook: renderHook(usePrivateSceneVoice, args), generateContent, log };
  }

  it('is not offered while the narration voice is SILENT, and is off by default', () => {
    expect(mount({ narrationVoiceMode: 'off' }).hook.current).toBeUndefined();
    const { hook } = mount();
    expect(hook.current?.enabled).toBe(false);
    expect(hook.current?.stateFor(view, view.transcript[1])).toBeUndefined();
    act(() => hook.current!.onSetEnabled(true));
    expect(getSceneVoicesEnabled()).toBe(true);
    hook.unmount();
  });

  it('speaks a committed NPC line in their voice with no prep call, and logs it', async () => {
    const { hook, generateContent, log } = mount();
    act(() => hook.current!.onSetEnabled(true));
    expect(hook.current!.stateFor(view, view.transcript[0])).toBeUndefined(); // the player's own line
    expect(hook.current!.stateFor(view, view.transcript[1])).toBe('idle');
    act(() => hook.current!.onToggle(view, view.transcript[1]));
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.config?.responseModalities).toBeTruthy();
    expect(call.contents).toBe('My son trusts you. Do not make me regret it.');
    const voice = (call.config?.speechConfig as { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }).voiceConfig.prebuiltVoiceConfig.voiceName;
    expect(voice).toBe(npcVoiceFor('julia', 'Enceladus'));
    expect(voice).not.toBe('Enceladus');
    expect(hook.current!.stateFor(view, view.transcript[1])).toBe('playing');
    expect(log.getSnapshot()[0]).toMatchObject({
      kind: 'private_scene', sourceLabel: 'Private scene with Julia Mamaea', narratorName: 'Julia Mamaea', voice,
      voiceStyle: null, transcript: 'My son trusts you. Do not make me regret it.', patchedOut: [], usedFallback: false, turn: 2,
    });
    expect(JSON.stringify(log.getSnapshot())).not.toContain('NPC_PRIVATE');

    // A player line never speaks, even when asked.
    act(() => hook.current!.onToggle(view, view.transcript[0]));
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('Mock Mode speaks the tone offline', async () => {
    const { hook, generateContent, log } = mount({ isMockMode: true, resolvedApiKey: null });
    act(() => hook.current!.onSetEnabled(true));
    act(() => hook.current!.onToggle(view, view.transcript[1]));
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });
});

describe('the private scene surface', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
  afterEach(async () => {
    while (mounted.length) {
      const instance = mounted.pop()!;
      await act(async () => instance.root.unmount());
      instance.container.remove();
    }
  });

  function render(npcVoice: PrivateSceneNpcVoice | undefined, scenes: PrivateScenePlayerView[] = [view]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => root.render(<PrivateScene
      scenes={scenes} currentMacroTurn={2} canStartScene={false}
      eligibleTargets={[]} openingDraft="" replyDraft="" lastWordDraft="" loading={false} error={null}
      onOpeningDraftChange={() => {}} onReplyDraftChange={() => {}} onLastWordDraftChange={() => {}}
      onInvite={() => {}} onReply={() => {}} onEnd={() => {}} onLastWord={() => {}} onSkipLastWord={() => {}}
      npcVoice={npcVoice}
    />));
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Private scene')!.click());
    return container;
  }
  const voiceStub = (enabled: boolean): PrivateSceneNpcVoice => ({
    enabled,
    onSetEnabled: vi.fn(),
    stateFor: vi.fn((_scene, line) => (enabled && line.speaker === 'npc' ? 'idle' as const : undefined)),
    onToggle: vi.fn(),
  });

  it('shows no switch while the narration voice is silent', () => {
    const container = render(undefined);
    expect(container.querySelector('#private-scene-voices')).toBeNull();
    expect(container.querySelector('.gor-voice-btn')).toBeNull();
  });

  it('the switch is off by default and turns the voices on', () => {
    const npcVoice = voiceStub(false);
    const container = render(npcVoice);
    const toggle = container.querySelector<HTMLInputElement>('#private-scene-voices')!;
    expect(toggle.checked).toBe(false);
    expect(toggle.closest('label')!.textContent).toBe('Hear them speak');
    expect(container.querySelector('.gor-voice-btn')).toBeNull();
    act(() => toggle.click());
    expect(npcVoice.onSetEnabled).toHaveBeenCalledWith(true);
  });

  it('once on, only the NPC\'s committed lines carry a control, and it hands over the committed line', () => {
    const npcVoice = voiceStub(true);
    const container = render(npcVoice);
    const controls = [...container.querySelectorAll<HTMLButtonElement>('.gor-voice-btn')];
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toContain('Hear them say it');
    act(() => controls[0].click());
    expect(npcVoice.onToggle).toHaveBeenCalledWith(view, view.transcript[1]);
    expect(container.textContent).not.toContain('NPC_PRIVATE');
  });
});
