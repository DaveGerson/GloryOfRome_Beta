import React from 'react';
import { TurnHistoryEntry, WorldState } from '../../types';
import { classifyDelta } from '../../perception/visibility';
import { well, lbl, GmNote, DIM, PARCH, RED, GREEN, MONO } from './shared';

/**
 * The Ground Truth tuning view (D7 + Phase 2 item 4). Puts the two sides
 * side by side deliberately: every delta this turn, and what classifyDelta
 * (the same function the player-facing digest/WorldStateTab use) would have
 * let through for the current player character - so filter rules can be
 * tuned by eyeballing the diff.
 *
 * Also surfaces `mortalityTrace` off the turn history entry, if present.
 */
export const GroundTruthView: React.FC<{
    entry: TurnHistoryEntry;
    playerCharacterId: string | null;
    worldState: WorldState;
}> = ({ entry, playerCharacterId, worldState }) => {
    // Older entries may lack their entity snapshot (only the most recent
    // KEEP_FULL_SNAPSHOTS entries retain one - state/gameReducer.ts); the
    // per-delta classification needs the turn's own roster, so without it
    // this view can only say so.
    const snapshotEntities = entry.postTurnEntities;
    const playerAtTurn = snapshotEntities?.find(e => e.entity_id === playerCharacterId) ?? null;
    const mortalityTrace = entry.mortalityTrace;

    return (
        <>
            <div>
                <span style={lbl}>Unfiltered Deltas vs. Perception Filter</span>
                <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                    Left: raw ground truth for this turn. Right: what perception/visibility.ts's classifyDelta lets{' '}
                    {playerAtTurn ? <span style={{ color: PARCH }}>{playerAtTurn.name}</span> : 'the player'} perceive.
                </p>
                {!snapshotEntities ? (
                    <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the perception classification needs the turn's own roster.</GmNote>
                ) : !playerAtTurn ? (
                    <GmNote>No player character to classify against for this turn.</GmNote>
                ) : entry.adjudication.deltas.length === 0 ? (
                    <GmNote>No deltas were recorded this turn.</GmNote>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {entry.adjudication.deltas.map((delta, index) => {
                            const visibility = classifyDelta(delta, playerAtTurn, snapshotEntities, worldState);
                            return (
                                <div key={index} style={{ ...well, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                                    <div>
                                        <span style={{ ...lbl, color: RED }}>{delta.type}</span> <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>({delta.key})</span>
                                        <div style={{ fontStyle: 'italic', color: DIM, marginTop: 3 }}>“{delta.reason}”</div>
                                    </div>
                                    <div style={{ alignSelf: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: visibility.visible ? GREEN : 'rgba(169,154,118,.45)' }}>
                                        {visibility.visible ? `VISIBLE — ${visibility.source}` : 'FILTERED (invisible to player)'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <div>
                <span style={lbl}>Turn Seed</span>
                <p style={{ fontSize: 13, margin: '4px 0 0', fontFamily: MONO, color: typeof entry.turnSeed === 'number' ? PARCH : DIM }}>
                    {typeof entry.turnSeed === 'number'
                        ? `${entry.turnSeed} — replays this turn's hidden rolls in draw order (action roll, then mortality rolls).`
                        : 'None recorded for this turn.'}
                </p>
            </div>
            <div>
                <span style={lbl}>Mortality Trace</span>
                {mortalityTrace ? (
                    <pre style={{ ...well, fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 6, color: PARCH }}>{JSON.stringify(mortalityTrace, null, 2)}</pre>
                ) : (
                    <p style={{ fontSize: 13, color: DIM, margin: '4px 0 0' }}>No mortality trace recorded for this turn — nothing triggered the Fates' scales.</p>
                )}
            </div>
        </>
    );
};
