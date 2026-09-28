/**
 * app/commands.ts
 *
 * The command palette's pure half: what a command is, how the palette
 * searches them, which key does what, and the one list of commands the game
 * screen offers. No React and no DOM here - the palette itself is
 * components/CommandPalette.tsx, the global keys are hooks/useCommandPalette.ts.
 *
 * Two rules the palette keeps:
 *  - it is a way to REACH things, never a second home for an option (D43):
 *    it opens the configuration menu, it never flips a setting itself;
 *  - it offers only what can run right now. A command that could not run
 *    (the GM ledger before a turn is played, a private scene mid-turn) is
 *    left out rather than drawn dead, so every row the player sees works.
 */

import type { TabId } from '../perception/visibility';

export type CommandGroup = 'Registers' | 'The desk' | 'Counsel' | 'The house';

export interface PaletteCommand {
    id: string;
    group: CommandGroup;
    label: string;
    /** More words the search matches; never shown. */
    keywords?: string;
    /** A key that does the same thing, shown at the row's end. */
    shortcut?: string;
    /** A short fact shown before the shortcut - "2 new". */
    note?: string;
    run: () => void;
}

const normalize = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * The commands that answer `query`, best first. Every word of the query
 * must appear somewhere in the command (its label, group or keywords); a
 * command whose LABEL starts with the query ranks first, then one with a
 * label word starting with the query's first word, then everything else
 * that matched. Ties keep the list's own order, so the palette never
 * reshuffles equals. An empty query returns the list unchanged.
 */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
    const q = normalize(query.trim());
    if (!q) return [...commands];
    const words = q.split(/\s+/);
    const scored: { command: PaletteCommand; score: number; index: number }[] = [];
    commands.forEach((command, index) => {
        const label = normalize(command.label);
        const haystack = `${label} ${normalize(command.group)} ${normalize(command.keywords ?? '')}`;
        if (!words.every(word => haystack.includes(word))) return;
        const score = label.startsWith(q) ? 3
            : label.split(/[\s—–-]+/).some(word => word.startsWith(words[0])) ? 2
                : 1;
        scored.push({ command, score, index });
    });
    return scored
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(entry => entry.command);
}

/** Commands in their groups, groups in order of first appearance. */
export function groupCommands(commands: readonly PaletteCommand[]): { group: CommandGroup; commands: PaletteCommand[] }[] {
    const groups: { group: CommandGroup; commands: PaletteCommand[] }[] = [];
    for (const command of commands) {
        const existing = groups.find(g => g.group === command.group);
        if (existing) existing.commands.push(command);
        else groups.push({ group: command.group, commands: [command] });
    }
    return groups;
}

// --- Keys -------------------------------------------------------------------

export type ShortcutAction =
    | { kind: 'toggle-palette' }
    | { kind: 'open-palette' }
    | { kind: 'register'; index: number }
    | { kind: 'focus-composer' };

export interface ShortcutKeyEvent {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    isComposing?: boolean;
}

export interface ShortcutContext {
    /** The game screen is up (not character selection, not the epilogue). */
    inGame: boolean;
    /** The player left single-key shortcuts on (Settings → Reading). */
    singleKeys: boolean;
    paletteOpen: boolean;
    /** Another modal is open (Settings, a fate, the narration log, a private scene...). */
    otherModalOpen: boolean;
    /** Focus is in something that takes typing. */
    typing: boolean;
}

/**
 * Which command, if any, a keydown asks for.
 *
 *  - Ctrl+K / ⌘K opens and closes the palette anywhere on the game screen,
 *    typing or not - but never over another modal: a fate waiting on a
 *    choice, or the configuration menu, keeps the room.
 *  - 1-7 open the registers, `/` goes to the tablet and `?` opens the
 *    palette - single keys, so only outside a text field, never with a
 *    modifier, never under a modal, and never when the player turned them
 *    off (WCAG 2.1.4).
 */
export function resolveShortcut(event: ShortcutKeyEvent, context: ShortcutContext): ShortcutAction | null {
    if (!context.inGame || event.isComposing) return null;
    const isPaletteChord = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && event.key.toLowerCase() === 'k';
    if (isPaletteChord) {
        return context.otherModalOpen && !context.paletteOpen ? null : { kind: 'toggle-palette' };
    }
    if (!context.singleKeys || context.paletteOpen || context.otherModalOpen || context.typing) return null;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    if (event.key === '?') return { kind: 'open-palette' };
    if (event.shiftKey) return null;
    if (event.key === '/') return { kind: 'focus-composer' };
    if (/^[1-7]$/.test(event.key)) return { kind: 'register', index: Number(event.key) - 1 };
    return null;
}

/** True when the platform's command key is ⌘ rather than Ctrl. */
export function isApplePlatform(nav: Pick<Navigator, 'userAgent'> | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
    return /Mac|iPhone|iPad|iPod/.test(nav?.userAgent ?? '');
}

export const paletteChordLabel = (apple = isApplePlatform()): string => (apple ? '⌘K' : 'Ctrl K');

// --- The game screen's commands ----------------------------------------------

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const COMMAND_COPY = {
    registerNote: (count: number) => `${count} new`,
    write: 'Write your action',
    privateScene: 'Seek a private audience',
    narrationLog: 'Open the narration log',
    latest: 'Return to the latest in the chronicle',
    settings: 'Open the configuration',
    ledger: "Open the Fates' ledger",
    counsel: (action: string) => `Draft: ${action}`,
} as const;

export interface GameCommandContext {
    registers: readonly { id: TabId; fullLabel: string }[];
    changeCounts?: ReadonlyMap<TabId, number>;
    singleKeys: boolean;
    /** The tablet takes words now (a week is not being written). */
    canWrite: boolean;
    /** A private scene can be opened now. */
    canOpenPrivateScene: boolean;
    /** The GM console is on this session AND has a turn to show. */
    canOpenLedger: boolean;
    suggestedActions: readonly string[];
    selectRegister: (id: TabId) => void;
    focusComposer: () => void;
    draftSuggestion: (index: number) => void;
    openPrivateScene: () => void;
    openNarrationLog: () => void;
    jumpToLatest: () => void;
    openSettings: () => void;
    openLedger: () => void;
}

/** The game screen's command list, in the order the palette shows it before any search. */
export function buildGameCommands(ctx: GameCommandContext): PaletteCommand[] {
    const commands: PaletteCommand[] = [];
    ctx.registers.forEach((register, index) => {
        const count = ctx.changeCounts?.get(register.id);
        commands.push({
            id: `register:${register.id}`,
            group: 'Registers',
            label: register.fullLabel,
            keywords: 'tab panel register go open intelligence',
            shortcut: ctx.singleKeys ? String(index + 1) : undefined,
            note: count ? COMMAND_COPY.registerNote(count) : undefined,
            run: () => ctx.selectRegister(register.id),
        });
    });
    if (ctx.canWrite) {
        commands.push({
            id: 'desk:write', group: 'The desk', label: COMMAND_COPY.write,
            keywords: 'compose tablet speak turn input type order',
            shortcut: ctx.singleKeys ? '/' : undefined,
            run: ctx.focusComposer,
        });
    }
    if (ctx.canOpenPrivateScene) {
        commands.push({
            id: 'desk:private-scene', group: 'The desk', label: COMMAND_COPY.privateScene,
            keywords: 'private scene meeting audience talk conversation',
            run: ctx.openPrivateScene,
        });
    }
    commands.push({
        id: 'desk:narration-log', group: 'The desk', label: COMMAND_COPY.narrationLog,
        keywords: 'voice performance transcript audio narrator',
        run: ctx.openNarrationLog,
    });
    commands.push({
        id: 'desk:latest', group: 'The desk', label: COMMAND_COPY.latest,
        keywords: 'scroll bottom newest jump end chat',
        run: ctx.jumpToLatest,
    });
    if (ctx.canWrite) {
        ctx.suggestedActions.forEach((action, index) => {
            commands.push({
                id: `counsel:${index}`, group: 'Counsel', label: COMMAND_COPY.counsel(action),
                keywords: 'suggestion suggested action idea',
                run: () => ctx.draftSuggestion(index),
            });
        });
    }
    commands.push({
        id: 'house:settings', group: 'The house', label: COMMAND_COPY.settings,
        keywords: 'settings options preferences key lighting theme text size motion voice pacing',
        run: ctx.openSettings,
    });
    if (ctx.canOpenLedger) {
        commands.push({
            id: 'house:ledger', group: 'The house', label: COMMAND_COPY.ledger,
            keywords: 'gm console game master debug log',
            run: ctx.openLedger,
        });
    }
    return commands;
}
