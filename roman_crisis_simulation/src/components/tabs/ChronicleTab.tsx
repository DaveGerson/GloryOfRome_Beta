import React from 'react';
import { EventHistoryEntry } from '../../types';
import { toRoman } from '../ui/Brand';

/** The chronicle — gold-ruled timeline of fate events and the choices made. */
const ChronicleTab: React.FC<{ eventHistory: EventHistoryEntry[] }> = ({ eventHistory }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Chronicle of Events</h3>
        {eventHistory.length === 0 && (
            <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>Your chronicle is yet unwritten. Act, and the scribes will follow.</p>
        )}
        {eventHistory.slice().reverse().map((entry, index) => (
            <div key={`${entry.eventId}-${index}`} style={{ borderLeft: '2px solid var(--gold-500)', paddingLeft: 14, marginLeft: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="gor-label" style={{ color: 'var(--gold-700)' }}>Turn {toRoman(entry.turnNumber)}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text-heading)' }}>{entry.eventTitle}</span>
                <span style={{ fontSize: 14 }}>Your choice: <em>“{entry.choiceText}”</em></span>
            </div>
        ))}
    </div>
);

export default ChronicleTab;
