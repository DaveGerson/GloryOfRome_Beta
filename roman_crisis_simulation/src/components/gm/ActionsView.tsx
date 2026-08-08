import React from 'react';
import { TurnHistoryEntry } from '../../types';
import { well, lbl, redacted, GmNote, GOLD, DIM, PARCH, RED, GREEN, MONO } from './shared';
import { PlayerIntentView } from './PlayerIntentView';

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
export const ActionsView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => {
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
