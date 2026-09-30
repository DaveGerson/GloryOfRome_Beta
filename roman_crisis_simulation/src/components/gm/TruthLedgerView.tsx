import React from 'react';
import { TruthLedgerEntry, Report, IntelFindingTruth } from '../../types';
import { toRoman } from '../ui/Brand';
import { well, lbl, GmNote, GOLD, DIM, PARCH, RED, GREEN, MONO } from './shared';

/** A garbled finding is neither: half-true, one element distorted (D47). */
const BRONZE = '#D9A45F';

const STANDING_LABEL: Record<IntelFindingTruth['standing'], { text: string; color: string }> = {
    true: { text: 'TRUE', color: GREEN },
    garbled: { text: 'GARBLED', color: BRONZE },
    false: { text: 'FALSE', color: RED },
};

/** Which bought aspect a finding came from, as the console names it. */
const FINDING_KIND_LABEL: Record<IntelFindingTruth['kind'], string> = {
    beliefs: 'beliefs dossier',
    secrets: 'secrets dossier',
    scheme: 'scheme clue',
    scheme_nature: 'scheme nature (the reveal)',
    deep_analysis: "spymaster's assessment",
    occurrence: 'occurrence question',
};

/** The Events tab's grounded questions, as the player asked them. */
const QUESTION_LABEL: Record<NonNullable<IntelFindingTruth['question']>, string> = {
    who_is_behind_it: 'who is behind it?',
    who_gains: 'who gains?',
};

const DISTORTION_LABEL: Record<NonNullable<IntelFindingTruth['distortion']>, string> = {
    element_changed: 'one element changed',
    misattributed: 'misattributed',
};

/** The D47 half of a row: what the player holds, the rolls behind it, and the truth it was measured against. */
const FindingDetail: React.FC<{ finding: IntelFindingTruth; aboutId: string }> = ({ finding, aboutId }) => (
    <>
        <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 4 }}>
            about: {aboutId} · {FINDING_KIND_LABEL[finding.kind]}
            {finding.question && ` · ${QUESTION_LABEL[finding.question]}`}
            {finding.distortion && ` · ${DISTORTION_LABEL[finding.distortion]}`}
            {finding.schemeName && ` · design: ${finding.schemeName}`}
        </div>
        {finding.occurrence && (
            <div style={{ fontSize: 13, color: DIM, marginTop: 2 }}>
                asked of: <span style={{ fontStyle: 'italic', color: PARCH }}>“{finding.occurrence}”</span>
            </div>
        )}
        {finding.planned !== undefined && (
            <div style={{ fontSize: 13, color: DIM, marginTop: 2 }}>
                planned: {finding.planned ? <span style={{ fontStyle: 'italic', color: PARCH }}>“{finding.planned}”</span> : 'nothing - no hand named'}
                {finding.heldToSibling && ' · held to the other question\'s nothing, whatever its own roll'}
            </div>
        )}
        {finding.rolls && (
            <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 2 }}>
                tier {finding.rolls.tier} · accuracy d20 {finding.rolls.accuracyRoll} → {finding.rolls.accuracy} · fidelity d20 {finding.rolls.fidelityRoll} → {finding.rolls.fidelity} · seed {finding.rolls.seed}
            </div>
        )}
        <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            truth: {finding.groundTruth ? <span style={{ fontStyle: 'italic', color: PARCH }}>“{finding.groundTruth}”</span> : 'none reached the agent'}
        </div>
    </>
);

/**
 * The true-vs-believed view (DESIGN_DECISIONS.md D11 + D7): the GM-private
 * truth ledger, one row per rumor - the claim as the player heard it, the
 * credibility the matching Report presented, and the ACTUAL truth plus
 * origin only this console may show - and, since D47, one row per
 * investigation finding: the agent's account as the player holds it, its
 * standing (true, garbled or false), the ground truth behind it, and the
 * hidden rolls that shaped it (D4: recorded here, never shown to the
 * player) - for a grounded answer about an occurrence, also the question and
 * the headline it was asked of. Campaign-wide (the ledger is a single bounded
 * collection, not per-turn data), newest first. Entries flagged `assumed`
 * mark rumors the adjudicator failed to disposition despite the prompt -
 * defaulted to TRUE, never silently invented as lies.
 */
export const TruthLedgerView: React.FC<{ ledger: TruthLedgerEntry[]; reports: Report[] }> = ({ ledger, reports }) => (
    <>
        {ledger.length === 0 ? (
            <GmNote>No rumors or investigation findings have been recorded in the truth ledger yet.</GmNote>
        ) : (
            ledger.slice().reverse().map(entry => {
                const finding = entry.investigation;
                const matchingReport = finding ? undefined : reports.find(r => r.id === entry.reportId);
                const standing = finding
                    ? STANDING_LABEL[finding.standing]
                    : entry.isTrue ? STANDING_LABEL.true : STANDING_LABEL.false;
                return (
                    <div key={entry.id} style={well}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ ...lbl, color: GOLD }}>Turn {toRoman(entry.turn)}</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: standing.color }}>
                                {standing.text}
                            </span>
                            {entry.assumed && (
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: RED }}>
                                    ASSUMED — model omitted the disposition
                                </span>
                            )}
                            <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>
                                {finding
                                    ? "player holds: your agents' account"
                                    : `player saw: ${matchingReport ? `${(matchingReport.credibility * 100).toFixed(0)}% credible` : 'no matching report'}`}
                            </span>
                        </div>
                        <div style={{ fontSize: 14, fontStyle: 'italic', color: PARCH, marginTop: 4 }}>“{entry.claim}”</div>
                        {finding ? <FindingDetail finding={finding} aboutId={entry.aboutId} /> : (
                            <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 4 }}>
                                about: {entry.aboutId} · origin: {entry.originId || 'organic (unattributed)'}
                            </div>
                        )}
                    </div>
                );
            })
        )}
    </>
);
