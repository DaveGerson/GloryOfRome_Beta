import React, { useState, useEffect, useRef } from 'react';
import { TurnHistoryEntry, Adjudication, Entity, Relationship, Memory, Scheme, RawCallRecord, WorldState, TruthLedgerEntry, Report, NpcIntent } from '../types';
import { classifyDelta, buildPerceivedDigest } from '../perception/visibility';
import { KnowledgeClaim } from '../knowledge/store';
import { InferredAmbitionState, SAVE_VERSION } from '../persistence/saveGame';
import { buildEvalCorpus, evalCorpusFilename } from '../persistence/evalCorpus';
import { getSessionCallLog, MAX_CAPTURED_PROMPT_CHARS } from '../ai/core/geminiService';
import { replayTurnDraws, type TurnReplayResult } from '../ai/core/turnReplay';
import { toRoman } from './ui/Brand';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';
import { structuredSubmissionForHistory, TurnSubmissionHistory } from './TurnSubmissionHistory';
import type { PrivateSceneRecord } from '../privateScene/model';
import { radioGroupKeyDown } from './ui/rovingRadio';

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

/** The console's one quiet-note / empty-state paragraph treatment. */
const GmNote: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ color: DIM, margin: 0 }}>{children}</p>;

/**
 * WP-12 — the console became a turn inspector. Every per-turn tab used to
 * re-render EVERY turn in history, so "deltas" was a wall of two turns' deltas
 * at once and the console could not answer the only question a GM asks: what
 * happened in *this* turn. A turn rail now scopes every per-turn tab to one
 * turn, and "entity states" + "deltas" — two answers to one question — became
 * `what changed`.
 *
 * `actions` stays its own register: it holds the Director's and each mind's
 * private REASONING, which is a different instrument from the state diff.
 * The two campaign-wide collections (D11 ledger, D21 knowledge) ignore the
 * rail by construction.
 */
const TABS = ['summary', 'what changed', 'narration', 'actions', 'private', 'ground truth', 'npc perception',
    'raw json', 'fixtures', 'truth ledger', 'player knowledge'];

/** Tabs that render one bounded campaign-wide collection, not per-turn data. */
const CAMPAIGN_WIDE_TABS = new Set(['truth ledger', 'player knowledge']);

/**
 * The tablist contract (spec: 2026-08-05-b7a-hardening-and-tablist-design.md
 * work item 2): one stable id per tab, one panel per bar whose content
 * swaps, `aria-controls`/`aria-labelledby` tying the two together.
 */
const GM_TABPANEL_ID = 'gm-tabpanel';
const gmTabDomId = (tab: string): string => `gm-tab-${tab.replace(/\s+/g, '-')}`;

/**
 * A GM-private note must never be mistakable for narration you would read
 * aloud: a crimson wax edge and a redaction weave across the ground.
 */
const redacted: React.CSSProperties = {
    borderLeft: '4px solid var(--metal-crimson)',
    background: 'repeating-linear-gradient(102deg,rgba(179,58,43,.07) 0 1px,transparent 1px 7px), rgba(0,0,0,.32)',
    border: '1px solid rgba(179,58,43,.45)',
    borderLeftWidth: 4,
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
};

const PlayerIntentView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const structuredSubmission = structuredSubmissionForHistory(entry.playerIntent);
    return structuredSubmission ? (
        <TurnSubmissionHistory submission={structuredSubmission} audience="gm" />
    ) : (
        <div style={{ marginTop: 4, fontSize: 15 }}>“{entry.playerIntent}”</div>
    );
};

const SummaryView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => (
    <>
        <div style={well}>
            <span style={lbl}>Player Intent</span>
            <PlayerIntentView entry={entry} />
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
        <div style={well}>
            <span style={lbl}>Player Intent</span>
            <PlayerIntentView entry={entry} />
        </div>
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
                            // D30: the mind's scheme_adjustment is applied as this
                            // entity's own active_scheme evolution (see the applied
                            // 'scheme' delta and the [Mind] note below, and the
                            // post-turn Scheme in the state view).
                            <div style={{ color: '#E3C766', fontStyle: 'italic' }}><strong style={{ color: DIM, fontStyle: 'normal' }}>Scheme shift (applied as their own scheme):</strong> {decision.scheme_adjustment}</div>
                        )}
                    </div>
                ))}
            </div>
        )}
        {directorNotes.length > 0 && (
            <div style={redacted}>
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
            <GmNote>No specific entity actions were recorded.</GmNote>
        )}
    </>
    );
};

/**
 * One relationship axis as a centre-zero bar. GM-side only: these four values
 * are ground truth on `Entity.relationships` and never reach a player surface
 * (the player's relationship knowledge is sourced prose observations with no
 * scores at all — see components/tabs/RelationshipObservations.tsx).
 *
 * Signed axes (trust, respect) run -10…10 across the whole track. Unsigned
 * ones (threat, dependency) have no negative half, so 0…10 fills rightward
 * from the same centre tick — how far past neutral, not a false symmetry.
 */
const RelationshipAxis: React.FC<{ label: string; value: number; signed: boolean }> = ({ label, value, signed }) => {
    const span = signed ? Math.max(-10, Math.min(10, value)) / 10 : Math.max(0, Math.min(10, value)) / 10;
    const width = Math.abs(span) * 50;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 30px', gap: 8, alignItems: 'center' }}>
            <span style={{ ...lbl, fontSize: 9.5, letterSpacing: '.12em' }}>{label}</span>
            <span style={{ position: 'relative', display: 'block', height: 7, background: 'rgba(0,0,0,.45)', border: '1px solid rgba(201,162,39,.2)' }}>
                <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(201,162,39,.55)' }} />
                <span
                    aria-hidden="true"
                    style={{
                        position: 'absolute', top: 0, bottom: 0, width: `${width}%`,
                        ...(span < 0 ? { right: '50%' } : { left: '50%' }),
                        background: span < 0 ? 'var(--metal-crimson)' : 'var(--metal-gold)',
                    }}
                />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: PARCH, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
};

/** The entity ids a turn's deltas actually touch — delta keys are colon-joined
 *  segments (`entityId:attr`, `aId:bId:attr`, `region:…`), so this resolves
 *  each segment against the turn's own roster rather than matching substrings. */
function movedEntityIds(adjudication: Adjudication, roster: Entity[]): string[] {
    const known = new Set(roster.map(entity => entity.entity_id));
    const moved = new Set<string>();
    for (const delta of adjudication.deltas) {
        for (const segment of delta.key.split(':')) {
            if (known.has(segment)) moved.add(segment);
        }
    }
    for (const action of adjudication.entityActions) {
        if (known.has(action.id)) moved.add(action.id);
    }
    return [...moved];
}

/**
 * What changed, in one turn — the ledger on the left, who moved on the right.
 * Entity States and Deltas were two answers to the same question (audit item
 * 31), so they read as one pane.
 */
const WhatChangedView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
    const adjudication = entry.adjudication;
    const roster = entry.postTurnEntities;
    const moved = roster ? movedEntityIds(adjudication, roster) : [];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...lbl, color: GOLD }}>The ledger</span>
                {adjudication.deltas.length === 0 ? (
                    <GmNote>No state deltas were recorded.</GmNote>
                ) : adjudication.deltas.map((delta, index) => (
                    <div key={index} style={{ ...well, display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px' }}>
                        <span style={{ ...lbl, color: RED }}>{delta.type}</span>
                        <span style={{ fontFamily: MONO, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: delta.delta > 0 ? GREEN : delta.delta < 0 ? RED : DIM }}>
                            {delta.delta > 0 ? `+${delta.delta}` : delta.delta}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: PARCH, gridColumn: '1 / -1', wordBreak: 'break-word' }}>{delta.key}</span>
                        {delta.new_status && (
                            <span style={{ fontFamily: MONO, fontSize: 12, color: RED, gridColumn: '1 / -1' }}>→ {delta.new_status}{delta.new_location ? ` · ${delta.new_location}` : ''}</span>
                        )}
                        <span style={{ fontSize: 13, fontStyle: 'italic', color: DIM, gridColumn: '1 / -1' }}>“{delta.reason}”</span>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...lbl, color: GOLD }}>Who moved</span>
                {!roster ? (
                    <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one.</GmNote>
                ) : moved.length === 0 ? (
                    <GmNote>No entity was touched by this turn's deltas.</GmNote>
                ) : moved.map(entityId => {
                    const entity = roster.find(e => e.entity_id === entityId);
                    if (!entity) return null;
                    const relationships = Object.entries(entity.relationships).filter(([, rel]) => rel) as [string, Relationship][];
                    return (
                        <div key={entityId} style={well}>
                            <span style={{ color: RED, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{entity.name}</span>

                            <span style={{ color: DIM, fontSize: 13 }}> — {entity.status} · {entity.location}</span>
                            {entity.active_scheme && <div style={{ fontSize: 13, marginTop: 6 }}><SchemeLine scheme={entity.active_scheme} /></div>}
                            {relationships.map(([targetId, rel]) => (
                                <div key={targetId} style={{ marginTop: 8, borderTop: '1px solid rgba(201,162,39,.15)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{roster.find(e => e.entity_id === targetId)?.name || targetId}</span>
                                    <RelationshipAxis label="Trust" value={rel.trust_level} signed />
                                    <RelationshipAxis label="Threat" value={rel.perceived_threat ?? 0} signed={false} />
                                    <RelationshipAxis label="Respect" value={rel.respect_level ?? 0} signed />
                                    <RelationshipAxis label="Depend." value={rel.dependency_level ?? 0} signed={false} />
                                </div>
                            ))}
                        </div>
                    );
                })}
                {/* The whole roster is still one click away — merging the two
                    tabs must not cost a GM the full post-turn state. */}
                {roster && (
                    <details style={{ ...well, marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', color: GOLD, fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Full roster after this turn</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                            <EntityStatesView entities={roster} />
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
};

const PrivateView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <>
        {adjudication.gm_private.length > 0 ? (
            adjudication.gm_private.map((note, index) => (
                <div key={index} style={{ ...redacted, fontStyle: 'italic', fontSize: 14, color: DIM }}>“{note}”</div>
            ))
        ) : (
            <GmNote>No private GM notes for this turn.</GmNote>
        )}
    </>
);

/**
 * The Fates' loom returns as a latency strip (WP-1, WP-12): the kit already
 * records model, milliseconds and attempts per call, so a turn's cost is
 * legible without opening the raw tab. A call that needed a retry runs
 * crimson.
 */
const LatencyStrip: React.FC<{ rawCalls?: RawCallRecord[] }> = ({ rawCalls }) => {
    if (!rawCalls || rawCalls.length === 0) return null;
    const slowest = Math.max(1, ...rawCalls.map(call => call.latencyMs));
    return (
        <div style={{ ...well, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={lbl}>Latency — {rawCalls.length} call{rawCalls.length === 1 ? '' : 's'}, {rawCalls.reduce((sum, call) => sum + call.latencyMs, 0)}ms total</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44 }}>
                {rawCalls.map((call, index) => (
                    <div key={index} title={`${call.callName} · ${call.model} · ${call.latencyMs}ms · ${call.attempts} attempt${call.attempts > 1 ? 's' : ''}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <span
                            aria-hidden="true"
                            style={{
                                display: 'block',
                                height: `${Math.max(6, (call.latencyMs / slowest) * 100)}%`,
                                background: call.attempts > 1 ? 'var(--metal-crimson)' : 'var(--metal-gold)',
                                boxShadow: call.attempts > 1 ? '0 0 9px rgba(192,68,52,.75)' : '0 0 7px rgba(232,201,89,.6)',
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

/** Raw private-scene inspection. This component is reachable only inside the GM console. */
const PrivateSceneGmView: React.FC<{ scenes: readonly PrivateSceneRecord[] }> = ({ scenes }) => (
    <section aria-label="Private scene GM ledger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ ...lbl, color: GOLD }}>Private Scene Ledger</span>
        {scenes.length === 0 ? (
            <GmNote>No private scenes have been recorded.</GmNote>
        ) : scenes.slice().reverse().map(scene => (
            <details key={scene.sceneId} style={well}>
                <summary style={{ cursor: 'pointer', color: PARCH }}>
                    Turn {scene.macroTurn} · {scene.playerName} / {scene.npcName} · {scene.status}
                </summary>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                    <div><strong style={{ color: DIM }}>Scene ID:</strong> <span style={{ fontFamily: MONO }}>{scene.sceneId}</span></div>
                    {scene.closureReason && <div><strong style={{ color: DIM }}>Closure:</strong> {scene.closureReason}</div>}
                    {scene.lastWord && <div><strong style={{ color: DIM }}>Last word:</strong> {scene.lastWord}</div>}
                    <div>
                        <strong style={{ color: DIM }}>Consequence:</strong> {scene.consequenceStatus}
                        {scene.consequenceStatus === 'consumed' && scene.consumedByTurn !== undefined
                            ? ` · Consumed by turn ${scene.consumedByTurn}`
                            : ''}
                    </div>
                </div>
                <div style={{ marginTop: 8 }}>
                    <span style={lbl}>Transcript</span>
                    {scene.transcript.map(line => (
                        <p key={line.sequence} style={{ margin: '3px 0', fontSize: 14 }}>
                            <strong style={{ color: DIM }}>{line.speaker === 'player' ? scene.playerName : scene.npcName}:</strong> {line.text}
                        </p>
                    ))}
                </div>
                <div style={{ marginTop: 8 }}>
                    <span style={lbl}>Speech acts</span>
                    {scene.speechActs.length === 0 ? (
                        <p style={{ color: DIM, margin: '3px 0' }}>None recorded.</p>
                    ) : (
                        <ul style={{ margin: '3px 0', paddingLeft: 18 }}>
                            {scene.speechActs.map((act, index) => (
                                <li key={index} style={{ fontSize: 13 }}>
                                    Exchange {act.exchange} · {act.speaker} · {act.kind}: {act.text}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div style={{ ...well, marginTop: 8, border: '1px solid rgba(179,58,43,.45)' }}>
                    <span style={{ ...lbl, color: RED }}>NPC private intent — GM only</span>
                    <div style={{ fontSize: 13, marginTop: 4 }}><strong style={{ color: DIM }}>Sincerity:</strong> {scene.npcPrivate.sincerity}</div>
                    <div style={{ fontSize: 13 }}><strong style={{ color: DIM }}>Hidden intent:</strong> {scene.npcPrivate.hiddenIntent}</div>
                    <div style={{ fontSize: 13 }}>
                        <strong style={{ color: DIM }}>Planned follow-through:</strong>{' '}
                        {scene.npcPrivate.plannedFollowThrough.length > 0
                            ? scene.npcPrivate.plannedFollowThrough.join(' · ')
                            : 'None recorded.'}
                    </div>
                </div>
            </details>
        ))}
    </section>
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

// ── WP-19: Narration · Raw · Fixtures ─────────────────────────────────
// Three questions the console could not answer: what the player actually
// received and what was cut from it; which round-trips it took and what was
// sent; and what would leave the room if you exported this turn.

/** A headline the boundary dropped, or a reason/notes it replaced. */
function isHeadlineSurface(surface: string): boolean {
    return surface.startsWith('headlines[');
}

/**
 * The Tyrian treatment `RawRegister` wears for the system instruction, lifted
 * to a const so the monologue slip can wear the SAME one rather than a second
 * near-identical purple.
 */
const tyrian: React.CSSProperties = { background: 'rgba(94,34,70,.22)', border: '1px solid rgba(94,34,70,.5)' };
const TYRIAN_KICKER = '#C89BB4';

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
 * the console itself still reaches it through GameMasterScreen.
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

/** validated / attempt N / invalid json — the flag the rail sorts anomalies by. */
function callFlag(call: RawCallRecord): { word: string; color: string; bad: boolean } {
    if (!call.validated) return { word: 'invalid json', color: RED, bad: true };
    if (call.attempts > 1) return { word: `attempt ${call.attempts}`, color: '#E9B36A', bad: false };
    return { word: 'validated', color: GREEN, bad: false };
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => (
    <button
        type="button"
        onClick={() => { void navigator.clipboard?.writeText(text); }}
        style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: DIM }}
    >
        Copy
    </button>
);

const RawRegister: React.FC<{ title: string; meta: string; body: string; tyrian?: boolean }> = ({ title, meta, body, tyrian: isTyrian = false }) => (
    <details style={{ ...well, ...(isTyrian ? tyrian : {}) }}>
        <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span style={{ ...lbl, color: isTyrian ? TYRIAN_KICKER : GOLD }}>{title}</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{meta}</span>
        </summary>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><CopyButton text={body} /></div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 0', fontFamily: MONO, fontSize: 11.5, lineHeight: 1.55, color: PARCH }}>{body}</pre>
    </details>
);

/**
 * Which round-trips this turn took, and what was sent. A schema-repair retry
 * is pushed as its own record under the same `callName`; the rail is where
 * that pair finally sits next to itself.
 */
const RawView: React.FC<{ adjudication: Adjudication; rawCalls?: RawCallRecord[] }> = ({ adjudication, rawCalls }) => {
    const calls = rawCalls ?? [];
    const [selected, setSelected] = useState(0);
    const call = calls[Math.min(selected, calls.length - 1)];
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {calls.length > 0 && (
                <nav aria-label="Raw calls" style={{ flex: 'none', width: 250, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {calls.map((record, index) => {
                        const flag = callFlag(record);
                        const active = record === call;
                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setSelected(index)}
                                aria-current={active ? 'true' : undefined}
                                style={{ all: 'unset', cursor: 'pointer', padding: '7px 9px', borderLeft: `3px solid ${flag.bad ? 'var(--metal-crimson)' : active ? 'var(--gold-500)' : 'transparent'}`, background: active ? 'rgba(201,162,39,.08)' : 'transparent' }}
                            >
                                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: MONO, fontSize: 11.5, color: PARCH }}>
                                    <span>{record.callName}</span>
                                    <span style={{ color: DIM }}>{record.latencyMs}ms</span>
                                </span>
                                <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: DIM }}>
                                    {record.model} · <span style={{ color: flag.color }}>{flag.word}</span>
                                </span>
                            </button>
                        );
                    })}
                </nav>
            )}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {call ? (
                    <>
                        <RawRegister
                            tyrian
                            title="System instruction"
                            meta={call.systemInstruction ? `${call.systemInstruction.length} chars` : 'not captured'}
                            body={call.systemInstruction ?? 'Not captured — this record was restored from a save, which never carries prompt text.'}
                        />
                        <RawRegister
                            title="Prompt as sent"
                            meta={`${call.promptChars} chars · captured to ${MAX_CAPTURED_PROMPT_CHARS.toLocaleString()}`}
                            body={call.promptText ?? 'Not captured — this record was restored from a save, which never carries prompt text.'}
                        />
                        <RawRegister
                            title="Response"
                            meta={`${call.validated ? 'validated' : 'NOT validated'} · ${call.rawResponse.length} chars`}
                            body={call.rawResponse}
                        />
                    </>
                ) : (
                    <GmNote>No raw calls captured for this turn.</GmNote>
                )}
                <details style={{ ...well, fontFamily: MONO, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', color: GOLD }}>Parsed adjudication</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0', color: PARCH }}>{JSON.stringify(adjudication, null, 2)}</pre>
                </details>
            </div>
        </div>
    );
};

/** The pane's one button treatment, worn by both of its controls. */
const gmButton: React.CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: '#241C11', background: 'var(--metal-gold)', border: '1px solid #8A6D14', clipPath: 'var(--chamfer-sm)', padding: '9px 16px', cursor: 'pointer', boxShadow: 'var(--bevel)' };

/**
 * What would leave the room if you exported this turn. The seed replays the
 * dice; the manifest names every slice the corpus carries, including the two
 * that are absent rather than empty when a campaign predates them.
 *
 * The plaque used to ASSERT that the seed replays the rolls. "Strike the
 * mould again" proves it: `replayTurnDraws` re-draws from the recorded seed
 * and compares draw for draw (ai/core/turnReplay.ts). It re-runs no model
 * call and no pipeline.
 *
 * Exported for direct component testing (tests/gmNarrationPane.test.tsx);
 * the console itself still reaches it through GameMasterScreen.
 */
export const FixturesView: React.FC<{
    entry: TurnHistoryEntry;
    history: TurnHistoryEntry[];
    sessionCalls: number;
    hasTruthLedger: boolean;
    hasKnowledge: boolean;
    onExport: () => void;
}> = ({ entry, history, sessionCalls, hasTruthLedger, hasKnowledge, onExport }) => {
    // A replay belongs to the turn it was STRUCK FROM, so it is stored with
    // that turn and read back only for it - switching turns on the rail
    // therefore cannot leave the previous turn's verdict standing, with no
    // reset effect needed.
    const [struck, setStruck] = useState<{ entry: TurnHistoryEntry; result: TurnReplayResult } | null>(null);
    const replay = struck?.entry === entry ? struck.result : null;
    // Draw order: the player action's resolution roll first (when
    // consequential), then each VALID mortality roll in claim order. An
    // invalidated claim never reaches the dice, so it consumes no draw.
    const draws: { label: string; roll: number }[] = [];
    if (entry.resolutionTrace) draws.push({ label: `Action · ${entry.resolutionTrace.assessment.action_category}`, roll: entry.resolutionTrace.roll });
    for (const event of entry.mortalityTrace ?? []) {
        if (typeof event.roll === 'number') draws.push({ label: `Mortality · ${event.entity_name}`, roll: event.roll });
    }
    const promptTexts = history.reduce((sum, item) => sum + (item.rawCalls ?? []).filter(call => call.promptText).length, 0);
    const manifest: { label: string; count: string }[] = [
        { label: 'turns[]', count: `${history.length}` },
        { label: 'rawCalls[].promptText', count: `${promptTexts} captured` },
        { label: 'turnSeed · traces', count: `${history.filter(item => item.turnSeed !== undefined).length} seeded` },
        { label: 'npcIntents · npcMindResults', count: 'private reasoning included' },
        { label: 'sessionCallLog', count: `${sessionCalls}` },
    ];
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="gor-gm-plaque">
                    <span className="gor-gm-plaque-seed">{entry.turnSeed ?? '—'}</span>
                    <span style={{ ...lbl, letterSpacing: '.2em' }}>replays this turn's rolls in draw order</span>
                </div>
                <div style={well}>
                    <span style={lbl}>Rolls, in draw order</span>
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {draws.length === 0 && (
                            <span style={{ color: DIM }}>
                                This turn drew no dice{entry.turnSeed !== undefined ? ' — there is nothing to strike from the mould.' : '.'}
                            </span>
                        )}
                        {draws.map((draw, index) => {
                            const struck = replay?.draws[index];
                            return (
                                <span key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: MONO, fontSize: 12, color: PARCH }}>
                                    <span>{index + 1}. {draw.label}</span>
                                    <span style={{ color: GOLD }}>
                                        {draw.roll}
                                        {struck && (
                                            <span style={{ color: struck.matches ? GREEN : RED }}>
                                                {' '}→ {struck.redrawn} {struck.matches ? '✓' : '✕'}
                                            </span>
                                        )}
                                    </span>
                                </span>
                            );
                        })}
                    </div>
                    {entry.turnSeed !== undefined && draws.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                            <button type="button" onClick={() => setStruck({ entry, result: replayTurnDraws(entry) })} style={gmButton}>
                                Strike the mould again
                            </button>
                            {replay && (
                                <span style={{ fontSize: 12.5, color: replay.allMatch ? GREEN : RED }}>
                                    {replay.allMatch
                                        ? 'The mould holds — every roll re-drawn from the seed matches the record.'
                                        : 'The mould does not hold — the seed and the record disagree.'}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div style={{ flex: 'none', width: 352, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={lbl}>What the corpus carries</span>
                <div style={well}>
                    {manifest.map(row => (
                        <span key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontFamily: MONO, fontSize: 11.5, color: PARCH }}>
                            <span>{row.label}</span>
                            <span style={{ color: DIM }}>{row.count}</span>
                        </span>
                    ))}
                    <span style={{ display: 'block', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(201,162,39,.22)', ...lbl }}>Optional slices</span>
                    {([['truthLedger', hasTruthLedger], ['knowledge', hasKnowledge]] as const).map(([name, present]) => (
                        <span key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontFamily: MONO, fontSize: 11.5, color: PARCH }}>
                            {/* The console's own light Tyrian, not the scale
                                token: `--tyrian-300` is cut for the marble
                                ground and NOX never re-cuts it, so on this
                                permanently dark console it sat near 3.8:1.
                                The other two Tyrian marks here already use
                                this const. */}
                            <span style={{ color: TYRIAN_KICKER }}>◆ {name}</span>
                            <span style={{ color: DIM }}>{present ? 'attached' : 'absent'}</span>
                        </span>
                    ))}
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
                        Absent is not empty: a campaign that predates a slice omits the field entirely, so a
                        consumer can tell "exporter had none" from "campaign has none yet".
                    </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{evalCorpusFilename(entry.turnNumber)}</span>
                    <span style={{ fontSize: 12.5, color: DIM, fontStyle: 'italic' }}>Never written into the save.</span>
                    <button type="button" onClick={onExport} style={gmButton}>
                        Take the impression
                    </button>
                </div>
            </div>
        </div>
    );
};


/**
 * The Ground Truth tuning view (D7 + Phase 2 item 4). Puts the two sides
 * side by side deliberately: every delta this turn, and what classifyDelta
 * (the same function the player-facing digest/WorldStateTab use) would have
 * let through for the current player character - so filter rules can be
 * tuned by eyeballing the diff.
 *
 * Also surfaces `mortalityTrace` off the turn history entry, if present.
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
    const mortalityTrace = entry.mortalityTrace;

    return (
        <>
            <div>
                <span style={lbl}>Unfiltered Deltas vs. Perception Filter</span>
                <p style={{ fontSize: 13, color: DIM, margin: '4px 0 8px' }}>
                    Left: raw ground truth for this turn. Right: what perception/visibility.ts's classifyDelta lets{' '}
                    {playerAtTurn ? <span style={{ color: PARCH }}>{playerAtTurn.name}</span> : 'the player'} perceive.
                </p>
                {!snapshotEntities ? (
                    <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the perception classification needs the turn's own roster.</GmNote>
                ) : !playerAtTurn ? (
                    <GmNote>No player character to classify against for this turn.</GmNote>
                ) : entry.adjudication.deltas.length === 0 ? (
                    <GmNote>No deltas were recorded this turn.</GmNote>
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
                    <p style={{ fontSize: 13, color: DIM, margin: '4px 0 0' }}>No mortality trace recorded for this turn — nothing triggered the Fates' scales.</p>
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
        return <GmNote>Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the per-NPC perception derivation needs the turn's own roster.</GmNote>;
    }
    if (!perceivingIds) {
        return <GmNote>No perceiving-NPC set recorded for this turn.</GmNote>;
    }
    if (perceivingIds.length === 0) {
        return <GmNote>No NPCs were selected to perceive this turn.</GmNote>;
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
            <GmNote>No rumors have been recorded in the truth ledger yet.</GmNote>
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
const PlayerKnowledgeView: React.FC<{ knowledge: KnowledgeClaim[] }> = ({ knowledge }) => {
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

const GameMasterScreen: React.FC<{
    history: TurnHistoryEntry[];
    onClose: () => void;
    interventionText: string;
    onSetIntervention: (text: string) => boolean | void | Promise<boolean | void>;
    interactionLocked?: boolean;
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
    /** Raw private-scene records. This prop is GM-only and must never be forwarded to player components. */
    privateScenes?: readonly PrivateSceneRecord[];
    /**
     * DESIGN_DECISIONS.md D32 - the configuration menu's GM-Intervention-
     * availability toggle (persistence/uiPrefs.ts). Defaults to `true`
     * when absent so every legacy call site (including this screen's own
     * smoke tests, which never pass it) renders identically to before this
     * toggle existed. UI gating only - `false` hides the input/button
     * below; it never touches the turn pipeline that consumes
     * `interventionText`.
     */
    gmInterventionEnabled?: boolean;
}> = ({ history, onClose, interventionText, onSetIntervention, interactionLocked = false, playerCharacterId, worldState, turnNumber, inferredAmbition, pendingIntelligenceFallout, truthLedger, reports, knowledge, npcIntents, privateScenes, gmInterventionEnabled = true }) => {
    const [activeTab, setActiveTab] = useState('summary');
    // The rail's selection. `null` means "the newest turn", so a console
    // opened mid-campaign lands on the turn the GM just watched happen, and a
    // new turn arriving while the console is open does not strand the view on
    // an older one the GM never chose.
    const [selectedTurnNumber, setSelectedTurnNumber] = useState<number | null>(null);
    const [interventionInput, setInterventionInput] = useState(interventionText);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);

    useEffect(() => {
        if (!showConfirmation) return;
        const t = setTimeout(() => setShowConfirmation(false), 3000);
        return () => clearTimeout(t);
    }, [showConfirmation]);

    // Focus the dialog on open, restore to the invoker (the "GM Log"
    // button) on close - same components/ui/focusTrap.ts contract as every
    // other gor-dialog-shaped overlay.
    useEffect(() => {
        if (!dialogRef.current) return;
        const trap = createFocusTrap(dialogRef.current);
        trapRef.current = trap;
        trap.activate();
        return () => {
            trap.release();
            trapRef.current = null;
        };
    }, []);

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        trapRef.current?.handleKeyDown(event);
    };

    const handleSetIntervention = async () => {
        if (await onSetIntervention(interventionInput) !== false) setShowConfirmation(true);
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

    // Newest first, matching the order the console has always listed turns in.
    const railTurns = history.slice().reverse();
    const selectedEntry = (selectedTurnNumber === null
        ? railTurns[0]
        : railTurns.find(entry => entry.turnNumber === selectedTurnNumber) ?? railTurns[0]) ?? null;

    /** Anomalies worth flagging on the rail without opening anything: how many
     *  retries a turn cost, and whether the Fates weighed a life in it. */
    const railFlags = (entry: TurnHistoryEntry): string => {
        const retries = (entry.rawCalls ?? []).reduce((sum, call) => sum + Math.max(0, call.attempts - 1), 0);
        const weighed = entry.mortalityTrace ? '✝' : '';
        return [retries > 0 ? `↻${retries}` : '', weighed].filter(Boolean).join(' ');
    };

    return (
        <div className="gor-dialog-backdrop">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="gm-screen-title"
                tabIndex={-1}
                onKeyDown={handleDialogKeyDown}
                style={{ width: 'min(1060px, calc(100% - 48px))', height: 'calc(100% - 56px)', display: 'flex', flexDirection: 'column', background: 'var(--dentil) left top/100% 4px no-repeat, linear-gradient(180deg,#2A231A,#161209 60%,#131009)', border: '1px solid rgba(201,162,39,.45)', clipPath: 'var(--chamfer-lg)', filter: 'drop-shadow(0 24px 60px rgba(0,0,0,.55))', padding: '20px 24px 18px', gap: 12, boxSizing: 'border-box' }}
            >
                <div style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid rgba(201,162,39,.25)', paddingBottom: 12 }}>
                    <div>
                        <h2 id="gm-screen-title" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 26, color: GOLD, textShadow: '0 2px 3px rgba(0,0,0,.6)', margin: 0 }}>Game Master Tools</h2>
                        <span style={{ ...lbl, letterSpacing: '.24em' }}>The Fates' ledger — every thread measured, every die recorded</span>
                    </div>
                    {/* The export moved to `fixtures` (WP-19), where the manifest
                        states what would leave the room before you take it. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button type="button" onClick={onClose} aria-label="Close Game Master screen" style={{ all: 'unset', cursor: 'pointer', color: DIM, fontSize: 26, lineHeight: 1, padding: '2px 8px' }}>×</button>
                    </div>
                </div>

                {/* DESIGN_DECISIONS.md D8 - the sole rendered owner of inferred ambition, for GM inspection and tuning only. It never feeds the player epilogue, NPC reactions, or any player-facing view. */}
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

                <div
                    style={{ flex: 'none', display: 'flex', gap: 2, borderBottom: '1px solid rgba(201,162,39,.25)', flexWrap: 'wrap' }}
                    role="tablist"
                    aria-label="Ledger views"
                    onKeyDown={radioGroupKeyDown(TABS, activeTab, setActiveTab, { role: 'tab' })}
                >
                    {TABS.map(tab => (
                        <button
                            key={tab}
                            id={gmTabDomId(tab)}
                            role="tab"
                            aria-selected={tab === activeTab}
                            aria-controls={GM_TABPANEL_ID}
                            tabIndex={tab === activeTab ? 0 : -1}
                            onClick={() => setActiveTab(tab)}
                            style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', padding: '8px 12px', color: tab === activeTab ? GOLD : DIM, borderBottom: tab === activeTab ? '2px solid var(--gold-500)' : '2px solid transparent', background: tab === activeTab ? 'rgba(201,162,39,.08)' : 'transparent' }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* The turn rail (WP-12). Every per-turn tab is scoped to the
                    one turn selected here; the two campaign-wide collections
                    ignore it. Retry counts and mortality checks flag on the
                    rail so anomalies surface without opening anything. */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14 }}>
                    {!CAMPAIGN_WIDE_TABS.has(activeTab) && history.length > 0 && (
                        <nav
                            aria-label="Turns"
                            style={{ flex: 'none', width: 172, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, borderRight: '1px solid rgba(201,162,39,.2)', paddingRight: 8 }}
                        >
                            {railTurns.map(entry => {
                                const selected = selectedEntry?.turnNumber === entry.turnNumber;
                                const flags = railFlags(entry);
                                return (
                                    <button
                                        key={entry.turnNumber}
                                        type="button"
                                        aria-current={selected ? 'true' : undefined}
                                        onClick={() => setSelectedTurnNumber(entry.turnNumber)}
                                        style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 10px', borderLeft: `3px solid ${selected ? 'var(--gold-500)' : 'transparent'}`, background: selected ? 'rgba(201,162,39,.10)' : 'transparent', color: selected ? GOLD : DIM, fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}
                                    >
                                        <span>Turn {toRoman(entry.turnNumber)}</span>
                                        {flags && <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0, color: RED }}>{flags}</span>}
                                    </button>
                                );
                            })}
                        </nav>
                    )}

                    <div
                        role="tabpanel"
                        id={GM_TABPANEL_ID}
                        aria-labelledby={gmTabDomId(activeTab)}
                        style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 6, display: 'flex', flexDirection: 'column', gap: 20, color: PARCH }}
                    >
                        {activeTab === 'private' && <PrivateSceneGmView scenes={privateScenes ?? []} />}
                        {/* The truth ledger and the player knowledge store are each one campaign-wide bounded collection (D11/D21), not per-turn data - rendered whole, ignoring the rail. */}
                        {activeTab === 'truth ledger' ? (
                            <TruthLedgerView ledger={truthLedger ?? []} reports={reports ?? []} />
                        ) : activeTab === 'player knowledge' ? (
                            <PlayerKnowledgeView knowledge={knowledge ?? []} />
                        ) : !selectedEntry ? (
                            <p style={{ color: DIM }}>No turns have been processed yet.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '.1em', color: GOLD }}>TURN {toRoman(selectedEntry.turnNumber)}</span>
                                <LatencyStrip rawCalls={selectedEntry.rawCalls} />
                                {activeTab === 'summary' && <SummaryView entry={selectedEntry} />}
                                {activeTab === 'what changed' && <WhatChangedView entry={selectedEntry} />}
                                {activeTab === 'actions' && <ActionsView entry={selectedEntry} />}
                                {activeTab === 'private' && <PrivateView adjudication={selectedEntry.adjudication} />}
                                {activeTab === 'ground truth' && <GroundTruthView entry={selectedEntry} playerCharacterId={playerCharacterId} worldState={worldState} />}
                                {activeTab === 'npc perception' && <NpcPerceptionView entry={selectedEntry} worldState={worldState} />}
                                {activeTab === 'narration' && <NarrationView entry={selectedEntry} />}
                                {activeTab === 'raw json' && <RawView adjudication={selectedEntry.adjudication} rawCalls={selectedEntry.rawCalls} />}
                                {activeTab === 'fixtures' && (
                                    <FixturesView
                                        entry={selectedEntry}
                                        history={history}
                                        sessionCalls={getSessionCallLog().length}
                                        hasTruthLedger={Boolean(truthLedger)}
                                        hasKnowledge={Boolean(knowledge)}
                                        onExport={handleExportEvalCorpus}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* GM Intervention docks to the foot (WP-12) and names the turn
                    it lands in. Its button is GOLD, not crimson metal — crimson
                    reads as delete, and this creates rather than destroys. */}
                <div style={{ flex: 'none', ...well, border: '1px solid rgba(201,162,39,.35)' }}>
                    <span style={{ ...lbl, color: GOLD }}>GM Intervention — lands in turn {toRoman(turnNumber + 1)}</span>
                    {gmInterventionEnabled ? (
                        <>
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
                                    disabled={interactionLocked}
                                    style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: '#241C11', background: 'var(--metal-gold)', border: '1px solid #8A6D14', clipPath: 'var(--chamfer-sm)', padding: '9px 16px', cursor: 'pointer', boxShadow: 'var(--bevel)' }}
                                >
                                    Set Directive for Next Turn
                                </button>
                                {showConfirmation && <span style={{ color: GREEN, fontStyle: 'italic', fontSize: 14, animation: 'gorFadeIn .3s ease-out both' }}>The Fates have heard. It will be woven into the next turn.</span>}
                            </div>
                        </>
                    ) : (
                        // D32 - disabled via the configuration menu. UI gating
                        // only: the input/button are hidden, but any directive
                        // already set from before disabling is left alone
                        // (this is not a mechanism for clearing it).
                        <p style={{ margin: '4px 0 0', fontSize: 14, color: DIM, fontStyle: 'italic' }}>Disabled in the configuration menu.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GameMasterScreen;
