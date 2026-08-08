import React from 'react';
import { TurnHistoryEntry, Adjudication, Entity, Relationship } from '../../types';
import { well, lbl, GmNote, GOLD, DIM, PARCH, RED, GREEN, MONO } from './shared';
import { SchemeLine } from './SchemeLine';
import { EntityStatesView } from './EntityStatesView';

/**
 * One relationship axis as a centre-zero bar. GM-side only: these four values
 * are ground truth on `Entity.relationships` and never reach a player surface
 * (the player's relationship knowledge is sourced prose observations with no
 * scores at all — see components/tabs/RelationshipObservations.tsx).
 *
 * Signed axes (trust, respect) run -10…10 across the whole track. Unsigned
 * ones (threat, dependency) have no negative half, so 0…10 fills rightward
 * from the same centre tick — how far past neutral, not a false symmetry.
 */
const RelationshipAxis: React.FC<{ label: string; value: number; signed: boolean }> = ({ label, value, signed }) => {
    const span = signed ? Math.max(-10, Math.min(10, value)) / 10 : Math.max(0, Math.min(10, value)) / 10;
    const width = Math.abs(span) * 50;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 30px', gap: 8, alignItems: 'center' }}>
            <span style={{ ...lbl, fontSize: 9.5, letterSpacing: '.12em' }}>{label}</span>
            <span style={{ position: 'relative', display: 'block', height: 7, background: 'rgba(0,0,0,.45)', border: '1px solid rgba(201,162,39,.2)' }}>
                <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(201,162,39,.55)' }} />
                <span
                    aria-hidden="true"
                    style={{
                        position: 'absolute', top: 0, bottom: 0, width: `${width}%`,
                        ...(span < 0 ? { right: '50%' } : { left: '50%' }),
                        background: span < 0 ? 'var(--metal-crimson)' : 'var(--metal-gold)',
                    }}
                />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: PARCH, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
};

/** The entity ids a turn's deltas actually touch — delta keys are colon-joined
 *  segments (`entityId:attr`, `aId:bId:attr`, `region:…`), so this resolves
 *  each segment against the turn's own roster rather than matching substrings. */
function movedEntityIds(adjudication: Adjudication, roster: Entity[]): string[] {
    const known = new Set(roster.map(entity => entity.entity_id));
    const moved = new Set<string>();
    for (const delta of adjudication.deltas) {
        for (const segment of delta.key.split(':')) {
            if (known.has(segment)) moved.add(segment);
        }
    }
    for (const action of adjudication.entityActions) {
        if (known.has(action.id)) moved.add(action.id);
    }
    return [...moved];
}

/**
 * What changed, in one turn — the ledger on the left, who moved on the right.
 * Entity States and Deltas were two answers to the same question (audit item
 * 31), so they read as one pane.
 */
export const WhatChangedView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const adjudication = entry.adjudication;
    const roster = entry.postTurnEntities;
    const moved = roster ? movedEntityIds(adjudication, roster) : [];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...lbl, color: GOLD }}>The ledger</span>
                {adjudication.deltas.length === 0 ? (
                    <GmNote>No state deltas were recorded.</GmNote>
                ) : adjudication.deltas.map((delta, index) => (
                    <div key={index} style={{ ...well, display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px' }}>
                        <span style={{ ...lbl, color: RED }}>{delta.type}</span>
                        <span style={{ fontFamily: MONO, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: delta.delta > 0 ? GREEN : delta.delta < 0 ? RED : DIM }}>
                            {delta.delta > 0 ? `+${delta.delta}` : delta.delta}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: PARCH, gridColumn: '1 / -1', wordBreak: 'break-word' }}>{delta.key}</span>
                        {delta.new_status && (
                            <span style={{ fontFamily: MONO, fontSize: 12, color: RED, gridColumn: '1 / -1' }}>→ {delta.new_status}{delta.new_location ? ` · ${delta.new_location}` : ''}</span>
                        )}
                        <span style={{ fontSize: 13, fontStyle: 'italic', color: DIM, gridColumn: '1 / -1' }}>“{delta.reason}”</span>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...lbl, color: GOLD }}>Who moved</span>
                {!roster ? (
                    <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one.</GmNote>
                ) : moved.length === 0 ? (
                    <GmNote>No entity was touched by this turn's deltas.</GmNote>
                ) : moved.map(entityId => {
                    const entity = roster.find(e => e.entity_id === entityId);
                    if (!entity) return null;
                    const relationships = Object.entries(entity.relationships).filter(([, rel]) => rel) as [string, Relationship][];
                    return (
                        <div key={entityId} style={well}>
                            <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{entity.name}</span>

                            <span style={{ color: DIM, fontSize: 13 }}> — {entity.status} · {entity.location}</span>
                            {entity.active_scheme && <div style={{ fontSize: 13, marginTop: 6 }}><SchemeLine scheme={entity.active_scheme} /></div>}
                            {relationships.map(([targetId, rel]) => (
                                <div key={targetId} style={{ marginTop: 8, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{roster.find(e => e.entity_id === targetId)?.name || targetId}</span>
                                    <RelationshipAxis label="Trust" value={rel.trust_level} signed />
                                    <RelationshipAxis label="Threat" value={rel.perceived_threat ?? 0} signed={false} />
                                    <RelationshipAxis label="Respect" value={rel.respect_level ?? 0} signed />
                                    <RelationshipAxis label="Depend." value={rel.dependency_level ?? 0} signed={false} />
                                </div>
                            ))}
                        </div>
                    );
                })}
                {/* The whole roster is still one click away — merging the two
                    tabs must not cost a GM the full post-turn state. */}
                {roster && (
                    <details style={{ ...well, marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', color: GOLD, fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Full roster after this turn</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                            <EntityStatesView entities={roster} />
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
};
