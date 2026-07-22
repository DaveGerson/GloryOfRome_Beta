import React, { useState, useEffect } from 'react';
import { PacingPosture } from '../types';
import { Card, Button } from './ui/Core';
import { Switch } from './ui/Forms';

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 5 (DESIGN_DECISIONS.md D31) - the FATES
 * pacing options, identical labels/titles to App.tsx's existing bottom-right
 * selector (both read/write the SAME persistence/settings.ts posture, via
 * the SAME `onSetPacingPosture` callback App.tsx passes down - this is a
 * second surface for the one setting, not a competing source of truth).
 */
const FATES_OPTIONS: { posture: PacingPosture; label: string; title: string }[] = [
    { posture: 'restrained', label: 'PATIENT', title: 'Patient Fates — long quiet weeks may stand' },
    { posture: 'balanced', label: 'MEASURED', title: 'Measured Fates — fortune turns when the story calls for it' },
    { posture: 'dramatic', label: 'EAGER', title: 'Eager Fates — the threads pull taut sooner' },
];

/**
 * The configuration menu (D31) - a marble gor-dialog (player-facing, unlike
 * GameMasterScreen's dark tablinum), opened from a Header affordance.
 * Exactly four settings, no more (per the ruling's own "Initial contents"
 * list): the player's own Gemini API key (D34), the D23 pacing posture,
 * and the D32/D33 GM-intervention/GM-console availability toggles.
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
    gmConsoleEnabled: boolean;
    onSetGmConsoleEnabled: (enabled: boolean) => void;
    gmInterventionEnabled: boolean;
    onSetGmInterventionEnabled: (enabled: boolean) => void;
}> = ({
    onClose,
    apiKey,
    onSaveApiKey,
    onClearApiKey,
    pacingPosture,
    onSetPacingPosture,
    gmConsoleEnabled,
    onSetGmConsoleEnabled,
    gmInterventionEnabled,
    onSetGmInterventionEnabled,
}) => {
    const [keyInput, setKeyInput] = useState(apiKey ?? '');
    const [showKey, setShowKey] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);

    useEffect(() => {
        if (!savedFlash) return;
        const t = setTimeout(() => setSavedFlash(false), 2200);
        return () => clearTimeout(t);
    }, [savedFlash]);

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
            <div className="gor-dialog" role="dialog" aria-modal="true" aria-label="Configuration" style={{ maxWidth: 560 }}>
                <div className="gor-dialog-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>Configuration</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close configuration menu"
                        style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, padding: '2px 6px' }}
                    >×</button>
                </div>
                <div className="gor-dialog-rule"></div>
                <div className="gor-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <Card gilt title="Gemini API Key">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>How patiently fortune paces the story.</p>
                            <div role="group" aria-label="Pacing posture" style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', width: 'fit-content' }}>
                                {FATES_OPTIONS.map(({ posture, label, title }, index) => (
                                    <button
                                        key={posture}
                                        type="button"
                                        aria-pressed={pacingPosture === posture}
                                        title={title}
                                        onClick={() => onSetPacingPosture(posture)}
                                        style={{
                                            padding: '8px 14px',
                                            border: 'none',
                                            borderLeft: index === 0 ? 'none' : '1px solid var(--border-subtle)',
                                            cursor: 'pointer',
                                            fontFamily: 'var(--font-display)',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            letterSpacing: '.1em',
                                            background: pacingPosture === posture ? 'var(--gold-600)' : 'var(--surface-card)',
                                            color: pacingPosture === posture ? '#241C11' : 'var(--text-muted)',
                                        }}
                                    >{label}</button>
                                ))}
                            </div>
                        </div>
                    </Card>

                    <Card gilt title="Game Master Console">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                </div>
            </div>
        </div>
    );
};

export default SettingsMenu;
