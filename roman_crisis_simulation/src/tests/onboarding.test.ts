/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen } from '../persistence/onboarding';
import { deriveStarterActions, STARTER_ACTION_COUNT, type StarterActionSource } from '../components/starterActions';

describe('persistence/onboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reports unseen before anything has been marked', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it('round-trips: marking as seen makes it stick', () => {
    expect(hasSeenOnboarding()).toBe(false);
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it('markOnboardingSeen is idempotent - calling it repeatedly is harmless', () => {
    markOnboardingSeen();
    markOnboardingSeen();
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it('never throws and reads as unseen when localStorage.getItem throws (e.g. private mode SecurityError)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });

    expect(() => hasSeenOnboarding()).not.toThrow();
    expect(hasSeenOnboarding()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => markOnboardingSeen()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('components/starterActions', () => {
  function make(overrides: Partial<StarterActionSource> = {}): StarterActionSource {
    return {
      short_term_goals: [],
      long_term_ambitions: [],
      position: undefined,
      ...overrides,
    };
  }

  it('always returns exactly STARTER_ACTION_COUNT (3) actions', () => {
    expect(STARTER_ACTION_COUNT).toBe(3);
    expect(deriveStarterActions(make())).toHaveLength(3);
    expect(
      deriveStarterActions(make({ short_term_goals: ['Secure the Rhine legions'] }))
    ).toHaveLength(3);
    expect(
      deriveStarterActions(
        make({
          short_term_goals: ['Goal one', 'Goal two', 'Goal three'],
          long_term_ambitions: ['Ambition one', 'Ambition two'],
        })
      )
    ).toHaveLength(3);
  });

  it('every returned action is a non-empty, trimmed string', () => {
    const cases: StarterActionSource[] = [
      make(),
      make({ position: 'Emperor' }),
      make({ short_term_goals: ['Secure the Rhine legions', 'Appease the mob'] }),
      make({
        short_term_goals: ['Maintain Senate support'],
        long_term_ambitions: ['Survive and secure his dynasty'],
        position: 'Emperor',
      }),
    ];
    for (const entity of cases) {
      for (const action of deriveStarterActions(entity)) {
        expect(typeof action).toBe('string');
        expect(action.trim().length).toBeGreaterThan(0);
        expect(action).toBe(action.trim());
      }
    }
  });

  it('derives actions from short_term_goals when present', () => {
    const actions = deriveStarterActions(
      make({ short_term_goals: ['Secure the Rhine legions'] })
    );
    expect(actions.some(a => a.toLowerCase().includes('secure the rhine legions'))).toBe(true);
  });

  it('prefers short_term_goals over long_term_ambitions, then falls through to ambitions', () => {
    const actions = deriveStarterActions(
      make({
        short_term_goals: ['Maintain Senate support', 'Appease the military'],
        long_term_ambitions: ['Survive and secure his dynasty'],
      })
    );
    expect(actions).toHaveLength(3);
    expect(actions.some(a => a.toLowerCase().includes('maintain senate support'))).toBe(true);
    expect(actions.some(a => a.toLowerCase().includes('appease the military'))).toBe(true);
    expect(actions.some(a => a.toLowerCase().includes('survive and secure his dynasty'))).toBe(true);
  });

  it('falls back gracefully to generic actions when goals and ambitions are both empty', () => {
    const withGoals = deriveStarterActions(
      make({ short_term_goals: ['Profit from the current instability'] })
    );
    const withoutGoals = deriveStarterActions(make());

    expect(withoutGoals).toHaveLength(3);
    withoutGoals.forEach(action => expect(action.trim().length).toBeGreaterThan(0));
    // The sparse case shouldn't just coincidentally reproduce the
    // goal-derived case's suggestions.
    expect(withoutGoals).not.toEqual(withGoals);
  });

  it('uses the entity position to fill a slot when goals/ambitions are sparse', () => {
    const actions = deriveStarterActions(make({ position: 'Informant Broker' }));
    expect(actions).toHaveLength(3);
    expect(actions.some(a => a.toLowerCase().includes('informant broker'))).toBe(true);
  });

  it('is a pure function - identical input yields identical output', () => {
    const entity = make({
      short_term_goals: ['Organize senatorial opposition to Maximinus'],
      long_term_ambitions: ['Become Princeps Senatus'],
      position: 'Senior Senator',
    });
    expect(deriveStarterActions(entity)).toEqual(deriveStarterActions(entity));
  });

  it('is deterministic for a fully sparse (no goals, no ambitions, no position) character', () => {
    const a = deriveStarterActions(make());
    const b = deriveStarterActions(make());
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it('handles blank/whitespace-only goal strings without producing blank actions', () => {
    const actions = deriveStarterActions(
      make({ short_term_goals: ['   ', '', 'Secure allies within the city'] })
    );
    expect(actions).toHaveLength(3);
    actions.forEach(action => expect(action.trim().length).toBeGreaterThan(0));
    expect(actions.some(a => a.toLowerCase().includes('secure allies within the city'))).toBe(true);
  });
});
