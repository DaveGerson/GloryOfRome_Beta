/**
 * @vitest-environment jsdom
 *
 * tests/auditFixVoiceUi.test.tsx
 *
 * Regression cases for the voice cluster of the September 2026 audit, React
 * side: the voice hooks (no paid call after SILENT or a stop, no second prep
 * call after a failed voice, no endless casting at the cast's cap, replay in
 * the voice an entry was logged with), the narration log's and the
 * custom-narrator editor's focus, the private scene (failure titles, turn
 * labels, the NPC's voice stopping with the dialog, the opener's look) and
 * its controller (drafts and failures that must not outlive their scene).
 * The pure pieces are pinned in tests/auditFixVoice.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { GameState, type Entity, type Message } from '../types';
import { GEMINI_NARRATION_PREP, GEMINI_TTS, type GeminiClient } from '../ai/core/geminiService';
import { NarrationLogStore, type NarrationLogInput } from '../narration/narrationLog';
import { useNarrationVoice } from '../hooks/useNarrationVoice';
import { useImperialDispatch } from '../hooks/useImperialDispatch';
import { useNarrationLog } from '../hooks/useNarrationLog';
import { useCastBasis, useVoiceCast } from '../hooks/useVoiceCast';
import { usePrivateSceneController, type PrivateSceneControllerDeps } from '../hooks/usePrivateSceneController';
import type { PrivateSceneNpcVoice } from '../hooks/usePrivateSceneVoice';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';
import { deterministicCast, MAX_CAST_MEMBERS, type CastingCandidate, type VoiceCast } from '../narration/voiceCast';
import type { GameAction } from '../state/gameReducer';
import type { RunDomainMutation } from '../state/domainMutation';
import type { DomainCommit } from '../app/transactions';
import type { SaveGameState } from '../persistence/saveGame';
import type { PrivateSceneRecord } from '../privateScene/model';
import { projectPrivateSceneForPlayer } from '../perception/visibility';
import * as voiceCasting from '../ai/tools/voiceCasting';
import { NarrationLog, NARRATION_LOG_COPY } from '../components/NarrationLog';
import { CustomNarratorEditor, CUSTOM_NARRATOR_COPY } from '../components/CustomNarratorEditor';
import { PrivateScene } from '../components/PrivateScene';
import { PRIVATE_SCENE_FAILURE_COPY, PrivateSceneFailureNotice, type PrivateSceneFailure } from '../components/ui/FailureNotices';
import { VoiceStylePicker } from '../components/VoiceStylePicker';
import type { CustomNarrator } from '../narration/customNarrators';
import { makeEntity, makeWorldState } from './factories';
import { getMockInitialState } from './mockData';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The casting director, passed through unless a test stands in for it.
const castingStandIn = vi.hoisted(() => ({ fn: null as null | ((...args: unknown[]) => unknown) }));
vi.mock('../ai/tools/voiceCasting', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/tools/voiceCasting')>();
  return {
    ...actual,
    castVoices: vi.fn((...args: Parameters<typeof actual.castVoices>) => (castingStandIn.fn ? castingStandIn.fn(...args) : actual.castVoices(...args))),
  };
});

const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };
const voiceOf = (call: ContentParams) => (call.config?.speechConfig as { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }).voiceConfig.prebuiltVoiceConfig.voiceName;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

const GM = 'The Senate waits. Maximinus says nothing.';
const MESSAGES: Message[] = [{ sender: 'player', text: 'I go to the Curia.' }, { sender: 'gm', text: GM }];

beforeEach(() => {
  localStorage.clear();
  castingStandIn.fn = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:ui-${++n}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
});

/**
 * A client whose prep call waits for `release`, and whose voice call answers
 * (or fails, per `ttsFails`) - or, with `holdVoice`, waits for `releaseVoice`.
 */
function heldPrepAi(options: { ttsFails?: number; holdVoice?: boolean } = {}) {
  let failures = options.ttsFails ?? 0;
  const releases: Array<() => void> = [];
  const voiceReleases: Array<() => void> = [];
  const generateContent = vi.fn((params: ContentParams) => {
    if (params.model === GEMINI_TTS) {
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error('the voice refused'));
      }
      if (options.holdVoice) return new Promise<typeof AUDIO_RESPONSE>(resolve => voiceReleases.push(() => resolve(AUDIO_RESPONSE)));
      return Promise.resolve(AUDIO_RESPONSE);
    }
    return new Promise<{ text: string }>(resolve => releases.push(() => resolve({ text: `<grave> ${GM}` })));
  });
  const ai: GeminiClient = { models: { generateContent } };
  const models = () => generateContent.mock.calls.map(call => call[0].model);
  const release = () => { releases.splice(0).forEach(fn => fn()); };
  const releaseVoice = () => { voiceReleases.splice(0).forEach(fn => fn()); };
  return { ai, generateContent, models, release, releaseVoice };
}

describe('the narration voice makes no paid call once the performance is unwanted', () => {
  const mountVoice = (ai: GeminiClient, log: NarrationLogStore) => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    return renderHook(useNarrationVoice, { ai, isMockMode: false, resolvedApiKey: 'k', messages: MESSAGES, gameState: GameState.AWAITING_PLAYER_INPUT, log });
  };

  it('SILENT chosen while the script is being written: no voice call, nothing logged', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const hook = mountVoice(ai, log);
    act(() => hook.current.toggleNarrationVoice(1, GM));
    act(() => hook.current.handleSetNarrationVoiceMode('off'));
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP]);
    expect(log.getSnapshot()).toHaveLength(0);
    hook.unmount();
  });

  it('a stop while the script is being written sends no voice call; the next press voices that script with no second prep call', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const hook = mountVoice(ai, log);
    act(() => hook.current.toggleNarrationVoice(1, GM)); // preparing
    act(() => hook.current.toggleNarrationVoice(1, GM)); // stop
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP]);
    expect(log.getSnapshot()).toHaveLength(0);
    act(() => hook.current.toggleNarrationVoice(1, GM));
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.narrationPlayback).toEqual({ index: 1, status: 'playing' });
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('a stop and a press while the script is still being written rejoin it: one prep call, one voice call', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const hook = mountVoice(ai, log);
    act(() => hook.current.toggleNarrationVoice(1, GM)); // preparing
    act(() => hook.current.toggleNarrationVoice(1, GM)); // stop
    act(() => hook.current.toggleNarrationVoice(1, GM)); // press again, the prep call still out
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.narrationPlayback).toEqual({ index: 1, status: 'playing' });
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('a stop and a press while the voice call is out rejoin it: one voice call, one log entry', async () => {
    const { ai, models, release, releaseVoice } = heldPrepAi({ holdVoice: true });
    const log = new NarrationLogStore({ load: false });
    const hook = mountVoice(ai, log);
    act(() => hook.current.toggleNarrationVoice(1, GM));
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    act(() => hook.current.toggleNarrationVoice(1, GM)); // stop
    act(() => hook.current.toggleNarrationVoice(1, GM)); // press again
    releaseVoice();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.narrationPlayback).toEqual({ index: 1, status: 'playing' });
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('after "The voice faltered", pressing again goes straight to the voice', async () => {
    const { ai, models, release } = heldPrepAi({ ttsFails: 1 });
    const log = new NarrationLogStore({ load: false });
    const hook = mountVoice(ai, log);
    act(() => hook.current.toggleNarrationVoice(1, GM));
    release();
    await settle();
    expect(hook.current.narrationPlayback).toEqual({ index: 1, status: 'error' });
    expect(log.getSnapshot()).toHaveLength(0);
    act(() => hook.current.toggleNarrationVoice(1, GM));
    await settle();
    expect(hook.current.narrationPlayback).toEqual({ index: 1, status: 'playing' });
    expect(models().filter(model => model === GEMINI_NARRATION_PREP)).toHaveLength(1);
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('the Imperial Dispatch: turned SILENT while its briefing is being written, its voice call is never made', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const base = {
      ai, isMockMode: false, resolvedApiKey: 'k', worldState: makeWorldState(), entities: [], reports: [], currentEvents: [], turnNumber: 3, log,
    };
    const hook = renderHook(useImperialDispatch, { ...base, narrationVoiceMode: 'on_demand' as NarrationVoiceMode });
    act(() => hook.current.toggleDispatch());
    hook.rerender({ ...base, narrationVoiceMode: 'off' });
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP]);
    expect(log.getSnapshot()).toHaveLength(0);
    hook.unmount();
  });

  const dispatchBase = (ai: GeminiClient, log: NarrationLogStore) => ({
    ai, isMockMode: false, resolvedApiKey: 'k', worldState: makeWorldState(), entities: [], reports: [], currentEvents: [], turnNumber: 3, log,
    narrationVoiceMode: 'on_demand' as NarrationVoiceMode,
  });

  it('the Imperial Dispatch: a stop and a press while its briefing is being written rejoin it - one briefing, one voice call', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const hook = renderHook(useImperialDispatch, dispatchBase(ai, log));
    act(() => hook.current.toggleDispatch());
    act(() => hook.current.toggleDispatch()); // stop
    act(() => hook.current.toggleDispatch()); // press again
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.dispatchStatus).toBe('playing');
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('the Imperial Dispatch: stopped while its briefing is being written, no voice call; the next press voices that briefing', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const hook = renderHook(useImperialDispatch, dispatchBase(ai, log));
    act(() => hook.current.toggleDispatch());
    act(() => hook.current.toggleDispatch()); // stop
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP]);
    expect(log.getSnapshot()).toHaveLength(0);
    act(() => hook.current.toggleDispatch());
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.dispatchStatus).toBe('playing');
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('the Imperial Dispatch: a stop and a press while its voice call is out rejoin it - one voice call, one log entry', async () => {
    const { ai, models, release, releaseVoice } = heldPrepAi({ holdVoice: true });
    const log = new NarrationLogStore({ load: false });
    const hook = renderHook(useImperialDispatch, dispatchBase(ai, log));
    act(() => hook.current.toggleDispatch());
    release();
    await settle();
    act(() => hook.current.toggleDispatch()); // stop
    act(() => hook.current.toggleDispatch()); // press again
    releaseVoice();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP, GEMINI_TTS]);
    expect(hook.current.dispatchStatus).toBe('playing');
    expect(log.getSnapshot()).toHaveLength(1);
    hook.unmount();
  });

  it('the Imperial Dispatch: the key taken away while its briefing is being written, its voice call is never made', async () => {
    const { ai, models, release } = heldPrepAi();
    const log = new NarrationLogStore({ load: false });
    const base = {
      ai, isMockMode: false, worldState: makeWorldState(), entities: [], reports: [], currentEvents: [], turnNumber: 3, log,
      narrationVoiceMode: 'on_demand' as NarrationVoiceMode,
    };
    const hook = renderHook(useImperialDispatch, { ...base, resolvedApiKey: 'k' as string | null });
    act(() => hook.current.toggleDispatch());
    hook.rerender({ ...base, resolvedApiKey: null });
    release();
    await settle();
    expect(models()).toEqual([GEMINI_NARRATION_PREP]);
    expect(log.getSnapshot()).toHaveLength(0);
    hook.unmount();
  });
});

describe('the voice cast at its size cap', () => {
  const DEFAULTS = { narratorId: 'senatorial-partner', voiceName: 'Enceladus' };
  const departed: CastingCandidate[] = Array.from({ length: MAX_CAST_MEMBERS }, (_, i) => ({ entityId: `gone_${i}`, name: `Gone ${i}`, entityType: 'individual' }));
  const FULL = deterministicCast(departed, DEFAULTS);
  const player = makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', position: 'Emperor', visibility_network: ['julia'] });
  const julia = makeEntity({ entity_id: 'julia', name: 'Julia Mamaea', position: 'Regent' });

  function useHarness({ ai, entities, onDispatch }: { ai: GeminiClient; entities: Entity[]; onDispatch: (action: GameAction) => void }) {
    const [voiceCast, setCast] = useState<VoiceCast | null>(FULL);
    const dispatch = useCallback((action: GameAction) => {
      onDispatch(action);
      if (action.type === 'VOICE_CAST_SET') setCast(action.voiceCast);
    }, [onDispatch]);
    const [generationRef] = useState(() => ({ current: 0 }));
    const playerEntity = entities.find(e => e.entity_id === 'severus_alexander') ?? null;
    const basis = useCastBasis({ voiceCast, playerEntity, entities, knowledge: [] });
    useVoiceCast({
      ai, isMockMode: true, resolvedApiKey: null, narrationVoiceMode: 'on_demand', gameState: GameState.AWAITING_PLAYER_INPUT, voiceCast, dispatch,
      playerEntity, basis, metaNarrative: 'A crisis.', campaignGenerationRef: generationRef,
    });
    return { voiceCast };
  }

  it('a cast full of the departed seats the newcomer with one casting, and stops', async () => {
    const onDispatch = vi.fn();
    const ai: GeminiClient = { models: { generateContent: vi.fn() } };
    const hook = renderHook(useHarness, { ai, entities: [player, julia], onDispatch });
    for (let i = 0; i < 5; i++) await settle();
    expect(hook.current.voiceCast?.members.julia).toBeDefined();
    expect(Object.keys(hook.current.voiceCast!.members)).toHaveLength(MAX_CAST_MEMBERS);
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(voiceCasting.castVoices).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('a newcomers casting that seats nobody is neither kept nor asked again for the same newcomers', async () => {
    castingStandIn.fn = async () => ({ cast: { ...FULL, revision: FULL.revision + 1 }, usedFallback: false });
    const onDispatch = vi.fn();
    const ai: GeminiClient = { models: { generateContent: vi.fn() } };
    const hook = renderHook(useHarness, { ai, entities: [player, julia], onDispatch });
    for (let i = 0; i < 5; i++) await settle();
    // A new entities array: new candidates, a new casting callback - the effect runs again.
    hook.rerender({ ai, entities: [player, julia], onDispatch });
    for (let i = 0; i < 3; i++) await settle();
    expect(voiceCasting.castVoices).toHaveBeenCalledTimes(1);
    expect(onDispatch).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe('narration log replay: each entry in the voice it was logged with', () => {
  const sample = (voice: string): NarrationLogInput => ({
    kind: 'voice_sample', sourceLabel: 'Julia Mamaea', sourceText: 'I am Julia Mamaea.', narratorKey: 'npc:julia', narratorName: 'Julia Mamaea',
    voice, voiceStyle: null, transcript: 'I am Julia Mamaea.', patchedOut: [], usedFallback: false,
  });

  it('after "Clear log", the same words logged in another voice are voiced afresh, not answered by the old clip', async () => {
    const generateContent = vi.fn<(params: ContentParams) => Promise<typeof AUDIO_RESPONSE>>(async () => AUDIO_RESPONSE);
    const ai: GeminiClient = { models: { generateContent } };
    const log = new NarrationLogStore({ load: false });
    const hook = renderHook(useNarrationLog, { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand' as const, log });
    const first = log.record(sample('Gacrux'));
    act(() => hook.current.toggleReplay(first));
    await settle();
    act(() => hook.current.clearLog());
    const second = log.record(sample('Kore'));
    expect(second.seq).toBe(first.seq);
    act(() => hook.current.toggleReplay(second));
    await settle();
    expect(hook.current.replayStateFor(second)).toBe('playing');
    expect(generateContent.mock.calls.map(call => voiceOf(call[0]))).toEqual(['Gacrux', 'Kore']);
    hook.unmount();
  });
});

function mountUi(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => root.render(node));
  return { host, root, rerender: (next: React.ReactElement) => act(() => root.render(next)), unmount: () => act(() => root.unmount()) };
}
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
const press = (el: HTMLElement) => act(() => { el.focus(); el.click(); });

describe('narration log: "Clear log" keeps focus inside the dialog', () => {
  function Harness({ log }: { log: NarrationLogStore }) {
    const [entries, setEntries] = useState(log.getSnapshot());
    return <NarrationLog entries={entries} stateFor={() => 'idle'} onToggle={vi.fn()} onClear={() => { log.clear(); setEntries(log.getSnapshot()); }} onClose={vi.fn()} />;
  }

  it('focus moves to Keep, back to "Clear log", and after clearing to the close button - and Escape still closes', () => {
    const log = new NarrationLogStore({ load: false });
    log.record({ kind: 'chronicle', sourceLabel: 'Week II narration', sourceText: GM, narratorKey: 'k', narratorName: 'The Dramatic Reader', voice: 'Enceladus', voiceStyle: null, transcript: GM, patchedOut: [], usedFallback: false });
    const view = mountUi(<Harness log={log} />);
    press(buttonByText(view.host, NARRATION_LOG_COPY.open)!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="narration-log-title"]')!;
    press(buttonByText(dialog, NARRATION_LOG_COPY.clear)!);
    expect(document.activeElement?.textContent).toBe(NARRATION_LOG_COPY.keep);
    press(document.activeElement as HTMLElement);
    expect(document.activeElement?.textContent).toBe(NARRATION_LOG_COPY.clear);
    press(buttonByText(dialog, NARRATION_LOG_COPY.clear)!);
    press(buttonByText(dialog, NARRATION_LOG_COPY.confirm)!);
    expect(log.getSnapshot()).toHaveLength(0);
    const close = document.activeElement as HTMLElement;
    expect(close.getAttribute('aria-label')).toBe(NARRATION_LOG_COPY.close);
    expect(dialog.contains(close)).toBe(true);
    act(() => { close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[aria-labelledby="narration-log-title"]')).toBeNull();
    view.unmount();
  });

  it('the close button takes the shared bare-button class, not an inline reset that hid its focus ring', () => {
    const view = mountUi(<NarrationLog entries={[]} stateFor={() => 'idle'} onToggle={vi.fn()} onClear={vi.fn()} />);
    press(buttonByText(view.host, NARRATION_LOG_COPY.open)!);
    const close = document.querySelector<HTMLButtonElement>(`[aria-label="${NARRATION_LOG_COPY.close}"]`)!;
    expect(close.className).toBe('gor-bare-btn');
    expect(close.style.getPropertyValue('all')).toBe('');
    view.unmount();
  });
});

describe('custom narrators: "Remove" cannot be confirmed by the same press twice', () => {
  const TACITUS: CustomNarrator = { id: 'custom-tacitus', name: 'Tacitus', description: '', brief: 'A historian of the Principate.', voiceName: 'Charon', voiceStyle: null };

  function Harness() {
    const [narrators, setNarrators] = useState<CustomNarrator[]>([TACITUS]);
    return <CustomNarratorEditor narrators={narrators} onSave={() => ({ ok: false, issues: [] })} onDelete={id => setNarrators(prev => prev.filter(n => n.id !== id))} />;
  }

  it('the confirm is a fresh node with focus on Keep; Keep returns focus to "Remove Tacitus"; a removal lands on "New narrator"', () => {
    const view = mountUi(<Harness />);
    press(view.host.querySelector<HTMLButtonElement>('.gor-narrator-editor-toggle')!);
    const remove = view.host.querySelector<HTMLButtonElement>(`[aria-label="${CUSTOM_NARRATOR_COPY.remove} Tacitus"]`)!;
    press(remove);
    // A second Enter lands on whatever holds focus: Keep, never the danger confirm.
    expect(remove.isConnected).toBe(false);
    expect(document.activeElement?.textContent).toBe(CUSTOM_NARRATOR_COPY.keep);
    press(document.activeElement as HTMLElement);
    expect(view.host.textContent).toContain('Tacitus');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`${CUSTOM_NARRATOR_COPY.remove} Tacitus`);
    press(document.activeElement as HTMLElement);
    const confirm = [...view.host.querySelectorAll<HTMLButtonElement>('.gor-btn-danger')].find(b => b.textContent === CUSTOM_NARRATOR_COPY.remove)!;
    press(confirm);
    expect(view.host.querySelector('.gor-narrator-editor-list')).toBeNull();
    expect(document.activeElement?.textContent).toBe(CUSTOM_NARRATOR_COPY.add);
    view.unmount();
  });

  it('its voice select wears the design system select, which follows the skin', () => {
    const view = mountUi(<VoiceStylePicker id="vs" ariaLabel="Voice style" value={null} onChange={vi.fn()} />);
    const select = view.host.querySelector('select')!;
    expect(select.classList.contains('gor-select')).toBe(true);
    expect(select.style.background).toBe('');
    expect(select.style.color).toBe('');
    view.unmount();
  });
});

describe('the private scene dialog', () => {
  const closedScene = (macroTurn: number): PrivateSceneRecord => ({
    sceneId: `private-scene-${macroTurn}-maximinus_thrax`, macroTurn, npcId: 'maximinus_thrax', npcName: 'Maximinus Thrax', status: 'closed',
    transcript: [{ sequence: 1, speaker: 'player', text: 'Speak.' }, { sequence: 2, speaker: 'npc', text: 'Briefly.' }],
    speechActs: [], npcResponseCount: 1, closureReason: 'npc_ended', lastWord: null,
    npcPrivate: { sincerity: 's', hiddenIntent: 'h', plannedFollowThrough: [] },
  } as unknown as PrivateSceneRecord);
  const voice = (): PrivateSceneNpcVoice => ({ enabled: true, blocked: null, onSetEnabled: vi.fn(), stateFor: vi.fn(() => 'idle' as const), onToggle: vi.fn(), stop: vi.fn() });
  const props = (overrides: Partial<React.ComponentProps<typeof PrivateScene>> = {}): React.ComponentProps<typeof PrivateScene> => ({
    scenes: [], currentMacroTurn: 3, canStartScene: true, eligibleTargets: [{ entityId: 'maximinus_thrax', displayName: 'Maximinus Thrax' }],
    openingDraft: '', replyDraft: '', lastWordDraft: '', loading: false, error: null,
    onOpeningDraftChange: vi.fn(), onReplyDraftChange: vi.fn(), onLastWordDraftChange: vi.fn(),
    onInvite: vi.fn(), onReply: vi.fn(), onEnd: vi.fn(), onLastWord: vi.fn(), onSkipLastWord: vi.fn(),
    ...overrides,
  });
  const open = (host: HTMLElement) => press(buttonByText(host, 'Private scene')!);

  it('its opener is the same secondary button as the Narration log beside it, and keeps its command hook', () => {
    const view = mountUi(<PrivateScene {...props()} />);
    const opener = buttonByText(view.host, 'Private scene')!;
    expect(opener.className).toBe('gor-btn gor-btn-md gor-btn-secondary');
    expect(opener.getAttribute('data-gor-command')).toBe('private-scene');
    view.unmount();
  });

  it('names each failure for what it was, in the words the failure notices keep', () => {
    const failures = Object.keys(PRIVATE_SCENE_FAILURE_COPY) as PrivateSceneFailure[];
    for (const error of failures) {
      const view = mountUi(<PrivateScene {...props({ error })} />);
      open(view.host);
      const alert = document.querySelector('.gor-private-scene [role="alert"]');
      expect(alert?.querySelector('.gor-alert-title')?.textContent).toBe(PRIVATE_SCENE_FAILURE_COPY[error].title);
      expect(alert?.textContent).toContain(PRIVATE_SCENE_FAILURE_COPY[error].message);
      view.unmount();
      document.body.innerHTML = '';
    }
    expect(PRIVATE_SCENE_FAILURE_COPY.reply_unanswered.title).not.toBe(PRIVATE_SCENE_FAILURE_COPY.invite_unanswered.title);
    expect(PRIVATE_SCENE_FAILURE_COPY.save.title).toBe('The record refuses');
    // A refusal by the input bound would come again: it is never offered as a retry.
    expect(PRIVATE_SCENE_FAILURE_COPY.invite_refused.message).not.toMatch(/retry|try again/i);
    expect(PRIVATE_SCENE_FAILURE_COPY.reply_refused.message).not.toMatch(/retry|try again/i);
  });

  it('keeps no failure sentence at the call site: the controller and the dialog name the failure only', () => {
    const controller = readFileSync(resolve(__dirname, '../hooks/usePrivateSceneController.ts'), 'utf8');
    const dialog = readFileSync(resolve(__dirname, '../components/PrivateScene.tsx'), 'utf8');
    for (const { message } of Object.values(PRIVATE_SCENE_FAILURE_COPY)) {
      expect(controller).not.toContain(message);
      expect(dialog).not.toContain(message);
    }
    expect(dialog).not.toContain('No answer came');
    expect(dialog).not.toContain('The invitation was not sent');
  });

  it('prints turn counts as turns', () => {
    const view = mountUi(<PrivateScene {...props({ scenes: [projectPrivateSceneForPlayer(closedScene(2))] })} />);
    open(view.host);
    expect(view.host.textContent).toContain('Last alone · Turn II');
    expect(view.host.textContent).not.toMatch(/Last alone · Week/);
    view.unmount();
  });

  it('closing the dialog, or leaving the screen, stops the NPC\'s voice', () => {
    const npcVoice = voice();
    const view = mountUi(<PrivateScene {...props({ npcVoice })} />);
    open(view.host);
    press(document.querySelector<HTMLButtonElement>('[aria-label="Close private scene"]')!);
    expect(npcVoice.stop).toHaveBeenCalledTimes(1);
    open(view.host);
    view.unmount();
    expect(npcVoice.stop).toHaveBeenCalledTimes(2);
  });
});

describe('the private scene controller', () => {
  const initial = getMockInitialState();
  const player = { ...initial.entities.find(e => e.entity_id === 'severus_alexander')! };
  const baseDeps = (scenesRef: { current: PrivateSceneRecord[] }, overrides: Partial<PrivateSceneControllerDeps> = {}): PrivateSceneControllerDeps => ({
    ai: {} as GoogleGenAI,
    isMockMode: true,
    privateScenes: scenesRef.current,
    playerEntity: player,
    entities: initial.entities,
    privateSceneKnownIds: ['maximinus_thrax', 'gaius_pontius_magnus'],
    knowledge: [],
    turnNumber: 3,
    privateSceneInteractionLocked: false,
    runDomainMutation: (async (work: Parameters<RunDomainMutation>[0]) => ({ acquired: true, value: await work({ isCurrent: () => true }) })) as RunDomainMutation,
    commitDomainMutation: (commit: DomainCommit) => { commit.beforeDispatch?.(); commit.onCommitted?.(); return true; },
    buildSaveState: () => ({}) as SaveGameState,
    privateSceneLockRef: { current: false },
    privateScenesRef: scenesRef,
    online: true,
    ...overrides,
  });

  it('with the roads shut, an invitation is held before any call, its words kept, and goes once they reopen', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const generateContent = vi.fn();
    const network = { models: { generateContent } } as unknown as GoogleGenAI;
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef, { ai: network, isMockMode: false, online: false }));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word, General.'));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(scenesRef.current).toEqual([]);
    expect(hook.current.privateSceneError).toBe('offline');
    expect(hook.current.privateSceneOpeningDraft).toBe('A word, General.');
    expect(hook.current.canStartScene).toBe(true);
    // The roads reopen: the same words go, and the notice gives way.
    hook.rerender(baseDeps(scenesRef));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    expect(scenesRef.current[0]?.status).toBe('active');
    expect(scenesRef.current[0]?.transcript[0]?.text).toBe('A word, General.');
    expect(hook.current.privateSceneError).toBeNull();
    hook.unmount();
  });

  it('with the roads shut, a reply inside an open scene is held before any call, and kept as written', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word, General.'));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    const opened = scenesRef.current[0];
    expect(opened.status).toBe('active');
    const generateContent = vi.fn();
    hook.rerender(baseDeps(scenesRef, { ai: { models: { generateContent } } as unknown as GoogleGenAI, isMockMode: false, online: false }));
    act(() => hook.current.setPrivateSceneReplyDraft('And the Guard?'));
    act(() => hook.current.handlePrivateSceneReply(opened.sceneId));
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(scenesRef.current[0]).toBe(opened);
    expect(hook.current.privateSceneError).toBe('offline');
    expect(hook.current.privateSceneReplyDraft).toBe('And the Guard?');
    hook.unmount();
  });

  it('says the roads are shut in the composer\'s title, bronze - something in the way, not a failure of the scene', () => {
    expect(PRIVATE_SCENE_FAILURE_COPY.offline).toEqual({
      title: 'No word can leave the city',
      message: 'The roads are shut. Your words are kept here — send them when the roads reopen.',
    });
    const view = mountUi(<PrivateSceneFailureNotice failure="offline" />);
    const alert = view.host.querySelector('[role="alert"]')!;
    expect(alert.classList.contains('gor-alert-bronze')).toBe(true);
    view.unmount();
    const other = mountUi(<PrivateSceneFailureNotice failure="reply_unanswered" />);
    expect(other.host.querySelector('[role="alert"]')!.classList.contains('gor-alert-crimson')).toBe(true);
    other.unmount();
  });

  it('an unsent reply to one NPC is gone once the scene ends - it never greets the next', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word, General.'));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    hook.rerender(baseDeps(scenesRef));
    const scene = scenesRef.current[0];
    expect(scene.status).toBe('active');
    act(() => hook.current.setPrivateSceneReplyDraft('Maximinus, the Guard is yours if you strike tonight.'));
    act(() => hook.current.handlePrivateSceneEnd(scene.sceneId));
    await settle();
    hook.rerender(baseDeps(scenesRef));
    expect(hook.current.privateSceneReplyDraft).toBe('');
    act(() => hook.current.handlePrivateSceneSkipLastWord(scene.sceneId));
    await settle();
    expect(scenesRef.current[0].status).toBe('closed');
    expect(hook.current.privateSceneReplyDraft).toBe('');
    expect(hook.current.privateSceneLastWordDraft).toBe('');
    hook.unmount();
  });

  it('a failure is named for what failed and belongs to its turn', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word.'));
    act(() => hook.current.handlePrivateSceneInvite('nobody_at_all'));
    await settle();
    expect(hook.current.privateSceneError).toBe('contact_missing');
    hook.rerender(baseDeps(scenesRef, { turnNumber: 4 }));
    expect(hook.current.privateSceneError).toBeNull();
    hook.unmount();
  });

  it('a failed reply inside an open scene is an exchange failure, not a door that did not open', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word, General.'));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    const refusing = { models: { generateContent: vi.fn(async () => { throw new Error('Bad Request'); }) } } as unknown as GoogleGenAI;
    hook.rerender(baseDeps(scenesRef, { ai: refusing, isMockMode: false }));
    act(() => hook.current.setPrivateSceneReplyDraft('And the Guard?'));
    act(() => hook.current.handlePrivateSceneReply(scenesRef.current[0].sceneId));
    await settle();
    expect(hook.current.privateSceneError).toBe('reply_unanswered');
    expect(hook.current.privateSceneReplyDraft).toBe('And the Guard?');
    hook.unmount();
  });

  it('an invitation the input bound refuses is not offered as a retry', async () => {
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const nameless = initial.entities.map(e => (e.entity_id === 'maximinus_thrax' ? { ...e, name: '   ' } : e));
    const hook = renderHook(usePrivateSceneController, baseDeps(scenesRef, { entities: nameless }));
    act(() => hook.current.setPrivateSceneOpeningDraft('A word.'));
    act(() => hook.current.handlePrivateSceneInvite('maximinus_thrax'));
    await settle();
    expect(hook.current.privateSceneError).toBe('invite_refused');
    expect(hook.current.privateSceneOpeningDraft).toBe('A word.');
    hook.unmount();
  });
});
