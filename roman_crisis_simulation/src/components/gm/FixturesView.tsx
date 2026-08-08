import React, { useState } from 'react';
import { TurnHistoryEntry } from '../../types';
import { replayTurnDraws, type TurnReplayResult } from '../../ai/core/turnReplay';
import { evalCorpusFilename } from '../../persistence/evalCorpus';
import { well, lbl, GOLD, DIM, PARCH, RED, GREEN, MONO, TYRIAN_KICKER } from './shared';

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
 * the console itself still reaches it through GameMasterScreen's re-export
 * of this module.
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
