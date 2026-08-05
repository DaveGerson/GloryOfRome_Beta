/**
 * @vitest-environment jsdom
 *
 * The one zero state (WP-20 / audit item 45), pinned by its RULES rather than
 * by its markup. `components/tabs/EmptyRegister.tsx` is the single component
 * nine surfaces now share, and DESIGN_DECISIONS.md D45 states what it owes
 * them:
 *
 *  - **rule 2, draw the shape at rest** — the silhouette comes FIRST. The
 *    player is meant to learn what will fill the register before reading why
 *    it is empty; a line-then-shape order would invert that.
 *  - **rule 3, full opacity always** — dimming reads as *disabled*, and
 *    nothing in a zero state is disabled. This is the item-27 defect, and it
 *    is the one rule that regresses silently: a stray `opacity: .6` on a
 *    silhouette looks tasteful in review and is exactly the bug.
 *  - **rule 4, one affordance and only if it exists now** — a zero state must
 *    never invent a button. So: the component offers exactly one action slot,
 *    and invents nothing of its own when the caller passes none.
 *  - a silhouette is decoration. Every one of the six must be `aria-hidden`,
 *    or a screen reader announces vellum.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import {
    AxesSilhouette,
    EmptyRegister,
    FoldedLetterSilhouette,
    LetterSlotsSilhouette,
    QuietWeekSilhouette,
    SlipsSilhouette,
    SpineSilhouette,
} from '../components/tabs/EmptyRegister';

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

/** The rendered `.gor-empty` root — every assertion about order is about ITS children. */
const register = (container: HTMLElement) => container.querySelector<HTMLElement>('.gor-empty')!;

/**
 * Every element carrying an INLINE opacity below 1. Inline only, deliberately:
 * jsdom loads no stylesheet, so `getComputedStyle` would report the initial
 * value for everything and quietly pass. What rule 3 actually guards against
 * is a hand-written `style={{ opacity: .5 }}` on a silhouette part, and that
 * is precisely what this sees.
 */
function dimmed(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>('*'))
        .filter(el => el.style.opacity !== '' && Number(el.style.opacity) < 1)
        .map(el => `${el.tagName.toLowerCase()}.${el.className || '(no class)'} @ opacity ${el.style.opacity}`);
}

const SILHOUETTES = [
    ['SpineSilhouette', SpineSilhouette, 'gor-sil-spine'],
    ['SlipsSilhouette', SlipsSilhouette, 'gor-sil-slips'],
    ['QuietWeekSilhouette', QuietWeekSilhouette, 'gor-sil-quiet'],
    ['LetterSlotsSilhouette', LetterSlotsSilhouette, 'gor-sil-slots'],
    ['AxesSilhouette', AxesSilhouette, 'gor-sil-axes'],
    ['FoldedLetterSilhouette', FoldedLetterSilhouette, 'gor-sil-letter'],
] as const;

describe('the shape at rest comes first (D45 rule 2)', () => {
    it('draws the silhouette before the line, not after it', async () => {
        const container = await mount(
            <EmptyRegister silhouette={<SpineSilhouette />} line="Week I · The reign begins" />,
        );
        const children = Array.from(register(container).children);
        expect(children[0].classList.contains('gor-sil-spine')).toBe(true);
        expect(children[1].classList.contains('gor-empty-line')).toBe(true);
    });

    it('still leads with the line where the register has no shape of its own', async () => {
        // ChronicleTab's Fates register and WorldStateTab's pointers both call
        // it this way — the silhouette is optional, the line is not.
        const container = await mount(<EmptyRegister line="No fate has yet cut across your reign." />);
        expect(register(container).children[0].classList.contains('gor-empty-line')).toBe(true);
    });
});

describe('what a zero state may render, and what it may not (D45 rules 1 and 4)', () => {
    it('always renders the line, verbatim', async () => {
        const container = await mount(<EmptyRegister line="No one has told you anything yet." />);
        expect(container.querySelector('.gor-empty-line')?.textContent).toBe('No one has told you anything yet.');
    });

    it('renders the hint only when one is passed', async () => {
        const without = await mount(<EmptyRegister line="You hold nothing over anyone." />);
        expect(without.querySelector('.gor-empty-hint')).toBeNull();

        const with_ = await mount(
            <EmptyRegister line="You hold nothing over anyone." hint="Leverage accumulates from what you learn." />,
        );
        expect(with_.querySelector('.gor-empty-hint')?.textContent).toBe(
            'Leverage accumulates from what you learn.',
        );
    });

    it('renders the action only when one is passed', async () => {
        const without = await mount(<EmptyRegister line="Nothing waits on you." />);
        expect(without.querySelector('[data-action]')).toBeNull();

        const with_ = await mount(
            <EmptyRegister line="Nothing waits on you." action={<button type="button" data-action>Read the week</button>} />,
        );
        expect(with_.querySelectorAll('[data-action]')).toHaveLength(1);
    });

    // Rule 4's teeth: the component must not manufacture an affordance of its
    // own. Every shipped call site today passes no action at all, so the
    // rendered output of a zero state must be inert.
    it('invents no button where the caller offered no affordance', async () => {
        for (const [, Silhouette] of SILHOUETTES) {
            const container = await mount(
                <EmptyRegister silhouette={<Silhouette />} line="A line." hint="A hint." />,
            );
            expect(container.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
        }
    });

    it('offers exactly one action slot, and it is always last', async () => {
        const container = await mount(
            <EmptyRegister
                silhouette={<SpineSilhouette />}
                line="A line."
                hint="A hint."
                action={<button type="button" data-action>The one affordance</button>}
            />,
        );
        const children = Array.from(register(container).children);
        // silhouette, line, hint, action — four rows, no more.
        expect(children).toHaveLength(4);
        expect(children[3].getAttribute('data-action')).not.toBeNull();
        expect(container.querySelectorAll('button')).toHaveLength(1);
    });

    it('adds no row for a slot the caller left empty', async () => {
        const bare = await mount(<EmptyRegister line="A line." />);
        expect(register(bare).children).toHaveLength(1);

        const shaped = await mount(<EmptyRegister silhouette={<SlipsSilhouette />} line="A line." />);
        expect(register(shaped).children).toHaveLength(2);

        const hinted = await mount(<EmptyRegister line="A line." hint="A hint." />);
        expect(register(hinted).children).toHaveLength(2);
    });
});

/**
 * The defect item 27 fixed, and the one this file exists to keep fixed:
 * a dimmed zero state reads as a DISABLED panel, and nothing here is
 * disabled. The dashed rule and the weave carry "unwritten" instead.
 */
describe('nothing is dimmed (D45 rule 3)', () => {
    it('renders no silhouette at reduced opacity', async () => {
        for (const [name, Silhouette] of SILHOUETTES) {
            const container = await mount(<Silhouette />);
            expect(dimmed(container), `${name} is dimmed`).toEqual([]);
        }
    });

    it('renders no part of a full zero state at reduced opacity', async () => {
        for (const [name, Silhouette] of SILHOUETTES) {
            const container = await mount(
                <EmptyRegister
                    silhouette={<Silhouette />}
                    line="No one has told you anything yet."
                    hint="Reports arrive when your agents have something worth carrying."
                    action={<button type="button" data-action>Send an agent</button>}
                />,
            );
            expect(dimmed(container), `the zero state carrying ${name} is dimmed`).toEqual([]);
        }
    });
});

describe('a silhouette is decoration, never an announcement', () => {
    it.each(SILHOUETTES.map(([name, Component, className]) => ({ name, Component, className })))(
        '$name renders and is aria-hidden',
        async ({ Component, className }) => {
            const container = await mount(<Component />);
            const root = container.firstElementChild!;
            expect(root.classList.contains(className)).toBe(true);
            expect(root.getAttribute('aria-hidden')).toBe('true');
        },
    );

    it('stays hidden once mounted inside the register, so only the line is announced', async () => {
        for (const [name, Silhouette, className] of SILHOUETTES) {
            const container = await mount(
                <EmptyRegister silhouette={<Silhouette />} line="A line." />,
            );
            const shape = container.querySelector(`.${className}`)!;
            expect(shape.getAttribute('aria-hidden'), name).toBe('true');
            // Nothing inside a silhouette may be individually announceable
            // either — no nested element may un-hide itself.
            expect(shape.querySelectorAll('[aria-hidden="false"]'), name).toHaveLength(0);
        }
    });
});
