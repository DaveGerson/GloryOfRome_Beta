import React from 'react';

/**
 * A magnifier: the search affordance every platform shares, for the command
 * palette's field and the masthead button that opens it. Inline SVG rather
 * than a glyph - the house fonts carry no magnifier, and the fallback glyph
 * (❖ rendered as a bare ◆) read as ornament, not as a control, wherever the
 * button's word is hidden (the phone). Drawn in `currentColor`, so it takes
 * each surface's ink and survives forced colours; always decorative
 * (aria-hidden), since the control around it carries the name.
 */
export const SearchGlyph: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="6.75" cy="6.75" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <line x1="10.3" y1="10.3" x2="14.25" y2="14.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/**
 * The lighting choices' marks: a half-lit disc (follow the device), a sun
 * (LVX) and a crescent (NOX). Inline SVG for the magnifier's reason - the
 * house fonts carry none of ◐ ☼ ☾, and each platform's fallback font drew
 * them at a different size (◐ shrank to a stray bullet beside ☼ and ☾).
 * Sized in em so they track the label's text size, drawn in `currentColor`,
 * always decorative: the option's word is its name.
 */
export const LightingGlyph: React.FC<{ kind: 'device' | 'lux' | 'nox' }> = ({ kind }) => (
    <svg width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ verticalAlign: '-0.125em' }}>
        {kind === 'device' && (
            <>
                <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5z" fill="currentColor" />
            </>
        )}
        {kind === 'lux' && (
            <>
                <circle cx="8" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 .75v2.5M8 12.75v2.5M.75 8h2.5M12.75 8h2.5M2.87 2.87l1.77 1.77M11.36 11.36l1.77 1.77M2.87 13.13l1.77-1.77M11.36 4.64l1.77-1.77"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
        )}
        {kind === 'nox' && (
            <path d="M10.5 1.9a6.25 6.25 0 1 0 3.6 9.9A5 5 0 0 1 10.5 1.9z" fill="currentColor" />
        )}
    </svg>
);
