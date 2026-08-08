import React from 'react';
import { TurnHistoryEntry } from '../../types';
import { well, lbl, redacted, tyrian, TYRIAN_KICKER, DIM, PARCH, RED, MONO } from './shared';

// ── WP-19: Narration · Raw · Fixtures ─────────────────────────────────
// Three questions the console could not answer: what the player actually
// received and what was cut from it; which round-trips it took and what was
// sent; and what would leave the room if you exported this turn.

/** A headline the boundary dropped, or a reason/notes it replaced. */
function isHeadlineSurface(surface: string): boolean {
    return surface.startsWith('headlines[');
}

/**
 * How the turn's narration arrived, when the record says. `streamChunks` is
 * written only by `generateStructuredStream`, so a mock turn, a non-streamed
 * narration and an entry whose rawCalls `stripOldRawCalls` dropped all yield
 * `undefined` - and the clause is then OMITTED rather than rendered as
 * "0 chunks".
 */
function narrationChunkClause(entry: TurnHistoryEntry): string {
    const streamed = (entry.rawCalls ?? []).find(
        call => call.callName === 'narration' && call.streamChunks !== undefined);
    return streamed ? ` · streamed in ${streamed.streamChunks} chunks` : '';
}

/**
 * What the player received, and what was withheld. The narration reads on
 * the tablet register (WP-10's `--tablet-*`, so it inverts under NOX with
 * the Dispatches tablet); the right column is the boundary.
 *
 * Exported for direct component testing (tests/gmNarrationPane.test.tsx);
 * the console itself still reaches it through GameMasterScreen's re-export
 * of this module.
 */
export const NarrationView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const redactions = entry.proseRedactions ?? [];
    const cutHeadlines = redactions.filter(cut => isHeadlineSurface(cut.surface));
    // Three-way (types.ts): undefined = the entry predates the record,
    // '' = the turn composed none, non-empty = render it. A zero state names
    // its cause (D45) and stays at FULL opacity - nothing here is disabled.
    const monologue = entry.playerMonologue;
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                    <span style={lbl}>Narration — {(entry.narration ?? '').length} chars{narrationChunkClause(entry)}</span>
                    <div className="gor-gm-tablet gor-dropcap">{entry.narration || 'No narration generated.'}</div>
                </div>
                <div style={{ ...well, ...tyrian }}>
                    <span style={{ ...lbl, color: TYRIAN_KICKER }}>Inner thoughts</span>
                    {monologue
                        ? <p style={{ margin: '6px 0 0', fontSize: 13, color: PARCH, fontStyle: 'italic' }}>{monologue}</p>
                        : (
                            <p style={{ margin: '6px 0 0', fontSize: 13, color: PARCH }}>
                                {monologue === undefined
                                    ? 'This turn predates the monologue record.'
                                    : 'No monologue was composed this turn.'}
                            </p>
                        )}
                </div>
                <div style={well}>
                    <span style={lbl}>Headlines</span>
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {entry.adjudication.headlines.map((headline, index) => (
                            <span key={index} style={{ fontSize: 14, color: PARCH }}>❧ {headline}</span>
                        ))}
                        {cutHeadlines.map((cut, index) => (
                            <span key={`cut-${index}`} className="gor-gm-struck" style={{ fontSize: 14, color: RED }}>
                                × {cut.original}
                            </span>
                        ))}
                        {entry.adjudication.headlines.length === 0 && cutHeadlines.length === 0 && (
                            <span style={{ color: DIM }}>No headlines this turn.</span>
                        )}
                    </div>
                </div>
            </div>
            <div style={{ flex: 'none', width: 352, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={lbl}>The boundary</span>
                {redactions.length === 0 ? (
                    <div className="gor-gm-laurel">
                        <span style={{ fontSize: 14 }}>Nothing was withheld this turn.</span>
                        <span style={{ fontSize: 12.5, fontStyle: 'italic', color: DIM }}>
                            An empty boundary is a result, not an absence. Kept only for the session — a turn
                            restored from a save shows none.
                        </span>
                    </div>
                ) : redactions.map((cut, index) => (
                    <div key={index} style={redacted}>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: RED }}>{cut.surface}</span>
                        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: DIM }}>
                            Read as the player acting, with no attempt on record.
                        </p>
                        <p className="gor-gm-weave" style={{ margin: '6px 0 0', fontSize: 13, color: PARCH }}>{cut.original}</p>
                        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: DIM }}>
                            → {isHeadlineSurface(cut.surface) ? 'dropped entirely' : '“Something shifts, unremarked.”'}
                        </p>
                    </div>
                ))}
                <div style={well}>
                    <span style={lbl}>The narrator's blindfold</span>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: PARCH, fontStyle: 'italic' }}>
                        “A character quietly advanced a private design this turn; its nature is not observable.”
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 12.5, color: DIM }}>
                        Substituted for every scheme delta's reason in the narration and intelligence prompts.
                        Only the prompt was blinded — the delta itself committed intact, and reads unredacted
                        under <em>what changed</em>.
                    </p>
                </div>
            </div>
        </div>
    );
};
