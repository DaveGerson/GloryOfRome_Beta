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

/** The voice pickers' two groups: the curated six, then the rest of the catalog (veto queue, B13). */
export const VOICE_GROUP_COPY = {
    curated: "Narrators' voices",
    every: 'Every voice',
} as const;

/**
 * The narration selects' class: the design system's own select, so the
 * colours follow the skin (LVX parchment, NOX's re-cut) and the focus ring
 * comes with it. The selects used to paint themselves with tokens no skin
 * defines - a near-black box with dark ink in LVX.
 */
export const NARRATION_SELECT_CLASS = 'gor-select';

/** The narration selects' size: full width, compact, with room for the select's arrow. Colours come from `NARRATION_SELECT_CLASS`. */
export const narrationSelectStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 32px 6px 10px',
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
    /** Shown but not editable (Settings, while the narration voice is SILENT). */
    disabled?: boolean;
}> = ({ id, ariaLabel, value, ownStyle = null, onChange, describedBy, disabled = false }) => {
    const current = styleSelectValue(value);
    const handleSelect = (next: string) => {
        if (next === '') onChange(null);
        else if (next === 'custom') onChange({ preset: 'custom', text: value?.preset === 'custom' ? value.text : '' });
        else onChange({ preset: next as VoiceStylePresetId });
    };
    return (
        <>
            <select id={id} aria-label={ariaLabel} aria-describedby={describedBy} disabled={disabled} value={current} onChange={e => handleSelect(e.target.value)} className={NARRATION_SELECT_CLASS} style={narrationSelectStyle}>
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
                    aria-describedby={describedBy}
                    disabled={disabled}
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

