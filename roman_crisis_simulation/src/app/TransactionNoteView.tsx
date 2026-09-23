/**
 * app/TransactionNoteView.tsx
 *
 * How a non-turn transaction note renders, and the "Take a copy of the
 * reign" download it (and the configuration menu) offers. Moved verbatim
 * out of App.tsx (2026-09-23); App still owns WHEN a note shows.
 */

import React from 'react';
import { loadGame, rawSaveBlob } from '../persistence/saveGame';
import { Alert, RECORD_REFUSES } from '../components/ui/Alert';
import { HalfCommitNotice, SaveFailureNotice } from '../components/ui/FailureNotices';
import type { TransactionNote } from './transactions';

/**
 * The reign as it sits on disk — what "Take a copy of the reign" hands over
 * (WP-21, restored 2026-08-05). Not a privacy boundary: D45 as amended rules
 * the blob's GM-side content spoiler material, not private material — see
 * `rawSaveBlob`'s own doc comment.
 */
export function downloadTheReign(): void {
    const blob = rawSaveBlob();
    if (!blob) return;
    const parsed = JSON.parse(blob) as { state?: { turnNumber?: number } };
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gor-reign-week${parsed.state?.turnNumber ?? 0}.json`;
    anchor.click();
    // Same deferral as the eval-corpus export: revoking synchronously can
    // abort the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const TransactionNoteView: React.FC<{ note: TransactionNote; style?: React.CSSProperties }> = ({ note, style }) => {
    if (note.kind === 'half_commit') return <HalfCommitNotice style={style} />;
    if (note.kind === 'plain') return <Alert title={RECORD_REFUSES} style={style}>{note.message}</Alert>;
    // Derived from whether a save actually loads, never defaulted to a
    // week: with storage dead since boot, a corrupted blob or a version
    // the loader rejects there IS no last safe week, and "safe up to
    // Week I" would be the notice's one falsehood. `null` says so — and the
    // copy action gates on the SAME read, so "there is no last safe week"
    // and "no copy to take" can never disagree.
    const lastSafe = loadGame()?.state.turnNumber ?? null;
    return (
        <SaveFailureNotice
            lead={note.lead}
            lastSafeTurn={lastSafe}
            onTakeCopy={lastSafe === null ? undefined : downloadTheReign}
            style={style}
        />
    );
};
