import React from 'react';

/** Form primitives from the Glory of Rome design system (components/forms). */

type SwitchProps = { label?: React.ReactNode; style?: React.CSSProperties } & Omit<React.ComponentPropsWithoutRef<'input'>, 'style' | 'type'>;

export const Switch: React.FC<SwitchProps> =
    ({ label, style, ...rest }) => (
        <label className="gor-switch" style={style}><input type="checkbox" role="switch" {...rest} />{label}</label>
    );

type RadioProps = { label?: React.ReactNode; style?: React.CSSProperties } & Omit<React.ComponentPropsWithoutRef<'input'>, 'style' | 'type'>;

export const Radio: React.FC<RadioProps> =
    ({ label, style, ...rest }) => (
        <label className="gor-check" style={style}><input type="radio" {...rest} />{label}</label>
    );

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
