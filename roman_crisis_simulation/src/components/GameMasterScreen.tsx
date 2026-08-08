import React, { useState, useEffect, useRef } from 'react';
import { TurnHistoryEntry, WorldState, TruthLedgerEntry, Report, NpcIntent } from '../types';
import { KnowledgeClaim } from '../knowledge/store';
import { InferredAmbitionState, SAVE_VERSION } from '../persistence/saveGame';
import { buildEvalCorpus, evalCorpusFilename } from '../persistence/evalCorpus';
import { getSessionCallLog } from '../ai/core/geminiService';
import { toRoman } from './ui/Brand';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';
import type { PrivateSceneRecord } from '../privateScene/model';
import { radioGroupKeyDown } from './ui/rovingRadio';
import { GOLD, DIM, PARCH, RED, GREEN, MONO, lbl, well } from './gm/shared';
import { SummaryView } from './gm/SummaryView';
import { ActionsView } from './gm/ActionsView';
import { WhatChangedView } from './gm/WhatChangedView';
import { PrivateView } from './gm/PrivateView';
import { LatencyStrip } from './gm/LatencyStrip';
import { PrivateSceneGmView } from './gm/PrivateSceneGmView';
import { NarrationView } from './gm/NarrationView';
import { RawView } from './gm/RawView';
import { FixturesView } from './gm/FixturesView';
import { GroundTruthView } from './gm/GroundTruthView';
import { NpcPerceptionView } from './gm/NpcPerceptionView';
import { TruthLedgerView } from './gm/TruthLedgerView';
import { PlayerKnowledgeView } from './gm/PlayerKnowledgeView';

/**
 * Game Master Tools — "the Fates' ledger": a dark tablinum modal over the
 * marble client. This is the ONE place raw, unfiltered ground truth is
 * allowed to reach a rendered screen (D5/D7) — everywhere else goes through
 * perception/visibility.ts's filter. Hidden by default; Ctrl+Shift+G (or the
 * dev Header switch) governs whether the GM Log button even appears (D7).
 */

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

export { NarrationView } from './gm/NarrationView';
export { FixturesView } from './gm/FixturesView';
export default GameMasterScreen;
