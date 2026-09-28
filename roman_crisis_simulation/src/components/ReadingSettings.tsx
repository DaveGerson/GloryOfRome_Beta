import React from 'react';
import { RegisterHeading } from './ui/Core';
import { SegmentedControl } from './ui/Forms';
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
        standard: 'The chronicle and the registers at their written size.',
        large: 'The chronicle, the registers and your dossier drawn a size larger.',
        larger: 'The chronicle, the registers and your dossier drawn two sizes larger.',
    } satisfies Record<ReadingScale, string>,
    motion: 'Motion',
    motionOptions: { device: 'As the device', reduced: 'Still' } satisfies Record<MotionPreference, string>,
    motionNote: {
        device: 'Follows your device: leaves rise, the crisis smoulders, unless it asks for less motion.',
        reduced: 'Nothing moves that need not: no rising leaves, no smoulder, no gliding scroll.',
    } satisfies Record<MotionPreference, string>,
    narration: 'Narration',
    narrationOptions: { stream: 'As written', whole: 'Whole' } satisfies Record<NarrationReveal, string>,
    narrationNote: {
        stream: 'Watch the chronicler write the week, word by word.',
        whole: 'The week appears once it is written; the loom shows the work meanwhile.',
    } satisfies Record<NarrationReveal, string>,
    shortcuts: 'Keys',
    shortcutOptions: { on: 'On', off: 'Off' } satisfies Record<ShortcutPreference, string>,
    shortcutNote: {
        on: 'Outside a text field, 1–7 open a register, / takes you to the tablet and ? lists every command. Ctrl+K always opens the commands.',
        off: 'Single keys do nothing. Ctrl+K still opens the commands.',
    } satisfies Record<ShortcutPreference, string>,
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

/**
 * The configuration menu's Reading register (persistence/readingPrefs.ts):
 * text size, motion, how the narration arrives, and the single-key
 * shortcuts WCAG 2.1.4 requires a player be able to turn off. Every value is
 * a device preference, never part of the save.
 */
export const ReadingSettings: React.FC<ReadingSettingsProps> = ({
    readingScale, onSetReadingScale, motion, onSetMotion,
    narrationReveal, onSetNarrationReveal, shortcuts, onSetShortcuts,
}) => {
    const c = READING_SETTINGS_COPY;
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
                <span className="gor-label gor-config-label">{c.motion}</span>
                <div>
                    <SegmentedControl radio ariaLabel={c.motion} describedBy="settings-reading-motion-note"
                        options={options(c.motionOptions)} value={motion} onChange={onSetMotion} />
                    <p id="settings-reading-motion-note" className="gor-config-note">{c.motionNote[motion]}</p>
                </div>
                <span className="gor-label gor-config-label">{c.narration}</span>
                <div>
                    <SegmentedControl radio ariaLabel={c.narration} describedBy="settings-reading-narration-note"
                        options={options(c.narrationOptions)} value={narrationReveal} onChange={onSetNarrationReveal} />
                    <p id="settings-reading-narration-note" className="gor-config-note">{c.narrationNote[narrationReveal]}</p>
                </div>
                <span className="gor-label gor-config-label">{c.shortcuts}</span>
                <div>
                    <SegmentedControl radio ariaLabel="Single-key shortcuts" describedBy="settings-reading-keys-note"
                        options={options(c.shortcutOptions)} value={shortcuts} onChange={onSetShortcuts} />
                    <p id="settings-reading-keys-note" className="gor-config-note">{c.shortcutNote[shortcuts]}</p>
                </div>
            </div>
        </section>
    );
};
