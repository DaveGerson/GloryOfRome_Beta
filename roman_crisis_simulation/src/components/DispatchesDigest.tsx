import React from 'react';
import { PerceivedChange, QUIET_DIGEST_MESSAGE, PerceptionSource } from '../perception/visibility';
import type { LedgerLine } from '../types';

// Subtle source tags per the task brief - 'self' deliberately gets none: a
// player's own feelings/consequences need no attribution, they're just
// known. Everything else is tagged so the player can weigh how solid the
// intelligence is (crude v1 - fidelity is still binary per D5, this is just
// provenance, not a reliability score).
const SOURCE_LABELS: Partial<Record<PerceptionSource, string>> = {
    witnessed: 'witnessed',
    network: 'via your network',
    public: 'common knowledge',
};

/**
 * The "Dispatches & Observations" turn digest (Phase 2 item 2). Rendered in
 * the chat stream after each turn commits, built from
 * perception/visibility.ts's buildPerceivedDigest over that turn's deltas -
 * this is intentionally a different visual register from narration (an
 * intelligence-briefing aside, not in-fiction prose), so it reads as "here's
 * what your spies/eyes/ears picked up" rather than more GM narration.
 * Design register: a dark dispatch tablet (the one dark, gold-ruled surface
 * in the player-facing stream), distinct from the marble GM bubbles.
 *
 * Per the design brief: if nothing beyond the player's own directly-narrated
 * consequences ('self'-sourced changes) was perceptible this turn, the
 * self-only noise is suppressed in favor of a single quiet line - the
 * player's own consequences are already covered by the narration bubble
 * above, so repeating them here would just be noise with nothing new.
 *
 * The steward's lines (D46) sit under the dispatches: the engine's weekly
 * ledger for the player's OWN holdings - wages paid, an estate's yield,
 * interest taken - each with its Arabic amount (D5/D6: your own treasury is
 * yours to know; D44: arithmetic is Arabic). They are bookkeeping, not
 * intelligence, so they render whether or not the week was quiet and never
 * count toward the quiet-week test above.
 */
const DispatchesDigest: React.FC<{ changes: PerceivedChange[]; ledger?: LedgerLine[] }> = ({ changes, ledger = [] }) => {
    const beyondSelf = changes.filter(c => c.source !== 'self');

    return (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, width: '100%', animation: 'gorFadeIn .5s ease-out both' }}>
            <div className="gor-tablet" style={{ width: '100%', background: 'var(--tablet-dentil) left top/100% 3px no-repeat, var(--tablet-grad)', border: '1px solid var(--tablet-edge)', borderRadius: 'var(--radius-md)', padding: '12px 16px 13px', boxShadow: 'var(--bevel), 0 2px 6px rgba(58,44,16,.3)', color: 'var(--tablet-text)' }}>
                <h4 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 12, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--tablet-head)', borderBottom: '1px solid var(--tablet-rule)', paddingBottom: 6, marginBottom: 8, textShadow: '0 1px 1px rgba(0,0,0,.5)' }}>
                    Dispatches &amp; Observations
                </h4>
                {beyondSelf.length === 0 ? (
                    <p style={{ margin: 0, fontStyle: 'italic', fontSize: 14, color: 'var(--tablet-quiet)' }}>{QUIET_DIGEST_MESSAGE}</p>
                ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                        {changes.map((change, index) => (
                            // Each ❧ line arrives 40ms after the one above it,
                            // as if being read out (item 17).
                            <li key={index} className="gor-tablet-line" style={{ animationDelay: `${index * 40}ms`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                                <span style={{ display: 'inline-flex', gap: 8 }}>
                                    <span aria-hidden="true" style={{ color: 'var(--tablet-mark)', flex: 'none' }}>❧</span>
                                    <span>{change.text}</span>
                                </span>
                                {change.source !== 'self' && (
                                    <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--tablet-quiet)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {SOURCE_LABELS[change.source]}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {ledger.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--tablet-rule)' }}>
                        <h5 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 10.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--tablet-head)' }}>
                            The steward reports
                        </h5>
                        <ul aria-label="The steward's ledger" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14 }}>
                            {ledger.map((line, index) => (
                                <li key={index} className="gor-tablet-line" style={{ animationDelay: `${(changes.length + index) * 40}ms`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                                    <span style={{ display: 'inline-flex', gap: 8 }}>
                                        <span aria-hidden="true" style={{ color: 'var(--tablet-mark)', flex: 'none' }}>❧</span>
                                        <span>{line.text}</span>
                                    </span>
                                    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0, color: line.amount < 0 ? 'var(--tablet-quiet)' : 'var(--tablet-head)' }}>
                                        {line.amount > 0 ? '+' : line.amount < 0 ? '−' : ''}{Math.abs(line.amount).toLocaleString('en-US')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DispatchesDigest;
