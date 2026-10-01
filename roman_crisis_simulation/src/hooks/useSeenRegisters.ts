/**
 * hooks/useSeenRegisters.ts
 *
 * "What changed since you last looked" (ROADMAP_UPLEVEL P6) needs one memory
 * of what the player has looked at: which side-panel tab is open, and which
 * tabs they have opened since the last week was committed. It lives in App,
 * above both surfaces that say "N new" - the tab rail and the command
 * palette - so one count says the same thing on each, and looking at a tab
 * clears it on both. (It used to live in SidePanel, where the palette could
 * not see it and kept announcing counts the player had already read.)
 *
 * The rules:
 *  - the memory belongs to the committed week, never to the set of tabs that
 *    pulse: a new week re-arms every tab it touches, even when it touches the
 *    same tabs as the week before - the common case, since rumours land most
 *    weeks;
 *  - the tab open on the screen when a week lands is looked at already - on
 *    the screen, not merely open: on a phone the panel waits a swipe away
 *    from the chronicle (design/shell.css VIII), so there the open tab is
 *    looked at once the panel is swiped into view, or its tab is pressed;
 *  - what was looked at outlives a reload of the same week on this device, so
 *    the same counts are not announced twice. A device convenience in the
 *    mold of persistence/readingPrefs.ts - never save state (D17) - and a
 *    storage failure only means a coin comes back;
 *  - a tab is looked at as far as it then went: the memory keeps how many
 *    changes it showed when looked at, and the coin says only what came
 *    after. Within a week a count can still grow - a sign caught in a
 *    private scene reaches Personae in the interlude (D50) - and a tab looked
 *    at earlier that week then shows just that one, not nothing and not the
 *    week again. (A memory kept before counts were - `tabs` alone - reads as
 *    having seen all of the week.)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TurnHistoryEntry } from '../types';
import type { TabId } from '../perception/visibility';

const SEEN_REGISTERS_KEY = 'gloryOfRome:seenRegisters';

/** The tab the side panel opens on. */
export const DEFAULT_REGISTER: TabId = 'world_state';

interface SeenRegisters {
    /** The committed week this memory belongs to (`weekKeyOf`), or null before the first. */
    weekKey: string | null;
    /** Each tab looked at since the week landed, with how many changes it showed then. */
    counts: ReadonlyMap<TabId, number>;
}

function fingerprint(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

/**
 * A committed week's identity on this device: its number, and a fingerprint
 * of what the player read of it, so a later reign's week of the same number
 * is never taken for this one after a reload.
 */
export function weekKeyOf(lastTurn: TurnHistoryEntry | null): string | null {
    if (!lastTurn) return null;
    return `${lastTurn.turnNumber}:${fingerprint(lastTurn.narration ?? lastTurn.playerIntent)}`;
}

function readSeen(weekKey: string | null): Map<TabId, number> | null {
    if (weekKey === null) return null;
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(SEEN_REGISTERS_KEY) ?? 'null');
        if (typeof stored !== 'object' || stored === null) return null;
        const { week, tabs, counts } = stored as { week?: unknown; tabs?: unknown; counts?: unknown };
        if (week !== weekKey || !Array.isArray(tabs)) return null;
        const seenCounts = (typeof counts === 'object' && counts !== null ? counts : {}) as Record<string, unknown>;
        return new Map(tabs
            .filter((tab): tab is TabId => typeof tab === 'string')
            .map((tab): [TabId, number] => {
                const count = seenCounts[tab];
                return [tab, typeof count === 'number' && Number.isFinite(count) ? count : Infinity];
            }));
    } catch (e) {
        console.warn('seenRegisters: could not read what was looked at', e);
        return null;
    }
}

function writeSeen(seen: SeenRegisters): void {
    if (seen.weekKey === null) return;
    try {
        localStorage.setItem(SEEN_REGISTERS_KEY, JSON.stringify({
            week: seen.weekKey,
            tabs: [...seen.counts.keys()],
            counts: Object.fromEntries([...seen.counts].filter(([, count]) => Number.isFinite(count))),
        }));
    } catch (e) {
        console.warn('seenRegisters: could not keep what was looked at', e);
    }
}

/** How much of the panel must show to be on the screen: far more than the gilt edge a phone shows beside the chronicle. */
const PANEL_IN_VIEW_RATIO = 0.5;

/**
 * Whether the side panel is on the screen. Beside the chronicle on a wide
 * screen it always is; on a phone it waits one swipe away (the chronicle is
 * the leaf a phone opens on). Until an IntersectionObserver reports, the
 * screen's width decides; where neither can be asked, it is on the screen.
 */
export function usePanelInView(panel: HTMLElement | null): boolean {
    const [inView, setInView] = useState(() =>
        !(typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 768px)').matches));
    useEffect(() => {
        if (!panel || typeof IntersectionObserver !== 'function') return;
        const observer = new IntersectionObserver(
            entries => { for (const entry of entries) setInView(entry.intersectionRatio >= PANEL_IN_VIEW_RATIO); },
            { threshold: [PANEL_IN_VIEW_RATIO] },
        );
        observer.observe(panel);
        return () => observer.disconnect();
    }, [panel]);
    return inView;
}

/** The memory once `tab` is looked at with `shown` changes on it - moved on that far, never back. */
function lookedAt(seen: SeenRegisters, tab: TabId, shown: number): SeenRegisters {
    return (seen.counts.get(tab) ?? -1) >= shown ? seen : { ...seen, counts: new Map(seen.counts).set(tab, shown) };
}

/** What the player has looked at when `weekKey` lands with `onScreen` on the screen (none: the panel is away). */
function seenOnArrival(weekKey: string | null, onScreen: TabId | null, tabChangeCounts: ReadonlyMap<TabId, number>): SeenRegisters {
    const seen: SeenRegisters = { weekKey, counts: readSeen(weekKey) ?? new Map() };
    return onScreen === null ? seen : lookedAt(seen, onScreen, tabChangeCounts.get(onScreen) ?? 0);
}

export function useSeenRegisters({ weekKey, tabChangeCounts, panelInView = true }: {
    weekKey: string | null;
    /** hooks/usePlayerPerception.ts's counts for the committed week. */
    tabChangeCounts: ReadonlyMap<TabId, number>;
    /** Whether the side panel is on the screen (`usePanelInView`); always, beside the chronicle on a wide screen. */
    panelInView?: boolean;
}) {
    const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_REGISTER);
    const [seen, setSeen] = useState<SeenRegisters>(() => seenOnArrival(weekKey, panelInView ? DEFAULT_REGISTER : null, tabChangeCounts));
    // Adjusted during render - the documented alternative to an effect for
    // "reset state when a prop changes": a new week arrived, or the panel is
    // on the screen with its open tab showing more than was looked at.
    let current = seen;
    if (seen.weekKey !== weekKey) {
        current = seenOnArrival(weekKey, panelInView ? activeTab : null, tabChangeCounts);
        setSeen(current);
    } else if (panelInView) {
        current = lookedAt(seen, activeTab, tabChangeCounts.get(activeTab) ?? 0);
        if (current !== seen) setSeen(current);
    }

    useEffect(() => { writeSeen(seen); }, [seen]);

    const selectTab = useCallback((id: TabId) => {
        setActiveTab(id);
        setSeen(previous => lookedAt(previous, id, tabChangeCounts.get(id) ?? 0));
    }, [tabChangeCounts]);

    const seenCounts = current.counts;
    // The week's counts less what has been looked at - the one list both the
    // tab rail and the palette read, and the tabs that still pulse.
    const unseenCounts = useMemo(
        () => new Map([...tabChangeCounts]
            .map(([id, count]): [TabId, number] => [id, count - (seenCounts.get(id) ?? 0)])
            .filter(([, unseen]) => unseen > 0)),
        [tabChangeCounts, seenCounts],
    );
    const unseenTabs = useMemo(() => new Set(unseenCounts.keys()), [unseenCounts]);

    return { activeTab, selectTab, unseenCounts, unseenTabs };
}
