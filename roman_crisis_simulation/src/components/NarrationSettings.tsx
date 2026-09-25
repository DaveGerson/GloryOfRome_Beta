import React, { useId, useState } from 'react';
import { SegmentedControl } from './ui/Forms';
import { CustomNarratorEditor } from './CustomNarratorEditor';
import {
    type NarrationVoiceMode,
    NARRATOR_VOICES,
    DEFAULT_NARRATOR_VOICE_ID,
    getNarratorVoiceChoice,
    setNarratorVoice,
    type NarratorVoiceId,
} from '../persistence/uiPrefs';
import { IN_CHARACTER_NARRATOR_ID, type NarratorCharacter } from '../narration/narratorChoice';
import { CUSTOM_NARRATOR_DEFAULT_DESCRIPTION, type CustomNarrator, type CustomNarratorDraft, type CustomNarratorSaveResult } from '../narration/customNarrators';
import type { VoiceStyle } from '../narration/voiceStyle';
import { VoiceStylePicker, narrationSelectStyle } from './VoiceStylePicker';

/** The slice of a narrator profile (narration/narrators.ts) the picker shows. */
export interface NarratorChoice {
    id: string;
    name: string;
    description: string;
    /** The narrator's own voice, shown when no explicit voice is chosen. */
    voiceName?: string;
}

/**
 * The narration voice ("hear it performed", hooks/useNarrationVoice.ts) -
 * a device preference (persistence/uiPrefs.ts), default SILENT because
 * every performance is a paid call on the player's own key. Copy is
 * veto-queue (roadmaps/BACKLOG.md B13).
 */
export const NARRATOR_MODE_OPTIONS: { value: NarrationVoiceMode; label: string; title: string; description: string }[] = [
    { value: 'off', label: 'SILENT', title: 'The narration is read, not heard', description: 'The narration is read, not heard.' },
    { value: 'on_demand', label: 'ON REQUEST', title: 'A play control on each narration', description: 'A play control on each narration. Every performance is a paid call on your key.' },
    { value: 'auto', label: 'EVERY WEEK', title: 'Each new narration is performed as the week turns', description: 'Each new narration is performed as the week turns. Every performance is a paid call on your key.' },
];

/** Player-visible copy for the narration settings (veto-queue: roadmaps/BACKLOG.md B13). */
export const NARRATION_SETTINGS_COPY = {
    styleLabel: 'Narration style',
    readersGroup: 'Readers',
    inCharacter: 'In character…',
    customGroup: 'Your narrators',
    characterLabel: 'Narrating character',
    noCharacters: 'No one you know yet. The Dramatic Reader reads until you do.',
    inCharacterNote: (name: string) => `The week as ${name} tells it, from where they stand. They know only what you know.`,
    voiceLabel: 'Voice',
    ownVoice: (voice: string) => `The narrator's own — ${voice}`,
    ownVoiceNote: 'The voice each narrator was tuned with.',
    styleOfVoiceLabel: 'Voice style',
    asWrittenNote: 'No delivery note: the voice reads the words alone.',
    styledNote: 'A short delivery note goes before the words. If the voice reads it aloud, choose As written.',
} as const;

export interface NarrationSettingsProps {
    narrationVoiceMode: NarrationVoiceMode;
    onSetNarrationVoiceMode: (mode: NarrationVoiceMode) => void;
    /** The preset narrators this build offers (the built-in plus each deployed profile). */
    narrators?: readonly NarratorChoice[];
    narratorId?: string;
    onSetNarrator?: (id: string) => void;
    /** ONLY player-known characters (narration/narratorChoice.ts `narratorCharactersFor`). */
    narratorCharacters?: readonly NarratorCharacter[];
    narratorCharacterId?: string | null;
    onSetNarratorCharacter?: (entityId: string) => void;
    /**
     * The player's explicit voice (persistence/uiPrefs.ts), null for "the
     * narrator's own". Omitted, the menu manages the preference itself.
     */
    narratorVoiceChoice?: NarratorVoiceId | null;
    /** The chosen narrator's own voice, named in the "own voice" option. */
    narratorOwnVoice?: string;
    onSetNarratorVoice?: (voice: NarratorVoiceId | null) => void;
    voiceStyleChoice?: VoiceStyle | null;
    narratorOwnStyle?: VoiceStyle | null;
    onSetVoiceStyle?: (style: VoiceStyle | null) => void;
    customNarrators?: readonly CustomNarrator[];
    onSaveCustomNarrator?: (draft: CustomNarratorDraft) => CustomNarratorSaveResult;
    onDeleteCustomNarrator?: (id: string) => void;
}

/**
 * Settings → Play → the narration voice: the mode, then - while the voice
 * is on - three separate selections (narration style, voice, voice style)
 * and the player's own narrators, behind a disclosure so they never flood
 * the menu. Every value is owned by hooks/useNarrationVoice.ts; this only
 * reports choices (except the voice, which it keeps itself when no hook is
 * wired, as the menu always has).
 */
export const NarrationSettings: React.FC<NarrationSettingsProps> = ({
    narrationVoiceMode, onSetNarrationVoiceMode,
    narrators = [], narratorId, onSetNarrator,
    narratorCharacters = [], narratorCharacterId, onSetNarratorCharacter,
    narratorVoiceChoice, narratorOwnVoice, onSetNarratorVoice,
    voiceStyleChoice = null, narratorOwnStyle = null, onSetVoiceStyle,
    customNarrators = [], onSaveCustomNarrator, onDeleteCustomNarrator,
}) => {
    const ids = useId();
    const selectedMode = NARRATOR_MODE_OPTIONS.find(option => option.value === narrationVoiceMode) ?? NARRATOR_MODE_OPTIONS[0];
    const voiceOn = narrationVoiceMode !== 'off';

    // The voice: controlled by the App's narration hook when it passes one;
    // otherwise this menu reads and writes the device preference itself.
    const [localVoiceChoice, setLocalVoiceChoice] = useState<NarratorVoiceId | null>(() => getNarratorVoiceChoice());
    const voiceChoice = narratorVoiceChoice !== undefined ? narratorVoiceChoice : localVoiceChoice;
    const inCharacterOffered = onSetNarratorCharacter !== undefined;
    const inCharacter = inCharacterOffered && narratorId === IN_CHARACTER_NARRATOR_ID;
    const chosenCustom = customNarrators.find(n => n.id === narratorId);
    const chosenPreset = narrators.find(n => n.id === narratorId) ?? narrators[0];
    const character = narratorCharacters.find(c => c.entityId === narratorCharacterId) ?? narratorCharacters[0];
    const ownVoice = narratorOwnVoice ?? chosenCustom?.voiceName ?? chosenPreset?.voiceName ?? DEFAULT_NARRATOR_VOICE_ID;
    const handleVoiceChange = (value: string) => {
        const next = NARRATOR_VOICES.find(v => v.id === value)?.id ?? null;
        setLocalVoiceChoice(next);
        (onSetNarratorVoice ?? setNarratorVoice)(next);
    };

    const styleNote = inCharacter
        ? (character ? NARRATION_SETTINGS_COPY.inCharacterNote(character.name) : NARRATION_SETTINGS_COPY.noCharacters)
        : chosenCustom
            ? (chosenCustom.description || CUSTOM_NARRATOR_DEFAULT_DESCRIPTION)
            : chosenPreset?.description;
    const selectValue = inCharacter ? IN_CHARACTER_NARRATOR_ID : (chosenCustom?.id ?? chosenPreset?.id ?? '');
    const effectiveStyle = voiceStyleChoice ?? narratorOwnStyle;

    return (
        <>
            <span className="gor-label gor-config-label">Narrator's voice</span>
            <div>
                <SegmentedControl
                    radio
                    ariaLabel="Narrator's voice"
                    describedBy="settings-narrator-note"
                    options={NARRATOR_MODE_OPTIONS.map(({ value, label, title }) => ({ value, label, title }))}
                    value={narrationVoiceMode}
                    onChange={onSetNarrationVoiceMode}
                />
                <p className="gor-config-note" id="settings-narrator-note">{selectedMode.description}</p>
            </div>
            {voiceOn && onSetNarrator && narrators.length > 0 && (
                <>
                    <label className="gor-label gor-config-label" htmlFor={`${ids}-style`}>{NARRATION_SETTINGS_COPY.styleLabel}</label>
                    <div>
                        <select
                            id={`${ids}-style`}
                            aria-label={NARRATION_SETTINGS_COPY.styleLabel}
                            aria-describedby={`${ids}-style-note`}
                            value={selectValue}
                            onChange={e => onSetNarrator(e.target.value)}
                            style={narrationSelectStyle}
                        >
                            <optgroup label={NARRATION_SETTINGS_COPY.readersGroup}>
                                {narrators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                            </optgroup>
                            {inCharacterOffered && <option value={IN_CHARACTER_NARRATOR_ID}>{NARRATION_SETTINGS_COPY.inCharacter}</option>}
                            {customNarrators.length > 0 && (
                                <optgroup label={NARRATION_SETTINGS_COPY.customGroup}>
                                    {customNarrators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                </optgroup>
                            )}
                        </select>
                        {inCharacter && narratorCharacters.length > 0 && character && (
                            <select
                                aria-label={NARRATION_SETTINGS_COPY.characterLabel}
                                value={character.entityId}
                                onChange={e => onSetNarratorCharacter?.(e.target.value)}
                                style={{ ...narrationSelectStyle, marginTop: 6 }}
                            >
                                {narratorCharacters.map(c => (
                                    <option key={c.entityId} value={c.entityId}>{c.standing ? `${c.name} — ${c.standing}` : c.name}</option>
                                ))}
                            </select>
                        )}
                        <p className="gor-config-note" id={`${ids}-style-note`}>{styleNote}</p>
                    </div>
                </>
            )}
            {voiceOn && (
                <>
                    <label className="gor-label gor-config-label" htmlFor={`${ids}-voice`}>{NARRATION_SETTINGS_COPY.voiceLabel}</label>
                    <div>
                        <select
                            id={`${ids}-voice`}
                            aria-label="Voice"
                            aria-describedby="settings-voice-note"
                            value={voiceChoice ?? ''}
                            onChange={(e) => handleVoiceChange(e.target.value)}
                            style={narrationSelectStyle}
                        >
                            <option value="">{NARRATION_SETTINGS_COPY.ownVoice(ownVoice)}</option>
                            {NARRATOR_VOICES.map((v) => (
                                <option key={v.id} value={v.id}>
                                    {v.label} — {v.role}
                                </option>
                            ))}
                        </select>
                        <p className="gor-config-note" id="settings-voice-note" style={{ marginTop: '4px' }}>
                            {voiceChoice
                                ? NARRATOR_VOICES.find((v) => v.id === voiceChoice)?.role
                                : NARRATION_SETTINGS_COPY.ownVoiceNote}
                        </p>
                    </div>
                </>
            )}
            {voiceOn && onSetVoiceStyle && (
                <>
                    <label className="gor-label gor-config-label" htmlFor={`${ids}-voice-style`}>{NARRATION_SETTINGS_COPY.styleOfVoiceLabel}</label>
                    <div>
                        <VoiceStylePicker
                            id={`${ids}-voice-style`}
                            ariaLabel={NARRATION_SETTINGS_COPY.styleOfVoiceLabel}
                            value={voiceStyleChoice}
                            ownStyle={narratorOwnStyle}
                            onChange={onSetVoiceStyle}
                            describedBy={`${ids}-voice-style-note`}
                        />
                        <p className="gor-config-note" id={`${ids}-voice-style-note`}>
                            {effectiveStyle && effectiveStyle.preset !== 'as-written' ? NARRATION_SETTINGS_COPY.styledNote : NARRATION_SETTINGS_COPY.asWrittenNote}
                        </p>
                    </div>
                </>
            )}
            {voiceOn && onSaveCustomNarrator && onDeleteCustomNarrator && (
                <div style={{ gridColumn: '1 / -1' }}>
                    <CustomNarratorEditor
                        narrators={customNarrators}
                        onSave={onSaveCustomNarrator}
                        onDelete={onDeleteCustomNarrator}
                    />
                </div>
            )}
        </>
    );
};
