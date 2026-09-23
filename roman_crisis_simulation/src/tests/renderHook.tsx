/**
 * tests/renderHook.tsx — a minimal renderHook for the App-extracted hooks
 * (hooks/*.ts). The suite pins jsdom and does not depend on
 * @testing-library/react, so this follows the same createRoot + React.act
 * idiom as tests/useIntelGathering.test.tsx, packaged once.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderedHook<P, R> {
    /** The hook's most recent return value. */
    readonly current: R;
    rerender: (props: P) => void;
    unmount: () => void;
}

export function renderHook<P, R>(useHook: (props: P) => R, initialProps: P): RenderedHook<P, R> {
    let latest: R | undefined;
    const Probe: React.FC<{ hookProps: P }> = ({ hookProps }) => {
        latest = useHook(hookProps);
        return null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(<Probe hookProps={initialProps} />));
    return {
        get current() { return latest as R; },
        rerender: props => act(() => root.render(<Probe hookProps={props} />)),
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}
