import React from 'react';
import { radioGroupKeyDown, radioTabIndex } from './rovingRadio';

/** Form primitives from the Glory of Rome design system (components/forms). */

type SwitchProps = { label?: React.ReactNode; style?: React.CSSProperties } & Omit<React.ComponentPropsWithoutRef<'input'>, 'style' | 'type'>;

export const Switch: React.FC<SwitchProps> =
    ({ label, style, ...rest }) => (
        <label className="gor-switch" style={style}><input type="checkbox" role="switch" {...rest} />{label}</label>
    );

export interface SegmentedOption<T extends string> {
    value: T;
    label: React.ReactNode;
    /** Hover tooltip only — visible descriptions belong next to the control. */
    title?: string;
}

type SegmentedControlProps<T extends string> = {
    options: readonly SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    /** Optional non-interactive label chip rendered before the buttons. */
    leading?: React.ReactNode;
    disabled?: boolean;
    style?: React.CSSProperties;
    /**
     * Render as an ARIA radiogroup (role="radio" + aria-checked, one roving
     * tab stop, arrow keys move the choice - ui/rovingRadio.ts) instead of
     * a group of aria-pressed toggles. Same look either way.
     */
    radio?: boolean;
    /** Ties the group to a visible description (radio mode). */
    describedBy?: string;
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, leading, disabled, style, radio = false, describedBy }: SegmentedControlProps<T>) {
    const values = options.map(option => option.value);
    const anyChosen = values.includes(value);
    return (
        <div
            role={radio ? 'radiogroup' : 'group'}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            className="gor-seg"
            style={style}
            onKeyDown={radio && !disabled ? radioGroupKeyDown(values, value, onChange) : undefined}
        >
            {leading && <span aria-hidden="true" className="gor-seg-lead">{leading}</span>}
            {options.map(({ value: optionValue, label, title }, index) => (
                <button
                    key={optionValue}
                    type="button"
                    className="gor-seg-btn"
                    {...(radio
                        ? { role: 'radio', 'aria-checked': value === optionValue, tabIndex: radioTabIndex(value === optionValue, index === 0, anyChosen) }
                        : { 'aria-pressed': value === optionValue })}
                    title={title}
                    disabled={disabled}
                    onClick={() => onChange(optionValue)}
                >{label}</button>
            ))}
        </div>
    );
}

type TextareaProps = {
    label?: React.ReactNode;
    hint?: React.ReactNode;
    error?: React.ReactNode;
    id?: string;
    style?: React.CSSProperties;
    rows?: number;
} & Omit<React.ComponentPropsWithoutRef<'textarea'>, 'id' | 'rows' | 'style'>;

export const Textarea: React.FC<TextareaProps> = ({ label, hint, error, id, style, rows = 4, 'aria-describedby': describedBy, ...rest }) => {
    const uid = id || (label ? 'ta-' + String(label).toLowerCase().replace(/\W+/g, '-') : undefined);
    // The hint (or error) under the field is its description, not stray text
    // after it: tie it to the textarea so it is read when the field is.
    const hintId = uid && (error || hint) ? `${uid}-hint` : undefined;
    const describedByIds = [describedBy, hintId].filter(Boolean).join(' ') || undefined;
    return (
        <div className="gor-field" style={style}>
            {label && <label className="gor-label" htmlFor={uid}>{label}</label>}
            <textarea className="gor-textarea" id={uid} rows={rows} aria-invalid={error ? 'true' : undefined} aria-describedby={describedByIds} {...rest} />
            {(error || hint) && <span id={hintId} className={`gor-hint ${error ? 'gor-hint-error' : ''}`}>{error || hint}</span>}
        </div>
    );
};
