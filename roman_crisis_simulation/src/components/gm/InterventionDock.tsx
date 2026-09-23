import React, { useEffect, useState } from 'react';
import { toRoman } from '../ui/Brand';
import { GOLD, DIM, PARCH, GREEN, lbl, well } from './shared';

/**
 * The GM Intervention input, docked to the console's foot (WP-12) and split
 * out of GameMasterScreen.tsx with the draft and the confirmation it owns.
 * The draft is seeded from the current directive once, on open - it is a
 * draft, not a mirror. `enabled` is D32's configuration toggle: UI gating
 * only; it never clears a directive already set.
 */
export const InterventionDock: React.FC<{
    turnNumber: number;
    interventionText: string;
    onSetIntervention: (text: string) => boolean | void | Promise<boolean | void>;
    interactionLocked: boolean;
    enabled: boolean;
}> = ({ turnNumber, interventionText, onSetIntervention, interactionLocked, enabled }) => {
    const [interventionInput, setInterventionInput] = useState(interventionText);
    const [showConfirmation, setShowConfirmation] = useState(false);

    useEffect(() => {
        if (!showConfirmation) return;
        const t = setTimeout(() => setShowConfirmation(false), 3000);
        return () => clearTimeout(t);
    }, [showConfirmation]);

    const handleSetIntervention = async () => {
        if (await onSetIntervention(interventionInput) !== false) setShowConfirmation(true);
    };

    // Names the turn the directive lands in. Its button is GOLD, not crimson
    // metal — crimson reads as delete, and this creates rather than destroys.
    return (
        <div style={{ flex: 'none', ...well, border: '1px solid rgba(201,162,39,.35)' }}>
            <span style={{ ...lbl, color: GOLD }}>GM Intervention — lands in turn {toRoman(turnNumber + 1)}</span>
            {enabled ? (
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
                        <span role="status">
                            {showConfirmation && <span style={{ color: GREEN, fontStyle: 'italic', fontSize: 14, animation: 'gorFadeIn .3s ease-out both' }}>The Fates have heard. It will be woven into the next turn.</span>}
                        </span>
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
    );
};
