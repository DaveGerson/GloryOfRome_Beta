import React from 'react';
import type { PlayerComposureNote } from '../perception/visibility';
import { TIE_KIND_WORD } from '../ai/core/composure';
import { MARKS_COPY } from './ui/Marks';

/**
 * The player's own composure in a private scene (DESIGN_DECISIONS.md D50 -
 * the one exception to D4): for each of their inward marks and secret ties,
 * whether it held, frayed or broke, what that means, and EXACTLY what the
 * other party was told of it - or that they were told nothing. Words only:
 * the die, the modifier and the difficulty never reach this component (the
 * projection, perception/visibility.ts, carries no number).
 */

/** Player-visible copy for the composure note (veto queue: roadmaps/BACKLOG.md B13). */
export const COMPOSURE_COPY = {
    title: 'Your composure',
    gloss: 'What you could keep from showing, settled as the door closed behind you.',
    outcome: { held: 'Held', frayed: 'Frayed', broke: 'Broke' },
    meaning: {
        mark: {
            held: 'You kept it behind your face. It shows only if you choose to speak of it.',
            frayed: 'It slipped at moments — in the voice, in the eyes — though never its cause.',
            broke: 'It showed through plainly, whatever you said: named, but never its whole account.',
        },
        tie: {
            held: 'You kept it close. It shows only if you choose to confide it.',
            frayed: 'A gesture, a word caught back: a hint of some devotion slipped, never its name.',
            broke: (kind: string) => `It showed plainly that you keep some secret ${kind}, though not which.`,
        },
    },
    told: (npcName: string) => `What ${npcName} was told:`,
    toldNothing: (npcName: string) => `${npcName} was told nothing of it.`,
} as const;

const firstUpper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What one outcome means, in the game's voice. */
export function composureMeaning(note: PlayerComposureNote): string {
    if (note.subjectKind === 'mark') return COMPOSURE_COPY.meaning.mark[note.outcome];
    if (note.outcome === 'broke') return COMPOSURE_COPY.meaning.tie.broke(TIE_KIND_WORD[note.tieKind ?? 'other']);
    return COMPOSURE_COPY.meaning.tie[note.outcome];
}

export const ComposureNotes: React.FC<{ notes: readonly PlayerComposureNote[] | undefined; npcName: string }> = ({ notes, npcName }) => {
    if (!notes || notes.length === 0) return null;
    return (
        <section className="gor-composure" aria-label={COMPOSURE_COPY.title}>
            <h4 className="gor-composure-title">{COMPOSURE_COPY.title}</h4>
            <p className="gor-composure-gloss">{COMPOSURE_COPY.gloss}</p>
            <ul className="gor-composure-list">
                {notes.map((note, index) => (
                    <li key={`${note.subjectKind}-${index}`} className={`gor-composure-note gor-composure-${note.outcome}`}>
                        <span className="gor-composure-head">
                            <span className="gor-composure-subject">{firstUpper(note.subjectName)}</span>
                            <span className="gor-mark-flag">{note.subjectKind === 'mark' ? MARKS_COPY.inward : MARKS_COPY.keptSecret}</span>
                            <span className="gor-composure-outcome">{COMPOSURE_COPY.outcome[note.outcome]}</span>
                        </span>
                        <span className="gor-composure-meaning">{composureMeaning(note)}</span>
                        {note.told
                            ? <span className="gor-composure-told">{COMPOSURE_COPY.told(npcName)} <q>{note.told}</q></span>
                            : <span className="gor-composure-told">{COMPOSURE_COPY.toldNothing(npcName)}</span>}
                    </li>
                ))}
            </ul>
        </section>
    );
};
