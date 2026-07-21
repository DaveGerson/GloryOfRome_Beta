import React, { useState, useEffect } from 'react';
import { TurnHistoryEntry, Adjudication, Entity, Relationship, Memory, Scheme, RawCallRecord, WorldState } from '../types';
import { classifyDelta } from '../perception/visibility';
import { InferredAmbitionState } from '../persistence/saveGame';
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

const TABS = ['summary', 'entity states', 'actions', 'deltas', 'private', 'ground truth', 'raw json'];

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

const ActionsView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <>
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
    const playerAtTurn = entry.postTurnEntities.find(e => e.entity_id === playerCharacterId) ?? null;
    const mortalityTrace = (entry as Record<string, unknown>).mortalityTrace;

    return (
        <>
            <div>
                <span style={lbl}>Unfiltered Deltas vs. Perception Filter</span>
                <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                    Left: raw ground truth for this turn. Right: what perception/visibility.ts's classifyDelta lets{' '}
                    {playerAtTurn ? <span style={{ color: PARCH }}>{playerAtTurn.name}</span> : 'the player'} perceive.
                </p>
                {!playerAtTurn ? (
                    <p style={{ color: DIM, margin: 0 }}>No player character to classify against for this turn.</p>
                ) : entry.adjudication.deltas.length === 0 ? (
                    <p style={{ color: DIM, margin: 0 }}>No deltas were recorded this turn.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {entry.adjudication.deltas.map((delta, index) => {
                            const visibility = classifyDelta(delta, playerAtTurn, entry.postTurnEntities, worldState);
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

const GameMasterScreen: React.FC<{
    history: TurnHistoryEntry[];
    onClose: () => void;
    interventionText: string;
    onSetIntervention: (text: string) => void;
    playerCharacterId: string | null;
    worldState: WorldState;
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
}> = ({ history, onClose, interventionText, onSetIntervention, playerCharacterId, worldState, inferredAmbition, pendingIntelligenceFallout }) => {
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

    return (
        <div className="gor-dialog-backdrop">
            <div role="dialog" aria-modal="true" aria-label="Game Master Tools" style={{ width: 'min(1060px, calc(100% - 48px))', height: 'calc(100% - 56px)', display: 'flex', flexDirection: 'column', background: 'var(--dentil) left top/100% 4px no-repeat, linear-gradient(180deg,#2A231A,#161209 60%,#131009)', border: '1px solid rgba(201,162,39,.45)', clipPath: 'var(--chamfer-lg)', filter: 'drop-shadow(0 24px 60px rgba(0,0,0,.55))', padding: '20px 24px 18px', gap: 12, boxSizing: 'border-box' }}>
                <div style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid rgba(201,162,39,.25)', paddingBottom: 12 }}>
                    <div>
                        <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 26, color: GOLD, textShadow: '0 2px 3px rgba(0,0,0,.6)', margin: 0 }}>Game Master Tools</h2>
                        <span style={{ ...lbl, letterSpacing: '.24em' }}>The Fates' ledger — every thread measured, every die recorded</span>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close Game Master screen" style={{ all: 'unset', cursor: 'pointer', color: DIM, fontSize: 26, lineHeight: 1, padding: '2px 8px' }}>×</button>
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
                    {history.length === 0 ? (
                        <p style={{ color: DIM }}>No turns have been processed yet.</p>
                    ) : (
                        history.slice().reverse().map(entry => (
                            <div key={entry.turnNumber} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid rgba(201,162,39,.15)', paddingBottom: 18 }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '.1em', color: GOLD }}>TURN {toRoman(entry.turnNumber)}</span>
                                {activeTab === 'summary' && <SummaryView entry={entry} />}
                                {activeTab === 'entity states' && <EntityStatesView entities={entry.postTurnEntities} />}
                                {activeTab === 'actions' && <ActionsView adjudication={entry.adjudication} />}
                                {activeTab === 'deltas' && <DeltasView adjudication={entry.adjudication} />}
                                {activeTab === 'private' && <PrivateView adjudication={entry.adjudication} />}
                                {activeTab === 'ground truth' && <GroundTruthView entry={entry} playerCharacterId={playerCharacterId} worldState={worldState} />}
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
