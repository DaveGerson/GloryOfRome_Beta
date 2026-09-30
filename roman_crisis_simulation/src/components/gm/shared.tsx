import React from 'react';
import type { ComposureRoll } from '../../types';

export const GOLD = '#F0D089', DIM = '#A99A76', PARCH = '#E6E1D0', RED = '#E0968B', GREEN = '#A8BC7E';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const lbl: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: DIM };
export const well: React.CSSProperties = { background: 'rgba(0,0,0,.32)', border: '1px solid rgba(201,162,39,.22)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' };

/** The console's one quiet-note / empty-state paragraph treatment. */
export const GmNote: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ color: DIM, margin: 0 }}>{children}</p>;

/**
 * A GM-private note must never be mistakable for narration you would read
 * aloud: a crimson wax edge and a redaction weave across the ground.
 */
export const redacted: React.CSSProperties = {
    borderLeft: '4px solid var(--metal-crimson)',
    background: 'repeating-linear-gradient(102deg,rgba(179,58,43,.07) 0 1px,transparent 1px 7px), rgba(0,0,0,.32)',
    border: '1px solid rgba(179,58,43,.45)',
    borderLeftWidth: 4,
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
};

/**
 * The Tyrian treatment `RawRegister` wears for the system instruction, lifted
 * to a const so the monologue slip can wear the SAME one rather than a second
 * near-identical purple.
 */
export const tyrian: React.CSSProperties = { background: 'rgba(94,34,70,.22)', border: '1px solid rgba(94,34,70,.5)' };
export const TYRIAN_KICKER = '#C89BB4';

/**
 * One composure roll (D50) as the console reads it beside its die: the
 * subject's kind and weight, the bearer's modifier against the difficulty,
 * and the tier - "mark serious · +1.5 vs 10 → frays". GM-only, like every
 * roll (D4).
 */
export function composureRollNote(roll: Pick<ComposureRoll, 'subjectKind' | 'severity' | 'tieKind' | 'modifier' | 'difficulty' | 'tier'>): string {
    const weight = roll.subjectKind === 'mark' ? roll.severity : roll.tieKind;
    const modifier = `${roll.modifier >= 0 ? '+' : '−'}${Math.abs(roll.modifier)}`;
    return `${roll.subjectKind}${weight ? ` ${weight}` : ''} · ${modifier} vs ${roll.difficulty} → ${roll.tier}`;
}
