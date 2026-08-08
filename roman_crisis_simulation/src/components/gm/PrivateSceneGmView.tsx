import React from 'react';
import type { PrivateSceneRecord } from '../../privateScene/model';
import { well, lbl, GmNote, GOLD, DIM, PARCH, RED, MONO } from './shared';

/** Raw private-scene inspection. This component is reachable only inside the GM console. */
export const PrivateSceneGmView: React.FC<{ scenes: readonly PrivateSceneRecord[] }> = ({ scenes }) => (
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
