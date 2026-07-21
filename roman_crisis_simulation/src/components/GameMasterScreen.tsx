import React, { useState, useEffect } from 'react';
import { TurnHistoryEntry, Adjudication, Entity, Relationship, Memory, Scheme, RawCallRecord, WorldState, TruthLedgerEntry, Report, NpcIntent } from '../types';
import { classifyDelta, buildPerceivedDigest } from '../perception/visibility';
import { KnowledgeClaim } from '../knowledge/store';
import { InferredAmbitionState, SAVE_VERSION } from '../persistence/saveGame';
import { buildEvalCorpus, evalCorpusFilename } from '../persistence/evalCorpus';
import { getSessionCallLog } from '../ai/core/geminiService';
import { toRoman } from './ui/Brand';

/**
 * Game Master Tools — "the Fates' ledger": a dark tablinum modal over the
 * marble client. This is the ONE place raw, unfiltered ground truth is
 * allowed to reach a rendered screen (D5/D7) — everywhere else goes through
 * perception/visibility.ts's filter. Hidden by default; Ctrl+Shift+G (or the
 * dev Header switch) governs whether the GM Log button even appears (D7).
 */

const GOLD = '#F0D089', DIM = '#A99A76', PARCH = '#E6E1D0', RED = '#E0968B', GREEN = '#A8BC7E';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const lbl: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: DIM };
const well: React.CSSProperties = { background: 'rgba(0,0,0,.32)', border: '1px solid rgba(201,162,39,.22)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' };

const TABS = ['summary', 'entity states', 'actions', 'deltas', 'private', 'ground truth', 'npc perception', 'truth ledger', 'player knowledge', 'raw json'];

const SummaryView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => (
    <>
        <div style={well}>
            <span style={lbl}>Player Intent</span>
            <div style={{ marginTop: 4, fontSize: 15 }}>“{entry.playerIntent}”</div>
        </div>
        <div style={well}>
            <span style={lbl}>Generated Narration</span>
            <div style={{ marginTop: 4, fontSize: 15, fontStyle: 'italic', color: DIM }}>{entry.narration || 'No narration generated.'}</div>
        </div>
    </>
);

/**
 * Renders one turn's Director intents, the per-spotlight MIND decisions
 * (ROADMAP_PHASE_4.md 4C item 4 - chosen action, method, and the
 * private_reasoning that is the D7 tuning payoff; this console is the ONLY
 * rendered surface for a mind's inner monologue, D4/D5), and the
 * adjudicator's entityActions side by side, plus the code-side [Director]/
 * [Mind] notes recorded in gm_private (soft contracts,
 * ai/core/turn.ts::buildIntentConsistencyNotes + the per-mind failure
 * catch - surfaced here where the actions they judge are shown).
 */
const ActionsView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const adjudication = entry.adjudication;
    const directorNotes = adjudication.gm_private.filter(note => note.startsWith('[Director]') || note.startsWith('[Mind]'));
    return (
    <>
        {entry.npcIntents && entry.npcIntents.length > 0 && (
            <div style={well}>
                <span style={lbl}>Director Intents (durable, this turn)</span>
                {entry.npcIntents.map((intent, index) => (
                    <div key={index} style={{ fontSize: 14, marginTop: 4 }}>
                        <span style={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{intent.entity_id}</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: intent.continuity === 'continue' ? GREEN : GOLD, marginLeft: 10 }}>{intent.continuity}</span>
                        <div style={{ fontStyle: 'italic', color: PARCH }}>“{intent.intent}”</div>
                    </div>
                ))}
            </div>
        )}
        {entry.npcMindResults && entry.npcMindResults.length > 0 && (
            <div style={well}>
                <span style={lbl}>Mind Decisions (each character's own move, this turn)</span>
                {entry.npcMindResults.map((decision, index) => (
                    <div key={index} style={{ fontSize: 14, marginTop: 6 }}>
                        <span style={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{decision.entity_id}</span>
                        <div style={{ color: PARCH, marginTop: 2 }}><strong style={{ color: DIM }}>Chose:</strong> {decision.chosen_action}</div>
                        <div style={{ color: PARCH }}><strong style={{ color: DIM }}>Method:</strong> {decision.method}</div>
                        <div style={{ fontStyle: 'italic', color: DIM }}><strong style={{ color: DIM, fontStyle: 'normal' }}>Private reasoning:</strong> “{decision.private_reasoning}”</div>
                        {decision.scheme_adjustment && (
                            <div style={{ color: '#E3C766', fontStyle: 'italic' }}><strong style={{ color: DIM, fontStyle: 'normal' }}>Scheme shift:</strong> {decision.scheme_adjustment}</div>
                        )}
                    </div>
                ))}
            </div>
        )}
        {directorNotes.length > 0 && (
            <div style={{ ...well, border: '1px solid rgba(179,58,43,.45)' }}>
                <span style={{ ...lbl, color: RED }}>Director & Mind Notes</span>
                {directorNotes.map((note, index) => (
                    <div key={index} style={{ fontSize: 13, fontStyle: 'italic', color: DIM, marginTop: 4 }}>“{note}”</div>
                ))}
            </div>
        )}
        {adjudication.entityActions.length > 0 ? (
            adjudication.entityActions.map((action, index) => (
                <div key={index} style={well}>
                    <span style={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{action.id}</span>
                    <div style={{ fontSize: 14, marginTop: 3 }}>
                        <strong style={{ color: DIM }}>Intent:</strong> {action.intent}
                        {action.target && <> · <strong style={{ color: DIM }}>Target:</strong> {action.target}</>}
                    </div>
                    <div style={{ fontSize: 14, fontStyle: 'italic', color: DIM }}>“{action.notes}”</div>
                </div>
            ))
        ) : (
            <p style={{ color: DIM, margin: 0 }}>No specific entity actions were recorded.</p>
        )}
    </>
    );
};

const DeltasView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <>
        {adjudication.deltas.length > 0 ? (
            adjudication.deltas.map((delta, index) => (
                <div key={index} style={{ ...well, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ ...lbl, color: RED }}>{delta.type}</span>
                    <span style={{ fontFamily: MONO, fontSize: 13 }}>{delta.key}</span>
                    <span style={{ fontFamily: MONO, fontSize: 13, color: GOLD }}>{delta.delta}</span>
                    {delta.new_status && <span style={{ fontFamily: MONO, fontSize: 13, color: RED }}>→ {delta.new_status}{delta.new_location ? ` · ${delta.new_location}` : ''}</span>}
                    <span style={{ fontSize: 13, fontStyle: 'italic', color: DIM }}>“{delta.reason}”</span>
                </div>
            ))
        ) : (
            <p style={{ color: DIM, margin: 0 }}>No state deltas were recorded.</p>
        )}
    </>
);

const PrivateView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <>
        {adjudication.gm_private.length > 0 ? (
            adjudication.gm_private.map((note, index) => (
                <div key={index} style={{ ...well, fontStyle: 'italic', fontSize: 14, color: DIM }}>“{note}”</div>
            ))
        ) : (
            <p style={{ color: DIM, margin: 0 }}>No private GM notes for this turn.</p>
        )}
    </>
);

const SchemeLine: React.FC<{ scheme: Scheme }> = ({ scheme }) => (
    <span>
        <strong style={{ color: DIM }}>Scheme:</strong> <span style={{ color: '#E3C766', fontStyle: 'italic' }}>“{scheme.name}”</span> — {scheme.overall_goal}
        <span style={{ display: 'block', fontSize: 12, color: DIM }}>
            {scheme.steps.map((s, i) => <span key={i}>{i > 0 && ' · '}{s.status}: {s.objective}</span>)}
        </span>
    </span>
);

const EntityStatesView: React.FC<{ entities: Entity[] }> = ({ entities }) => (
    <>
        {entities.map(entity => (
            <div key={entity.entity_id} style={well}>
                <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{entity.name}</span>
                <span style={{ color: DIM, fontSize: 13 }}> — {entity.position || entity.entity_type}</span>
                <div style={{ fontSize: 13, color: PARCH, marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                    <span><strong style={{ color: DIM }}>Status:</strong> {entity.status} · {entity.location}</span>
                    <span><strong style={{ color: DIM }}>Resources:</strong> {Object.entries(entity.resources).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.length + ' item(s)' : v}`).join(' · ') || '—'}</span>
                    {entity.personality && (
                        <span><strong style={{ color: DIM }}>Personality:</strong> {Object.entries(entity.personality).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                    )}
                    {entity.skills && (
                        <span><strong style={{ color: DIM }}>Skills:</strong> {Object.entries(entity.skills).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                    )}
                </div>
                {entity.active_scheme && (
                    <div style={{ fontSize: 13, marginTop: 6 }}><SchemeLine scheme={entity.active_scheme} /></div>
                )}
                {((entity.beliefs && entity.beliefs.length > 0) || (entity.secrets && entity.secrets.length > 0)) && (
                    <div style={{ fontSize: 13, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                        {entity.beliefs && entity.beliefs.length > 0 && (
                            <span><strong style={{ color: DIM }}>Beliefs:</strong> {entity.beliefs.join(' · ')}</span>
                        )}
                        {entity.secrets && entity.secrets.length > 0 && (
                            <span><strong style={{ color: DIM }}>Secrets:</strong> {entity.secrets.join(' · ')}</span>
                        )}
                    </div>
                )}
                {entity.memories && entity.memories.length > 0 && (
                    <div style={{ fontSize: 13, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6 }}>
                        <strong style={{ color: DIM }}>Recent memories:</strong>{' '}
                        {entity.memories.slice(-3).reverse().map((memory: Memory, i: number) => (
                            <span key={i}>{i > 0 && ' · '}T{memory.turn}: {memory.event_description}</span>
                        ))}
                    </div>
                )}
                <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 6, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, color: PARCH }}>
                    <strong style={{ color: DIM, fontFamily: 'inherit' }}>Rel:</strong>{' '}
                    {Object.entries(entity.relationships).filter(([, rel]) => rel).map(([targetId, rel]: [string, Relationship], i) => {
                        const targetName = entities.find(e => e.entity_id === targetId)?.name || targetId;
                        return <span key={targetId}>{i > 0 && ' · '}{targetName} T:{rel.trust_level} Th:{rel.perceived_threat ?? 0} A:{rel.ideological_alignment ?? 0} D:{rel.dependency_level ?? 0}</span>;
                    })}
                </div>
            </div>
        ))}
    </>
);

const RawJsonView: React.FC<{ adjudication: Adjudication; rawCalls?: RawCallRecord[] }> = ({ adjudication, rawCalls }) => (
    <>
        {rawCalls && rawCalls.length > 0 ? (
            rawCalls.map((call, index) => (
                <details key={index} style={{ ...well, fontFamily: MONO, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', color: RED }}>
                        {call.callName} <span style={{ color: DIM }}>— {call.model} · {call.latencyMs}ms · {call.attempts} attempt{call.attempts > 1 ? 's' : ''} · {call.validated ? 'validated' : 'NOT validated'}</span>
                    </summary>
                    <p style={{ color: DIM, margin: '8px 0 0' }}>Prompt chars: {call.promptChars}</p>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0', color: PARCH }}>{call.rawResponse}</pre>
                </details>
            ))
        ) : (
            <p style={{ color: DIM, margin: 0 }}>No raw calls captured for this turn.</p>
        )}
        <details style={{ ...well, fontFamily: MONO, fontSize: 12 }}>
            <summary style={{ cursor: 'pointer', color: GOLD }}>Parsed adjudication</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0', color: PARCH }}>{JSON.stringify(adjudication, null, 2)}</pre>
        </details>
    </>
);

/**
 * The Ground Truth tuning view (D7 + Phase 2 item 4). Puts the two sides
 * side by side deliberately: every delta this turn, and what classifyDelta
 * (the same function the player-facing digest/WorldStateTab use) would have
 * let through for the current player character - so filter rules can be
 * tuned by eyeballing the diff.
 *
 * Also surfaces `mortalityTrace` off the turn history entry, if present -
 * accessed defensively via an untyped cast so this file compiles regardless
 * of the mortality pipeline's landing order.
 */
const GroundTruthView: React.FC<{
    entry: TurnHistoryEntry;
    playerCharacterId: string | null;
    worldState: WorldState;
}> = ({ entry, playerCharacterId, worldState }) => {
    // Older entries may lack their entity snapshot (only the most recent
    // KEEP_FULL_SNAPSHOTS entries retain one - state/gameReducer.ts); the
    // per-delta classification needs the turn's own roster, so without it
    // this view can only say so.
    const snapshotEntities = entry.postTurnEntities;
    const playerAtTurn = snapshotEntities?.find(e => e.entity_id === playerCharacterId) ?? null;
    const mortalityTrace = (entry as Record<string, unknown>).mortalityTrace;

    return (
        <>
            <div>
                <span style={lbl}>Unfiltered Deltas vs. Perception Filter</span>
                <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                    Left: raw ground truth for this turn. Right: what perception/visibility.ts's classifyDelta lets{' '}
                    {playerAtTurn ? <span style={{ color: PARCH }}>{playerAtTurn.name}</span> : 'the player'} perceive.
                </p>
                {!snapshotEntities ? (
                    <p style={{ color: DIM, margin: 0 }}>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the perception classification needs the turn's own roster.</p>
                ) : !playerAtTurn ? (
                    <p style={{ color: DIM, margin: 0 }}>No player character to classify against for this turn.</p>
                ) : entry.adjudication.deltas.length === 0 ? (
                    <p style={{ color: DIM, margin: 0 }}>No deltas were recorded this turn.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {entry.adjudication.deltas.map((delta, index) => {
                            const visibility = classifyDelta(delta, playerAtTurn, snapshotEntities, worldState);
                            return (
                                <div key={index} style={{ ...well, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                                    <div>
                                        <span style={{ ...lbl, color: RED }}>{delta.type}</span> <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>({delta.key})</span>
                                        <div style={{ fontStyle: 'italic', color: DIM, marginTop: 3 }}>“{delta.reason}”</div>
                                    </div>
                                    <div style={{ alignSelf: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: visibility.visible ? GREEN : 'rgba(169,154,118,.45)' }}>
                                        {visibility.visible ? `VISIBLE — ${visibility.source}` : 'FILTERED (invisible to player)'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <div>
                <span style={lbl}>Turn Seed</span>
                <p style={{ fontSize: 13, margin: '4px 0 0', fontFamily: MONO, color: typeof entry.turnSeed === 'number' ? PARCH : DIM }}>
                    {typeof entry.turnSeed === 'number'
                        ? `${entry.turnSeed} — replays this turn's hidden rolls in draw order (action roll, then mortality rolls).`
                        : 'None recorded for this turn.'}
                </p>
            </div>
            <div>
                <span style={lbl}>Mortality Trace</span>
                {mortalityTrace ? (
                    <pre style={{ ...well, fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 6, color: PARCH }}>{JSON.stringify(mortalityTrace, null, 2)}</pre>
                ) : (
                    <p style={{ fontSize: 13, color: DIM, margin: '4px 0 0' }}>No mortality trace recorded for this turn (mortality pipeline not yet wired in, or nothing triggered it).</p>
                )}
            </div>
        </>
    );
};

/**
 * Per-NPC perception view (D7 + D10): what each of the turn's perceiving
 * NPCs actually witnessed or heard - the instrument for tuning information
 * asymmetry across the whole cast, alongside GroundTruthView's player-side
 * diff. GM-console-only, like everything else on this screen (D4/D5): what
 * an NPC knows is simulation data, not player knowledge.
 *
 * Digests are re-derived at render time from the entry's persisted
 * `perceivingNpcIds` + deltas + entity snapshot (perception/visibility.ts's
 * viewer-agnostic rules); per-NPC digests are never persisted in the save.
 * An id absent from the snapshot (an entity removed later that same turn)
 * is skipped.
 *
 * APPROXIMATION CAVEAT (stated in the UI copy below): the stamp itself ran
 * MID-turn, against mid-apply entity/world state; this view re-derives from
 * the turn's FINAL snapshot (postTurnEntities) and the CURRENT worldState
 * prop, which can differ - same-turn add/remove_entities, regions removed
 * in later turns. The view therefore approximates the stamped lines rather
 * than reproducing them exactly; deliberately not re-plumbed, since the
 * per-NPC digests are derived-and-discarded by design.
 */
const NpcPerceptionView: React.FC<{
    entry: TurnHistoryEntry;
    worldState: WorldState;
}> = ({ entry, worldState }) => {
    const snapshotEntities = entry.postTurnEntities;
    const perceivingIds = entry.perceivingNpcIds;

    if (!snapshotEntities) {
        return <p style={{ color: DIM, margin: 0 }}>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the per-NPC perception derivation needs the turn's own roster.</p>;
    }
    if (!perceivingIds) {
        return <p style={{ color: DIM, margin: 0 }}>No perceiving-NPC set recorded for this turn.</p>;
    }
    if (perceivingIds.length === 0) {
        return <p style={{ color: DIM, margin: 0 }}>No NPCs were selected to perceive this turn.</p>;
    }
    return (
        <>
            <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                What each perceiving NPC witnessed or heard this turn - the same viewer-agnostic filter the player's digest runs through, applied from each NPC's own vantage. Re-derived at render time from the turn's final entity snapshot and the current world state, so it APPROXIMATES the lines their memories were stamped from mid-turn: same-turn cast changes or since-removed regions can make it differ from the exact stamped text.
            </p>
            {perceivingIds.map(entityId => {
                const npcRecord = snapshotEntities.find(e => e.entity_id === entityId);
                if (!npcRecord) return null;
                // Defensive default: a legacy-shaped snapshot entity may lack
                // visibility_network, which classifyDelta reads
                // unconditionally - the console must render, not crash.
                const npc = { ...npcRecord, visibility_network: npcRecord.visibility_network ?? [] };
                const changes = buildPerceivedDigest(entry.adjudication.deltas, npc, snapshotEntities, worldState);
                return (
                    <div key={entityId} style={well}>
                        <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{npc.name}</span>
                        <span style={{ color: DIM, fontSize: 13 }}> — {npc.location} · network: {npc.visibility_network.length > 0 ? npc.visibility_network.join(', ') : 'none'}</span>
                        {changes.length === 0 ? (
                            <div style={{ fontSize: 13, fontStyle: 'italic', color: 'rgba(169,154,118,.6)', marginTop: 4 }}>Perceived nothing this turn.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                                {changes.map((change, index) => (
                                    <div key={index} style={{ fontSize: 13, display: 'flex', gap: 10, alignItems: 'baseline' }}>
                                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: GREEN, flex: 'none', width: 74 }}>{change.source}</span>
                                        <span style={{ color: PARCH }}>{change.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
};

/**
 * The true-vs-believed view (DESIGN_DECISIONS.md D11 + D7): the GM-private
 * truth ledger, one row per rumor - the claim as the player heard it, the
 * credibility the matching Report presented, and the ACTUAL truth plus
 * origin only this console may show. Campaign-wide (the ledger is a single
 * bounded collection, not per-turn data), newest first. Entries flagged
 * `assumed` mark rumors the adjudicator failed to disposition despite the
 * prompt - defaulted to TRUE, never silently invented as lies.
 */
const TruthLedgerView: React.FC<{ ledger: TruthLedgerEntry[]; reports: Report[] }> = ({ ledger, reports }) => (
    <>
        {ledger.length === 0 ? (
            <p style={{ color: DIM, margin: 0 }}>No rumors have been recorded in the truth ledger yet.</p>
        ) : (
            ledger.slice().reverse().map(entry => {
                const matchingReport = reports.find(r => r.id === entry.reportId);
                return (
                    <div key={entry.id} style={well}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ ...lbl, color: GOLD }}>Turn {toRoman(entry.turn)}</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: entry.isTrue ? GREEN : RED }}>
                                {entry.isTrue ? 'TRUE' : 'FALSE'}
                            </span>
                            {entry.assumed && (
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', color: RED }}>
                                    ASSUMED — model omitted the disposition
                                </span>
                            )}
                            <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>
                                player saw: {matchingReport ? `${(matchingReport.credibility * 100).toFixed(0)}% credible` : 'no matching report'}
                            </span>
                        </div>
                        <div style={{ fontSize: 14, fontStyle: 'italic', color: PARCH, marginTop: 4 }}>“{entry.claim}”</div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 4 }}>
                            about: {entry.aboutId} · origin: {entry.originId || 'organic (unattributed)'}
                        </div>
                    </div>
                );
            })
        )}
    </>
);

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
const PlayerKnowledgeView: React.FC<{ knowledge: KnowledgeClaim[] }> = ({ knowledge }) => (
    <>
        {knowledge.length === 0 ? (
            <p style={{ color: DIM, margin: 0 }}>The player holds no recorded knowledge claims yet.</p>
        ) : (
            knowledge.slice().reverse().map(claim => (
                <div key={claim.id} style={well}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ ...lbl, color: GOLD }}>First learned turn {toRoman(claim.firstLearnedTurn)}</span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>subject: {claim.subject}</span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>key: {claim.claimKey}</span>
                    </div>
                    <div style={{ fontSize: 14, fontStyle: 'italic', color: PARCH, marginTop: 4 }}>“{claim.claim}”</div>
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
                </div>
            ))
        )}
    </>
);

const GameMasterScreen: React.FC<{
    history: TurnHistoryEntry[];
    onClose: () => void;
    interventionText: string;
    onSetIntervention: (text: string) => void;
    playerCharacterId: string | null;
    worldState: WorldState;
    /** The current turn number - stamped into the eval corpus export's metadata and filename (D18). */
    turnNumber: number;
    /** DESIGN_DECISIONS.md D8 - the latest inferred-ambition snapshot, if any. GM-console-only display; never shown to the player. */
    inferredAmbition?: InferredAmbitionState | null;
    /**
     * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the investigation-consequence
     * queue (components/investigationLoop.ts), not yet consumed by a
     * committed turn. Per DESIGN_DECISIONS.md D5, the player only ever gets
     * a subtle in-fiction hint that something went wrong - this raw,
     * mechanical text is GM-console-only, same as everything else on this
     * screen (D7).
     */
    pendingIntelligenceFallout?: string[];
    /**
     * DESIGN_DECISIONS.md D11 - the GM-private truth ledger. This console
     * is the ONLY rendered surface allowed to show it (same handling class
     * as `secret_truth`); see TruthLedgerView above.
     */
    truthLedger?: TruthLedgerEntry[];
    /** The full report log, used by TruthLedgerView to show the credibility the player saw for each ledger entry. */
    reports?: Report[];
    /**
     * ROADMAP_PHASE_4.md 4B item 2 / D21 - the player knowledge store, the
     * believed side of the D7 true-vs-believed instrument (see
     * PlayerKnowledgeView above). Player-visible data shown GM-side for
     * tuning; the player's own views over it are later stages.
     */
    knowledge?: KnowledgeClaim[];
    /**
     * ROADMAP_PHASE_4.md 4C item 3 - the Director's CURRENT persistent
     * intents (the reducer's npcIntents slice): what each spotlight NPC is
     * durably trying to do right now, the D7 view of durable direction.
     * GM-PRIVATE (D4/D5): this console is the only rendered surface allowed
     * to show them. Optional - a legacy campaign simply has none yet.
     */
    npcIntents?: NpcIntent[];
}> = ({ history, onClose, interventionText, onSetIntervention, playerCharacterId, worldState, turnNumber, inferredAmbition, pendingIntelligenceFallout, truthLedger, reports, knowledge, npcIntents }) => {
    const [activeTab, setActiveTab] = useState('summary');
    const [interventionInput, setInterventionInput] = useState(interventionText);
    const [showConfirmation, setShowConfirmation] = useState(false);

    useEffect(() => {
        if (!showConfirmation) return;
        const t = setTimeout(() => setShowConfirmation(false), 3000);
        return () => clearTimeout(t);
    }, [showConfirmation]);

    const handleSetIntervention = () => {
        onSetIntervention(interventionInput);
        setShowConfirmation(true);
    };

    // DESIGN_DECISIONS.md D18 - downloads the session's captured turns
    // (prompts, responses, seeds, traces) plus the out-of-band session call
    // log as a JSON file for offline eval/tuning. Capture is session-side
    // only; nothing here touches the persisted save. This action must live
    // on this GM-only screen and nowhere player-facing (D4/D5/D7).
    const handleExportEvalCorpus = () => {
        const corpus = buildEvalCorpus(history, getSessionCallLog(), {
            saveVersion: SAVE_VERSION,
            turnNumber,
            playerCharacterId,
        }, {
            // Campaign-wide GM-side slices (D11 ledger / D21 knowledge) so
            // the offline judge can score true-vs-believed and assumed-rate.
            // Passed through as-is: absent on a legacy campaign stays absent
            // in the corpus.
            truthLedger,
            knowledge,
        });
        const blob = new Blob([JSON.stringify(corpus, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = evalCorpusFilename(turnNumber);
        anchor.click();
        // The browser fetches the blob URL asynchronously after click();
        // revoking synchronously can abort the download (Firefox/Safari),
        // so revocation must be deferred past the fetch.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    return (
        <div className="gor-dialog-backdrop">
            <div role="dialog" aria-modal="true" aria-label="Game Master Tools" style={{ width: 'min(1060px, calc(100% - 48px))', height: 'calc(100% - 56px)', display: 'flex', flexDirection: 'column', background: 'var(--dentil) left top/100% 4px no-repeat, linear-gradient(180deg,#2A231A,#161209 60%,#131009)', border: '1px solid rgba(201,162,39,.45)', clipPath: 'var(--chamfer-lg)', filter: 'drop-shadow(0 24px 60px rgba(0,0,0,.55))', padding: '20px 24px 18px', gap: 12, boxSizing: 'border-box' }}>
                <div style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid rgba(201,162,39,.25)', paddingBottom: 12 }}>
                    <div>
                        <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 26, color: GOLD, textShadow: '0 2px 3px rgba(0,0,0,.6)', margin: 0 }}>Game Master Tools</h2>
                        <span style={{ ...lbl, letterSpacing: '.24em' }}>The Fates' ledger — every thread measured, every die recorded</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button
                            type="button"
                            onClick={handleExportEvalCorpus}
                            title="Download this session's captured prompts, responses, seeds, and traces as JSON"
                            style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: '#241C11', background: 'var(--metal-gold)', border: '1px solid #8A6D14', clipPath: 'var(--chamfer-sm)', padding: '9px 16px', cursor: 'pointer', boxShadow: 'var(--bevel)' }}
                        >
                            Export Eval Corpus
                        </button>
                        <button type="button" onClick={onClose} aria-label="Close Game Master screen" style={{ all: 'unset', cursor: 'pointer', color: DIM, fontSize: 26, lineHeight: 1, padding: '2px 8px' }}>×</button>
                    </div>
                </div>

                {/* DESIGN_DECISIONS.md D8 - the ONE other sanctioned surface for the inferred ambition besides EpilogueScreen. Never rendered on any player-facing view. */}
                {inferredAmbition && (
                    <div style={{ flex: 'none', ...well, fontSize: 14 }}>
                        <span style={lbl}>Apparent Ambition</span>{' '}
                        <span style={{ color: '#E3C766', fontStyle: 'italic' }}>“{inferredAmbition.apparent_ambition}”</span>{' '}
                        <span style={{ color: DIM, fontSize: 13 }}>
                            (confidence: {inferredAmbition.confidence}, as of turn {inferredAmbition.asOfTurn})
                        </span>
                    </div>
                )}

                {/*
                  ROADMAP_PHASE_4.md 4C item 3 (D7) - what each spotlight NPC
                  is durably trying to do RIGHT NOW: the Director's committed
                  intents from the latest turn, fed into the next turn's
                  Director for its continuity ruling. GM-private (D4/D5);
                  per-turn intent history lives in the 'actions' tab below.
                */}
                {npcIntents && npcIntents.length > 0 && (
                    <div style={{ flex: 'none', ...well, fontSize: 14 }}>
                        <span style={lbl}>Director Intents (current)</span>
                        {npcIntents.map((intent, index) => (
                            <div key={index} style={{ marginTop: 4 }}>
                                <span style={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{intent.entity_id}</span>
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: intent.continuity === 'continue' ? GREEN : GOLD, marginLeft: 10 }}>{intent.continuity}</span>
                                {' '}<span style={{ color: '#E3C766', fontStyle: 'italic' }}>“{intent.intent}”</span>
                            </div>
                        ))}
                    </div>
                )}

                {/*
                  ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the raw, mechanical
                  consequence text queued by a risky investigation (see
                  components/investigationLoop.ts) that hasn't yet been fed
                  into a turn's GM Intervention text (App.tsx's executeTurn).
                  This is the ONLY player-adjacent-but-not-player-facing
                  surface where the literal string is shown - the player
                  themselves only ever gets the subtle chat notice at the
                  moment of investigation, then the reinterpreted fallout via
                  next turn's narration (D5).
                */}
                {pendingIntelligenceFallout && pendingIntelligenceFallout.length > 0 && (
                    <div style={{ flex: 'none', ...well, fontSize: 14 }}>
                        <span style={lbl}>Pending Intelligence Fallout</span>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                            {pendingIntelligenceFallout.map((consequence, index) => (
                                <li key={index} style={{ color: '#E3C766', fontStyle: 'italic' }}>“{consequence}”</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div style={{ flex: 'none', ...well, border: '1px solid rgba(179,58,43,.45)' }}>
                    <span style={{ ...lbl, color: RED }}>GM Intervention</span>
                    <p style={{ margin: '4px 0 8px', fontSize: 14, color: DIM }}>A directive the Fates will weave into the next turn's adjudication — an outside event, or a thumb on an entity's scale.</p>
                    <textarea
                        value={interventionInput}
                        onChange={(e) => setInterventionInput(e.target.value)}
                        aria-label="Game Master Intervention Input"
                        placeholder={'E.g. "A plague breaks out in the Suburra" — or "Maximinus Thrax should become more aggressive."'}
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: '#1B1610', color: PARCH, border: '1px solid rgba(201,162,39,.3)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 15, boxShadow: 'inset 0 1px 3px rgba(0,0,0,.5)' }}
                    ></textarea>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
                        <button
                            type="button"
                            onClick={handleSetIntervention}
                            style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: '#F8F1DE', background: 'var(--metal-crimson)', border: '1px solid #5E1008', clipPath: 'var(--chamfer-sm)', padding: '9px 16px', cursor: 'pointer', boxShadow: 'var(--bevel)' }}
                        >
                            Set Directive for Next Turn
                        </button>
                        {showConfirmation && <span style={{ color: GREEN, fontStyle: 'italic', fontSize: 14, animation: 'gorFadeIn .3s ease-out both' }}>The Fates have heard. It will be woven into the next turn.</span>}
                    </div>
                </div>

                <div style={{ flex: 'none', display: 'flex', gap: 2, borderBottom: '1px solid rgba(201,162,39,.25)', flexWrap: 'wrap' }} role="tablist" aria-label="Ledger views">
                    {TABS.map(tab => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={tab === activeTab}
                            onClick={() => setActiveTab(tab)}
                            style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', padding: '8px 12px', color: tab === activeTab ? GOLD : DIM, borderBottom: tab === activeTab ? '2px solid var(--gold-500)' : '2px solid transparent', background: tab === activeTab ? 'rgba(201,162,39,.08)' : 'transparent' }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 6, display: 'flex', flexDirection: 'column', gap: 20, color: PARCH }}>
                    {/* The truth ledger and the player knowledge store are each one campaign-wide bounded collection (D11/D21), not per-turn data - rendered once, outside the per-turn loop below. */}
                    {activeTab === 'truth ledger' ? (
                        <TruthLedgerView ledger={truthLedger ?? []} reports={reports ?? []} />
                    ) : activeTab === 'player knowledge' ? (
                        <PlayerKnowledgeView knowledge={knowledge ?? []} />
                    ) : history.length === 0 ? (
                        <p style={{ color: DIM }}>No turns have been processed yet.</p>
                    ) : (
                        history.slice().reverse().map(entry => (
                            <div key={entry.turnNumber} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid rgba(201,162,39,.15)', paddingBottom: 18 }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '.1em', color: GOLD }}>TURN {toRoman(entry.turnNumber)}</span>
                                {activeTab === 'summary' && <SummaryView entry={entry} />}
                                {activeTab === 'entity states' && (entry.postTurnEntities
                                    ? <EntityStatesView entities={entry.postTurnEntities} />
                                    : <p style={{ color: DIM, margin: 0 }}>Entity snapshot trimmed for this older turn - only the most recent turns retain one.</p>)}
                                {activeTab === 'actions' && <ActionsView entry={entry} />}
                                {activeTab === 'deltas' && <DeltasView adjudication={entry.adjudication} />}
                                {activeTab === 'private' && <PrivateView adjudication={entry.adjudication} />}
                                {activeTab === 'ground truth' && <GroundTruthView entry={entry} playerCharacterId={playerCharacterId} worldState={worldState} />}
                                {activeTab === 'npc perception' && <NpcPerceptionView entry={entry} worldState={worldState} />}
                                {activeTab === 'raw json' && <RawJsonView adjudication={entry.adjudication} rawCalls={entry.rawCalls} />}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default GameMasterScreen;
