import React, { useState } from 'react';
import { Entity } from '../../types';
import { SubRail } from '../ui/SubRail';
import { WaxSeal } from '../ui/Brand';
import { CoinPips, Marginalia } from './dramatisPersonaeUi';
import { describeResource, formatResourceValue, ResourceRegister } from './resourceDescriptors';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

const REGISTERS: readonly ResourceRegister[] = ['coin', 'standing', 'leverage'];
const REGISTER_LABEL: Record<ResourceRegister, string> = { coin: 'Coin', standing: 'Standing', leverage: 'Leverage' };

/** The three counters a player checks before every decision. */
const HERO_KEYS = ['denarii', 'investigations', 'deep_analyses'] as const;

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * A scalar standing, drawn as a meter — item 23's COUNTED register: a crisp
 * numeral over a solid track, for a figure the simulation actually holds.
 * Scales run 0-100 by convention in this model.
 */
const StandingMeter: React.FC<{ label: string; value: number }> = ({ label, value }) => {
    const share = Math.max(0, Math.min(100, value));
    return (
        <div className="gor-meter" style={{ padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
            <div className="gor-meter-row">
                <span className="gor-label">{label}</span>
                <span className="gor-meter-val">{value.toLocaleString('en-US')}</span>
            </div>
            <div className="gor-meter-track">
                <div className="gor-meter-fill" style={{ width: `${share}%`, background: 'var(--metal-gold)' }} />
            </div>
        </div>
    );
};

/**
 * The Assets tab (audit items 21-23, 34). Three registers rather than two
 * buckets picked by substring: what you can spend, what you are owed, and what
 * you hold over other people.
 *
 * Every label, unit and register comes from ./resourceDescriptors — in
 * particular the unit, which used to be inferred from the value itself and so
 * printed 62.5 as "62.5%" and 80 as "80", the same quantity in two units.
 */
const ResourcesTab: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    const [register, setRegister] = useState<ResourceRegister>(() => getTabRegister('resources', REGISTERS, 'coin'));
    // Nine † daggers in one view collapse to one ❧ Glossary, as in the dossier.
    const [glossaryOpen, setGlossaryOpen] = useState(false);

    if (!playerEntity?.resources) {
        return <p style={quiet}>No resources to display.</p>;
    }

    const entries = Object.entries(playerEntity.resources) as [string, string | number | string[]][];
    const inRegister = (target: ResourceRegister) => entries.filter(([key]) => describeResource(key).register === target);
    const leverage = inRegister('leverage');

    const selectRegister = (next: ResourceRegister) => {
        setRegister(next);
        setTabRegister('resources', next);
    };

    const heroes: { key: string; descriptor: ReturnType<typeof describeResource>; value: number }[] = [];
    for (const key of HERO_KEYS) {
        const value = asNumber(playerEntity.resources[key]);
        if (value !== null) heroes.push({ key, descriptor: describeResource(key), value });
    }

    const renderCoin = () => {
        const rest = inRegister('coin').filter(([key]) => !HERO_KEYS.some(hero => hero === key));
        if (heroes.length === 0 && rest.length === 0) return <p style={quiet}>You have no direct assets.</p>;
        return (
            <>
                {heroes.length > 0 && (
                    <div className="gor-hero-well">
                        {heroes.map(({ key, descriptor, value }) => (
                            <div key={key} className="gor-hero">
                                <span className="gor-label">{descriptor.label}</span>
                                {descriptor.pips
                                    ? <span className="gor-hero-pips"><CoinPips spend={Math.min(value, 6)} balance={value} /></span>
                                    : <span className="gor-hero-value">{formatResourceValue(value, descriptor.unit)}</span>}
                                {glossaryOpen && <Marginalia>{descriptor.gloss}</Marginalia>}
                            </div>
                        ))}
                    </div>
                )}
                {rest.map(([key, value]) => {
                    const descriptor = describeResource(key);
                    return (
                        <React.Fragment key={key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
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

    const renderStanding = () => {
        const rows = inRegister('standing');
        if (rows.length === 0) return <p style={quiet}>You currently hold no significant influence.</p>;
        return rows.map(([key, value]) => {
            const descriptor = describeResource(key);
            const numeric = asNumber(value);
            return (
                <React.Fragment key={key}>
                    {descriptor.unit === 'scale' && numeric !== null
                        ? <StandingMeter label={descriptor.label} value={numeric} />
                        : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
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
     * (item 22), one per person you hold something over.
     */
    const renderLeverage = () => {
        if (leverage.length === 0) return <p style={quiet}>You hold nothing over anyone.</p>;
        return leverage.map(([key, value]) => {
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
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SubRail
                ariaLabel="Assets register"
                value={register}
                onChange={selectRegister}
                options={REGISTERS.map(id => ({
                    value: id,
                    label: REGISTER_LABEL[id],
                    ...(id === 'leverage' ? { count: leverage.length, countIsLeverage: true } : {}),
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {register === 'coin' && renderCoin()}
                {register === 'standing' && renderStanding()}
                {register === 'leverage' && renderLeverage()}
            </div>
        </div>
    );
};

export default ResourcesTab;
