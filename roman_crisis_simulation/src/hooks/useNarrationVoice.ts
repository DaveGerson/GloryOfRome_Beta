/**
 * hooks/useNarrationVoice.ts
 *
 * "Hear it performed" - the narration voice's React seam. Owns one
 * narration/narrationPlayer.ts instance for the App's lifetime and wires
 * it to the same `ai` client and `isMockMode` flag every other AI surface
 * receives from hooks/useSettings.ts, plus the device preference in
 * persistence/uiPrefs.ts (`'off' | 'on_demand' | 'auto'`, default off), and
 * the three Settings selections the performance follows:
 *
 *  - the narration style (narration/narratorChoice.ts): a preset narrator,
 *    a character the player knows narrating in character, or one of the
 *    player's own custom narrators (narration/customNarrators.ts, created,
 *    edited and deleted through this hook);
 *  - the voice: an explicit choice, or else the narrator's own;
 *  - the voice style (narration/voiceStyle.ts): an explicit choice, or else
 *    the narrator's own, which for every preset is "As written".
 *
 * Each is a device preference, never save state, and together they key the
 * clip cache - a change is a new performance, never an old clip replayed.
 *
 * The privacy line (D4/D5): the only text this hook ever hands to the
 * voice is a COMMITTED `messages[]` entry with `sender === 'gm'` - the
 * streaming bubble, the pending player message, monologues and ribbons
 * never get a control, and nothing else from the game state is passed
 * beyond the player's own name and position, which the narrator uses to
 * address them, and - for a narrator in character - the player-visible face
 * (name, public standing) of a character the player knows.
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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameState, type Message, type Entity } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import { performNarration } from '../ai/tools/narrationVoice';
import { NarrationPlayer, type NarrationVoiceStatus } from '../narration/narrationPlayer';
import { NARRATORS, type NarratorProfile } from '../narration/narrators';
import {
    IN_CHARACTER_NARRATOR_ID, chosenCharacter, resolveNarrator, type NarratorCharacter,
} from '../narration/narratorChoice';
import {
    deleteCustomNarrator, loadCustomNarrators, saveCustomNarrator,
    type CustomNarrator, type CustomNarratorDraft, type CustomNarratorSaveResult,
} from '../narration/customNarrators';
import { parseVoiceStyle, voiceStyleKey, type VoiceStyle } from '../narration/voiceStyle';
import {
    getNarrationVoiceMode, setNarrationVoiceMode, type NarrationVoiceMode,
    getNarratorProfileId, setNarratorProfileId,
    getNarratorCharacterId, setNarratorCharacterId,
    getNarratorVoiceChoice, setNarratorVoice, type NarratorVoiceId,
    getJsonPref, setJsonPref, NARRATOR_VOICE_STYLE_KEY,
} from '../persistence/uiPrefs';

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
    /** The player's entity: only its name and position reach the narrator, for address. */
    playerEntity?: Entity | null;
    /** The narrators this build offers; tests inject their own. */
    narrators?: readonly NarratorProfile[];
    /**
     * The characters the player may choose to narrate in character - ONLY
     * the player-visible list (`narratorCharactersFor`, built on
     * `knownRecipientOptionsForPlayer`), never raw entities.
     */
    narratorCharacters?: readonly NarratorCharacter[];
}

const NO_CHARACTERS: readonly NarratorCharacter[] = [];

export function useNarrationVoice({
    ai, isMockMode, resolvedApiKey, messages, gameState, playerEntity,
    narrators = NARRATORS, narratorCharacters = NO_CHARACTERS,
}: UseNarrationVoiceArgs) {
    const [player] = useState(() => new NarrationPlayer());
    const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

    const [mode, setModeState] = useState<NarrationVoiceMode>(() => getNarrationVoiceMode());
    const handleSetNarrationVoiceMode = useCallback((next: NarrationVoiceMode) => {
        setModeState(next);
        setNarrationVoiceMode(next);
    }, []);

    // The narration style: a preset id, `in-character`, or a custom id. The
    // stored value is kept as chosen; `resolveNarrator` decides what it means
    // now (a retired preset, a deleted custom narrator or "in character" with
    // nobody known all fall back to the built-in, and the fallback is what
    // the menu shows).
    const [customNarrators, setCustomNarrators] = useState<CustomNarrator[]>(() => loadCustomNarrators());
    const [storedNarratorId, setStoredNarratorId] = useState<string | null>(() => getNarratorProfileId());
    const [characterId, setCharacterIdState] = useState<string | null>(() => getNarratorCharacterId());
    const resolved = useMemo(() => resolveNarrator({
        narratorId: storedNarratorId, characterId, presets: narrators, customs: customNarrators, characters: narratorCharacters,
    }), [storedNarratorId, characterId, narrators, customNarrators, narratorCharacters]);
    const narrator = resolved.profile;
    // What the "Narration style" select shows: "In character…" stays chosen
    // even before anyone is known, so the character list can explain itself.
    const narratorId = storedNarratorId === IN_CHARACTER_NARRATOR_ID ? IN_CHARACTER_NARRATOR_ID : narrator.id;

    const handleSetNarrator = useCallback((id: string) => {
        setStoredNarratorId(id);
        setNarratorProfileId(id);
    }, []);
    const handleSetNarratorCharacter = useCallback((entityId: string) => {
        setCharacterIdState(entityId);
        setNarratorCharacterId(entityId);
    }, []);

    const handleSaveCustomNarrator = useCallback((draft: CustomNarratorDraft): CustomNarratorSaveResult => {
        const result = saveCustomNarrator(customNarrators, draft);
        if (result.ok) setCustomNarrators(result.narrators);
        return result;
    }, [customNarrators]);
    const handleDeleteCustomNarrator = useCallback((id: string) => {
        setCustomNarrators(deleteCustomNarrator(customNarrators, id));
    }, [customNarrators]);

    // The voice: the player's explicit Settings choice, or - when they never
    // chose one - the narrator's own. Held here, not read inside the
    // renderer, so a change re-keys the cache instead of replaying a clip
    // cached in the old voice.
    const [voiceChoice, setVoiceChoiceState] = useState<NarratorVoiceId | null>(() => getNarratorVoiceChoice());
    const voice = voiceChoice ?? narrator.voice.voiceName;
    const handleSetNarratorVoice = useCallback((next: NarratorVoiceId | null) => {
        setVoiceChoiceState(next);
        setNarratorVoice(next);
    }, []);

    // The voice style: explicit, or the narrator's own (none, for a preset).
    const [styleChoice, setStyleChoiceState] = useState<VoiceStyle | null>(() => parseVoiceStyle(getJsonPref(NARRATOR_VOICE_STYLE_KEY)));
    const style = styleChoice ?? resolved.ownStyle;
    const handleSetVoiceStyle = useCallback((next: VoiceStyle | null) => {
        const valid = next === null ? null : parseVoiceStyle(next);
        setStyleChoiceState(valid);
        setJsonPref(NARRATOR_VOICE_STYLE_KEY, valid);
    }, []);

    const playerName = playerEntity?.name;
    const playerPosition = playerEntity?.position || playerEntity?.epithet;

    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const canReachVoiceRef = useRef(canReachVoice);
    useEffect(() => {
        canReachVoiceRef.current = canReachVoice;
    }, [canReachVoice]);

    // The renderer follows the current client, narrator, voice and style.
    // The variant keeps a Mock Mode tone - or another narrator's, voice's or
    // style's performance - from answering for this one in the cache. The
    // narrator's key covers an edited custom narrator and a different
    // character, too.
    const allowedNames = resolved.allowedNames;
    const variant = `${isMockMode ? 'mock' : 'live'}:${resolved.key}:${voice}:${voiceStyleKey(style)}`;
    useEffect(() => {
        player.setRenderer(
            async text => {
                const { wav } = await performNarration(ai, text, isMockMode, {
                    narrator,
                    voiceName: voice,
                    style,
                    allowedNames,
                    playerContext: playerName ? { name: playerName, position: playerPosition } : null,
                });
                return new Blob([wav], { type: 'audio/wav' });
            },
            variant,
        );
    }, [player, ai, isMockMode, narrator, voice, style, allowedNames, playerName, playerPosition, variant]);

    // A different narrator, voice or style was chosen: the old performance stops.
    useEffect(() => {
        player.stop();
    }, [player, resolved.key, voice, style]);

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
        narrators,
        narratorId,
        handleSetNarrator,
        narratorCharacters,
        narratorCharacterId: chosenCharacter(characterId, narratorCharacters)?.entityId ?? null,
        handleSetNarratorCharacter,
        customNarrators,
        handleSaveCustomNarrator,
        handleDeleteCustomNarrator,
        narratorVoiceChoice: voiceChoice,
        narratorOwnVoice: narrator.voice.voiceName,
        handleSetNarratorVoice,
        voiceStyleChoice: styleChoice,
        narratorOwnStyle: resolved.ownStyle,
        handleSetVoiceStyle,
        /** What performs now: the resolved narrator, voice and style. */
        activeNarrator: resolved,
        activeVoice: voice,
        activeStyle: style,
        toggleNarrationVoice,
        narrationVoiceStateFor,
        narrationPlayback: playback,
    };
}
