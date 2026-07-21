import { WorldState, Entity, GameEvent, PlayerEventChoice, EventDelta } from '../types';
import { ALL_EVENTS } from '../constants/events';
import { applyDeltas } from '../ai/core/engine';


/**
 * Checks if any new event should be triggered based on the current game state.
 * @returns The first event that is triggered and has not been seen before, or null.
 */
export function checkForTriggeredEvent(
    worldState: WorldState,
    entities: Entity[],
    triggeredEventIds: string[],
    player: Entity | null
): GameEvent | null {
    for (const event of ALL_EVENTS) {
        if (!triggeredEventIds.includes(event.id)) {
            if (event.trigger(worldState, entities, player)) {
                return event;
            }
        }
    }
    return null;
}

/**
 * Applies the deltas from a chosen event option to the game state.
 * @returns The updated entities and world state.
 */
export function applyEventChoiceDeltas(
    choice: PlayerEventChoice,
    player: Entity,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    turnNumber?: number
): { updatedEntities: Entity[], updatedWorldState: WorldState } {
    // This function leverages the same delta application logic as the main turn adjudication.

    // Replace placeholder for the player character with the actual player's entity ID
    const processedDeltas = choice.deltas.map(delta => {
        if (delta.key.includes('PLAYER_CHARACTER')) {
            return {
                ...delta,
                key: delta.key.replace(/PLAYER_CHARACTER/g, player.entity_id)
            };
        }
        return delta;
    });

    // The engine runs one turn per week (see turn_logic.md), so week is the
    // real 1:1 turn counter within the current year. The previous
    // `Math.floor(week / 4) + 1` formula mislabeled every event-choice log
    // entry (it divided the week count by 4 as if 4 weeks made a turn).
    // Callers that track the App-level `turnNumber` state (which stays
    // monotonic across year rollovers, unlike `week`) should pass it
    // explicitly for full accuracy; it takes precedence when provided.
    const resolvedTurnNumber = turnNumber ?? currentWorldState.week;
    // DISCARD CONSTRAINT: only entities/worldState are taken from this
    // applyDeltas call - any newReports/newTruthLedgerEntries it returns are
    // dropped. Safe today because authored event choices
    // (constants/events.ts) carry no 'rumor' deltas, so no truth-ledger
    // entries (D11) can be minted here. The one Report-minting path
    // reachable through an authored choice is the systemic denarii rule on
    // an overdraft (ai/core/resources.ts): the debt STATE still lands on
    // the entity, only the notification Report is lost on this path. An
    // authored event that mints rumors - or that must surface debt notices -
    // needs this signature extended to return them.
    const { updatedEntities, updatedWorldState } = applyDeltas(processedDeltas, currentEntities, currentWorldState, resolvedTurnNumber);
    return { updatedEntities, updatedWorldState };
}