/**
 * hooks/useWeekBeat.ts
 *
 * The beat between weeks (audit item 18): a 320ms wash over the marble as
 * the vexillum drops in. Purely decorative and never awaited - executeTurn
 * strikes it from the TURN_COMMITTED onCommitted callback, after the turn
 * is durable. Moved verbatim out of App.tsx (2026-09-23).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long the marble dims as the new week's vexillum drops in. Matches
 * `gorWeekBeat`/`gorRibbonDrop` in design/components.css; decorative only,
 * never awaited by the turn.
 */
export const WEEK_BEAT_MS = 320;

export function useWeekBeat(): { weekBeat: boolean; strikeWeekBeat: () => void } {
    const [weekBeat, setWeekBeat] = useState(false);
    const weekBeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Striking again mid-beat restarts the 320ms window rather than
    // stacking a second timer.
    const strikeWeekBeat = useCallback(() => {
        if (weekBeatTimer.current !== null) clearTimeout(weekBeatTimer.current);
        setWeekBeat(true);
        weekBeatTimer.current = setTimeout(() => {
            weekBeatTimer.current = null;
            setWeekBeat(false);
        }, WEEK_BEAT_MS);
    }, []);
    useEffect(() => () => {
        if (weekBeatTimer.current !== null) clearTimeout(weekBeatTimer.current);
    }, []);
    return { weekBeat, strikeWeekBeat };
}
