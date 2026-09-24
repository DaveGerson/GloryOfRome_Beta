import React, { useEffect, useRef, useState } from 'react';
import { PacingPosture } from '../types';
import { Button, Badge, RegisterHeading } from './ui/Core';
import { Switch, SegmentedControl } from './ui/Forms';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';
import { ImportFailureNotice } from './ui/FailureNotices';
import type { ImportResult } from '../persistence/saveGame';
import { useReignImport } from './ui/useReignImport';
import { ApiKeyCard } from './ApiKeyCard';
import {
    type NarrationVoiceMode,
    NARRATOR_VOICES,
    getNarratorVoice,
    setNarratorVoice,
    type NarratorVoiceId,
} from '../persistence/uiPrefs';

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

/**
 * The narration voice ("hear it performed", hooks/useNarrationVoice.ts) -
 * a device preference (persistence/uiPrefs.ts), default SILENT because
 * every performance is a paid call on the player's own key. Copy is
 * veto-queue (roadmaps/BACKLOG.md B13).
 */
const NARRATOR_OPTIONS: { value: NarrationVoiceMode; label: string; title: string; description: string }[] = [
    { value: 'off', label: 'SILENT', title: 'The narration is read, not heard', description: 'The narration is read, not heard.' },
    { value: 'on_demand', label: 'ON REQUEST', title: 'A play control on each narration', description: 'A play control on each narration. Every performance is a paid call on your key.' },
    { value: 'auto', label: 'EVERY WEEK', title: 'Each new narration is performed as the week turns', description: 'Each new narration is performed as the week turns. Every performance is a paid call on your key.' },
];

const registerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };

/**
 * The configuration menu (D31) - a marble gor-dialog (player-facing, unlike
 * GameMasterScreen's dark tablinum), opened from a Header affordance.
 * Since the options-consolidation pass this is the single home for EVERY
 * option: the player's own Gemini API key (D34), the D23 pacing posture,
 * the LVX/NOX lighting (formerly floating bottom-right chrome), the
 * D32/D33 GM availability toggles, and - dev builds only - the Mock Mode
 * and GM-console runtime switches that used to sit in the Header.
 */
const SettingsMenu: React.FC<{
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
    gmConsoleEnabled: boolean;
    onSetGmConsoleEnabled: (enabled: boolean) => void;
    gmInterventionEnabled: boolean;
    onSetGmInterventionEnabled: (enabled: boolean) => void;
    /** The narration voice's mode - a device preference, never save state. */
    narrationVoiceMode: NarrationVoiceMode;
    onSetNarrationVoiceMode: (mode: NarrationVoiceMode) => void;
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
}> = ({
    onClose,
    apiKey,
    onSaveApiKey,
    onClearApiKey,
    pacingPosture,
    onSetPacingPosture,
    isNox,
    onSetIsNox,
    gmConsoleEnabled,
    onSetGmConsoleEnabled,
    gmInterventionEnabled,
    onSetGmInterventionEnabled,
    narrationVoiceMode,
    onSetNarrationVoiceMode,
    isMockMode,
    onSetIsMockMode,
    gmConsoleOpen,
    onSetGmConsoleOpen,
    hasSavedReign,
    onExportReign,
    onImportReign,
    interactionLocked = false,
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
    const selectedNarrator = NARRATOR_OPTIONS.find(option => option.value === narrationVoiceMode) ?? NARRATOR_OPTIONS[0];
    const [selectedVoice, setSelectedVoice] = useState<NarratorVoiceId>(() => getNarratorVoice());

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
                        onClick={onClose}
                        aria-label="Close configuration menu"
                        style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, padding: '2px 6px' }}
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
                                <SegmentedControl
                                    ariaLabel="Pacing posture"
                                    options={FATES_OPTIONS.map(({ posture, label, title }) => ({ value: posture, label, title }))}
                                    value={pacingPosture}
                                    onChange={onSetPacingPosture}
                                />
                                {/* One line about the posture in force, rather than a
                                    three-item list restating all of them each time. */}
                                <p className="gor-config-note">{selectedPacing.label.charAt(0) + selectedPacing.label.slice(1).toLowerCase()} Fates — {selectedPacing.description}</p>
                            </div>
                            <span className="gor-label gor-config-label">Lighting</span>
                            <div>
                                <SegmentedControl
                                    ariaLabel="Lighting: marble day or torchlit night"
                                    options={LIGHTING_OPTIONS}
                                    value={isNox ? 'nox' : 'lux'}
                                    onChange={(value) => onSetIsNox(value === 'nox')}
                                    style={{ width: 172 }}
                                />
                                <p className="gor-config-note">A device preference, never part of your save.</p>
                            </div>
                            <span className="gor-label gor-config-label">Narrator's voice</span>
                            <div>
                                <SegmentedControl
                                    radio
                                    ariaLabel="Narrator's voice"
                                    describedBy="settings-narrator-note"
                                    options={NARRATOR_OPTIONS.map(({ value, label, title }) => ({ value, label, title }))}
                                    value={narrationVoiceMode}
                                    onChange={onSetNarrationVoiceMode}
                                />
                                <p className="gor-config-note" id="settings-narrator-note">{selectedNarrator.description}</p>
                            </div>
                            <span className="gor-label gor-config-label">Narrator persona</span>
                            <div>
                                <select
                                    aria-label="Narrator persona"
                                    value={selectedVoice}
                                    onChange={(e) => {
                                        const next = e.target.value as NarratorVoiceId;
                                        setSelectedVoice(next);
                                        setNarratorVoice(next);
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '6px 10px',
                                        background: 'var(--surface-sunken, #111)',
                                        color: 'var(--text-normal)',
                                        border: '1px solid var(--border-subtle, rgba(201,162,39,.3))',
                                        borderRadius: '4px',
                                        fontFamily: 'inherit',
                                        fontSize: '13px',
                                    }}
                                >
                                    {NARRATOR_VOICES.map((v) => (
                                        <option key={v.id} value={v.id}>
                                            {v.label} — {v.role}
                                        </option>
                                    ))}
                                </select>
                                <p className="gor-config-note" style={{ marginTop: '4px' }}>
                                    {NARRATOR_VOICES.find((v) => v.id === selectedVoice)?.role}
                                </p>
                            </div>
                        </div>
                    </section>

                    <section aria-labelledby="settings-curtain" style={registerStyle}>
                        <RegisterHeading headingId="settings-curtain" title="Behind the curtain" />
                        <Switch
                            id="settings-gm-console-enabled"
                            checked={gmConsoleEnabled}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSetGmConsoleEnabled(e.target.checked)}
                            label={<span>GM console available <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(Ctrl+Shift+G)</span></span>}
                        />
                        <Switch
                            id="settings-gm-intervention-enabled"
                            checked={gmInterventionEnabled}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSetGmInterventionEnabled(e.target.checked)}
                            label="GM Intervention available"
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
                        <p className="gor-config-note">A raw copy of the save file — spoilers if you open it, nothing private (D45).</p>
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
