import React from 'react';
import { TurnHistoryEntry } from '../../types';
import { well, lbl, DIM } from './shared';
import { PlayerIntentView } from './PlayerIntentView';

export const SummaryView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => (
    <>
        <div style={well}>
            <span style={lbl}>Player Intent</span>
            <PlayerIntentView entry={entry} />
        </div>
        <div style={well}>
            <span style={lbl}>Generated Narration</span>
            <div style={{ marginTop: 4, fontSize: 15, fontStyle: 'italic', color: DIM }}>{entry.narration || 'No narration generated.'}</div>
        </div>
    </>
);
