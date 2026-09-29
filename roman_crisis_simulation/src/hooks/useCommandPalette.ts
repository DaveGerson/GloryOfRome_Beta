/**
 * hooks/useCommandPalette.ts
 *
 * The command palette's open flag and the game screen's keys: Ctrl+K / ⌘K
 * toggles the palette, and - while the player leaves single-key shortcuts
 * on (Settings → Reading) - `?` opens it, `/` goes to the tablet and 1-7
 * open the registers. Which keydown means what is decided by the pure
 * `resolveShortcut` (app/commands.ts); this hook only reads the page's
 * state for it and dispatches. Presentation state only (D17).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveShortcut, type ShortcutAction } from '../app/commands';

/** Something that takes typing: a keystroke there is the player writing, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement) {
        return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'file', 'color', 'image'].includes(target.type);
    }
    return false;
}

/** A modal already holds the room: a gor-dialog, the palette, or a native <dialog> opened modally. */
export function anyModalOpen(doc: Document = document): boolean {
    return doc.querySelector('[aria-modal="true"], dialog[open]') !== null;
}

export function useCommandPalette({ inGame, singleKeys, onAction }: {
    inGame: boolean;
    singleKeys: boolean;
    /** Every resolved key but the palette's own open/close. */
    onAction: (action: Exclude<ShortcutAction, { kind: 'toggle-palette' } | { kind: 'open-palette' }>) => void;
}) {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const openPalette = useCallback(() => setPaletteOpen(true), []);
    const closePalette = useCallback(() => setPaletteOpen(false), []);
    // Read by the one window listener without re-binding it on every render.
    const latest = useRef({ inGame, singleKeys, paletteOpen, onAction });
    useEffect(() => {
        latest.current = { inGame, singleKeys, paletteOpen, onAction };
    });

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const { inGame: game, singleKeys: keys, paletteOpen: open, onAction: act } = latest.current;
            const action = resolveShortcut(event, {
                inGame: game,
                singleKeys: keys,
                paletteOpen: open,
                otherModalOpen: !open && anyModalOpen(),
                typing: isTypingTarget(event.target),
            });
            if (!action) return;
            event.preventDefault();
            if (action.kind === 'toggle-palette') setPaletteOpen(was => !was);
            else if (action.kind === 'open-palette') setPaletteOpen(true);
            else act(action);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Leaving the game screen (the epilogue, a new reign) closes it, so it
    // does not reappear on its own when the next reign begins. Adjusted
    // during render - the documented alternative to an effect for "reset
    // state when a prop changes".
    const [wasInGame, setWasInGame] = useState(inGame);
    if (wasInGame !== inGame) {
        setWasInGame(inGame);
        if (!inGame) setPaletteOpen(false);
    }
    return { paletteOpen: paletteOpen && inGame, openPalette, closePalette };
}
