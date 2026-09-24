/**
 * tests/stabilityVocabulary.test.ts
 *
 * BACKLOG B7: `economic_stability` is a free string the adjudicator writes,
 * so authored triggers that compared it with raw `===` went dormant on a
 * synonym ("Collapsing" vs "Failing"). events/stabilityVocabulary.ts maps
 * synonyms/case/whitespace onto canonical grades; constants/events.ts must
 * read the field only through it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ECONOMIC_STABILITY_GRADES,
  economicStabilityGrade,
  isEconomyAtOrWorseThan,
  recognizedEconomicTerms,
} from '../events/stabilityVocabulary';
import { ALL_EVENTS } from '../constants/events';
import { checkForTriggeredEvent } from '../events/engine';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { makeEntity, makeSimulationState, makeWorldState, buildAdjudicationPromptInput } from './factories';

describe('economicStabilityGrade: canonical normalization', () => {
  it('every canonical grade maps to itself', () => {
    for (const grade of ECONOMIC_STABILITY_GRADES) {
      expect(economicStabilityGrade(grade)).toBe(grade);
    }
  });

  it.each([
    ['Collapsing', 'Crisis'],
    ['Collapse', 'Crisis'],
    ['Bankrupt', 'Crisis'],
    ['In Crisis', 'Crisis'],
    ['Severe Crisis', 'Crisis'],
    ['In ruins', 'Crisis'],
    ['Dire', 'Failing'],
    ['Near Collapse', 'Failing'],
    ['On the brink of collapse', 'Failing'],
    ['Crumbling', 'Failing'],
    ['Severely Strained', 'Strained'],
    ['Fragile', 'Strained'],
    ['Recovering from famine', 'Strained'],
    ['Stable but fragile', 'Stable'],
    ['Steady', 'Stable'],
    ['Booming', 'Prosperous'],
  ] as const)('%s -> %s', (raw, grade) => {
    expect(economicStabilityGrade(raw)).toBe(grade);
  });

  it('is insensitive to case, surrounding whitespace, and punctuation', () => {
    expect(economicStabilityGrade('  failing  ')).toBe('Failing');
    expect(economicStabilityGrade('FAILING')).toBe('Failing');
    expect(economicStabilityGrade('failing.')).toBe('Failing');
    expect(economicStabilityGrade('near\tcollapse')).toBe('Failing');
    expect(economicStabilityGrade('- in   CRISIS -')).toBe('Crisis');
  });

  it('unknown, empty, and non-string values normalize to null and fire nothing', () => {
    expect(economicStabilityGrade('Purple')).toBeNull();
    expect(economicStabilityGrade('')).toBeNull();
    expect(economicStabilityGrade('   ')).toBeNull();
    expect(economicStabilityGrade(undefined)).toBeNull();
    expect(economicStabilityGrade(null)).toBeNull();
    expect(isEconomyAtOrWorseThan('Purple', 'Prosperous')).toBe(false);
  });

  it('isEconomyAtOrWorseThan respects severity order', () => {
    expect(isEconomyAtOrWorseThan('Collapsing', 'Failing')).toBe(true);
    expect(isEconomyAtOrWorseThan('Failing', 'Failing')).toBe(true);
    expect(isEconomyAtOrWorseThan('Strained', 'Failing')).toBe(false);
    expect(isEconomyAtOrWorseThan('Stable', 'Failing')).toBe(false);
  });

  it('every recognized term resolves to exactly its table grade', () => {
    for (const [term, grade] of recognizedEconomicTerms()) {
      expect(economicStabilityGrade(term)).toBe(grade);
    }
  });
});

describe('authored events read economic_stability only through the canonical vocabulary', () => {
  it('constants/events.ts never compares economic_stability to a raw string', () => {
    const source = readFileSync(new URL('../constants/events.ts', import.meta.url), 'utf8');
    // Any direct comparison (===, !==, ==, !=, includes, switch) would bypass the normalizer.
    expect(source).not.toMatch(/economic_stability\s*(?:[!=]==?|\.includes|\.startsWith|\.toLowerCase)/);
    expect(source).not.toMatch(/switch\s*\(\s*[\w.]*economic_stability/);
  });

  it('every grade threshold an authored trigger passes is canonical', () => {
    const source = readFileSync(new URL('../constants/events.ts', import.meta.url), 'utf8');
    const thresholds = [...source.matchAll(/isEconomyAtOrWorseThan\([^,]+,\s*'([^']+)'\)/g)].map(m => m[1]);
    expect(thresholds.length).toBeGreaterThan(0);
    for (const t of thresholds) {
      expect(ECONOMIC_STABILITY_GRADES as readonly string[]).toContain(t);
    }
  });

  const player = makeEntity({ entity_id: 'player_1' });
  const sim = makeSimulationState({ military_status: 'Divided' });
  const economicEvents = ['grain_shortage', 'praetorian_pay_crisis'];

  it.each(['Failing', 'Crisis', 'Collapsing', 'collapse', '  bankrupt ', 'Near Collapse', 'In Crisis'])(
    'economy-keyed events fire on "%s"',
    raw => {
      const world = makeWorldState({ economic_stability: raw });
      for (const id of economicEvents) {
        const event = ALL_EVENTS.find(e => e.id === id)!;
        expect(event.trigger(world, [player], player, sim)).toBe(true);
      }
    }
  );

  it.each(['Stable', 'Strained', 'Prosperous', 'Recovering from crisis', 'Unknown'])(
    'economy-keyed events stay quiet on "%s"',
    raw => {
      const world = makeWorldState({ economic_stability: raw });
      for (const id of economicEvents) {
        const event = ALL_EVENTS.find(e => e.id === id)!;
        expect(event.trigger(world, [player], player, sim)).toBe(false);
      }
    }
  );

  it('the trigger engine picks up the grain shortage from a synonym', () => {
    const world = makeWorldState({ economic_stability: 'Collapsing' });
    const fired = checkForTriggeredEvent(world, [player], [], player, makeSimulationState(), 5);
    expect(fired?.id).toBe('grain_shortage');
  });
});

describe('adjudication prompt advertises the canonical grades', () => {
  it('lists every canonical economic_stability grade in the WORLD DELTAS rule', () => {
    const { systemInstruction } = buildAdjudicationPrompt(buildAdjudicationPromptInput());
    const line = systemInstruction.split('\n').find(l => l.includes('WORLD DELTAS'))!;
    for (const grade of ECONOMIC_STABILITY_GRADES) {
      expect(line).toContain(grade);
    }
  });
});
