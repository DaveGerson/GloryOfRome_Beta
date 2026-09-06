/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import EpilogueScreen from '../components/EpilogueScreen';
import type { GeminiClient } from '../ai/core/geminiService';
import type { Entity, TurnHistoryEntry } from '../types';

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
  legacyPrivateInputs: {
    inferredAmbition: {
      apparent_ambition: string;
      confidence: 'low' | 'medium' | 'high';
      asOfTurn: number;
    } | null;
    mortalityOutcomeSummary?: string;
  } = { inferredAmbition: null },
  publicHeadline?: string,
): Promise<void> {
  const turnHistory = publicHeadline
    ? [{
        turnNumber: 4,
        playerIntent: 'Defend the frontier.',
        adjudication: { headlines: [publicHeadline] },
      } as unknown as TurnHistoryEntry]
    : [];
  await act(async () => {
    root!.render(
      <EpilogueScreen
        player={makePlayer()}
        causeNarration="He died defending Rome."
        turnHistory={turnHistory}
        eventHistory={[]}
        metaNarrative="Rome watches the frontier."
        ai={ai}
        isMockMode={false}
        {...legacyPrivateInputs}
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
    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.8-flash' });
  });

  it('never sends or renders the GM-only inferred ambition while preserving public epilogue context', async () => {
    const ambitionPoison = 'GM_AMBITION_POISON: seize the purple in secret.';
    const publicHeadline = 'PUBLIC_HEADLINE: The Rhine frontier held.';
    const safeEpitaph = 'He held the frontier until Rome could hold it without him.';
    const { ai, generateContent } = makeAi(safeEpitaph);

    await renderEpilogue(ai, {
      inferredAmbition: {
        apparent_ambition: ambitionPoison,
        confidence: 'high',
        asOfTurn: 4,
      },
    }, publicHeadline);

    await waitFor(() => expect(container!.textContent).toContain(safeEpitaph));
    const request = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(request).toContain('He died defending Rome.');
    expect(request).toContain(publicHeadline);
    expect(request).not.toContain(ambitionPoison);
    expect(container!.textContent).not.toContain(ambitionPoison);
    expect(container!.textContent).not.toContain('Apparent ambition:');
    expect(container!.textContent).toContain(publicHeadline);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('never sends or renders the GM-only mortality outcome summary while preserving cause narration', async () => {
    const mortalityPoison = 'GM_MORTALITY_SUMMARY_POISON: internal death directive.';
    const safeEpitaph = 'He held the frontier until Rome could hold it without him.';
    const { ai, generateContent } = makeAi(safeEpitaph);

    await renderEpilogue(ai, {
      inferredAmbition: null,
      mortalityOutcomeSummary: mortalityPoison,
    });

    await waitFor(() => expect(container!.textContent).toContain(safeEpitaph));
    const request = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(request).toContain('He died defending Rome.');
    expect(request).not.toContain(mortalityPoison);
    expect(container!.textContent).not.toContain(mortalityPoison);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.8-flash' });
  });
});
