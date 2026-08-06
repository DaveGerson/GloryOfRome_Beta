import React from 'react';

/**
 * The keyboard half of an ARIA radiogroup — and, since the B7a/tablist pass
 * (2026-08-05-b7a-hardening-and-tablist-design.md), of a WAI-APG
 * automatic-activation tablist too. Both patterns share one keyboard
 * contract: a roving tabindex, arrow keys that move selection AND focus
 * together, wrapping at both ends, Home/End for the extremes.
 *
 * Two surfaces in the design pass replaced a native control with a grid of
 * cards: the private scene's doorway (WP-16, was a `<select>`) and Forge a
 * New Destiny's scenario (WP-18, was two radio `<input>`s). Both originals
 * were ONE tab stop with arrow keys to change the selection. A grid of plain
 * buttons is still operable — buttons focus, Space activates — but it makes
 * Tab walk every option, which gets worse the more options you know, and it
 * does not honour the contract `role="radiogroup"` announces.
 *
 * This restores it: a roving tabindex (only the chosen option is in the tab
 * order) plus arrow keys that move the selection AND the focus, wrapping at
 * both ends, with Home/End for the extremes. Selection follows focus, which
 * is the correct pattern for a radiogroup — the whole point is that arrowing
 * through options chooses them.
 *
 * Deliberately DOM-driven rather than ref-driven: the handler reads the
 * options out of the group element it is bound to, so a caller only has to
 * put `role="radio"` on each option and nothing has to be threaded through.
 *
 * The item role is now a parameter (`options.role`, default `'radio'`) so
 * the dashboard and GM console tablists (role="tab") can share this same
 * handler instead of forking it — every pre-existing call site (the
 * radiogroups above, plus the sub-rails, which use a different toggle
 * pattern entirely and never called this file) omits the argument and is
 * byte-for-byte unaffected.
 */

/** Which way each key moves, or `null` for the absolute keys. */
const STEP: Record<string, number | null> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
    Home: null,
    End: null,
};

export function radioGroupKeyDown<T>(
    values: readonly T[],
    selected: T,
    onSelect: (value: T) => void,
    options: { role?: string } = {},
): React.KeyboardEventHandler<HTMLElement> {
    const role = options.role ?? 'radio';
    return event => {
        if (!(event.key in STEP) || values.length === 0) return;
        // Let a modifier chord (or a browser shortcut) through untouched.
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();

        const current = Math.max(0, values.indexOf(selected));
        const step = STEP[event.key];
        const next = step === null
            ? (event.key === 'Home' ? 0 : values.length - 1)
            // Wraps at both ends: a radiogroup is a ring, not a list.
            : (current + step + values.length) % values.length;

        onSelect(values[next]);
        const items = event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`);
        items[next]?.focus();
    };
}

/**
 * The roving part. Only the chosen option is reachable by Tab; the arrows
 * reach the rest. An empty selection still leaves exactly one tab stop, so
 * the group can never become a keyboard dead end.
 */
export function radioTabIndex(chosen: boolean, isFirst: boolean, anyChosen: boolean): number {
    if (chosen) return 0;
    return !anyChosen && isFirst ? 0 : -1;
}
