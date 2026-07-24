/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import EpilogueScreen from '../components/EpilogueScreen';
import type { GeminiClient } from '../ai/core/geminiService';
import type { Entity } from '../types';

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

function makePlayer(): Entity {
  return {
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    entity_type: 'individual',
    status: 'dead',
    position: 'Emperor',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: 'His reign has ended.',
    short_term_goals: [],
    long_term_ambitions: [],
  };
}

function makeAi(response: string): {
  ai: GeminiClient;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn().mockResolvedValue({ text: response });
  return { ai: { models: { generateContent } }, generateContent };
}

async function renderEpilogue(
  ai: GeminiClient,
  apparentAmbition = 'To restore discipline and secure the frontier.',
): Promise<void> {
  await act(async () => {
    root!.render(
      <EpilogueScreen
        player={makePlayer()}
        causeNarration="He died defending Rome."
        turnHistory={[]}
        eventHistory={[]}
        metaNarrative="Rome watches the frontier."
        inferredAmbition={{ apparent_ambition: apparentAmbition, confidence: 'medium', asOfTurn: 4 }}
        ai={ai}
        isMockMode={false}
      />,
    );
  });
}

describe('EpilogueScreen player-visible mechanics boundary', () => {
  it.each([
    'Outcome tier: critical failure.',
    'The roll total was 7.',
    'The margin was -3 after modifiers.',
    'Fate band — presumed dead.',
  ])('replaces a mechanics-bearing AI epitaph with the static fallback: %s', async poison => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ai, generateContent } = makeAi(poison);

    await renderEpilogue(ai);

    await waitFor(() => {
      expect(container!.textContent).toContain("Severus Alexander's story ends here.");
      expect(container!.textContent).toContain('could not be reached');
    });
    expect(container!.textContent).not.toContain(poison);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: 'gemini-3-pro-preview' });
  });

  it('never sends or renders a mechanics-bearing inferred ambition and uses the static fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const poison = 'Resolution tier: critical failure.';
    const { ai, generateContent } = makeAi('A safe model epitaph.');

    await renderEpilogue(ai, poison);

    await waitFor(() => {
      expect(container!.textContent).toContain("Severus Alexander's story ends here.");
      expect(container!.textContent).toContain('Never became clear, even in hindsight.');
    });
    expect(container!.textContent).not.toContain(poison);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('preserves the pro-model epilogue route and ambition display for safe text', async () => {
    const safeEpitaph = 'He held the frontier until Rome could hold it without him.';
    const safeAmbition = 'To restore discipline and secure the frontier.';
    const { ai, generateContent } = makeAi(safeEpitaph);

    await renderEpilogue(ai, safeAmbition);

    await waitFor(() => expect(container!.textContent).toContain(safeEpitaph));
    expect(container!.textContent).toContain(safeAmbition);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: 'gemini-3-pro-preview' });
  });
});
