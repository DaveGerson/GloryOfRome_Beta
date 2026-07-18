import React from 'react';
import { PerceivedChange, QUIET_DIGEST_MESSAGE, PerceptionSource } from '../perception/visibility';

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
 *
 * Per the design brief: if nothing beyond the player's own directly-narrated
 * consequences ('self'-sourced changes) was perceptible this turn, the
 * self-only noise is suppressed in favor of a single quiet line - the
 * player's own consequences are already covered by the narration bubble
 * above, so repeating them here would just be noise with nothing new.
 */
const DispatchesDigest: React.FC<{ changes: PerceivedChange[] }> = ({ changes }) => {
    const beyondSelf = changes.filter(c => c.source !== 'self');

    return (
        <div className="flex justify-center mb-4 animate-fade-in w-full">
            <div className="w-full max-w-2xl bg-stone-800/90 text-amber-100 border border-amber-900/60 rounded-sm px-4 py-3 shadow-inner">
                <h4 className="font-decorative text-amber-400 text-sm uppercase tracking-widest mb-2 border-b border-stone-600 pb-1">
                    Dispatches &amp; Observations
                </h4>
                {beyondSelf.length === 0 ? (
                    <p className="italic text-sm text-stone-400">{QUIET_DIGEST_MESSAGE}</p>
                ) : (
                    <ul className="space-y-1.5 text-sm">
                        {changes.map((change, index) => (
                            <li key={index} className="flex justify-between items-baseline gap-3">
                                <span>{change.text}</span>
                                {change.source !== 'self' && (
                                    <span className="text-xs italic text-stone-400 whitespace-nowrap flex-shrink-0">
                                        {SOURCE_LABELS[change.source]}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default DispatchesDigest;
