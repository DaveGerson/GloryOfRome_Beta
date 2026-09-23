/**
 * hooks/useTurnFlow.ts
 *
 * The player's side of a turn: the two composer drafts, the in-flight
 * theater (stage line, streaming narration, the pending player bubble),
 * what failed and what can be retried - and the submit that turns a draft
 * into a frozen TurnSubmission for executeTurn (hooks/useExecuteTurn.ts).
 * Moved verbatim out of App.tsx (2026-09-23). Every value here is
 * transient UI state, never part of the save bundle.
 *
 * executeTurn's own deps are passed straight through; this hook adds only
 * the eight setters it owns.
 */

import { useState } from 'react';
import { GameState } from '../types';
import type { KnownRecipientOption, Message, StructuredTurnDraft, TurnSubmission } from '../types';
import type { TurnStage } from '../ai/core/turn';
import type { TurnFailure } from '../components/ui/FailureNotices';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { validateAndNormalizeTurnSubmission, deepFreezeTurnSubmission } from '../playerInput/turnSubmission';
import { useExecuteTurn, type ExecuteTurnDeps } from './useExecuteTurn';

type OwnedSetters =
    | 'setPendingPlayerMessage' | 'setTurnFailure' | 'setRetrySubmission' | 'setRetryDraft'
    | 'setChatDraft' | 'setStructuredDraft' | 'setTurnStage' | 'setStreamingNarration';

export interface TurnFlowDeps extends Omit<ExecuteTurnDeps, OwnedSetters> {
    gameState: GameState;
    privateSceneInteractionLocked: boolean;
    recipientOptions: KnownRecipientOption[];
}

export function useTurnFlow(deps: TurnFlowDeps) {
    const { gameState, privateSceneInteractionLocked, recipientOptions, ...executeTurnDeps } = deps;

    const [chatDraft, setChatDraft] = useState('');
    const [structuredDraft, setStructuredDraft] = useState<StructuredTurnDraft>(() => emptyStructuredDraft());
    const [retrySubmission, setRetrySubmission] = useState<TurnSubmission | null>(null);
    const [retryDraft, setRetryDraft] = useState<string | StructuredTurnDraft | null>(null);
    const [pendingPlayerMessage, setPendingPlayerMessage] = useState<Message | null>(null);
    // WP-21: WHICH failure, not a sentence. All the copy lives in
    // components/ui/FailureNotices.tsx, so the four kinds cannot drift
    // apart into four differently-worded versions of "try again".
    const [turnFailure, setTurnFailure] = useState<TurnFailure | null>(null);

    // ROADMAP_0_MASTER_PLAN.md Phase 3 items 1-2 - the "thinking theater" and
    // streaming narration. Both are purely transient, in-flight-turn UI
    // state, never part of the save bundle: `turnStage` drives the themed
    // status line (see components/Chat.tsx's TypingIndicator/ChatInput),
    // `streamingNarration` holds the live, gate-filtered GM bubble text
    // (see StreamingNarrationBubble) fed by runNewTurn's `onNarrationChunk`.
    // Both are cleared the instant a turn commits OR errors - see
    // executeTurn - so they never survive past the turn that set them.
    const [turnStage, setTurnStage] = useState<TurnStage | null>(null);
    const [streamingNarration, setStreamingNarration] = useState<string>('');

    const executeTurn = useExecuteTurn({
        ...executeTurnDeps,
        setPendingPlayerMessage, setTurnFailure, setRetrySubmission, setRetryDraft,
        setChatDraft, setStructuredDraft, setTurnStage, setStreamingNarration,
    });

    const handleComposerSubmit = (draft: string | StructuredTurnDraft) => {
        if (gameState !== GameState.AWAITING_PLAYER_INPUT || privateSceneInteractionLocked) return;
        const candidate: TurnSubmission | StructuredTurnDraft = typeof draft === 'string'
            ? { version: 1, kind: 'freeform', text: draft }
            : draft;
        const normalized = validateAndNormalizeTurnSubmission(candidate, { knownRecipients: recipientOptions });
        if (!normalized.ok) return;
        void executeTurn(deepFreezeTurnSubmission(normalized.submission), draft);
    };

    // The retry affordance re-sends the exact frozen submission that failed,
    // restoring the exact draft it came from if it fails again.
    const retryLastTurn = () => {
        if (retrySubmission && retryDraft) void executeTurn(retrySubmission, retryDraft);
    };

    return {
        chatDraft, setChatDraft,
        structuredDraft, setStructuredDraft,
        canRetry: Boolean(retrySubmission && retryDraft),
        retryLastTurn,
        pendingPlayerMessage,
        turnFailure, setTurnFailure,
        turnStage,
        streamingNarration,
        handleComposerSubmit,
    };
}
