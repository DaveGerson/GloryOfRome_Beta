import React from 'react';

/** Feedback primitives from the Glory of Rome design system (components/feedback). */

const meterFills: Record<string, string> = {
    gold: 'var(--gold-500)', crimson: 'var(--crimson-400)', tyrian: 'var(--tyrian-400)',
    laurel: 'var(--laurel-400)', bronze: 'var(--bronze-400)',
};

export const Meter: React.FC<{
    label?: React.ReactNode;
    value?: number;
    max?: number;
    tone?: 'gold' | 'crimson' | 'tyrian' | 'laurel' | 'bronze';
    display?: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ label, value = 0, max = 100, tone = 'gold', display, style }) => {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return (
        <div className="gor-meter" style={style}>
            {(label || display !== null) && <div className="gor-meter-row">{label && <span className="gor-label">{label}</span>}<span className="gor-meter-val">{display !== undefined ? display : `${value} / ${max}`}</span></div>}
            <div className="gor-meter-track" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}><div className="gor-meter-fill" style={{ width: pct + '%', background: meterFills[tone] || meterFills.gold }}></div></div>
        </div>
    );
};

export const Tooltip: React.FC<{ label: React.ReactNode; wide?: boolean; children?: React.ReactNode }> =
    ({ label, wide, children }) => {
        const [show, setShow] = React.useState(false);
        return (
            <span className="gor-tooltip-wrap" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
                {children}
                {show && <span className="gor-tooltip" role="tooltip" style={wide ? { whiteSpace: 'normal', width: 230, textAlign: 'left', lineHeight: 1.45 } : undefined}>{label}</span>}
            </span>
        );
    };
