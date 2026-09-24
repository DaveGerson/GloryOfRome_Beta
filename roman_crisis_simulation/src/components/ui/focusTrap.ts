/**
 * components/ui/focusTrap.ts
 *
 * A pure, framework-free focus trap extracted from OnboardingOverlay.tsx's
 * original inline implementation (the Tab/Shift+Tab cycling + focus-restore
 * logic that lived in its handleKeyDown/useEffect). Every gor-dialog-shaped
 * overlay (OnboardingOverlay, EventModal, SettingsMenu, GameMasterScreen)
 * shares this one implementation instead of re-deriving it.
 *
 * Scope is deliberately narrow: this owns focus containment only.
 * Escape-to-close stays a component-level concern (some dialogs, like
 * EventModal, are deliberately blocking and must never grow a close path).
 */

/** The minimal shape this needs from a keydown event - satisfied by both a
 * native KeyboardEvent and React's SyntheticEvent<KeyboardEvent> wrapper, so
 * callers never need to cast. */
export interface FocusTrapKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

export interface FocusTrap {
  /** Remembers the currently-focused element, then moves focus into the trap's container. */
  activate(): void;
  /** Wraps Tab/Shift+Tab across the container's first/last focusable element. No-ops on any other key. */
  handleKeyDown(event: FocusTrapKeyEvent): void;
  /** Restores focus to whatever was focused when `activate` last ran. */
  release(): void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The Tab-reachable subset of the selector's matches. `button`/`input`
 * match regardless of tabindex, so an explicit `tabindex="-1"` must be
 * filtered here too: the inactive tabs/radios of a roving group (GM console
 * tablist, private-scene target cards) and the hidden `type="file"` inputs
 * behind "Restore from a copy" are all out of the Tab sequence, and wrapping
 * focus onto one of them would strand the user on an element Tab itself
 * never visits.
 */
function getFocusable(container: HTMLElement): HTMLElement[] {
  const focusable: HTMLElement[] = [];
  container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach(el => {
    if (el.hasAttribute('disabled')) return;
    if (el.getAttribute('tabindex') === '-1') return;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return;
    focusable.push(el);
  });
  return focusable;
}

/** Builds a focus trap over `container` (expected to be a dialog root - see
 * the gor-dialog callers, which give it `tabIndex={-1}` so `activate` can
 * focus the dialog itself when it holds no other focusable content). */
export function createFocusTrap(container: HTMLElement): FocusTrap {
  let previouslyFocused: HTMLElement | null = null;

  return {
    activate() {
      previouslyFocused = document.activeElement as HTMLElement | null;
      container.focus();
    },

    handleKeyDown(event: FocusTrapKeyEvent) {
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // An active element that is not one of the trap's focusable children -
      // the dialog root itself right after activate() (tabIndex=-1), or an
      // element behind the modal - must also be treated as a boundary, or a
      // Tab/Shift+Tab from there falls through to the browser default and
      // walks focus out of the dialog entirely.
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && (index === 0 || index === -1)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (index === focusable.length - 1 || index === -1)) {
        event.preventDefault();
        first.focus();
      }
    },

    release() {
      previouslyFocused?.focus();
    },
  };
}
