import React from 'react';

/** Feedback primitives from the Glory of Rome design system (components/feedback). */

/**
 * Hover/focus tooltip. While it shows, the trigger (a single element child)
 * is `aria-describedby` the tooltip, so a screen reader reads the gloss on
 * focus rather than only a sighted mouse user seeing it; Escape dismisses it
 * without moving focus (WCAG 1.4.13, content on hover or focus).
 */
export const Tooltip: React.FC<{ label: React.ReactNode; wide?: boolean; children?: React.ReactNode }> =
    ({ label, wide, children }) => {
        const [show, setShow] = React.useState(false);
        const tooltipId = React.useId();
        const trigger = show && React.isValidElement<{ 'aria-describedby'?: string }>(children)
            ? React.cloneElement(children, {
                'aria-describedby': [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' '),
            })
            : children;
        return (
            <span
                className="gor-tooltip-wrap"
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
                onFocus={() => setShow(true)}
                onBlur={() => setShow(false)}
                onKeyDown={event => { if (event.key === 'Escape' && show) setShow(false); }}
            >
                {trigger}
                {show && <span id={tooltipId} className="gor-tooltip" role="tooltip" style={wide ? { whiteSpace: 'normal', width: 230, textAlign: 'left', lineHeight: 1.45 } : undefined}>{label}</span>}
            </span>
        );
    };
