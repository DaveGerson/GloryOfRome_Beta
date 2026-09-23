/**
 * hooks/usePlayerPerception.ts
 *
 * What the player's screen derives from committed state each render - the
 * last turn's perceived digest, which SidePanel tabs pulse, the illuminated
 * narrations, and the epilogue's cause-of-death text. Moved verbatim out of
 * App.tsx (2026-09-23). Everything here is derived, never stored: it
 * recomputes from slices that already persist, so it survives a reload
 * with no save-format change.
 */

import { useMemo } from 'react';
import type { Message, TurnHistoryEntry, WorldState } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import { buildPlayerPerceivedDigest, type PerceivedChange, type TabId } from '../perception/visibility';
import { illuminatedNarrationIndices } from '../components/Chat';

/**
 * The most recent GM-authored narration text, used as the epilogue's
 * "manner of death" account regardless of whether the fatal blow landed
 * via a committed turn (runNewTurn's narration) or an authored event
 * choice (handleEventChoice's own message) - both paths already push a
 * 'gm' message, and `messages` is itself part of the save bundle, so this
 * also survives a reload straight into a still-open epilogue (see
 * handleContinue).
 */
export function lastGmNarrationOf(messages: readonly Message[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].sender === 'gm') return messages[i].text;
    }
    return '';
}

/**
 * Which SidePanel tabs to pulse - built strictly from the already-filtered
 * perceived changes, never from the raw deltas, so a pulse can never itself
 * leak something the perception filter withheld. Dramatis Personae pulses
 * only for a relationship observation first learned on the last turn.
 */
export function pulsingTabsFor(
    perceivedChanges: readonly PerceivedChange[],
    knowledge: readonly KnowledgeClaim[],
    lastTurn: TurnHistoryEntry | null,
): Set<TabId> {
    const tabs = new Set<TabId>();
    perceivedChanges.forEach(change => change.tabs.forEach(tab => {
        if (tab !== 'dramatis_personae') tabs.add(tab);
    }));
    if (lastTurn && knowledge.some(claim =>
        claim.relationshipObservation && claim.firstLearnedTurn === lastTurn.turnNumber
    )) {
        tabs.add('dramatis_personae');
    }
    return tabs;
}

export function usePlayerPerception(
    messages: Message[],
    turnHistory: TurnHistoryEntry[],
    playerCharacterId: string | null,
    worldState: WorldState,
    knowledge: KnowledgeClaim[],
) {
    const lastGmNarration = useMemo(() => lastGmNarrationOf(messages), [messages]);

    // Perception layer (D5, Phase 2 item 2): the most recently committed
    // turn's ground-truth deltas, filtered down to what the player would
    // actually perceive. Recomputed from turnHistory itself (which already
    // persists) rather than kept in separate state, so the digest survives
    // a reload with no extra save-format changes. Uses that turn's OWN
    // postTurnEntities for the player's location/network, since either can
    // change turn to turn.
    // The newest entry always retains its snapshot (the reducer's
    // KEEP_FULL_SNAPSHOTS window keeps at least the most recent entry), but
    // the field is optional on TurnHistoryEntry, so both reads guard for
    // absence rather than assuming it.
    const lastTurn = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
    const lastTurnPlayer = useMemo(
        () => lastTurn?.postTurnEntities?.find(e => e.entity_id === playerCharacterId) ?? null,
        [lastTurn, playerCharacterId]
    );
    // One illuminated initial per week (audit item 13) — derived from the
    // ribbon dividers already in the stream, so no message gains a field.
    const illuminatedNarrations = useMemo(() => illuminatedNarrationIndices(messages), [messages]);
    const lastTurnPerceivedChanges = useMemo(
        () => (lastTurn?.postTurnEntities && lastTurnPlayer)
            ? buildPlayerPerceivedDigest(lastTurn.adjudication.deltas, lastTurnPlayer, lastTurn.postTurnEntities, worldState)
            : [],
        [lastTurn, lastTurnPlayer, worldState]
    );
    const pulsingTabs = useMemo(
        () => pulsingTabsFor(lastTurnPerceivedChanges, knowledge, lastTurn),
        [knowledge, lastTurn, lastTurnPerceivedChanges],
    );

    return { lastTurn, lastTurnPerceivedChanges, pulsingTabs, illuminatedNarrations, lastGmNarration };
}
