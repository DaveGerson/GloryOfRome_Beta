import React, { useState } from 'react';
import { Entity } from '../types';
import InfoTooltip from './InfoTooltip';
import { getDossierFolded, setDossierFolded } from '../persistence/readingPrefs';

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const PLAYER_STATUS_COPY = {
    fold: 'Your goal and state',
} as const;

const DETAILS_ID = 'gor-dossier-details';

/**
 * The player's own dossier header atop the side panel — name in epic type,
 * position and location, current goal and state, under a gold dentil rule.
 *
 * It folds to its name line (the chevron, `aria-expanded`), handing the
 * height to the registers below; the fold is a device preference
 * (persistence/readingPrefs.ts), so it stays folded across weeks and reloads.
 */
const PlayerStatus: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    const [folded, setFolded] = useState<boolean>(() => getDossierFolded());
    if (!playerEntity) return null;

    const narrativeSnippet = playerEntity.current_state_narrative.split('.').slice(0, 2).join('.') + '.';
    const toggle = () => {
        setFolded(!folded);
        setDossierFolded(!folded);
    };

    return (
        <div className={`gor-dossier-head${folded ? ' gor-dossier-head-folded' : ''}`}>
            <div className="gor-dossier-head-row">
                <span className="gor-dossier-name">{playerEntity.name}</span>
                <button
                    type="button"
                    className="gor-dossier-fold"
                    aria-expanded={!folded}
                    aria-controls={DETAILS_ID}
                    aria-label={PLAYER_STATUS_COPY.fold}
                    onClick={toggle}
                ><span aria-hidden="true">▾</span></button>
            </div>
            <div className="gor-dossier-post">
                {playerEntity.position || playerEntity.entity_type} · {playerEntity.location}
            </div>
            <div id={DETAILS_ID} hidden={folded}>
                <div className="gor-dossier-field">
                    <span className="gor-label">Current Goal<InfoTooltip text="Your character's most immediate objective. Pursue this or forge your own path." /></span>
                    <span className="gor-dossier-goal">{playerEntity.short_term_goals[0] || 'Survive the week.'}</span>
                </div>
                <div className="gor-dossier-field">
                    <span className="gor-label">Current State<InfoTooltip text="Your character's current emotional and physical state, which influences their thoughts." /></span>
                    <span className="gor-dossier-state">{narrativeSnippet}</span>
                </div>
            </div>
        </div>
    );
};

export default PlayerStatus;
