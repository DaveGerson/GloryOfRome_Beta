import React from 'react';
import { Tooltip } from './ui/Feedback';

/**
 * † footnote marker with a wrapping annotation — the design system's InfoTip.
 * The dagger is named "Footnote" for assistive tech (it used to be read out as
 * "dagger"); the gloss itself arrives as its description via Tooltip.
 */
const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
    <Tooltip wide label={text}>
        <span tabIndex={0} role="img" aria-label="Footnote" style={{ cursor: 'help', color: 'var(--gold-700)', fontSize: 14, marginLeft: 5 }}>†</span>
    </Tooltip>
);

export default InfoTooltip;
