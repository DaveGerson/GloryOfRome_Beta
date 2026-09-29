import React from 'react';

/** Feedback primitives from the Glory of Rome design system (components/feedback). */

/** The gap kept between a tooltip and whatever edge would cut it off. */
const TOOLTIP_EDGE_GAP = 8;
/** The overflow values under which an ancestor cuts off what spills out of it. */
const CLIPPING_OVERFLOW = new Set(['hidden', 'auto', 'scroll', 'clip']);

/**
 * Keeps a shown tooltip whole (WCAG 1.4.13): the bubble hangs above its
 * trigger, so a † near the top of a scrolling panel lost its first lines to
 * the panel's edge, and one near the right edge ran out of the window. The
 * room is the window narrowed by every clipping ancestor; the bubble drops
 * below the trigger when the room above is short and there is more below,
 * and slides sideways (`--gor-tip-shift`) to stay inside. It is measured
 * fresh each time it shows, so it never builds on an earlier nudge.
 */
function fitTooltip(bubble: HTMLElement, wrap: HTMLElement): void {
    bubble.classList.remove('gor-tooltip-below');
    bubble.style.removeProperty('--gor-tip-shift');
    const box = bubble.getBoundingClientRect();
    // Nothing laid out (a document without layout): nothing to fit.
    if (box.width === 0 && box.height === 0) return;

    let top = 0, left = 0;
    let right = window.innerWidth, bottom = window.innerHeight;
    for (let el = wrap.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (!CLIPPING_OVERFLOW.has(style.overflowX) && !CLIPPING_OVERFLOW.has(style.overflowY)) continue;
        const clip = el.getBoundingClientRect();
        top = Math.max(top, clip.top);
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
    }

    const trigger = wrap.getBoundingClientRect();
    if (box.top < top + TOOLTIP_EDGE_GAP && bottom - trigger.bottom > trigger.top - top) {
        bubble.classList.add('gor-tooltip-below');
    }

    let shift = 0;
    if (box.width > right - left - 2 * TOOLTIP_EDGE_GAP || box.left < left + TOOLTIP_EDGE_GAP) {
        shift = left + TOOLTIP_EDGE_GAP - box.left;
    } else if (box.right > right - TOOLTIP_EDGE_GAP) {
        shift = right - TOOLTIP_EDGE_GAP - box.right;
    }
    if (shift !== 0) bubble.style.setProperty('--gor-tip-shift', `${Math.round(shift)}px`);
}

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
        const wrapRef = React.useRef<HTMLSpanElement>(null);
        const bubbleRef = React.useRef<HTMLSpanElement>(null);
        // Before paint, so the bubble never flashes in the clipped spot first.
        React.useLayoutEffect(() => {
            if (show && bubbleRef.current && wrapRef.current) fitTooltip(bubbleRef.current, wrapRef.current);
        }, [show]);
        const trigger = show && React.isValidElement<{ 'aria-describedby'?: string }>(children)
            ? React.cloneElement(children, {
                'aria-describedby': [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' '),
            })
            : children;
        return (
            <span
                ref={wrapRef}
                className="gor-tooltip-wrap"
                onMouseEnter={() => setShow(true)}
                // A tap focuses the trigger and then fires mouseleave straight
                // after the click: while focus is still within, the bubble
                // stays (blur and Escape close it), or a phone never reads it.
                onMouseLeave={() => { if (!wrapRef.current?.contains(document.activeElement)) setShow(false); }}
                onFocus={() => setShow(true)}
                onBlur={() => setShow(false)}
                onKeyDown={event => { if (event.key === 'Escape' && show) setShow(false); }}
            >
                {trigger}
                {show && <span ref={bubbleRef} id={tooltipId} className="gor-tooltip" role="tooltip" style={wide ? { whiteSpace: 'normal', width: 230, textAlign: 'left', lineHeight: 1.45 } : undefined}>{label}</span>}
            </span>
        );
    };
