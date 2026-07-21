import React, { useState } from 'react';
import { Entity } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getClarificationOnEvent } from '../../ai/tools/intelligence';

/**
 * Recent occurrences — press a headline and your agents seek its causes
 * (a live AI clarification call, expanded inline).
 */
const CurrentEventsTab: React.FC<{
    events: string[];
    playerEntity: Entity | null;
    allEntities: Entity[];
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ events, playerEntity, allEntities, ai, isMockMode }) => {
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
    const [clarification, setClarification] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleEventClick = async (event: string) => {
        if (selectedEvent === event) {
            setSelectedEvent(null);
            setClarification('');
            return;
        }
        setSelectedEvent(event);
        setIsLoading(true);
        if (playerEntity) {
            const result = await getClarificationOnEvent(ai, event, "What were the motives?", playerEntity, allEntities, isMockMode);
            setClarification(result);
        }
        setIsLoading(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Recent Occurrences</h3>
            <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>Press an occurrence and your agents will seek its causes.</span>
            {events.length === 0 && <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>The city is quiet. No new events to report.</p>}
            {events.map((event, index) => (
                <div key={index} className="gor-card" style={{ padding: '10px 12px' }}>
                    <button type="button" onClick={() => handleEventClick(event)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', width: '100%' }}>
                        <span aria-hidden="true" style={{ color: 'var(--gold-600)', flex: 'none' }}>❧</span>
                        <span style={{ fontSize: 15 }}>{event}</span>
                    </button>
                    {selectedEvent === event && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-faint)', animation: 'gorFadeIn .4s ease-out both' }}>
                            {isLoading
                                ? <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>Seeking clarification…</span>
                                : <span style={{ fontSize: 14 }}>{clarification}</span>}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default CurrentEventsTab;
