/**
 * hooks/useNarrationLog.ts
 *
 * The narration log's React seam (narration/narrationLog.ts): the entries,
 * newest first, and replay. Replay voices the LOGGED transcript - words the
 * guard already passed and the player already heard - so it never makes a
 * prep call; the TTS call runs unless this player's in-memory audio cache
 * already holds the clip. Each entry replays in the voice it was logged with;
 * its logged delivery style already shaped the words (or, for a private-scene
 * line, was never sent), so the TTS input is the transcript alone. Mock
 * Mode: the synthesized tone, no call.
 *
 * SILENT holds here too: while the narration voice is off, the log stays
 * readable but replay is 'silenced' - no call is made, and anything playing
 * stops - because SILENT promises the narration is read, not heard (and
 * every replay that misses the cache is a paid call).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeminiClient } from '../ai/core/geminiService';
import { speakTranscript } from '../ai/tools/narrationVoice';
import { NarrationPlayer, type NarrationVoiceStatus } from '../narration/narrationPlayer';
import { narrationLog as sharedNarrationLog, type NarrationLogEntry, type NarrationLogStore } from '../narration/narrationLog';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';

export type NarrationLogControlState = NarrationVoiceStatus | 'unavailable' | 'silenced';

export interface UseNarrationLogArgs {
    ai: GeminiClient;
    isMockMode: boolean;
    resolvedApiKey: string | null | undefined;
    /** The narration voice's mode: 'off' (SILENT) silences replay. */
    narrationVoiceMode: NarrationVoiceMode;
    log?: NarrationLogStore;
}

/** The Dispatch was voiced a touch cooler than the narrator (ai/tools/narrationVoice.ts). */
const REPLAY_TEMPERATURE: Record<NarrationLogEntry['kind'], number> = { chronicle: 1, dispatch: 0.8, private_scene: 1, voice_sample: 1 };

export function useNarrationLog({ ai, isMockMode, resolvedApiKey, narrationVoiceMode, log = sharedNarrationLog }: UseNarrationLogArgs) {
    const entries = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
    const [player] = useState(() => new NarrationPlayer());
    const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const silenced = narrationVoiceMode === 'off';

    const entriesRef = useRef(entries);
    useEffect(() => {
        entriesRef.current = entries;
    }, [entries]);

    useEffect(() => {
        player.setRenderer(
            async (transcript, seq) => {
                const entry = entriesRef.current.find(e => e.seq === seq);
                const wav = await speakTranscript(ai, transcript, isMockMode, {
                    callName: 'narrationReplay',
                    voiceName: entry?.voice ?? 'Enceladus',
                    temperature: entry ? REPLAY_TEMPERATURE[entry.kind] : 1,
                });
                return new Blob([wav], { type: 'audio/wav' });
            },
            isMockMode ? 'mock-replay' : 'live-replay',
        );
    }, [player, ai, isMockMode]);

    useEffect(() => () => player.dispose(), [player]);

    // Turned SILENT: whatever the log is replaying stops.
    useEffect(() => {
        if (silenced) player.stop();
    }, [player, silenced]);

    const toggleReplay = useCallback((entry: NarrationLogEntry) => {
        if (!canReachVoice || silenced) return;
        player.toggle(entry.seq, entry.transcript);
    }, [player, canReachVoice, silenced]);

    const replayStateFor = useCallback((entry: NarrationLogEntry): NarrationLogControlState => {
        if (silenced) return 'silenced';
        if (!canReachVoice) return 'unavailable';
        return playback.index === entry.seq ? playback.status : 'idle';
    }, [silenced, canReachVoice, playback]);

    const stopReplay = useCallback(() => player.stop(), [player]);

    const clearLog = useCallback(() => {
        player.stop();
        log.clear();
    }, [player, log]);

    return { narrationLogEntries: entries, toggleReplay, replayStateFor, stopReplay, clearLog };
}
