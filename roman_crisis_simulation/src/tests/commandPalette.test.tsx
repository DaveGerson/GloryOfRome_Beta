/**
 * @vitest-environment jsdom
 *
 * tests/commandPalette.test.tsx
 *
 * The command palette (Ctrl+K / ⌘K) and the game screen's keys:
 *
 *  - app/commands.ts: the search (every word must match, label-first
 *    ranking, stable ties), the key map (the chord works while typing but
 *    never over another modal; single keys only outside a text field, never
 *    with a modifier, and never when the player turned them off - WCAG
 *    2.1.4), and the game screen's list (only what can run now; it opens
 *    the configuration, it never flips an option itself - D43);
 *  - components/CommandPalette.tsx: the combobox/listbox contract, arrow
 *    keys, Enter, Escape, the empty state, and a command running only after
 *    the palette has handed focus back;
 *  - hooks/useCommandPalette.ts: the window listener;
 *  - app/domCommands.ts: every command goes through the control the player
 *    would press;
 *  - the App: Ctrl+K on the game screen, a search, Enter - the register
 *    opens; `/` reaches the tablet; the masthead's Commands button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  buildGameCommands, filterCommands, groupCommands, isApplePlatform, paletteChordLabel, paletteChordProse, resolveShortcut,
  COMMAND_COPY, type GameCommandContext, type PaletteCommand, type ShortcutContext, type ShortcutKeyEvent,
} from '../app/commands';
import { CommandPalette, COMMAND_PALETTE_COPY, RESULTS_ANNOUNCE_DELAY_MS } from '../components/CommandPalette';
import { anyModalOpen, isTypingTarget, useCommandPalette } from '../hooks/useCommandPalette';
import { draftSuggestion, focusComposer, pressOpener, selectRegister } from '../app/domCommands';
import { SIDE_PANEL_TABS } from '../components/SidePanel';
import App from '../App';
import { whenLazyScreensReady } from '../app/lazyScreens';
import { GameProvider } from '../state/GameContext';
import { saveGame } from '../persistence/saveGame';
import { setShortcutPreference } from '../persistence/readingPrefs';
import { makeAppSave } from './factories';
import { renderHook } from './renderHook';
import type { TabId } from '../perception/visibility';

vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = '';
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

const command = (label: string, overrides: Partial<PaletteCommand> = {}): PaletteCommand => ({
  id: label, group: 'Actions', label, run: vi.fn(), ...overrides,
});

// --- app/commands.ts ---------------------------------------------------------

describe('filterCommands', () => {
  const list = [
    command('Open the narration log', { keywords: 'voice transcript' }),
    command('Reports', { group: 'Side panel' }),
    command('Write your action', { keywords: 'compose tablet' }),
    command('Draft: Report to the Senate', { group: 'Counsel' }),
  ];

  it('returns the list unchanged for an empty or blank query', () => {
    expect(filterCommands(list, '')).toEqual(list);
    expect(filterCommands(list, '   ')).toEqual(list);
  });

  it('requires every word, in the label, the group or the keywords, ignoring case and accents', () => {
    expect(filterCommands(list, 'VOICE log').map(c => c.label)).toEqual(['Open the narration log']);
    expect(filterCommands(list, 'side panel').map(c => c.label)).toEqual(['Reports']);
    expect(filterCommands(list, 'tablét').map(c => c.label)).toEqual(['Write your action']);
    expect(filterCommands(list, 'voice senate')).toEqual([]);
  });

  it('ranks a label that starts with the query first, then a label word, then anything else; ties keep their order', () => {
    const ranked = filterCommands([
      command('Draft: Report to the Senate', { group: 'Counsel' }),
      command('Open the reports', { keywords: '' }),
      command('Reports'),
      command('The Fates', { keywords: 'report' }),
    ], 'rep').map(c => c.label);
    expect(ranked).toEqual(['Reports', 'Draft: Report to the Senate', 'Open the reports', 'The Fates']);
  });
});

describe('groupCommands', () => {
  it('keeps each group together, in order of first appearance', () => {
    const groups = groupCommands([
      command('a', { group: 'Side panel' }), command('b', { group: 'Actions' }), command('c', { group: 'Side panel' }),
    ]);
    expect(groups.map(g => [g.group, g.commands.map(c => c.label)])).toEqual([
      ['Side panel', ['a', 'c']], ['Actions', ['b']],
    ]);
  });
});

describe('resolveShortcut', () => {
  const key = (k: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent =>
    ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  const ctx = (overrides: Partial<ShortcutContext> = {}): ShortcutContext =>
    ({ inGame: true, singleKeys: true, paletteOpen: false, otherModalOpen: false, typing: false, ...overrides });

  it('Ctrl+K and ⌘K toggle the palette, even while typing', () => {
    expect(resolveShortcut(key('k', { ctrlKey: true }), ctx({ typing: true }))).toEqual({ kind: 'toggle-palette' });
    expect(resolveShortcut(key('K', { metaKey: true }), ctx())).toEqual({ kind: 'toggle-palette' });
    expect(resolveShortcut(key('k', { ctrlKey: true }), ctx({ paletteOpen: true }))).toEqual({ kind: 'toggle-palette' });
    expect(resolveShortcut(key('k', { ctrlKey: true, shiftKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key('k', { ctrlKey: true, altKey: true }), ctx())).toBeNull();
  });

  it('never opens the palette over another modal, and nothing works off the game screen or mid-composition', () => {
    expect(resolveShortcut(key('k', { ctrlKey: true }), ctx({ otherModalOpen: true }))).toBeNull();
    expect(resolveShortcut(key('k', { ctrlKey: true }), ctx({ inGame: false }))).toBeNull();
    expect(resolveShortcut({ ...key('k', { ctrlKey: true }), isComposing: true }, ctx())).toBeNull();
  });

  it('maps 1-7 to the registers, / to the tablet and ? to the palette', () => {
    expect(resolveShortcut(key('1'), ctx())).toEqual({ kind: 'register', index: 0 });
    expect(resolveShortcut(key('7'), ctx())).toEqual({ kind: 'register', index: 6 });
    expect(resolveShortcut(key('8'), ctx())).toBeNull();
    expect(resolveShortcut(key('0'), ctx())).toBeNull();
    expect(resolveShortcut(key('/'), ctx())).toEqual({ kind: 'focus-composer' });
    expect(resolveShortcut(key('?', { shiftKey: true }), ctx())).toEqual({ kind: 'open-palette' });
  });

  it('holds every single key while typing, under a modal, with the palette open, with a modifier, or when turned off', () => {
    for (const blocked of [ctx({ typing: true }), ctx({ otherModalOpen: true }), ctx({ paletteOpen: true }), ctx({ singleKeys: false })]) {
      expect(resolveShortcut(key('3'), blocked)).toBeNull();
      expect(resolveShortcut(key('/'), blocked)).toBeNull();
      expect(resolveShortcut(key('?', { shiftKey: true }), blocked)).toBeNull();
    }
    expect(resolveShortcut(key('3', { altKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key('3', { ctrlKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key('/', { metaKey: true }), ctx())).toBeNull();
  });

  it('matches the character typed, so every keyboard layout reaches the same keys', () => {
    // German: `/` is Shift+7. French AZERTY: the digits are shifted.
    expect(resolveShortcut(key('/', { shiftKey: true, code: 'Digit7' }), ctx())).toEqual({ kind: 'focus-composer' });
    expect(resolveShortcut(key('3', { shiftKey: true, code: 'Digit3' }), ctx())).toEqual({ kind: 'register', index: 2 });
    // US Shift+3 types '#', which is nothing.
    expect(resolveShortcut(key('#', { shiftKey: true, code: 'Digit3' }), ctx())).toBeNull();
  });

  it('finds Ctrl+K on a layout whose K key types another script, and only there', () => {
    // Russian: the K key types 'л'.
    expect(resolveShortcut(key('л', { ctrlKey: true, code: 'KeyK' }), ctx())).toEqual({ kind: 'toggle-palette' });
    // Dvorak: the letter k lives elsewhere, and is what counts.
    expect(resolveShortcut(key('k', { ctrlKey: true, code: 'KeyV' }), ctx())).toEqual({ kind: 'toggle-palette' });
    // ...while the physical K key types 't' there, which is not the chord.
    expect(resolveShortcut(key('t', { ctrlKey: true, code: 'KeyK' }), ctx())).toBeNull();
  });
});

describe('the chord label', () => {
  it('is ⌘K on Apple platforms and Ctrl K elsewhere', () => {
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
    expect(paletteChordLabel(true)).toBe('⌘K');
    expect(paletteChordLabel(false)).toBe('Ctrl K');
    expect(paletteChordProse(true)).toBe('⌘K');
    expect(paletteChordProse(false)).toBe('Ctrl+K');
  });
});

describe('buildGameCommands', () => {
  const context = (overrides: Partial<GameCommandContext> = {}): GameCommandContext => ({
    registers: SIDE_PANEL_TABS,
    changeCounts: new Map<TabId, number>([['reports', 2]]),
    singleKeys: true,
    canWrite: true,
    canOpenPrivateScene: true,
    canOpenLedger: false,
    suggestedActions: ['Bribe the Guard', 'Write to the Senate'],
    selectRegister: vi.fn(), focusComposer: vi.fn(), draftSuggestion: vi.fn(),
    openPrivateScene: vi.fn(), openNarrationLog: vi.fn(), jumpToLatest: vi.fn(),
    openSettings: vi.fn(), openLedger: vi.fn(),
    ...overrides,
  });

  it('offers the seven registers in rail order, numbered, with what is new', () => {
    const registers = buildGameCommands(context()).filter(c => c.group === 'Side panel');
    expect(registers.map(c => c.label)).toEqual(SIDE_PANEL_TABS.map(t => t.fullLabel));
    expect(registers.map(c => c.shortcut)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(registers.find(c => c.label === 'Reports')?.note).toBe(COMMAND_COPY.registerNote(2));
    expect(registers.find(c => c.label === 'Events')?.note).toBeUndefined();
  });

  it('runs each command through its own handler', () => {
    const ctx = context({ canOpenLedger: true });
    const byId = new Map(buildGameCommands(ctx).map(c => [c.id, c]));
    byId.get('register:reports')!.run();
    byId.get('desk:write')!.run();
    byId.get('counsel:1')!.run();
    byId.get('desk:private-scene')!.run();
    byId.get('desk:narration-log')!.run();
    byId.get('desk:latest')!.run();
    byId.get('house:settings')!.run();
    byId.get('house:ledger')!.run();
    expect(ctx.selectRegister).toHaveBeenCalledWith('reports');
    expect(ctx.focusComposer).toHaveBeenCalled();
    expect(ctx.draftSuggestion).toHaveBeenCalledWith(1);
    expect(ctx.openPrivateScene).toHaveBeenCalled();
    expect(ctx.openNarrationLog).toHaveBeenCalled();
    expect(ctx.jumpToLatest).toHaveBeenCalled();
    expect(ctx.openSettings).toHaveBeenCalled();
    expect(ctx.openLedger).toHaveBeenCalled();
    expect(byId.get('counsel:0')!.label).toBe(COMMAND_COPY.counsel('Bribe the Guard'));
  });

  it('leaves out what cannot run now, rather than drawing it dead', () => {
    const ids = buildGameCommands(context({ canWrite: false, canOpenPrivateScene: false, canOpenLedger: false })).map(c => c.id);
    expect(ids).not.toContain('desk:write');
    expect(ids).not.toContain('desk:private-scene');
    expect(ids).not.toContain('house:ledger');
    expect(ids.some(id => id.startsWith('counsel:'))).toBe(false);
    expect(ids).toContain('desk:narration-log');
    expect(ids).toContain('house:settings');
  });

  it('shows no key it will not answer to when single keys are off', () => {
    const commands = buildGameCommands(context({ singleKeys: false }));
    expect(commands.every(c => c.shortcut === undefined)).toBe(true);
  });

  it('opens the configuration and never flips an option itself (D43)', () => {
    const labels = buildGameCommands(context({ canOpenLedger: true })).map(c => c.label.toLowerCase());
    for (const option of ['lighting', 'nox', 'lvx', 'pacing', 'mock', 'text size', 'motion']) {
      expect(labels.some(label => label.includes(option)), option).toBe(false);
    }
  });
});

// --- components/CommandPalette.tsx --------------------------------------------

describe('CommandPalette', () => {
  const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const keydown = (key: string) => act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  const type = (value: string) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });

  const list = () => [
    command('World State', { group: 'Side panel' }),
    command('Reports', { group: 'Side panel', note: '2 new', shortcut: '3' }),
    command('Write your action', { shortcut: '/' }),
    command('Open the configuration', { group: 'Settings' }),
  ];

  it('is a modal dialog holding a combobox over an always-shown listbox, grouped, first option active', async () => {
    await mount(<CommandPalette commands={list()} onClose={vi.fn()} />);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(COMMAND_PALETTE_COPY.title);
    expect(document.activeElement).toBe(input());
    const listbox = document.getElementById(input().getAttribute('aria-controls')!)!;
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect([...listbox.querySelectorAll('[role="group"]')].map(g => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Side panel', 'Actions', 'Settings']);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(options()[1].textContent).toContain('2 new');
    // Named in words, not by run-together text ("Reports2 new").
    expect(options()[1].getAttribute('aria-label')).toBe('Reports, 2 new');
    expect(options()[0].getAttribute('aria-label')).toBe('World State');
    // A search field, drawn as one.
    expect(document.querySelector('.gor-palette-glyph svg')).not.toBeNull();
  });

  it('walks the options with the arrows, wrapping at both ends', async () => {
    await mount(<CommandPalette commands={list()} onClose={vi.fn()} />);
    keydown('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    keydown('ArrowUp');
    keydown('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[3].id);
    keydown('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('searches into one ranked list without group headings, and says when nothing answers', async () => {
    await mount(<CommandPalette commands={list()} onClose={vi.fn()} />);
    type('rep');
    expect(options().map(o => o.textContent)).toEqual(['Reports2 new3']);
    expect(document.querySelector('[role="group"]')).toBeNull();
    type('zzz');
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain(COMMAND_PALETTE_COPY.empty);
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    // A listbox holds groups and options only; the empty state sits outside it.
    const listbox = document.getElementById(input().getAttribute('aria-controls')!)!;
    expect(listbox.textContent).toBe('');
    type('');
    expect([...listbox.children].every(child => child.getAttribute('role') === 'group')).toBe(true);
  });

  it('tells a screen reader how many commands answer once typing pauses, never per keystroke', async () => {
    vi.useFakeTimers();
    await mount(<CommandPalette commands={list()} onClose={vi.fn()} />);
    const status = () => document.querySelector('.gor-palette [role="status"]')!;
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('');
    type('r');
    act(() => { vi.advanceTimersByTime(RESULTS_ANNOUNCE_DELAY_MS - 1); });
    type('re');
    act(() => { vi.advanceTimersByTime(RESULTS_ANNOUNCE_DELAY_MS - 1); });
    expect(status().textContent).toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(status().textContent).toBe(COMMAND_PALETTE_COPY.count(1));
    type('zzz');
    act(() => { vi.advanceTimersByTime(RESULTS_ANNOUNCE_DELAY_MS); });
    expect(status().textContent).toBe(COMMAND_PALETTE_COPY.empty);
  });

  it('Enter closes the palette and runs the active command only afterwards', async () => {
    vi.useFakeTimers();
    const commands = list();
    const onClose = vi.fn();
    await mount(<CommandPalette commands={commands} onClose={onClose} />);
    type('write');
    keydown('Enter');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands[2].run).not.toHaveBeenCalled();
    act(() => { vi.runAllTimers(); });
    expect(commands[2].run).toHaveBeenCalledTimes(1);
  });

  it('a click runs that option; Escape and the backdrop close without running anything', async () => {
    vi.useFakeTimers();
    const commands = list();
    const onClose = vi.fn();
    await mount(<CommandPalette commands={commands} onClose={onClose} />);
    act(() => options()[1].click());
    act(() => { vi.runAllTimers(); });
    expect(commands[1].run).toHaveBeenCalledTimes(1);
    keydown('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => {
      const backdrop = document.querySelector('.gor-palette-backdrop')!;
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(commands.filter(c => (c.run as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toHaveLength(1);
  });

  it('hands focus back to whoever opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const host = await mount(<CommandPalette commands={list()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(input());
    const entry = mounted.find(m => m.container === host)!;
    await act(async () => entry.root.unmount());
    mounted.splice(mounted.indexOf(entry), 1);
    expect(document.activeElement).toBe(opener);
  });
});

// --- hooks/useCommandPalette.ts ---------------------------------------------

describe('useCommandPalette', () => {
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

  it('toggles on Ctrl+K and dispatches the single keys', () => {
    const onAction = vi.fn();
    const hook = renderHook(props => useCommandPalette(props), { inGame: true, singleKeys: true, onAction });
    press('k', { ctrlKey: true });
    expect(hook.current.paletteOpen).toBe(true);
    press('k', { ctrlKey: true });
    expect(hook.current.paletteOpen).toBe(false);
    press('3');
    expect(onAction).toHaveBeenCalledWith({ kind: 'register', index: 2 });
    press('/');
    expect(onAction).toHaveBeenCalledWith({ kind: 'focus-composer' });
    press('?', { shiftKey: true });
    expect(hook.current.paletteOpen).toBe(true);
    hook.unmount();
  });

  it('leaves typing alone, stands aside for another modal, and honours "off"', () => {
    const onAction = vi.fn();
    const hook = renderHook(props => useCommandPalette(props), { inGame: true, singleKeys: true, onAction });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    press('3', {}, textarea);
    expect(onAction).not.toHaveBeenCalled();

    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    press('3');
    press('k', { ctrlKey: true });
    expect(onAction).not.toHaveBeenCalled();
    expect(hook.current.paletteOpen).toBe(false);
    modal.remove();

    hook.rerender({ inGame: true, singleKeys: false, onAction });
    press('3');
    expect(onAction).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('closes when the game screen goes, and does not reopen by itself with the next reign', () => {
    const props = { inGame: true, singleKeys: true, onAction: vi.fn() };
    const hook = renderHook(p => useCommandPalette(p), props);
    act(() => hook.current.openPalette());
    expect(hook.current.paletteOpen).toBe(true);
    hook.rerender({ ...props, inGame: false });
    expect(hook.current.paletteOpen).toBe(false);
    hook.rerender(props);
    expect(hook.current.paletteOpen).toBe(false);
    hook.unmount();
  });

  it('knows typing targets and open modals', () => {
    const make = (html: string) => { const host = document.createElement('div'); host.innerHTML = html; document.body.appendChild(host); return host.firstElementChild!; };
    expect(isTypingTarget(make('<input type="text">'))).toBe(true);
    expect(isTypingTarget(make('<input type="checkbox">'))).toBe(false);
    expect(isTypingTarget(make('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(make('<select></select>'))).toBe(true);
    expect(isTypingTarget(make('<button></button>'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(anyModalOpen()).toBe(false);
    make('<dialog open></dialog>');
    expect(anyModalOpen()).toBe(true);
  });
});

// --- app/domCommands.ts -------------------------------------------------------

describe('domCommands', () => {
  it('opens a register by clicking its tab and moving focus there', () => {
    const tab = document.createElement('button');
    tab.id = 'sidepanel-tab-reports';
    const onClick = vi.fn();
    tab.addEventListener('click', onClick);
    document.body.appendChild(tab);
    expect(selectRegister('reports')).toBe(true);
    expect(onClick).toHaveBeenCalled();
    expect(document.activeElement).toBe(tab);
    expect(selectRegister('events')).toBe(false);
  });

  it('presses an opener only when it is there and enabled', () => {
    const opener = document.createElement('button');
    opener.setAttribute('data-gor-command', 'narration-log');
    const onClick = vi.fn();
    opener.addEventListener('click', onClick);
    document.body.appendChild(opener);
    expect(pressOpener('narration-log')).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    opener.disabled = true;
    expect(pressOpener('narration-log')).toBe(false);
    expect(pressOpener('private-scene')).toBe(false);
  });

  it('drafts a counsel by pressing its pill, then hands the tablet the focus', () => {
    vi.useFakeTimers();
    const composer = document.createElement('textarea');
    composer.id = 'chat-input';
    const pill = document.createElement('button');
    pill.setAttribute('data-gor-suggestion', '1');
    const onClick = vi.fn();
    pill.addEventListener('click', onClick);
    document.body.append(composer, pill);
    expect(draftSuggestion(1)).toBe(true);
    expect(onClick).toHaveBeenCalled();
    vi.runAllTimers();
    expect(document.activeElement).toBe(composer);
    expect(draftSuggestion(0)).toBe(false);
    composer.disabled = true;
    expect(focusComposer()).toBe(false);
  });
});

// --- The App -----------------------------------------------------------------

describe('the game screen', () => {
  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  async function waitFor(assertion: () => void, attempts = 40): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try { assertion(); return; } catch (error) { lastError = error; await flush(); }
    }
    throw lastError;
  }
  const buttonNamed = (root: ParentNode, name: string) => [...root.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;

  async function mountGame(): Promise<HTMLElement> {
    saveGame(makeAppSave({ suggestedActions: ['Bribe the Guard'] }));
    const container = await mount(React.createElement(GameProvider, null, React.createElement(App)));
    await act(() => whenLazyScreensReady());
    await waitFor(() => expect(buttonNamed(container, 'Continue Your Reign')).toBeDefined());
    await act(async () => buttonNamed(container, 'Continue Your Reign')!.click());
    await waitFor(() => expect(container.querySelector('#chat-input')).not.toBeNull());
    return container;
  }
  const pressOnWindow = (key: string, init: KeyboardEventInit = {}) => act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

  it('Ctrl+K, a search and Enter open the register', async () => {
    const container = await mountGame();
    expect(container.querySelector('.gor-masthead-compact')).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    pressOnWindow('k', { ctrlKey: true });
    const search = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'reports');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();
    expect(document.querySelector('[role="dialog"][aria-label="Commands"]')).toBeNull();
    const reports = document.getElementById('sidepanel-tab-reports')!;
    expect(reports.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(reports);
  });

  it('the masthead opens it too; a counsel drafts into the tablet; / and 1-7 work outside a field', async () => {
    const container = await mountGame();
    await act(async () => buttonNamed(container, 'Open the command palette')!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(o => o.textContent?.includes(COMMAND_COPY.counsel('Bribe the Guard')))!;
    expect(option).toBeDefined();
    await act(async () => option.click());
    await flush();
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('Bribe the Guard');
    expect(document.activeElement?.id).toBe('chat-input');

    (document.activeElement as HTMLElement).blur();
    pressOnWindow('7');
    expect(document.getElementById('sidepanel-tab-resources')!.getAttribute('aria-selected')).toBe('true');
    pressOnWindow('/');
    expect(document.activeElement?.id).toBe('chat-input');
    // Typing a digit into the tablet is writing, not a command.
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true })));
    expect(document.getElementById('sidepanel-tab-events')!.getAttribute('aria-selected')).toBe('false');
  });

  it('single keys do nothing once the player turns them off; Ctrl+K still works', async () => {
    setShortcutPreference('off');
    await mountGame();
    (document.activeElement as HTMLElement | null)?.blur();
    pressOnWindow('3');
    expect(document.getElementById('sidepanel-tab-reports')!.getAttribute('aria-selected')).toBe('false');
    pressOnWindow('k', { metaKey: true });
    expect(document.querySelector('input[role="combobox"]')).not.toBeNull();
    // No key caps for keys that would do nothing.
    const registers = [...document.querySelectorAll('[role="option"]')].slice(0, 7);
    expect(registers.every(r => r.querySelector('.gor-kbd') === null)).toBe(true);
  });
});
