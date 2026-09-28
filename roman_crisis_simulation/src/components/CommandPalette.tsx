import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createFocusTrap, type FocusTrap } from './ui/focusTrap';
import { filterCommands, groupCommands, paletteChordLabel, type PaletteCommand } from '../app/commands';

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const COMMAND_PALETTE_COPY = {
    title: 'Commands',
    search: 'Seek a command',
    placeholder: 'Seek a register, a tool, a counsel…',
    empty: 'No command answers to that.',
    keys: '↑ ↓ to choose · Enter to act · Esc to close',
    close: 'Close the commands',
} as const;

/**
 * The command palette (Ctrl+K / ⌘K, the masthead's Commands button, or `?`):
 * one search field over everything the game screen can reach - the seven
 * registers, the tablet, a private scene, the narration log, the counsel of
 * the week, the configuration and (when on) the Fates' ledger. app/commands.ts
 * builds the list and ranks the search; this component draws it.
 *
 * ARIA: a modal dialog holding a combobox whose listbox is always shown.
 * Focus stays in the field; ↑/↓ move the active option
 * (`aria-activedescendant`), Enter runs it, Escape closes. The same focus
 * trap as every gor-dialog returns focus to the invoker on close - and a
 * command runs only AFTER that return, so a command that moves focus
 * (the tablet, a register) keeps it.
 */
export const CommandPalette: React.FC<{
    commands: readonly PaletteCommand[];
    onClose: () => void;
}> = ({ commands, onClose }) => {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);
    const uid = useId();
    const listId = `${uid}-list`;
    const optionId = (index: number) => `${uid}-option-${index}`;

    const matches = filterCommands(commands, query);
    // With no query the list keeps its groups; a search is one ranked list.
    const sections: { group: string | null; commands: PaletteCommand[] }[] = query.trim()
        ? [{ group: null, commands: matches }]
        : groupCommands(matches);
    // The order the rows are drawn in - the one the arrows walk.
    const ordered = sections.flatMap(section => section.commands);
    const active = ordered.length === 0 ? -1 : Math.min(activeIndex, ordered.length - 1);

    useEffect(() => {
        if (!dialogRef.current) return;
        const trap = createFocusTrap(dialogRef.current);
        trapRef.current = trap;
        trap.activate();
        inputRef.current?.focus();
        return () => {
            trap.release();
            trapRef.current = null;
        };
    }, []);

    // Keep the active option in view as the arrows walk the list.
    useEffect(() => {
        if (active < 0) return;
        document.getElementById(`${uid}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [active, uid]);

    const run = (command: PaletteCommand) => {
        onClose();
        // After the close commits and the trap has handed focus back.
        setTimeout(command.run, 0);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (ordered.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((Math.max(active, 0) + step + ordered.length) % ordered.length);
            return;
        }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (active >= 0) run(ordered[active]);
            return;
        }
        trapRef.current?.handleKeyDown(event);
    };

    return createPortal(
        <div
            className="gor-dialog-backdrop gor-palette-backdrop"
            onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div
                ref={dialogRef}
                className="gor-palette"
                role="dialog"
                aria-modal="true"
                aria-label={COMMAND_PALETTE_COPY.title}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
            >
                <div className="gor-palette-field">
                    <span className="gor-palette-glyph" aria-hidden="true">❖</span>
                    <input
                        ref={inputRef}
                        className="gor-palette-input"
                        type="text"
                        role="combobox"
                        aria-label={COMMAND_PALETTE_COPY.search}
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                        placeholder={COMMAND_PALETTE_COPY.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        value={query}
                        onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
                    />
                    <button type="button" className="gor-palette-close" onClick={onClose} aria-label={COMMAND_PALETTE_COPY.close}>
                        <kbd className="gor-kbd">Esc</kbd>
                    </button>
                </div>
                <div id={listId} role="listbox" aria-label={COMMAND_PALETTE_COPY.title} className="gor-palette-list">
                    {ordered.length === 0 && (
                        <p className="gor-palette-empty" role="presentation">{COMMAND_PALETTE_COPY.empty}</p>
                    )}
                    {sections.map(section => {
                        const headingId = section.group ? `${uid}-group-${section.group.replace(/\W+/g, '-')}` : undefined;
                        const rows = section.commands.map(command => {
                            const index = ordered.indexOf(command);
                            const selected = index === active;
                            return (
                                <div
                                    key={command.id}
                                    id={optionId(index)}
                                    role="option"
                                    aria-selected={selected}
                                    className={`gor-palette-option${selected ? ' gor-palette-option-active' : ''}`}
                                    onMouseMove={() => { if (!selected) setActiveIndex(index); }}
                                    onClick={() => run(command)}
                                >
                                    <span className="gor-palette-label">{command.label}</span>
                                    {command.note && <span className="gor-palette-note">{command.note}</span>}
                                    {command.shortcut && <kbd className="gor-kbd" aria-hidden="true">{command.shortcut}</kbd>}
                                </div>
                            );
                        });
                        return section.group ? (
                            <div key={section.group} role="group" aria-labelledby={headingId} className="gor-palette-group">
                                <div id={headingId} role="presentation" className="gor-palette-group-title">{section.group}</div>
                                {rows}
                            </div>
                        ) : <React.Fragment key="results">{rows}</React.Fragment>;
                    })}
                </div>
                <p className="gor-palette-foot" aria-hidden="true">
                    <span>{COMMAND_PALETTE_COPY.keys}</span>
                    <kbd className="gor-kbd">{paletteChordLabel()}</kbd>
                </p>
            </div>
        </div>,
        document.body,
    );
};

export default CommandPalette;
