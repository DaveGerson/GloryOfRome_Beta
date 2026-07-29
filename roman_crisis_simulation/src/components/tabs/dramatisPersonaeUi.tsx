import React from 'react';
import { Button } from '../ui/Core';
import { WaxSeal, toRoman } from '../ui/Brand';
import { SchemeDiscovery } from '../../knowledge/store';

export const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-muted)' };
export const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

/** How many hollow pips a price will draw before it stops counting the purse. */
const MAX_REMAINING_PIPS = 4;

/**
 * A price in coin, not in numerals (audit item 24). `toRoman(cost)` used to
 * render "Reveal · I Inv." — the guide reserves Roman numerals for ceremony
 * (the week ribbon, the turn count, the epilogue) and keeps anything the
 * player does arithmetic on Arabic. A price is arithmetic, so it becomes what
 * it is: coins on the table.
 *
 * Filled gold discs are what this costs; hollow ones are what would be left,
 * capped so a rich player's button does not grow without bound. The balance
 * itself is Arabic, in the file header.
 */
export const CoinPips: React.FC<{ spend: number; balance: number }> = ({ spend, balance }) => {
    const remaining = Math.max(0, Math.min(balance - spend, MAX_REMAINING_PIPS));
    return (
        <span className="gor-pips" aria-hidden="true">
            {Array.from({ length: spend }, (_, i) => <span key={`s${i}`} className="gor-pip gor-pip-spent" />)}
            {Array.from({ length: remaining }, (_, i) => <span key={`r${i}`} className="gor-pip" />)}
        </span>
    );
};

/**
 * The verb, then the coins. Kept as one helper so every purchase in the
 * dossier prices itself the same way — and so the visible text still LEADS
 * with the verb ("Reveal", "Refresh", "Commission").
 */
const Price: React.FC<{ verb: string; cost: number; balance: number; unit: string }> = ({ verb, cost, balance, unit }) => (
    <>
        {verb}
        {cost <= 0 ? ' · Free' : <CoinPips spend={cost} balance={balance} />}
        <span className="gor-sr-only">{cost <= 0 ? '' : ` costs ${cost} ${unit}, ${Math.max(0, balance - cost)} remaining`}</span>
    </>
);

/**
 * The gloss a section used to hang behind a † (audit item 25). Five daggers in
 * one dossier is four too many; the card header now carries a single
 * ❧ Glossary control that opens every gloss at once, inline, as marginalia.
 */
export const Marginalia: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="gor-marginalia">{children}</p>
);

/**
 * D28 scheme-discovery progress drawn as a stitched thread (audit item 26):
 * alternating filled and hollow Tyrian discs joined by a running stitch. Same
 * `clues / threshold` data the old ThreadPips row carried — a discrete
 * game-mechanic count of investigations BOUGHT, never a credibility number
 * (D25/D26).
 */
export const StitchedThread: React.FC<{ filled: number; total: number }> = ({ filled, total }) => (
    <span className="gor-stitch" aria-label={`${filled} of ${total} threads uncovered`}>
        {Array.from({ length: total }, (_, i) => (
            <span key={i} aria-hidden="true" className={`gor-stitch-knot${i < filled ? ' gor-stitch-knot-tied' : ''}`} />
        ))}
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
 *
 * Its silhouette is the stitched thread — the one aspect you pull at rather
 * than buy outright.
 */
export const SchemeIntelSection: React.FC<{
    discovery: SchemeDiscovery | undefined;
    threshold: number;
    cost: number;
    resourceCount: number;
    onInvestigate: () => void;
    isLoading: boolean;
    interactionLocked?: boolean;
    tooltip: string;
    showGloss?: boolean;
}> = ({ discovery, threshold, cost, resourceCount, onInvestigate, isLoading, interactionLocked = false, tooltip, showGloss = false }) => {
    const renderState = () => {
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
            <div className="gor-silhouette gor-silhouette-thread">
                <span className="gor-silhouette-body">
                    <span style={quiet}>{aware ? 'Something is afoot — your agents are still piecing it together.' : '[ Unknown ]'}</span>
                    {aware && <StitchedThread filled={clues} total={threshold} />}
                </span>
                <Button size="sm" variant="secondary" onClick={onInvestigate} disabled={resourceCount < cost || isLoading || interactionLocked}>
                    <Price verb="Pull the thread" cost={cost} balance={resourceCount} unit="Inv." />
                </Button>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={labelStyle}>Active Scheme</span>
            {showGloss && <Marginalia>{tooltip}</Marginalia>}
            {isLoading && <span role="status" style={quiet}>Your asset works in the dark…</span>}
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
    /** The week the dossier was first opened, for the broken seal's caption. */
    heldSinceTurn?: number | null;
    uncoveredData: string[] | undefined;
    onUncover: () => void;
    isLoading: boolean;
    interactionLocked?: boolean;
    tooltip: string;
    footnote?: React.ReactNode;
    showGloss?: boolean;
}> = ({ title, cost, resourceName, resourceCount, held, heldSinceTurn, uncoveredData, onUncover, isLoading, interactionLocked = false, tooltip, footnote, showGloss = false }) => {

    const renderContent = () => {
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
        //
        // Two silhouettes, not one row twice (audit item 26): nothing on file
        // is blanked vellum; something on file is a seal already broken, and
        // says how old it is.
        const verb = held ? 'Refresh' : 'Reveal';
        return (
            <div className={`gor-silhouette ${held ? 'gor-silhouette-seal' : 'gor-silhouette-vellum'}`}>
                <span className="gor-silhouette-body">
                    {held ? (
                        <>
                            <WaxSeal letter={title.charAt(0)} size={26} tone="crimson" style={{ clipPath: 'polygon(0 0,100% 0,100% 42%,52% 58%,100% 74%,100% 100%,0 100%)' }} />
                            <span style={quiet}>
                                {typeof heldSinceTurn === 'number'
                                    ? `On file since Week ${toRoman(heldSinceTurn)} — may be stale`
                                    : 'On file — may be stale'}
                            </span>
                        </>
                    ) : (
                        <span style={quiet}>Nothing on file.</span>
                    )}
                </span>
                <Button size="sm" variant="secondary" onClick={onUncover} disabled={resourceCount < cost || isLoading || interactionLocked}>
                    <Price verb={verb} cost={cost} balance={resourceCount} unit={resourceName} />
                </Button>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={labelStyle}>{title}</span>
            {showGloss && <Marginalia>{tooltip}</Marginalia>}
            {isLoading && <span role="status" style={quiet}>Your asset works in the dark…</span>}
            {renderContent()}
        </div>
    );
};

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "Deep Analysis" is a premium
 * intel tier, distinct from the `IntelSection` cards above: it's a single
 * synthesized spymaster's assessment rather than a raw uncovered fact, so it
 * gets its own visual treatment (a gilt, illuminated card) to read as
 * qualitatively different from the standard "Reveal" panels. It keeps that
 * gilt card through WP-9 — it already reads as premium.
 */
export const DeepAnalysisSection: React.FC<{
    analysis: string | undefined;
    cost: number;
    resourceCount: number;
    onCommission: () => void;
    isLoading: boolean;
    interactionLocked?: boolean;
    showGloss?: boolean;
}> = ({ analysis, cost, resourceCount, onCommission, isLoading, interactionLocked = false, showGloss = false }) => {
    const canAfford = resourceCount >= cost;

    return (
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '2px dashed var(--border-strong)' }}>
            <span style={{ ...labelStyle, color: 'var(--gold-700)' }}>Spymaster's Assessment</span>
            {showGloss && <Marginalia>Commission a premium, synthesized strategic judgment on this individual — a higher-tier read than a raw investigation report, spent from your rare Deep Analyses.</Marginalia>}
            {isLoading && <p role="status" style={{ ...quiet, margin: '4px 0 0' }}>The assessment is being drawn up…</p>}
            {analysis ? (
                <div className="gor-card gor-card-gilt" style={{ marginTop: 5, padding: '10px 12px', animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ margin: 0, fontSize: 14, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>“{analysis}”</p>
                </div>
            ) : (
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={quiet}>[ No deep analysis commissioned ]</span>
                    <Button
                        size="sm"
                        onClick={onCommission}
                        disabled={!canAfford || isLoading || interactionLocked}
                        title={!canAfford ? `Requires ${cost} Deep Analyses (you have ${resourceCount})` : undefined}
                    >
                        <Price verb="Commission" cost={cost} balance={resourceCount} unit="Deep" />
                    </Button>
                </span>
            )}
        </div>
    );
};
