import { WorldState, Entity, GameEvent, PlayerEventChoice, EventDelta, EventFiringRecord, SimulationState } from '../types';
import { ALL_EVENTS } from '../constants/events';
import { applyDeltas } from '../ai/core/engine';

/**
 * Builds the authoritative firing bookkeeping from BOTH persisted shapes
 * (ROADMAP_PHASE_4.md 4D item 2, D12): the richer `eventFirings` records
 * when present, plus a conservative record for any legacy
 * `triggeredEventIds` entry the richer list doesn't cover. A legacy id
 * carries no firing turn, so it is stamped with `fallbackTurn` (the turn
 * the save was loaded/snapshotted at) - a repeatable event from a legacy
 * save therefore restarts its cooldown from load rather than firing
 * immediately, and a non-repeatable one stays fired-once exactly as
 * before. Pure; exported for direct unit testing.
 */
export function normalizeEventFirings(
    triggeredEventIds: string[],
    eventFirings: EventFiringRecord[] | undefined,
    fallbackTurn: number
): EventFiringRecord[] {
    const records = eventFirings ? [...eventFirings] : [];
    const known = new Set(records.map(r => r.eventId));
    for (const id of triggeredEventIds) {
        if (known.has(id)) continue;
        known.add(id);
        records.push({ eventId: id, lastFiredTurn: fallbackTurn, timesFired: 1 });
    }
    return records;
}

/**
 * Whether an event may fire (again) this turn, given its firing record
 * (4D.2, D12): never fired means eligible; fired and not `repeatable`
 * means never again (the original fire-once contract); fired and
 * `repeatable` means eligible once its cooldown has elapsed -
 * (turnNumber - lastFiredTurn) >= cooldownTurns. Pure; exported for
 * direct unit testing.
 */
export function isEventEligible(event: GameEvent, eventFirings: EventFiringRecord[], turnNumber: number): boolean {
    const record = eventFirings.find(r => r.eventId === event.id);
    if (!record) return true;
    if (!event.repeatable) return false;
    return turnNumber - record.lastFiredTurn >= (event.cooldownTurns ?? 0);
}

/**
 * Records one event firing into BOTH bookkeeping shapes at once (4D.2):
 * `triggeredEventIds` stays the legacy deduped ever-fired set (a repeat
 * firing never duplicates its id), while `eventFirings` carries the turn
 * stamp and count the cooldown logic needs. Returns new arrays; never
 * mutates its inputs. Pure; exported for direct unit testing.
 */
export function recordEventFiring(
    triggeredEventIds: string[],
    eventFirings: EventFiringRecord[],
    eventId: string,
    turnNumber: number
): { triggeredEventIds: string[]; eventFirings: EventFiringRecord[] } {
    const existing = eventFirings.find(r => r.eventId === eventId);
    return {
        triggeredEventIds: triggeredEventIds.includes(eventId) ? [...triggeredEventIds] : [...triggeredEventIds, eventId],
        eventFirings: existing
            ? eventFirings.map(r => r.eventId === eventId ? { ...r, lastFiredTurn: turnNumber, timesFired: r.timesFired + 1 } : r)
            : [...eventFirings, { eventId, lastFiredTurn: turnNumber, timesFired: 1 }],
    };
}

/**
 * Checks if any new event should be triggered based on the current game state.
 * Honors each event's repeatable/cooldown contract via `isEventEligible`
 * (4D.2, D12): a fire-once event that has fired never returns; a repeatable
 * one returns again once its cooldown since its last firing has elapsed.
 * @returns The first eligible event whose trigger fires, or null.
 */
export function checkForTriggeredEvent(
    worldState: WorldState,
    entities: Entity[],
    eventFirings: EventFiringRecord[],
    player: Entity | null,
    simulationState: SimulationState,
    turnNumber: number
): GameEvent | null {
    for (const event of ALL_EVENTS) {
        if (isEventEligible(event, eventFirings, turnNumber)) {
            if (event.trigger(worldState, entities, player, simulationState)) {
                return event;
            }
        }
    }
    return null;
}

/**
 * One authored event surfaced to the adjudicator as payoff material
 * (ROADMAP_PHASE_4.md 4D item 2, D24): the event itself plus its one-line
 * premise. 'ripe' means its trigger fires AND it is eligible right now (the
 * modal system could fire it verbatim this very turn); 'near' means its
 * trigger fires but its cooldown has up to NEAR_COOLDOWN_WINDOW turns left
 * to run - due soon, worth foreshadowing, not yet re-fireable verbatim.
 */
export interface RipeEventMaterial {
    event: GameEvent;
    premise: string;
    status: 'ripe' | 'near';
}

/**
 * How close (in turns) a cooldown-held repeatable event's re-eligibility
 * must be for it to count as 'near' material rather than being suppressed
 * entirely (4D.2, D24).
 */
export const NEAR_COOLDOWN_WINDOW = 3;

/**
 * Selects the authored events whose historical moment has plausibly come
 * (4D.2, D24): those whose triggers fire against the CURRENT world/sim
 * state and that are eligible now ('ripe') or within NEAR_COOLDOWN_WINDOW
 * turns of cooldown expiry ('near'). Cooldown-suppressed events further
 * from re-eligibility - and fired non-repeatable ones - are excluded
 * entirely. The result feeds the adjudication prompt's GM-private
 * HISTORICAL MATERIAL block (ai/prompts/adjudication.ts) so the
 * adjudicator's PACING JUDGMENT can prefer a due historical current over a
 * custom crisis; it never fires anything itself. Pure; exported for direct
 * unit testing.
 *
 * Boundary skew: material derives at the pre-commit turn number N, while
 * the modal eligibility check after that same turn commits runs at N+1 -
 * so an event exactly one cooldown turn from eligibility is labeled NEAR
 * for the very turn at whose end it can fire verbatim. Foreshadow-then-fire
 * is coherent, so the off-by-one is accepted rather than compensated.
 */
export function selectRipeEventMaterial(
    worldState: WorldState,
    simulationState: SimulationState,
    entities: Entity[],
    player: Entity | null,
    eventFirings: EventFiringRecord[],
    turnNumber: number
): RipeEventMaterial[] {
    const material: RipeEventMaterial[] = [];
    for (const event of ALL_EVENTS) {
        if (!event.trigger(worldState, entities, player, simulationState)) continue;
        const premise = event.premise ?? event.title;
        if (isEventEligible(event, eventFirings, turnNumber)) {
            material.push({ event, premise, status: 'ripe' });
            continue;
        }
        if (!event.repeatable) continue;
        const record = eventFirings.find(r => r.eventId === event.id);
        if (!record) continue;
        const turnsUntilEligible = record.lastFiredTurn + (event.cooldownTurns ?? 0) - turnNumber;
        if (turnsUntilEligible > 0 && turnsUntilEligible <= NEAR_COOLDOWN_WINDOW) {
            material.push({ event, premise, status: 'near' });
        }
    }
    return material;
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