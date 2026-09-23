/**
 * hooks/useEventFlow.ts
 *
 * Authored events (D12): the post-commit trigger check that decides
 * whether a modal fires, and the atomic commit of the player's choice.
 * Moved verbatim out of App.tsx (2026-09-23).
 */

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch } from 'react';
import { GameState } from '../types';
import type {
    Entity, GameEvent, EventFiringRecord, EventHistoryEntry, Message, PlayerEventChoice,
    SimulationState, WorldState,
} from '../types';
import type { GameAction } from '../state/gameReducer';
import type { SaveGameState } from '../persistence/saveGame';
import { checkForTriggeredEvent, applyEventChoiceDeltas, recordEventFiring } from '../events/engine';
import type { DomainCommit, TransactionNote } from '../app/transactions';

export interface EventFlowDeps {
    activeEvent: GameEvent | null;
    playerEntity: Entity | null;
    entities: Entity[];
    worldState: WorldState;
    simulationState: SimulationState;
    turnNumber: number;
    eventFirings: EventFiringRecord[];
    eventHistory: EventHistoryEntry[];
    triggeredEventIds: string[];
    messages: Message[];
    dispatch: Dispatch<GameAction>;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    setTransactionNote: (note: TransactionNote | null) => void;
}

export function useEventFlow(deps: EventFlowDeps) {
    const {
        activeEvent, playerEntity, entities, worldState, simulationState, turnNumber,
        eventFirings, eventHistory, triggeredEventIds, messages,
        dispatch, buildSaveState, commitDomainMutation, setTransactionNote,
    } = deps;

    // Set when a turn commits with the player still alive; the effect below
    // then runs the authored-event trigger check against the freshly
    // committed state and resolves the phase to AWAITING_EVENT_CHOICE or
    // AWAITING_PLAYER_INPUT. Transient orchestration only - never saved.
    const [isCheckingEvents, setIsCheckingEvents] = useState(false);
    // A failed event-choice save renders in-modal (EventModal is a
    // role="dialog" with no close affordance, so the composer-strip alert
    // behind it via `transactionError` would be invisible) - mirrors
    // usePrivateSceneController's privateSceneError.
    const [eventChoiceError, setEventChoiceError] = useState<string | null>(null);

    useEffect(() => {
        if (isCheckingEvents) {
            // 4D.2 (D12): eligibility is decided by the per-event firing
            // records (repeatable + cooldown), not the legacy string set;
            // simulationState/turnNumber feed the sim-state-keyed triggers
            // and the cooldown arithmetic.
            // Known coordination gap: nothing suppresses a verbatim modal
            // fire for a premise the adjudicator wove into the turn that
            // just committed - "verbatim as the exception" (D12) is held
            // only by trigger rarity and cooldowns. The prompt's
            // never-pre-stage clause keeps content from duplicating, but a
            // same-turn weave-then-modal double-hit is possible; a
            // suppression gate is an owner-ruling candidate.
            const event = checkForTriggeredEvent(worldState, entities, eventFirings, playerEntity, simulationState, turnNumber);
            if (event) {
                dispatch({ type: 'EVENT_TRIGGERED', event });
            } else {
                dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            }
            queueMicrotask(() => setIsCheckingEvents(false));
        }
    }, [isCheckingEvents, worldState, entities, eventFirings, playerEntity, simulationState, turnNumber, dispatch]);

    const handleEventChoice = useCallback((choice: PlayerEventChoice) => {
        if (!activeEvent || !playerEntity) return;

        const newEventHistoryEntry: EventHistoryEntry = {
            eventId: activeEvent.id,
            eventTitle: activeEvent.title,
            choiceText: choice.text,
            turnNumber: turnNumber,
        };

        const { updatedEntities, updatedWorldState } = applyEventChoiceDeltas(choice, playerEntity, entities, worldState, turnNumber);
        const eventMessage: Message = { sender: 'gm', text: `**Event: ${activeEvent.title}**\nYou chose to: *${choice.text}*`};
        const newEventHistory = [...eventHistory, newEventHistoryEntry];
        // 4D.2 (D12): both bookkeeping shapes advance together - the legacy
        // deduped ever-fired set (a repeat firing never duplicates its id)
        // and the turn-stamped records the cooldown logic reads.
        const { triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings } =
            recordEventFiring(triggeredEventIds, eventFirings, activeEvent.id, turnNumber);

        // The single atomic commit for this event choice
        // (state/gameReducer.ts's EVENT_CHOICE_APPLIED): deltas, chat log,
        // event history, seen-ids and modal close land in one state
        // transition. DESIGN_DECISIONS.md D1 - an authored event choice's
        // deltas can also kill the player (applyEventChoiceDeltas), not just
        // the adjudicated turn pipeline - the reducer applies the exact same
        // GAME_OVER check as TURN_COMMITTED.
        if (!commitDomainMutation({
            candidate: buildSaveState({ entities: updatedEntities, worldState: updatedWorldState, eventHistory: newEventHistory, triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings, messages: [...messages, eventMessage] }),
            action: {
                type: 'EVENT_CHOICE_APPLIED',
                entities: updatedEntities,
                worldState: updatedWorldState,
                eventMessage,
                eventHistory: newEventHistory,
                triggeredEventIds: newTriggeredEventIds,
                eventFirings: newEventFirings,
            },
            onSaveFailure: () => setEventChoiceError('Your choice could not be saved. Please try again.'),
            beforeDispatch: () => {
                setTransactionNote(null);
                setEventChoiceError(null);
            },
        })) {
            return;
        }

    }, [activeEvent, buildSaveState, commitDomainMutation, entities, eventFirings, eventHistory, messages, playerEntity, setTransactionNote, triggeredEventIds, turnNumber, worldState]);

    return { setIsCheckingEvents, eventChoiceError, handleEventChoice };
}
