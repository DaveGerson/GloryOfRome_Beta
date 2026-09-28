/**
 * hooks/useReadingPrefs.ts
 *
 * The configuration menu's Reading register (persistence/readingPrefs.ts):
 * text size, motion, how the narration arrives, and single-key shortcuts.
 * Mirrors each stored value in local state for rendering, exactly like
 * useSettings's pacing posture, and paints the two document-level ones onto
 * `<html>` (applyReadingPrefsToDocument) whenever they change. Presentation
 * only - nothing here is ever part of the save bundle (D17).
 */

import { useCallback, useEffect, useState } from 'react';
import {
    applyReadingPrefsToDocument,
    getMotionPreference, setMotionPreference,
    getNarrationReveal, setNarrationReveal,
    getReadingScale, setReadingScale,
    getShortcutPreference, setShortcutPreference,
    type MotionPreference, type NarrationReveal, type ReadingScale, type ShortcutPreference,
} from '../persistence/readingPrefs';

export function useReadingPrefs() {
    const [readingScale, setReadingScaleState] = useState<ReadingScale>(() => getReadingScale());
    const [motion, setMotionState] = useState<MotionPreference>(() => getMotionPreference());
    const [narrationReveal, setNarrationRevealState] = useState<NarrationReveal>(() => getNarrationReveal());
    const [shortcuts, setShortcutsState] = useState<ShortcutPreference>(() => getShortcutPreference());

    // A DOM write, not React state: the attributes live on <html>, outside
    // the tree, so every surface (dialogs portalled to <body> included)
    // reads the same scale and motion.
    useEffect(() => {
        applyReadingPrefsToDocument(document.documentElement, { readingScale, motion });
    }, [readingScale, motion]);

    const handleSetReadingScale = useCallback((scale: ReadingScale) => {
        setReadingScaleState(scale);
        setReadingScale(scale);
    }, []);
    const handleSetMotion = useCallback((next: MotionPreference) => {
        setMotionState(next);
        setMotionPreference(next);
    }, []);
    const handleSetNarrationReveal = useCallback((reveal: NarrationReveal) => {
        setNarrationRevealState(reveal);
        setNarrationReveal(reveal);
    }, []);
    const handleSetShortcuts = useCallback((next: ShortcutPreference) => {
        setShortcutsState(next);
        setShortcutPreference(next);
    }, []);

    return {
        readingScale, handleSetReadingScale,
        motion, handleSetMotion,
        narrationReveal, handleSetNarrationReveal,
        shortcuts, handleSetShortcuts,
    };
}

export type ReadingPrefs = ReturnType<typeof useReadingPrefs>;
