import React from 'react';
import { Button, RegisterHeading, DraftGauge } from './ui/Core';
import { Textarea } from './ui/Forms';
import { Medallion, WaxSeal } from './ui/Brand';
import { TypingIndicator } from './ui/Game';
import { Alert } from './ui/Alert';
import { radioGroupKeyDown, radioTabIndex } from './ui/rovingRadio';
import { DESTINY_HERALDRY, PLAYER_CHARACTER_OPTIONS } from './destinies';

/**
 * "Forge a New Destiny" - the fifth destiny's form, and the screen shown
 * while the Fates write it. Split out of CharacterSelection.tsx, which keeps
 * the drafts, the in-flight guard and the submission itself: the drafts must
 * survive "Back to the destinies", and the submission must outlive this form
 * (it unmounts for ForgingScreen while the request is in flight).
 */

/** Advisory lengths — the Fates read longer, but nobody writes better past these. */
const PERSONA_SOFT_LIMIT = 1200;
const META_NARRATIVE_SOFT_LIMIT = 400;

/**
 * A six-row empty textarea is the real reason players bounce off this
 * screen. Each chip appends the line it names and gets out of the way.
 */
const PERSONA_PROMPTS: readonly { label: string; scaffold: string }[] = [
    { label: 'Name and standing', scaffold: 'I am ' },
    { label: 'What you want', scaffold: 'What I want above all is ' },
    { label: 'What you hold', scaffold: 'What I hold is ' },
    { label: 'Whom you owe', scaffold: 'I owe ' },
];

/** What the Fates settle from what you write — the honest version of the old hint. */
const DECIDED_FROM_THIS: readonly { head: string; body: string }[] = [
    { head: 'Standing', body: 'Your position, and who already knows your name.' },
    { head: 'Purse', body: 'What you have to spend in your first week.' },
    { head: 'First week', body: 'Where you begin, and what is already in motion around you.' },
];

const FATE_LINES = ['The Fates measure the thread…', 'The augurs read a troubled sky…', 'A name is cut into stone…', 'Your destiny is being written…'];

/** In-fiction titles. A form that will not proceed still speaks in the world's voice. */
export interface FormRefusal { title: string; message: string }

/** Appends a persona prompt's scaffold as a new line (or starts the draft with it). */
function appendPersonaScaffold(current: string, scaffold: string): string {
    return current.trim() ? `${current.trimEnd()}\n${scaffold}` : scaffold;
}

export const ForgingScreen: React.FC<{ useCustomGamestate: boolean }> = ({ useCustomGamestate }) => (
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

export const CustomDestinyForm: React.FC<{
    description: string;
    onDescriptionChange: (next: string | ((current: string) => string)) => void;
    metaNarrative: string;
    onMetaNarrativeChange: (next: string) => void;
    useCustomGamestate: boolean;
    onUseCustomGamestateChange: (next: boolean) => void;
    error: FormRefusal | null;
    interactionLocked: boolean;
    onSubmit: (event: React.FormEvent) => void;
    onBack: () => void;
}> = ({
    description, onDescriptionChange, metaNarrative, onMetaNarrativeChange, useCustomGamestate, onUseCustomGamestateChange,
    error, interactionLocked, onSubmit, onBack,
}) => (
    // The foot bar is sticky, so the scrollport needs room BELOW the form
    // for the bar to unstick into — otherwise the last screenful of
    // content can never be scrolled clear of it and the bar simply sits on
    // top of the persona field you are typing into. `scrollPaddingBottom`
    // covers the other half: a field focused by keyboard scrolls to above
    // the bar rather than under it.
    <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px 132px', scrollPaddingBottom: 96 }}>
        <div style={{ maxWidth: 660, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ textAlign: 'center' }}>
                <WaxSeal letter="V" size={54} />
                <h2 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 36, color: 'var(--tyrian-600)', marginTop: 8 }}>Forge a New Destiny</h2>
                <p style={{ margin: '8px auto 0', maxWidth: '52ch' }}>Describe who you wish to become. The Game Master will write you into the world — or write a world around you.</p>
            </div>
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <section>
                    <RegisterHeading numeral="I" title="The world you enter" />
                    {/* A choice is dealt as tesserae, not as two radio dots. */}
                    <div
                        className="gor-tessera-pair"
                        role="radiogroup"
                        aria-label="Scenario"
                        onKeyDown={radioGroupKeyDown([false, true], useCustomGamestate, onUseCustomGamestateChange)}
                    >
                        <button
                            type="button" role="radio" aria-checked={!useCustomGamestate}
                            tabIndex={radioTabIndex(!useCustomGamestate, true, true)}
                            className={`gor-tessera${!useCustomGamestate ? ' gor-tessera-chosen' : ''}`}
                            onClick={() => onUseCustomGamestateChange(false)}
                        >
                            <span className="gor-tessera-name">Rome, 235 CE</span>
                            <span className="gor-tessera-seals" aria-hidden="true">
                                {PLAYER_CHARACTER_OPTIONS.map(option => (
                                    <WaxSeal key={option.entity_id} letter={DESTINY_HERALDRY[option.entity_id]?.seal ?? '·'} size={19} tone="crimson" />
                                ))}
                            </span>
                            <span className="gor-tessera-desc">Four destinies are playing it; you enter as a fifth.</span>
                        </button>
                        <button
                            type="button" role="radio" aria-checked={useCustomGamestate}
                            tabIndex={radioTabIndex(useCustomGamestate, false, true)}
                            className={`gor-tessera gor-tessera-woven${useCustomGamestate ? ' gor-tessera-chosen' : ''}`}
                            onClick={() => onUseCustomGamestateChange(true)}
                        >
                            <span className="gor-tessera-name">A world of your design</span>
                            <span className="gor-tessera-desc">The Fates generate a new world, its characters and its conflicts, from your theme.</span>
                        </button>
                    </div>
                    {useCustomGamestate && (
                        <div className="gor-tablet-unroll">
                            <Textarea
                                label="Meta-Narrative"
                                id="meta-narrative"
                                rows={3}
                                value={metaNarrative}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onMetaNarrativeChange(e.target.value)}
                                hint="The core theme of your story — it will guide the generation of the entire world."
                                placeholder={'E.g. “A gothic horror in a remote Roman province” — or “a farce about a bumbling senator building an aqueduct.”'}
                                aria-label="Meta-narrative for custom world"
                            />
                            <DraftGauge length={metaNarrative.length} limit={META_NARRATIVE_SOFT_LIMIT} />
                        </div>
                    )}
                </section>
                <section>
                    <RegisterHeading numeral="II" title="Who you will be in it" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Textarea
                            id="character-description"
                            rows={6}
                            value={description}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDescriptionChange(e.target.value)}
                            hint={useCustomGamestate
                                ? 'The Game Master will create them as the protagonist of this new world.'
                                : 'Name, position, and motivations — the Game Master will set your starting conditions from this.'}
                            placeholder={'E.g. “I am Lucius Vorenus, veteran centurion of Legio II Parthica, loyal to the old ways and disgusted by the corruption of Rome. I seek to restore honor to the military.”'}
                            aria-label="Custom character description"
                        />
                        <DraftGauge length={description.length} limit={PERSONA_SOFT_LIMIT} />
                        <div className="gor-prompt-chips">
                            {PERSONA_PROMPTS.map(prompt => (
                                <button
                                    key={prompt.label} type="button" className="gor-prompt-chip"
                                    onClick={() => onDescriptionChange(current => appendPersonaScaffold(current, prompt.scaffold))}
                                >
                                    {prompt.label}
                                </button>
                            ))}
                        </div>
                        {error && <Alert title={error.title}>{error.message}</Alert>}
                    </div>
                </section>
                <div className="gor-decided">
                    <span className="gor-decided-head">What is decided from this</span>
                    <div className="gor-decided-cols">
                        {DECIDED_FROM_THIS.map(column => (
                            <span key={column.head} className="gor-decided-col">
                                <span className="gor-decided-col-head">{column.head}</span>
                                <span className="gor-decided-col-body">{column.body}</span>
                            </span>
                        ))}
                    </div>
                </div>
                {/* With the custom branch open the submit used to sit below the fold. */}
                <div className="gor-foot-bar">
                    <Button type="button" variant="ghost" onClick={onBack}>‹ Back to the destinies</Button>
                    <Button type="submit" size="lg" disabled={interactionLocked}>{useCustomGamestate ? 'Weave the world' : 'Take your place'}</Button>
                </div>
            </form>
        </div>
    </div>
);
