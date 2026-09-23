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
        <div className="gor-dossier-head">
            <div className="gor-dossier-head-row">
                <span className="gor-dossier-name">{playerEntity.name}</span>
            </div>
            <div className="gor-dossier-post">
                {playerEntity.position || playerEntity.entity_type} · {playerEntity.location}
            </div>
            <div className="gor-dossier-field">
                <span className="gor-label">Current Goal<InfoTooltip text="Your character's most immediate objective. Pursue this or forge your own path." /></span>
                <span className="gor-dossier-goal">{playerEntity.short_term_goals[0] || 'Survive the week.'}</span>
            </div>
            <div className="gor-dossier-field">
                <span className="gor-label">Current State<InfoTooltip text="Your character's current emotional and physical state, which influences their thoughts." /></span>
                <span className="gor-dossier-state">{narrativeSnippet}</span>
            </div>
        </div>
    );
};

export default PlayerStatus;
