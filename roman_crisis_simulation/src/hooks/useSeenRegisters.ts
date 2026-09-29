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
 *  - the tab open on the screen when a week lands is looked at already;
 *  - what was looked at outlives a reload of the same week on this device, so
 *    the same counts are not announced twice. A device convenience in the
 *    mold of persistence/readingPrefs.ts - never save state (D17) - and a
 *    storage failure only means a coin comes back.
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
    tabs: ReadonlySet<TabId>;
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

function readSeen(weekKey: string | null): ReadonlySet<TabId> | null {
    if (weekKey === null) return null;
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(SEEN_REGISTERS_KEY) ?? 'null');
        if (typeof stored !== 'object' || stored === null) return null;
        const { week, tabs } = stored as { week?: unknown; tabs?: unknown };
        if (week !== weekKey || !Array.isArray(tabs)) return null;
        return new Set(tabs.filter((tab): tab is TabId => typeof tab === 'string'));
    } catch (e) {
        console.warn('seenRegisters: could not read what was looked at', e);
        return null;
    }
}

function writeSeen(seen: SeenRegisters): void {
    if (seen.weekKey === null) return;
    try {
        localStorage.setItem(SEEN_REGISTERS_KEY, JSON.stringify({ week: seen.weekKey, tabs: [...seen.tabs] }));
    } catch (e) {
        console.warn('seenRegisters: could not keep what was looked at', e);
    }
}

/** What the player has looked at when `weekKey` lands with `activeTab` open. */
function seenOnArrival(weekKey: string | null, activeTab: TabId): SeenRegisters {
    return { weekKey, tabs: new Set([...(readSeen(weekKey) ?? []), activeTab]) };
}

export function useSeenRegisters({ weekKey, tabChangeCounts }: {
    weekKey: string | null;
    /** hooks/usePlayerPerception.ts's counts for the committed week. */
    tabChangeCounts: ReadonlyMap<TabId, number>;
}) {
    const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_REGISTER);
    const [seen, setSeen] = useState<SeenRegisters>(() => seenOnArrival(weekKey, DEFAULT_REGISTER));
    // A new week arrived: adjusted during render - the documented alternative
    // to an effect for "reset state when a prop changes".
    let current = seen;
    if (seen.weekKey !== weekKey) {
        current = seenOnArrival(weekKey, activeTab);
        setSeen(current);
    }

    useEffect(() => { writeSeen(seen); }, [seen]);

    const selectTab = useCallback((id: TabId) => {
        setActiveTab(id);
        setSeen(previous => (previous.tabs.has(id) ? previous : { ...previous, tabs: new Set([...previous.tabs, id]) }));
    }, []);

    const seenTabs = current.tabs;
    // The week's counts less what has been looked at - the one list both the
    // tab rail and the palette read, and the tabs that still pulse.
    const unseenCounts = useMemo(
        () => new Map([...tabChangeCounts].filter(([id]) => !seenTabs.has(id))),
        [tabChangeCounts, seenTabs],
    );
    const unseenTabs = useMemo(() => new Set(unseenCounts.keys()), [unseenCounts]);

    return { activeTab, selectTab, unseenCounts, unseenTabs };
}
