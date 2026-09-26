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
 *    the narrator's own, which for every preset is "As written". It shapes
 *    the prep model's acted script - words and cues - (its delivery brief);
 *    the TTS input is that script and nothing else, always.
 *
 * With no explicit narration style, the Dramatic Reader performs, in its own
 * voice (Enceladus) and manner - always, whatever the campaign's voice cast
 * (narration/voiceCast.ts, hooks/useVoiceCast.ts) holds: the cast never
 * picks the reader. A narrator in character performs in that character's
 * cast voice and note. Explicit choices always win
 * (narration/narratorChoice.ts). The cast also
 * tells the scriptwriter how the people a passage names speak: each named
 * member's player-visible note reaches the prep prompt's cast block
 * (`performNarration`'s `cast`), for every narrator, in character or not.
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
 * SILENT (the default): nothing is called, ever - not a prep call, not a TTS
 * call. Every committed GM narration still carries its control, disabled,
 * reading 'silent', whose line points to Settings.
 *
 * Nothing here is persisted. Audio lives in the player's in-memory cache
 * and every object URL is revoked on eviction and on unmount.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameState, type Message, type Entity } from '../types';
import type { GeminiClient } from '../ai/core/geminiService';
import { performNarration, speakTranscript } from '../ai/tools/narrationVoice';
import { narrationLog as sharedNarrationLog, type NarrationLogStore } from '../narration/narrationLog';
import { castInPassage, describeListener } from '../ai/prompts/narrationPerformance';
import { toRoman } from '../components/ui/Brand';
import { NarrationPlayer, hashText, type NarrationVoiceStatus } from '../narration/narrationPlayer';
import { NARRATORS, type NarratorProfile } from '../narration/narrators';
import {
    IN_CHARACTER_NARRATOR_ID, chosenCharacter, resolveNarrator, type NarratorCharacter,
} from '../narration/narratorChoice';
import {
    deleteCustomNarrator, loadCustomNarrators, saveCustomNarrator,
    type CustomNarrator, type CustomNarratorDraft, type CustomNarratorSaveResult,
} from '../narration/customNarrators';
import { parseVoiceStyle, voiceStyleKey, type VoiceStyle } from '../narration/voiceStyle';
import { castMannersFor, type CastingCandidate, type VoiceCast } from '../narration/voiceCast';
import { speakableText } from '../narration/performanceScript';
import {
    getNarrationVoiceMode, setNarrationVoiceMode, type NarrationVoiceMode,
    getNarratorProfileId, setNarratorProfileId,
    getNarratorCharacterId, setNarratorCharacterId,
    getNarratorVoiceChoice, setNarratorVoice, type NarratorVoiceId,
    getJsonPref, setJsonPref, NARRATOR_VOICE_STYLE_KEY,
} from '../persistence/uiPrefs';

/**
 * What one chat bubble's control shows. `undefined` (no control at all)
 * means only: not a committed GM narration. 'silent' (the voice is SILENT)
 * and 'unavailable' (no key) are shown, disabled, with a pointer - never
 * hidden, so the player can always find the voice.
 */
export type NarrationVoiceControlState = NarrationVoiceStatus | 'unavailable' | 'silent';

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
    /** The week and turn now, for the narration log's labels. */
    week?: number;
    turnNumber?: number;
    /** The narration log (narration/narrationLog.ts); tests inject their own. */
    log?: NarrationLogStore;
    /** The campaign's voice cast, complete for everyone the player knows (hooks/useVoiceCast.ts). */
    voiceCast?: VoiceCast | null;
    /**
     * The casting candidates (hooks/useVoiceCast.ts `useCastBasis`): the
     * player-visible projection, read here only for each member's public
     * epithet, so a passage that names someone by it still finds their note.
     */
    castCandidates?: readonly Pick<CastingCandidate, 'entityId' | 'epithet'>[];
}

/** The week a message belongs to: the last week ribbon before it, else `fallback`. */
export function weekOfMessage(messages: readonly Message[], index: number, fallback: number | undefined): number | undefined {
    for (let i = Math.min(index, messages.length - 1); i >= 0; i--) {
        const date = messages[i]?.ribbonDate;
        if (messages[i]?.sender === 'ribbon' && date) return date.week;
    }
    return fallback;
}

/** "Week XI narration" - the log's label for a chronicle narration (veto-queue copy). */
export function chronicleSourceLabel(week: number | undefined): string {
    return week ? `Week ${toRoman(week)} narration` : 'The chronicle';
}

const NO_CHARACTERS: readonly NarratorCharacter[] = [];
const NO_CANDIDATES: readonly Pick<CastingCandidate, 'entityId' | 'epithet'>[] = [];

export function useNarrationVoice({
    ai, isMockMode, resolvedApiKey, messages, gameState, playerEntity,
    narrators = NARRATORS, narratorCharacters = NO_CHARACTERS,
    week, turnNumber, log = sharedNarrationLog, voiceCast = null, castCandidates = NO_CANDIDATES,
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
        cast: voiceCast,
    }), [storedNarratorId, characterId, narrators, customNarrators, narratorCharacters, voiceCast]);
    const narrator = resolved.profile;
    // What the "Narration style" select shows: "In character…" stays chosen
    // even before anyone is known, so the character list can explain itself.
    const narratorId = storedNarratorId === IN_CHARACTER_NARRATOR_ID ? IN_CHARACTER_NARRATOR_ID : narrator.id;

    // '' clears the explicit choice: the Dramatic Reader reads again.
    const handleSetNarrator = useCallback((id: string) => {
        setStoredNarratorId(id || null);
        setNarratorProfileId(id || null);
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
    const styleKey = voiceStyleKey(style);
    const handleSetVoiceStyle = useCallback((next: VoiceStyle | null) => {
        const valid = next === null ? null : parseVoiceStyle(next);
        setStyleChoiceState(valid);
        setJsonPref(NARRATOR_VOICE_STYLE_KEY, valid);
    }, []);

    const playerName = playerEntity?.name;
    const playerPosition = playerEntity?.position || playerEntity?.epithet;

    const canReachVoice = isMockMode || Boolean(resolvedApiKey);
    const canReachVoiceRef = useRef(canReachVoice);
    // SILENT makes no call, whatever asks: the stable toggle reads this too.
    const silentRef = useRef(mode === 'off');
    useEffect(() => {
        canReachVoiceRef.current = canReachVoice;
        silentRef.current = mode === 'off';
    }, [canReachVoice, mode]);

    // The renderer follows the current client, narrator, voice and style.
    // The variant keeps a Mock Mode tone - or another narrator's, voice's or
    // style's performance - from answering for this one in the cache. The
    // narrator's key covers an edited custom narrator and a different
    // character, too.
    //
    // Every new performance is written to the narration log, and a transcript
    // the log already holds for this source and narrator is voiced again
    // without a second prep call (narration/narrationLog.ts, "Reuse"). The
    // style keys the reuse too: it shaped the words, so a transcript written
    // for one manner is not reused for another.
    const allowedNames = resolved.allowedNames;
    // How the people in a passage speak: every cast member's note (a narrator
    // in character carries their own in the delivery brief, so not twice).
    // The notes shape the script, so they key the clip cache - and, per
    // passage, the reuse of a logged transcript: only the notes of those the
    // passage names, so a newcomer's casting reuses every other transcript.
    const selfId = resolved.character?.entityId;
    const castManners = useMemo(
        () => castMannersFor(voiceCast, castCandidates).filter(m => m.entityId !== selfId),
        [voiceCast, castCandidates, selfId],
    );
    const castKey = castManners.length > 0 ? `:${hashText(JSON.stringify(castManners.map(m => [m.name, m.epithet ?? '', m.manner])))}` : '';
    const variant = `${isMockMode ? 'mock' : 'live'}:${resolved.key}:${voice}:${styleKey}${castKey}`;
    const listener = useMemo(() => (playerName ? { name: playerName, position: playerPosition } : null), [playerName, playerPosition]);
    const reuseKey = `${resolved.key}|${describeListener(listener) ?? ''}${styleKey === 'as-written' ? '' : `|${styleKey}`}`;
    const messagesRef = useRef(messages);
    const weekRef = useRef({ week, turnNumber });
    useEffect(() => {
        messagesRef.current = messages;
        weekRef.current = { week, turnNumber };
    }, [messages, week, turnNumber]);
    useEffect(() => {
        player.setRenderer(
            async (text, index) => {
                const present = castInPassage(speakableText(text), castManners);
                const passageKey = present.length > 0
                    ? `${reuseKey}|cast:${hashText(JSON.stringify(present.map(m => [m.name, m.manner])))}`
                    : reuseKey;
                const reusable = isMockMode ? undefined : log.findReusable(text, passageKey);
                if (reusable) {
                    const wav = await speakTranscript(ai, reusable.transcript, isMockMode, {
                        model: narrator.voice.model, voiceName: voice, temperature: narrator.voice.temperature,
                    });
                    return new Blob([wav], { type: 'audio/wav' });
                }
                const performed = await performNarration(ai, text, isMockMode, {
                    narrator,
                    voiceName: voice,
                    style,
                    allowedNames,
                    playerContext: listener,
                    cast: castManners,
                });
                const messageWeek = weekOfMessage(messagesRef.current, index, weekRef.current.week);
                log.record({
                    kind: 'chronicle',
                    sourceLabel: chronicleSourceLabel(messageWeek),
                    sourceText: text,
                    narratorKey: passageKey,
                    narratorName: resolved.displayName,
                    voice,
                    voiceStyle: style,
                    transcript: performed.transcript,
                    patchedOut: performed.patchedOut,
                    droppedCues: performed.droppedCues,
                    usedFallback: performed.usedFallback,
                    week: messageWeek ?? null,
                    turn: weekRef.current.turnNumber ?? null,
                });
                return new Blob([performed.wav], { type: 'audio/wav' });
            },
            variant,
        );
    }, [player, ai, isMockMode, narrator, voice, style, allowedNames, listener, variant, log, reuseKey, resolved.displayName, castManners]);

    // A different narrator, voice or style was chosen: the old performance stops.
    // Keyed on the style's instruction, not its object: a recast that leaves
    // this narrator's delivery as it was does not cut a performance short.
    useEffect(() => {
        player.stop();
    }, [player, resolved.key, voice, styleKey]);

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
        if (!canReachVoiceRef.current || silentRef.current) return;
        player.toggle(index, text);
    }, [player]);

    /** The control state for message `index`, or undefined when it gets no control. */
    const narrationVoiceStateFor = useCallback((message: Message, index: number): NarrationVoiceControlState | undefined => {
        if (message.sender !== 'gm') return undefined;
        if (mode === 'off') return 'silent';
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
        /** The narrator's own voice and style come from the voice cast (a narrator in character). */
        narratorVoiceFromCast: Boolean(resolved.castVoice),
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
