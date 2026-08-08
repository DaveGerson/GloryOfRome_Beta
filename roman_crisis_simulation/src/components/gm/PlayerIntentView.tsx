import React from 'react';
import { TurnHistoryEntry } from '../../types';
import { structuredSubmissionForHistory, TurnSubmissionHistory } from '../TurnSubmissionHistory';

export const PlayerIntentView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const structuredSubmission = structuredSubmissionForHistory(entry.playerIntent);
    return structuredSubmission ? (
        <TurnSubmissionHistory submission={structuredSubmission} audience="gm" />
    ) : (
        <div style={{ marginTop: 4, fontSize: 15 }}>“{entry.playerIntent}”</div>
    );
};
