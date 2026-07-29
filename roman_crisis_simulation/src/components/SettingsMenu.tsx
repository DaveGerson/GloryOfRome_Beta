import React, { useState, useEffect, useRef } from 'react';
import { PacingPosture } from '../types';
import { Card, Button } from './ui/Core';
import { Switch, SegmentedControl } from './ui/Forms';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';

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
    { value: 'lux', label: 'LVX', title: 'Marble — day' },
    { value: 'nox', label: 'NOX', title: 'Nox Romae — torchlit' },
] as const;

const cardBodyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const descriptionStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text-muted)' };

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
    /** Dev-only (rendered under import.meta.env.DEV): Mock Mode + the GM console's runtime switch. */
    isMockMode: boolean;
    onSetIsMockMode: (isMock: boolean) => void;
    gmConsoleOpen: boolean;
    onSetGmConsoleOpen: (enabled: boolean) => void;
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
    isMockMode,
    onSetIsMockMode,
    gmConsoleOpen,
    onSetGmConsoleOpen,
}) => {
    const [keyInput, setKeyInput] = useState(apiKey ?? '');
    const [showKey, setShowKey] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);

    useEffect(() => {
        if (!savedFlash) return;
        const t = setTimeout(() => setSavedFlash(false), 2200);
        return () => clearTimeout(t);
    }, [savedFlash]);

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

    const handleSaveKey = () => {
        const trimmed = keyInput.trim();
        if (!trimmed) return;
        onSaveApiKey(trimmed);
        setSavedFlash(true);
    };

    const handleClearKey = () => {
        setKeyInput('');
        setSavedFlash(false);
        onClearApiKey();
    };

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
                <div className="gor-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '70vh', overflowY: 'auto' }}>
                    <Card gilt title="Gemini API Key">
                        <div style={cardBodyStyle}>
                            <p style={descriptionStyle}>
                                Play with your own Gemini API key — it is stored on this device only, never saved into your game, and never bundled into this build.
                            </p>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    className="gor-input"
                                    value={keyInput}
                                    onChange={(e) => setKeyInput(e.target.value)}
                                    placeholder="AIza..."
                                    aria-label="Gemini API key"
                                    autoComplete="off"
                                    style={{ flex: 1, minWidth: 0 }}
                                />
                                <Button type="button" variant="ghost" onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
                                    {showKey ? 'Hide' : 'Show'}
                                </Button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Button type="button" onClick={handleSaveKey}>Save</Button>
                                <Button type="button" variant="secondary" onClick={handleClearKey}>Clear</Button>
                                {savedFlash && <span style={{ color: 'var(--success)', fontStyle: 'italic', fontSize: 14 }}>Saved to this device.</span>}
                            </div>
                        </div>
                    </Card>

                    <Card gilt title="The Fates' Pacing">
                        <div style={cardBodyStyle}>
                            <p style={descriptionStyle}>How patiently fortune paces the story.</p>
                            <SegmentedControl
                                ariaLabel="Pacing posture"
                                options={FATES_OPTIONS.map(({ posture, label, title }) => ({ value: posture, label, title }))}
                                value={pacingPosture}
                                onChange={onSetPacingPosture}
                            />
                            <ul style={{ ...descriptionStyle, paddingLeft: 18 }}>
                                {FATES_OPTIONS.map(({ posture, label, description }) => (
                                    <li key={posture}><strong>{label.charAt(0) + label.slice(1).toLowerCase()}</strong> — {description}</li>
                                ))}
                            </ul>
                        </div>
                    </Card>

                    <Card gilt title="Lighting">
                        <div style={cardBodyStyle}>
                            <p style={descriptionStyle}>Marble day or torchlit night — a device preference, never part of your save.</p>
                            <SegmentedControl
                                ariaLabel="Lighting: marble day or torchlit night"
                                options={LIGHTING_OPTIONS}
                                value={isNox ? 'nox' : 'lux'}
                                onChange={(value) => onSetIsNox(value === 'nox')}
                            />
                        </div>
                    </Card>

                    <Card gilt title="Game Master Console">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <p style={descriptionStyle}>The behind-the-curtain ledger — every thread and die of the simulation, plus free-text GM guidance.</p>
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
                        </div>
                    </Card>

                    {import.meta.env.DEV && (
                        <Card gilt title="Developer">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <p style={descriptionStyle}>Dev-build tools — this card never appears in a production build.</p>
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
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsMenu;
