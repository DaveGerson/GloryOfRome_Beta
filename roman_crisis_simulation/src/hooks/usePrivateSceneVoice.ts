/**
 * hooks/usePrivateSceneVoice.ts
 *
 * "Hear them speak": a private-scene NPC's committed lines, spoken in the
 * NPC's own voice (narration/sceneVoice.ts). Always shown, and off until the
 * player turns it on (a device preference). While the narration voice is
 * SILENT - or there is no key outside Mock Mode - the toggle is shown
 * DISABLED with a pointer (`blocked`), and no call is ever made; lines
 * already toggled on keep a disabled control saying why. Each committed NPC line - never a draft, never the
 * player's own lines, never anything but the player-visible transcript
 * (`PrivateScenePlayerView`) - gets a play control.
 *
 * No prep call: the words are already the NPC's. The TTS call runs unless
 * the in-memory audio cache holds the clip, and its input is the cleaned
 * line alone. The NPC's character comes entirely from their own cast VOICE
 * (narration/sceneVoice.ts `npcCastVoice`); their cast delivery note is
 * shown (in Settings → The cast, and on the log entry) and sent nowhere.
 * Each performance is written to the narration log as "Private scene with
 * <name>". Mock Mode: the synthesized tone.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeminiClient } from '../ai/core/geminiService';
import { speakTranscript } from '../ai/tools/narrationVoice';
import { NarrationPlayer } from '../narration/narrationPlayer';
import { narrationLog as sharedNarrationLog, type NarrationLogStore } from '../narration/narrationLog';
import { cleanSceneLineForSpeech, npcCastVoice } from '../narration/sceneVoice';
import type { VoiceCast } from '../narration/voiceCast';
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
    /** Why the voice cannot be heard now - SILENT, or no key - else null. Its controls are shown, disabled. */
    blocked: 'silent' | 'unavailable' | null;
    onSetEnabled: (enabled: boolean) => void;
    /** The control state for a line, or undefined when it gets no control (toggled off, a player line, nothing to say). */
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
    /** The week now, for the log's entries. */
    week?: number;
    log?: NarrationLogStore;
}

export function usePrivateSceneVoice({
    ai, isMockMode, resolvedApiKey, narrationVoiceMode, voiceCast = null, week, log = sharedNarrationLog,
}: UsePrivateSceneVoiceArgs): PrivateSceneNpcVoice {
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

    // Only the voices key the clip: a cast note never reaches the audio.
    const castKey = voiceCast
        ? `${voiceCast.revision}:${Object.entries(voiceCast.members).map(([id, m]) => `${id}=${m.override?.voiceName ?? m.voiceName}`).join(',')}`
        : 'none';
    const weekRef = useRef(week);
    useEffect(() => {
        weekRef.current = week;
    }, [week]);

    useEffect(() => {
        player.setRenderer(
            async (spoken, index) => {
                const source = lineFor.current.get(index);
                if (!source) throw new Error('usePrivateSceneVoice: unknown line');
                // The note is for display only (the log shows it); the voice speaks the words alone.
                const { voiceName: voice, style } = npcCastVoice(voiceCast, source.scene);
                const wav = await speakTranscript(ai, spoken, isMockMode, { callName: 'privateSceneVoice', voiceName: voice });
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
            // The cast's voices key the clip cache: a recast or a voice override is a new clip.
            `${isMockMode ? 'mock' : 'live'}:scene:${castKey}`,
        );
    }, [player, ai, isMockMode, voiceCast, castKey, log]);

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
        if (!offered) return 'silent';
        if (!canReachVoice) return 'unavailable';
        const index = indexOf.current.get(`${scene.sceneId}#${line.sequence}`);
        return index !== undefined && playback.index === index ? playback.status : 'idle';
    }, [enabled, offered, canReachVoice, playback]);

    const onToggle = useCallback((scene: SceneVoiceContext, line: SceneVoiceLine) => {
        if (!offered || !canReachVoice || line.speaker !== 'npc') return;
        const spoken = cleanSceneLineForSpeech(line.text);
        if (!spoken) return;
        player.toggle(slot(scene, line), spoken);
    }, [player, offered, canReachVoice, slot]);

    const blocked = !offered ? 'silent' : !canReachVoice ? 'unavailable' : null;
    return { enabled, blocked, onSetEnabled, stateFor, onToggle };
}
