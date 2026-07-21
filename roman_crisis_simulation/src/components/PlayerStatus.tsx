import React from 'react';
import { Entity } from '../types';
import InfoTooltip from './InfoTooltip';

/**
 * The player's own dossier header atop the side panel — name in epic type,
 * position and location, current goal and state, under a gold dentil rule.
 */
const PlayerStatus: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    if (!playerEntity) return null;

    const narrativeSnippet = playerEntity.current_state_narrative.split('.').slice(0, 2).join('.') + '.';

    return (
        <div style={{ flex: 'none', padding: '14px 16px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--dentil) left bottom/100% 3px no-repeat, linear-gradient(180deg,rgba(201,162,39,.12),rgba(201,162,39,0))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 19, color: 'var(--tyrian-600)' }}>{playerEntity.name}</span>
            </div>
            <div style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', marginTop: 2 }}>
                {playerEntity.position || playerEntity.entity_type} · {playerEntity.location}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="gor-label">Current Goal<InfoTooltip text="Your character's most immediate objective. Pursue this or forge your own path." /></span>
                <span style={{ fontSize: 15, fontStyle: 'italic' }}>{playerEntity.short_term_goals[0] || 'Survive the week.'}</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="gor-label">Current State<InfoTooltip text="Your character's current emotional and physical state, which influences their thoughts." /></span>
                <span style={{ fontSize: 14 }}>{narrativeSnippet}</span>
            </div>
        </div>
    );
};

export default PlayerStatus;
