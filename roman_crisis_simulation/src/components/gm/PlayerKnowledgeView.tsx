import React from 'react';
import { KnowledgeClaim } from '../../knowledge/store';
import { toRoman } from '../ui/Brand';
import { well, lbl, GmNote, GOLD, DIM, PARCH, GREEN, MONO } from './shared';

/**
 * Read-only listing of the player knowledge store (ROADMAP_PHASE_4.md 4B
 * item 2 / DESIGN_DECISIONS.md D21): every claim the player currently
 * holds, with its full time-dated update timeline. This is the
 * player-BELIEVED side of the D7 true-vs-believed instrument - tuned by
 * eyeballing it against the truth-ledger tab next door. GM-side display of
 * player-visible data (nothing here is GM-private; the store by
 * construction carries no truth flags/origins). Campaign-wide like the
 * truth ledger, newest-updated last in store order, rendered newest first.
 */
export const PlayerKnowledgeView: React.FC<{ knowledge: KnowledgeClaim[] }> = ({ knowledge }) => {
    // D29 - resolve an edge's target claim id to a readable subject/topic
    // label so the graph is legible in the console (falls back to the raw id
    // if the target was evicted, though edges are pruned on eviction).
    const labelFor = (id: string): string => {
        const target = knowledge.find(c => c.id === id);
        return target ? `${target.subject}${target.topic ? ` · ${target.topic}` : ''}` : id;
    };
    return (
        <>
            {knowledge.length === 0 ? (
                <GmNote>The player holds no recorded knowledge claims yet.</GmNote>
            ) : (
                knowledge.slice().reverse().map(claim => (
                    <div key={claim.id} style={well}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ ...lbl, color: GOLD }}>First learned turn {toRoman(claim.firstLearnedTurn)}</span>
                            <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>subject: {claim.subject}</span>
                            {claim.topic && <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>topic: {claim.topic}</span>}
                            <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>key: {claim.claimKey}</span>
                        </div>
                        <div style={{ fontSize: 14, fontStyle: 'italic', color: PARCH, marginTop: 4 }}>“{claim.claim}”</div>
                        {claim.schemeDiscovery && (
                            // D28 - the believed-side scheme picture: the player sees clue
                            // progress, and the nature ONLY once enough clues reveal it.
                            <div style={{ fontSize: 12, marginTop: 6 }}>
                                <span style={lbl}>Scheme clues: </span>
                                <span style={{ fontFamily: MONO, color: claim.schemeDiscovery.revealed ? GREEN : GOLD }}>
                                    {claim.schemeDiscovery.clues} · {claim.schemeDiscovery.revealed ? 'nature revealed' : 'nature hidden'}
                                </span>
                                {claim.schemeDiscovery.revealed && claim.schemeDiscovery.nature && (
                                    <span style={{ fontStyle: 'italic', color: PARCH }}> — “{claim.schemeDiscovery.nature}”</span>
                                )}
                            </div>
                        )}
                        <div style={{ fontSize: 12, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6 }}>
                            <span style={lbl}>Updates ({claim.updates.length})</span>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                {claim.updates.slice().reverse().map((update, index) => (
                                    <li key={index} style={{ color: DIM, marginTop: 2 }}>
                                        <span style={{ fontFamily: MONO, color: GREEN }}>T{update.turn} · {update.source}</span>
                                        {typeof update.credibility === 'number' && (
                                            <span style={{ fontFamily: MONO }}> · {(update.credibility * 100).toFixed(0)}% credible</span>
                                        )}
                                        {' '}<span style={{ fontStyle: 'italic', color: PARCH }}>“{update.text}”</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {claim.edges && claim.edges.length > 0 && (
                            <div style={{ fontSize: 12, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6 }}>
                                <span style={lbl}>Links ({claim.edges.length})</span>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                    {claim.edges.map((edge, index) => (
                                        <li key={index} style={{ color: DIM, marginTop: 2 }}>
                                            <span style={{ fontFamily: MONO, color: GOLD }}>{edge.type}</span>
                                            {' → '}<span style={{ color: PARCH }}>{labelFor(edge.to)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ))
            )}
        </>
    );
};
