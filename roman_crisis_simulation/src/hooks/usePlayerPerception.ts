/**
 * hooks/usePlayerPerception.ts
 *
 * What the player's screen derives from committed state each render - the
 * last turn's perceived digest, which SidePanel tabs pulse and with how many
 * changes, the illuminated narrations, and the epilogue's cause-of-death
 * text. Moved verbatim out of
 * App.tsx (2026-09-23). Everything here is derived, never stored: it
 * recomputes from slices that already persist, so it survives a reload
 * with no save-format change.
 */

import { useMemo } from 'react';
import type { Message, TurnHistoryEntry, WorldState } from '../types';
import { perceivedStatusOf, type KnowledgeClaim } from '../knowledge/store';
import { buildPlayerPerceivedDigest, type PerceivedChange, type TabId } from '../perception/visibility';
import { illuminatedNarrationIndices } from '../components/Chat';
import { composureSignsOf } from '../ai/core/composure';

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
 * An observation drawn from a bought investigation: its evidence id is
 * knowledge/relationships.ts's `investigation:…`, which the investigation
 * commit files under its week as `turn:<n>:investigation:…`.
 */
const INVESTIGATION_EVIDENCE = /^(?:turn:\d+:)?investigation:/;

/**
 * The marks and ties the week let the player see on other figures (D48/D49),
 * one per mark or tie whose line on its figure's card the week changed and
 * the card now shows - a mark borne (not seen healed), a tie held (not seen
 * given up) - however many dispatch lines spoke of it. Read off the same
 * filtered digest the Dispatches show; a figure the player now believes
 * gone has no card to point at.
 */
function marksAndTiesNewlySeen(perceivedChanges: readonly PerceivedChange[], knowledge: readonly KnowledgeClaim[]): number {
    // The last word the week had on each mark and tie: whether the card shows it now.
    const lastWord = new Map<string, { figure: string; onCard: boolean }>();
    for (const change of perceivedChanges) {
        if (!change.tabs.includes('dramatis_personae')) continue;
        if (change.deltaType === 'condition' && change.perceivedCondition) {
            lastWord.set(`mark:${change.subject}:${change.perceivedCondition.id}`, { figure: change.subject, onCard: !change.perceivedCondition.gone });
        } else if (change.deltaType === 'affiliation' && change.perceivedAffiliation) {
            lastWord.set(`tie:${change.subject}:${change.perceivedAffiliation.id}`, { figure: change.subject, onCard: change.perceivedAffiliation.member });
        }
    }
    return [...lastWord.values()]
        .filter(({ figure, onCard }) => onCard && (perceivedStatusOf(knowledge, figure) ?? 'alive') === 'alive')
        .length;
}

/**
 * How many things changed on each SidePanel tab in the most recently
 * committed turn ("what changed since you last looked", ROADMAP_UPLEVEL
 * P6) - built strictly from the already-filtered perceived changes, never
 * from the raw deltas, so a count can never itself leak something the
 * perception filter withheld: it counts only lines the Dispatches digest
 * already shows. Dramatis Personae counts relationship observations first
 * learned on the last turn (D36 - the player reads relationships from
 * sourced observations, never from engine sentiment), and of the perceived
 * changes naming that tab only the marks and ties now on a figure's card
 * (D48/D49, `marksAndTiesNewlySeen`) - and only observations the committed
 * week itself brought. One drawn from an investigation the player bought in
 * the interlude is stamped with the week then in hand (useIntelCommits), so
 * it would otherwise be counted as new again once that week is sent, though
 * the player bought it and read it already. Reports also counts the
 * player's own treasury notices (the merchant's debt and low-treasury
 * Reports, ai/core/resources.ts): they are minted by the engine, never pass
 * through the digest, and would otherwise arrive with no coin (B14). One per
 * notice the committed week brought, as each is a card of its own; rumors
 * already count through the digest, so only the merchant source is read.
 *
 * Dramatis Personae also counts each sign the player caught (D50) once, at
 * the moment it reaches its figure's card: one the committed week's
 * narration let them catch, as the week lands (read off the entry's record:
 * how MANY, never whose or what); one caught in a private scene, as soon as
 * the scene commits it. A scene is held in the interlude, so its signs are
 * stamped with the week then in hand - after the last committed week - and
 * once that week lands they are neither on its record nor after it, so they
 * are never counted a second time. A tab with nothing new is absent.
 */
export function tabChangeCountsFor(
    perceivedChanges: readonly PerceivedChange[],
    knowledge: readonly KnowledgeClaim[],
    lastTurn: TurnHistoryEntry | null,
): Map<TabId, number> {
    const counts = new Map<TabId, number>();
    const bump = (tab: TabId, by = 1) => counts.set(tab, (counts.get(tab) ?? 0) + by);
    perceivedChanges.forEach(change => new Set(change.tabs).forEach(tab => {
        if (tab !== 'dramatis_personae') bump(tab);
    }));
    const marksAndTies = marksAndTiesNewlySeen(perceivedChanges, knowledge);
    if (marksAndTies > 0) bump('dramatis_personae', marksAndTies);
    // Signs caught in a private scene since the last week landed (before the
    // first, since the reign began).
    const sinceWeek = lastTurn?.turnNumber ?? 0;
    const sceneSigns = knowledge
        .filter(claim => claim.claimKey.startsWith('sign:'))
        .flatMap(claim => claim.updates)
        .filter(update => update.turn > sinceWeek)
        .length;
    if (sceneSigns > 0) bump('dramatis_personae', sceneSigns);
    if (lastTurn) {
        const observations = knowledge.filter(claim =>
            claim.relationshipObservation && claim.firstLearnedTurn === lastTurn.turnNumber
            && !INVESTIGATION_EVIDENCE.test(claim.relationshipObservation.evidenceId)
        ).length;
        if (observations > 0) bump('dramatis_personae', observations);
        const signs = composureSignsOf(lastTurn).length;
        if (signs > 0) bump('dramatis_personae', signs);
        // A report claim's updates carry the commit's turn (knowledge/commit.ts),
        // so a notice created or restated this week is an update stamped with it.
        const treasuryNotices = knowledge
            .filter(claim => claim.claimKey.startsWith('report:'))
            .flatMap(claim => claim.updates)
            .filter(update => update.source === 'merchant' && update.turn === lastTurn.turnNumber)
            .length;
        if (treasuryNotices > 0) bump('reports', treasuryNotices);
    }
    return counts;
}

/**
 * Which SidePanel tabs to pulse: exactly the tabs `tabChangeCountsFor`
 * counts something on.
 */
export function pulsingTabsFor(
    perceivedChanges: readonly PerceivedChange[],
    knowledge: readonly KnowledgeClaim[],
    lastTurn: TurnHistoryEntry | null,
): Set<TabId> {
    return new Set(tabChangeCountsFor(perceivedChanges, knowledge, lastTurn).keys());
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
    // The turn's pre-turn roster, as the commit gave it to the perception
    // layer (so this re-derivation matches the knowledge store and the
    // narration, the first turn included). An entry saved before the roster
    // was recorded falls back to the previous entry's snapshot; with neither,
    // the post-turn-only rules apply.
    const preTurnEntities = lastTurn?.preTurnRoster ?? turnHistory[turnHistory.length - 2]?.postTurnEntities;
    const lastTurnPerceivedChanges = useMemo(
        () => (lastTurn?.postTurnEntities && lastTurnPlayer)
            ? buildPlayerPerceivedDigest(lastTurn.adjudication.deltas, lastTurnPlayer, lastTurn.postTurnEntities, worldState, preTurnEntities)
            : [],
        [lastTurn, lastTurnPlayer, worldState, preTurnEntities]
    );
    const tabChangeCounts = useMemo(
        () => tabChangeCountsFor(lastTurnPerceivedChanges, knowledge, lastTurn),
        [knowledge, lastTurn, lastTurnPerceivedChanges],
    );
    const pulsingTabs = useMemo(() => new Set(tabChangeCounts.keys()), [tabChangeCounts]);

    return { lastTurn, lastTurnPerceivedChanges, pulsingTabs, tabChangeCounts, illuminatedNarrations, lastGmNarration };
}
