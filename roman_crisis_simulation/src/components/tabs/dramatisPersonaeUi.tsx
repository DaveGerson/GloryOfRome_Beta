import React, { useEffect, useRef } from 'react';
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
 * A purchase button that keeps keyboard focus while the agent works (WCAG
 * 2.4.3). Unaffordable is truly `disabled`; merely BUSY - this request in
 * flight, or the desk held by another - is `aria-disabled` with the press
 * refused, because a `disabled` button drops focus to the page body the
 * moment the request it just started locks the desk, and the next Tab lands
 * far from the dossier.
 */
export const FocusKeepingButton: React.FC<{
    onPress: () => void;
    unaffordable?: boolean;
    busy: boolean;
    variant?: 'primary' | 'secondary' | 'ghost';
    title?: string;
    children: React.ReactNode;
}> = ({ onPress, unaffordable = false, busy, variant = 'secondary', title, children }) => (
    <Button
        size="sm"
        variant={variant}
        disabled={unaffordable}
        aria-disabled={busy || undefined}
        title={title}
        style={busy && !unaffordable ? { opacity: .55, filter: 'saturate(.3)', cursor: 'not-allowed' } : undefined}
        onClick={() => { if (!busy) onPress(); }}
    >{children}</Button>
);

/**
 * Moves keyboard focus to a finding once per landing: `landedSeq` changes
 * each time a paid request for this aspect commits, and the returned ref
 * goes on the region that shows what was bought (tabIndex -1, so it is
 * focusable without joining the Tab order).
 */
export function useFocusOnLanding<T extends HTMLElement>(landedSeq: number | undefined) {
    const ref = useRef<T>(null);
    useEffect(() => {
        if (landedSeq !== undefined) ref.current?.focus();
    }, [landedSeq]);
    return ref;
}

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
    // role="img": a name on a role-less span is never read out (ARIA 1.2
    // forbids naming the generic role) - the sibling MacroCell's pattern.
    <span className="gor-stitch" role="img" aria-label={`${filled} of ${total} threads uncovered`}>
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
    /** Changes each time a paid clue lands - focus then moves to the thread (useFocusOnLanding). */
    landedSeq?: number;
}> = ({ discovery, threshold, cost, resourceCount, onInvestigate, isLoading, interactionLocked = false, tooltip, showGloss = false, landedSeq }) => {
    // Whichever state renders is where focus lands once a clue comes back.
    const findingRef = useFocusOnLanding<HTMLDivElement>(landedSeq);
    const renderState = () => {
        if (discovery?.revealed && discovery.nature) {
            return (
                <div ref={findingRef} tabIndex={-1} style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ ...quiet, margin: 0, color: 'var(--text-body)' }}>“{discovery.nature}”</p>
                </div>
            );
        }
        const aware = !!discovery;
        const clues = discovery?.clues ?? 0;
        return (
            <div ref={findingRef} tabIndex={-1} className="gor-silhouette gor-silhouette-thread">
                <span className="gor-silhouette-body">
                    <span style={quiet}>{aware ? 'Something is afoot — your agents are still piecing it together.' : '[ Unknown ]'}</span>
                    {aware && <StitchedThread filled={clues} total={threshold} />}
                </span>
                <FocusKeepingButton onPress={onInvestigate} unaffordable={resourceCount < cost} busy={isLoading || interactionLocked}>
                    <Price verb="Pull the thread" cost={cost} balance={resourceCount} unit="Inv." />
                </FocusKeepingButton>
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

/**
 * B2: the durable dossier reading (D14/D27) - what the player HOLDS on an
 * aspect, derived from the knowledge store's deriveDossier read model rather
 * than session state, so it survives a tab switch and a reload. The stamps
 * carry provenance and age (D25: a source lead and turn numerals, never a
 * figure); `stale` is the D27 cold threshold expressed as wording only.
 */
export interface HeldDossierReading {
    latestText: string;
    /** The itemised findings bought with the latest reading, frozen with it (D14). */
    items?: string[];
    firstLearnedTurn: number;
    lastRefreshedTurn: number;
    sourceLead: string;
    stale: boolean;
}

export const IntelSection: React.FC<{
    title: string;
    cost: number;
    resourceName: string;
    resourceCount: number;
    /** True once the player holds a persisted dossier on this aspect (D14): the button reads "Refresh", not "Reveal". Flat-priced (see priceInvestigation). */
    held: boolean;
    /** The week the dossier was first opened, for the broken seal's caption. */
    heldSinceTurn?: number | null;
    /** The durable reading for a held aspect - see HeldDossierReading. */
    heldReading?: HeldDossierReading;
    onUncover: () => void;
    isLoading: boolean;
    interactionLocked?: boolean;
    tooltip: string;
    showGloss?: boolean;
    /** Changes each time a paid reading for this aspect lands - focus then moves to it (useFocusOnLanding). */
    landedSeq?: number;
}> = ({ title, cost, resourceName, resourceCount, held, heldSinceTurn, heldReading, onUncover, isLoading, interactionLocked = false, tooltip, showGloss = false, landedSeq }) => {
    // Whichever state renders is where focus lands once a reading comes back.
    const findingRef = useFocusOnLanding<HTMLDivElement>(landedSeq);
    const busy = isLoading || interactionLocked;

    const renderContent = () => {
        // The held aspect, read durably off the store (B2) - the only place a
        // bought reading renders, so nothing paid for is lost to a tab switch
        // (D14). The refresh affordance stays beside it at the same flat
        // price. The stamps count turns, not the masthead's calendar week.
        if (heldReading) {
            return (
                <div ref={findingRef} tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{heldReading.latestText}</span>
                    {heldReading.items && heldReading.items.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                            {heldReading.items.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    )}
                    <span style={quiet}>
                        First learned Turn {toRoman(heldReading.firstLearnedTurn)} · as of Turn {toRoman(heldReading.lastRefreshedTurn)} · {heldReading.sourceLead}
                    </span>
                    {heldReading.stale && (
                        <span style={{ ...quiet, fontStyle: 'italic', color: 'var(--bronze-500)' }}>
                            The file has aged; Rome has not stood still.
                        </span>
                    )}
                    <span>
                        <FocusKeepingButton onPress={onUncover} unaffordable={resourceCount < cost} busy={busy}>
                            <Price verb="Refresh" cost={cost} balance={resourceCount} unit={resourceName} />
                        </FocusKeepingButton>
                    </span>
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
            <div ref={findingRef} tabIndex={-1} className={`gor-silhouette ${held ? 'gor-silhouette-seal' : 'gor-silhouette-vellum'}`}>
                <span className="gor-silhouette-body">
                    {held ? (
                        <>
                            <WaxSeal letter={title.charAt(0)} size={26} tone="crimson" style={{ clipPath: 'polygon(0 0,100% 0,100% 42%,52% 58%,100% 74%,100% 100%,0 100%)' }} />
                            <span style={quiet}>
                                {typeof heldSinceTurn === 'number'
                                    ? `On file since Turn ${toRoman(heldSinceTurn)} — may be stale`
                                    : 'On file — may be stale'}
                            </span>
                        </>
                    ) : (
                        <span style={quiet}>Nothing on file.</span>
                    )}
                </span>
                <FocusKeepingButton onPress={onUncover} unaffordable={resourceCount < cost} busy={busy}>
                    <Price verb={verb} cost={cost} balance={resourceCount} unit={resourceName} />
                </FocusKeepingButton>
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
 *
 * The assessment is the knowledge store's (a paid dossier aspect, committed
 * with its spend), not session state: it used to vanish on a tab switch and
 * offer itself for sale again. Held, it is refreshed like any held aspect.
 */
export const DeepAnalysisSection: React.FC<{
    /** The held assessment and the turn it was last drawn up, or undefined when none is on file. */
    held: { analysis: string; asOfTurn: number } | undefined;
    cost: number;
    resourceCount: number;
    onCommission: () => void;
    isLoading: boolean;
    interactionLocked?: boolean;
    showGloss?: boolean;
    /** Changes each time a commissioned assessment lands - focus then moves to it (useFocusOnLanding). */
    landedSeq?: number;
}> = ({ held, cost, resourceCount, onCommission, isLoading, interactionLocked = false, showGloss = false, landedSeq }) => {
    const canAfford = resourceCount >= cost;
    const findingRef = useFocusOnLanding<HTMLDivElement>(landedSeq);
    const commission = (verb: string) => (
        <FocusKeepingButton
            variant={held ? 'secondary' : 'primary'}
            onPress={onCommission}
            unaffordable={!canAfford}
            busy={isLoading || interactionLocked}
            title={!canAfford ? `Requires ${cost} Deep Analyses (you have ${resourceCount})` : undefined}
        >
            <Price verb={verb} cost={cost} balance={resourceCount} unit="Deep" />
        </FocusKeepingButton>
    );

    return (
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '2px dashed var(--border-strong)' }}>
            <span style={{ ...labelStyle, color: 'var(--gold-700)' }}>Spymaster's Assessment</span>
            {showGloss && <Marginalia>Commission a premium, synthesized strategic judgment on this individual — a higher-tier read than a raw investigation report, spent from your rare Deep Analyses.</Marginalia>}
            {isLoading && <p role="status" style={{ ...quiet, margin: '4px 0 0' }}>The assessment is being drawn up…</p>}
            <div ref={findingRef} tabIndex={-1}>
                {held ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="gor-card gor-card-gilt" style={{ marginTop: 5, padding: '10px 12px', animation: 'gorFadeIn .4s ease-out both' }}>
                            <p style={{ margin: 0, fontSize: 14, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>“{held.analysis}”</p>
                        </div>
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <span style={quiet}>As of Turn {toRoman(held.asOfTurn)}</span>
                            {commission('Refresh')}
                        </span>
                    </div>
                ) : (
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={quiet}>[ No deep analysis commissioned ]</span>
                        {commission('Commission')}
                    </span>
                )}
            </div>
        </div>
    );
};
