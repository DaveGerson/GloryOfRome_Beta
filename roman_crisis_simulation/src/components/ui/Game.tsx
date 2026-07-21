import React from 'react';
import { Badge } from './Core';

/** Game-specific primitives from the Glory of Rome design system (components/game). */

export const ActionPill: React.FC<{ delay?: number; style?: React.CSSProperties; [key: string]: any }> =
    ({ delay = 0, children, style, ...rest }) => (
        <button type="button" className="gor-pill" style={{ animationDelay: delay + 'ms', ...style }} {...rest}>
            <span aria-hidden="true" style={{ color: 'var(--gold-600)', fontSize: 12 }}>❧</span>{children}
        </button>
    );

const DEFAULT_LINES = ['Whispers cross the Senate floor…', 'Your rivals move in the dark…', 'Couriers ride from the frontier…', 'The chronicler sets down the day…'];

export const TypingIndicator: React.FC<{ lines?: string[]; intervalMs?: number }> =
    ({ lines = DEFAULT_LINES, intervalMs = 3200 }) => {
        const [i, setI] = React.useState(0);
        React.useEffect(() => {
            const id = setInterval(() => setI(p => (p + 1) % lines.length), intervalMs);
            return () => clearInterval(id);
        }, [lines, intervalMs]);
        return (
            <div className="gor-typing" role="status" aria-live="polite">
                <span className="gor-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span className="gor-typing-text">{lines[i % lines.length]}</span>
            </div>
        );
    };

export const TrustBar: React.FC<{ level?: number; label?: React.ReactNode; style?: React.CSSProperties }> =
    ({ level = 0, label, style }) => {
        const clamped = Math.max(-10, Math.min(10, level));
        const pct = ((clamped + 10) / 20) * 100;
        const tone = clamped > 3 ? 'var(--laurel-500)' : clamped < -3 ? 'var(--crimson-500)' : 'var(--ink-500)';
        const sign = clamped > 0 ? '+' + clamped : String(clamped);
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
                {label && <div className="gor-meter-row"><span className="gor-label">{label}</span><span className="gor-meter-val">{sign}</span></div>}
                <div className="gor-trust" title={'Trust: ' + sign} role="meter" aria-valuenow={clamped} aria-valuemin={-10} aria-valuemax={10}>
                    <div className="gor-trust-fill" style={{ width: pct + '%', background: tone }}></div>
                    <div className="gor-trust-zero"></div>
                </div>
            </div>
        );
    };

const difficultyTones: Record<string, 'crimson' | 'bronze' | 'laurel'> = { Hard: 'crimson', Medium: 'bronze', Easy: 'laurel' };

export const DestinyCard: React.FC<{
    name: React.ReactNode;
    description: React.ReactNode;
    difficulty?: string;
    numeral?: string;
    seal?: string;
    motto?: string;
    onSelect?: () => void;
    style?: React.CSSProperties;
}> = ({ name, description, difficulty = 'Medium', numeral, seal, motto, onSelect, style }) => (
    <button type="button" className="gor-destiny" onClick={onSelect} style={style}>
        {numeral && <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '.32em', textTransform: 'uppercase', color: 'var(--gold-700)' }}>Destiny {numeral}</span>}
        {seal && <span aria-hidden="true" style={{ width: 46, height: 46, margin: '2px auto 2px', display: 'grid', placeItems: 'center', borderRadius: '46% 54% 52% 48% / 52% 46% 54% 48%', background: 'radial-gradient(circle at 35% 30%, #C04434, #8C1C13 62%, #6E140D)', boxShadow: 'inset 0 2px 3px rgba(255,255,255,.28), inset 0 -3px 5px rgba(0,0,0,.35), 0 2px 5px rgba(58,44,16,.35)', color: '#F2D9C8', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, textShadow: '0 -1px 1px rgba(0,0,0,.4)' }}>{seal}</span>}
        <span className="gor-destiny-name">{name}</span>
        <span className="gor-destiny-desc">{description}</span>
        {motto && <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>❦ {motto} ❦</span>}
        <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', paddingTop: 8 }}><Badge tone={difficultyTones[difficulty] || 'neutral'}>{difficulty}</Badge></span>
    </button>
);
