/**
 * @vitest-environment jsdom
 *
 * Screen-reader contracts for the small live and described regions: the
 * streaming narration bubble (kept out of the chat log's announcements), the
 * design system's Tooltip (described-by while shown, Escape to dismiss), the
 * † footnote marker's name, and the glossary term's expanded state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StreamingNarrationBubble } from '../components/Chat';
import { Tooltip } from '../components/ui/Feedback';
import InfoTooltip from '../components/InfoTooltip';
import GlossaryTooltip from '../components/GlossaryTooltip';
import GameMasterScreen from '../components/GameMasterScreen';
import { Textarea } from '../components/ui/Forms';
import { makeWorldState } from './factories';

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

describe('live and described regions', () => {
  it('keeps the streaming narration bubble out of the chat log\'s announcements', async () => {
    const container = await mount(<StreamingNarrationBubble text="The chronicler writes" />);
    const bubble = container.firstElementChild!;
    expect(bubble.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('describes a focused trigger by its tooltip, and Escape dismisses it', async () => {
    const container = await mount(<Tooltip label="The Fates' ledger"><button type="button">GM Log</button></Tooltip>);
    const trigger = container.querySelector('button')!;
    await act(async () => trigger.focus());
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe("The Fates' ledger");
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip!.id);

    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('names the † footnote marker rather than reading out "dagger"', async () => {
    const container = await mount(<InfoTooltip text="Your capacity for espionage." />);
    const marker = container.querySelector('[tabindex="0"]')!;
    expect(marker.getAttribute('role')).toBe('img');
    expect(marker.getAttribute('aria-label')).toBe('Footnote');
  });

  it('exposes the glossary term as an expandable control that Escape closes', async () => {
    const container = await mount(<GlossaryTooltip description="A province of the Empire." wikiLink="">Dacia</GlossaryTooltip>);
    const term = container.querySelector('button')!;
    expect(term.getAttribute('aria-expanded')).toBe('false');
    await act(async () => term.click());
    expect(term.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('A province of the Empire.');
    await act(async () => term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(term.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('A province of the Empire.');
  });

  it('gives the GM directive confirmation a status region that exists before it speaks', async () => {
    const container = await mount(
      <GameMasterScreen
        history={[]} onClose={() => {}} interventionText="" onSetIntervention={() => true}
        playerCharacterId={null} worldState={makeWorldState()} turnNumber={1}
      />,
    );
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    const set = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Set Directive'))!;
    await act(async () => set.click());
    expect(status!.textContent).toContain('The Fates have heard.');
  });

  it('describes a Textarea by its hint, alongside any description the caller passed', async () => {
    const container = await mount(
      <Textarea id="persona" hint="Name, position, and motivations." aria-describedby="elsewhere" aria-label="Persona" />,
    );
    const field = container.querySelector('textarea')!;
    const hint = container.querySelector('.gor-hint')!;
    expect(hint.id).toBe('persona-hint');
    expect(field.getAttribute('aria-describedby')).toBe('elsewhere persona-hint');
  });
});
