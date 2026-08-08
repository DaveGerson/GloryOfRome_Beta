import { describe, it, expect } from 'vitest';
import {
  appendFallout,
  clearFallout,
  hasFallout,
  formatFalloutDirective,
  buildInterventionTextWithFallout,
  type FalloutQueue,
} from '../components/investigationLoop';
import { makeInvestigationResult } from './factories';
import type { InvestigationResult } from '../types';

// --- fixtures ----------------------------------------------------------

function makeResult(consequences: string | null, overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return makeInvestigationResult({ consequences, ...overrides });
}

describe('components/investigationLoop.ts', () => {
  describe('hasFallout', () => {
    it('is false for null', () => {
      expect(hasFallout(null)).toBe(false);
    });

    it('is false for undefined', () => {
      expect(hasFallout(undefined)).toBe(false);
    });

    it('is false for an empty string', () => {
      expect(hasFallout('')).toBe(false);
    });

    it('is false for a whitespace-only string', () => {
      expect(hasFallout('   \n\t  ')).toBe(false);
    });

    it('is true for a real, non-blank consequence string', () => {
      expect(hasFallout('Your agent was seen and is now being watched.')).toBe(true);
    });
  });

  describe('appendFallout', () => {
    it('appends the trimmed consequence when present', () => {
      const queue: FalloutQueue = [];
      const next = appendFallout(queue, makeResult('  Was seen leaving the villa.  '));
      expect(next).toEqual(['Was seen leaving the villa.']);
    });

    it('returns the SAME array reference (no-op) when consequences is null', () => {
      const queue: FalloutQueue = ['existing entry'];
      const next = appendFallout(queue, makeResult(null));
      expect(next).toBe(queue);
    });

    it('returns the SAME array reference (no-op) when consequences is blank', () => {
      const queue: FalloutQueue = ['existing entry'];
      const next = appendFallout(queue, makeResult('   '));
      expect(next).toBe(queue);
    });

    it('does not mutate the original queue array', () => {
      const queue: FalloutQueue = ['first'];
      const next = appendFallout(queue, makeResult('second'));
      expect(queue).toEqual(['first']);
      expect(next).toEqual(['first', 'second']);
      expect(next).not.toBe(queue);
    });

    it('accumulates multiple appends in order (repeated investigations before a turn is submitted)', () => {
      let queue: FalloutQueue = [];
      queue = appendFallout(queue, makeResult('An agent was spotted near the Senate.'));
      queue = appendFallout(queue, makeResult(null)); // a clean investigation in between
      queue = appendFallout(queue, makeResult('A bribe was traced back to the player.'));
      expect(queue).toEqual([
        'An agent was spotted near the Senate.',
        'A bribe was traced back to the player.',
      ]);
    });
  });

  describe('clearFallout', () => {
    it('returns an empty queue', () => {
      expect(clearFallout()).toEqual([]);
    });
  });

  describe('formatFalloutDirective', () => {
    it('wraps a consequence as a must-honor GM-intervention directive line', () => {
      expect(formatFalloutDirective('Was seen leaving the villa.')).toBe(
        'INTELLIGENCE FALLOUT (must be reflected this turn): Was seen leaving the villa.'
      );
    });
  });

  describe('buildInterventionTextWithFallout', () => {
    it('returns the GM intervention text unchanged when the fallout queue is empty', () => {
      expect(buildInterventionTextWithFallout([], 'A plague breaks out in the Suburra.')).toBe(
        'A plague breaks out in the Suburra.'
      );
    });

    it('returns an empty string unchanged when there is neither fallout nor GM text', () => {
      expect(buildInterventionTextWithFallout([], '')).toBe('');
    });

    it('renders a single pending consequence as the whole directive when there is no operator GM text', () => {
      const result = buildInterventionTextWithFallout(['Was seen leaving the villa.'], '');
      expect(result).toBe('INTELLIGENCE FALLOUT (must be reflected this turn): Was seen leaving the villa.');
    });

    it('prepends fallout directives (one per queued consequence) ahead of the operator GM text', () => {
      const result = buildInterventionTextWithFallout(
        ['Was seen leaving the villa.', 'A courier intercepted the report.'],
        'Maximinus Thrax should become more aggressive.'
      );
      expect(result).toBe(
        'INTELLIGENCE FALLOUT (must be reflected this turn): Was seen leaving the villa.\n' +
        'INTELLIGENCE FALLOUT (must be reflected this turn): A courier intercepted the report.\n' +
        '\n' +
        'Maximinus Thrax should become more aggressive.'
      );
    });

    it('treats whitespace-only operator GM text the same as empty (no trailing blank directive)', () => {
      const result = buildInterventionTextWithFallout(['Was seen leaving the villa.'], '   ');
      expect(result).toBe('INTELLIGENCE FALLOUT (must be reflected this turn): Was seen leaving the villa.');
    });
  });

  describe('turn-to-turn queue semantics (append / consume-on-success / survive-failure)', () => {
    it('a queued consequence still appears in the built directive across a failed attempt (survives retry)', () => {
      let queue: FalloutQueue = [];
      queue = appendFallout(queue, makeResult('An agent was spotted near the Senate.'));

      // Attempt 1: build the text for the turn about to be sent to runNewTurn.
      const firstAttemptText = buildInterventionTextWithFallout(queue, '');
      expect(firstAttemptText).toContain('An agent was spotted near the Senate.');

      // Attempt 1 fails - per App.tsx's executeTurn catch path, the queue is
      // untouched (clearFallout is only ever called from the success path).
      // Simulate a retry: build again from the SAME (unconsumed) queue.
      const retryText = buildInterventionTextWithFallout(queue, '');
      expect(retryText).toBe(firstAttemptText);
      expect(queue).toEqual(['An agent was spotted near the Senate.']);
    });

    it('the queue is cleared only once the turn that consumed it commits successfully', () => {
      let queue: FalloutQueue = [];
      queue = appendFallout(queue, makeResult('An agent was spotted near the Senate.'));
      expect(queue).toEqual(['An agent was spotted near the Senate.']);

      // Attempt succeeds this time - App.tsx's success path calls clearFallout().
      queue = clearFallout();
      expect(queue).toEqual([]);

      // A subsequent turn with nothing newly queued gets the plain GM text back.
      expect(buildInterventionTextWithFallout(queue, 'A plague breaks out.')).toBe('A plague breaks out.');
    });

    it('a fresh investigation queued after a successful clear starts a new, independent queue', () => {
      let queue: FalloutQueue = appendFallout([], makeResult('First fallout.'));
      expect(queue).toEqual(['First fallout.']);
      queue = clearFallout(); // consumed by a committed turn
      queue = appendFallout(queue, makeResult('Second fallout, unrelated to the first.'));

      expect(queue).toEqual(['Second fallout, unrelated to the first.']);
    });
  });

  describe('chat-notice condition (consequences null vs non-null)', () => {
    it('does not warrant a notice when an investigation came back clean (consequences: null)', () => {
      const result = makeResult(null);
      expect(hasFallout(result.consequences)).toBe(false);
    });

    it('warrants the subtle in-fiction notice when an investigation has a non-null consequence', () => {
      const result = makeResult('One of your agents was seen near the target\'s villa.');
      expect(hasFallout(result.consequences)).toBe(true);
    });
  });
});
