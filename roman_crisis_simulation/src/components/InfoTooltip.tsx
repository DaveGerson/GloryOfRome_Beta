
import React from 'react';

const InfoTooltip: React.FC<{text: string}> = ({ text }) => (
    <div className="relative inline-block ml-2 group">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-stone-500 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="tooltip-bubble">
            {text}
        </div>
    </div>
);

export default InfoTooltip;