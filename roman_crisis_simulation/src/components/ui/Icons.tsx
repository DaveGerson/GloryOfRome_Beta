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
