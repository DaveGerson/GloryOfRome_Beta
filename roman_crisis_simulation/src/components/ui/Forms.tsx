import React from 'react';

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
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, leading, disabled, style }: SegmentedControlProps<T>) {
    return (
        <div role="group" aria-label={ariaLabel} className="gor-seg" style={style}>
            {leading && <span aria-hidden="true" className="gor-seg-lead">{leading}</span>}
            {options.map(({ value: optionValue, label, title }) => (
                <button
                    key={optionValue}
                    type="button"
                    className="gor-seg-btn"
                    aria-pressed={value === optionValue}
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

export const Textarea: React.FC<TextareaProps> = ({ label, hint, error, id, style, rows = 4, ...rest }) => {
    const uid = id || (label ? 'ta-' + String(label).toLowerCase().replace(/\W+/g, '-') : undefined);
    return (
        <div className="gor-field" style={style}>
            {label && <label className="gor-label" htmlFor={uid}>{label}</label>}
            <textarea className="gor-textarea" id={uid} rows={rows} aria-invalid={error ? 'true' : undefined} {...rest} />
            {(error || hint) && <span className={`gor-hint ${error ? 'gor-hint-error' : ''}`}>{error || hint}</span>}
        </div>
    );
};
