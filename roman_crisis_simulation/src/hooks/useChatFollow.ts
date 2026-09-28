/**
 * hooks/useChatFollow.ts
 *
 * The chat log follows the newest line only while the reader is AT the
 * newest line. It replaces useShellEffects's `useScrollToLatest`, which
 * scrolled to the foot on every change: a player scrolled back to re-read
 * week III was yanked to the bottom the moment anything landed, and the
 * streamed narration - which never changed `messages` - was not followed
 * at all.
 *
 * The rules:
 *  - at the foot (within FOLLOW_THRESHOLD_PX), every new leaf and every
 *    streamed chunk keeps the foot in view;
 *  - sending a week always returns the reader to the foot - they just
 *    acted, and the loom is where the answer appears;
 *  - scrolled away, nothing moves; the desk offers "To the latest", which
 *    becomes "New in the chronicle" once something has landed unseen.
 *
 * Presentation state only - nothing here is saved (D17).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { GameState } from '../types';
import { motionIsReduced } from '../persistence/readingPrefs';

/** How close to the foot still counts as "reading the latest". */
export const FOLLOW_THRESHOLD_PX = 160;

/** Scroll events during a programmatic scroll are the scroll itself, not the reader leaving. */
const AUTO_SCROLL_GRACE_MS = 700;

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const CHAT_FOLLOW_COPY = {
    toLatest: 'To the latest',
    unseen: 'New in the chronicle',
} as const;

export function isNearFoot(
    el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
    threshold = FOLLOW_THRESHOLD_PX,
): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export interface ChatFollow {
    /** The scrolling log (`role="log"`). */
    logRef: RefObject<HTMLDivElement | null>;
    /** The sentinel at the log's foot. */
    endRef: RefObject<HTMLDivElement | null>;
    /** Bind to the log's onScroll. */
    onLogScroll: () => void;
    /** True while the reader has scrolled away from the foot. */
    awayFromFoot: boolean;
    /** True when a leaf landed while the reader was away. */
    hasUnseen: boolean;
    /** Returns the reader to the foot (the desk's button, the command palette). */
    jumpToLatest: () => void;
}

export function useChatFollow({ messageCount, gameState, streamingText }: {
    /** `messages.length` - the committed transcript only ever grows or is replaced wholesale. */
    messageCount: number;
    gameState: GameState;
    /** The live narration bubble's text while a week is being written, or ''. */
    streamingText: string;
}): ChatFollow {
    const logRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const [awayFromFoot, setAwayFromFoot] = useState(false);
    // The transcript length the reader has seen the foot of; anything past
    // it, while away, is unseen.
    const [seenCount, setSeenCount] = useState(messageCount);
    const messageCountRef = useRef(messageCount);
    const autoScrollUntilRef = useRef(0);
    const previousGameStateRef = useRef(gameState);

    const scrollToFoot = useCallback((smooth: boolean) => {
        autoScrollUntilRef.current = Date.now() + AUTO_SCROLL_GRACE_MS;
        endRef.current?.scrollIntoView?.({ behavior: smooth && !motionIsReduced() ? 'smooth' : 'auto', block: 'end' });
    }, []);

    // Committed leaves and phase changes.
    useEffect(() => {
        messageCountRef.current = messageCount;
        const justSent = gameState === GameState.PROCESSING && previousGameStateRef.current !== GameState.PROCESSING;
        previousGameStateRef.current = gameState;
        if (!awayFromFoot || justSent) scrollToFoot(true);
        // Deliberately not keyed on `awayFromFoot`: coming back to the foot is
        // the reader's own scroll, and must not trigger a second one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messageCount, gameState, scrollToFoot]);

    // The pen's progress: followed instantly (a smooth scroll per chunk
    // would never settle), and only while the reader is at the foot.
    useEffect(() => {
        if (!streamingText || awayFromFoot) return;
        scrollToFoot(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streamingText, scrollToFoot]);

    const onLogScroll = useCallback(() => {
        const log = logRef.current;
        if (!log) return;
        const near = isNearFoot(log);
        // A programmatic scroll passes through "away" on its way down.
        if (!near && Date.now() < autoScrollUntilRef.current) return;
        setAwayFromFoot(!near);
        if (near) setSeenCount(messageCountRef.current);
    }, []);

    const jumpToLatest = useCallback(() => {
        setAwayFromFoot(false);
        setSeenCount(messageCountRef.current);
        scrollToFoot(true);
    }, [scrollToFoot]);

    return {
        logRef,
        endRef,
        onLogScroll,
        awayFromFoot,
        hasUnseen: awayFromFoot && messageCount > seenCount,
        jumpToLatest,
    };
}
