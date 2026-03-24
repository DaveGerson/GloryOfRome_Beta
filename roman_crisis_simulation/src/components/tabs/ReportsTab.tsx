import React from 'react';
import { Report } from '../../types';

const CredibilityBadge: React.FC<{ credibility: number }> = ({ credibility }) => {
    const percentage = credibility * 100;
    let color = 'bg-yellow-600';
    let text = 'Uncertain';
    if (credibility > 0.7) { color = 'bg-green-700'; text = 'Credible'; }
    else if (credibility < 0.4) { color = 'bg-red-800'; text = 'Dubious'; }
    
    return <span className={`text-white text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{text} ({percentage.toFixed(0)}%)</span>;
}

const ReportsTab: React.FC<{ reports: Report[] }> = ({ reports }) => (
    <div className="p-4 space-y-3">
        <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Intelligence Reports</h3>
        {reports.length === 0 && <p className="text-stone-600">No intelligence reports have been received.</p>}
        {reports.slice().reverse().map(report => (
            <div key={report.id} className="roman-stone-panel p-3 rounded-sm">
                <div className="flex justify-between items-start">
                    <div className="pr-4">
                        <p className="text-sm text-stone-700"><strong>Turn {report.turn}:</strong> "{report.claim}"</p>
                        <p className="text-xs text-stone-500 mt-1">Source: {report.source} | About: {report.about.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="flex-shrink-0">
                        <CredibilityBadge credibility={report.credibility} />
                    </div>
                </div>
            </div>
        ))}
    </div>
);

export default ReportsTab;
