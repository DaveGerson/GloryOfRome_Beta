/**
 * @vitest-environment jsdom
 *
 * components/tabs/CurrentEventsTab.tsx - a question put to an occurrence
 * that comes back with nothing must say so in the slip, and must not escape
 * as an unhandled rejection (the button fires `void ask(...)`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import CurrentEventsTab from '../components/tabs/CurrentEventsTab';
import type { RunDomainMutation } from '../state/domainMutation';
import { makeEntity } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  localStorage.clear();
});

async function mount(runDomainMutation: RunDomainMutation, onFinding = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(
    <CurrentEventsTab
      events={['The grain fleet is late at Ostia.']}
      week={3}
      playerEntity={makeEntity()}
      allEntities={[]}
      knowledge={[]}
      ai={{} as GoogleGenAI}
      isMockMode
      onFinding={onFinding}
      runDomainMutation={runDomainMutation}
    />,
  ));
  return container;
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

describe('CurrentEventsTab', () => {
  it('shows a refusal in the slip when the question fails, and clears it on the next attempt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let fail = true;
    const runDomainMutation: RunDomainMutation = async work => {
      if (fail) throw new Error('the Fates are unreachable');
      return { acquired: true, value: await work({ isCurrent: () => true }) };
    };
    const container = await mount(runDomainMutation);

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    await act(async () => buttonNamed(container, 'Who gains?').click());
    expect(container.textContent).toContain('Your agents return empty-handed');
    expect(buttonNamed(container, 'Who gains?').disabled).toBe(false);

    fail = false;
    await act(async () => buttonNamed(container, 'Who gains?').click());
    expect(container.textContent).not.toContain('Your agents return empty-handed');

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
