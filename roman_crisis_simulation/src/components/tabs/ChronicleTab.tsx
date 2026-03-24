import React from 'react';
import { EventHistoryEntry } from '../../types';

const ChronicleTab: React.FC<{ eventHistory: EventHistoryEntry[] }> = ({ eventHistory }) => (
    <div className="p-4 space-y-3">
        <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Chronicle of Events</h3>
        {eventHistory.length === 0 && <p className="text-stone-600">No major events have been recorded in your chronicle.</p>}
        {eventHistory.slice().reverse().map((entry, index) => (
            <div key={`${entry.eventId}-${index}`} className="roman-stone-panel p-3 rounded-sm">
                <p className="text-xs text-stone-500">Turn {entry.turnNumber}</p>
                <h4 className="font-bold text-stone-800">{entry.eventTitle}</h4>
                <p className="text-sm text-stone-700 mt-1">
                    <span className="font-semibold">Your Choice:</span> <span className="italic">"{entry.choiceText}"</span>
                </p>
            </div>
        ))}
    </div>
);

export default ChronicleTab;
