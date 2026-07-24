import React, { useEffect, useRef } from 'react';
import { GameEvent, PlayerEventChoice } from '../types';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';

/**
 * A fate interrupts. Chamfered marble tablet with a gold dentil cornice
 * (design-system `gor-dialog`) — a choice is mandatory, by design there is
 * no close or escape. Focus is still moved in on open and restored to
 * whatever invoked it on close (components/ui/focusTrap.ts) — containment
 * is a separate concern from escapability, and this dialog never gains a
 * close path.
 */
const EventModal: React.FC<{
    event: GameEvent;
    onChoose: (choice: PlayerEventChoice) => void;
    interactionLocked?: boolean;
}> = ({ event, onChoose, interactionLocked = false }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);

    useEffect(() => {
        if (!dialogRef.current) return;
        const trap = createFocusTrap(dialogRef.current);
        trapRef.current = trap;
        trap.activate();
        return () => {
            trap.release();
            trapRef.current = null;
        };
    }, []);

    return (
        <div className="gor-dialog-backdrop">
            <div
                ref={dialogRef}
                className="gor-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="event-modal-title"
                tabIndex={-1}
                // No Escape here, deliberately - this dialog has no close
                // affordance. Tab containment only.
                onKeyDown={(keyEvent) => trapRef.current?.handleKeyDown(keyEvent)}
                style={{ maxWidth: 620 }}
            >
                <div className="gor-dialog-head" style={{ textAlign: 'center' }}>
                    <h2 id="event-modal-title" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>{event.title}</h2>
                    <div className="gor-dialog-rule"></div>
                </div>
                <div className="gor-dialog-body" style={{ textAlign: 'center', whiteSpace: 'pre-wrap' }}>{event.description}</div>
                <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {event.options.map((option, index) => (
                        <button key={index} type="button" className="gor-event-choice" onClick={() => onChoose(option)} disabled={interactionLocked}>
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
