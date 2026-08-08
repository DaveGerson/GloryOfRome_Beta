import React from 'react';
import { Entity, Relationship, Memory } from '../../types';
import { well, DIM, PARCH, RED, MONO } from './shared';
import { SchemeLine } from './SchemeLine';

export const EntityStatesView: React.FC<{ entities: Entity[] }> = ({ entities }) => (
    <>
        {entities.map(entity => (
            <div key={entity.entity_id} style={well}>
                <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{entity.name}</span>
                <span style={{ color: DIM, fontSize: 13 }}> — {entity.position || entity.entity_type}</span>
                <div style={{ fontSize: 13, color: PARCH, marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                    <span><strong style={{ color: DIM }}>Status:</strong> {entity.status} · {entity.location}</span>
                    <span><strong style={{ color: DIM }}>Resources:</strong> {Object.entries(entity.resources).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.length + ' item(s)' : v}`).join(' · ') || '—'}</span>
                    {entity.personality && (
                        <span><strong style={{ color: DIM }}>Personality:</strong> {Object.entries(entity.personality).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                    )}
                    {entity.skills && (
                        <span><strong style={{ color: DIM }}>Skills:</strong> {Object.entries(entity.skills).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                    )}
                </div>
                {entity.active_scheme && (
                    <div style={{ fontSize: 13, marginTop: 6 }}><SchemeLine scheme={entity.active_scheme} /></div>
                )}
                {((entity.beliefs && entity.beliefs.length > 0) || (entity.secrets && entity.secrets.length > 0)) && (
                    <div style={{ fontSize: 13, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                        {entity.beliefs && entity.beliefs.length > 0 && (
                            <span><strong style={{ color: DIM }}>Beliefs:</strong> {entity.beliefs.join(' · ')}</span>
                        )}
                        {entity.secrets && entity.secrets.length > 0 && (
                            <span><strong style={{ color: DIM }}>Secrets:</strong> {entity.secrets.join(' · ')}</span>
                        )}
                    </div>
                )}
                {entity.memories && entity.memories.length > 0 && (
                    <div style={{ fontSize: 13, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6 }}>
                        <strong style={{ color: DIM }}>Recent memories:</strong>{' '}
                        {entity.memories.slice(-3).reverse().map((memory: Memory, i: number) => (
                            <span key={i}>{i > 0 && ' · '}T{memory.turn}: {memory.event_description}</span>
                        ))}
                    </div>
                )}
                <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, color: PARCH }}>
                    <strong style={{ color: DIM, fontFamily: 'inherit' }}>Rel:</strong>{' '}
                    {Object.entries(entity.relationships).filter(([, rel]) => rel).map(([targetId, rel]: [string, Relationship], i) => {
                        const targetName = entities.find(e => e.entity_id === targetId)?.name || targetId;
                        return <span key={targetId}>{i > 0 && ' · '}{targetName} T:{rel.trust_level} Th:{rel.perceived_threat ?? 0} A:{rel.ideological_alignment ?? 0} D:{rel.dependency_level ?? 0}</span>;
                    })}
                </div>
            </div>
        ))}
    </>
);
