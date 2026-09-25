/**
 * @vitest-environment jsdom
 *
 * tests/ttsPerformsTheScript.test.tsx
 *
 * THE GUARD: the TTS performs exactly the script, always.
 *
 * The narrator writes an ACTED SCRIPT - spoken words plus `<cues>` - and
 * gemini-3.8-flash-tts performs it word for word, as in the owner's
 * reference: it ACTS every `<cue>` and SPEAKS every word outside one. Its
 * `speechConfig` has no style parameter, and a delivery style sent as a
 * prefix ("Say in a … voice: …") would be read aloud. So on every path that
 * reaches the voice, with a style chosen, the TTS call's `contents` must be
 * exactly `## Transcript:` and the logged script, cues included - and,
 * outside the cues, nothing but the script's words: no prose instruction,
 * no style prefix, no manner:
 *
 *  - the chronicle narrator (cast note, preset, custom style text, and the
 *    cast block of those the passage names);
 *  - "In character…" (the character's cast note);
 *  - a custom narrator (its own voice style);
 *  - a transcript reused from the log by the chronicle voice;
 *  - the Imperial Dispatch;
 *  - a private-scene NPC's committed line (their cast note);
 *  - the narration log's "Hear it again".
 *
 * Where a prep call exists, the style reaches it instead, as the delivery
 * brief (ai/prompts/narrationPerformance.ts `buildDeliveryBrief`), and the
 * script's cues carry it. The Imperial Dispatch and a private-scene line
 * carry no cues: they are performed as their words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { GameState, type Message } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import { asPromptData } from '../ai/prompts/fragments';
import { CAST_BLOCK_HEADING, TTS_TRANSCRIPT_HEADING, buildNarrationTtsPrompt } from '../ai/prompts/narrationPerformance';
import { cuesIn, spokenPartOf } from '../narration/performanceScript';
import { DRAMATIC_READER_NARRATOR } from '../narration/narrators';
import { IN_CHARACTER_NARRATOR_ID } from '../narration/narratorChoice';
import { NarrationLogStore } from '../narration/narrationLog';
import { deterministicCast, type VoiceCast } from '../narration/voiceCast';
import { voiceStyleManner, type VoiceStyle } from '../narration/voiceStyle';
import { NARRATOR_VOICE_STYLE_KEY } from '../persistence/uiPrefs';
import { useNarrationVoice, type UseNarrationVoiceArgs } from '../hooks/useNarrationVoice';
import { useNarrationLog } from '../hooks/useNarrationLog';
import { useImperialDispatch } from '../hooks/useImperialDispatch';
import { usePrivateSceneVoice } from '../hooks/usePrivateSceneVoice';
import { renderHook } from './renderHook';
import { makeEntity, makeSimulationState, makeWorldState } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NARRATION = 'The Senate waits. Julia Mamaea says nothing.';
/** What the fake narrator writes: an acted script of the narration, cues and all. */
const actedScriptOf = (narration: string) => `<a low, bitter laugh> Hear it. <a long pause, then quietly> ${narration}`;
const ACTED = actedScriptOf(NARRATION);
const DISPATCH = 'The treasury holds and the legions wait.';
const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };

const CAST: VoiceCast = {
  ...deterministicCast([
    { entityId: 'julia', name: 'Julia Mamaea', position: 'Regent', entityType: 'individual' },
    { entityId: 'thrax', name: 'Maximinus Thrax', position: 'General', entityType: 'individual' },
  ], { narratorId: 'senatorial-partner', voiceName: 'Charon' }),
  narrator: { narratorId: 'senatorial-partner', voiceName: 'Charon', style: 'grave and warm', rationale: 'A counsellor.', source: 'agent' },
};
const JULIA_NOTE = 'cool, imperious and measured';

function makeAi() {
  const generateContent = vi.fn(async (params: ContentParams) => {
    if (params.config?.responseModalities) return AUDIO_RESPONSE;
    if (params.contents.startsWith('NARRATION')) return { text: `## Transcript:\n${actedScriptOf(JSON.parse(params.contents.split('\n')[1]) as string)}` };
    return { text: DISPATCH };
  });
  const ai: GeminiClient = { models: { generateContent } };
  const tts = () => generateContent.mock.calls.map(c => c[0]).filter(c => c.config?.responseModalities);
  const prep = () => generateContent.mock.calls.map(c => c[0]).filter(c => !c.config?.responseModalities);
  return { ai, generateContent, tts, prep };
}

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

/**
 * Every TTS input is exactly "## Transcript:" and one logged script, cues
 * included; outside the cues it holds nothing but that script's words (no
 * "Say it …:" prefix, no instruction); and no manner in `manners` appears
 * anywhere in it.
 */
function expectScriptPerformed(tts: ContentParams[], scripts: string[], manners: string[]) {
  expect(tts.map(c => c.contents)).toEqual(scripts.map(script => `${TTS_TRANSCRIPT_HEADING}\n${script}`));
  tts.forEach((call, i) => {
    expect(call.contents).toBe(buildNarrationTtsPrompt(call.contents));
    const body = call.contents.slice(`${TTS_TRANSCRIPT_HEADING}\n`.length);
    expect(cuesIn(body)).toEqual(cuesIn(scripts[i]));
    expect(spokenPartOf(body)).toBe(spokenPartOf(scripts[i]));
    expect(spokenPartOf(body)).not.toMatch(/^\s*(?:say|read|speak|whisper|perform|deliver)\b[^:]*:/im);
    expect(spokenPartOf(body)).not.toMatch(/#|\[|\]|<|>/);
    for (const manner of manners) expect(call.contents).not.toContain(manner);
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:g-${++n}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the TTS performs exactly the script, on every path, with a style chosen', () => {
  function mountChronicle(log: NarrationLogStore, ai: GeminiClient, extra: Partial<UseNarrationVoiceArgs> = {}) {
    return renderHook(useNarrationVoice, {
      ai, isMockMode: false, resolvedApiKey: 'k', messages: [{ sender: 'gm', text: NARRATION }] as Message[], gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR], narratorCharacters: [{ entityId: 'julia', name: 'Julia Mamaea', standing: 'Regent' }],
      voiceCast: CAST, log, ...extra,
    });
  }

  it('the chronicle, "In character…" and a custom narrator: the style is in the prep brief, the voice performs the acted script, cues and all', async () => {
    const log = new NarrationLogStore({ load: false });
    const { ai, tts, prep } = makeAi();
    const hook = mountChronicle(log, ai);
    const perform = async () => {
      act(() => hook.current.toggleNarrationVoice(0, NARRATION));
      await settle();
      act(() => hook.current.toggleNarrationVoice(0, NARRATION)); // stop
    };
    const styles: VoiceStyle[] = [];

    // 1. The cast narrator's note (no explicit choice).
    await perform();
    styles.push({ preset: 'custom', text: 'grave and warm' });
    // 2. A preset.
    act(() => hook.current.handleSetVoiceStyle({ preset: 'tragedian' }));
    await perform();
    styles.push({ preset: 'tragedian' });
    // 3. Custom text.
    act(() => hook.current.handleSetVoiceStyle({ preset: 'custom', text: 'hushed, few words' }));
    await perform();
    styles.push({ preset: 'custom', text: 'hushed, few words' });
    // 4. In character: the character's cast note.
    act(() => hook.current.handleSetVoiceStyle(null));
    act(() => hook.current.handleSetNarrator(IN_CHARACTER_NARRATOR_ID));
    act(() => hook.current.handleSetNarratorCharacter('julia'));
    await perform();
    styles.push({ preset: 'custom', text: JULIA_NOTE });
    // 5. A custom narrator's own style.
    act(() => { hook.current.handleSaveCustomNarrator({ name: 'The Old Centurion', description: '', brief: 'A veteran by the fire.', voiceName: 'Orus', voiceStyle: { preset: 'old-soldier' } }); });
    act(() => hook.current.handleSetNarrator(hook.current.customNarrators[0].id));
    await perform();
    styles.push({ preset: 'old-soldier' });
    hook.unmount();

    const manners = styles.map(s => voiceStyleManner(s)!);
    expect(prep()).toHaveLength(5);
    prep().forEach((call, i) => {
      expect(call.contents).toContain('DELIVERY BRIEF');
      expect(call.contents).toContain(asPromptData(manners[i]));
    });
    const transcripts = [...log.getSnapshot()].reverse().map(e => e.transcript);
    expect(transcripts).toHaveLength(5);
    expect(transcripts.every(t => t === ACTED)).toBe(true);
    expectScriptPerformed(tts(), transcripts, manners);
    expect(tts().every(c => c.contents === `## Transcript:\n${ACTED}`)).toBe(true);
    expect(cuesIn(tts()[0].contents)).toEqual(['a low, bitter laugh', 'a long pause, then quietly']);
  });

  it('the cast: a named member\'s note reaches the prep prompt\'s cast block, for every narrator but themselves, and never the voice', async () => {
    const log = new NarrationLogStore({ load: false });
    const { ai, tts, prep } = makeAi();
    const thrax = 'The Thracian growls at the gate. The Senate waits.';
    const hook = renderHook(useNarrationVoice, {
      ai, isMockMode: false, resolvedApiKey: 'k',
      messages: [{ sender: 'gm', text: NARRATION }, { sender: 'gm', text: thrax }] as Message[], gameState: GameState.AWAITING_PLAYER_INPUT,
      narrators: [DRAMATIC_READER_NARRATOR], narratorCharacters: [{ entityId: 'julia', name: 'Julia Mamaea', standing: 'Regent' }],
      voiceCast: CAST, castCandidates: [{ entityId: 'thrax', epithet: 'the Thracian' }], log,
    });
    const perform = async (index: number, text: string) => {
      act(() => hook.current.toggleNarrationVoice(index, text));
      await settle();
      act(() => hook.current.toggleNarrationVoice(index, text));
    };
    const thraxNote = CAST.members.thrax.style;
    // 1. The chronicle narrator: Julia is named, so her note is in the block.
    await perform(0, NARRATION);
    // 2. Named by epithet only: the Thracian's note.
    await perform(1, thrax);
    // 3. Julia narrates in character: her own note is her delivery brief, not a cast line.
    act(() => hook.current.handleSetNarrator(IN_CHARACTER_NARRATOR_ID));
    act(() => hook.current.handleSetNarratorCharacter('julia'));
    await perform(0, NARRATION);
    // 4. In character too, others she speaks of are cast.
    await perform(1, thrax);
    hook.unmount();

    const [chronicle, byEpithet, herself, inCharacter] = prep().map(c => c.contents);
    expect(chronicle).toContain(`${CAST_BLOCK_HEADING}\n${asPromptData('Julia Mamaea')}: ${asPromptData(JULIA_NOTE)}`);
    expect(byEpithet).toContain(`${CAST_BLOCK_HEADING}\n${asPromptData('Maximinus Thrax')}: ${asPromptData(thraxNote)}`);
    expect(herself).not.toContain(CAST_BLOCK_HEADING);
    expect(herself).toContain('DELIVERY BRIEF');
    expect(inCharacter).toContain(`${asPromptData('Maximinus Thrax')}: ${asPromptData(thraxNote)}`);
    expectScriptPerformed(tts(), [...log.getSnapshot()].reverse().map(e => e.transcript), [JULIA_NOTE, thraxNote]);
  });

  it('a script the chronicle voice reuses from the log is performed as logged, cues and all', async () => {
    localStorage.setItem(NARRATOR_VOICE_STYLE_KEY, JSON.stringify({ preset: 'newsreader' }));
    const log = new NarrationLogStore({ load: false });
    const first = makeAi();
    const hook = mountChronicle(log, first.ai);
    act(() => hook.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    hook.unmount();

    const second = makeAi();
    const again = mountChronicle(log, second.ai);
    act(() => again.current.toggleNarrationVoice(0, NARRATION));
    await settle();
    again.unmount();
    expect(second.prep()).toHaveLength(0);
    expect(log.getSnapshot()[0].transcript).toBe(ACTED);
    expectScriptPerformed(second.tts(), [ACTED], [voiceStyleManner({ preset: 'newsreader' })!]);
  });

  it('the Imperial Dispatch: a crisp briefing with no cues, whatever style the player chose', async () => {
    localStorage.setItem(NARRATOR_VOICE_STYLE_KEY, JSON.stringify({ preset: 'conspiratorial' }));
    const log = new NarrationLogStore({ load: false });
    const { ai, tts } = makeAi();
    const hook = renderHook(useImperialDispatch, {
      ai, isMockMode: false, resolvedApiKey: 'k', worldState: makeWorldState({ week: 4 }), simulationState: makeSimulationState(),
      entities: [makeEntity()], reports: [], currentEvents: [], playerEntity: makeEntity(), turnNumber: 3, log,
    });
    act(() => hook.current.toggleDispatch());
    await settle();
    hook.unmount();
    expectScriptPerformed(tts(), [DISPATCH], [voiceStyleManner({ preset: 'conspiratorial' })!]);
    expect(cuesIn(tts()[0].contents)).toEqual([]);
    expect(log.getSnapshot()[0].transcript).toBe(DISPATCH);
  });

  it('a private-scene NPC line: the committed words, no cues; the cast note is kept for display, never sent', async () => {
    const log = new NarrationLogStore({ load: false });
    const { ai, generateContent, tts } = makeAi();
    const hook = renderHook(usePrivateSceneVoice, { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand', voiceCast: CAST, week: 2, log });
    const scene = { sceneId: 's1', npcId: 'julia', npcName: 'Julia Mamaea', macroTurn: 2 };
    act(() => hook.current!.onSetEnabled(true));
    act(() => hook.current!.onToggle(scene, { sequence: 1, speaker: 'npc', text: '*She smiles.* My son trusts you.' }));
    await settle();
    hook.unmount();
    expect(generateContent).toHaveBeenCalledTimes(1); // no prep call: nothing to take a brief
    expectScriptPerformed(tts(), ['My son trusts you.'], [JULIA_NOTE]);
    expect(cuesIn(tts()[0].contents)).toEqual([]);
    expect(log.getSnapshot()[0]).toMatchObject({ transcript: 'My son trusts you.', voiceStyle: { preset: 'custom', text: JULIA_NOTE } });
  });

  it('"Hear it again" from the narration log: the logged script as logged, whatever style the entry was written in', async () => {
    const log = new NarrationLogStore({ load: false });
    const styled: VoiceStyle[] = [{ preset: 'tragedian' }, { preset: 'custom', text: JULIA_NOTE }];
    log.record({ kind: 'chronicle', sourceLabel: 'Week III narration', sourceText: NARRATION, narratorKey: 'k', narratorName: 'The Dramatic Reader', voice: 'Enceladus', voiceStyle: styled[0], transcript: '<a weary sigh> Rome waits, and waits.', patchedOut: [], usedFallback: false, week: 3, turn: 2 });
    log.record({ kind: 'private_scene', sourceLabel: 'Private scene with Julia Mamaea', sourceText: 'My son trusts you.', narratorKey: 'npc:julia', narratorName: 'Julia Mamaea', voice: 'Gacrux', voiceStyle: styled[1], transcript: 'My son trusts you.', patchedOut: [], usedFallback: false, week: 3, turn: 2 });
    const { ai, tts } = makeAi();
    const hook = renderHook(useNarrationLog, { ai, isMockMode: false, resolvedApiKey: 'k', log });
    const [newest, oldest] = log.getSnapshot();
    act(() => hook.current.toggleReplay(oldest));
    await settle();
    act(() => hook.current.toggleReplay(newest));
    await settle();
    hook.unmount();
    expectScriptPerformed(tts(), ['<a weary sigh> Rome waits, and waits.', 'My son trusts you.'], styled.map(s => voiceStyleManner(s)!));
  });
});
