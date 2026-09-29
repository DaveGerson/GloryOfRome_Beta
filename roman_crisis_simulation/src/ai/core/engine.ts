import { Entity, WorldState, Adjudication, Report, EventDelta, Relationship, TruthLedgerEntry } from '../../types';
import { SYSTEMIC_RESOURCES, applySystemicResourceRule } from './resources';
import { zScheme } from './zodSchemas';
import { buildNpcPerceptions, selectMemoryChanges, selectPerceivingNpcs } from '../../perception/npcPerception';
import { legacyReasonIndicatesDeath, legacyStatusFromReason } from './legacyStatus';

// The legacy reason-parse lives in ./legacyStatus.ts, where the perception
// layer can mirror it without importing this module.
export { legacyReasonIndicatesDeath };

// NOTE: The turn-adjudication prompt (formerly `compileContext` here) has
// moved to `ai/prompts/adjudication.ts::buildAdjudicationPrompt`, and its
// `getEntityBrief` helper to `ai/prompts/fragments.ts`, as part of
// centralizing all prompt text under ai/prompts/ (see
// ai/prompts/README.md). This file stays pure state-transition logic - see
// ROADMAP_6_MAINTAINABILITY.md's note that `engine.ts` is "pure and
// testable" and should stay that way.

/**
 * Upper bound on an entity's `memories` list - the oldest entries are
 * dropped once a write would exceed it. Memories accrue each turn from the
 * entity's own perceived digest (perception/npcPerception.ts, itself
 * per-turn-bounded by MAX_NPC_MEMORY_LINES_PER_TURN) and are persisted in
 * the save, so they must be bounded; the bound is deliberately generous
 * because memories are simulation context (they can inform prompts and
 * future systems), not disposable debug data - a cap tight enough to
 * change what the model can recall would be a mechanics change, which
 * this is not.
 */
export const MAX_ENTITY_MEMORIES = 40;

/**
 * Upper bound on a relationship's `recent_interactions` list - the oldest
 * entries are dropped once a write would exceed it. One line is appended
 * per relation delta and persisted in the save, so an active relationship
 * grows without limit otherwise. The field's contract is "recent": only
 * the newest window is meaningful, so dropping the oldest preserves its
 * semantics for every consumer.
 */
export const MAX_RECENT_INTERACTIONS = 20;

/**
 * Upper bound on the GM-private truth ledger (DESIGN_DECISIONS.md D11) -
 * the oldest entries are dropped once an append would exceed it. One entry
 * is written per rumor delta and persisted in the save, so the ledger must
 * be bounded like every other accreting slice; the bound is deliberately
 * generous because the ledger is the GM console's true-vs-believed tuning
 * record, not disposable debug data.
 */
export const MAX_TRUTH_LEDGER_ENTRIES = 200;

/**
 * True if a 'status' EventDelta represents a claimed death - either via the
 * structured `new_status === 'dead'` field (preferred, MAINT-P0.2), or (for
 * legacy deltas that omit it) `legacyReasonIndicatesDeath`'s free-text
 * matching. This is the EXACT rule `applyDeltas`' 'status' case uses to
 * decide whether an entity dies, exported so
 * `ai/core/mortality.ts`'s death-claim scan (DESIGN_DECISIONS.md D2/D3)
 * reuses the identical detection instead of re-implementing the regex.
 *
 * A delta carrying `new_location` without `new_status` is a RELOCATION -
 * the STATUS DELTAS contract (ai/prompts/adjudication.ts) sets new_status
 * only when status changes - so its `reason` is display text and is never
 * read as a death ("Flees to Ostia after the Emperor was slain" moves the
 * fleeing entity; it does not kill them). The legacy regex applies only to
 * a delta that carries neither structured field.
 */
export function isDeathClaimDelta(delta: EventDelta): boolean {
    if (delta.type !== 'status') return false;
    if (delta.new_status) return delta.new_status === 'dead';
    if (delta.new_location) return false;
    return legacyReasonIndicatesDeath(delta.reason);
}

/**
 * Applies a list of deltas to the current game state.
 * This is a pure function that returns new state objects.
 *
 * `playerEntityId` (optional): the player's entity id. The systemic
 * resource registry's notification Reports ("Your coffers run dry...")
 * describe the PLAYER'S own treasury - the one treasury D6 makes knowable -
 * so they are minted only for this entity. Every other entity still
 * accrues its debt state, silently. With no id, no such Report is minted
 * at all: an NPC's overdraft must never reach the player's Reports.
 *
 * `gmNotes` carries this module's refuse-and-record answers to malformed
 * instructions that applyDeltas can see (a numeric delta aimed at a text
 * resource, a scheme that is not a scheme) - applyAdjudication appends
 * them to `gm_private` for the GM console.
 */
export function applyDeltas(
    deltas: EventDelta[],
    currentEntities: Entity[],
    currentWorldState: WorldState,
    turnNumber: number,
    playerEntityId?: string
): { updatedEntities: Entity[], updatedWorldState: WorldState, newReports: Report[], newTruthLedgerEntries: TruthLedgerEntry[], gmNotes: string[] } {
    const updatedEntities: Entity[] = JSON.parse(JSON.stringify(currentEntities));
    const updatedWorldState: WorldState = JSON.parse(JSON.stringify(currentWorldState));
    const newReports: Report[] = [];
    const newTruthLedgerEntries: TruthLedgerEntry[] = [];
    const gmNotes: string[] = [];
    // Per-call sequence for rumor report/ledger ids: Date.now() alone can
    // collide when one turn emits several rumors in the same millisecond,
    // and each ledger entry's reportId link requires the Report id to be
    // unique within the turn.
    let rumorSeq = 0;
    // The same guarantee for the systemic registry's Reports (two
    // overdrafts in one call would otherwise share an id).
    let systemicSeq = 0;

    deltas.forEach(delta => {
        try {
            switch(delta.type) {
                case 'resource': {
                    const [entityId, resourceName] = delta.key.split(':');
                    const entity = updatedEntities.find(e => e.entity_id === entityId);
                    // A key with no ':resource' half names no resource: without
                    // this guard `resourceName` is undefined and the delta
                    // wrote a resource literally named "undefined" into the
                    // entity's persisted bag (the 'relation' case below has
                    // the same malformed-key guard).
                    if (entity && resourceName) {
                        const current = entity.resources[resourceName];
                        // Resources may hold text or lists (world gen's
                        // thematic resources). A numeric delta on one would
                        // concatenate into a corrupted string, so it is
                        // refused and recorded instead. An absent (or null)
                        // value counts as 0, so a delta can still create a
                        // new numeric resource.
                        if (current !== undefined && current !== null && typeof current !== 'number') {
                            gmNotes.push(`[Engine] Refused a numeric 'resource' delta (${delta.delta}) on '${delta.key}' - that resource holds text, not a number, and was left unchanged.`);
                            break;
                        }
                        const currentVal = (current as number) || 0;
                        const rawNewVal = currentVal + delta.delta;

                        // SYSTEMIC RESOURCE REGISTRY (DESIGN_DECISIONS.md D6,
                        // ai/core/resources.ts). Most resources are freeform - a
                        // bare running total, free to go negative - and keep
                        // exactly today's behavior. A small registry (denarii
                        // first) instead gets engine-enforced floors/thresholds/
                        // consequences (e.g. an overdraft becomes debt rather
                        // than a bare zero floor). Non-registry resource names
                        // fall through to the `else` branch, unchanged.
                        const rule = SYSTEMIC_RESOURCES[resourceName];
                        if (rule) {
                            systemicSeq += 1;
                            const { finalValue, reports } = applySystemicResourceRule(
                                rule, entity, resourceName, currentVal, rawNewVal, turnNumber,
                                { emitReports: playerEntityId !== undefined && entity.entity_id === playerEntityId, sequence: systemicSeq }
                            );
                            entity.resources[resourceName] = finalValue;
                            newReports.push(...reports);
                        } else {
                            entity.resources[resourceName] = rawNewVal;
                        }
                    }
                    break;
                }
                case 'relation': {
                    const parts = delta.key.split(':');
                    if (parts.length < 2) break; // Invalid key

                    const [entityAId, entityBId, attribute = 'trust_level'] = parts;
                    // Type assertion to ensure we are only working with valid relationship properties
                    const attr = attribute as keyof Omit<Relationship, 'entity_id' | 'relationship_type' | 'recent_interactions'>;
                    
                    const validAttributes = ['trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'];
                    if (!validAttributes.includes(attr)) break;

                    // Directional semantics: the key 'A:B:attribute' changes A's
                    // perception of B only. Relationships are asymmetric by design
                    // (A can trust B while B despises A), and attributes like
                    // perceived_threat are inherently one-sided. Mutual changes
                    // require two deltas, one per direction — the schema/prompt
                    // instruct the model accordingly.
                    const entity = updatedEntities.find(e => e.entity_id === entityAId);
                    if (entity) {
                        if (!entity.relationships[entityBId]) {
                            entity.relationships[entityBId] = { entity_id: entityBId, relationship_type: 'acquaintance', trust_level: 0, recent_interactions: [] };
                        }

                        const rel = entity.relationships[entityBId];

                        // Initialize attribute if it doesn't exist
                        if (rel[attr] === undefined) {
                            rel[attr] = 0;
                        }

                        if (typeof rel[attr] === 'number') {
                            rel[attr] += delta.delta;

                            // Clamping logic
                            if (attr === 'trust_level' || attr === 'ideological_alignment' || attr === 'respect_level') {
                                rel[attr] = Math.max(-10, Math.min(10, rel[attr]));
                            } else if (attr === 'perceived_threat' || attr === 'dependency_level') {
                                rel[attr] = Math.max(0, Math.min(10, rel[attr]));
                            }
                        }

                        if (!rel.recent_interactions.some(interaction => interaction.endsWith(delta.reason))) {
                            rel.recent_interactions.push(`Turn ${turnNumber}: ${delta.reason}`);
                            // Bounded at the write site: drop the oldest past
                            // MAX_RECENT_INTERACTIONS. An over-long list from
                            // a save written before the bound is trimmed too,
                            // but only when this relationship logs a new
                            // interaction - untouched relationships keep
                            // their legacy length.
                            if (rel.recent_interactions.length > MAX_RECENT_INTERACTIONS) {
                                rel.recent_interactions.splice(0, rel.recent_interactions.length - MAX_RECENT_INTERACTIONS);
                            }
                        }
                    }
                    break;
                }
                 case 'status': {
                    const entity = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entity) {
                        const validStatuses: Entity['status'][] = ['alive', 'dead', 'exiled', 'missing'];
                        const previousStatus = entity.status;

                        if (delta.new_status && validStatuses.includes(delta.new_status)) {
                            // STRUCTURED PATH (preferred, MAINT-P0.2): the model set the
                            // enum field explicitly. This wins regardless of how 'reason'
                            // happens to be phrased - e.g. new_status:'dead' alongside a
                            // reason like "He miraculously survived" still results in
                            // death, because 'reason' is narrative/display text only and
                            // is never parsed for control flow when the structured field
                            // is present.
                            entity.status = delta.new_status;
                        } else if (!delta.new_location) {
                            // LEGACY FALLBACK (pre-MAINT-P0.2, kept as-is): no structured
                            // 'new_status' was supplied - either an older mock/save that
                            // predates the enum field, or the model omitted it. Fall back
                            // to free-text parsing of 'reason'. A delta that carries
                            // `new_location` alone is a relocation and never takes this
                            // path (see isDeathClaimDelta).
                            //
                            // STOPGAP (full enum redesign tracked separately): the AI's free-text
                            // 'reason' is matched against natural death phrasings ("has died", "was
                            // killed", "slain", etc.), not just the literal substring "dead". To avoid
                            // false-positive kills on phrasing like "nearly died but survived", any
                            // survival/negation wording nearby suppresses the death match. See
                            // `legacyStatusFromReason` (./legacyStatus.ts - also mirrored by
                            // perception/visibility.ts, and its death test reused by
                            // ai/core/mortality.ts's death-claim detection).
                            const newStatus = delta.reason.toLowerCase();
                            const legacyStatus = legacyStatusFromReason(delta.reason);
                            if (legacyStatus) entity.status = legacyStatus;
                            else if (newStatus.includes('moves to')) {
                                const location = newStatus.replace('moves to ', '').trim();
                                const validLocations = Object.keys(currentWorldState.regions);
                                // A simple check to see if the location is valid before assigning
                                if (validLocations.some(vl => location.toLowerCase().includes(vl.toLowerCase()))) {
                                    entity.location = validLocations.find(vl => location.toLowerCase().includes(vl.toLowerCase())) || entity.location;
                                }
                            }
                        }

                        // STRUCTURED PATH (preferred, MAINT-P0.2): applied after the
                        // status handling above (structured or legacy) so a single delta
                        // can carry both a status change and a location change (e.g.
                        // fleeing into exile). Only exact, known region names are
                        // accepted - unlike the legacy fuzzy substring match above, this
                        // is a direct lookup since the model is expected to echo a real
                        // region name. An unrecognized region leaves location unchanged.
                        if (delta.new_location) {
                            const validLocations = Object.keys(currentWorldState.regions);
                            if (validLocations.includes(delta.new_location)) {
                                entity.location = delta.new_location;
                            }
                        }

                        // GM-PRIVATE secret-survival state (DESIGN_DECISIONS.md D3).
                        // CODE-GENERATED ONLY - this field is never requested from the
                        // model (see types.ts's EventDelta.secret_truth); only
                        // ai/core/mortality.ts::processMortality attaches it, when a
                        // validated NPC death resolves to "presumed dead" on the fate
                        // table. Copying it here (alongside status/location) keeps a
                        // single application point for everything a 'status' delta can
                        // carry.
                        //
                        // A secret survival belongs to the presumed-dead alone (D3), so
                        // any ACTUAL status change that does not carry the pipeline's own
                        // secret_truth ends it: a hidden survivor who returns alive, or a
                        // survivor later confirmed dead on the fate table, is no longer
                        // "secretly alive". An unchanged status (dead -> dead, a
                        // re-declared death the mortality pipeline never rolls) keeps it.
                        if (delta.secret_truth) {
                            entity.secret_truth = delta.secret_truth;
                        } else if (entity.status !== previousStatus) {
                            delete entity.secret_truth;
                        }
                    }
                    break;
                }
                case 'region': {
                    const [regionName, property] = delta.key.split(':');
                    if(updatedWorldState.regions[regionName] && property === 'stability') {
                        updatedWorldState.regions[regionName].stability = delta.reason;
                    }
                    break;
                }
                case 'world': {
                    // 'world' (D6/Phase 2, types.ts's EventDeltaTypeEnum doc
                    // comment): changes a top-level WorldState macro field -
                    // 'key' is 'economic_stability' or 'political_climate',
                    // 'reason' is the new string value. This is the delta type
                    // that unfreezes the Header meters, which already render
                    // these two fields but previously had no delta case that
                    // could ever change them. Unknown keys no-op (with a
                    // console.warn) rather than writing an arbitrary field onto
                    // WorldState - only these two names are part of the
                    // contract.
                    const validWorldKeys = ['economic_stability', 'political_climate'] as const;
                    const isValidWorldKey = (key: string): key is typeof validWorldKeys[number] =>
                        (validWorldKeys as readonly string[]).includes(key);
                    if (isValidWorldKey(delta.key)) {
                        updatedWorldState[delta.key] = delta.reason;
                    } else {
                        console.warn(`Unknown 'world' delta key "${delta.key}" - expected 'economic_stability' or 'political_climate'. No-op.`);
                    }
                    break;
                }
                case 'rumor': {
                    rumorSeq += 1;
                    // TURN PROVENANCE: under applyAdjudication, `turnNumber`
                    // is the App's authoritative counter when the caller
                    // supplies one (PerceptionStampContext.turnNumber), else
                    // the model-echoed `adjudication.turn`. The GM console
                    // and the Reports tab read these stamps as-is; the player
                    // knowledge store stamps its claim updates with the
                    // authoritative turn itself (knowledge/commit.ts).
                    const newReport: Report = {
                        id: `report_${turnNumber}_${Date.now()}_${rumorSeq}`,
                        turn: turnNumber,
                        source: 'rumor',
                        about: delta.key, // entity or region id
                        claim: delta.reason,
                        credibility: Math.max(0.0, Math.min(1.0, delta.delta))
                    };
                    // D29 NON-private categorization: `topic` keeps distinct
                    // matters about one subject on distinct knowledge claims,
                    // `stance` carries a counterplay follow-up's corroborate/
                    // contradict relation. Copied field by field (never
                    // spread) so the GM-private is_true/origin_id on the delta
                    // can never ride onto the player-facing Report.
                    if (typeof delta.topic === 'string' && delta.topic.trim().length > 0) {
                        newReport.topic = delta.topic;
                    }
                    if (delta.stance === 'corroborates' || delta.stance === 'contradicts') {
                        newReport.stance = delta.stance;
                    }
                    newReports.push(newReport);

                    // GM-PRIVATE truth ledger (DESIGN_DECISIONS.md D11): every
                    // rumor is recorded with its actual truth disposition,
                    // alongside the Report the player sees. The adjudication
                    // prompt demands `is_true` on every rumor delta; when the
                    // model omits it anyway, the entry defaults to true and is
                    // flagged `assumed` so the GM console can surface the
                    // failure - the engine never invents a lie on its own.
                    const hasDisposition = typeof delta.is_true === 'boolean';
                    const ledgerEntry: TruthLedgerEntry = {
                        id: `truth_${turnNumber}_${Date.now()}_${rumorSeq}`,
                        turn: turnNumber,
                        claim: delta.reason,
                        aboutId: delta.key,
                        isTrue: hasDisposition ? delta.is_true as boolean : true,
                        reportId: newReport.id,
                    };
                    if (typeof delta.origin_id === 'string' && delta.origin_id.length > 0) {
                        ledgerEntry.originId = delta.origin_id;
                    }
                    if (!hasDisposition) {
                        ledgerEntry.assumed = true;
                    }
                    newTruthLedgerEntries.push(ledgerEntry);
                    break;
                }
                case 'scheme': {
                    const entity = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entity) {
                        let parsed: unknown;
                        try {
                            parsed = JSON.parse(delta.reason);
                        } catch {
                            console.error(`Failed to parse scheme JSON for ${delta.key}:`, delta.reason);
                            break;
                        }
                        // The model-authored scheme replaces active_scheme
                        // wholesale, so it must BE a scheme: a parseable
                        // object of the wrong shape (a 'plan' instead of
                        // 'steps', a bare string) would otherwise persist and
                        // break every later consumer that walks its steps.
                        // Refused and recorded; the standing scheme stays.
                        const scheme = zScheme.safeParse(parsed);
                        if (scheme.success) {
                            entity.active_scheme = scheme.data;
                        } else {
                            gmNotes.push(`[Engine] Refused a 'scheme' delta for '${delta.key}' - its reason is not a complete scheme (name, overall_goal, steps); the standing scheme was kept.`);
                        }
                    }
                    break;
                }
                case 'add_region': {
                    try {
                        const newRegionState = JSON.parse(delta.reason);
                        updatedWorldState.regions[delta.key] = newRegionState;
                    } catch {
                        console.error(`Failed to parse RegionState JSON for ${delta.key}:`, delta.reason);
                    }
                    break;
                }
                case 'remove_region': {
                    if (updatedWorldState.regions[delta.key]) {
                        delete updatedWorldState.regions[delta.key];
                    }
                    break;
                }
                case 'faction': {
                    const entityToMove = updatedEntities.find(e => e.entity_id === delta.key);
                    if (entityToMove) {
                        const oldFactionId = entityToMove.faction_id;
                        const newFactionId = delta.reason === 'null' ? undefined : delta.reason;

                        // Remove from old faction's member list
                        if (oldFactionId) {
                            const oldFaction = updatedEntities.find(e => e.entity_id === oldFactionId);
                            if (oldFaction && oldFaction.faction_members) {
                                oldFaction.faction_members = oldFaction.faction_members.filter(id => id !== entityToMove.entity_id);
                            }
                        }

                        // Add to new faction's member list and update entity's faction_id
                        entityToMove.faction_id = newFactionId;
                        if (newFactionId) {
                            const newFaction = updatedEntities.find(e => e.entity_id === newFactionId);
                            if (newFaction && newFaction.faction_members) {
                                if (!newFaction.faction_members.includes(entityToMove.entity_id)) {
                                    newFaction.faction_members.push(entityToMove.entity_id);
                                }
                            }
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error("Error applying delta:", delta, e);
        }
    });

    return { updatedEntities, updatedWorldState, newReports, newTruthLedgerEntries, gmNotes };
}

/**
 * Appends fresh truth-ledger entries onto the existing ledger, dropping the
 * oldest entries past MAX_TRUTH_LEDGER_ENTRIES. Pure - returns a new array
 * (or the input reference when there is nothing to append).
 */
export function appendTruthLedgerEntries(
    currentTruthLedger: TruthLedgerEntry[],
    newEntries: TruthLedgerEntry[]
): TruthLedgerEntry[] {
    if (newEntries.length === 0) return currentTruthLedger;
    const combined = [...currentTruthLedger, ...newEntries];
    if (combined.length > MAX_TRUTH_LEDGER_ENTRIES) {
        return combined.slice(combined.length - MAX_TRUTH_LEDGER_ENTRIES);
    }
    return combined;
}


/**
 * Inputs bounding the perception-grounded memory stamp in
 * applyAdjudication. Both fields optional so pre-existing call sites keep
 * working: with no playerEntityId, no viewer is excluded; with no
 * spotlightIds, selection falls back to delta-involvement then roster
 * order (perception/npcPerception.ts::selectPerceivingNpcs).
 */
export interface PerceptionStampContext {
    /**
     * The player's entity id - ALWAYS excluded from the perceiving loop.
     * Player-side knowledge lives in the D21 knowledge store
     * (knowledge/store.ts), never in Entity.memories stamping. Also the
     * only entity whose treasury crossings mint Reports (applyDeltas'
     * `playerEntityId`, D6): absent, no treasury Report is minted.
     */
    playerEntityId?: string;
    /** Spotlight entity ids, first in line for the bounded perceiving set. */
    spotlightIds?: string[];
    /**
     * The App's AUTHORITATIVE turn counter for the turn being applied
     * (threaded from runNewTurn, which receives it from App.tsx). Used for
     * the memory stamps' and the new Reports' and truth-ledger entries'
     * `turn` INSTEAD of the model-echoed `adjudication.turn`: a model that
     * mislabels its turn must not skew provenance (the same rule
     * knowledge/commit.ts states for the player-side knowledge stamps), and
     * the Reports tab prints Report.turn beside those knowledge stamps.
     * Optional so legacy call sites keep working; absent, the stamps fall
     * back to `adjudication.turn` - the pre-existing behavior.
     */
    turnNumber?: number;
}

export function applyAdjudication(
    adjudication: Adjudication,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    currentReports: Report[],
    // Optional so pre-ledger call sites keep working; they receive the
    // fresh entries appended onto an empty ledger.
    currentTruthLedger: TruthLedgerEntry[] = [],
    perceptionContext: PerceptionStampContext = {}
): { updatedEntities: Entity[], updatedWorldState: WorldState, updatedReports: Report[], updatedTruthLedger: TruthLedgerEntry[], perceivingNpcIds: string[] } {

    // Every stamp this turn writes - Report, truth-ledger entry, memory - uses
    // the AUTHORITATIVE turn counter when the caller provides one (see
    // PerceptionStampContext.turnNumber), never trusting the model-echoed
    // `adjudication.turn` for provenance when the real counter is available.
    const stampTurn = perceptionContext.turnNumber ?? adjudication.turn;
    const { updatedEntities, updatedWorldState, newReports, newTruthLedgerEntries, gmNotes } = applyDeltas(
        adjudication.deltas, currentEntities, currentWorldState, stampTurn, perceptionContext.playerEntityId
    );
    adjudication.gm_private.push(...gmNotes);
    let entitiesAfterDeltas = updatedEntities;
    const updatedReports = [...currentReports, ...newReports];
    const updatedTruthLedger = appendTruthLedgerEntries(currentTruthLedger, newTruthLedgerEntries);

    // Perception-grounded memory stamp (D5 generalized to any viewer, D10):
    // each perceiving entity remembers ONLY what its own vantage point
    // admits - witnessed at its location, its own shifts, heard through its
    // visibility_network, or public news. An entity distant and unnetworked
    // from an event holds NO memory of it. Classification runs against the
    // post-delta roster/world so this turn's arrivals and region changes
    // count, exactly as the player-side digest classifies (App.tsx). The
    // per-viewer digests are derived here and discarded (never persisted);
    // only the bounded memory entries and the perceiving-id list leave this
    // function.
    const perceivers = selectPerceivingNpcs(
        entitiesAfterDeltas,
        perceptionContext.playerEntityId,
        perceptionContext.spotlightIds ?? [],
        adjudication.deltas
    );
    const npcPerceptions = buildNpcPerceptions(adjudication.deltas, perceivers, entitiesAfterDeltas, updatedWorldState, currentEntities);
    npcPerceptions.forEach(perception => {
        const entity = entitiesAfterDeltas.find(e => e.entity_id === perception.entityId);
        if (!entity) return;
        selectMemoryChanges(perception.changes).forEach(change => {
            entity.memories.push({
                turn: stampTurn,
                event_description: change.text,
                emotional_impact: "Notable",
                // The digest's subject id, when it names another roster
                // entity - the viewer themself is implicit, and region/world
                // subjects are not entities.
                involved_entities:
                    change.subject !== entity.entity_id &&
                    entitiesAfterDeltas.some(e => e.entity_id === change.subject)
                        ? [change.subject]
                        : []
            });
        });
        // Bounded at the write site: drop the oldest past
        // MAX_ENTITY_MEMORIES. An over-long list from a save written
        // before the bound is trimmed too, but only when this entity
        // gains a new memory - untouched entities keep their legacy
        // length.
        if (entity.memories.length > MAX_ENTITY_MEMORIES) {
            entity.memories.splice(0, entity.memories.length - MAX_ENTITY_MEMORIES);
        }
    });

    // Handle entity additions and removals
    if (adjudication.remove_entities && adjudication.remove_entities.length > 0) {
        // D1/D2: the player's own entity may leave play ONLY through the
        // mortality pipeline (validation + death save + GAME_OVER), never a
        // raw remove_entities - dropping it here would blank the player's
        // dossier with no game-over or epilogue. Guard the player's id out;
        // if a response names it, record the refusal for the GM console.
        const playerId = perceptionContext.playerEntityId;
        if (playerId && adjudication.remove_entities.includes(playerId)) {
            adjudication.gm_private.push(`[Engine] Refused to remove the player entity '${playerId}' via remove_entities - player exit belongs to the mortality pipeline alone.`);
        }
        const idsToRemove = new Set(adjudication.remove_entities.filter(id => id !== playerId));
        entitiesAfterDeltas = entitiesAfterDeltas.filter(e => !idsToRemove.has(e.entity_id));
        
        // Clean up dangling relationships
        entitiesAfterDeltas.forEach(entity => {
            for (const removedId of idsToRemove) {
                if (entity.relationships[removedId]) {
                    delete entity.relationships[removedId];
                }
            }
        });
    }

    if (adjudication.add_entities && adjudication.add_entities.length > 0) {
        // `add_entities` is the CREATION channel and deltas are the MUTATION
        // channel - the adjudication prompt says exactly that ("To add an
        // entity, use the 'add_entities' field"; every change to an entity
        // already in play is a delta). An add naming an id already on the
        // roster is therefore a malformed instruction, and this function's
        // established answer to a malformed instruction is refuse-and-record
        // (see the player-removal guard just above): the STANDING record is
        // kept unchanged, the incoming record is dropped, and the refusal is
        // written to `gm_private` for the GM console. Never an overwrite - a
        // duplicate id would otherwise trade the entity's accumulated
        // `relationships`, the `memories` stamped a few lines above, and its
        // `active_scheme` for a blank template, losing simulation state that
        // cannot be recovered.
        //
        // Deliberate REPLACEMENT keeps working untouched: `remove_entities`
        // is processed in the block above, BEFORE this one, so a remove+add
        // of the same id within one adjudication meets an empty seat here -
        // it replaces the record and emits no refusal.
        //
        // Duplicates WITHIN a single batch collide by the same rule (the id
        // is claimed as it is added), so `[a, a]` adds one entity and records
        // one refusal. Mock Mode replays one canned roster addition every
        // turn (ai/mocks.ts), which is precisely this path - without the
        // guard a playthrough accumulated a duplicate entity, and a duplicate
        // React key, per turn.
        const takenIds = new Set(entitiesAfterDeltas.map(e => e.entity_id));
        adjudication.add_entities.forEach(entity => {
            if (takenIds.has(entity.entity_id)) {
                adjudication.gm_private.push(`[Engine] Refused to add entity '${entity.entity_id}' via add_entities - that id is already on the roster; add_entities creates, deltas change what already exists.`);
                return;
            }
            takenIds.add(entity.entity_id);
            entitiesAfterDeltas.push(entity);
        });
    }

    return {
        updatedEntities: entitiesAfterDeltas,
        updatedWorldState,
        updatedReports,
        updatedTruthLedger,
        perceivingNpcIds: perceivers.map(e => e.entity_id),
    };
}
