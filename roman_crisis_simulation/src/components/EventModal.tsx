import React from 'react';
import { GameEvent, PlayerEventChoice } from '../types';

/**
 * A fate interrupts. Chamfered marble tablet with a gold dentil cornice
 * (design-system `gor-dialog`) — a choice is mandatory, by design there is
 * no close or escape.
 */
const EventModal: React.FC<{
    event: GameEvent;
    onChoose: (choice: PlayerEventChoice) => void;
}> = ({ event, onChoose }) => {
    return (
        <div className="gor-dialog-backdrop">
            <div className="gor-dialog" role="dialog" aria-modal="true" aria-label={event.title} style={{ maxWidth: 620 }}>
                <div className="gor-dialog-head" style={{ textAlign: 'center' }}>
                    <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>{event.title}</h2>
                    <div className="gor-dialog-rule"></div>
                </div>
                <div className="gor-dialog-body" style={{ textAlign: 'center', whiteSpace: 'pre-wrap' }}>{event.description}</div>
                <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {event.options.map((option, index) => (
                        <button key={index} type="button" className="gor-event-choice" onClick={() => onChoose(option)}>
                            <span className="gor-event-choice-title">{option.text}</span>
                            {option.description && <span className="gor-event-choice-desc">{option.description}</span>}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default EventModal;
