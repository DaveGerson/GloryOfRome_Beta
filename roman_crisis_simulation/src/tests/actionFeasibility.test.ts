/**
 * tests/actionFeasibility.test.ts
 *
 * Tests for resource feasibility enforcement:
 * - Filtering suggestions when a player has 0 or insufficient denarii
 * - Ensuring characters like Maximinus Thrax receive military/intimidation suggestions
 *   rather than bribe options
 * - Mock mode parity for Maximinus Thrax and broke players
 */

import { describe, it, expect } from 'vitest';
import { filterFeasibleSuggestedActions, FINANCIAL_ACTION_REGEX } from '../ai/core/actionFeasibility';
import { makeEntity } from './factories';
import { mockRunNewTurn } from '../ai/mocks';
import { ALL_INITIAL_ENTITIES, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import { getMockInitialState } from './mockData';
import { TurnSubmission } from '../types';

describe('actionFeasibility: filterFeasibleSuggestedActions', () => {
  it('leaves suggested actions untouched when the player has positive denarii', () => {
    const wealthyPlayer = makeEntity({
      entity_id: 'wealthy_senator',
      name: 'Wealthy Senator',
      resources: { denarii: 50000 },
    });

    const suggestions = [
      'Bribe a senator to secure their vote',
      'Pay the Praetorians a donative',
      'Fortify the palace walls',
    ];

    const filtered = filterFeasibleSuggestedActions(suggestions, wealthyPlayer);
    expect(filtered).toEqual(suggestions);
  });

  it('detects diverse financial spending phrases via FINANCIAL_ACTION_REGEX', () => {
    expect(FINANCIAL_ACTION_REGEX.test('Try to bribe the Praetorians')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Bribe a senator')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Offer a bribe to the cupbearer')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Pay the Praetorian Guard a donative')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Buy the loyalty of the city cohorts')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Hire mercenaries in the forum')).toBe(true);
    expect(FINANCIAL_ACTION_REGEX.test('Hire informants in the Suburra')).toBe(true);

    // Non-financial actions should not match
    expect(FINANCIAL_ACTION_REGEX.test('Rally the frontier legions')).toBe(false);
    expect(FINANCIAL_ACTION_REGEX.test('Address the Senate')).toBe(false);
    expect(FINANCIAL_ACTION_REGEX.test('Fortify the walls')).toBe(false);
    expect(FINANCIAL_ACTION_REGEX.test('Pay respects to the fallen soldiers')).toBe(false);
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
