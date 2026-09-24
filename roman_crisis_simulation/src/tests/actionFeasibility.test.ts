/**
 * tests/actionFeasibility.test.ts
 *
 * Tests for generalized resource feasibility enforcement:
 * - Processing whether or not resources are required for an activity
 * - Including activities when agents possess required resources (or when resource-free)
 * - Excluding activities when agents lack required resources
 * - Replacing infeasible suggestions with tailored or resource-free alternatives
 * - Ensuring characters like Maximinus Thrax and Lycinia Stolo receive appropriate actions
 * - Mock mode parity for Maximinus Thrax and broke players
 */

import { describe, it, expect } from 'vitest';
import {
  filterFeasibleSuggestedActions,
  isActivityFeasible,
  getActivityResourceRequirement,
  FINANCIAL_ACTION_REGEX,
  MILITARY_ACTION_REGEX,
  ESPIONAGE_ACTION_REGEX,
  SENATORIAL_ACTION_REGEX,
} from '../ai/core/actionFeasibility';
import { makeEntity } from './factories';
import { mockRunNewTurn } from '../ai/mocks';
import { ALL_INITIAL_ENTITIES, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import { getMockInitialState } from './mockData';
import { TurnSubmission } from '../types';

describe('actionFeasibility: getActivityResourceRequirement', () => {
  it('identifies financial activities and their required keys', () => {
    const req = getActivityResourceRequirement('Try to bribe the Praetorians');
    expect(req).not.toBeNull();
    expect(req?.category).toBe('financial');
    expect(req?.requiredResourceKeys).toContain('denarii');
  });

  it('identifies military command activities and their required keys', () => {
    const req = getActivityResourceRequirement('Order the legions to march on Rome');
    expect(req).not.toBeNull();
    expect(req?.category).toBe('military');
    expect(req?.requiredResourceKeys).toContain('legion_support');
  });

  it('identifies espionage activities and their required keys', () => {
    const req = getActivityResourceRequirement('Deploy an informant network in the Palatine');
    expect(req).not.toBeNull();
    expect(req?.category).toBe('espionage');
    expect(req?.requiredResourceKeys).toContain('investigations');
  });

  it('identifies senatorial decree activities and their required keys', () => {
    const req = getActivityResourceRequirement('Convene the Senate to pass a senatorial decree declaring Thrax an enemy');
    expect(req).not.toBeNull();
    expect(req?.category).toBe('senatorial');
    expect(req?.requiredResourceKeys).toContain('senatorial_support');
  });

  it('detects espionage and senatorial patterns via regex constants', () => {
    expect(ESPIONAGE_ACTION_REGEX.test('Deploy an informant network')).toBe(true);
    expect(ESPIONAGE_ACTION_REGEX.test('Commission a deep analysis of the Senate')).toBe(true);
    expect(SENATORIAL_ACTION_REGEX.test('Pass a senatorial decree against Thrax')).toBe(true);
    expect(SENATORIAL_ACTION_REGEX.test('Declare someone a hostis publicus')).toBe(true);
  });

  it('returns null for activities that do not require systemic resources', () => {
    expect(getActivityResourceRequirement('Address the crowds in the Forum')).toBeNull();
    expect(getActivityResourceRequirement('Speak privately with Severus Alexander')).toBeNull();
    expect(getActivityResourceRequirement('Pray at the Temple of Jupiter')).toBeNull();
    expect(getActivityResourceRequirement('Quietly observe the mood of the Suburra')).toBeNull();
    expect(getActivityResourceRequirement('Send a private letter to an old ally')).toBeNull();
  });
});

describe('actionFeasibility: isActivityFeasible', () => {
  it('returns true for resource-free activities regardless of entity resources', () => {
    const destitute = makeEntity({
      entity_id: 'pauper',
      resources: { denarii: 0, legion_support: 0, investigations: 0 },
    });
    expect(isActivityFeasible('Deliver a speech to the citizens', destitute)).toBe(true);
    expect(isActivityFeasible('Quietly watch the palace gates', destitute)).toBe(true);
  });

  it('includes activities when the agent possesses the required resources', () => {
    const general = makeEntity({
      entity_id: 'general',
      resources: { legion_support: 80, denarii: 0 },
    });
    expect(isActivityFeasible('Order the legions to attack', general)).toBe(true);

    const wealthy = makeEntity({
      entity_id: 'wealthy',
      resources: { denarii: 50000 },
    });
    expect(isActivityFeasible('Bribe the city watch', wealthy)).toBe(true);

    const broker = makeEntity({
      entity_id: 'broker',
      resources: { investigations: 5, legion_support: 0 },
    });
    expect(isActivityFeasible('Deploy an informant network in the Curia', broker)).toBe(true);
  });

  it('excludes activities when the agent lacks the required resources', () => {
    const brokeGeneral = makeEntity({
      entity_id: 'general',
      resources: { legion_support: 80, denarii: 0 },
    });
    expect(isActivityFeasible('Bribe the Praetorian Guard', brokeGeneral)).toBe(false);

    const civilianBroker = makeEntity({
      entity_id: 'broker',
      resources: { investigations: 5, legion_support: 0 },
    });
    expect(isActivityFeasible('Order the legions to march on Rome', civilianBroker)).toBe(false);

    const nonSenator = makeEntity({
      entity_id: 'rebel',
      resources: { legion_support: 90, senatorial_support: 0 },
    });
    expect(isActivityFeasible('Convene the Senate to pass a senatorial decree', nonSenator)).toBe(false);
  });
});

describe('actionFeasibility: filterFeasibleSuggestedActions', () => {
  it('leaves suggested actions untouched when the player has required resources', () => {
    const wealthySenator = makeEntity({
      entity_id: 'wealthy_senator',
      name: 'Wealthy Senator',
      resources: { denarii: 50000, senatorial_support: 70 },
    });

    const suggestions = [
      'Bribe a senator to secure their vote',
      'Address the Senate',
      'Deliver an impassioned speech to the people in the Forum',
    ];

    const filtered = filterFeasibleSuggestedActions(suggestions, wealthySenator);
    expect(filtered).toEqual(suggestions);
  });

  it('excludes military marches for characters with no legion support and replaces them', () => {
    const civilian = makeEntity({
      entity_id: 'civilian_broker',
      resources: { denarii: 20000, investigations: 5, legion_support: 0 },
    });

    const suggestions = [
      'Order the legions to march on Rome',
      'Address the people assembled in the Forum',
    ];

    const filtered = filterFeasibleSuggestedActions(suggestions, civilian);
    expect(filtered.some(a => MILITARY_ACTION_REGEX.test(a))).toBe(false);
    expect(filtered).toContain('Address the people assembled in the Forum');
    expect(filtered).toHaveLength(2);
  });

  it('replaces financial actions with military leverage for Maximinus Thrax (denarii: 0, high legion_support)', () => {
    const thrax = makeEntity({
      entity_id: 'maximinus_thrax',
      name: 'Maximinus Thrax',
      position: 'General of the Legions',
      resources: { denarii: 0, legion_support: 85 },
    });

    const suggestions = [
      'Bribe the Praetorians to abandon the Emperor',
      'Pay off the Senate leadership',
      'Address the legions at the camp',
    ];

    const filtered = filterFeasibleSuggestedActions(suggestions, thrax);

    // Neither of the first two should contain bribe/pay
    expect(filtered.some(a => FINANCIAL_ACTION_REGEX.test(a))).toBe(false);
    // Third one should remain unchanged
    expect(filtered).toContain('Address the legions at the camp');
    // First two should be replaced by military leverage alternatives
    expect(filtered).toContain('Rally the frontier legions to demand concessions');
    expect(filtered).toContain('Intimidate the opposition through a show of military force');
    expect(filtered).toHaveLength(3);
  });

  it('replaces financial actions with espionage/intrigue alternatives when player has investigations', () => {
    const spy = makeEntity({
      entity_id: 'broke_spy',
      name: 'Broke Broker',
      resources: { denarii: 0, investigations: 4 },
    });

    const suggestions = ['Bribe a guard at the palace gate'];
    const filtered = filterFeasibleSuggestedActions(suggestions, spy);

    expect(filtered).toEqual(["Deploy informants to expose your rivals' secrets"]);
  });

  it('replaces financial actions with general authority alternatives when player has no special assets', () => {
    const brokeCitizen = makeEntity({
      entity_id: 'broke_citizen',
      name: 'Broke Roman',
      resources: { denarii: 0 },
    });

    const suggestions = ['Try to bribe the city magistrate'];
    const filtered = filterFeasibleSuggestedActions(suggestions, brokeCitizen);

    expect(filtered).toEqual(['Demand concessions through personal authority']);
  });
});

describe('Maximinus Thrax mock mode and initial state parity', () => {
  it('Maximinus Thrax in base scenario has denarii explicitly defined as 0', () => {
    const thrax = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax');
    expect(thrax).toBeDefined();
    expect(thrax?.resources.denarii).toBe(0);
    expect(thrax?.resources.legion_support).toBe(85);
  });

  it('mockRunNewTurn generates Thrax-appropriate narration and suggested actions when playing as Thrax', async () => {
    const thrax = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax')!;
    const submission: TurnSubmission = { version: 1, kind: 'freeform', text: 'Demand that the Senate grant pay to the legions' };

    const result = await mockRunNewTurn(
      submission,
      thrax,
      1,
      ALL_INITIAL_ENTITIES,
      getMockInitialState().worldState,
      [],
      '',
      'A crisis.',
      structuredClone(INITIAL_SIMULATION_STATE),
      [],
      []
    );

    // Should not speak about Thrax in third person stirring rumors
    expect(result.narration).toContain('frontier legions hold their ground');
    expect(result.narration).not.toContain('Maximinus Thrax continues to stir up trouble');

    // Should not suggest investigating himself or bribing Praetorians when broke
    expect(result.suggestedActions).toEqual([
      'Mock: Rally the frontier legions',
      'Mock: Demand concessions from the Senate',
      'Mock: Intimidate the Praetorian envoys',
    ]);
  });

  it('mockRunNewTurn maintains legacy suggestions for Severus Alexander', async () => {
    const alexander = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'severus_alexander')!;
    const submission: TurnSubmission = { version: 1, kind: 'freeform', text: 'Address the Senate' };

    const result = await mockRunNewTurn(
      submission,
      alexander,
      1,
      ALL_INITIAL_ENTITIES,
      getMockInitialState().worldState,
      [],
      '',
      'A crisis.',
      structuredClone(INITIAL_SIMULATION_STATE),
      [],
      []
    );

    expect(result.suggestedActions).toEqual([
      "Mock: Investigate Thrax's rumors",
      'Mock: Send a message to the Senate',
      'Mock: Try to bribe the Praetorians',
    ]);
  });
});
