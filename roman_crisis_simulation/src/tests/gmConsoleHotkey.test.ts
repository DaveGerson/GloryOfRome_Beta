/**
 * components/ui/gmConsoleHotkey.ts - the pure decision helper extracted from
 * App.tsx's Ctrl+Shift+G keydown handler. The prior handler called
 * event.preventDefault() unconditionally before checking whether the GM
 * console was even available, which meant the chord was swallowed (default
 * prevented) even when the console was disabled in settings. This helper
 * makes "should this event toggle the console" a single pure predicate so
 * App.tsx can gate preventDefault on the same answer it uses to decide
 * whether to toggle.
 */
import { describe, it, expect } from 'vitest';
import { shouldToggleGmConsole } from '../components/ui/gmConsoleHotkey';

describe('components/ui/gmConsoleHotkey', () => {
  it('returns false for the exact chord when the console is unavailable', () => {
    expect(
      shouldToggleGmConsole({ key: 'G', ctrlKey: true, shiftKey: true }, false)
    ).toBe(false);
  });

  it('returns true for the exact chord when the console is available', () => {
    expect(
      shouldToggleGmConsole({ key: 'G', ctrlKey: true, shiftKey: true }, true)
    ).toBe(true);
  });

  it('returns true for the lowercase-g chord when the console is available', () => {
    expect(
      shouldToggleGmConsole({ key: 'g', ctrlKey: true, shiftKey: true }, true)
    ).toBe(true);
  });

  it('returns false for unrelated keys even when the console is available', () => {
    expect(
      shouldToggleGmConsole({ key: 'g', ctrlKey: true, shiftKey: false }, true)
    ).toBe(false);
    expect(
      shouldToggleGmConsole({ key: 'g', ctrlKey: false, shiftKey: true }, true)
    ).toBe(false);
    expect(
      shouldToggleGmConsole({ key: 'a', ctrlKey: true, shiftKey: true }, true)
    ).toBe(false);
  });
});
