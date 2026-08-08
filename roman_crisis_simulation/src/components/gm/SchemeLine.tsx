import React from 'react';
import { Scheme } from '../../types';
import { DIM } from './shared';

export const SchemeLine: React.FC<{ scheme: Scheme }> = ({ scheme }) => (
    <span>
        <strong style={{ color: DIM }}>Scheme:</strong> <span style={{ color: '#E3C766', fontStyle: 'italic' }}>“{scheme.name}”</span> — {scheme.overall_goal}
        <span style={{ display: 'block', fontSize: 12, color: DIM }}>
            {scheme.steps.map((s, i) => <span key={i}>{i > 0 && ' · '}{s.status}: {s.objective}</span>)}
        </span>
    </span>
);
