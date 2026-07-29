import React from 'react';

/**
 * The brand kit from the Glory of Rome design system (ui_kits/simulation/Brand.jsx):
 * the aquila mark rendered as gilt metalwork, the clipeus medallion, wax seals,
 * the SPQR tablet, week-advance turn ribbons, and Roman-numeral formatting.
 */

export const AQUILA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor" width="100%" height="100%"><path d="M50 10C30 10 15 25 15 45c0 10 5 20 12 26-3-5-5-11-5-17 0-15 12-27 27-27s27 12 27 27c0 6-2 12-5 17 7-6 12-16 12-26 0-20-15-35-35-35zm0 2c18 0 33 14 33 33 0 9-4 18-10 24-2-2-4-4-6-5-2-2-5-3-8-3-10 0-18 8-18 18h-2c0-10-8-18-18-18-3 0-6 1-8 3-2 1-4 3-6 5-6-6-10-15-10-24 0-19 15-33 33-33zm-1 30c-12 0-22 10-22 22 0 4 1 8 3 11 3-2 6-3 10-3 11 0 20 9 20 20v1h-2c-11 0-20-9-20-20 0-5 2-10 6-13-1-3-2-6-2-9 0-10 8-18 18-18s18 8 18 18c0 3-1 6-2 9 4 3 6 8 6 13 0 11-9 20-20 20h-2v-1c0-11 9-20 20-20 4 0 7 1 10 3 2-3 3-7 3-11 0-12-10-22-22-22zM50 78c-8 0-15-7-15-15s7-15 15-15 15 7 15 15-7 15-15 15z"/></svg>';
const AQUILA_MASK = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(AQUILA) + '")';

export function toRoman(n: number): string {
    const T: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '', x = Math.max(1, Math.round(n));
    for (const [v, r] of T) while (x >= v) { s += r; x -= v; }
    return s;
}

/* The aquila cut as a mask and filled with gilt metal — the mark rendered as metalwork, not a flat glyph. */
export const GildedAquila: React.FC<{ size?: number; flip?: boolean; metal?: string; style?: React.CSSProperties }> =
    ({ size = 52, flip, metal = 'var(--metal-gold)', style }) => (
        <span aria-hidden="true" style={{ width: size, height: size, display: 'inline-block', flex: 'none', background: metal, WebkitMaskImage: AQUILA_MASK, maskImage: AQUILA_MASK, WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center', transform: flip ? 'scaleX(-1)' : undefined, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.35))', ...style }}></span>
    );

/* One laurel branch — simple ellipse leaves set on an orbit by code. side: -1 left, 1 right. */
const Leaves: React.FC<{ r: number; size: number; side: number }> = ({ r, size, side }) => {
    const out = [];
    for (let i = 0; i < 9; i++) {
        const a = side * (26 + i * 16.5);
        out.push(<span key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: size * .085, height: size * .16, marginLeft: -size * .0425, marginTop: -size * .08, borderRadius: '50% 50% 50% 50% / 62% 62% 38% 38%', background: 'linear-gradient(180deg,#E8C959,#A5831D)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,.4), 0 1px 2px rgba(0,0,0,.35)', transform: 'rotate(' + a + 'deg) translateY(' + (-r) + 'px) rotate(' + (side * 36) + 'deg)' }}></span>);
    }
    return <>{out}</>;
};

/* The brand mark: a gilt clipeus medallion — gold ring, Tyrian field, laurel wreath, metal aquila. */
export const Medallion: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 96, style }) => {
    const s = size;
    return (
        <span aria-hidden="true" style={{ position: 'relative', width: s, height: s, display: 'inline-block', flex: 'none', ...style }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--metal-gold)', boxShadow: '0 3px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.3)' }}></span>
            <span style={{ position: 'absolute', inset: s * .055, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #8E4368, #5E2246 55%, #38122A)', boxShadow: 'inset 0 2px 6px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.12)' }}></span>
            <Leaves r={s * .37} size={s} side={-1} />
            <Leaves r={s * .37} size={s} side={1} />
            <span style={{ position: 'absolute', left: '50%', bottom: s * .04, transform: 'translateX(-50%)', color: '#E8C959', fontSize: Math.max(7, s * .09), lineHeight: 1, textShadow: '0 1px 1px rgba(0,0,0,.5)' }}>◆</span>
            <GildedAquila size={s * .46} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.55))' }} />
        </span>
    );
};

/* Engraved S·P·Q·R tablet for dark banners. */
export const SPQR: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
    <span style={{ display: 'inline-block', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, lineHeight: 1, letterSpacing: '.26em', color: '#F0D089', border: '1px solid rgba(232,201,89,.5)', padding: '4px 5px 4px 9px', background: 'rgba(0,0,0,.2)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.12)', ...style }}>S·P·Q·R</span>
);

/* Pure-CSS wax seal with a pressed initial. tone: crimson (official) | tyrian (rumor/intrigue). */
export const WaxSeal: React.FC<{ letter?: string; size?: number; tone?: 'crimson' | 'tyrian'; style?: React.CSSProperties }> =
    ({ letter = 'R', size = 46, tone = 'crimson', style }) => {
        // The wax itself is tokenised (WP-10) so nocturne.css can warm it by
        // torchlight; the day values are byte-identical to the old literals.
        const bg = tone === 'tyrian' ? 'var(--seal-tyrian)' : 'var(--seal-crimson)';
        return <span aria-hidden="true" style={{ width: size, height: size, display: 'inline-grid', placeItems: 'center', flex: 'none', borderRadius: '46% 54% 52% 48% / 52% 46% 54% 48%', background: bg, boxShadow: 'inset 0 2px 3px rgba(255,255,255,.28), inset 0 -3px 5px rgba(0,0,0,.35), 0 2px 5px rgba(58,44,16,.35)', color: 'var(--seal-letter)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * .42, textShadow: '0 -1px 1px rgba(0,0,0,.4)', ...style }}>{letter}</span>;
    };

/**
 * The week-advance ribbon between chat turns — a hanging vexillum, not two
 * hairlines (audit item 14). Tyrian metal under a gold cornice, cut with a
 * swallowtail hem, carrying the week in ceremonial numerals over the Roman
 * date the guide asks for.
 *
 * `date` is optional: ribbons written before this pass carry only their text,
 * and render as the single week line they always did.
 */
export const TurnRibbon: React.FC<{ children?: React.ReactNode; date?: { roman: string; plain: string } }> =
    ({ children, date }) => (
        <div className="gor-vexillum-row">
            <div className="gor-vexillum">
                <span aria-hidden="true" className="gor-vexillum-cornice"></span>
                <span className="gor-vexillum-week">{children}</span>
                {date && <span className="gor-vexillum-date" title={date.plain}>{date.roman}</span>}
            </div>
        </div>
    );
