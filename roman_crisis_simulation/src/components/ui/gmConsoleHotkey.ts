/**
 * components/ui/gmConsoleHotkey.ts
 *
 * A pure, framework-free predicate extracted from App.tsx's Ctrl+Shift+G
 * keydown handler (D7/D33). Isolating "should this event toggle the GM
 * console" as one boolean lets the handler gate `event.preventDefault()` on
 * the same answer it uses to decide whether to toggle, instead of preventing
 * default first and checking availability second.
 */

/** The minimal shape this needs from a keydown event - satisfied by both a
 * native KeyboardEvent and React's SyntheticEvent<KeyboardEvent> wrapper. */
export interface GmConsoleHotkeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** True only when the event is the exact Ctrl+Shift+G chord AND the GM
 * console is available (D33 - a no-op entirely when unavailable). */
export function shouldToggleGmConsole(
  event: GmConsoleHotkeyEvent,
  gmConsoleAvailable: boolean
): boolean {
  const isChord = event.ctrlKey && event.shiftKey && (event.key === 'G' || event.key === 'g');
  return isChord && gmConsoleAvailable;
}
