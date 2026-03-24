
import React, { useState } from 'react';
import { Entity } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getClarificationOnEvent } from '../../ai/tools/intelligence';

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
        <div className="p-4 space-y-2">
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Recent Occurrences</h3>
            {events.length === 0 && <p className="text-stone-600">The city is quiet. No new events to report.</p>}
            <ul className="space-y-2">
                {events.map((event, index) => (
                    <li key={index} className="roman-stone-panel p-2 rounded-sm">
                        <button onClick={() => handleEventClick(event)} className="text-left w-full text-stone-800">
                            <p>{event}</p>
                        </button>
                        {selectedEvent === event && (
                            <div className="mt-2 p-2 bg-[#d8d5ce] rounded-sm animate-fade-in">
                                {isLoading ? <p>Seeking clarification...</p> : <p className="text-sm text-stone-700">{clarification}</p>}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default CurrentEventsTab;