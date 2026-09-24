import React, { useEffect, useState } from 'react';
import { Card, Button, Badge } from './ui/Core';

const cardBodyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const descriptionStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text-muted)' };

/**
 * How a stored key is shown back to the player: enough to recognise which key
 * is on this device, never enough to read it. The value itself is only ever
 * in the (password-typed) input beside it (D34).
 */
function maskApiKey(key: string): string {
    const trimmed = key.trim();
    if (!trimmed) return '';
    return `${'•'.repeat(16)}${trimmed.slice(-4)}`;
}

/**
 * The player's own Gemini API key (D34) - the configuration menu's one gilt
 * card, split out of SettingsMenu.tsx with the draft, show/hide and "Saved"
 * flash it owns. `apiKey` seeds the input on open only; the value is never
 * logged and never rendered anywhere else in the app.
 */
export const ApiKeyCard: React.FC<{
    apiKey: string | null;
    onSaveApiKey: (key: string) => void;
    onClearApiKey: () => void;
}> = ({ apiKey, onSaveApiKey, onClearApiKey }) => {
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
        <Card gilt title="Gemini API Key" action={<Badge tone="laurel">On this device</Badge>}>
            <div style={cardBodyStyle}>
                <p style={descriptionStyle}>
                    Play with your own Gemini API key — it is stored on this device only, never saved into your game, and never bundled into this build.
                </p>
                {apiKey && !showKey && (
                    <span className="gor-key-mask">{maskApiKey(apiKey)}</span>
                )}
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
                    {/* Always mounted: a live region must exist before its
                        text changes or the confirmation is never announced. */}
                    <span role="status">
                        {savedFlash && <span style={{ color: 'var(--success)', fontStyle: 'italic', fontSize: 14 }}>Saved to this device.</span>}
                    </span>
                </div>
            </div>
        </Card>
    );
};
