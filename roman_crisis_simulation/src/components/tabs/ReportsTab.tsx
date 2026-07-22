import React from 'react';
import { Report } from '../../types';
import { Card, Badge } from '../ui/Core';
import { reportReliability } from '../../knowledge/credibilityFraming';

// D25/D26: the player never sees a credibility NUMBER. Trust is conveyed by
// the SOURCE and how that source frames its own certainty (derived in the
// pure helper reportReliability); the raw figure stays in the GM console.
const ReportsTab: React.FC<{ reports: Report[] }> = ({ reports }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Intelligence Reports</h3>
        {reports.length === 0 && <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>No intelligence reports have been received.</p>}
        {reports.slice().reverse().map(report => {
            const { tone, badgeWord, phrase } = reportReliability(report);
            return (
                <Card key={report.id} title={`Turn ${report.turn}`} action={<Badge tone={tone}>{badgeWord}</Badge>}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 15 }}>“{report.claim}”</span>
                        <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>{phrase}</span>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Concerning: {report.about.replace(/_/g, ' ')}</span>
                    </div>
                </Card>
            );
        })}
    </div>
);

export default ReportsTab;
