import React from 'react';
import { WorldState } from '../types';
import { Medallion, toRoman } from './ui/Brand';

/**
 * Twin-medallion Tyrian vexillum masthead (design system ui_kits/simulation/Header):
 * SENATVS·POPVLVSQVE·ROMANVS kicker, gold cornice, ◆-separated world stats, and
 * the ⚙ Settings affordance. World stats are live from `worldState`. The old
 * dev-only Mock Mode / GM Console switches now live in the configuration
 * menu's Developer card (components/SettingsMenu.tsx).
 */

const Stat: React.FC<{ k: string; v: React.ReactNode; tone?: string }> = ({ k, v, tone }) => (
    <span style={{ padding: '0 16px', display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
        <span className="gor-label" style={{ color: '#D8B98A' }}>{k}</span>
        <span style={{ color: tone || '#F8F1DE', fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>{v}</span>
    </span>
);

const Gem: React.FC = () => (
    <span aria-hidden="true" style={{ color: 'rgba(232,201,89,.55)', fontSize: 8, alignSelf: 'center' }}>◆</span>
);

const Header: React.FC<{
    worldState: WorldState,
    /** D31 - opens the configuration menu (components/SettingsMenu.tsx). */
    onOpenSettings: () => void,
}> = ({ worldState, onOpenSettings }) => (
    <header style={{ position: 'relative', textAlign: 'center', padding: '14px 24px 13px', borderBottom: '1px solid #38122A', background: 'var(--dentil) left bottom/100% 4px no-repeat, linear-gradient(180deg,#7E3A5E,#5E2246 55%,#43172F)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.15), 0 2px 6px rgba(74,56,20,.35)', flex: 'none' }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: 'linear-gradient(180deg,#E8C959,#A5831D)' }}></span>
        <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open configuration menu"
            title="Configuration — API key, pacing, lighting, GM console"
            style={{ position: 'absolute', top: 12, left: 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(0,0,0,.28)', border: '1px solid rgba(232,201,89,.3)', borderRadius: 'var(--radius-sm)', color: '#D8B98A', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' }}
        >⚙ Settings</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
            <Medallion size={68} />
            <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11, letterSpacing: '.42em', color: '#D8B98A', textShadow: '0 1px 1px rgba(0,0,0,.4)' }}>SENATVS · POPVLVSQVE · ROMANVS</div>
                <h1 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 33, color: '#F0D089', textShadow: '0 2px 3px rgba(0,0,0,.5)', letterSpacing: '.02em', lineHeight: 1.15, margin: '2px 0' }}>Roman Crisis Simulation</h1>
                <div className="gor-label" style={{ color: '#E8C959' }}>The Glory of Rome · {worldState.year + 753} Ab Urbe Condita</div>
            </div>
            <Medallion size={68} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <Stat k="Year" v={`${worldState.year} CE`} />
            <Gem />
            <Stat k="Week" v={toRoman(worldState.week)} />
            <Gem />
            <Stat k="Economic Stability" v={worldState.economic_stability} tone="#E9B36A" />
            <Gem />
            <Stat k="Political Climate" v={worldState.political_climate} tone="#F0A196" />
        </div>
    </header>
);

export default Header;
