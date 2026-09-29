import React, { useEffect, useRef } from 'react';
import { PacingPosture } from '../types';
import { Button, Badge, RegisterHeading } from './ui/Core';
import { NotedSwitch, Switch, SegmentedControl } from './ui/Forms';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';
import { ImportFailureNotice } from './ui/FailureNotices';
import type { ImportResult } from '../persistence/saveGame';
import { useReignImport } from './ui/useReignImport';
import { ApiKeyCard } from './ApiKeyCard';
import { NarrationSettings, type NarrationSettingsProps } from './NarrationSettings';
import { ReadingSettings, type ReadingSettingsProps } from './ReadingSettings';

export type { NarratorChoice } from './NarrationSettings';

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 5 (DESIGN_DECISIONS.md D31) - the FATES
 * pacing options (persistence/settings.ts posture, via App.tsx's
 * `onSetPacingPosture`). Since the options-consolidation pass this menu is
 * the ONLY pacing surface - the old fixed bottom-right selector is gone -
 * so each posture's meaning is spelled out visibly below the control, not
 * hidden in hover titles.
 */
const FATES_OPTIONS: { posture: PacingPosture; label: string; title: string; description: string }[] = [
    { posture: 'restrained', label: 'PATIENT', title: 'Patient Fates — long quiet weeks may stand', description: 'long quiet weeks may stand.' },
    { posture: 'balanced', label: 'MEASURED', title: 'Measured Fates — fortune turns when the story calls for it', description: 'fortune turns when the story calls for it.' },
    { posture: 'dramatic', label: 'EAGER', title: 'Eager Fates — the threads pull taut sooner', description: 'the threads pull taut sooner.' },
];

const LIGHTING_OPTIONS = [
    { value: 'lux', label: '☼ LVX', title: 'Marble — day' },
    { value: 'nox', label: '☾ NOX', title: 'Nox Romae — torchlit' },
] as const;

/** A glyph drawn beside a word, but never read as part of the option's name. */
const glyphed = (glyph: string, word: string) => <><span aria-hidden="true">{glyph}</span> {word}</>;

/**
 * Lighting as the platforms offer appearance: follow the device, or always
 * one skin (Apple HIG, Material). "Device" is the default for a device that
 * never chose, and the way back to it after a choice (hooks/useSettings.ts).
 * One exclusive choice of three, so a radio group - like Text size - with
 * its note as its description; the glyphs are hidden from the names, which
 * read "Device", "LVX", "NOX".
 */
const LIGHTING_CHOICES = [
    { value: 'device', label: glyphed('◐', 'Device'), title: 'Follow this device — light or dark' },
    { value: 'lux', label: glyphed('☼', 'LVX'), title: 'Marble — day' },
    { value: 'nox', label: glyphed('☾', 'NOX'), title: 'Nox Romae — torchlit' },
] as const;

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const LIGHTING_COPY = {
    device: "Follows this device's light or dark appearance. Never part of your save.",
    chosen: 'Kept on this device, whatever its appearance. Never part of your save.',
} as const;

/**
 * Player-visible copy for "Behind the curtain" (D43: every option carries a
 * visible description). Like the Reading notes, each line describes the
 * setting in force.
 */
export const CURTAIN_COPY = {
    consoleNote: {
        on: "The shortcut shows or hides the GM Log: the Fates' own record of all that is kept from you, spoilers and all.",
        off: 'The shortcut does nothing, and the GM Log stays out of sight.',
    },
    interventionNote: {
        on: 'The GM Log carries a directive box: what you set there is woven into the next turn.',
        off: "The GM Log's directive box is hidden. A directive already set still stands.",
    },
} as const;

/** Player-visible copy under "Your reign". */
export const REIGN_COPY_NOTE = 'A raw copy of the save file — spoilers if you open it, nothing private.';

const registerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };

/**
 * The configuration menu (D31) - a marble gor-dialog (player-facing, unlike
 * GameMasterScreen's dark tablinum), opened from a Header affordance.
 * Since the options-consolidation pass this is the single home for EVERY
 * option: the player's own Gemini API key (D34), the D23 pacing posture,
 * the LVX/NOX lighting (formerly floating bottom-right chrome), the Reading
 * register (text size, motion, narration reveal, single-key shortcuts), the
 * D32/D33 GM availability toggles, and - dev builds only - the Mock Mode
 * and GM-console runtime switches that used to sit in the Header.
 */
const SettingsMenu: React.FC<NarrationSettingsProps & {
    onClose: () => void;
    /**
     * The device's currently stored key (persistence/apiKey.ts), or null -
     * seeds the input on open only. Never logged, never rendered anywhere
     * else in the app (D34).
     */
    apiKey: string | null;
    onSaveApiKey: (key: string) => void;
    onClearApiKey: () => void;
    pacingPosture: PacingPosture;
    onSetPacingPosture: (posture: PacingPosture) => void;
    /** LVX/NOX - a device preference (localStorage 'gor-theme'), never save state. */
    isNox: boolean;
    onSetIsNox: (isNox: boolean) => void;
    /**
     * The explicit choice behind `isNox` - null while the lighting follows
     * the device. With its setter, the control offers Device / LVX / NOX;
     * without them (a surface that predates the choice), LVX / NOX only.
     */
    lightingChoice?: 'lux' | 'nox' | null;
    onSetLightingChoice?: (choice: 'lux' | 'nox' | null) => void;
    gmConsoleEnabled: boolean;
    onSetGmConsoleEnabled: (enabled: boolean) => void;
    gmInterventionEnabled: boolean;
    onSetGmInterventionEnabled: (enabled: boolean) => void;
    /** Dev-only (rendered under import.meta.env.DEV): Mock Mode + the GM console's runtime switch. */
    isMockMode: boolean;
    onSetIsMockMode: (isMock: boolean) => void;
    gmConsoleOpen: boolean;
    onSetGmConsoleOpen: (enabled: boolean) => void;
    /**
     * "Take a copy of the reign" / "Restore from a copy" (docs/superpowers/
     * specs/2026-08-05-reign-export-import-design.md). NOT DEV-gated - both
     * ship to players. `hasSavedReign` decides whether export has anything
     * to act on (D45's zero-state spirit) AND whether import needs the
     * overwrite confirm; import itself always renders, because a device
     * with no reign is exactly where a restore matters.
     */
    hasSavedReign: boolean;
    onExportReign: () => void;
    onImportReign?: (fileText: string) => ImportResult;
    /**
     * Same grammar as CharacterSelection's: while a domain mutation or turn
     * is in flight, a confirmed restore could be silently un-done - the
     * in-flight save lands after the reload is cancelled and overwrites the
     * imported slot - so the import controls hold until the world is quiet.
     * Export stays live: a read races nothing.
     */
    interactionLocked?: boolean;
    /**
     * The Reading register (components/ReadingSettings.tsx): text size,
     * motion, how the narration arrives, single-key shortcuts. Optional so a
     * surface that renders the menu without it (a test) keeps its shape.
     */
    reading?: ReadingSettingsProps;
}> = ({
    onClose,
    apiKey,
    onSaveApiKey,
    onClearApiKey,
    pacingPosture,
    onSetPacingPosture,
    isNox,
    onSetIsNox,
    lightingChoice,
    onSetLightingChoice,
    gmConsoleEnabled,
    onSetGmConsoleEnabled,
    gmInterventionEnabled,
    onSetGmInterventionEnabled,
    isMockMode,
    onSetIsMockMode,
    gmConsoleOpen,
    onSetGmConsoleOpen,
    hasSavedReign,
    onExportReign,
    onImportReign,
    interactionLocked = false,
    reading,
    ...narration
}) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);
    const {
        pendingImportText, importFailure, importInputRef, keepReignRef, restoreButtonRef,
        handleImportFileChange, confirmImport, cancelImport, openFilePicker,
    } = useReignImport({ hasSavedReign, onImportReign });

    // Focus the dialog on open, restore to the invoker on close - same
    // components/ui/focusTrap.ts contract as every other gor-dialog.
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

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        trapRef.current?.handleKeyDown(event);
    };

    const selectedPacing = FATES_OPTIONS.find(option => option.posture === pacingPosture) ?? FATES_OPTIONS[1];
    return (
        <div className="gor-dialog-backdrop">
            <div
                ref={dialogRef}
                className="gor-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-menu-title"
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                style={{ maxWidth: 560 }}
            >
                <div className="gor-dialog-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <h2 id="settings-menu-title" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>Configuration</h2>
                    <button
                        type="button"
                        className="gor-bare-btn"
                        onClick={onClose}
                        aria-label="Close configuration menu"
                        style={{ color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, padding: '2px 6px' }}
                    >×</button>
                </div>
                <div className="gor-dialog-rule"></div>
                {/* ONE gilt card in this view, deliberately (audit item 32).
                    Gold corner brackets are the design system's most emphatic
                    device; five of them in one scroll made them mean nothing,
                    and a one-time API key weighed the same as a lighting whim.
                    Everything below the key is a hairline-ruled register. */}
                <div className="gor-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '78vh', overflowY: 'auto' }}>
                    <ApiKeyCard apiKey={apiKey} onSaveApiKey={onSaveApiKey} onClearApiKey={onClearApiKey} />

                    <section aria-labelledby="settings-play" style={registerStyle}>
                        <RegisterHeading headingId="settings-play" title="Play" />
                        <div className="gor-config-grid">
                            <span className="gor-label gor-config-label">Pacing</span>
                            <div>
                                {/* One exclusive choice of three, so a radio group like
                                    Lighting and Text size beside it. */}
                                <SegmentedControl
                                    radio
                                    ariaLabel="Pacing posture"
                                    describedBy="settings-pacing-note"
                                    options={FATES_OPTIONS.map(({ posture, label, title }) => ({ value: posture, label, title }))}
                                    value={pacingPosture}
                                    onChange={onSetPacingPosture}
                                />
                                {/* One line about the posture in force, rather than a
                                    three-item list restating all of them each time. */}
                                <p id="settings-pacing-note" className="gor-config-note">{selectedPacing.label.charAt(0) + selectedPacing.label.slice(1).toLowerCase()} Fates — {selectedPacing.description}</p>
                            </div>
                            <span className="gor-label gor-config-label">Lighting</span>
                            <div>
                                {onSetLightingChoice && lightingChoice !== undefined ? (
                                    <>
                                        <SegmentedControl
                                            radio
                                            ariaLabel="Lighting: follow this device, marble day or torchlit night"
                                            describedBy="settings-lighting-note"
                                            options={LIGHTING_CHOICES}
                                            value={lightingChoice ?? 'device'}
                                            onChange={(value) => onSetLightingChoice(value === 'device' ? null : value)}
                                        />
                                        <p id="settings-lighting-note" className="gor-config-note">{lightingChoice ? LIGHTING_COPY.chosen : LIGHTING_COPY.device}</p>
                                    </>
                                ) : (
                                    <>
                                        <SegmentedControl
                                            ariaLabel="Lighting: marble day or torchlit night"
                                            options={LIGHTING_OPTIONS}
                                            value={isNox ? 'nox' : 'lux'}
                                            onChange={(value) => onSetIsNox(value === 'nox')}
                                            style={{ width: 172 }}
                                        />
                                        <p className="gor-config-note">A device preference, never part of your save.</p>
                                    </>
                                )}
                            </div>
                            <NarrationSettings {...narration} />
                        </div>
                    </section>

                    {reading && <ReadingSettings {...reading} />}

                    <section aria-labelledby="settings-curtain" style={registerStyle}>
                        <RegisterHeading headingId="settings-curtain" title="Behind the curtain" />
                        <NotedSwitch
                            id="settings-gm-console-enabled"
                            checked={gmConsoleEnabled}
                            onChange={onSetGmConsoleEnabled}
                            label={<span>GM console available <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(Ctrl+Shift+G)</span></span>}
                            note={gmConsoleEnabled ? CURTAIN_COPY.consoleNote.on : CURTAIN_COPY.consoleNote.off}
                        />
                        <NotedSwitch
                            id="settings-gm-intervention-enabled"
                            checked={gmInterventionEnabled}
                            onChange={onSetGmInterventionEnabled}
                            label="GM Intervention available"
                            note={gmInterventionEnabled ? CURTAIN_COPY.interventionNote.on : CURTAIN_COPY.interventionNote.off}
                        />
                    </section>

                    {/* "Take a copy of the reign" / "Restore from a copy" (D45 as
                        amended) - an ordinary save-to-file feature, not DEV-gated. */}
                    <section aria-labelledby="settings-reign" style={registerStyle}>
                        <RegisterHeading headingId="settings-reign" title="Your reign" />
                        <input
                            ref={importInputRef}
                            type="file"
                            accept="application/json"
                            onChange={handleImportFileChange}
                            style={{ display: 'none' }}
                            aria-hidden="true"
                            tabIndex={-1}
                        />
                        {pendingImportText !== null ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--crimson-500)', fontStyle: 'italic', fontSize: 15 }}>Replace your saved reign with this copy? It cannot be undone.</span>
                                <Button type="button" variant="danger" disabled={interactionLocked} onClick={confirmImport}>Replace</Button>
                                <Button ref={keepReignRef} type="button" variant="ghost" onClick={cancelImport}>Keep my reign</Button>
                            </span>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                {hasSavedReign && (
                                    <Button type="button" variant="ghost" onClick={onExportReign}>Take a copy of the reign</Button>
                                )}
                                <Button ref={restoreButtonRef} type="button" variant="ghost" disabled={interactionLocked} onClick={openFilePicker}>Restore from a copy</Button>
                            </div>
                        )}
                        <p className="gor-config-note">{REIGN_COPY_NOTE}</p>
                        {importFailure && <ImportFailureNotice reason={importFailure} />}
                    </section>

                    {import.meta.env.DEV && (
                        <section aria-labelledby="settings-workshop" style={registerStyle}>
                            <RegisterHeading
                                headingId="settings-workshop"
                                title="Workshop"
                                trailing={<Badge tone="neutral">Dev build only</Badge>}
                            />
                            {/* Sunk into an inset well so it reads as scaffolding
                                rather than regalia — it never ships to a player. */}
                            <div className="gor-config-well">
                                <Switch
                                    id="mock-toggle"
                                    checked={isMockMode}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSetIsMockMode(e.target.checked)}
                                    label={<span>Mock Mode <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>— play keyless against canned responses</span></span>}
                                />
                                <Switch
                                    id="gm-console-toggle"
                                    checked={gmConsoleOpen}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSetGmConsoleOpen(e.target.checked)}
                                    label={<span>GM console on now <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>— no-op while unavailable above</span></span>}
                                />
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsMenu;
