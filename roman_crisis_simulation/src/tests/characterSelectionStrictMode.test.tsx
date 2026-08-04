/**
 * @vitest-environment jsdom
 */
import React, { StrictMode, act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import CharacterSelection from '../components/CharacterSelection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function setValue(element: HTMLTextAreaElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  expect(descriptor?.set).toBeTypeOf('function');
  await act(async () => {
    descriptor!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitFor(assertion: () => void, attempts = 50): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(container!.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = Array.from(container!.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.includes(text));
  expect(button, `button containing "${text}"`).toBeDefined();
  return button as HTMLButtonElement;
}

describe('CharacterSelection under React StrictMode', () => {
  it('restores the custom draft after rejection and lets the player retry successfully', async () => {
    const draft = 'A veteran quaestor seeking justice for a disgraced family';
    let attempts = 0;
    let rejectFirstAttempt!: (reason: unknown) => void;
    const firstAttempt = new Promise<void>((_, reject) => {
      rejectFirstAttempt = reject;
    });
    const createCharacter = async () => {
      attempts += 1;
      if (attempts === 1) {
        await firstAttempt;
      }
    };

    function Harness() {
      const [created, setCreated] = useState(false);
      if (created) return <p role="status">Character created</p>;
      return (
        <CharacterSelection
          onSelectCharacter={() => {}}
          onCreateCharacter={async args => {
            await createCharacter();
            expect(args).toEqual({
              description: draft,
              metaNarrative: undefined,
              useCustomGamestate: false,
            });
            setCreated(true);
          }}
        />
      );
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root!.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });

    await click(buttonContaining('Create Your Own'));
    const description = container!.querySelector<HTMLTextAreaElement>(
      '[aria-label="Custom character description"]',
    );
    expect(description).not.toBeNull();
    await setValue(description!, draft);
    await click(buttonNamed('Take your place'));
    expect(container!.textContent).toContain('Consulting the Fates');

    await act(async () => {
      rejectFirstAttempt(new Error('custom provider unavailable'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container!.textContent).toContain('auguries are not in our favor');
    });
    const restoredDescription = container!.querySelector<HTMLTextAreaElement>(
      '[aria-label="Custom character description"]',
    );
    expect(restoredDescription?.value).toBe(draft);
    expect(buttonNamed('Take your place').disabled).toBe(false);

    await click(buttonNamed('Take your place'));
    await waitFor(() => {
      expect(container!.querySelector('[role="status"]')?.textContent).toBe('Character created');
    });
    expect(attempts).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
