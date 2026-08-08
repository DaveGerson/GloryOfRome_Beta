import React from 'react';
import { Adjudication } from '../../types';
import { redacted, GmNote, DIM } from './shared';

export const PrivateView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <>
        {adjudication.gm_private.length > 0 ? (
            adjudication.gm_private.map((note, index) => (
                <div key={index} style={{ ...redacted, fontStyle: 'italic', fontSize: 14, color: DIM }}>“{note}”</div>
            ))
        ) : (
            <GmNote>No private GM notes for this turn.</GmNote>
        )}
    </>
);
