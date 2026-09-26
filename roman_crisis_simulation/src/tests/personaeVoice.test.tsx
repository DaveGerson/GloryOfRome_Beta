/**
 * @vitest-environment jsdom
 *
 * tests/personaeVoice.test.tsx
 *
 * The voice row on each Dramatis Personae card (hooks/usePersonaeVoice.ts,
 * components/tabs/PersonaVoiceRow.tsx), wired as App.tsx wires it:
 *
 *  - every known individual's card shows their cast voice and manner;
 *  - "Narrate as them" sets the "In character…" narration style with this
 *    character - the same state Settings shows - and confirms;
 *  - "Hear their voice" is ONE TTS call in their cast voice speaking their
 *    name alone: no prep call, logged as a voice sample;
 *  - while SILENT (the default) both are shown, disabled, with the hint, and
 *    nothing is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useCallback, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { GameState, type Entity } from '../types';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import { PERSONA_VOICE_COPY } from '../components/tabs/PersonaVoiceRow';
import { NARRATION_VOICE_COPY } from '../components/Chat';
import { useNarrationVoice } from '../hooks/useNarrationVoice';
import { useCastBasis } from '../hooks/useVoiceCast';
import { usePersonaeVoice, voiceSampleLine } from '../hooks/usePersonaeVoice';
import { IN_CHARACTER_NARRATOR_ID, narratorCharactersFor } from '../narration/narratorChoice';
import { NarrationLogStore } from '../narration/narrationLog';
import { DRAMATIC_READER_NARRATOR } from '../narration/narrators';
import { getNarratorCharacterId, getNarratorProfileId } from '../persistence/uiPrefs';
import type { RunDomainMutation } from '../state/domainMutation';
import { makeEntity } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
type ContentParams = { model: string; contents: string; config?: Record<string, unknown> };
const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });

const player = makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', position: 'Emperor', visibility_network: ['julia'], resources: { investigations: 1 } });
const julia = makeEntity({ entity_id: 'julia', name: 'Julia Mamaea', position: 'Regent', secrets: ['SECRET-POISON-PLOT'], voice: 'SPEECH-STYLE-NOTE' } as Partial<Entity>);
const stranger = makeEntity({ entity_id: 'stranger', name: 'Unmet Conspirator', position: 'Praetorian Prefect' });
const ENTITIES = [player, julia, stranger];

function makeAi() {
  const generateContent = vi.fn(async (params: ContentParams) => {
    if (params.config?.responseModalities) return AUDIO_RESPONSE;
    return { text: 'A prep call that should never happen.' };
  });
  return { ai: { models: { generateContent } }, generateContent };
}

interface HarnessProps { ai: ReturnType<typeof makeAi>['ai']; log: NarrationLogStore; isMockMode?: boolean; apiKey?: string | null }
const probe: { narration: ReturnType<typeof useNarrationVoice> | null } = { narration: null };

/** App.tsx's wiring of the Personae voice, minus everything else App does. */
const Harness: React.FC<HarnessProps> = ({ ai, log, isMockMode = false, apiKey = 'k' }) => {
  const basis = useCastBasis({ voiceCast: null, playerEntity: player, entities: ENTITIES, knowledge: [] });
  const narratorCharacters = narratorCharactersFor(player, ENTITIES, []);
  const narration = useNarrationVoice({
    ai, isMockMode, resolvedApiKey: apiKey, messages: [], gameState: GameState.AWAITING_PLAYER_INPUT, playerEntity: player,
    narrators: [DRAMATIC_READER_NARRATOR], narratorCharacters, voiceCast: basis.effectiveCast, log,
  });
  useEffect(() => { probe.narration = narration; });
  const { handleSetNarrator, handleSetNarratorCharacter } = narration;
  const narrateAs = useCallback((entityId: string) => {
    handleSetNarrator(IN_CHARACTER_NARRATOR_ID);
    handleSetNarratorCharacter(entityId);
  }, [handleSetNarrator, handleSetNarratorCharacter]);
  const personaeVoice = usePersonaeVoice({
    ai, isMockMode, resolvedApiKey: apiKey, narrationVoiceMode: narration.narrationVoiceMode, voiceCast: basis.effectiveCast,
    candidateIds: basis.candidates.map(c => c.entityId),
    narratingId: narration.narratorId === IN_CHARACTER_NARRATOR_ID ? narration.narratorCharacterId : null,
    onNarrateAs: narrateAs, week: 3, turnNumber: 3, log,
  });
  return (
    <DramatisPersonaeTab
      playerEntity={player} entities={ENTITIES} knowledge={[]} turnNumber={3}
      onSpendDeepAnalysis={() => true} onInvestigationOutcome={() => true} runDomainMutation={runDomainMutation}
      ai={ai as unknown as GoogleGenAI} isMockMode={isMockMode} personaeVoice={personaeVoice}
    />
  );
};

let host: HTMLDivElement;
let root: Root;
function mount(props: HarnessProps) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness {...props} />));
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const row = () => host.querySelector<HTMLElement>('.gor-persona-voice')!;
const buttonNamed = (label: string) => [...row().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(label))!;
const describedTexts = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent);

beforeEach(() => {
  localStorage.clear();
  probe.narration = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:p-${++n}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the Personae voice row', () => {
  it('shows each known character\'s cast voice and manner - player-visible only - and says the sample is a paid call', () => {
    mount({ ai: makeAi().ai, log: new NarrationLogStore({ load: false }) });
    const rows = host.querySelectorAll('.gor-persona-voice');
    expect(rows).toHaveLength(1);
    expect(row().textContent).toContain(PERSONA_VOICE_COPY.voice('Gacrux', 'cool, imperious and measured'));
    expect(row().textContent).toContain('Voice: Gacrux — cool, imperious and measured');
    expect(host.textContent).toContain(PERSONA_VOICE_COPY.paidNote);
    expect(host.textContent).not.toContain('Unmet Conspirator');
    expect(host.textContent).not.toContain('SECRET-POISON-PLOT');
    expect(host.textContent).not.toContain('SPEECH-STYLE-NOTE');
    // Keyboard reachable buttons, whose names carry the visible label and the character.
    expect(buttonNamed(PERSONA_VOICE_COPY.narrateAs).type).toBe('button');
    expect(buttonNamed(PERSONA_VOICE_COPY.hear).textContent).toContain(`${PERSONA_VOICE_COPY.hear} (Julia Mamaea)`);
  });

  it('while SILENT (the default) both buttons are shown, disabled, with the hint - and nothing changes or is called', async () => {
    const { ai, generateContent } = makeAi();
    mount({ ai, log: new NarrationLogStore({ load: false }) });
    for (const label of [PERSONA_VOICE_COPY.narrateAs, PERSONA_VOICE_COPY.hear]) {
      const button = buttonNamed(label);
      expect(button.disabled, label).toBe(true);
      expect(describedTexts(button), label).toContain(NARRATION_VOICE_COPY.silent);
      act(() => button.click());
    }
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(probe.narration!.narratorId).toBe('senatorial-partner');
    expect(getNarratorProfileId()).toBeNull();
  });

  it('with no key outside Mock Mode, both are disabled with the no-key line', () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    mount({ ai, log: new NarrationLogStore({ load: false }), apiKey: null });
    expect(buttonNamed(PERSONA_VOICE_COPY.hear).disabled).toBe(true);
    expect(describedTexts(buttonNamed(PERSONA_VOICE_COPY.hear))).toContain(NARRATION_VOICE_COPY.unavailable);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('"Narrate as them" sets "In character…" with this character - the Settings state - and confirms', () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    mount({ ai, log: new NarrationLogStore({ load: false }) });
    const button = buttonNamed(PERSONA_VOICE_COPY.narrateAs);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    act(() => button.click());
    expect(probe.narration!.narratorId).toBe(IN_CHARACTER_NARRATOR_ID);
    expect(probe.narration!.narratorCharacterId).toBe('julia');
    expect(probe.narration!.activeNarrator.displayName).toBe('Julia Mamaea');
    expect(probe.narration!.activeVoice).toBe('Gacrux');
    expect(getNarratorProfileId()).toBe(IN_CHARACTER_NARRATOR_ID);
    expect(getNarratorCharacterId()).toBe('julia');
    expect(buttonNamed(PERSONA_VOICE_COPY.narrateAs).getAttribute('aria-pressed')).toBe('true');
    expect(row().textContent).toContain('Julia Mamaea now narrates.');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('"Hear their voice" is one TTS call in their cast voice, speaking only their name - no prep call - and is logged', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    const log = new NarrationLogStore({ load: false });
    mount({ ai, log });
    act(() => buttonNamed(PERSONA_VOICE_COPY.hear).click());
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.config?.responseModalities).toBeTruthy();
    const voice = (call.config?.speechConfig as { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }).voiceConfig.prebuiltVoiceConfig.voiceName;
    expect(voice).toBe('Gacrux');
    expect(call.contents).toBe('## Transcript:\nI am Julia Mamaea.');
    expect(call.contents).not.toContain('cool, imperious');
    expect(buttonNamed(PERSONA_VOICE_COPY.hear).getAttribute('aria-pressed')).toBe('true');
    expect(log.getSnapshot()[0]).toMatchObject({
      kind: 'voice_sample', sourceLabel: 'Voice of Julia Mamaea', narratorName: 'Julia Mamaea', voice: 'Gacrux', transcript: 'I am Julia Mamaea.',
      voiceStyle: { preset: 'custom', text: 'cool, imperious and measured' },
    });
    // Pressing again stops it; a third press replays from the in-memory cache, no second call.
    act(() => buttonNamed(PERSONA_VOICE_COPY.hear).click());
    act(() => buttonNamed(PERSONA_VOICE_COPY.hear).click());
    await settle();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('Mock Mode: the synthesized tone, no call', async () => {
    localStorage.setItem('gloryOfRome:narrationVoiceMode', 'on_demand');
    const { ai, generateContent } = makeAi();
    mount({ ai, log: new NarrationLogStore({ load: false }), isMockMode: true, apiKey: null });
    act(() => buttonNamed(PERSONA_VOICE_COPY.hear).click());
    await settle();
    expect(generateContent).not.toHaveBeenCalled();
    expect(buttonNamed(PERSONA_VOICE_COPY.hear).getAttribute('aria-pressed')).toBe('true');
  });

  it('the sample line invents nothing: the name, stripped of markup', () => {
    expect(voiceSampleLine('Julia Mamaea')).toBe('I am Julia Mamaea.');
    expect(voiceSampleLine('Julia <whispers> *Mamaea*')).toBe('I am Julia.');
  });
});
