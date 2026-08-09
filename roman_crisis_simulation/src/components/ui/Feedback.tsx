import React from 'react';

/** Feedback primitives from the Glory of Rome design system (components/feedback). */

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
