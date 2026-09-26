/**
 * hooks/usePersonaeVoice.ts
 *
 * The voice row on each Dramatis Personae card
 * (components/tabs/PersonaVoiceRow.tsx): a known character's cast voice and
 * manner, "Narrate as them" and "Hear their voice".
 *
 * WHO GETS A ROW: exactly the casting candidates (narration/voiceCast.ts
 * `castingCandidatesFor`) - living individuals the player knows, the same
 * player-visible list the cast and "In character…" are built on.
 *
 * "Narrate as them" sets the narration style to "In character…" with this
 * character - the very state Settings holds (hooks/useNarrationVoice.ts);
 * the caller supplies it. No call is made.
 *
 * "Hear their voice" plays ONE fixed, neutral line - `voiceSampleLine`, "I
 * am <name>." - in the character's cast voice. The words are the player-
 * visible name and nothing else, so nothing is invented and no prep call is
 * made: one TTS call (a paid call on the player's key; Mock Mode, the
 * synthesized tone), cached in memory like every clip, and written to the
 * narration log as "Voice of <name>". Their cast note is shown on the row
 * and the log entry, and sent nowhere - as in a private scene.
 *
 * SILENT, or no key outside Mock Mode: both controls are shown, disabled
 * (`blocked`), and nothing is ever called.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeminiClient } from '../ai/core/geminiService';
import { speakTranscript } from '../ai/tools/narrationVoice';
import { NarrationPlayer } from '../narration/narrationPlayer';
import { narrationLog as sharedNarrationLog, type NarrationLogStore } from '../narration/narrationLog';
import { cleanSceneLineForSpeech } from '../narration/sceneVoice';
import { castStyle, effectiveMember, type VoiceCast } from '../narration/voiceCast';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';
import type { NarrationVoiceControlState } from './useNarrationVoice';

/** The one line a voice sample speaks: the character's own name, nothing more (veto queue, B13). */
export function voiceSampleLine(name: string): string {
    return cleanSceneLineForSpeech(`I am ${name}.`);
}

/** The narration log's label for a sample (veto queue, B13). */
export function voiceSampleSourceLabel(name: string): string {
    return `Voice of ${name}`;
}

/** One card's voice: their cast voice and manner (the override over the casting). */
export interface PersonaVoice {
    voiceName: string;
    style: string;
}

/** The Personae tab's voice seam. */
export interface PersonaeVoice {
    /** Why neither control can act now - SILENT, or no key - else null. */
    blocked: 'silent' | 'unavailable' | null;
    /** A known character's cast voice, or null when they get no row. */
    voiceFor: (entityId: string) => PersonaVoice | null;
    /** The character narrating now ("In character…"), if any. */
    narratingId: string | null;
    onNarrateAs: (entityId: string) => void;
    sampleStateFor: (entityId: string) => NarrationVoiceControlState;
    onHear: (entityId: string, name: string) => void;
}

export interface UsePersonaeVoiceArgs {
    ai: GeminiClient;
    isMockMode: boolean;
    resolvedApiKey: string | null | undefined;
    narrationVoiceMode: NarrationVoiceMode;
    /** The effective cast (hooks/useVoiceCast.ts): complete for everyone the player knows. */
    voiceCast: VoiceCast | null;
    /** The casting candidates' ids: who gets a row. */
    candidateIds: readonly string[];
    narratingId: string | null;
    /** Sets "In character…" with this character (hooks/useNarrationVoice.ts). */
    onNarrateAs: (entityId: string) => void;
    week?: number;
    turnNumber?: number;
    log?: NarrationLogStore;
}

export function usePersonaeVoice({
    ai, isMockMode, resolvedApiKey, narrationVoiceMode, voiceCast, candidateIds, narratingId, onNarrateAs,
    week, turnNumber, log = sharedNarrationLog,
}: UsePersonaeVoiceArgs): PersonaeVoice {
    const [player] = useState(() => new NarrationPlayer());
    const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const silent = narrationVoiceMode === 'off';
    const blocked = silent ? 'silent' : !canReachVoice ? 'unavailable' : null;

    // One index per character, for the player's cache key.
    const indexOf = useRef(new Map<string, number>());
    const sampleFor = useRef(new Map<number, { entityId: string; name: string }>());
    const slot = useCallback((entityId: string, name: string) => {
        let index = indexOf.current.get(entityId);
        if (index === undefined) {
            index = indexOf.current.size + 1;
            indexOf.current.set(entityId, index);
        }
        sampleFor.current.set(index, { entityId, name });
        return index;
    }, []);

    const castRef = useRef(voiceCast);
    const weekRef = useRef({ week, turnNumber });
    useEffect(() => {
        castRef.current = voiceCast;
        weekRef.current = { week, turnNumber };
    }, [voiceCast, week, turnNumber]);

    const voiceFor = useCallback((entityId: string): PersonaVoice | null => {
        if (!candidateIds.includes(entityId)) return null;
        const member = voiceCast?.members[entityId];
        return member ? effectiveMember(member) : null;
    }, [candidateIds, voiceCast]);

    // Only the voices key the clip: a note never reaches the audio.
    const castKey = voiceCast
        ? Object.entries(voiceCast.members).map(([id, m]) => `${id}=${m.override?.voiceName ?? m.voiceName}`).join(',')
        : 'none';
    useEffect(() => {
        player.setRenderer(
            async (line, index) => {
                const sample = sampleFor.current.get(index);
                const member = sample ? castRef.current?.members[sample.entityId] : undefined;
                if (!sample || !member) throw new Error('usePersonaeVoice: unknown character');
                const { voiceName, style } = effectiveMember(member);
                const wav = await speakTranscript(ai, line, isMockMode, { callName: 'personaeVoiceSample', voiceName });
                log.record({
                    kind: 'voice_sample',
                    sourceLabel: voiceSampleSourceLabel(sample.name),
                    sourceText: line,
                    narratorKey: `sample:${sample.entityId}`,
                    narratorName: sample.name,
                    voice: voiceName,
                    voiceStyle: castStyle(style),
                    transcript: line,
                    patchedOut: [],
                    usedFallback: false,
                    week: weekRef.current.week ?? null,
                    turn: weekRef.current.turnNumber ?? null,
                });
                return new Blob([wav], { type: 'audio/wav' });
            },
            `${isMockMode ? 'mock' : 'live'}:sample:${castKey}`,
        );
    }, [player, ai, isMockMode, castKey, log]);

    useEffect(() => () => player.dispose(), [player]);

    // Turned SILENT, or the key went away: the sample stops.
    useEffect(() => {
        if (blocked) player.stop();
    }, [player, blocked]);

    const onHear = useCallback((entityId: string, name: string) => {
        if (blocked || !voiceFor(entityId)) return;
        const line = voiceSampleLine(name);
        if (!line) return;
        player.toggle(slot(entityId, name), line);
    }, [player, blocked, voiceFor, slot]);

    const narrateAs = useCallback((entityId: string) => {
        if (blocked || !voiceFor(entityId)) return;
        onNarrateAs(entityId);
    }, [blocked, voiceFor, onNarrateAs]);

    const sampleStateFor = useCallback((entityId: string): NarrationVoiceControlState => {
        if (blocked) return blocked;
        const index = indexOf.current.get(entityId);
        return index !== undefined && playback.index === index ? playback.status : 'idle';
    }, [blocked, playback]);

    return { blocked, voiceFor, narratingId, onNarrateAs: narrateAs, sampleStateFor, onHear };
}
