import React from 'react';
import {
    CUSTOM_VOICE_STYLE_LABEL,
    MAX_CUSTOM_VOICE_STYLE_CHARS,
    VOICE_STYLE_PRESETS,
    filterVoiceStyleInput,
    voiceStyleLabel,
    type VoiceStyle,
    type VoiceStylePresetId,
} from '../narration/voiceStyle';

/** Player-visible copy (veto-queue: roadmaps/BACKLOG.md B13). */
export const VOICE_STYLE_PICKER_COPY = {
    ownStyle: (label: string) => `The narrator's own — ${label}`,
    customStyleLabel: 'Your voice style',
    customStylePlaceholder: 'e.g. slow and grave, like a funeral oration',
} as const;

/** Matches the voice select as it shipped (PR #9). */
export const narrationSelectStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--surface-sunken, #111)',
    color: 'var(--text-normal)',
    border: '1px solid var(--border-subtle, rgba(201,162,39,.3))',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: '13px',
};

/** The voice-style select's value for a style: a preset id, `custom`, or '' for "the narrator's own". */
function styleSelectValue(style: VoiceStyle | null): string {
    return style ? style.preset : '';
}

/**
 * A voice-style picker: the narrator's own (or "As written"), the presets,
 * and "Custom…" with its short free-text field. Shared by Settings and the
 * custom-narrator editor, which has no "own" to fall back on.
 */
export const VoiceStylePicker: React.FC<{
    id: string;
    ariaLabel: string;
    value: VoiceStyle | null;
    /** The narrator's own style; null when it has none (then '' reads "As written"). */
    ownStyle?: VoiceStyle | null;
    onChange: (style: VoiceStyle | null) => void;
    describedBy?: string;
}> = ({ id, ariaLabel, value, ownStyle = null, onChange, describedBy }) => {
    const current = styleSelectValue(value);
    const handleSelect = (next: string) => {
        if (next === '') onChange(null);
        else if (next === 'custom') onChange({ preset: 'custom', text: value?.preset === 'custom' ? value.text : '' });
        else onChange({ preset: next as VoiceStylePresetId });
    };
    return (
        <>
            <select id={id} aria-label={ariaLabel} aria-describedby={describedBy} value={current} onChange={e => handleSelect(e.target.value)} style={narrationSelectStyle}>
                <option value="">{ownStyle ? VOICE_STYLE_PICKER_COPY.ownStyle(voiceStyleLabel(ownStyle)) : VOICE_STYLE_PRESETS[0].label}</option>
                {VOICE_STYLE_PRESETS.filter(p => ownStyle !== null || p.id !== 'as-written').map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                <option value="custom">{CUSTOM_VOICE_STYLE_LABEL}</option>
            </select>
            {value?.preset === 'custom' && (
                <input
                    type="text"
                    className="gor-input"
                    aria-label={VOICE_STYLE_PICKER_COPY.customStyleLabel}
                    maxLength={MAX_CUSTOM_VOICE_STYLE_CHARS}
                    placeholder={VOICE_STYLE_PICKER_COPY.customStylePlaceholder}
                    value={value.text}
                    onChange={e => onChange({ preset: 'custom', text: filterVoiceStyleInput(e.target.value) })}
                    style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontSize: 14, padding: '6px 10px' }}
                />
            )}
        </>
    );
};

