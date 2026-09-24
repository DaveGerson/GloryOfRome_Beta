/**
 * @vitest-environment jsdom
 *
 * tests/lazyScreens.test.tsx — app/lazyScreens.tsx's lazyScreen(): the
 * React.lazy boundary App uses for GameMasterScreen, EpilogueScreen,
 * SettingsMenu and OnboardingOverlay. Pinned with a hand-driven loader so
 * each path (preloaded, opened-before-loaded, failed preload) is exercised
 * deterministically.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { lazyScreen, whenLazyScreensReady } from '../app/lazyScreens';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = { label: string };

/** A screen that counts its own mounts and keeps a little local state. */
function makeScreen() {
    const mounts = vi.fn();
    const Screen: React.FC<Props> = ({ label }) => {
        const [clicks, setClicks] = useState(0);
        useEffect(() => { mounts(); }, []);
        return <button onClick={() => setClicks(c => c + 1)}>{label}:{clicks}</button>;
    };
    return { Screen, mounts };
}

function manualLoader<T>() {
    const calls: Array<{ resolve: (value: T) => void; reject: (error: unknown) => void }> = [];
    const load = vi.fn(() => new Promise<T>((resolve, reject) => { calls.push({ resolve, reject }); }));
    return { load, calls };
}

const roots: Array<{ root: Root; container: HTMLElement }> = [];
function mount(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    act(() => root.render(element));
    return { container, render: (next: React.ReactElement) => act(() => root.render(next)) };
}

afterEach(() => {
    for (const { root, container } of roots.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
});

describe('lazyScreen', () => {
    it('a preloaded screen renders on its first frame, with no Suspense round-trip', async () => {
        const { Screen } = makeScreen();
        const { load, calls } = manualLoader<{ default: React.FC<Props> }>();
        const Lazy = lazyScreen(load);
        const ready = Lazy.preload();
        calls[0].resolve({ default: Screen });
        await ready;
        const { container } = mount(<Lazy label="ledger" />);
        expect(container.textContent).toBe('ledger:0');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('a screen opened before its module arrives renders once the load resolves', async () => {
        const { Screen } = makeScreen();
        const { load, calls } = manualLoader<{ default: React.FC<Props> }>();
        const Lazy = lazyScreen(load);
        const { container } = mount(<Lazy label="epilogue" />);
        expect(container.textContent).toBe('');
        await act(async () => { calls[0].resolve({ default: Screen }); });
        expect(container.textContent).toBe('epilogue:0');
        // The lazy path and preload() share one request.
        await Lazy.preload();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('never remounts an open screen when its module lands mid-session', async () => {
        const { Screen, mounts } = makeScreen();
        const { load, calls } = manualLoader<{ default: React.FC<Props> }>();
        const Lazy = lazyScreen(load);
        const view = mount(<Lazy label="gm" />);
        await act(async () => { calls[0].resolve({ default: Screen }); });
        act(() => view.container.querySelector('button')!.click());
        expect(view.container.textContent).toBe('gm:1');
        // A later render (new props) keeps the same instance and its state.
        view.render(<Lazy label="gm!" />);
        expect(view.container.textContent).toBe('gm!:1');
        expect(mounts).toHaveBeenCalledTimes(1);
    });

    it('a failed preload is forgotten, so opening the screen requests it again', async () => {
        const { Screen } = makeScreen();
        const { load, calls } = manualLoader<{ default: React.FC<Props> }>();
        const Lazy = lazyScreen(load);
        const failed = Lazy.preload();
        calls[0].reject(new Error('offline'));
        await expect(failed).rejects.toThrow('offline');
        const { container } = mount(<Lazy label="settings" />);
        expect(load).toHaveBeenCalledTimes(2);
        await act(async () => { calls[1].resolve({ default: Screen }); });
        expect(container.textContent).toBe('settings:0');
    });
});

describe('whenLazyScreensReady', () => {
    it("resolves once App's four lazy screens have loaded", async () => {
        await expect(whenLazyScreensReady()).resolves.toBeUndefined();
    });
});
