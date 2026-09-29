/**
 * @vitest-environment jsdom
 *
 * Batch 3 (Q4) RED characterization suite for `useIntelGathering` — the
 * async intel core the spec extracts from `EntityDetails` in
 * DramatisPersonaeTab.tsx. The hook does NOT exist yet: this file MUST fail
 * on the unresolved import until the extraction lands, and every expectation
 * below is derived from what the CURRENT inline implementation actually
 * does (uncoveredIntel/loadingState/requestError/mountedRef + the
 * handleRequest closure threading mountedRef && transaction.isCurrent()
 * into a DomainMutationContext).
 *
 * Contract under test (spec, Batch 3):
 *   input  { entity, playerEntity, knowledge, ai, isMockMode,
 *            interactionLocked, runDomainMutation, onSpendDeepAnalysis,
 *            onInvestigationOutcome }
 *   output { loadingState, requestError, handleRequest, landed }
 *
 * The perception audit retired `uncoveredIntel` (D14: the ephemeral
 * component-local intel state is retired): the hook keeps no copy of what
 * was bought - every finding, the deep analysis included, reaches the
 * knowledge store through its commit callback and renders from there. What
 * it reports instead is `landed`, the aspect whose paid finding last
 * committed (the card moves focus to it).
 *
 * Environment note: the whole suite pins `jsdom` (happy-dom is not a
 * dependency of this project), so this file follows the suite's idiom —
 * createRoot + React.act under jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { useIntelGathering } from '../components/tabs/useIntelGathering';
import { makeEntity } from './factories';
import type { KnowledgeClaim } from '../knowledge/store';
import type { Entity, InvestigationResult } from '../types';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RequestType = 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis';
type Landed = { type: RequestType; seq: number } | null;

type HookInput = {
  entity: Entity;
  playerEntity: Entity;
  knowledge: KnowledgeClaim[];
  ai: GoogleGenAI;
  isMockMode: boolean;
  interactionLocked?: boolean;
  runDomainMutation: RunDomainMutation;
  onSpendDeepAnalysis: (targetId: string, cost: number, analysis: string, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  onInvestigationOutcome: (
    kind: 'beliefs' | 'scheme' | 'secrets',
    targetId: string,
    reportData: unknown,
    cost: number,
    result: InvestigationResult,
    request: DomainMutationContext,
  ) => boolean | void | Promise<boolean | void>;
};

type HookResult = {
  loadingState: RequestType | null;
  requestError: string | null;
  handleRequest: (type: RequestType) => Promise<void>;
  landed: Landed;
};

// ---------------------------------------------------------------------------
// Fixtures — factories vocabulary plus the exact strings the mock AI layer
// produces (ai/mocks.ts) when resolveIntelRequest runs with isMockMode: true
// and its always-true isRisky flag.
// ---------------------------------------------------------------------------
const target = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });

function makePlayer(resources: Record<string, number>): Entity {
  return makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', resources });
}

const RISKY_CONSEQUENCE =
  "One of your agents was seen near the target's villa and is now being watched, reducing their effectiveness.";
const MOCK_BELIEFS_DISPLAY = [
  '(Mock) Believes the army is the only true power in Rome.',
  '(Mock) Thinks honor is for fools.',
];
const MOCK_SECRETS_DISPLAY = [
  '(Mock) Is secretly illiterate.',
  '(Mock) Fears assassination from his own men.',
];
const MOCK_SCHEME_CLUES = [
  '(Mock) Coded letters keep passing to the frontier garrisons.',
  '(Mock) Coin is quietly moving toward the legions, not the treasury.',
];
const MOCK_BELIEFS_REPORT =
  "We've uncovered some of Maximinus Thrax's core beliefs. They seem to be a military pragmatist.";
const MOCK_SECRETS_REPORT =
  'Our spy discovered that Maximinus Thrax harbors deep-seated fears and hides a surprising vulnerability.';
const MOCK_DEEP_ANALYSIS =
  '(Mock Analysis) Our agents report that Maximinus Thrax has been meeting secretly with members of the military. Their stated goals likely hide a more sinister ambition. They pose a moderate threat, but have limited resources for now.';
const USER_FACING_ERROR = 'The intelligence request could not be completed. Please try again.';
const CONSOLE_ERROR_PREFIX = 'Error resolving intelligence request:';

const liveMutation: RunDomainMutation = async work => ({
  acquired: true,
  value: await work({ isCurrent: () => true }),
});

function wire(overrides: Partial<HookInput> = {}): HookInput {
  return {
    entity: target,
    playerEntity: makePlayer({ investigations: 3, deep_analyses: 2 }),
    knowledge: [],
    ai: {} as GoogleGenAI,
    isMockMode: true,
    runDomainMutation: liveMutation,
    onSpendDeepAnalysis: () => {},
    onInvestigationOutcome: () => {},
    ...overrides,
  };
}

function makeGate() {
  let release!: (committed: boolean | void) => void;
  let fail!: (error: unknown) => void;
  const gate = new Promise<boolean | void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { gate, release, fail };
}

const anyContext = () => expect.objectContaining({ isCurrent: expect.any(Function) });

type Captured = { current: HookResult | null };

const Probe: React.FC<{ input: HookInput; capturedRef: Captured }> = ({ input, capturedRef }) => {
  const result = useIntelGathering(input);
  React.useEffect(() => {
    capturedRef.current = result;
  });
  return (
    <div>
      <span data-testid="loading">{result.loadingState ?? 'idle'}</span>
      <span data-testid="error">{result.requestError ?? ''}</span>
      <span data-testid="landed">{JSON.stringify(result.landed)}</span>
    </div>
  );
};

describe('components/tabs/useIntelGathering — extracted intel async core', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rootMounted: boolean;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    rootMounted = true;
  });

  afterEach(async () => {
    if (rootMounted) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    vi.restoreAllMocks();
  });

  const readout = (id: 'loading' | 'error' | 'landed'): string =>
    container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

  async function mountProbe(input: HookInput): Promise<Captured> {
    const captured: Captured = { current: null };
    await act(async () => {
      root.render(<Probe input={input} capturedRef={captured} />);
    });
    return captured;
  }

  /** Fires handleRequest and flushes microtasks + one macrotask, mirroring the suite's async-settling idiom. */
  async function fire(captured: Captured, type: RequestType): Promise<void> {
    await act(async () => {
      void captured.current!.handleRequest(type);
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  async function settle(action?: () => void): Promise<void> {
    await act(async () => {
      action?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  // -------------------------------------------------------------------------
  // loadingState lifecycle
  // -------------------------------------------------------------------------
  it.each(['beliefs', 'secrets', 'scheme', 'deep_analysis'] as const)(
    'holds loadingState at "%s" while the commit callback is pending, then clears it in the finally once the request settles current',
    async type => {
      const { gate, release } = makeGate();
      const captured = await mountProbe(
        wire(
          type === 'deep_analysis'
            ? { onSpendDeepAnalysis: () => gate }
            : { onInvestigationOutcome: () => gate },
        ),
      );

      await fire(captured, type);
      expect(readout('loading')).toBe(type);

      await settle(() => release(true));
      expect(readout('loading')).toBe('idle');
    },
  );

  it('does NOT clear loadingState in the finally when the transaction lease went stale mid-request, and stores nothing', async () => {
    let transactionCurrent = true;
    const staleableMutation: RunDomainMutation = async work => ({
      acquired: true,
      value: await work({ isCurrent: () => transactionCurrent }),
    });
    const { gate, release } = makeGate();
    const captured = await mountProbe(
      wire({ runDomainMutation: staleableMutation, onInvestigationOutcome: () => gate }),
    );

    await fire(captured, 'secrets');
    expect(readout('loading')).toBe('secrets');

    transactionCurrent = false;
    await settle(() => release(true));

    // request.isCurrent() is false at every write guard, so neither the
    // landing nor the loading reset may be recorded.
    expect(readout('loading')).toBe('secrets');
    expect(readout('landed')).toBe('null');
  });

  // -------------------------------------------------------------------------
  // requestError
  // -------------------------------------------------------------------------
  it('sets the exact user-facing message on rejection (logging the internal error) and clears it at the start of the next request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gate, release } = makeGate();
    const onInvestigationOutcome = vi
      .fn<HookInput['onInvestigationOutcome']>()
      .mockRejectedValueOnce(new Error('the augurs are silent'))
      .mockImplementation(() => gate);
    const captured = await mountProbe(wire({ onInvestigationOutcome }));

    await fire(captured, 'secrets');
    expect(readout('error')).toBe(USER_FACING_ERROR);
    // The finally ran while still current, so the spinner is gone even on failure.
    expect(readout('loading')).toBe('idle');
    expect(readout('landed')).toBe('null');
    expect(consoleError).toHaveBeenCalledWith(CONSOLE_ERROR_PREFIX, expect.any(Error));

    // Next request clears the error BEFORE resolving — observable mid-flight.
    await fire(captured, 'secrets');
    expect(readout('error')).toBe('');
    expect(readout('loading')).toBe('secrets');

    await settle(() => release(true));
    expect(readout('error')).toBe('');
    expect(JSON.parse(readout('landed'))).toEqual({ type: 'secrets', seq: 1 });
  });

  // -------------------------------------------------------------------------
  // Commits and landings - nothing bought is held in the hook itself
  // -------------------------------------------------------------------------
  it('charged deep_analysis: hands the target, cost AND the analysis to one commit callback, then records the landing', async () => {
    const onSpendDeepAnalysis = vi.fn<HookInput['onSpendDeepAnalysis']>(() => {});
    const captured = await mountProbe(wire({ onSpendDeepAnalysis }));

    await fire(captured, 'deep_analysis');

    expect(onSpendDeepAnalysis).toHaveBeenCalledTimes(1);
    // The spend and the assessment travel together, so the commit that
    // charges the rare resource is the commit that keeps what it bought.
    expect(onSpendDeepAnalysis).toHaveBeenCalledWith('maximinus_thrax', 1, MOCK_DEEP_ANALYSIS, anyContext());
    expect(JSON.parse(readout('landed'))).toEqual({ type: 'deep_analysis', seq: 1 });
    expect(readout('loading')).toBe('idle');
    expect(readout('error')).toBe('');
  });

  it('uncharged deep_analysis (empty balance): no spend callback, nothing stored, no error', async () => {
    const onSpendDeepAnalysis = vi.fn<HookInput['onSpendDeepAnalysis']>(() => {});
    const captured = await mountProbe(
      wire({ playerEntity: makePlayer({ investigations: 3, deep_analyses: 0 }), onSpendDeepAnalysis }),
    );

    await fire(captured, 'deep_analysis');

    expect(onSpendDeepAnalysis).not.toHaveBeenCalled();
    expect(readout('landed')).toBe('null');
    expect(readout('loading')).toBe('idle');
    expect(readout('error')).toBe('');
  });

  it('beliefs then secrets: each commit carries its itemised findings to the store callback, and each lands in turn', async () => {
    const onInvestigationOutcome = vi.fn<HookInput['onInvestigationOutcome']>(() => {});
    const captured = await mountProbe(wire({ onInvestigationOutcome }));

    await fire(captured, 'beliefs');
    expect(JSON.parse(readout('landed'))).toEqual({ type: 'beliefs', seq: 1 });

    await fire(captured, 'secrets');
    expect(JSON.parse(readout('landed'))).toEqual({ type: 'secrets', seq: 2 });

    expect(onInvestigationOutcome).toHaveBeenNthCalledWith(
      1,
      'beliefs',
      'maximinus_thrax',
      MOCK_BELIEFS_DISPLAY,
      1,
      { target_id: 'maximinus_thrax', report: MOCK_BELIEFS_REPORT, consequences: RISKY_CONSEQUENCE },
      anyContext(),
    );
    expect(onInvestigationOutcome).toHaveBeenNthCalledWith(
      2,
      'secrets',
      'maximinus_thrax',
      MOCK_SECRETS_DISPLAY,
      1,
      { target_id: 'maximinus_thrax', report: MOCK_SECRETS_REPORT, consequences: RISKY_CONSEQUENCE },
      anyContext(),
    );
  });

  it('charged scheme: the outcome callback fires with the clue payload, and the clue lands', async () => {
    const onInvestigationOutcome = vi.fn<HookInput['onInvestigationOutcome']>(() => {});
    const captured = await mountProbe(wire({ onInvestigationOutcome }));

    await fire(captured, 'scheme');

    expect(onInvestigationOutcome).toHaveBeenCalledTimes(1);
    expect(onInvestigationOutcome).toHaveBeenCalledWith(
      'scheme',
      'maximinus_thrax',
      MOCK_SCHEME_CLUES,
      1,
      expect.objectContaining({ target_id: 'maximinus_thrax', consequences: RISKY_CONSEQUENCE }),
      anyContext(),
    );
    expect(JSON.parse(readout('landed'))).toEqual({ type: 'scheme', seq: 1 });
    expect(readout('loading')).toBe('idle');
  });

  it('a commit callback returning false vetoes the landing for both an investigation and a deep analysis', async () => {
    const captured = await mountProbe(
      wire({ onInvestigationOutcome: () => false, onSpendDeepAnalysis: () => false }),
    );

    await fire(captured, 'secrets');
    expect(readout('landed')).toBe('null');

    await fire(captured, 'deep_analysis');
    expect(readout('landed')).toBe('null');
    expect(readout('loading')).toBe('idle');
    expect(readout('error')).toBe('');
  });

  it('uncharged investigation (no investigations left): the outcome callback never fires and nothing is stored', async () => {
    const onInvestigationOutcome = vi.fn<HookInput['onInvestigationOutcome']>(() => {});
    const captured = await mountProbe(
      wire({ playerEntity: makePlayer({ investigations: 0, deep_analyses: 2 }), onInvestigationOutcome }),
    );

    await fire(captured, 'secrets');

    expect(onInvestigationOutcome).not.toHaveBeenCalled();
    expect(readout('landed')).toBe('null');
    expect(readout('loading')).toBe('idle');
    expect(readout('error')).toBe('');
  });

  // -------------------------------------------------------------------------
  // Liveness — the risk center: mountedRef && transaction.isCurrent()
  // composed into the DomainMutationContext handed to every commit callback.
  // -------------------------------------------------------------------------
  it('unmount mid-request invalidates the lease, and settlement after unmount neither logs the failure nor writes state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gate, fail } = makeGate();
    let capturedRequest: DomainMutationContext | undefined;
    const onInvestigationOutcome = vi.fn<HookInput['onInvestigationOutcome']>(
      (_kind, _targetId, _reportData, _cost, _result, request) => {
        capturedRequest = request;
        return gate;
      },
    );
    const captured = await mountProbe(wire({ onInvestigationOutcome }));

    await fire(captured, 'secrets');
    expect(readout('loading')).toBe('secrets');
    expect(capturedRequest?.isCurrent()).toBe(true);

    await act(async () => {
      root.unmount();
    });
    rootMounted = false;
    expect(capturedRequest?.isCurrent()).toBe(false);

    // The in-flight request now rejects. The catch is gated on mountedRef:
    // no console.error, no requestError write; the finally is gated on the
    // composed lease: no loadingState write either.
    await act(async () => {
      fail(new Error('rejected after unmount'));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const intelFailureLogs = consoleError.mock.calls.filter(call => call[0] === CONSOLE_ERROR_PREFIX);
    expect(intelFailureLogs).toHaveLength(0);
  });

  it('a transaction that is already stale returns before ANY write: the prior requestError survives and no callback fires', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let transactionCurrent = true;
    const staleableMutation: RunDomainMutation = async work => ({
      acquired: true,
      value: await work({ isCurrent: () => transactionCurrent }),
    });
    const onInvestigationOutcome = vi
      .fn<HookInput['onInvestigationOutcome']>()
      .mockRejectedValueOnce(new Error('seed the error banner'))
      .mockImplementation(() => {});
    const captured = await mountProbe(
      wire({ runDomainMutation: staleableMutation, onInvestigationOutcome }),
    );

    await fire(captured, 'secrets');
    expect(readout('error')).toBe(USER_FACING_ERROR);
    expect(onInvestigationOutcome).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(CONSOLE_ERROR_PREFIX, expect.any(Error));

    // Now the App lease is stale before the request even starts: the early
    // return fires before setRequestError(null) and setLoadingState(type).
    transactionCurrent = false;
    await fire(captured, 'secrets');

    expect(readout('error')).toBe(USER_FACING_ERROR);
    expect(readout('loading')).toBe('idle');
    expect(readout('landed')).toBe('null');
    expect(onInvestigationOutcome).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // interactionLocked
  // -------------------------------------------------------------------------
  it('handleRequest is a no-op while interaction is locked: the domain mutation is never even entered', async () => {
    // vitest's Mock<T> collapses RunDomainMutation's generic to `unknown`, so a
    // typed passthrough carries the generic while a bare spy counts entries.
    const domainMutationEntered = vi.fn();
    const runDomainMutation: RunDomainMutation = async (work, options) => {
      domainMutationEntered();
      return liveMutation(work, options);
    };
    const onInvestigationOutcome = vi.fn<HookInput['onInvestigationOutcome']>(() => {});
    const onSpendDeepAnalysis = vi.fn<HookInput['onSpendDeepAnalysis']>(() => {});
    const captured = await mountProbe(
      wire({ interactionLocked: true, runDomainMutation, onInvestigationOutcome, onSpendDeepAnalysis }),
    );

    await fire(captured, 'secrets');
    await fire(captured, 'deep_analysis');

    expect(domainMutationEntered).not.toHaveBeenCalled();
    expect(onInvestigationOutcome).not.toHaveBeenCalled();
    expect(onSpendDeepAnalysis).not.toHaveBeenCalled();
    expect(readout('loading')).toBe('idle');
    expect(readout('error')).toBe('');
    expect(readout('landed')).toBe('null');
  });
});
