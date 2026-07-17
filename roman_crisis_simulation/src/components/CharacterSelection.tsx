
import React, { useState } from 'react';
import { PlayerCharacterOption } from '../types';

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
}> = ({ onSelectCharacter, onCreateCharacter, savedGame, onContinue, onStartAnew }) => {
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [customDescription, setCustomDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [useCustomGamestate, setUseCustomGamestate] = useState(false);
    const [metaNarrative, setMetaNarrative] = useState('');

    const PLAYER_CHARACTER_OPTIONS: PlayerCharacterOption[] = [
        { name: "The Young Emperor", entity_id: "severus_alexander", description: "Rule as the idealistic but embattled emperor.", difficulty: "Hard" },
        { name: "The Ambitious General", entity_id: "maximinus_thrax", description: "Lead the frontier legions in revolt.", difficulty: "Medium" },
        { name: "The Wealthy Senator", entity_id: "gaius_pontius_magnus", description: "Use your vast wealth and political influence to manipulate the Senate from within.", difficulty: "Medium" },
        { name: "The Cunning Spymaster", entity_id: "lycinia_stolo", description: "Operate from the shadows, trading secrets and lies to shape the future of the Empire.", difficulty: "Hard" },
    ];

    const handleStartAnewClick = () => {
        if (window.confirm('Abandon your saved reign and start anew? This cannot be undone.')) {
            onStartAnew?.();
        }
    };

    const handleCustomSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customDescription.trim()) {
            setError('Please provide a description for your character.');
            return;
        }
        if (useCustomGamestate && !metaNarrative.trim()) {
            setError('Please provide a meta-narrative for the custom world.');
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
            <div className="flex-grow flex flex-col justify-center items-center p-8 text-center">
                <h2 className="text-3xl font-decorative text-red-900 roman-inset-text">Consulting the Fates...</h2>
                <p className="text-stone-600 mt-2">Your destiny is being written.</p>
            </div>
        )
    }

    return (
        <div className="flex-grow p-8 overflow-y-auto animate-fade-in">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-4xl font-decorative text-red-900 text-center roman-inset-text">Choose Your Destiny</h2>
                <p className="text-center text-stone-700 mt-2">The year is 235 CE. The Empire teeters on the brink of chaos. Who will you be?</p>
                
                {!showCustomForm && savedGame && (
                    <div className="mt-8 roman-stone-panel p-6 rounded-sm border-2 border-amber-600 bg-amber-50/40 flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
                        <div className="text-center md:text-left">
                            <h3 className="text-2xl font-bold text-red-900 roman-inset-text">Continue Your Reign</h3>
                            <p className="text-stone-700 mt-1">
                                Playing as <strong>{savedGame.characterName}</strong> &mdash; Turn {savedGame.turnNumber}
                            </p>
                            <p className="text-stone-500 text-sm mt-1">
                                Saved {new Date(savedGame.savedAt).toLocaleString()}
                            </p>
                        </div>
                        <div className="flex flex-col items-center gap-2 shrink-0">
                            <button
                                onClick={onContinue}
                                className="bg-red-800 text-stone-100 rounded-sm px-6 py-3 hover:bg-red-700 transition-colors border border-red-900 btn-animate text-lg font-bold whitespace-nowrap"
                            >
                                Continue Your Reign
                            </button>
                            <button
                                onClick={handleStartAnewClick}
                                className="text-stone-500 hover:text-red-800 text-sm underline"
                            >
                                Start anew
                            </button>
                        </div>
                    </div>
                )}

                {!showCustomForm ? (
                    <div className="grid md:grid-cols-2 gap-6 mt-8">
                        {PLAYER_CHARACTER_OPTIONS.map(opt => (
                            <div key={opt.entity_id} className="roman-stone-panel p-6 rounded-sm flex flex-col border-2 border-transparent hover:border-red-800 transition-colors duration-300">
                                <h3 className="text-xl font-bold text-red-900 roman-inset-text">{opt.name}</h3>
                                <p className="text-stone-600 mt-1">Difficulty: {opt.difficulty}</p>
                                <p className="text-stone-700 mt-3 flex-grow">{opt.description}</p>
                                <button onClick={() => onSelectCharacter(opt)} className="mt-4 w-full bg-red-800 text-stone-100 rounded-sm px-4 py-2 hover:bg-red-700 transition-colors border border-red-900 btn-animate">
                                    Select
                                </button>
                            </div>
                        ))}
                         <div className="roman-stone-panel p-6 rounded-sm flex flex-col text-center items-center justify-center border-2 border-transparent hover:border-stone-500 transition-colors duration-300">
                            <h3 className="text-xl font-bold text-red-900 roman-inset-text">Create Your Own</h3>
                            <p className="text-stone-700 mt-3 flex-grow">Forge your own path in the crucible of Rome. Describe the character you wish to become.</p>
                            <button onClick={() => setShowCustomForm(true)} className="mt-4 w-full bg-stone-600 text-stone-100 rounded-sm px-4 py-2 hover:bg-stone-500 transition-colors border border-stone-700 btn-animate">
                                Self-Describe
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-8 max-w-2xl mx-auto roman-stone-panel p-6 rounded-sm">
                        <h3 className="text-2xl font-bold text-red-900 text-center roman-inset-text">Forge a New Destiny</h3>
                        <form onSubmit={handleCustomSubmit} className="mt-4 space-y-4">
                             <div className="bg-stone-200/50 p-3 rounded-sm border border-stone-300">
                                <label className="flex items-center justify-center cursor-pointer">
                                    <span className="text-sm font-medium text-stone-700 mr-3">Use default 235 CE scenario</span>
                                    <input
                                        type="checkbox"
                                        checked={useCustomGamestate}
                                        onChange={e => setUseCustomGamestate(e.target.checked)}
                                        className="h-5 w-5 text-red-800 bg-stone-100 border-stone-400 rounded focus:ring-red-700 cursor-pointer"
                                    />
                                     <span className="text-sm font-medium text-stone-700 ml-3">Initialize custom gamestate</span>
                                </label>
                            </div>

                            {useCustomGamestate && (
                                <div className="animate-fade-in">
                                    <label htmlFor="meta-narrative" className="block text-sm font-bold text-stone-700 mb-1">Meta-Narrative</label>
                                    <p className="text-sm text-stone-600 mb-2">Describe the core theme of your story. This will guide the AI in generating the entire world, its characters, and its conflicts.</p>
                                    <textarea
                                        id="meta-narrative"
                                        value={metaNarrative}
                                        onChange={(e) => setMetaNarrative(e.target.value)}
                                        placeholder="E.g., 'A gothic horror story in a remote Roman province' or 'A comedic farce about a bumbling senator trying to build an aqueduct.'"
                                        className="w-full h-24 p-3 border border-[#c9c5b8] rounded-sm bg-white/30 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-800 shadow-inner"
                                        aria-label="Meta-narrative for custom world"
                                    />
                                </div>
                            )}

                            <div>
                                <label htmlFor="character-description" className="block text-sm font-bold text-stone-700 mb-1">Your Persona</label>
                                 <p className="text-sm text-stone-600 mb-2">Provide a brief description of your character. Include their name, position, and core motivations. {useCustomGamestate ? "The Game Master will create them as the protagonist of this new world." : "The Game Master will use this to generate your starting conditions within the default 235 CE scenario."}</p>
                                <textarea
                                    id="character-description"
                                    value={customDescription}
                                    onChange={(e) => setCustomDescription(e.target.value)}
                                    placeholder="E.g., 'I am Lucius Vorenus, a veteran centurion of the Legio II Parthica, loyal to the old ways and disgusted by the corruption in Rome. I seek to restore honor to the military.'"
                                    className="w-full h-40 p-3 border border-[#c9c5b8] rounded-sm bg-white/30 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-800 shadow-inner"
                                    aria-label="Custom character description"
                                />
                            </div>
                            
                            {error && <p className="text-red-600 text-sm">{error}</p>}
                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => setShowCustomForm(false)} className="text-stone-600 hover:text-red-900">
                                    &larr; Back to suggestions
                                </button>
                                <button type="submit" className="bg-red-800 text-stone-100 rounded-sm px-6 py-2 hover:bg-red-700 transition-colors border border-red-900 btn-animate">
                                    {useCustomGamestate ? 'Generate World' : 'Create Character'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CharacterSelection;