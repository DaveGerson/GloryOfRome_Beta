import React from 'react';
import { TurnHistoryEntry, WorldState } from '../../types';
import { buildPerceivedDigest } from '../../perception/visibility';
import { well, GmNote, DIM, PARCH, RED, GREEN } from './shared';

/**
 * Per-NPC perception view (D7 + D10): what each of the turn's perceiving
 * NPCs actually witnessed or heard - the instrument for tuning information
 * asymmetry across the whole cast, alongside GroundTruthView's player-side
 * diff. GM-console-only, like everything else on this screen (D4/D5): what
 * an NPC knows is simulation data, not player knowledge.
 *
 * Digests are re-derived at render time from the entry's persisted
 * `perceivingNpcIds` + deltas + entity snapshot (perception/visibility.ts's
 * viewer-agnostic rules); per-NPC digests are never persisted in the save.
 * An id absent from the snapshot (an entity removed later that same turn)
 * is skipped.
 *
 * APPROXIMATION CAVEAT (stated in the UI copy below): the stamp itself ran
 * MID-turn, against mid-apply entity/world state; this view re-derives from
 * the turn's FINAL snapshot (postTurnEntities) and the CURRENT worldState
 * prop, which can differ - same-turn add/remove_entities, regions removed
 * in later turns. The view therefore approximates the stamped lines rather
 * than reproducing them exactly; deliberately not re-plumbed, since the
 * per-NPC digests are derived-and-discarded by design.
 */
export const NpcPerceptionView: React.FC<{
    entry: TurnHistoryEntry;
    worldState: WorldState;
}> = ({ entry, worldState }) => {
    const snapshotEntities = entry.postTurnEntities;
    const perceivingIds = entry.perceivingNpcIds;

    if (!snapshotEntities) {
        return <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the per-NPC perception derivation needs the turn's own roster.</GmNote>;
    }
    if (!perceivingIds) {
        return <GmNote>No perceiving-NPC set recorded for this turn.</GmNote>;
    }
    if (perceivingIds.length === 0) {
        return <GmNote>No NPCs were selected to perceive this turn.</GmNote>;
    }
    return (
        <>
            <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                What each perceiving NPC witnessed or heard this turn - the same viewer-agnostic filter the player's digest runs through, applied from each NPC's own vantage. Re-derived at render time from the turn's final entity snapshot and the current world state, so it APPROXIMATES the lines their memories were stamped from mid-turn: same-turn cast changes or since-removed regions can make it differ from the exact stamped text.
            </p>
            {perceivingIds.map(entityId => {
                const npcRecord = snapshotEntities.find(e => e.entity_id === entityId);
                if (!npcRecord) return null;
                // Defensive default: a legacy-shaped snapshot entity may lack
                // visibility_network, which classifyDelta reads
                // unconditionally - the console must render, not crash.
                const npc = { ...npcRecord, visibility_network: npcRecord.visibility_network ?? [] };
                const changes = buildPerceivedDigest(entry.adjudication.deltas, npc, snapshotEntities, worldState);
                return (
                    <div key={entityId} style={well}>
                        <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{npc.name}</span>
                        <span style={{ color: DIM, fontSize: 13 }}> — {npc.location} · network: {npc.visibility_network.length > 0 ? npc.visibility_network.join(', ') : 'none'}</span>
                        {changes.length === 0 ? (
                            <div style={{ fontSize: 13, fontStyle: 'italic', color: 'rgba(169,154,118,.6)', marginTop: 4 }}>Perceived nothing this turn.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                                {changes.map((change, index) => (
                                    <div key={index} style={{ fontSize: 13, display: 'flex', gap: 10, alignItems: 'baseline' }}>
                                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: GREEN, flex: 'none', width: 74 }}>{change.source}</span>
                                        <span style={{ color: PARCH }}>{change.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
};
