/**
 * @vitest-environment jsdom
 *
 * ErrorBoundary — the poisoned slot gets an in-app escape (B7a 1b, spec:
 * docs/superpowers/specs/2026-08-05-b7a-hardening-and-tablist-design.md).
 *
 * The boundary catches ANY render crash, so the escape is deliberately
 * SECONDARY and confirm-gated — but a slot that crashes render previously
 * had NO in-app escape at all: "Restore Last Save" reloads into the same
 * crash, forever. The ruling: a second action beside it, "Abandon the reign
 * and begin anew", whose first press only swaps in the Abandon-grammar
 * inline confirm (the exact Start anew pattern — crimson sentence, danger
 * confirm, ghost "Keep my reign"); only the confirm clears the slot and
 * reloads.
 *
 * The contract these tests set (the spec leaves exact node shapes open):
 *  - the secondary action is a <button> whose text contains "Abandon the
 *    reign and begin anew";
 *  - the confirm state shows the sentence "Abandon your saved reign? It
 *    cannot be undone.", a confirm <button> carrying the design system's
 *    `gor-btn-danger` class (the ONLY danger button on the boundary screen),
 *    and a back-out <button> named exactly "Keep my reign";
 *  - confirm removes the 'gloryOfRome:autosave' slot and calls
 *    window.location.reload(); back-out returns to the resting fallback
 *    with the slot byte-for-byte intact.
 *
 * Same house style as reignImportSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library; `location` is swapped whole via
 * vi.stubGlobal (jsdom's own Location is LegacyUnforgeable), so no test
 * navigates. console.error is silenced per test: React reports the caught
 * render error through it by design, and that noise is not the contract.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import ErrorBoundary from '../components/ErrorBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVE_KEY = 'gloryOfRome:autosave';

/**
 * A minimal envelope loadGame accepts, so hasSave() is true and the primary
 * action reads "Restore Last Save" — the situation the escape exists for is
 * precisely "a VALID-looking slot whose interior crashes render".
 */
const VALID_SLOT = JSON.stringify({
  version: 1,
  savedAt: '2026-08-05T12:00:00.000Z',
  state: { entities: [], turnNumber: 4 },
});

/** The thrower child: any render crash, the class the boundary exists for. */
const Thrower: React.FC = () => {
  throw new Error('A fracture for the test');
};

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mountBoundary(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(
    <ErrorBoundary>
      <Thrower />
    </ErrorBoundary>,
  ));
  return container;
}

beforeEach(() => {
  localStorage.clear();
  // React reports the caught error via console.error (componentDidCatch logs
  // it too, deliberately). Neither is this contract.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** See the file header — the whole `location` binding is swapped, never navigated. */
function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

/** The secondary escape, by what it says — trailing punctuation left open. */
function abandonAction(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.includes('Abandon the reign and begin anew'));
  expect(button, 'the "Abandon the reign and begin anew" escape action').toBeDefined();
  return button as HTMLButtonElement;
}

/**
 * The confirm's danger button, located by the design system's danger class
 * (its label is veto-queue copy). It must be the ONLY danger button on the
 * boundary screen, so an ambiguous locator can never click the wrong thing.
 */
function dangerButton(container: HTMLElement): HTMLButtonElement {
  const buttons = container.querySelectorAll<HTMLButtonElement>('button.gor-btn-danger');
  expect(buttons, 'exactly one danger button (the abandon confirm)').toHaveLength(1);
  return buttons[0];
}

describe('ErrorBoundary — the poisoned slot gets an in-app escape (B7a 1b)', () => {
  it('offers the confirm-gated escape beside Restore Last Save, and the first press only asks', async () => {
    localStorage.setItem(SAVE_KEY, VALID_SLOT);
    const reload = stubReload();
    const container = await mountBoundary();

    // The mount is right: the boundary caught the crash and stands, with the
    // primary restore action reading the saved slot.
    expect(container.textContent).toContain('The Republic Endures');
    expect(buttonNamed(container, 'Restore Last Save')).toBeDefined();

    await click(abandonAction(container));

    // First press swaps in the Abandon-grammar inline confirm — the exact
    // Start anew pattern — and acts on nothing yet.
    expect(container.textContent).toContain('Abandon your saved reign? It cannot be undone.');
    expect(dangerButton(container)).toBeDefined();
    expect(buttonNamed(container, 'Keep my reign')).toBeDefined();
    expect(localStorage.getItem(SAVE_KEY)).toBe(VALID_SLOT);
    expect(reload).not.toHaveBeenCalled();
  });

  it('confirming abandons the reign: the slot is cleared, then the reload fires', async () => {
    localStorage.setItem(SAVE_KEY, VALID_SLOT);
    const reload = stubReload();
    const container = await mountBoundary();

    await click(abandonAction(container));
    await click(dangerButton(container));

    // The escape's whole point: the poisoned slot is GONE, so the reload
    // lands on a fresh CharacterSelection instead of the same crash.
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a held or repeated Enter cannot walk through the confirm — focus lands on "Keep my reign"', async () => {
    // The adversarial merge review's proof: both branches rendered a same-
    // shaped, unkeyed row, so React reused the button node at index 1 and
    // the focused ghost escape MORPHED IN PLACE into the danger confirm.
    // Enter fires click on keydown and auto-repeats; one held press (or a
    // reflexive double-tap) destroyed a healthy reign before the sentence
    // was ever read. The contract: entering the confirm state must move
    // focus to the SAFE action, and the danger button must be a fresh node,
    // never the one the player was already pressing.
    localStorage.setItem(SAVE_KEY, VALID_SLOT);
    const reload = stubReload();
    const container = await mountBoundary();

    const ghost = abandonAction(container);
    ghost.focus();
    expect(document.activeElement).toBe(ghost);
    await click(ghost);

    const keep = buttonNamed(container, 'Keep my reign');
    expect(document.activeElement).toBe(keep);
    expect(dangerButton(container)).not.toBe(ghost);

    // The key-repeat's second press now lands on the safe action: back out,
    // reign intact, no reload.
    await click(document.activeElement as HTMLElement);
    expect(container.textContent).not.toContain('Abandon your saved reign? It cannot be undone.');
    expect(localStorage.getItem(SAVE_KEY)).toBe(VALID_SLOT);
    expect(reload).not.toHaveBeenCalled();
  });

  it('"Keep my reign" backs out with the slot intact', async () => {
    localStorage.setItem(SAVE_KEY, VALID_SLOT);
    const reload = stubReload();
    const container = await mountBoundary();

    await click(abandonAction(container));
    await click(buttonNamed(container, 'Keep my reign'));

    // Back to the resting fallback: the confirm is gone, the escape is
    // offered again, and nothing was cleared or reloaded.
    expect(container.textContent).not.toContain('Abandon your saved reign? It cannot be undone.');
    expect(abandonAction(container)).toBeDefined();
    expect(localStorage.getItem(SAVE_KEY)).toBe(VALID_SLOT);
    expect(reload).not.toHaveBeenCalled();
  });
});
