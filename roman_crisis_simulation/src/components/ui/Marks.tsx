import React from 'react';
import type { AffiliationKind, ConditionSeverity } from '../../types';
import { Tooltip } from './Feedback';
import { toRoman } from './Brand';

/**
 * Player-visible copy for the marks registers (D48) and the ties registers
 * (D49) - one home, so the player's own status panel and the Personae cards
 * never word a mark or a tie two ways (veto queue: roadmaps/BACKLOG.md).
 */
export const MARKS_COPY = {
    ownLabel: 'Marks you bear',
    ownGloss: 'Lasting marks the story has left on you. They weigh on what you attempt; time and events may ease or heal them.',
    seenLabel: 'Marks seen',
    inward: 'Borne inwardly',
    ownTiesLabel: 'Your ties',
    ownTiesGloss: 'The factions, causes and faiths you hold to. One kept secret is known only to you, and to anyone who learns it.',
    keptSecret: 'Kept secret',
    tiesLabel: 'Ties',
    knownToYou: 'Known to you',
    signsLabel: 'Signs seen',
    signsGloss: 'Tells you caught in their face or voice. What lies behind them is not yours to know yet.',
} as const;

/** One mark as a register draws it: a Condition, or a mark as the player perceived it. */
export interface MarkView {
    id: string;
    name: string;
    description: string;
    severity: ConditionSeverity;
    outward: boolean;
}

const firstUpper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A register of lasting marks. `flagInward` marks the ones only their
 * bearer knows of - on the player's own panel, the one place inward marks
 * appear at all.
 *
 * `compact` is the status panel's form. That panel sits above every
 * register, and a 720px laptop cannot spare it a line per detail, so the
 * marks run on in one wrapping line and each one's weight and account open
 * on hover or focus, as the † glosses do. A Personae card has the room: one
 * mark a line, its weight beside it and its account beneath.
 */
export const MarkList: React.FC<{ marks: readonly MarkView[]; flagInward?: boolean; compact?: boolean }> = ({ marks, flagInward = false, compact = false }) => (
    <ul className={`gor-marks${compact ? ' gor-marks-compact' : ''}`}>
        {marks.map(mark => (
            <li key={mark.id} className="gor-mark">
                {compact
                    ? <Tooltip wide label={mark.description ? `${firstUpper(mark.severity)} — ${mark.description}` : firstUpper(mark.severity)}>
                        <span tabIndex={0} className="gor-mark-name gor-mark-name-gloss">{firstUpper(mark.name)}</span>
                    </Tooltip>
                    : <>
                        <span className="gor-mark-name">{firstUpper(mark.name)}</span>
                        <span className="gor-mark-weight"> · {mark.severity}</span>
                    </>}
                {flagInward && !mark.outward && <span className="gor-mark-flag">{MARKS_COPY.inward}</span>}
                {!compact && mark.description && <span className="gor-mark-desc">{mark.description}</span>}
            </li>
        ))}
    </ul>
);

/**
 * The signs the player caught on a figure (D50): each tell as they saw or
 * heard it, and the turn they caught it. Only ever the sentence - never the
 * mark or tie behind it, which the player's knowledge store does not hold.
 */
export const SignList: React.FC<{ signs: readonly { text: string; turn: number }[] }> = ({ signs }) => (
    <ul className="gor-marks">
        {signs.map((sign, index) => (
            <li key={index} className="gor-mark">
                <span className="gor-sign-text">{sign.text}</span>
                <span className="gor-mark-weight"> · Turn {toRoman(sign.turn)}</span>
            </li>
        ))}
    </ul>
);

/** One tie as a register draws it: an Affiliation, or a tie as the player came to know it. */
export interface TieView {
    id: string;
    name: string;
    kind: AffiliationKind;
    /** Shown with this flag beside it (the player's own "Kept secret", a learned one's "Known to you"), or none. */
    flag?: string;
}

/**
 * A register of ties (D49): the tie, and the flag its register gives it. On
 * a Personae card each tie takes a line with its kind ("other" goes
 * unsaid); `compact`, on the status panel, they run on in one wrapping line
 * and the kind is left to the name.
 */
export const TieList: React.FC<{ ties: readonly TieView[]; compact?: boolean }> = ({ ties, compact = false }) => (
    <ul className={`gor-marks${compact ? ' gor-marks-compact' : ''}`}>
        {ties.map(tie => (
            <li key={tie.id} className="gor-mark">
                <span className="gor-mark-name">{firstUpper(tie.name)}</span>
                {!compact && tie.kind !== 'other' && <span className="gor-mark-weight"> · {tie.kind}</span>}
                {tie.flag && <span className="gor-mark-flag">{tie.flag}</span>}
            </li>
        ))}
    </ul>
);
