/**
 * hooks/usePrivateSceneVoice.ts
 *
 * "Hear them speak": a private-scene NPC's committed lines, spoken in the
 * NPC's own voice (narration/sceneVoice.ts). Offered only while the
 * narration voice is not SILENT, and off until the player turns it on (a
 * device preference). Each committed NPC line - never a draft, never the
 * player's own lines, never anything but the player-visible transcript
 * (`PrivateScenePlayerView`) - gets a play control.
 *
 * No prep call: the words are already the NPC's. The TTS call runs unless
 * the in-memory audio cache holds the clip. The voice and delivery note are
 * the NPC's own, from the campaign's voice cast (narration/sceneVoice.ts
 * `npcCastVoice`); the note is dropped while "Bespoke character voices" is
 * off. Each performance is written to the narration log as "Private scene
 * with <name>", with the voice and style it was spoken in. Mock Mode: the
 * synthesized tone.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeminiClient } from '../ai/core/geminiService';
import { speakTranscript } from '../ai/tools/narrationVoice';
import { NarrationPlayer } from '../narration/narrationPlayer';
import { narrationLog as sharedNarrationLog, type NarrationLogStore } from '../narration/narrationLog';
import { cleanSceneLineForSpeech, npcCastVoice } from '../narration/sceneVoice';
import type { VoiceCast } from '../narration/voiceCast';
import { voiceStyleKey } from '../narration/voiceStyle';
import { getSceneVoicesEnabled, setSceneVoicesEnabled, type NarrationVoiceMode } from '../persistence/uiPrefs';
import type { NarrationVoiceControlState } from './useNarrationVoice';

/** The scene a line belongs to: the player-visible fields the voice needs. */
export interface SceneVoiceContext {
    sceneId: string;
    npcId: string;
    npcName: string;
    macroTurn: number;
}

export interface SceneVoiceLine {
    sequence: number;
    speaker: 'player' | 'npc';
    text: string;
}

/** The private-scene surface's voice seam (components/PrivateScene.tsx). */
export interface PrivateSceneNpcVoice {
    enabled: boolean;
    onSetEnabled: (enabled: boolean) => void;
    /** The control state for a line, or undefined when it gets no control (a player line, voice off, nothing to say). */
    stateFor: (scene: SceneVoiceContext, line: SceneVoiceLine) => NarrationVoiceControlState | undefined;
    onToggle: (scene: SceneVoiceContext, line: SceneVoiceLine) => void;
}

export function sceneSourceLabel(npcName: string): string {
    return `Private scene with ${npcName}`;
}

export interface UsePrivateSceneVoiceArgs {
    ai: GeminiClient;
    isMockMode: boolean;
    resolvedApiKey: string | null | undefined;
    narrationVoiceMode: NarrationVoiceMode;
    /** The campaign's voice cast: each NPC speaks in their own cast voice. */
    voiceCast?: VoiceCast | null;
    /** "Bespoke character voices": false drops every cast delivery note. Default true. */
    bespokeVoices?: boolean;
    /** The week now, for the log's entries. */
    week?: number;
    log?: NarrationLogStore;
}

export function usePrivateSceneVoice({
    ai, isMockMode, resolvedApiKey, narrationVoiceMode, voiceCast = null, bespokeVoices = true, week, log = sharedNarrationLog,
}: UsePrivateSceneVoiceArgs): PrivateSceneNpcVoice | undefined {
    const [player] = useState(() => new NarrationPlayer());
    const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
    const [enabled, setEnabledState] = useState(() => getSceneVoicesEnabled());
    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const offered = narrationVoiceMode !== 'off';

    // One number per (scene, line): the player's index and cache key.
    const indexOf = useRef(new Map<string, number>());
    const lineFor = useRef(new Map<number, { scene: SceneVoiceContext; text: string }>());
    const slot = useCallback((scene: SceneVoiceContext, line: SceneVoiceLine) => {
        const key = `${scene.sceneId}#${line.sequence}`;
        let index = indexOf.current.get(key);
        if (index === undefined) {
            index = indexOf.current.size + 1;
            indexOf.current.set(key, index);
        }
        lineFor.current.set(index, { scene, text: line.text });
        return index;
    }, []);

    const castKey = voiceCast
        ? `${voiceCast.revision}:${bespokeVoices ? 'b' : 'p'}:${Object.entries(voiceCast.members).map(([id, m]) => `${id}=${m.override?.voiceName ?? m.voiceName}/${voiceStyleKey(bespokeVoices ? { preset: 'custom', text: m.override?.style ?? m.style } : null)}`).join(',')}`
        : `none:${bespokeVoices ? 'b' : 'p'}`;
    const weekRef = useRef(week);
    useEffect(() => {
        weekRef.current = week;
    }, [week]);

    useEffect(() => {
        player.setRenderer(
            async (spoken, index) => {
                const source = lineFor.current.get(index);
                if (!source) throw new Error('usePrivateSceneVoice: unknown line');
                const { voiceName: voice, style } = npcCastVoice(voiceCast, source.scene, bespokeVoices);
                const wav = await speakTranscript(ai, spoken, isMockMode, { callName: 'privateSceneVoice', voiceName: voice, style });
                log.record({
                    kind: 'private_scene',
                    sourceLabel: sceneSourceLabel(source.scene.npcName),
                    sourceText: source.text,
                    narratorKey: `npc:${source.scene.npcId}`,
                    narratorName: source.scene.npcName,
                    voice,
                    voiceStyle: style,
                    transcript: spoken,
                    patchedOut: [],
                    usedFallback: false,
                    week: weekRef.current ?? null,
                    turn: source.scene.macroTurn,
                });
                return new Blob([wav], { type: 'audio/wav' });
            },
            // The cast keys the clip cache: a recast or an override is a new clip.
            `${isMockMode ? 'mock' : 'live'}:scene:${castKey}`,
        );
    }, [player, ai, isMockMode, voiceCast, bespokeVoices, castKey, log]);

    useEffect(() => () => player.dispose(), [player]);

    // Turned off, or the voice went silent: the room falls quiet.
    useEffect(() => {
        if (!offered || !enabled || !canReachVoice) player.stop();
    }, [player, offered, enabled, canReachVoice]);

    const onSetEnabled = useCallback((next: boolean) => {
        setEnabledState(next);
        setSceneVoicesEnabled(next);
    }, []);

    const stateFor = useCallback((scene: SceneVoiceContext, line: SceneVoiceLine): NarrationVoiceControlState | undefined => {
        if (!enabled || line.speaker !== 'npc' || !cleanSceneLineForSpeech(line.text)) return undefined;
        if (!canReachVoice) return 'unavailable';
        const index = indexOf.current.get(`${scene.sceneId}#${line.sequence}`);
        return index !== undefined && playback.index === index ? playback.status : 'idle';
    }, [enabled, canReachVoice, playback]);

    const onToggle = useCallback((scene: SceneVoiceContext, line: SceneVoiceLine) => {
        if (!canReachVoice || line.speaker !== 'npc') return;
        const spoken = cleanSceneLineForSpeech(line.text);
        if (!spoken) return;
        player.toggle(slot(scene, line), spoken);
    }, [player, canReachVoice, slot]);

    if (!offered) return undefined;
    return { enabled, onSetEnabled, stateFor, onToggle };
}
