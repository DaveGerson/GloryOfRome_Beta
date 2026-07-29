import { describe, expect, it } from 'vitest';
import { crisisGrade, deriveCrisisGrade } from '../components/crisisGrade';
import { INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import type { SimulationState } from '../types';

const state = (over: Partial<SimulationState> = {}): SimulationState => ({
  ...INITIAL_SIMULATION_STATE,
  major_ongoing_crisis: 'The granaries stand empty.',
  ...over,
});

describe('crisisGrade (audit item 15 — three volumes)', () => {
  it('shows no banner at all when there is no crisis', () => {
    expect(crisisGrade(state({ major_ongoing_crisis: null }))).toBeNull();
  });

  it('grades a calm empire with a crisis as a murmur', () => {
    expect(crisisGrade(state({
      imperial_status: 'Stable', senate_status: 'Functional',
      military_status: 'Loyal', plebeian_mood: 'Uneasy',
    }))).toBe('murmur');
  });

  it('raises to crisis when any single enum reports an emergency', () => {
    expect(crisisGrade(state({ imperial_status: 'Contested' }))).toBe('crisis');
    expect(crisisGrade(state({ military_status: 'Divided' }))).toBe('crisis');
    expect(crisisGrade(state({ plebeian_mood: 'Rioting' }))).toBe('crisis');
    expect(crisisGrade(state({ senate_status: 'Deposed' }))).toBe('crisis');
  });

  it('raises to at_the_door for an empty throne or an army in revolt', () => {
    expect(crisisGrade(state({ imperial_status: 'Vacant' }))).toBe('at_the_door');
    expect(crisisGrade(state({ military_status: 'Rebellious' }))).toBe('at_the_door');
  });

  it('takes the loudest reading across every enum', () => {
    expect(deriveCrisisGrade(state({
      imperial_status: 'Stable', senate_status: 'Deposed',
      military_status: 'Rebellious', plebeian_mood: 'Content',
    }))).toBe('at_the_door');
  });

  // The model's own severity is a floor-raiser, never a mute button: a
  // rebellion the model calls a murmur still reads as at_the_door.
  it('never lets the model quiet a banner the enums say is loud', () => {
    expect(crisisGrade(state({ military_status: 'Rebellious', crisis_severity: 'murmur' })))
      .toBe('at_the_door');
  });

  it('lets the model raise a banner the enums have not caught up to', () => {
    expect(crisisGrade(state({
      imperial_status: 'Stable', senate_status: 'Functional',
      military_status: 'Loyal', plebeian_mood: 'Content',
      crisis_severity: 'at_the_door',
    }))).toBe('at_the_door');
  });

  // Every save written before this pass, and any response that omits the
  // field, must still grade.
  it('grades a state with no crisis_severity at all', () => {
    const legacy = state({ military_status: 'Divided' });
    delete legacy.crisis_severity;
    expect(crisisGrade(legacy)).toBe('crisis');
  });
});
