import React, { useState } from 'react';
import { Report } from '../../types';
import { Badge } from '../ui/Core';
import { WaxSeal, toRoman } from '../ui/Brand';
import { SubRail } from '../ui/SubRail';
import {
    certaintyClause, contradictsHigherCertainty, corroboration, knowledgeSourceLead, reportReliability, reportSeal, sourceLead,
} from '../../knowledge/credibilityFraming';
import type { KnowledgeClaim } from '../../knowledge/store';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';
import { EmptyRegister, SlipsSilhouette } from './EmptyRegister';

/**
 * D25/D26: the player never sees a credibility NUMBER. Trust is conveyed by
 * the SOURCE and how that source frames its own certainty, and — the part this
 * tab used to hide entirely — by whether sources corroborate or conflict.
 * Every one of those derivations is a pure helper in knowledge/credibilityFraming;
 * `report.credibility` is read only inside that module and never re-emitted,
 * so nothing on this surface can leak the figure.
 *
 * Reports used to be listed flat and reverse-chronological, each titled
 * `Turn ${report.turn}` — the least useful fact available — so three accounts
 * of the Praetorian Guard, the third contradicting the first two, looked like
 * three unrelated cards (audit item 35).
 */

const REGISTERS = ['subject', 'week', 'rumors'] as const;
type ReportRegister = typeof REGISTERS[number];

const subjectLabel = (about: string): string => about.replace(/_/g, ' ');

/**
 * B2's rumor feed (D21): which knowledge claims belong to the feed. Report
 * and digest channels are "word received"; investigation and scheme claims
 * are what you PAID to hold (the dossier's material, D14), and claims
 * carrying a relationship-observation marker have their own home on the
 * Personae relationship map — listing them here twice would say the same
 * thing in two rooms.
 */
function isFeedClaim(claim: KnowledgeClaim): boolean {
    const channel = claim.claimKey.split(':')[0];
    return (channel === 'report' || channel === 'digest') && !claim.relationshipObservation;
}

function latestWordTurn(claim: KnowledgeClaim): number {
    return Math.max(claim.firstLearnedTurn, ...claim.updates.map(update => update.turn));
}

/**
 * One claim's card in the feed: the subject, the frozen opening claim, and
 * the full visible timeline (D21 — claims evolve; `updates[0]` is the
 * original learning). Each row is source-tagged in the source's own voice;
 * a row that carries credibility gets the certainty CLAUSE, never the
 * figure (D25/D26). Digest rows are binary-fidelity (D5 v1): lead only.
 */
const RumorClaimCard: React.FC<{ claim: KnowledgeClaim }> = ({ claim }) => (
    <section className="gor-rumor-claim gor-report-group">
        <header className="gor-report-group-head">
            <span className="gor-report-subject">{subjectLabel(claim.subject)}</span>
            <span className="gor-report-week">as of {toRoman(latestWordTurn(claim))}</span>
        </header>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claim.updates.map((update, index) => (
                <li key={index} className="gor-rumor-update" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <span className="gor-report-source">{knowledgeSourceLead(update.source)}</span>
                        <span className="gor-report-week">{toRoman(update.turn)}</span>
                    </span>
                    <span style={{ fontSize: 15 }}>{update.text}</span>
                    {typeof update.credibility === 'number' && (
                        <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                            {certaintyClause(update.credibility)}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    </section>
);

/** The seal a source is worth: crimson for a firm agent, Tyrian for a courier,
 *  and dashed-and-unsealed for the rumour mill (audit item 28). */
const SourceSeal: React.FC<{ report: Report }> = ({ report }) => {
    const seal = reportSeal(report);
    if (seal === 'unsealed') {
        return <span className="gor-seal-unsealed" aria-hidden="true">❦</span>;
    }
    return <WaxSeal letter={sourceLead(report.source).charAt(0)} size={30} tone={seal} />;
};

const ReportCard: React.FC<{ report: Report; group: readonly Report[] }> = ({ report, group }) => {
    const { tone, badgeWord } = reportReliability(report);
    const contradicts = contradictsHigherCertainty(report, group);
    const clauseTone = tone === 'laurel' ? 'var(--laurel-500)' : tone === 'bronze' ? 'var(--bronze-500)' : 'var(--crimson-500)';
    return (
        <div className="gor-report">
            <SourceSeal report={report} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <span className="gor-report-source">{sourceLead(report.source)}</span>
                    <span className="gor-report-week">{toRoman(report.turn)}</span>
                </div>
                <span style={{ fontSize: 15 }}>“{report.claim}”</span>
                <span style={{ fontSize: 14, fontStyle: 'italic', color: clauseTone }}>
                    {certaintyClause(report.credibility)}
                    {contradicts && ' — and it contradicts the accounts above.'}
                </span>
                <span><Badge tone={tone}>{badgeWord}</Badge></span>
            </div>
        </div>
    );
};

/** What a group of accounts about one subject amounts to. Never a number. */
const GroupVerdict: React.FC<{ reports: readonly Report[] }> = ({ reports }) => {
    const { verdict, sources } = corroboration(reports);
    if (verdict === 'conflict') return <span className="gor-verdict gor-verdict-conflict">⚠ Accounts conflict</span>;
    if (verdict === 'agree') return <span className="gor-verdict gor-verdict-agree">{sources} sources agree</span>;
    return <span className="gor-verdict">One account</span>;
};

const ReportsTab: React.FC<{ reports: Report[]; knowledge?: KnowledgeClaim[] }> = ({ reports, knowledge = [] }) => {
    const [register, setRegister] = useState<ReportRegister>(() => getTabRegister('reports', REGISTERS, 'subject'));

    const selectRegister = (next: ReportRegister) => {
        setRegister(next);
        setTabRegister('reports', next);
    };

    const feedClaims = knowledge.filter(isFeedClaim)
        .sort((a, b) => latestWordTurn(b) - latestWordTurn(a));

    // Nothing anywhere: the tab keeps its original single zero state. With
    // word in EITHER ledger the rail renders, and each register names its
    // own absence (D45) rather than hiding the other's content.
    if (reports.length === 0 && feedClaims.length === 0) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Intelligence Reports</h3>
                <EmptyRegister
                    silhouette={<SlipsSilhouette />}
                    line="No one has told you anything yet."
                    hint="Reports arrive when your agents have something worth carrying."
                />
            </div>
        );
    }

    // By subject: one group per `report.about`, the subject heard from most
    // recently first, and each group's own accounts newest first.
    const bySubject = new Map<string, Report[]>();
    for (const report of reports) {
        const group = bySubject.get(report.about) ?? [];
        group.push(report);
        bySubject.set(report.about, group);
    }
    const subjects = [...bySubject.entries()]
        .map(([about, group]) => ({ about, group: group.slice().sort((a, b) => b.turn - a.turn) }))
        .sort((a, b) => b.group[0].turn - a.group[0].turn);

    // By week: the chronology this tab used to be, kept as the second register.
    const byWeek = new Map<number, Report[]>();
    for (const report of reports) {
        const week = byWeek.get(report.turn) ?? [];
        week.push(report);
        byWeek.set(report.turn, week);
    }
    const weeks = [...byWeek.entries()].sort((a, b) => b[0] - a[0]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SubRail
                ariaLabel="Reports register"
                value={register}
                onChange={selectRegister}
                options={[
                    { value: 'subject', label: 'By subject', count: subjects.length },
                    { value: 'week', label: 'By week', count: weeks.length },
                    { value: 'rumors', label: 'Rumors', count: feedClaims.length },
                ]}
            />
            {register === 'rumors' && (
                feedClaims.length === 0
                    ? <EmptyRegister
                        silhouette={<SlipsSilhouette />}
                        line="No word has reached you yet."
                        hint="Rumors gather as the weeks turn and your sources talk."
                    />
                    : feedClaims.map(claim => <RumorClaimCard key={claim.id} claim={claim} />)
            )}
            {register !== 'rumors' && reports.length === 0 && (
                <EmptyRegister
                    silhouette={<SlipsSilhouette />}
                    line="No one has told you anything yet."
                    hint="Reports arrive when your agents have something worth carrying."
                />
            )}
            {register !== 'rumors' && reports.length > 0 && (register === 'subject'
                ? subjects.map(({ about, group }) => {
                    const conflicted = corroboration(group).verdict === 'conflict';
                    return (
                        <section key={about} className={`gor-report-group${conflicted ? ' gor-report-group-conflict' : ''}`}>
                            <header className="gor-report-group-head">
                                <span className="gor-report-subject">{subjectLabel(about)}</span>
                                <GroupVerdict reports={group} />
                            </header>
                            {group.map(report => <ReportCard key={report.id} report={report} group={group} />)}
                        </section>
                    );
                })
                : weeks.map(([week, group]) => (
                    <section key={week} className="gor-report-group">
                        <header className="gor-report-group-head">
                            <span className="gor-report-subject">Week {toRoman(week)}</span>
                            <span className="gor-verdict">{group.length} account{group.length === 1 ? '' : 's'}</span>
                        </header>
                        {group.map(report => <ReportCard key={report.id} report={report} group={bySubject.get(report.about) ?? [report]} />)}
                    </section>
                )))}
        </div>
    );
};

export default ReportsTab;
