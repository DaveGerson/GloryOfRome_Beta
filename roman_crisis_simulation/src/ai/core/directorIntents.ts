import { Entity, NpcIntent, StoryRelevance } from '../../types';

// Lives here (rather than in ai/core/turn.ts, which originally defined both
// symbols) so the real turn pipeline (ai/core/turn.ts) and the mock turn
// (ai/mocks.ts) can share ONE definition of the durable-intent filter
// without a module cycle: turn.ts already imports mockRunNewTurn from
// ../mocks, so mocks.ts importing back from turn.ts would form a cycle that
// breaks Vitest's vi.mock('../ai/mocks', ...) interception in
// tests/appTransactionContracts.test.ts and tests/gmScreenSmoke.test.ts.
// turn.ts re-exports both symbols so existing importers (e.g.
// tests/director.test.ts, which imports them from '../ai/core/turn') are
// unaffected.

/**
 * Upper bound on the persisted per-turn intent list (4C.3): intents exist
 * for spotlight NPCs only, and the Director is instructed to pick 2-4
 * spotlights - so the durable slice stays small by construction; the cap is
 * the code-side guarantee against a runaway response bloating the save.
 */
export const MAX_NPC_INTENTS = 4;

/**
 * Derives the DURABLE intent list from the Director's raw output: an intent
 * survives only when its entity_id is BOTH an actual spotlight pick AND an
 * entity that is alive in the current roster (intents are per-spotlight by
 * contract, and a durable intent may never ride on someone who cannot act),
 * deduped to ONE intent per entity_id keeping the FIRST emitted, capped at
 * MAX_NPC_INTENTS in emission order. The alive gate is load-bearing: a
 * spotlight id can name an NPC who is dead/exiled/missing (or absent) in
 * state, and an intent committed on such an id would be persisted and fed to
 * the NEXT turn's Director and adjudicator as live direction for a corpse -
 * the adjudicator's own spotlight block already renders only alive NPCs, so
 * a dead-id intent could never earn an entityAction and would just accrete
 * as phantom direction. The dedupe is load-bearing too: the Director's
 * contract is exactly one intent per spotlight, and without it a duplicate
 * would crowd the cap, list twice in the adjudication prompt's intents
 * block, and disagree with the mind handoff (whose Map lookup keeps only one
 * entry per entity) about WHICH intent stands - first-wins makes every
 * consumer see the same one. This filtered list is the single shape
 * everything downstream consumes - the adjudication prompt's intents block,
 * the code-side consistency check, the history entry, and the reducer's
 * persisted `npcIntents` slice. Pure; exported for direct unit testing.
 *
 * `playerEntityId`: intents are NPC direction (D10/D22), exactly as
 * selectMindEntities (ai/core/turn.ts) keeps the player out of the minds -
 * the player's own intent is theirs alone (D35/D37). An intent naming the
 * player would otherwise tell the adjudicator to author the player's
 * conduct, so it is dropped however the Director came to emit it (Mock
 * Mode's canned Director spotlights a playable preset). Optional only so
 * callers that pass an NPC-only roster need not repeat the id.
 */
export function selectDurableIntents(storyRelevance: StoryRelevance, roster: readonly Pick<Entity, 'entity_id' | 'status'>[], playerEntityId?: string): NpcIntent[] {
    const spotlightIds = new Set(storyRelevance.spotlight_entities.map(s => s.entity_id));
    const aliveIds = new Set(roster.filter(e => e.status === 'alive').map(e => e.entity_id));
    const seen = new Set<string>();
    const durable: NpcIntent[] = [];
    for (const intent of storyRelevance.spotlight_intents ?? []) {
        if (intent.entity_id === playerEntityId) continue;
        if (!spotlightIds.has(intent.entity_id) || !aliveIds.has(intent.entity_id) || seen.has(intent.entity_id)) continue;
        seen.add(intent.entity_id);
        durable.push(intent);
    }
    return durable.slice(0, MAX_NPC_INTENTS);
}
