import React, { useEffect, useRef, useState } from 'react';
import { PlayerCharacterOption } from '../types';
import { Card, Button } from './ui/Core';
import { Medallion, WaxSeal, toRoman } from './ui/Brand';
import { DestinyCard } from './ui/Game';
import { ImportFailureNotice } from './ui/FailureNotices';
import type { ImportResult } from '../persistence/saveGame';
import { useReignImport } from './ui/useReignImport';
import { useFocusRequest } from './ui/useFocusRequest';
import { CustomDestinyForm, ForgingScreen, type FormRefusal } from './CustomDestinyForm';
import { DESTINY_HERALDRY, PLAYER_CHARACTER_OPTIONS } from './destinies';

/** Summary info shown on the "Continue your reign" card - deliberately just
 * the handful of fields needed for display, not the full save bundle. */
export interface SavedGameSummary {
    characterName: string;
    turnNumber: number;
    savedAt: string; // ISO timestamp
}

const CharacterSelection: React.FC<{
    onSelectCharacter: (option: PlayerCharacterOption) => void;
    onCreateCharacter: (args: { description: string, metaNarrative?: string, useCustomGamestate: boolean }) => Promise<void>;
    savedGame?: SavedGameSummary | null;
    onContinue?: () => void;
    onStartAnew?: () => void;
    /**
     * "Restore from a copy" (docs/superpowers/specs/2026-08-05-reign-export
     * -import-design.md) — App wires this to persistence/saveGame.ts's
     * importSaveBlob. This component owns the overwrite confirm, the
     * in-fiction failure notice and the reload-on-ok; the callback owns the
     * slot and never asks — by the time it runs the player has consented.
     */
    onImportReign?: (fileText: string) => ImportResult;
    interactionLocked?: boolean;
}> = ({ onSelectCharacter, onCreateCharacter, savedGame, onContinue, onStartAnew, onImportReign, interactionLocked = false }) => {
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [customDescription, setCustomDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<FormRefusal | null>(null);
    const [useCustomGamestate, setUseCustomGamestate] = useState(false);
    const [metaNarrative, setMetaNarrative] = useState('');
    const [confirmAnew, setConfirmAnew] = useState(false);
    // "Restore from a copy" - the same flow as SettingsMenu's (see
    // ui/useReignImport.ts); a reign is at stake only when a savedGame exists.
    const {
        pendingImportText, importFailure, importInputRef, keepReignRef, restoreButtonRef,
        handleImportFileChange, confirmImport, cancelImport, openFilePicker,
    } = useReignImport({ hasSavedReign: Boolean(savedGame), onImportReign });
    // "Start anew" swaps itself for the Abandon confirm and back; focus
    // follows the swap onto the safe answer, then home again.
    const requestFocus = useFocusRequest();
    const startAnewRef = useRef<HTMLButtonElement>(null);
    const keepFromAnewRef = useRef<HTMLButtonElement>(null);
    // "Back to the destinies" unmounts the form, and with it the Back button.
    const createOwnRef = useRef<HTMLButtonElement>(null);
    const isMountedRef = useRef(true);
    const creationInFlightRef = useRef(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const openAnewConfirm = () => {
        requestFocus(keepFromAnewRef);
        setConfirmAnew(true);
    };
    const closeAnewConfirm = () => {
        requestFocus(startAnewRef);
        setConfirmAnew(false);
    };

    const handleCustomSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (creationInFlightRef.current) return;
        if (!customDescription.trim()) {
            setError({
                title: 'The Fates cannot work from silence',
                message: 'Describe who you wish to become. A line is enough to begin with.',
            });
            return;
        }
        if (useCustomGamestate && !metaNarrative.trim()) {
            setError({
                title: 'A world needs its theme',
                message: 'Give the Fates a meta-narrative, and they will weave the rest around it.',
            });
            return;
        }
        setError(null);
        creationInFlightRef.current = true;
        setIsLoading(true);
        try {
            await onCreateCharacter({
                description: customDescription,
                metaNarrative: useCustomGamestate ? metaNarrative : undefined,
                useCustomGamestate,
            });
        } catch (err) {
            if (!isMountedRef.current) return;
            setError({
                title: 'The auguries are unfavourable',
                message: 'Failed to create character. The auguries are not in our favor. Your words are kept exactly as you wrote them — send them again.',
            });
            console.error(err);
        } finally {
            creationInFlightRef.current = false;
            if (isMountedRef.current) setIsLoading(false);
        }
    };

    if (isLoading) {
        return <ForgingScreen useCustomGamestate={useCustomGamestate} />;
    }

    if (showCustomForm) {
        return (
            <CustomDestinyForm
                description={customDescription}
                onDescriptionChange={setCustomDescription}
                metaNarrative={metaNarrative}
                onMetaNarrativeChange={setMetaNarrative}
                useCustomGamestate={useCustomGamestate}
                onUseCustomGamestateChange={setUseCustomGamestate}
                error={error}
                interactionLocked={interactionLocked}
                onSubmit={handleCustomSubmit}
                onBack={() => { requestFocus(createOwnRef); setShowCustomForm(false); setError(null); }}
            />
        );
    }

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '38px 32px 56px' }}>
            <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div style={{ textAlign: 'center' }}>
                    <Medallion size={96} />
                    <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 44, color: 'var(--tyrian-600)', marginTop: 8 }}>Choose Your Destiny</h2>
                    <p style={{ margin: '8px auto 0', maxWidth: '52ch' }}>The year is 235 CE. The Empire teeters on the brink of chaos. Who will you be?</p>
                    <div className="gor-mosaic" style={{ width: 260, margin: '18px auto 0' }}></div>
                </div>

                {/* "Restore from a copy" (spec: 2026-08-05-reign-export-import-design.md)
                    — one hidden input shared by whichever visible button below is
                    on screen; a JSON-only scroll, never anything else. */}
                <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json"
                    onChange={handleImportFileChange}
                    style={{ display: 'none' }}
                    aria-hidden="true"
                    tabIndex={-1}
                />

                {savedGame && (
                    <Card gilt title="Continue Your Reign" action={<span className="gor-label" style={{ color: 'var(--gold-700)' }}>Turn {toRoman(savedGame.turnNumber)}</span>}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                            <WaxSeal letter={(savedGame.characterName || 'R').charAt(0).toUpperCase()} size={44} />
                            <span style={{ flex: '1 1 320px' }}>
                                Playing as <strong>{savedGame.characterName}</strong> — Turn {savedGame.turnNumber}.<br />
                                <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                    Saved {new Date(savedGame.savedAt).toLocaleString()}
                                </span>
                            </span>
                            {confirmAnew ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--crimson-500)', fontStyle: 'italic', fontSize: 15 }}>Abandon your saved reign? It cannot be undone.</span>
                                    <Button variant="danger" disabled={interactionLocked} onClick={() => { setConfirmAnew(false); onStartAnew?.(); }}>Abandon</Button>
                                    <Button ref={keepFromAnewRef} variant="ghost" onClick={closeAnewConfirm}>Keep my reign</Button>
                                </span>
                            ) : pendingImportText !== null ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--crimson-500)', fontStyle: 'italic', fontSize: 15 }}>Replace your saved reign with this copy? It cannot be undone.</span>
                                    <Button variant="danger" disabled={interactionLocked} onClick={confirmImport}>Replace</Button>
                                    <Button ref={keepReignRef} variant="ghost" onClick={cancelImport}>Keep my reign</Button>
                                </span>
                            ) : (
                                <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    <Button size="lg" disabled={interactionLocked} onClick={onContinue}>Continue Your Reign</Button>
                                    <Button ref={startAnewRef} variant="ghost" onClick={openAnewConfirm}>Start anew</Button>
                                    <Button ref={restoreButtonRef} variant="ghost" onClick={openFilePicker}>Restore from a copy</Button>
                                </span>
                            )}
                        </div>
                        {importFailure && <ImportFailureNotice reason={importFailure} />}
                    </Card>
                )}

                {/* Item 20: a FIXED four-column row. `repeat(auto-fit,minmax(188px,1fr))`
                    landed 4-up at common widths and widowed the fifth card on its
                    own line anyway — so the fifth gets its own line by design. */}
                <div className="gor-destiny-grid">
                    {PLAYER_CHARACTER_OPTIONS.map(opt => {
                        const heraldry: Partial<{ numeral: string; seal: string; motto: string }> = DESTINY_HERALDRY[opt.entity_id] || {};
                        return (
                            <DestinyCard
                                key={opt.entity_id}
                                name={opt.name}
                                description={opt.description}
                                difficulty={opt.difficulty}
                                numeral={heraldry.numeral}
                                seal={heraldry.seal}
                                motto={heraldry.motto}
                                onSelect={() => onSelectCharacter(opt)}
                                disabled={interactionLocked}
                            />
                        );
                    })}
                    <button ref={createOwnRef} type="button" className="gor-destiny" onClick={() => setShowCustomForm(true)} disabled={interactionLocked} style={{ borderStyle: 'dashed' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '.32em', textTransform: 'uppercase', color: 'var(--gold-700)' }}>Destiny V</span>
                        <span aria-hidden="true" style={{ width: 46, height: 46, margin: '2px auto 2px', display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px dashed var(--gold-600)', color: 'var(--gold-600)', fontSize: 20 }}>✦</span>
                        <span className="gor-destiny-name">Create Your Own</span>
                        <span className="gor-destiny-desc">Forge your own path in the crucible of Rome. Describe who you wish to become.</span>
                        <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', paddingTop: 8 }}><span className="gor-badge gor-badge-neutral">Unwritten</span></span>
                    </button>
                </div>
                <p style={{ textAlign: 'center', margin: 0, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>Every destiny is played against the same living world — only your hand in it changes.</p>

                {/* No savedGame: a fresh device is exactly where a restore matters, so
                    the affordance stands alone here — quiet, no confirm, nothing at stake. */}
                {!savedGame && (
                    <div style={{ textAlign: 'center' }}>
                        <Button variant="ghost" onClick={openFilePicker}>Restore from a copy</Button>
                        {importFailure && (
                            <div style={{ maxWidth: 520, margin: '12px auto 0', textAlign: 'left' }}>
                                <ImportFailureNotice reason={importFailure} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CharacterSelection;
