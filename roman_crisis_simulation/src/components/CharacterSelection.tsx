import React, { useState } from 'react';
import { PlayerCharacterOption } from '../types';
import { Card, Button } from './ui/Core';
import { Radio, Textarea } from './ui/Forms';
import { Medallion, WaxSeal, toRoman } from './ui/Brand';
import { DestinyCard, TypingIndicator } from './ui/Game';

/** Summary info shown on the "Continue your reign" card - deliberately just
 * the handful of fields needed for display, not the full save bundle. */
export interface SavedGameSummary {
    characterName: string;
    turnNumber: number;
    savedAt: string; // ISO timestamp
}

/** Design-system heraldry for the four preset destinies (ui_kits/simulation). */
const DESTINY_HERALDRY: Record<string, { numeral: string; seal: string; motto: string }> = {
    severus_alexander: { numeral: 'I', seal: 'A', motto: 'Pietas et Concordia' },
    maximinus_thrax: { numeral: 'II', seal: 'M', motto: 'Ferro et Fide' },
    gaius_pontius_magnus: { numeral: 'III', seal: 'G', motto: 'Aurum Regit' },
    lycinia_stolo: { numeral: 'IV', seal: 'L', motto: 'Scientia Potentia' },
};

const FATE_LINES = ['The Fates measure the thread…', 'The augurs read a troubled sky…', 'A name is cut into stone…', 'Your destiny is being written…'];

const CharacterSelection: React.FC<{
    onSelectCharacter: (option: PlayerCharacterOption) => void;
    onCreateCharacter: (args: { description: string, metaNarrative?: string, useCustomGamestate: boolean }) => Promise<void>;
    savedGame?: SavedGameSummary | null;
    onContinue?: () => void;
    onStartAnew?: () => void;
}> = ({ onSelectCharacter, onCreateCharacter, savedGame, onContinue, onStartAnew }) => {
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [customDescription, setCustomDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [useCustomGamestate, setUseCustomGamestate] = useState(false);
    const [metaNarrative, setMetaNarrative] = useState('');
    const [confirmAnew, setConfirmAnew] = useState(false);

    const PLAYER_CHARACTER_OPTIONS: PlayerCharacterOption[] = [
        { name: "The Young Emperor", entity_id: "severus_alexander", description: "Rule as the idealistic but embattled emperor.", difficulty: "Hard" },
        { name: "The Ambitious General", entity_id: "maximinus_thrax", description: "Lead the frontier legions in revolt.", difficulty: "Medium" },
        { name: "The Wealthy Senator", entity_id: "gaius_pontius_magnus", description: "Use your vast wealth and political influence to manipulate the Senate from within.", difficulty: "Medium" },
        { name: "The Cunning Spymaster", entity_id: "lycinia_stolo", description: "Operate from the shadows, trading secrets and lies to shape the future of the Empire.", difficulty: "Hard" },
    ];

    const handleCustomSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customDescription.trim()) {
            setError('Describe your character — the Fates cannot work from silence.');
            return;
        }
        if (useCustomGamestate && !metaNarrative.trim()) {
            setError('A new world needs its meta-narrative. Give the Fates a theme.');
            return;
        }
        setError('');
        setIsLoading(true);
        try {
            await onCreateCharacter({
                description: customDescription,
                metaNarrative: useCustomGamestate ? metaNarrative : undefined,
                useCustomGamestate,
            });
        } catch (err) {
            setError('Failed to create character. The auguries are not in our favor. Please try again.');
            console.error(err);
        }
        setIsLoading(false);
    };

    if (isLoading) {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32, textAlign: 'center' }}>
                <Medallion size={110} />
                <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 38, color: 'var(--tyrian-600)' }}>Consulting the Fates…</h2>
                <p style={{ maxWidth: '46ch', margin: 0 }}>
                    {useCustomGamestate
                        ? 'A world is being woven to your design — its people, its factions, its knives.'
                        : 'Your destiny is being written into the annals of 235 CE.'}
                </p>
                <TypingIndicator lines={FATE_LINES} intervalMs={1100} />
            </div>
        );
    }

    if (showCustomForm) {
        return (
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px 56px' }}>
                <div style={{ maxWidth: 660, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ textAlign: 'center' }}>
                        <WaxSeal letter="V" size={54} />
                        <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 36, color: 'var(--tyrian-600)', marginTop: 8 }}>Forge a New Destiny</h2>
                        <p style={{ margin: '8px auto 0', maxWidth: '52ch' }}>Describe who you wish to become. The Game Master will write you into the world — or write a world around you.</p>
                    </div>
                    <form onSubmit={handleCustomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <Card gilt title="The Scenario">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <Radio name="scenario" checked={!useCustomGamestate} onChange={() => setUseCustomGamestate(false)}
                                    label={<span><strong>Rome, 235 CE</strong> — enter the default succession crisis as a new player upon its board.</span>} />
                                <Radio name="scenario" checked={useCustomGamestate} onChange={() => setUseCustomGamestate(true)}
                                    label={<span><strong>A world of your design</strong> — the Fates generate a new world, its characters and conflicts, from your theme.</span>} />
                                {useCustomGamestate && (
                                    <div style={{ animation: 'gorRise .3s ease-out both', marginTop: 4 }}>
                                        <Textarea
                                            label="Meta-Narrative"
                                            id="meta-narrative"
                                            rows={3}
                                            value={metaNarrative}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMetaNarrative(e.target.value)}
                                            hint="The core theme of your story — it will guide the generation of the entire world."
                                            placeholder={'E.g. “A gothic horror in a remote Roman province” — or “a farce about a bumbling senator building an aqueduct.”'}
                                            aria-label="Meta-narrative for custom world"
                                        />
                                    </div>
                                )}
                            </div>
                        </Card>
                        <Card gilt title="Your Persona">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <Textarea
                                    id="character-description"
                                    rows={6}
                                    value={customDescription}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomDescription(e.target.value)}
                                    hint={useCustomGamestate
                                        ? 'The Game Master will create them as the protagonist of this new world.'
                                        : 'Name, position, and motivations — the Game Master will set your starting conditions from this.'}
                                    placeholder={'E.g. “I am Lucius Vorenus, veteran centurion of Legio II Parthica, loyal to the old ways and disgusted by the corruption of Rome. I seek to restore honor to the military.”'}
                                    aria-label="Custom character description"
                                />
                                {error && <span style={{ color: 'var(--crimson-400)', fontSize: 15, fontStyle: 'italic' }}>{error}</span>}
                            </div>
                        </Card>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <Button type="button" variant="ghost" onClick={() => { setShowCustomForm(false); setError(''); }}>‹ Back to the destinies</Button>
                            <Button type="submit" size="lg">{useCustomGamestate ? 'Generate World' : 'Create Character'}</Button>
                        </div>
                    </form>
                </div>
            </div>
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
                                    <Button variant="danger" onClick={() => { setConfirmAnew(false); onStartAnew?.(); }}>Abandon</Button>
                                    <Button variant="ghost" onClick={() => setConfirmAnew(false)}>Keep my reign</Button>
                                </span>
                            ) : (
                                <span style={{ display: 'flex', gap: 10 }}>
                                    <Button size="lg" onClick={onContinue}>Continue Your Reign</Button>
                                    <Button variant="ghost" onClick={() => setConfirmAnew(true)}>Start anew</Button>
                                </span>
                            )}
                        </div>
                    </Card>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(188px, 1fr))', gap: 14 }}>
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
                            />
                        );
                    })}
                    <button type="button" className="gor-destiny" onClick={() => setShowCustomForm(true)} style={{ borderStyle: 'dashed' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '.32em', textTransform: 'uppercase', color: 'var(--gold-700)' }}>Destiny V</span>
                        <span aria-hidden="true" style={{ width: 46, height: 46, margin: '2px auto 2px', display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px dashed var(--gold-600)', color: 'var(--gold-600)', fontSize: 20 }}>✦</span>
                        <span className="gor-destiny-name">Create Your Own</span>
                        <span className="gor-destiny-desc">Forge your own path in the crucible of Rome. Describe who you wish to become.</span>
                        <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', paddingTop: 8 }}><span className="gor-badge gor-badge-neutral">Unwritten</span></span>
                    </button>
                </div>
                <p style={{ textAlign: 'center', margin: 0, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>Every destiny is played against the same living world — only your hand in it changes.</p>
            </div>
        </div>
    );
};

export default CharacterSelection;
