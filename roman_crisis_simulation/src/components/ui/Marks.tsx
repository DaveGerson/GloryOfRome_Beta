import React from 'react';
import type { ConditionSeverity } from '../../types';
import { Tooltip } from './Feedback';

/**
 * Player-visible copy for the marks registers (D48) - one home, so the
 * player's own status panel and the Personae cards never word a mark two
 * ways (veto queue: roadmaps/BACKLOG.md).
 */
export const MARKS_COPY = {
    ownLabel: 'Marks you bear',
    ownGloss: 'Lasting marks the story has left on you. They weigh on what you attempt; time and events may ease or heal them.',
    seenLabel: 'Marks seen',
    inward: 'Borne inwardly',
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
 * A register of lasting marks: the mark, its weight, and how it shows.
 * `flagInward` marks the ones only their bearer knows of - on the player's
 * own panel, the one place inward marks appear at all.
 *
 * `compact` is the status panel's form: the panel sits above every register
 * and a 720px laptop cannot spare it a paragraph per mark, so each mark is
 * one line and its account opens on hover or focus, as the † glosses do.
 * A Personae card has the room, and shows the account beneath the name.
 */
export const MarkList: React.FC<{ marks: readonly MarkView[]; flagInward?: boolean; compact?: boolean }> = ({ marks, flagInward = false, compact = false }) => (
    <ul className={`gor-marks${compact ? ' gor-marks-compact' : ''}`}>
        {marks.map(mark => {
            const name = <span className="gor-mark-name">{firstUpper(mark.name)}</span>;
            return (
                <li key={mark.id} className="gor-mark">
                    {compact && mark.description
                        ? <Tooltip wide label={mark.description}><span tabIndex={0} className="gor-mark-name gor-mark-name-gloss">{firstUpper(mark.name)}</span></Tooltip>
                        : name}
                    <span className="gor-mark-weight"> · {mark.severity}</span>
                    {flagInward && !mark.outward && <span className="gor-mark-flag">{MARKS_COPY.inward}</span>}
                    {!compact && mark.description && <span className="gor-mark-desc">{mark.description}</span>}
                </li>
            );
        })}
    </ul>
);
