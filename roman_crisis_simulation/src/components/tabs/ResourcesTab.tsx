import React, { useEffect, useRef, useState } from 'react';
import { Entity, TurnHistoryEntry } from '../../types';
import { SubRail } from '../ui/SubRail';
import { WaxSeal, toRoman } from '../ui/Brand';
import { Button } from '../ui/Core';
import { CoinPips, Marginalia } from './dramatisPersonaeUi';
import { describeResource, formatResourceValue, ResourceRegister } from './resourceDescriptors';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';
import { CofferSilhouette, EmptyRegister, LetterSlotsSilhouette } from './EmptyRegister';
import { holdingsInventory, projectTreasury, weekLedgerView } from './ledgerView';
import { investigationCap, CREDITORS_PRESS_THRESHOLD, DESERTION_ARREARS_WEEKS } from '../../ai/core/ledger';
import { formatArabic, numericResource } from '../../ai/core/resourceRegistry';
import { EXCHANGE_TABLE, ExchangeEntry, ExchangeId, maxAffordableLots, quoteExchange } from '../../ai/core/exchequer';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

const REGISTERS: readonly ResourceRegister[] = ['ledger', 'holdings', 'standing', 'leverage', 'exchequer'];
const REGISTER_LABEL: Record<ResourceRegister, string> = {
    ledger: 'Ledger', holdings: 'Holdings', standing: 'Standing', leverage: 'Leverage', exchequer: 'Exchequer',
};

/** The counters a player checks before every decision. Debt and back pay join them only when they exist. */
const HERO_KEYS = ['denarii', 'investigations', 'deep_analyses'] as const;

/** Past this many weeks a runway stops being a number worth reading. */
const RUNWAY_BEYOND_REIGN_WEEKS = 260;

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** A signed Arabic amount, tabular, coloured by direction. */
const Amount: React.FC<{ value: number; unit?: 'money' | 'count' | 'scale' }> = ({ value }) => (
    <span className={`gor-ledger-amount ${value > 0 ? 'gor-ledger-amount-in' : value < 0 ? 'gor-ledger-amount-out' : ''}`}>
        {value > 0 ? '+' : value < 0 ? '−' : ''}{formatArabic(Math.abs(value))}
    </span>
);

/** A hairline-ruled section heading inside a register. */
const LedgerHeading: React.FC<{ title: string; trailing?: React.ReactNode }> = ({ title, trailing }) => (
    <div className="gor-ledger-heading">
        <span className="gor-label">{title}</span>
        <span className="gor-ledger-heading-rule" aria-hidden="true" />
        {trailing}
    </div>
);

/**
 * A scalar standing, drawn as a meter — item 23's COUNTED register: a crisp
 * numeral over a solid track, for a figure the simulation actually holds.
 * Scales run 0-100 by convention in this model. The fill is the metallic
 * gradient (--metal-gold) and the track carries the role="meter" ARIA
 * contract.
 */
const StandingMeter: React.FC<{ label: string; value: number }> = ({ label, value }) => {
    const share = Math.max(0, Math.min(100, value));
    return (
        <div className="gor-meter" style={{ padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
            <div className="gor-meter-row">
                <span className="gor-label">{label}</span>
                <span className="gor-meter-val">{value.toLocaleString('en-US')}</span>
            </div>
            <div className="gor-meter-track" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
                <div className="gor-meter-fill" style={{ width: `${share}%`, background: 'var(--metal-gold)' }} />
            </div>
        </div>
    );
};

/** The runway sentence: ceremony Roman, arithmetic Arabic (D44). */
export function runwayLine(runway: number, net: number, treasury: number): string {
    if (net >= 0) return net === 0 ? 'Your treasury holds level from week to week.' : 'Your treasury grows week on week.';
    if (treasury <= 0 || runway === 0) return 'Next week’s wages exceed what you hold; the shortfall becomes debt.';
    if (runway > RUNWAY_BEYOND_REIGN_WEEKS) return 'At this rate your treasury outlasts any reign.';
    return `At this rate your treasury lasts ${toRoman(runway)} week${runway === 1 ? '' : 's'}.`;
}

type ExchangeHandler = (id: ExchangeId, lots: number, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;

/**
 * One row of the exchequer: the verb, the rate, the friction, a lots field
 * and the button. Affordability is re-derived from the bag on every render,
 * so a committed bargain immediately re-prices the next.
 */
const ExchangeRow: React.FC<{
    entry: ExchangeEntry;
    resources: Entity['resources'];
    busy: boolean;
    locked: boolean;
    onStrike: (entry: ExchangeEntry, lots: number) => void;
    showGloss: boolean;
}> = ({ entry, resources, busy, locked, onStrike, showGloss }) => {
    const max = maxAffordableLots(entry, resources);
    const [lots, setLots] = useState(entry.minLot);
    const clamped = Math.max(entry.minLot, Math.min(Math.max(entry.minLot, max), Math.floor(lots) || entry.minLot));
    const quote = quoteExchange(entry, clamped);
    const unitQuote = quoteExchange(entry, 1);
    const spendLabel = describeResource(entry.spend.key).label.toLowerCase();
    const gainLabel = describeResource(entry.gain.key).label.toLowerCase();
    const rate = entry.gain.perLot < 0
        ? `${formatArabic(unitQuote.spendAmount)} ${spendLabel} clears ${formatArabic(unitQuote.gainAmount)} of ${gainLabel}`
        : `${formatArabic(unitQuote.spendAmount)} ${spendLabel} → ${formatArabic(unitQuote.gainAmount)} ${gainLabel}${quote.delayed ? ', next week' : ''}`;
    const unaffordable = max === 0;
    const reason = unaffordable
        ? entry.maxLots && numericResource(resources, entry.spend.key) >= entry.spend.perLot * entry.minLot
            ? 'At the ceiling.'
            : `Needs ${formatArabic(entry.spend.perLot * entry.minLot)} ${spendLabel}.`
        : null;
    return (
        <div className="gor-exchange">
            <div className="gor-exchange-body">
                <span className="gor-exchange-verb">{entry.label}</span>
                <span className="gor-exchange-rate">{rate}</span>
                {showGloss && <Marginalia>{entry.gloss}</Marginalia>}
                {reason && <span className="gor-exchange-reason">{reason}</span>}
            </div>
            <div className="gor-exchange-controls">
                <label className="gor-exchange-lots">
                    <span className="gor-sr-only">{entry.label}: lots</span>
                    <input
                        type="number"
                        className="gor-input gor-exchange-input"
                        aria-label={`${entry.label} lots`}
                        min={entry.minLot}
                        max={Math.max(entry.minLot, max)}
                        step={1}
                        value={clamped}
                        disabled={unaffordable || busy || locked}
                        onChange={event => setLots(Number(event.target.value))}
                    />
                </label>
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={unaffordable || busy || locked}
                    aria-label={`${entry.label}: strike the bargain`}
                    onClick={() => onStrike(entry, clamped)}
                >
                    {busy ? 'Striking…' : `Strike · ${formatArabic(quote.spendAmount)} ${spendLabel}`}
                </Button>
            </div>
        </div>
    );
};

/**
 * The Assets tab is a LEDGER (D46; audit items 21-23, 34): five registers
 * rather than three buckets — what the treasury holds and how it moved this
 * week, what you own and who you pay, where you stand, what you hold over
 * people, and the exchequer where one is traded for another.
 *
 * Every label, unit and register comes from the canonical registry through
 * ./resourceDescriptors — in particular the unit, which used to be inferred
 * from the value itself. Every number is the player's own (D5/D6); every
 * price and balance is Arabic and tabular, every week count Roman (D44).
 */
const ResourcesTab: React.FC<{
    playerEntity: Entity | null;
    /** The campaign's committed weeks — the last one is this week's ledger, the whole of it the inventory's provenance. */
    turnHistory?: TurnHistoryEntry[];
    /** The App's authoritative turn counter (the week whose books open next). */
    turnNumber?: number;
    /** Commits one exchequer bargain durably (App.tsx's handleExchange). Absent, the exchequer is read-only. */
    onExchange?: ExchangeHandler;
    runDomainMutation?: RunDomainMutation;
    interactionLocked?: boolean;
}> = ({ playerEntity, turnHistory = [], turnNumber, onExchange, runDomainMutation, interactionLocked = false }) => {
    const [register, setRegister] = useState<ResourceRegister>(() => getTabRegister('resources', REGISTERS, 'ledger'));
    // Nine † daggers in one view collapse to one ❧ Glossary, as in the dossier.
    const [glossaryOpen, setGlossaryOpen] = useState(false);
    const [busy, setBusy] = useState<ExchangeId | null>(null);
    const [receipt, setReceipt] = useState<string | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    if (!playerEntity?.resources) {
        return <p style={quiet}>No resources to display.</p>;
    }

    const resources = playerEntity.resources;
    const entries = Object.entries(resources) as [string, string | number | string[]][];
    const inRegister = (target: ResourceRegister) => entries.filter(([key]) => describeResource(key).register === target);
    const leverage = inRegister('leverage');
    const lastEntry = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
    const week = weekLedgerView(lastEntry, playerEntity.entity_id);
    const projection = projectTreasury(resources);
    const inventory = holdingsInventory(playerEntity, turnHistory);

    const selectRegister = (next: ResourceRegister) => {
        setRegister(next);
        setTabRegister('resources', next);
    };

    const strike = (entry: ExchangeEntry, lots: number) => {
        if (!onExchange || !runDomainMutation || interactionLocked) return;
        void runDomainMutation(async transaction => {
            const request: DomainMutationContext = { isCurrent: () => mountedRef.current && transaction.isCurrent() };
            if (!request.isCurrent()) return;
            setBusy(entry.id);
            setReceipt(null);
            try {
                const committed = await onExchange(entry.id, lots, request);
                if (!request.isCurrent()) return;
                const quote = quoteExchange(entry, lots);
                setReceipt(committed === false
                    ? 'The bargain could not be struck; your holdings are untouched.'
                    : entry.gain.perLot < 0
                        ? `Struck: ${formatArabic(quote.spendAmount)} ${describeResource(entry.spend.key).label.toLowerCase()} paid against ${describeResource(entry.gain.key).label.toLowerCase()}.`
                        : `Struck: ${formatArabic(quote.gainAmount)} ${describeResource(entry.gain.key).label.toLowerCase()} for ${formatArabic(quote.spendAmount)} ${describeResource(entry.spend.key).label.toLowerCase()}${quote.delayed ? ' — they arrive when the week turns' : ''}.`);
            } finally {
                if (request.isCurrent()) setBusy(null);
            }
        });
    };

    const heroes: { key: string; descriptor: ReturnType<typeof describeResource>; value: number; crimson?: boolean }[] = [];
    for (const key of HERO_KEYS) {
        const value = asNumber(resources[key]);
        if (value !== null) heroes.push({ key, descriptor: describeResource(key), value });
    }
    if (projection.debt > 0) heroes.push({ key: 'debt_denarii', descriptor: describeResource('debt_denarii'), value: projection.debt, crimson: true });
    if (projection.arrears > 0) heroes.push({ key: 'pay_arrears', descriptor: describeResource('pay_arrears'), value: projection.arrears, crimson: true });
    const cap = investigationCap(resources);

    const renderLedger = () => {
        const rest = inRegister('ledger').filter(([key]) => !HERO_KEYS.some(hero => hero === key) && key !== 'debt_denarii' && key !== 'pay_arrears');
        const hasBooks = heroes.length > 0 || rest.length > 0;
        return (
            <>
                {heroes.length > 0 && (
                    <div className="gor-hero-well">
                        {heroes.map(({ key, descriptor, value, crimson }) => (
                            <div key={key} className="gor-hero">
                                <span className="gor-label" style={crimson ? { color: 'var(--crimson-500)' } : undefined}>{descriptor.label}</span>
                                {descriptor.pips
                                    ? <span className="gor-hero-pips"><CoinPips spend={Math.min(value, 6)} balance={value} /></span>
                                    : <span className="gor-hero-value" style={crimson ? { color: 'var(--crimson-500)' } : undefined}>{formatResourceValue(value, descriptor.unit)}</span>}
                                {key === 'investigations' && <span className="gor-ledger-fine">{value} of {cap}</span>}
                                {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                            </div>
                        ))}
                    </div>
                )}
                {!hasBooks && <p style={quiet}>You have no direct assets.</p>}

                {projection.debt > 0 && (
                    <div className={`gor-ledger-debt${projection.debt >= CREDITORS_PRESS_THRESHOLD ? ' gor-ledger-debt-press' : ''}`} role="status">
                        <span className="gor-ledger-debt-title">{projection.debt >= CREDITORS_PRESS_THRESHOLD ? 'Your creditors press' : 'You are in debt'}</span>
                        <span className="gor-ledger-debt-body">
                            You owe {formatArabic(projection.debt)} denarii. Next week takes {formatArabic(projection.interest)} in interest
                            {projection.treasury >= projection.interest ? ' from the treasury.' : ' — and the treasury cannot pay it, so it is added to the debt.'}
                            {projection.debt >= CREDITORS_PRESS_THRESHOLD ? ` Past ${formatArabic(CREDITORS_PRESS_THRESHOLD)}, a creditor is no longer patient.` : ''}
                        </span>
                    </div>
                )}
                {projection.arrears > 0 && (
                    <div className="gor-ledger-debt gor-ledger-debt-press" role="status">
                        <span className="gor-ledger-debt-title">Your men are owed</span>
                        <span className="gor-ledger-debt-body">
                            {formatArabic(projection.arrears)} denarii of wages stand unpaid. Their loyalty erodes each week it stands; at {toRoman(DESERTION_ARREARS_WEEKS)} weeks&rsquo; pay they begin to desert.
                        </span>
                    </div>
                )}

                <section className="gor-ledger-section" aria-label="This week's ledger">
                    <LedgerHeading
                        title={lastEntry ? `Week ${toRoman(lastEntry.turnNumber)} — the books` : 'The books'}
                        trailing={week && (week.lines.length > 0 || week.dealings.length > 0) ? <Amount value={week.netDenarii} /> : undefined}
                    />
                    {!week ? (
                        <EmptyRegister
                            silhouette={<CofferSilhouette />}
                            line={`The steward opens the books at Week ${toRoman(turnNumber ?? 1)}.`}
                            hint="Wages, yields and interest are booked when the week turns."
                        />
                    ) : week.lines.length === 0 && week.dealings.length === 0 ? (
                        <EmptyRegister
                            silhouette={<CofferSilhouette />}
                            line="Nothing was booked this week."
                            hint="No wages fell due, no estate paid, and nothing was bought or sold."
                        />
                    ) : (
                        <>
                            {week.lines.length > 0 && (
                                <ul className="gor-ledger-lines" aria-label="Engine lines">
                                    {week.lines.map((line, index) => (
                                        <li key={index} className={`gor-ledger-line gor-ledger-line-${line.kind}`}>
                                            <span className="gor-ledger-line-text">
                                                {line.text}
                                                {glossaryOpen && line.detail && <span className="gor-ledger-fine"> ({line.detail})</span>}
                                            </span>
                                            <Amount value={line.amount} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {week.dealings.length > 0 && (
                                <>
                                    <span className="gor-ledger-subhead">Your dealings</span>
                                    <ul className="gor-ledger-lines" aria-label="This week's dealings">
                                        {week.dealings.map((row, index) => (
                                            <li key={index} className="gor-ledger-line gor-ledger-line-dealing">
                                                <span className="gor-ledger-line-text">
                                                    <span className="gor-ledger-line-key">{row.label}</span> — <span style={quiet}>“{row.reason}”</span>
                                                </span>
                                                <Amount value={row.amount} />
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </>
                    )}
                </section>

                <section className="gor-ledger-section" aria-label="Next week's projection">
                    <LedgerHeading title="Next week, at this rate" trailing={<Amount value={projection.flow.net} />} />
                    <div className="gor-ledger-projection">
                        {projection.flow.income.map(item => (
                            <React.Fragment key={item.key}>
                                <span className="gor-ledger-projection-label">{item.label} <span className="gor-ledger-fine">{formatArabic(item.count)} × {formatArabic(item.perUnit)}</span></span>
                                <Amount value={item.total} />
                            </React.Fragment>
                        ))}
                        {projection.flow.upkeep.map(item => (
                            <React.Fragment key={item.key}>
                                <span className="gor-ledger-projection-label">{item.label} <span className="gor-ledger-fine">{formatArabic(item.count)} × {formatArabic(item.perUnit)}</span></span>
                                <Amount value={-item.total} />
                            </React.Fragment>
                        ))}
                        {projection.interest > 0 && (
                            <>
                                <span className="gor-ledger-projection-label">Interest</span>
                                <Amount value={-projection.interest} />
                            </>
                        )}
                        {projection.flow.income.length === 0 && projection.flow.upkeep.length === 0 && projection.interest === 0 && (
                            <span className="gor-ledger-projection-label" style={quiet}>No wages fall due and nothing yields; the treasury stands as it is.</span>
                        )}
                    </div>
                    <div className="gor-ledger-runway">
                        <span className="gor-ledger-runway-balance">
                            <span className="gor-label">Projected treasury</span>
                            <span className="gor-meter-val">{formatArabic(projection.projectedTreasury)}</span>
                        </span>
                        <span className="gor-ledger-runway-line">{runwayLine(projection.runway, projection.flow.net, projection.treasury)}</span>
                    </div>
                </section>

                {rest.map(([key, value]) => {
                    const descriptor = describeResource(key);
                    return (
                        <React.Fragment key={key}>
                            <div className="gor-ledger-row">
                                <span className="gor-label">{descriptor.label}</span>
                                <span className="gor-meter-val">{formatResourceValue(value, descriptor.unit)}</span>
                            </div>
                            {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                        </React.Fragment>
                    );
                })}
            </>
        );
    };

    const renderHoldings = () => {
        if (inventory.length === 0) return (
            <EmptyRegister
                silhouette={<CofferSilhouette />}
                line="You hold no estates, ships or men of your own."
                hint="Holdings arrive by purchase, gift or seizure; the exchequer can raise men."
            />
        );
        const groups: { title: string; rows: typeof inventory }[] = [
            { title: 'Men in your pay', rows: inventory.filter(row => row.category === 'forces') },
            { title: 'Property', rows: inventory.filter(row => row.category === 'holdings' && !row.discrete) },
            { title: 'Things held', rows: inventory.filter(row => row.category === 'holdings' && row.discrete) },
        ].filter(group => group.rows.length > 0);
        return groups.map(group => (
            <section key={group.title} className="gor-ledger-section" aria-label={group.title}>
                <LedgerHeading title={group.title} />
                <ul className="gor-ledger-inventory">
                    {group.rows.map(row => (
                        <li key={row.key} className="gor-ledger-item">
                            <span className="gor-ledger-item-main">
                                <span className="gor-ledger-item-name">{row.label}</span>
                                <span className="gor-meter-val">{formatArabic(row.count)}</span>
                            </span>
                            <span className="gor-ledger-item-meta">
                                {row.upkeepPerWeek > 0 && <span className="gor-ledger-amount-out">−{formatArabic(row.upkeepPerWeek)} a week each</span>}
                                {row.yieldPerWeek > 0 && <span className="gor-ledger-amount-in">+{formatArabic(row.yieldPerWeek)} a week each</span>}
                                {row.key === 'levy_pending' && <span>arrive when the week turns</span>}
                                <span>{typeof row.sinceTurn === 'number' ? `since Week ${toRoman(row.sinceTurn)}` : 'held from the first'}</span>
                            </span>
                            {row.description && <span className="gor-ledger-item-desc">“{row.description}”</span>}
                            {glossaryOpen && <Marginalia>{describeResource(row.key).gloss}</Marginalia>}
                        </li>
                    ))}
                </ul>
            </section>
        ));
    };

    const renderStanding = () => {
        const rows = inRegister('standing');
        if (rows.length === 0) return (
            <EmptyRegister
                line="No one has measured your standing yet."
                hint="Standing is earned in play — and slips while the crisis stands."
            />
        );
        return rows.map(([key, value]) => {
            const descriptor = describeResource(key);
            const numeric = asNumber(value);
            return (
                <React.Fragment key={key}>
                    {descriptor.unit === 'scale' && numeric !== null
                        ? <StandingMeter label={descriptor.label} value={numeric} />
                        : (
                            <div className="gor-ledger-row">
                                <span className="gor-label">{descriptor.label}</span>
                                <span className="gor-meter-val">{formatResourceValue(value, descriptor.unit)}</span>
                            </div>
                        )}
                    {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                </React.Fragment>
            );
        });
    };

    /**
     * Leverage is not a number in a list — it is a shelf of sealed letters
     * (item 22), one per person you hold something over; favours owed sit
     * beside the shelf as a count, because a favour is a coin of its own.
     */
    const renderLeverage = () => {
        const letters = leverage.filter(([, value]) => typeof value !== 'number');
        const counts = leverage.filter(([, value]) => typeof value === 'number');
        if (leverage.length === 0) return (
            <EmptyRegister
                silhouette={<LetterSlotsSilhouette />}
                line="You hold nothing over anyone."
                hint="Leverage accumulates from what you learn, and from what you are owed."
            />
        );
        return (
            <>
                {counts.map(([key, value]) => {
                    const descriptor = describeResource(key);
                    return (
                        <React.Fragment key={key}>
                            <div className="gor-ledger-row">
                                <span className="gor-label" style={{ color: 'var(--crimson-500)' }}>{descriptor.label}</span>
                                <span className="gor-meter-val">{formatResourceValue(value, descriptor.unit)}</span>
                            </div>
                            {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                        </React.Fragment>
                    );
                })}
                {letters.map(([key, value]) => {
                    const descriptor = describeResource(key);
                    const held = Array.isArray(value) ? value : [String(value)];
                    return (
                        <div key={key} className="gor-letter">
                            <WaxSeal letter={descriptor.label.charAt(0)} size={30} tone="crimson" />
                            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <span className="gor-label" style={{ color: 'var(--crimson-500)' }}>{descriptor.label}</span>
                                {held.map((item, index) => <span key={index} style={quiet} title={item}>“{item}”</span>)}
                                {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                            </div>
                        </div>
                    );
                })}
            </>
        );
    };

    /**
     * The exchequer (B1): every bargain the table offers that the player's
     * bag makes sensible - a pay-down only where something is owed, a sale
     * only where something is held to sell. Each row re-prices from the bag
     * on every render.
     */
    const renderExchequer = () => {
        const offered = EXCHANGE_TABLE.filter(entry => {
            if (entry.id === 'repay_debt') return projection.debt > 0;
            if (entry.id === 'pay_arrears') return projection.arrears > 0;
            if (entry.id === 'sell_estates') return numericResource(resources, 'estates') > 0;
            if (entry.id === 'sell_ships') return numericResource(resources, 'ships') > 0;
            if (entry.id === 'call_in_favors') return numericResource(resources, 'favors') > 0;
            return true;
        });
        const closed = !onExchange || !runDomainMutation;
        return (
            <section className="gor-ledger-section" aria-label="The exchequer">
                <p style={{ ...quiet, margin: 0 }}>
                    One holding traded for another at a stated rate, in lots — the friction is the price.
                    Coin: {formatArabic(projection.treasury)} · investigations {numericResource(resources, 'investigations')} of {cap}.
                </p>
                {closed && <p style={{ ...quiet, margin: 0 }}>The exchequer is not open from this view.</p>}
                {receipt && <p className="gor-exchange-receipt" role="status">{receipt}</p>}
                <div className="gor-exchange-list">
                    {offered.map(entry => (
                        <ExchangeRow
                            key={entry.id}
                            entry={entry}
                            resources={resources}
                            busy={busy === entry.id}
                            locked={closed || interactionLocked || (busy !== null && busy !== entry.id)}
                            onStrike={strike}
                            showGloss={glossaryOpen}
                        />
                    ))}
                </div>
            </section>
        );
    };

    return (
        <div className="gor-ledger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SubRail
                ariaLabel="Assets register"
                value={register}
                onChange={selectRegister}
                options={REGISTERS.map(id => ({
                    value: id,
                    label: REGISTER_LABEL[id],
                    ...(id === 'leverage' ? { count: leverage.length, countIsLeverage: true } : {}),
                    ...(id === 'holdings' ? { count: inventory.length } : {}),
                }))}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    type="button"
                    className="gor-glossary-toggle"
                    aria-expanded={glossaryOpen}
                    aria-label={`${glossaryOpen ? 'Hide' : 'Show'} glossary for your assets`}
                    onClick={() => setGlossaryOpen(open => !open)}
                >❧ Glossary</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {register === 'ledger' && renderLedger()}
                {register === 'holdings' && renderHoldings()}
                {register === 'standing' && renderStanding()}
                {register === 'leverage' && renderLeverage()}
                {register === 'exchequer' && renderExchequer()}
            </div>
        </div>
    );
};

export default ResourcesTab;
