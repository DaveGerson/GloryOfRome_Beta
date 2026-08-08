import React from 'react';
import { TruthLedgerEntry, Report } from '../../types';
import { toRoman } from '../ui/Brand';
import { well, lbl, GmNote, GOLD, DIM, PARCH, RED, GREEN, MONO } from './shared';

/**
 * The true-vs-believed view (DESIGN_DECISIONS.md D11 + D7): the GM-private
 * truth ledger, one row per rumor - the claim as the player heard it, the
 * credibility the matching Report presented, and the ACTUAL truth plus
 * origin only this console may show. Campaign-wide (the ledger is a single
 * bounded collection, not per-turn data), newest first. Entries flagged
 * `assumed` mark rumors the adjudicator failed to disposition despite the
 * prompt - defaulted to TRUE, never silently invented as lies.
 */
export const TruthLedgerView: React.FC<{ ledger: TruthLedgerEntry[]; reports: Report[] }> = ({ ledger, reports }) => (
    <>
        {ledger.length === 0 ? (
            <GmNote>No rumors have been recorded in the truth ledger yet.</GmNote>
        ) : (
            ledger.slice().reverse().map(entry => {
                const matchingReport = reports.find(r => r.id === entry.reportId);
                return (
                    <div key={entry.id} style={well}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ ...lbl, color: GOLD }}>Turn {toRoman(entry.turn)}</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: entry.isTrue ? GREEN : RED }}>
                                {entry.isTrue ? 'TRUE' : 'FALSE'}
                            </span>
                            {entry.assumed && (
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: RED }}>
                                    ASSUMED — model omitted the disposition
                                </span>
                            )}
                            <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>
                                player saw: {matchingReport ? `${(matchingReport.credibility * 100).toFixed(0)}% credible` : 'no matching report'}
                            </span>
                        </div>
                        <div style={{ fontSize: 14, fontStyle: 'italic', color: PARCH, marginTop: 4 }}>“{entry.claim}”</div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 4 }}>
                            about: {entry.aboutId} · origin: {entry.originId || 'organic (unattributed)'}
                        </div>
                    </div>
                );
            })
        )}
    </>
);
