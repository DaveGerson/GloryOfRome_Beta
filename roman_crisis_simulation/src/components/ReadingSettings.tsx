import React from 'react';
import { RegisterHeading } from './ui/Core';
import { SegmentedControl, Switch } from './ui/Forms';
import { paletteChordProse } from '../app/commands';
import type {
    MotionPreference, NarrationReveal, ReadingScale, ShortcutPreference,
} from '../persistence/readingPrefs';

/**
 * Player-visible copy for the Reading register (veto queue: roadmaps/
 * BACKLOG.md, "Reading, motion and the command palette"). One note per
 * control, describing the choice in force - the same grammar as the Fates'
 * pacing note above it (D43: every option carries a visible description).
 */
export const READING_SETTINGS_COPY = {
    heading: 'Reading',
    textSize: 'Text size',
    textSizeOptions: { standard: 'Standard', large: 'Large', larger: 'Larger' } satisfies Record<ReadingScale, string>,
    textSizeNote: {
        standard: 'The chronicle, the side panel, fates and private scenes at their written size; the masthead, tabs and menus keep theirs.',
        large: 'The chronicle, the side panel, fates and private scenes a size larger; the masthead, tabs and menus keep theirs.',
        larger: 'The chronicle, the side panel, fates and private scenes two sizes larger; the masthead, tabs and menus keep theirs.',
    } satisfies Record<ReadingScale, string>,
    reduceMotion: 'Reduce motion',
    reduceMotionNote: {
        off: 'Animation plays unless your device asks for less motion.',
        on: 'Nothing moves that need not: no rising leaves, no smoulder, no gliding scroll.',
    },
    wordByWord: 'Show the narration word by word',
    wordByWordNote: {
        on: 'The week appears as the chronicler writes it.',
        off: 'The week appears whole once it is written; the loom shows the work meanwhile.',
    },
    singleKeys: 'Single-key shortcuts',
    singleKeysNote: {
        on: (chord: string) => `Outside a text field, 1–7 open the side panel's tabs, / goes to your action and ? opens the commands. ${chord} always opens them.`,
        off: (chord: string) => `Single keys do nothing. ${chord} still opens the commands.`,
    },
} as const;

const options = <T extends string>(labels: Record<T, string>) =>
    (Object.keys(labels) as T[]).map(value => ({ value, label: labels[value] }));

export interface ReadingSettingsProps {
    readingScale: ReadingScale;
    onSetReadingScale: (scale: ReadingScale) => void;
    motion: MotionPreference;
    onSetMotion: (motion: MotionPreference) => void;
    narrationReveal: NarrationReveal;
    onSetNarrationReveal: (reveal: NarrationReveal) => void;
    shortcuts: ShortcutPreference;
    onSetShortcuts: (shortcuts: ShortcutPreference) => void;
}

/** A switch with its note under the label, the note tied to it as its description. */
const NotedSwitch: React.FC<{
    id: string;
    label: string;
    checked: boolean;
    note: string;
    onChange: (checked: boolean) => void;
}> = ({ id, label, checked, note, onChange }) => (
    <div className="gor-config-switch">
        <Switch
            id={id}
            checked={checked}
            aria-describedby={`${id}-note`}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
            label={label}
        />
        <p id={`${id}-note`} className="gor-config-note">{note}</p>
    </div>
);

/**
 * The configuration menu's Reading register (persistence/readingPrefs.ts).
 *
 * Text size has three settings, so it is a radio group. The other three are
 * on/off preferences that take effect at once, so each is a switch, named
 * for what it does when on ("Reduce motion", the platforms' own words). A
 * switch's visible label is its accessible name (WCAG 2.5.3), and no two
 * controls in the menu share a label: an earlier cut made the narration's
 * two states "As written" / "Whole", and "As written" already meant
 * something else under Voice style.
 *
 * Every value is a device preference, never part of the save. The stored
 * values keep their names ('reduced', 'whole', 'off'), so a choice made
 * before the switches survives them.
 */
export const ReadingSettings: React.FC<ReadingSettingsProps> = ({
    readingScale, onSetReadingScale, motion, onSetMotion,
    narrationReveal, onSetNarrationReveal, shortcuts, onSetShortcuts,
}) => {
    const c = READING_SETTINGS_COPY;
    const chord = paletteChordProse();
    return (
        <section aria-labelledby="settings-reading" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <RegisterHeading headingId="settings-reading" title={c.heading} />
            <div className="gor-config-grid">
                <span className="gor-label gor-config-label">{c.textSize}</span>
                <div>
                    <SegmentedControl radio ariaLabel={c.textSize} describedBy="settings-reading-size-note"
                        options={options(c.textSizeOptions)} value={readingScale} onChange={onSetReadingScale} />
                    <p id="settings-reading-size-note" className="gor-config-note">{c.textSizeNote[readingScale]}</p>
                </div>
            </div>
            <NotedSwitch
                id="settings-reduce-motion"
                label={c.reduceMotion}
                checked={motion === 'reduced'}
                note={motion === 'reduced' ? c.reduceMotionNote.on : c.reduceMotionNote.off}
                onChange={on => onSetMotion(on ? 'reduced' : 'device')}
            />
            <NotedSwitch
                id="settings-word-by-word"
                label={c.wordByWord}
                checked={narrationReveal === 'stream'}
                note={narrationReveal === 'stream' ? c.wordByWordNote.on : c.wordByWordNote.off}
                onChange={on => onSetNarrationReveal(on ? 'stream' : 'whole')}
            />
            <NotedSwitch
                id="settings-single-keys"
                label={c.singleKeys}
                checked={shortcuts === 'on'}
                note={shortcuts === 'on' ? c.singleKeysNote.on(chord) : c.singleKeysNote.off(chord)}
                onChange={on => onSetShortcuts(on ? 'on' : 'off')}
            />
        </section>
    );
};
