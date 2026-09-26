/**
 * @vitest-environment jsdom
 *
 * tests/voiceCastUse.test.tsx
 *
 * The voice cast wherever a character speaks, and the casting's lifecycle:
 *
 *  - REGRESSION: "In character…" Julia Mamaea narrates in HER cast voice
 *    (a woman's), not the narrator's Enceladus;
 *  - the cast's reader, voice and note are the default narrator; explicit
 *    Settings choices always win;
 *  - a cast note shapes the prep model's writing (its delivery brief) and
 *    never reaches the TTS input;
 *  - hooks/useVoiceCast.ts: casts when the voice is first needed (never while
 *    SILENT), casts newcomers incrementally, falls back without retrying,
 *    offline in Mock Mode, and keeps the cast in the save;
 *  - Settings → The cast: override, reset, recast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState, type Entity, type Message } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import { DRAMATIC_READER_NARRATOR, type NarratorProfile } from '../narration/narrators';
import { IN_CHARACTER_NARRATOR_ID, resolveNarrator } from '../narration/narratorChoice';
import { deterministicCast, withMemberOverride, type VoiceCast } from '../narration/voiceCast';
import { catalogVoice } from '../narration/voiceCatalog';
import { narrationLog } from '../narration/narrationLog';
import { voiceStyleManner } from '../narration/voiceStyle';
import { useNarrationVoice, type UseNarrationVoiceArgs } from '../hooks/useNarrationVoice';
import { useCastBasis, useVoiceCast } from '../hooks/useVoiceCast';
import type { GameAction } from '../state/gameReducer';
import { setNarratorVoice, NARRATOR_VOICE_STYLE_KEY, type NarrationVoiceMode } from '../persistence/uiPrefs';
import { loadGame, saveGame } from '../persistence/saveGame';
import SettingsMenu from '../components/SettingsMenu';
import { VOICE_CAST_COPY } from '../components/VoiceCastList';
import { NARRATION_SETTINGS_COPY } from '../components/NarrationSettings';
import { makeAppSave, makeEntity } from './factories';
import { asPromptData } from '../ai/prompts/fragments';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NARRATION = 'The Senate waits. Julia Mamaea says nothing.';
const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };
const ACTA: NarratorProfile = { ...DRAMATIC_READER_NARRATOR, id: 'acta-diurna', name: 'The Acta Diurna', description: 'The gazette.', voice: { ...DRAMATIC_READER_NARRATOR.voice, voiceName: 'Gacrux' } };
const DEFAULTS = { narratorId: 'senatorial-partner', voiceName: 'Enceladus' };
const JULIA = { entityId: 'julia', name: 'Julia Mamaea', position: 'Regent', epithet: 'Mother of the Camp', entityType: 'individual' as const };
const THRAX = { entityId: 'thrax', name: 'Maximinus Thrax', position: 'General of the Legions', entityType: 'individual' as const };
const CAST: VoiceCast = { ...deterministicCast([JULIA, THRAX], DEFAULTS), narrator: { narratorId: 'senatorial-partner', voiceName: 'Charon', style: 'grave and warm', rationale: 'A counsellor.', source: 'agent' } };

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const voiceOf = (call: ContentParams) => (call.config?.speechConfig as { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }).voiceConfig.prebuiltVoiceConfig.voiceName;

function makeAi(structured?: () => unknown) {
  const generateContent = vi.fn(async (params: ContentParams) => {
    if (params.config?.responseModalities) return AUDIO_RESPONSE;
    if (params.config?.responseMimeType === 'application/json') return { text: JSON.stringify(structured ? structured() : { cast: [] }) };
    return { text: `Hear it: ${JSON.parse(params.contents.split('\n')[1]) as string}` };
  });
  const ai: GeminiClient = { models: { generateContent } };
  return { ai, generateContent };
}

beforeEach(() => {
  localStorage.clear();
  narrationLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:v-${++n}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the narrator speaks in the cast', () => {
  const characters = [{ entityId: 'julia', name: 'Julia Mamaea', standing: 'Regent' }, { entityId: 'thrax', name: 'Maximinus Thrax', standing: 'General of the Legions' }];
  const base = { presets: [DRAMATIC_READER_NARRATOR, ACTA], customs: [], characters, characterId: 'julia', cast: CAST };

  it('REGRESSION: "In character…" Julia narrates in her own cast voice, a woman\'s - not the narrator\'s Enceladus', () => {
    const resolved = resolveNarrator({ ...base, narratorId: IN_CHARACTER_NARRATOR_ID });
    expect(resolved.kind).toBe('in_character');
    expect(resolved.profile.voice.voiceName).toBe('Gacrux');
    expect(resolved.profile.voice.voiceName).not.toBe('Enceladus');
    expect(catalogVoice(resolved.profile.voice.voiceName)?.register).toBe('feminine');
    expect(resolved.ownStyle).toEqual({ preset: 'custom', text: 'cool, imperious and measured' });
    // Thrax, in his.
    expect(resolveNarrator({ ...base, narratorId: IN_CHARACTER_NARRATOR_ID, characterId: 'thrax' }).profile.voice.voiceName).toBe('Algenib');
  });

  it('REGRESSION, end to end: the hook voices Julia\'s retelling in Gacrux, written in her manner', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    const args: UseNarrationVoiceArgs = {
      ai, isMockMode: false, resolvedApiKey: 'k', messages: [{ sender: 'gm', text: NARRATION }] as Message[], gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR], narratorCharacters: characters, voiceCast: CAST,
      playerEntity: { name: 'Severus Alexander', position: 'Emperor' } as UseNarrationVoiceArgs['playerEntity'],
    };
    const hook = renderHook(useNarrationVoice, args);
    act(() => hook.current.handleSetNarrator(IN_CHARACTER_NARRATOR_ID));
    act(() => hook.current.handleSetNarratorCharacter('julia'));
    expect(hook.current.narratorOwnVoice).toBe('Gacrux');
    expect(hook.current.narratorVoiceFromCast).toBe(true);
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    const tts = generateContent.mock.calls.map(c => c[0]).filter(c => c.config?.responseModalities);
    expect(tts).toHaveLength(1);
    expect(voiceOf(tts[0])).toBe('Gacrux');
    // Her note shaped the retelling (the prep brief); the voice speaks only the words.
    const prep = generateContent.mock.calls.map(c => c[0]).filter(c => !c.config?.responseModalities);
    expect(prep[0].contents).toContain(asPromptData('cool, imperious and measured'));
    expect(tts[0].contents).toBe(`## Transcript:\nHear it: ${NARRATION}`);
    // The log records the voice and style actually used.
    expect(narrationLog.getSnapshot()[0]).toMatchObject({ voice: 'Gacrux', voiceStyle: { preset: 'custom', text: 'cool, imperious and measured' }, narratorName: 'Julia Mamaea' });
    hook.unmount();
  });

  it('with no explicit narration style, the cast\'s reader performs in the cast narrator\'s voice and note', () => {
    const resolved = resolveNarrator({ ...base, narratorId: null, cast: { ...CAST, narrator: { ...CAST.narrator, narratorId: 'acta-diurna' } } });
    expect(resolved.profile.id).toBe('acta-diurna');
    expect(resolved.profile.voice.voiceName).toBe('Charon');
    expect(resolved.ownStyle).toEqual({ preset: 'custom', text: 'grave and warm' });
    expect(resolved.castPick).toBe(true);
    // Another reader chosen explicitly keeps the voice it was tuned with.
    const other = resolveNarrator({ ...base, narratorId: 'acta-diurna' });
    expect(other.profile.voice.voiceName).toBe('Gacrux');
    expect(other.ownStyle).toBeNull();
    expect(other.castPick).toBeFalsy();
  });

  it('explicit Settings choices beat the cast: voice, voice style and narration style', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    setNarratorVoice('Puck');
    localStorage.setItem(NARRATOR_VOICE_STYLE_KEY, JSON.stringify({ preset: 'newsreader' }));
    const { ai, generateContent } = makeAi();
    const hook = renderHook(useNarrationVoice, {
      ai, isMockMode: false, resolvedApiKey: 'k', messages: [{ sender: 'gm', text: NARRATION }] as Message[], gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR, ACTA], narratorCharacters: characters,
      voiceCast: { ...CAST, narrator: { ...CAST.narrator, narratorId: 'acta-diurna' } },
    });
    expect(hook.current.narratorId).toBe('acta-diurna');
    expect(hook.current.narratorChosenExplicitly).toBe(false);
    act(() => hook.current.handleSetNarrator('senatorial-partner'));
    expect(hook.current.narratorId).toBe('senatorial-partner');
    expect(hook.current.narratorChosenExplicitly).toBe(true);
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    const tts = generateContent.mock.calls.map(c => c[0]).filter(c => c.config?.responseModalities);
    expect(voiceOf(tts[0])).toBe('Puck');
    expect(tts[0].contents).toBe(`## Transcript:\nHear it: ${NARRATION}`);
    const prep = generateContent.mock.calls.map(c => c[0]).filter(c => !c.config?.responseModalities);
    expect(prep[0].contents).toContain(asPromptData(voiceStyleManner({ preset: 'newsreader' })));
    // Clearing the narration style hands the choice back to the cast.
    act(() => hook.current.handleSetNarrator(''));
    expect(hook.current.narratorId).toBe('acta-diurna');
    expect(hook.current.narratorChosenExplicitly).toBe(false);
    hook.unmount();
  });

  it('every character keeps their cast voice; each cast note shapes the writing and never reaches the voice', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    const hook = renderHook(useNarrationVoice, {
      ai, isMockMode: false, resolvedApiKey: 'k', messages: [{ sender: 'gm', text: NARRATION }] as Message[], gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR], narratorCharacters: characters, voiceCast: CAST,
    });
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    act(() => hook.current.handleSetNarrator(IN_CHARACTER_NARRATOR_ID));
    act(() => hook.current.handleSetNarratorCharacter('julia'));
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    const calls = generateContent.mock.calls.map(c => c[0]);
    const tts = calls.filter(c => c.config?.responseModalities);
    const prep = calls.filter(c => !c.config?.responseModalities);
    expect(tts.map(voiceOf)).toEqual(['Charon', 'Gacrux']);
    for (const call of tts) expect(call.contents).toBe(`## Transcript:\nHear it: ${NARRATION}`);
    expect(prep[0].contents).toContain(asPromptData('grave and warm'));
    expect(prep[1].contents).toContain(asPromptData('cool, imperious and measured'));
    hook.unmount();
  });
});

describe('useVoiceCast: when the casting director runs', () => {
  const player = makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', position: 'Emperor', visibility_network: ['julia'] });
  const julia = makeEntity({ entity_id: 'julia', name: 'Julia Mamaea', position: 'Regent' });
  const thrax = makeEntity({ entity_id: 'thrax', name: 'Maximinus Thrax', position: 'General of the Legions' });
  const gaius = makeEntity({ entity_id: 'gaius', name: 'Gaius Pontius Magnus', position: 'Senior Senator' });

  interface HarnessProps {
    ai: GeminiClient;
    isMockMode?: boolean;
    mode: NarrationVoiceMode;
    entities: Entity[];
    gameState?: GameState;
    initial?: VoiceCast | null;
  }
  function useHarness({ ai, isMockMode = false, mode, entities, gameState = GameState.AWAITING_PLAYER_INPUT, initial = null }: HarnessProps) {
    const [voiceCast, setCast] = useState<VoiceCast | null>(initial);
    const dispatch = useCallback((action: GameAction) => {
      if (action.type === 'VOICE_CAST_SET') setCast(prev => (prev && prev.revision > action.voiceCast.revision ? prev : action.voiceCast));
    }, []);
    const [generationRef] = useState(() => ({ current: 0 }));
    const playerEntity = entities.find(e => e.entity_id === 'severus_alexander') ?? null;
    const basis = useCastBasis({ voiceCast, playerEntity, entities, knowledge: [] });
    const cast = useVoiceCast({
      ai, isMockMode, resolvedApiKey: 'k', narrationVoiceMode: mode, gameState, voiceCast, dispatch,
      playerEntity, basis, metaNarrative: 'A crisis.', campaignGenerationRef: generationRef,
      narrators: [{ id: 'senatorial-partner', name: 'The Dramatic Reader', description: 'Epic.' }],
    });
    return { voiceCast, basis, cast };
  }

  it('never while SILENT or on the selection screen; once when the voice is turned on; kept in the save', async () => {
    saveGame(makeAppSave({ playerCharacterId: 'severus_alexander' }));
    const { ai, generateContent } = makeAi(() => ({
      narrator: { narratorId: 'senatorial-partner', voiceName: 'Charon', style: 'grave', rationale: 'Grave.' },
      cast: [{ entityId: 'julia', voiceName: 'Kore', style: 'cool, imperious, measured', rationale: 'Firm.' }],
    }));
    const entities = [player, julia, thrax];
    const hook = renderHook(useHarness, { ai, mode: 'off', entities });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    // Before any casting, everyone known still has a voice, by rule.
    expect(hook.current.basis.effectiveCast.members.julia.voiceName).toBe('Gacrux');
    hook.rerender({ ai, mode: 'on_demand', entities, gameState: GameState.SETUP });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    hook.rerender({ ai, mode: 'on_demand', entities });
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(hook.current.voiceCast?.members.julia).toMatchObject({ voiceName: 'Kore', source: 'agent' });
    expect(hook.current.voiceCast?.narrator).toMatchObject({ voiceName: 'Charon', source: 'agent' });
    expect(loadGame()?.state.voiceCast).toEqual(hook.current.voiceCast);
    // No more calls while nothing changes.
    hook.rerender({ ai, mode: 'auto', entities });
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('casts a newcomer with one small call, keeping everyone else', async () => {
    let answer: unknown = { narrator: { narratorId: 'senatorial-partner', voiceName: 'Charon', style: '', rationale: 'r' }, cast: [{ entityId: 'julia', voiceName: 'Kore', style: 'cool', rationale: 'r' }] };
    const { ai, generateContent } = makeAi(() => answer);
    const entities = [player, julia, thrax, gaius];
    const hook = renderHook(useHarness, { ai, mode: 'on_demand', entities });
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    const juliaBefore = hook.current.voiceCast!.members.julia;
    // Two people become known at once (one turn): one call for both.
    answer = { cast: [
      { entityId: 'thrax', voiceName: 'Algenib', style: 'growl', rationale: 'A soldier.' },
      { entityId: 'gaius', voiceName: 'Rasalgethi', style: 'rolling', rationale: 'An orator.' },
    ] };
    const known = { ...player, visibility_network: ['julia', 'thrax', 'gaius'] };
    hook.rerender({ ai, mode: 'on_demand', entities: [known, julia, thrax, gaius] });
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(2);
    const prompt = generateContent.mock.calls[1][0].contents;
    expect(prompt).toContain('NEWCOMERS TO CAST');
    expect(prompt).toContain('Maximinus Thrax');
    expect(prompt).not.toMatch(/"entity_id": ?"julia"/);
    expect(hook.current.voiceCast!.members.julia).toEqual(juliaBefore);
    expect(hook.current.voiceCast!.members.thrax).toMatchObject({ voiceName: 'Algenib', source: 'agent' });
    expect(hook.current.voiceCast!.members.gaius).toMatchObject({ voiceName: 'Rasalgethi', source: 'agent' });
    hook.unmount();
  });

  it('a failed call casts by rule, keeps it, and does not retry by itself', async () => {
    const { ai, generateContent } = makeAi(() => { throw new Error('boom'); });
    const hook = renderHook(useHarness, { ai, mode: 'on_demand', entities: [player, julia] });
    await settle();
    await settle();
    expect(hook.current.voiceCast?.members.julia).toMatchObject({ source: 'fallback', voiceName: 'Gacrux' });
    const calls = generateContent.mock.calls.length;
    hook.rerender({ ai, mode: 'auto', entities: [player, julia] });
    await settle();
    expect(generateContent.mock.calls.length).toBe(calls);
    hook.unmount();
  });

  it('Mock Mode casts offline, by rule', async () => {
    const { ai, generateContent } = makeAi();
    const hook = renderHook(useHarness, { ai, isMockMode: true, mode: 'on_demand', entities: [player, julia] });
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(hook.current.voiceCast?.members.julia).toMatchObject({ voiceName: 'Gacrux', source: 'fallback' });
    hook.unmount();
  });

  it('override, reset and recast: overrides survive a recast; a recast is one call', async () => {
    const { ai, generateContent } = makeAi(() => ({ narrator: { narratorId: 'senatorial-partner', voiceName: 'Charon', style: '', rationale: 'r' }, cast: [{ entityId: 'julia', voiceName: 'Kore', style: 'cool', rationale: 'r' }] }));
    const hook = renderHook(useHarness, { ai, mode: 'on_demand', entities: [player, julia] });
    await settle();
    act(() => hook.current.cast.handleOverrideMember('julia', { voiceName: 'Sulafat', style: 'warm, low' }));
    expect(hook.current.voiceCast!.members.julia.override).toEqual({ voiceName: 'Sulafat', style: 'warm, low' });
    expect(loadGame()).toBeNull(); // no save to patch in this test: the state still holds it
    await act(async () => { await hook.current.cast.handleRecast(); });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(hook.current.cast.recastStatus).toBe('done');
    expect(hook.current.voiceCast!.members.julia.override).toEqual({ voiceName: 'Sulafat', style: 'warm, low' });
    act(() => hook.current.cast.handleResetMember('julia'));
    expect(hook.current.voiceCast!.members.julia.override).toBeUndefined();
    expect(hook.current.basis.effectiveCast.members.julia.voiceName).toBe('Kore');
    hook.unmount();
  });

  it('the retired "Bespoke character voices" switch: an old stored value is never read, and changes nothing', () => {
    localStorage.setItem('gloryOfRome:bespokeVoices', '0');
    const { ai } = makeAi();
    const hook = renderHook(useHarness, { ai, mode: 'off', entities: [player, julia] });
    expect(Object.keys(hook.current.basis).sort()).toEqual(['candidates', 'effectiveCast']);
    expect(resolveNarrator({
      narratorId: IN_CHARACTER_NARRATOR_ID, characterId: 'julia', presets: [DRAMATIC_READER_NARRATOR], customs: [],
      characters: [{ entityId: 'julia', name: 'Julia Mamaea' }], cast: CAST,
    }).ownStyle).toEqual({ preset: 'custom', text: 'cool, imperious and measured' });
    hook.unmount();
  });
});

describe('Settings → The cast', () => {
  function renderSettings(props: Partial<React.ComponentProps<typeof SettingsMenu>>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (extra: Partial<React.ComponentProps<typeof SettingsMenu>> = {}) => act(() => root.render(
      <SettingsMenu
        onClose={vi.fn()} apiKey={null} onSaveApiKey={vi.fn()} onClearApiKey={vi.fn()}
        pacingPosture="balanced" onSetPacingPosture={vi.fn()} isNox={false} onSetIsNox={vi.fn()}
        gmConsoleEnabled onSetGmConsoleEnabled={vi.fn()} gmInterventionEnabled onSetGmInterventionEnabled={vi.fn()}
        narrationVoiceMode="on_demand" onSetNarrationVoiceMode={vi.fn()}
        isMockMode={false} onSetIsMockMode={vi.fn()} gmConsoleOpen={false} onSetGmConsoleOpen={vi.fn()}
        hasSavedReign={false} onExportReign={vi.fn()}
        {...props} {...extra}
      />,
    ));
    render();
    return { host, render, cleanup: () => { act(() => root.unmount()); host.remove(); } };
  }
  const overridden = withMemberOverride(CAST, 'thrax', { voiceName: 'Orus' });
  const props = () => ({
    narrators: [{ id: 'senatorial-partner', name: 'The Dramatic Reader', description: 'Epic.', voiceName: 'Enceladus' }],
    narratorId: 'senatorial-partner', onSetNarrator: vi.fn(),
    narratorVoiceChoice: null, narratorOwnVoice: 'Charon', onSetNarratorVoice: vi.fn(),
    voiceStyleChoice: null, narratorOwnStyle: { preset: 'custom' as const, text: 'grave and warm' }, onSetVoiceStyle: vi.fn(),
    narratorChosenExplicitly: false, castNarratorId: 'senatorial-partner', narratorVoiceFromCast: true,
    voiceCast: overridden, castCharacters: [JULIA, THRAX],
    canRecast: true, recastStatus: 'idle' as const, onRecast: vi.fn(), onOverrideCastMember: vi.fn(), onResetCastMember: vi.fn(),
  });
  const open = (host: HTMLElement) => {
    const toggle = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(VOICE_CAST_COPY.disclosure))!;
    act(() => toggle.click());
  };
  const change = (el: HTMLSelectElement | HTMLInputElement, value: string) => act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });

  it('shows what the cast chose: "As cast" for the reader and the voice, with the casting director\'s hint', () => {
    const view = renderSettings(props());
    const style = view.host.querySelector<HTMLSelectElement>('select[aria-label="Narration style"]')!;
    expect(style.value).toBe('');
    expect(style.options[0].textContent).toBe(NARRATION_SETTINGS_COPY.asCast('The Dramatic Reader'));
    expect(view.host.textContent).toContain(NARRATION_SETTINGS_COPY.castHint);
    const voice = view.host.querySelector<HTMLSelectElement>('select[aria-label="Voice"]')!;
    expect(voice.options[0].textContent).toBe(NARRATION_SETTINGS_COPY.castVoice('Charon'));
    // The retired switch is gone: every character always speaks in their own cast voice.
    expect(view.host.textContent).not.toContain('Bespoke');
    view.cleanup();
  });

  it('lists the narrator and each known individual with voice, note and rationale; override, reset and recast', () => {
    const p = props();
    const view = renderSettings(p);
    open(view.host);
    const list = view.host.querySelector('ul[aria-label="The cast"]')!;
    const rows = [...list.querySelectorAll('li')];
    expect(rows.map(r => r.querySelector('.gor-narrator-editor-name')?.textContent)).toEqual([
      VOICE_CAST_COPY.narratorRow('The Dramatic Reader'), 'Julia Mamaea', 'Maximinus Thrax',
    ]);
    expect(rows[0].textContent).toContain('A counsellor.');
    expect(rows[1].textContent).toContain(CAST.members.julia.rationale);
    const juliaVoice = rows[1].querySelector<HTMLSelectElement>('select[aria-label="Voice for Julia Mamaea"]')!;
    expect(juliaVoice.value).toBe('Gacrux');
    expect(juliaVoice.options).toHaveLength(31);
    const juliaStyle = rows[1].querySelector<HTMLInputElement>('input[aria-label="How Julia Mamaea speaks"]')!;
    expect(juliaStyle.value).toBe('cool, imperious and measured');
    expect(juliaStyle.maxLength).toBe(80);

    change(juliaVoice, 'Kore');
    expect(p.onOverrideCastMember).toHaveBeenLastCalledWith('julia', { voiceName: 'Kore' });
    change(juliaStyle, 'icy: "5" [slow]');
    act(() => juliaStyle.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(p.onOverrideCastMember).toHaveBeenLastCalledWith('julia', { style: 'icy slow' });

    // Thrax is overridden: his row says so and offers the reset.
    expect(rows[2].textContent).toContain(VOICE_CAST_COPY.yourChoice);
    expect(rows[1].querySelector(`button[aria-label="${VOICE_CAST_COPY.resetFor('Julia Mamaea')}"]`)).toBeNull();
    act(() => rows[2].querySelector<HTMLButtonElement>(`button[aria-label="${VOICE_CAST_COPY.resetFor('Maximinus Thrax')}"]`)!.click());
    expect(p.onResetCastMember).toHaveBeenCalledWith('thrax');

    // The narrator's row edits the Settings voice and style.
    change(rows[0].querySelector<HTMLSelectElement>('select')!, 'Schedar');
    expect(p.onSetNarratorVoice).toHaveBeenLastCalledWith('Schedar');

    // Recast everyone: a paid call, and it says so.
    expect(view.host.textContent).toContain(VOICE_CAST_COPY.recastNote);
    expect(VOICE_CAST_COPY.recastNote).toMatch(/paid call/);
    const recast = [...view.host.querySelectorAll('button')].find(b => b.textContent === VOICE_CAST_COPY.recast)!;
    act(() => recast.click());
    expect(p.onRecast).toHaveBeenCalledTimes(1);
    view.render({ recastStatus: 'casting' });
    expect(([...view.host.querySelectorAll('button')].find(b => b.textContent === VOICE_CAST_COPY.recast) as HTMLButtonElement).disabled).toBe(true);
    expect(view.host.textContent).toContain(VOICE_CAST_COPY.status.casting);
    view.cleanup();
  });

  it('the notes are always editable, and the list says what a manner does', () => {
    const view = renderSettings(props());
    open(view.host);
    expect(view.host.textContent).toContain(VOICE_CAST_COPY.intro);
    expect(view.host.querySelector<HTMLInputElement>('input[aria-label="How Julia Mamaea speaks"]')!.disabled).toBe(false);
    view.cleanup();
  });
});
