/**
 * @vitest-environment jsdom
 *
 * The GM console's Narration and Fixtures panes, at the three places WP-19
 * deliberately left undrawn and this pass filled in: the monologue slip, the
 * "streamed in N chunks" clause, and "Strike the mould again".
 *
 * Each is invisible to a Mock-Mode playthrough for its own reason — mock
 * turns carry no `streamChunks` and no `turnSeed` at all — so the absent
 * states here are pinned rather than eyeballed.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { FixturesView, NarrationView } from '../components/GameMasterScreen';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import type { ActionResolutionEvent, RawCallRecord, TurnHistoryEntry } from '../types';

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

const SEED = 0x5EEDF00D;

function entry(overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return {
    turnNumber: 4,
    playerIntent: 'Address the Senate',
    adjudication: { turn: 4, entityActions: [], deltas: [], headlines: ['The Senate convenes.'], gm_private: [] },
    narration: 'The Senate convenes.',
    ...overrides,
  };
}

function rawCall(callName: string, overrides: Partial<RawCallRecord> = {}): RawCallRecord {
  return {
    callName,
    model: 'gemini-3-pro-preview',
    latencyMs: 120,
    attempts: 1,
    promptChars: 400,
    rawResponse: '{}',
    validated: true,
    ...overrides,
  };
}

function resolutionTrace(roll: number): ActionResolutionEvent {
  return {
    assessment: {
      is_consequential: true,
      action_category: 'oratory',
      relevant_skill: 'oratory',
      difficulty: 12,
      opposing_entity_id: null,
      rationale: 'Addressed the Senate.',
    },
    roll,
    total: roll + 4,
    margin: roll + 4 - 12,
    tier: 'success',
  };
}

/** The Fixtures pane's props, minus the entry each test supplies. */
const fixtureProps = { history: [], sessionCalls: 0, hasTruthLedger: false, hasKnowledge: false, onExport: () => {} };

function kickerBlock(container: HTMLElement, kicker: string): HTMLElement {
  const label = Array.from(container.querySelectorAll('span')).find(node => node.textContent === kicker);
  expect(label, `no "${kicker}" kicker rendered`).toBeTruthy();
  return label!.parentElement as HTMLElement;
}

describe('the Narration pane\'s monologue slip', () => {
  it('renders the turn\'s monologue under the Inner thoughts kicker', async () => {
    const container = await mount(
      <NarrationView entry={entry({ playerMonologue: 'I must tread carefully among the wolves.' })} />);
    expect(kickerBlock(container, 'Inner thoughts').textContent)
      .toContain('I must tread carefully among the wolves.');
  });

  it('names the cause when the entry predates the record', async () => {
    // `playerMonologue` absent entirely — an entry written before the field.
    const container = await mount(<NarrationView entry={entry()} />);
    expect(kickerBlock(container, 'Inner thoughts').textContent)
      .toContain('This turn predates the monologue record.');
  });

  it('distinguishes a turn that composed none from one that predates the record', async () => {
    const container = await mount(<NarrationView entry={entry({ playerMonologue: '' })} />);
    const slip = kickerBlock(container, 'Inner thoughts').textContent ?? '';
    expect(slip).toContain('No monologue was composed this turn.');
    expect(slip).not.toContain('predates');
  });
});

describe('the Narration pane\'s heading', () => {
  it('reads the chunk count off the narration record when the turn streamed', async () => {
    const container = await mount(<NarrationView entry={entry({
      rawCalls: [rawCall('adjudication'), rawCall('narration', { streamChunks: 4 })],
    })} />);
    expect(container.textContent).toContain('Narration — 20 chars · streamed in 4 chunks');
  });

  it('omits the clause entirely rather than reading "0 chunks" when nothing was captured', async () => {
    // A mock turn, a non-streamed narration, or an entry whose rawCalls
    // stripOldRawCalls dropped: all three land here.
    const withoutRecord = await mount(<NarrationView entry={entry()} />);
    expect(withoutRecord.textContent).toContain('Narration — 20 chars');
    expect(withoutRecord.textContent).not.toContain('chunks');

    const unstreamed = await mount(<NarrationView entry={entry({ rawCalls: [rawCall('narration')] })} />);
    expect(unstreamed.textContent).not.toContain('chunks');
  });
});

describe('the Fixtures pane\'s "Strike the mould again"', () => {
  function strikeButton(container: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button'))
      .find(node => node.textContent === 'Strike the mould again');
  }

  it('does not render a control for a turn with no seed — the plaque\'s dash stands alone', async () => {
    const container = await mount(
      <FixturesView entry={entry({ resolutionTrace: resolutionTrace(11) })} {...fixtureProps} />);
    expect(strikeButton(container)).toBeUndefined();
    expect(container.textContent).toContain('—');
  });

  it('does not render a control for a seeded turn that drew no dice, and says why', async () => {
    const container = await mount(<FixturesView entry={entry({ turnSeed: SEED })} {...fixtureProps} />);
    expect(strikeButton(container)).toBeUndefined();
    expect(container.textContent)
      .toContain('This turn drew no dice — there is nothing to strike from the mould.');
  });

  it('strikes a faithful record and reports the mould holding', async () => {
    const recorded = rollD20(createSeededRng(SEED));
    const container = await mount(
      <FixturesView entry={entry({ turnSeed: SEED, resolutionTrace: resolutionTrace(recorded) })} {...fixtureProps} />);

    // The verdict is struck, not standing: nothing is claimed before the press.
    expect(container.textContent).not.toContain('The mould holds');

    const button = strikeButton(container);
    expect(button).toBeTruthy();
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container.textContent)
      .toContain('The mould holds — every roll re-drawn from the seed matches the record.');
    expect(container.textContent).toContain(`→ ${recorded} ✓`);
  });

  it('reports a tampered record as a mould that does not hold, marking the offending draw', async () => {
    const truth = rollD20(createSeededRng(SEED));
    const tampered = truth === 20 ? 1 : truth + 1;
    const container = await mount(
      <FixturesView entry={entry({ turnSeed: SEED, resolutionTrace: resolutionTrace(tampered) })} {...fixtureProps} />);

    const button = strikeButton(container);
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container.textContent)
      .toContain('The mould does not hold — the seed and the record disagree.');
    expect(container.textContent).toContain(`→ ${truth} ✕`);
  });

  it('re-draws only — it never re-runs the turn or reaches for a model', async () => {
    // The pure module has no client to call; the guard here is that pressing
    // the control performs no network work of any kind.
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('Strike the mould again must not issue any call.');
    }) as never);
    const recorded = rollD20(createSeededRng(SEED));
    const container = await mount(
      <FixturesView entry={entry({ turnSeed: SEED, resolutionTrace: resolutionTrace(recorded) })} {...fixtureProps} />);
    await act(async () => { strikeButton(container)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
