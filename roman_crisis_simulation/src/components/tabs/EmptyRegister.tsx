import React from 'react';

/**
 * The one zero state (audit item 45). Nine surfaces shared a single italic
 * line; each now draws its own register at rest, under five rules:
 *
 *  1. **Name the cause, not the absence** — "No one has told you anything
 *     yet", never "No data available". An empty panel is a fact about the
 *     world, not a gap in the software.
 *  2. **Draw the shape at rest** — the register's own silhouette in blanked
 *     vellum: the spine, the shelf, the slip, the axes. The player learns
 *     what will fill it before anything does.
 *  3. **Full opacity, always** — dimming reads as *disabled* (item 27), and
 *     nothing here is disabled. The dashed rule and the weave carry
 *     "unwritten" without lowering the contrast.
 *  4. **One affordance, and only if it exists now.** Otherwise state what
 *     fills the surface. A zero state must never invent a button.
 *  5. **A fresh reign is not empty** — first run is its own state, with its
 *     own line.
 */
export const EmptyRegister: React.FC<{
    /** The register's own shape, drawn at rest. Omitted where the register has no shape of its own. */
    silhouette?: React.ReactNode;
    /** What is true about the world. One sentence. */
    line: string;
    /** Why that is not a problem, or what will change it. */
    hint?: string;
    /**
     * At most one row, and only where the affordance already exists — the slot
     * through which rule 4 is enforced rather than merely stated.
     *
     * No shipped call site passes one yet: the single use WP-20 specified is
     * the Reports zero state's Personae row of unspent-investigation pips, and
     * that row needs data `ReportsTab` does not hold. Kept unbuilt rather than
     * faked, per rule 4 — a zero state must never invent a button.
     *
     * It needs no CSS of its own and gets none. `.gor-empty` is a centred
     * column with an 8px gap, so whatever the caller passes is laid out on the
     * same rhythm as the line and the hint; and the affordance must ALREADY
     * exist, which means it arrives carrying its own class (`.gor-btn`). A
     * bespoke `.gor-empty-action` would be a shape invented for a caller that
     * does not exist — the class of dead CSS this pass has been deleting.
     */
    action?: React.ReactNode;
}> = ({ silhouette, line, hint, action }) => (
    <div className="gor-empty">
        {silhouette}
        <span className="gor-empty-line">{line}</span>
        {hint && <span className="gor-empty-hint">{hint}</span>}
        {action}
    </div>
);

/** The Chronicle's spine, with one gold marker and one slot still unwritten. */
export const SpineSilhouette: React.FC = () => (
    <span className="gor-sil-spine" aria-hidden="true">
        <span className="gor-sil-spine-rule" />
        <span className="gor-sil-spine-marker" />
        <span className="gor-sil-spine-slot" />
    </span>
);

/** Two slips nobody has sealed. */
export const SlipsSilhouette: React.FC = () => (
    <span className="gor-sil-slips" aria-hidden="true">
        {[0, 1].map(index => (
            <span key={index} className="gor-sil-slip">
                <span className="gor-seal-unsealed" />
                <span className="gor-sil-slip-lines" />
            </span>
        ))}
    </span>
);

/** Two dentil rules around a ❦ — a quiet week still has a shape. */
export const QuietWeekSilhouette: React.FC = () => (
    <span className="gor-sil-quiet" aria-hidden="true">
        <span className="gor-sil-dentil" />
        <span className="gor-sil-fleuron">❦</span>
        <span className="gor-sil-dentil" />
    </span>
);

/** Three empty letter slots — leverage is letters you hold. */
export const LetterSlotsSilhouette: React.FC = () => (
    <span className="gor-sil-slots" aria-hidden="true">
        {[0, 1, 2].map(index => <span key={index} className="gor-sil-slot" />)}
    </span>
);

/** The centre-zero axes, drawn empty: ticks and the centre line, no bars. */
export const AxesSilhouette: React.FC = () => (
    <span className="gor-sil-axes" aria-hidden="true">
        {[0, 1, 2].map(index => (
            <span key={index} className="gor-sil-axis"><span className="gor-sil-axis-centre" /></span>
        ))}
    </span>
);

/** One folded letter, ghosted — the shelf before any door has closed. */
export const FoldedLetterSilhouette: React.FC = () => (
    <span className="gor-sil-letter" aria-hidden="true">
        <span className="gor-sil-letter-fold" />
    </span>
);
