/**
 * @vitest-environment jsdom
 *
 * The rite (WP-17), mounted. `tests/onboarding.test.ts` never touches this
 * component — it exercises `persistence/onboarding.ts`'s helpers only — so
 * everything the overlay itself promises has been unpinned until now:
 *
 *  - three steps, each SHOWING its claim with its own specimen rather than
 *    asserting it in prose (the written order, the two accounts, the blank
 *    stone), and the last button naming what pressing it does;
 *  - the ❦ autosave line was deliberately lifted OUT of step III's body copy
 *    into its own aside, so it must appear there and only there;
 *  - the numerals I/II/III replaced three anonymous dots precisely so the
 *    player can tell which rite they are in;
 *  - and the accessibility contract WP-17 promised to leave intact while it
 *    rewrote the body: the `aria-live` step counter, the labelled/described
 *    modal dialog, and THREE ways out (×, Escape, "Skip the rite"), each of
 *    which must reach `onClose`.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import OnboardingOverlay from '../components/OnboardingOverlay';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => root.render(element));
    return container;
}

afterEach(async () => {
    for (const { root, container } of mounted.splice(0)) {
        await act(async () => root.unmount());
        container.remove();
    }
});

/** Opens the rite with a spy on the one way out it has. */
async function openRite(): Promise<{ container: HTMLElement; onClose: ReturnType<typeof vi.fn> }> {
    const onClose = vi.fn();
    const container = await mount(<OnboardingOverlay isOpen onClose={onClose} />);
    return { container, onClose };
}

const dialog = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="dialog"]')!;

const button = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!;

const press = async (element: HTMLElement) => {
    await act(async () => element.click());
};

const escape = async (container: HTMLElement) => {
    await act(async () => {
        dialog(container).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
    });
};

/** Walks the rite forward with the same button the player uses. */
async function advanceTo(container: HTMLElement, step: 1 | 2 | 3) {
    for (let i = 1; i < step; i++) await press(button(container, 'Next'));
}

const caption = (container: HTMLElement) => container.querySelector('.gor-specimen-caption')?.textContent;
const nowStep = (container: HTMLElement) => container.querySelector('.gor-rite-step-now')?.textContent;
const counter = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent;

describe('the three steps of the rite (WP-17)', () => {
    it('advances I → II → III, and only then offers to take your place', async () => {
        const { container } = await openRite();

        expect(container.textContent).toContain('Rule Your Week');
        expect(button(container, 'Next')).toBeDefined();

        await press(button(container, 'Next'));
        expect(container.textContent).toContain('Knowledge Is Survival');

        await press(button(container, 'Next'));
        expect(container.textContent).toContain('Death Is Real');
        expect(button(container, 'Next')).toBeUndefined();
        expect(button(container, 'Take your place')).toBeDefined();
    });

    it('finishes the rite by calling onClose from the final button, not by advancing to a fourth step', async () => {
        const { container, onClose } = await openRite();
        await advanceTo(container, 3);
        await press(button(container, 'Take your place'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('marks the current step with its own numeral, out of three', async () => {
        const { container } = await openRite();
        const numerals = () => Array.from(container.querySelectorAll('.gor-rite-step')).map(s => s.textContent);

        expect(numerals()).toEqual(['I', 'II', 'III']);
        expect(container.querySelectorAll('.gor-rite-step-now')).toHaveLength(1);
        expect(nowStep(container)).toBe('I');

        await press(button(container, 'Next'));
        expect(nowStep(container)).toBe('II');

        await press(button(container, 'Next'));
        expect(nowStep(container)).toBe('III');
        expect(container.querySelectorAll('.gor-rite-step-now')).toHaveLength(1);
    });
});

describe('each pillar shows its claim rather than asserting it (WP-17 specimens)', () => {
    it('step I: the written order, sealed', async () => {
        const { container } = await openRite();
        expect(caption(container)).toBe('One week, written and sealed');
        expect(container.querySelector('.gor-specimen-order')).not.toBeNull();
        expect(container.textContent).toContain('Summon the Praetorian prefect at dusk.');
    });

    it('step II: two report slips that cannot both be right, and the line that says so', async () => {
        const { container } = await openRite();
        await advanceTo(container, 2);

        expect(caption(container)).toBe('Two accounts of the same night');
        // Item 28's Reports vocabulary at specimen scale: two slips, one
        // sealed by the agent you pay and one unsealed from the rumour mill.
        expect(container.querySelectorAll('.gor-report')).toHaveLength(2);
        expect(container.textContent).toContain('Your agent');
        expect(container.textContent).toContain('The rumour mill');
        expect(container.querySelector('.gor-specimen-close')?.textContent).toBe(
            'Both sit in your panel. It will never tell you which one is true.',
        );
    });

    it('step III: the blank stone, with the name not yet cut', async () => {
        const { container } = await openRite();
        await advanceTo(container, 3);

        expect(caption(container)).toBe('Every reign ends here');
        expect(container.querySelector('.gor-stone-name')?.textContent).toBe('Your name here');
        expect(container.querySelector('.gor-stone-span')?.textContent).toBe('Week I — Week ?');
    });

    it('shows one caption and one specimen at a time — the steps do not accumulate', async () => {
        for (const step of [1, 2, 3] as const) {
            const container = await mount(<OnboardingOverlay isOpen onClose={() => {}} />);
            await advanceTo(container, step);
            expect(container.querySelectorAll('.gor-specimen-caption'), `step ${step}`).toHaveLength(1);
            expect(container.querySelectorAll('.gor-specimen'), `step ${step}`).toHaveLength(1);
        }
    });
});

/**
 * The aside moved out of the body copy on purpose: "your reign is saved
 * automatically" is reassurance about the machine, not one of the three
 * things the rite is teaching, so it sits beneath the well on the last step
 * and nowhere else.
 */
describe('the ❦ autosave aside (WP-17)', () => {
    it('appears on step III alone', async () => {
        const { container } = await openRite();
        expect(container.querySelector('.gor-specimen-note')).toBeNull();

        await press(button(container, 'Next'));
        expect(container.querySelector('.gor-specimen-note')).toBeNull();

        await press(button(container, 'Next'));
        const note = container.querySelector('.gor-specimen-note');
        expect(note?.textContent).toContain('❦');
        expect(note?.textContent).toContain('saved automatically, every week.');
    });

    it('never rides along in the body copy', async () => {
        const { container } = await openRite();
        await advanceTo(container, 3);
        const body = container.querySelector('#onboarding-body')!;
        expect(body.textContent).toContain('There is no winning');
        expect(body.textContent).not.toContain('saved automatically');
        expect(body.textContent).not.toContain('❦');
    });
});

describe('the accessibility contract WP-17 promised to preserve', () => {
    it('announces the step politely, and by number', async () => {
        const { container } = await openRite();
        expect(counter(container)).toBe('Step 1 of 3');

        await press(button(container, 'Next'));
        expect(counter(container)).toBe('Step 2 of 3');

        await press(button(container, 'Next'));
        expect(counter(container)).toBe('Step 3 of 3');
    });

    it('is a modal dialog, labelled by its title and described by its body', async () => {
        const { container } = await openRite();
        const node = dialog(container);

        expect(node.getAttribute('aria-modal')).toBe('true');
        const labelledBy = node.getAttribute('aria-labelledby')!;
        const describedBy = node.getAttribute('aria-describedby')!;
        // Both must actually resolve — a dangling id announces nothing.
        expect(container.querySelector(`#${labelledBy}`)?.textContent).toBe('Rule Your Week');
        expect(container.querySelector(`#${describedBy}`)?.textContent).toContain(
            'You act by writing intentions in your own words',
        );
    });

    it('closes on Escape', async () => {
        const { container, onClose } = await openRite();
        await escape(container);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on the ×, which says what it is for', async () => {
        const { container, onClose } = await openRite();
        const close = container.querySelector<HTMLButtonElement>('[aria-label="Close introduction"]')!;
        expect(close.textContent).toBe('×');
        await press(close);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on "Skip the rite" — a dismissable rite says it is dismissable', async () => {
        const { container, onClose } = await openRite();
        await press(button(container, 'Skip the rite'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('offers every exit from every step, not just the first', async () => {
        for (const step of [1, 2, 3] as const) {
            const { container, onClose } = await openRite();
            await advanceTo(container, step);
            expect(container.querySelector('[aria-label="Close introduction"]')).not.toBeNull();
            expect(button(container, 'Skip the rite')).toBeDefined();
            await escape(container);
            expect(onClose, `step ${step}`).toHaveBeenCalledTimes(1);
        }
    });

    it('renders nothing at all when it is not open', async () => {
        const container = await mount(<OnboardingOverlay isOpen={false} onClose={() => {}} />);
        expect(container.children).toHaveLength(0);
        expect(container.textContent).toBe('');
    });
});

/**
 * The focus contract lives in the component's own useEffect: take focus on
 * open, and hand it to the chat input on close (falling back to whatever was
 * focused before). Mounted by hand rather than through `mount` because the
 * assertion is about what happens AFTER unmount, which the shared afterEach
 * would otherwise perform out of the test's sight.
 */
describe('the focus the rite borrows (WP-17)', () => {
    it('takes focus on open and returns it to the chat input on close', async () => {
        const chatInput = document.createElement('input');
        chatInput.id = 'chat-input';
        document.body.appendChild(chatInput);
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => root.render(<OnboardingOverlay isOpen onClose={() => {}} />));
        expect(document.activeElement).toBe(dialog(container));

        await act(async () => root.unmount());
        expect(document.activeElement).toBe(chatInput);

        container.remove();
        chatInput.remove();
    });

    it('falls back to whatever was focused before when there is no chat input on the page', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => root.render(<OnboardingOverlay isOpen onClose={() => {}} />));
        expect(document.activeElement).toBe(dialog(container));

        await act(async () => root.unmount());
        expect(document.activeElement).toBe(opener);

        container.remove();
        opener.remove();
    });
});
