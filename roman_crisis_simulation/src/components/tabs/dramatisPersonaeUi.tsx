import React from 'react';
import InfoTooltip from '../InfoTooltip';
import { Button } from '../ui/Core';
import { toRoman } from '../ui/Brand';
import { SchemeDiscovery } from '../../knowledge/store';

export const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-muted)' };
export const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

/**
 * D28 scheme-discovery progress: filled/empty threads for PAID nature-clues
 * gathered vs. the reveal threshold. A discrete game-mechanic meter, NOT a
 * credibility number (D25/D26) - it counts investigations bought, not how
 * trustworthy anything is.
 */
export const ThreadPips: React.FC<{ filled: number; total: number }> = ({ filled, total }) => (
    <span aria-label={`${filled} of ${total} threads uncovered`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        {Array.from({ length: total }, (_, i) => (
            <span
                key={i}
                aria-hidden="true"
                style={{
                    width: 9, height: 9, borderRadius: '50%', flex: 'none',
                    background: i < filled ? 'var(--tyrian-500)' : 'transparent',
                    border: '1px solid var(--tyrian-500)',
                }}
            />
        ))}
        <span style={{ ...quiet, fontSize: 12, marginLeft: 4 }}>threads</span>
    </span>
);

/**
 * The "Active Scheme" surface (D28). It renders the knowledge store's earned
 * DISCOVERY STATE - never the raw ground-truth Scheme (no title, no steps ever
 * reach the player):
 *   - nothing known        -> [ Unknown ], a first Investigate for a nature clue;
 *   - aware, not revealed   -> "something is afoot" + thread progress, buy more;
 *   - revealed              -> the earned nature (the agent's pieced-together
 *                              read, surfaced only once enough PAID clues cross
 *                              SCHEME_CLUES_TO_REVEAL).
 * Proximity awareness alone never advances the threads (D30) - only a paid
 * investigation does - so a scheme a mind re-evolves every turn cannot
 * passively reveal itself here.
 */
export const SchemeIntelSection: React.FC<{
    discovery: SchemeDiscovery | undefined;
    threshold: number;
    cost: number;
    resourceCount: number;
    onInvestigate: () => void;
    isLoading: boolean;
    tooltip: string;
}> = ({ discovery, threshold, cost, resourceCount, onInvestigate, isLoading, tooltip }) => {
    const renderState = () => {
        if (isLoading) {
            return <span style={quiet}>Your asset works in the dark…</span>;
        }
        if (discovery?.revealed && discovery.nature) {
            return (
                <div style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ ...quiet, margin: 0, color: 'var(--text-body)' }}>“{discovery.nature}”</p>
                </div>
            );
        }
        const aware = !!discovery;
        const clues = discovery?.clues ?? 0;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={quiet}>{aware ? 'Something is afoot — your agents are still piecing it together.' : '[ Unknown ]'}</span>
                    <Button size="sm" variant="secondary" onClick={onInvestigate} disabled={resourceCount < cost || isLoading}>
                        {(aware ? 'Investigate further' : 'Investigate') + (cost <= 0 ? ' · Free' : ` · ${toRoman(cost)} Inv.`)}
                    </Button>
                </span>
                {aware && <ThreadPips filled={clues} total={threshold} />}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>Active Scheme<InfoTooltip text={tooltip} /></span>
            {renderState()}
        </div>
    );
};

export const IntelSection: React.FC<{
    title: string;
    cost: number;
    resourceName: string;
    resourceCount: number;
    /** True once the player holds a persisted dossier on this aspect (D14): the button reads "Refresh", not "Reveal". Flat-priced (see priceInvestigation). */
    held: boolean;
    uncoveredData: string[] | undefined;
    onUncover: () => void;
    isLoading: boolean;
    tooltip: string;
    footnote?: React.ReactNode;
}> = ({ title, cost, resourceName, resourceCount, held, uncoveredData, onUncover, isLoading, tooltip, footnote }) => {

    const renderContent = () => {
        if (isLoading) {
            return <span style={quiet}>Your asset works in the dark…</span>;
        }
        if (uncoveredData) {
            return (
                <div style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                        {uncoveredData.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                    {footnote}
                </div>
            );
        }
        // A held dossier is REFRESHED, not revealed afresh - at the same flat
        // price (D14; the D27 staleness discount stays dormant until B1's
        // graded currency). Only a spend AMOUNT is ever shown - never a
        // credibility number (D25).
        const verb = held ? 'Refresh' : 'Reveal';
        return (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={quiet}>{held ? '[ On file — may be stale ]' : '[ Unknown ]'}</span>
                <Button size="sm" variant="secondary" onClick={onUncover} disabled={resourceCount < cost || isLoading}>
                    {cost <= 0 ? `${verb} · Free` : `${verb} · ${toRoman(cost)} ${resourceName}`}
                </Button>
            </span>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>{title}<InfoTooltip text={tooltip} /></span>
            {renderContent()}
        </div>
    );
};

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "Deep Analysis" is a premium
 * intel tier, distinct from the `IntelSection` cards above: it's a single
 * synthesized spymaster's assessment rather than a raw uncovered fact, so it
 * gets its own visual treatment (a gilt, illuminated card) to read as
 * qualitatively different from the standard "Reveal" panels.
 */
export const DeepAnalysisSection: React.FC<{
    analysis: string | undefined;
    cost: number;
    resourceCount: number;
    onCommission: () => void;
    isLoading: boolean;
}> = ({ analysis, cost, resourceCount, onCommission, isLoading }) => {
    const canAfford = resourceCount >= cost;

    return (
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '2px dashed var(--border-strong)' }}>
            <span style={{ ...labelStyle, color: 'var(--gold-700)', display: 'inline-flex', alignItems: 'center' }}>
                Spymaster's Assessment
                <InfoTooltip text="Commission a premium, synthesized strategic judgment on this individual - a higher-tier read than a raw investigation report, spent from your rare Deep Analyses." />
            </span>
            {isLoading ? (
                <p style={{ ...quiet, margin: '4px 0 0' }}>The assessment is being drawn up…</p>
            ) : analysis ? (
                <div className="gor-card gor-card-gilt" style={{ marginTop: 5, padding: '10px 12px', animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ margin: 0, fontSize: 14, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>“{analysis}”</p>
                </div>
            ) : (
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={quiet}>[ No deep analysis commissioned ]</span>
                    <Button
                        size="sm"
                        onClick={onCommission}
                        disabled={!canAfford || isLoading}
                        title={!canAfford ? `Requires ${cost} Deep Analyses (you have ${resourceCount})` : undefined}
                    >
                        Commission · {toRoman(cost)} Deep
                    </Button>
                </span>
            )}
        </div>
    );
};
