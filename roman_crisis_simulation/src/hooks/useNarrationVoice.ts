/**
 * hooks/useNarrationVoice.ts
 *
 * "Hear it performed" - the narration voice's React seam. Owns one
 * narration/narrationPlayer.ts instance for the App's lifetime and wires
 * it to the same `ai` client and `isMockMode` flag every other AI surface
 * receives from hooks/useSettings.ts, plus the device preference in
 * persistence/uiPrefs.ts (`'off' | 'on_demand' | 'auto'`, default off).
 *
 * The privacy line (D4/D5): the only text this hook ever hands to the
 * voice is a COMMITTED `messages[]` entry with `sender === 'gm'` - the
 * streaming bubble, the pending player message, monologues and ribbons
 * never get a control, and nothing else from the game state is passed.
 *
 * Auto mode: the newest GM narration a turn committed plays by itself once
 * the game leaves PROCESSING - never mid-stream (the streaming bubble is
 * not a message), and never a narration restored from a save (loading
 * never passes through PROCESSING, so there is no turn to have committed
 * it).
 *
 * No key and not Mock Mode: nothing is called. Every control reads
 * 'unavailable' and the composer's standing "No token on this device"
 * notice - the existing missing-key path - says why.
 *
 * Nothing here is persisted. Audio lives in the player's in-memory cache
 * and every object URL is revoked on eviction and on unmount.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameState, type Message } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import { performNarration } from '../ai/tools/narrationVoice';
import { NarrationPlayer, type NarrationVoiceStatus } from '../narration/narrationPlayer';
import { getNarrationVoiceMode, setNarrationVoiceMode, type NarrationVoiceMode } from '../persistence/uiPrefs';

/**
 * What one chat bubble's control shows. `undefined` (no control at all) is
 * decided by the caller: voice off, or not a committed GM narration.
 */
export type NarrationVoiceControlState = NarrationVoiceStatus | 'unavailable';

export interface UseNarrationVoiceArgs {
    ai: GeminiClient;
    isMockMode: boolean;
    resolvedApiKey: string | null | undefined;
    messages: readonly Message[];
    gameState: GameState;
}

export function useNarrationVoice({ ai, isMockMode, resolvedApiKey, messages, gameState }: UseNarrationVoiceArgs) {
    const [player] = useState(() => new NarrationPlayer());
    const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

    const [mode, setModeState] = useState<NarrationVoiceMode>(() => getNarrationVoiceMode());
    const handleSetNarrationVoiceMode = useCallback((next: NarrationVoiceMode) => {
        setModeState(next);
        setNarrationVoiceMode(next);
    }, []);

    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const canReachVoiceRef = useRef(canReachVoice);
    useEffect(() => {
        canReachVoiceRef.current = canReachVoice;
    }, [canReachVoice]);

    // The renderer follows the current client and mode. The variant keeps a
    // Mock Mode tone from answering for a real performance in the cache.
    useEffect(() => {
        player.setRenderer(
            async text => {
                const { wav } = await performNarration(ai, text, isMockMode);
                return new Blob([wav], { type: 'audio/wav' });
            },
            isMockMode ? 'mock' : 'live',
        );
    }, [player, ai, isMockMode]);

    // Unmount: stop, and revoke every object URL. The player is reusable, so
    // StrictMode's mount/unmount/mount leaves a working instance behind.
    useEffect(() => () => player.dispose(), [player]);

    // Turned off, or the key went away: fall silent.
    useEffect(() => {
        if (mode === 'off' || !canReachVoice) player.stop();
    }, [player, mode, canReachVoice]);

    // The transcript under the voice changed (a new campaign, a load, a
    // rollback): a clip for a message that is no longer there stops.
    useEffect(() => {
        const { index } = player.getSnapshot();
        if (index !== null && messages[index]?.text !== player.getCurrentText()) player.stop();
    }, [player, messages]);

    // Auto mode. The transcript length is noted when a turn starts; once the
    // game leaves PROCESSING, the newest GM narration beyond that mark plays.
    const turnStartLengthRef = useRef<number | null>(null);
    useEffect(() => {
        if (gameState === GameState.PROCESSING) {
            if (turnStartLengthRef.current === null) turnStartLengthRef.current = messages.length;
            return;
        }
        const start = turnStartLengthRef.current;
        if (start === null) return;
        turnStartLengthRef.current = null;
        if (mode !== 'auto' || !canReachVoiceRef.current) return;
        for (let i = messages.length - 1; i >= start; i--) {
            if (messages[i].sender === 'gm') {
                void player.play(i, messages[i].text, { auto: true });
                return;
            }
        }
    }, [player, gameState, messages, mode]);

    // Stable for the App's lifetime, so memoised ChatMessages never re-render
    // for a new callback identity.
    const toggleNarrationVoice = useCallback((index: number, text: string) => {
        if (!canReachVoiceRef.current) return;
        player.toggle(index, text);
    }, [player]);

    /** The control state for message `index`, or undefined when it gets no control. */
    const narrationVoiceStateFor = useCallback((message: Message, index: number): NarrationVoiceControlState | undefined => {
        if (mode === 'off' || message.sender !== 'gm') return undefined;
        if (!canReachVoice) return 'unavailable';
        return playback.index === index ? playback.status : 'idle';
    }, [mode, canReachVoice, playback]);

    return {
        narrationVoiceMode: mode,
        handleSetNarrationVoiceMode,
        toggleNarrationVoice,
        narrationVoiceStateFor,
        narrationPlayback: playback,
    };
}
