import React from 'react';
import { Report } from '../../types';
import { Card, Badge } from '../ui/Core';

/** Credible / Uncertain / Dubious — severity-toned badge with the percentage. */
const credibilityTone = (credibility: number): ['laurel' | 'bronze' | 'crimson', string] =>
    credibility > 0.7 ? ['laurel', 'Credible'] : credibility >= 0.4 ? ['bronze', 'Uncertain'] : ['crimson', 'Dubious'];

const ReportsTab: React.FC<{ reports: Report[] }> = ({ reports }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Intelligence Reports</h3>
        {reports.length === 0 && <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>No intelligence reports have been received.</p>}
        {reports.slice().reverse().map(report => {
            const [tone, word] = credibilityTone(report.credibility);
            return (
                <Card key={report.id} title={`Turn ${report.turn}`} action={<Badge tone={tone}>{word} · {(report.credibility * 100).toFixed(0)}%</Badge>}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 15 }}>“{report.claim}”</span>
                        <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                            Source: {report.source} · Concerning: {report.about.replace(/_/g, ' ')}
                        </span>
                    </div>
                </Card>
            );
        })}
    </div>
);

export default ReportsTab;
