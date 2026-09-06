import React from 'react';
import { Entity } from '../types';
import InfoTooltip from './InfoTooltip';

/**
 * The player's own dossier header atop the side panel — name in epic type,
 * position and location beside it, then the goal and the present state as a
 * two-column register under a gold dentil rule.
 *
 * Compact since the September 2026 design pass: it used to stack five rows
 * and ~230px above the tab bar, so the intelligence the player came to read
 * started a third of the way down the panel. The facts are now a labelled
 * grid (label column, value column), the state clamps to three lines with
 * the full text on the `title`, and the whole card sits at ~120px. Layout
 * in design/components.css (`.gor-dossier*`).
 */
const PlayerStatus: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    if (!playerEntity) return null;

    const narrativeSnippet = playerEntity.current_state_narrative.split('.').slice(0, 2).join('.') + '.';

    return (
        <div className="gor-dossier">
            <div className="gor-dossier-name-row">
                <span className="gor-dossier-name">{playerEntity.name}</span>
                <span className="gor-dossier-where">{playerEntity.position || playerEntity.entity_type} · {playerEntity.location}</span>
            </div>
            <dl className="gor-dossier-facts">
                <div className="gor-dossier-fact">
                    <dt className="gor-label">Goal<InfoTooltip text="Your character's most immediate objective. Pursue this or forge your own path." /></dt>
                    <dd className="gor-dossier-goal">{playerEntity.short_term_goals[0] || 'Survive the week.'}</dd>
                </div>
                <div className="gor-dossier-fact">
                    <dt className="gor-label">State<InfoTooltip text="Your character's current emotional and physical state, which influences their thoughts." /></dt>
                    <dd className="gor-dossier-state" title={playerEntity.current_state_narrative}>{narrativeSnippet}</dd>
                </div>
            </dl>
        </div>
    );
};

export default PlayerStatus;
