/**
 * @vitest-environment jsdom
 *
 * components/ui/focusTrap.ts - the pure focus trap extracted from
 * OnboardingOverlay.tsx's original inline Tab/Shift+Tab cycling logic.
 * Deliberately plain jsdom + vitest, no React, no react-testing-library
 * (none is a project dependency and none is added here).
 *
 * jsdom has no real layout/tab order, so the helper (like the original
 * inline code it was extracted from) computes its own focusable set via
 * querySelectorAll against a fixed selector rather than relying on browser
 * tab-order semantics - these tests exercise exactly that computed set.
 * Elements must be attached to `document.body` for `document.activeElement`
 * and `.focus()` to behave as expected in jsdom.
 *
 * Escape-to-close is deliberately NOT exercised here - per the spec, it
 * stays a component-level concern (OnboardingOverlay's own handleKeyDown),
 * not part of this helper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFocusTrap } from '../components/ui/focusTrap';

describe('components/ui/focusTrap', () => {
  let container: HTMLDivElement;
  let extras: HTMLElement[] = [];

  beforeEach(() => {
    container = document.createElement('div');
    container.tabIndex = -1;
    document.body.appendChild(container);
    extras = [];
  });

  afterEach(() => {
    container.remove();
    extras.forEach(el => el.remove());
    extras = [];
  });

  function addOutsideButton(id: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = id;
    document.body.appendChild(btn);
    extras.push(btn);
    return btn;
  }

  it('restores focus to the previously-focused element on release', () => {
    const invoker = addOutsideButton('invoker');
    invoker.focus();
    expect(document.activeElement).toBe(invoker);

    const trap = createFocusTrap(container);
    trap.activate();
    trap.release();

    expect(document.activeElement).toBe(invoker);
  });

  it('moves focus into the container on activate', () => {
    const inside = document.createElement('button');
    container.appendChild(inside);

    const outsider = addOutsideButton('elsewhere');
    outsider.focus();

    const trap = createFocusTrap(container);
    trap.activate();

    expect(container.contains(document.activeElement)).toBe(true);
  });

  it('wraps Tab from the last focusable element to the first, calling preventDefault', () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    container.append(first, second);
    second.focus();

    const trap = createFocusTrap(container);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    trap.handleKeyDown(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable element to the last, calling preventDefault', () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    container.append(first, second);
    first.focus();

    const trap = createFocusTrap(container);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    trap.handleKeyDown(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(second);
  });

  it('with a single focusable element, keeps focus on it for both Tab and Shift+Tab, without throwing', () => {
    const only = document.createElement('button');
    container.appendChild(only);
    only.focus();

    const trap = createFocusTrap(container);

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true });
    const tabSpy = vi.spyOn(tabEvent, 'preventDefault');
    expect(() => trap.handleKeyDown(tabEvent)).not.toThrow();
    expect(tabSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(only);

    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    const shiftTabSpy = vi.spyOn(shiftTabEvent, 'preventDefault');
    expect(() => trap.handleKeyDown(shiftTabEvent)).not.toThrow();
    expect(shiftTabSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(only);
  });

  it('no-ops without throwing when the container has no focusable elements', () => {
    const nonFocusable = document.createElement('div');
    container.appendChild(nonFocusable);

    const trap = createFocusTrap(container);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    expect(() => trap.handleKeyDown(event)).not.toThrow();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('ignores non-Tab keys entirely', () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    container.append(first, second);
    first.focus();

    const trap = createFocusTrap(container);
    for (const key of ['a', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, shiftKey: false, cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      trap.handleKeyDown(event);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(first);
    }
  });

  it('does not throw on release when the previously-focused element was removed from the DOM', () => {
    const invoker = addOutsideButton('vanishing-invoker');
    invoker.focus();

    const trap = createFocusTrap(container);
    trap.activate(); // moves focus onto `container`; `invoker` is remembered
    invoker.remove();
    extras = extras.filter(el => el !== invoker);

    // Calling .focus() on a detached element is a spec no-op - release()
    // must swallow that gracefully rather than throw, leaving focus exactly
    // where activate() put it (never jumping to some other element).
    expect(() => trap.release()).not.toThrow();
    expect(document.activeElement).toBe(container);
  });

  it('does not throw on release when nothing was focused at activate time', () => {
    expect(document.activeElement).toBe(document.body);

    const trap = createFocusTrap(container);
    trap.activate(); // remembers `document.body` as "previously focused"

    // document.body has no tabindex, so .focus() on it is a no-op too -
    // release() must not throw, and focus stays on the container rather
    // than jumping anywhere unexpected.
    expect(() => trap.release()).not.toThrow();
    expect(document.activeElement).toBe(container);
  });
});
