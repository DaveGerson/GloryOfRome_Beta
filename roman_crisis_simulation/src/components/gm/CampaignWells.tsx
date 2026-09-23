import React from 'react';
import type { NpcIntent } from '../../types';
import type { InferredAmbitionState } from '../../persistence/saveGame';
import { GOLD, DIM, RED, GREEN, MONO, lbl, well } from './shared';

/**
 * The campaign-wide wells above the ledger's tabs (split out of
 * GameMasterScreen.tsx): the D8 inferred ambition, the Director's current
 * persistent intents (4C item 3) and the pending investigation fallout
 * (Phase 3 item 5). GM-private, like everything on the console (D4/D5/D7);
 * each renders only when it has something to say.
 */
export const CampaignWells: React.FC<{
    inferredAmbition?: InferredAmbitionState | null;
    npcIntents?: NpcIntent[];
    pendingIntelligenceFallout?: string[];
}> = ({ inferredAmbition, npcIntents, pendingIntelligenceFallout }) => (
    <>
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
    </>
);
