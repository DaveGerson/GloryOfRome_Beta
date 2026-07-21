import React from 'react';
import { Tooltip } from './ui/Feedback';

/** † footnote marker with a wrapping annotation — the design system's InfoTip. */
const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
    <Tooltip wide label={text}>
        <span tabIndex={0} style={{ cursor: 'help', color: 'var(--gold-700)', fontSize: 14, marginLeft: 5 }}>†</span>
    </Tooltip>
);

export default InfoTooltip;
