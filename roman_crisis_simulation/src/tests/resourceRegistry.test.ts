/**
 * tests/resourceRegistry.test.ts
 *
 * The canonical resource registry (DESIGN_DECISIONS.md D46,
 * ai/core/resourceRegistry.ts): one quantity, one name. Pins the alias
 * fold, the two pattern families (blackmail, holdings), the name-only
 * classification of undeclared keys (D44: a unit belongs to the resource,
 * never to the value), the bag normalisation the ledger and the engine run,
 * and the catalogue's own consistency.
 */
import { describe, it, expect } from 'vitest';
import {
  BLACKMAIL_PREFIX,
  HOLDING_PREFIX,
  RESOURCE_CATEGORIES,
  canonicalResourceKey,
  classifyResourceKey,
  clampToKind,
  formatArabic,
  formatResourcesCompact,
  getResourceKind,
  isStandingKind,
  listResourceKinds,
  normalizeResources,
  numericResource,
  slugifyResourceKey,
} from '../ai/core/resourceRegistry';

describe('resourceRegistry - slugifyResourceKey', () => {
  it('lower-cases, joins on underscores, and drops anything outside [a-z0-9_]', () => {
    expect(slugifyResourceKey('Gold Coins')).toBe('gold_coins');
    expect(slugifyResourceKey('  Legion-Support ')).toBe('legion_support');
    expect(slugifyResourceKey('__denarii__')).toBe('denarii');
    expect(slugifyResourceKey('Villa @ Baiae!')).toBe('villa_baiae');
  });

  it('normalises a key with nothing usable in it to the empty string (malformed)', () => {
    expect(slugifyResourceKey('***')).toBe('');
    expect(slugifyResourceKey('   ')).toBe('');
  });
});

describe('resourceRegistry - canonicalResourceKey', () => {
  it('folds the model\'s spellings of coin, men, spies, loyalty and favours onto their canonical keys', () => {
    expect(canonicalResourceKey('gold')).toBe('denarii');
    expect(canonicalResourceKey('Money')).toBe('denarii');
    expect(canonicalResourceKey('war chest')).toBe('denarii');
    expect(canonicalResourceKey('soldiers')).toBe('troops');
    expect(canonicalResourceKey('legionaries')).toBe('troops');
    expect(canonicalResourceKey('spies')).toBe('agents');
    expect(canonicalResourceKey('informant_network')).toBe('agents');
    expect(canonicalResourceKey('legion_loyalty')).toBe('legion_support');
    expect(canonicalResourceKey('influence')).toBe('political_influence');
    expect(canonicalResourceKey('favours')).toBe('favors');
    expect(canonicalResourceKey('arrears')).toBe('pay_arrears');
    expect(canonicalResourceKey('loans')).toBe('debt_denarii');
  });

  it('passes a canonical key through and is idempotent', () => {
    for (const kind of listResourceKinds()) {
      expect(canonicalResourceKey(kind.id)).toBe(kind.id);
      for (const alias of kind.aliases ?? []) {
        const once = canonicalResourceKey(alias);
        expect(once).toBe(kind.id);
        expect(canonicalResourceKey(once)).toBe(once);
      }
    }
  });

  it('folds the blackmail family onto blackmail_on_<id> and the holding family onto holding_<slug>', () => {
    expect(canonicalResourceKey('dirt_on_maximinus_thrax')).toBe(`${BLACKMAIL_PREFIX}maximinus_thrax`);
    expect(canonicalResourceKey('leverage_over_gaius_pontius_magnus')).toBe(`${BLACKMAIL_PREFIX}gaius_pontius_magnus`);
    expect(canonicalResourceKey('blackmail_on_lycinia_stolo')).toBe(`${BLACKMAIL_PREFIX}lycinia_stolo`);
    expect(canonicalResourceKey('property_villa_at_baiae')).toBe(`${HOLDING_PREFIX}villa_at_baiae`);
    expect(canonicalResourceKey('item_sealed_letter')).toBe(`${HOLDING_PREFIX}sealed_letter`);
    expect(canonicalResourceKey('holding_ancestral_mask')).toBe(`${HOLDING_PREFIX}ancestral_mask`);
  });

  it('leaves an undeclared key as written, slug-normalised only (D6: the bag stays dynamic)', () => {
    expect(canonicalResourceKey('grain_modii')).toBe('grain_modii');
    expect(canonicalResourceKey('Grain Modii')).toBe('grain_modii');
    expect(canonicalResourceKey('')).toBe('');
  });
});

describe('resourceRegistry - classifyResourceKey (name-only, never the value)', () => {
  it('returns the catalogue entry for a declared key or any of its aliases', () => {
    expect(classifyResourceKey('denarii')).toBe(getResourceKind('denarii'));
    expect(classifyResourceKey('gold')).toBe(getResourceKind('denarii'));
    expect(classifyResourceKey('gold').inferred).toBeUndefined();
  });

  it('gives a blackmail key a person for a label and files it under leverage as words', () => {
    const kind = classifyResourceKey('blackmail_on_maximinus_thrax');
    expect(kind.label).toBe('Maximinus Thrax');
    expect(kind.category).toBe('leverage');
    expect(kind.unit).toBe('words');
    expect(kind.inferred).toBe(true);
  });

  it('gives a holding_<slug> key its own name, no yield, and a discrete flag', () => {
    const kind = classifyResourceKey('holding_villa_at_baiae');
    expect(kind.label).toBe('Villa At Baiae');
    expect(kind.category).toBe('holdings');
    expect(kind.unit).toBe('count');
    expect(kind.weekly).toBeUndefined();
    expect(kind.inferred).toBe(true);
  });

  it('classifies an undeclared key by its name alone, defaulting to a counted holding', () => {
    expect(classifyResourceKey('grain_reserve')).toMatchObject({ category: 'holdings', unit: 'count', label: 'Grain Reserve', inferred: true });
    expect(classifyResourceKey('senate_goodwill')).toMatchObject({ category: 'standing', unit: 'scale' });
    expect(classifyResourceKey('temple_debts')).toMatchObject({ category: 'debt', unit: 'money' });
    expect(classifyResourceKey('bribe_fund')).toMatchObject({ category: 'coin', unit: 'money' });
    expect(classifyResourceKey('hired_thugs')).toMatchObject({ category: 'forces', unit: 'count' });
    expect(classifyResourceKey('sealed_letters')).toMatchObject({ category: 'leverage', unit: 'count' });
    expect(classifyResourceKey('olive_oil')).toMatchObject({ category: 'holdings', unit: 'count' });
  });

  it('never gives an inferred kind an engine rule - no floor, cap, yield or upkeep', () => {
    for (const key of ['grain_reserve', 'senate_goodwill', 'hired_thugs', 'holding_ancestral_mask']) {
      const kind = classifyResourceKey(key);
      expect(kind.systemic).toBe(false);
      expect(kind.floor).toBeUndefined();
      expect(kind.cap).toBeUndefined();
      expect(kind.weekly).toBeUndefined();
    }
  });
});

describe('resourceRegistry - clampToKind / isStandingKind', () => {
  it('clamps a standing to its 0-100 scale and leaves an undeclared kind alone', () => {
    const standing = getResourceKind('legion_support')!;
    expect(clampToKind(standing, -20)).toBe(0);
    expect(clampToKind(standing, 140)).toBe(100);
    expect(clampToKind(standing, 62.5)).toBe(62.5);
    expect(isStandingKind(standing)).toBe(true);

    const undeclared = classifyResourceKey('grain_reserve');
    expect(clampToKind(undeclared, -20)).toBe(-20);
    expect(isStandingKind(undeclared)).toBe(false);
  });

  it('floors a headcount at zero but never caps it', () => {
    const troops = getResourceKind('troops')!;
    expect(clampToKind(troops, -3)).toBe(0);
    expect(clampToKind(troops, 1_000_000)).toBe(1_000_000);
  });
});

describe('resourceRegistry - normalizeResources', () => {
  it('folds aliases, adds colliding numbers, and reports what it folded', () => {
    const { resources, folded } = normalizeResources({ gold: 500, denarii: 100, spies: 2, legion_loyalty: 40 });
    expect(resources).toEqual({ denarii: 600, agents: 2, legion_support: 40 });
    expect(folded).toEqual([
      { from: 'gold', to: 'denarii' },
      { from: 'spies', to: 'agents' },
      { from: 'legion_loyalty', to: 'legion_support' },
    ]);
  });

  it('unions colliding string lists and keeps first-seen order', () => {
    const { resources } = normalizeResources({
      dirt_on_maximinus_thrax: ['He forged the will.'],
      blackmail_on_maximinus_thrax: ['He forged the will.', 'He owes the Alexandrian bankers.'],
      estates: 2,
    });
    expect(Object.keys(resources)).toEqual(['blackmail_on_maximinus_thrax', 'estates']);
    expect(resources.blackmail_on_maximinus_thrax).toEqual(['He forged the will.', 'He owes the Alexandrian bankers.']);
  });

  it('never mutates its input and is idempotent', () => {
    const input = { gold: 500, denarii: 100 };
    const snapshot = structuredClone(input);
    const once = normalizeResources(input);
    expect(input).toEqual(snapshot);
    const twice = normalizeResources(once.resources);
    expect(twice.resources).toEqual(once.resources);
    expect(twice.folded).toEqual([]);
  });

  it('keeps a number-vs-string collision as first seen rather than inventing arithmetic', () => {
    const { resources } = normalizeResources({ denarii: 100, gold: 'a chest of it' });
    expect(resources).toEqual({ denarii: 100 });
  });
});

describe('resourceRegistry - reads and rendering', () => {
  it('numericResource reads a finite number with a zero default', () => {
    expect(numericResource({ denarii: 12 }, 'denarii')).toBe(12);
    expect(numericResource({ denarii: 'twelve' }, 'denarii')).toBe(0);
    expect(numericResource({}, 'denarii')).toBe(0);
    expect(numericResource({ denarii: Number.NaN }, 'denarii')).toBe(0);
  });

  it('formatResourcesCompact writes key:value pairs and counts a list instead of spilling it', () => {
    expect(formatResourcesCompact({ denarii: 500, estates: 2, blackmail_on_x: ['a', 'b'], note: 'sealed' }))
      .toBe('denarii:500, estates:2, blackmail_on_x:2 items, note:"sealed"');
    expect(formatResourcesCompact({ blackmail_on_x: ['a'] })).toBe('blackmail_on_x:1 item');
  });

  it('formatArabic writes Arabic figures with thousands separators (D44)', () => {
    expect(formatArabic(1500)).toBe('1,500');
    expect(formatArabic(-645)).toBe('-645');
    expect(formatArabic(0)).toBe('0');
  });
});

describe('resourceRegistry - the catalogue is consistent with itself', () => {
  it('every id is unique, every alias names exactly one kind, and no alias is itself an id', () => {
    const ids = listResourceKinds().map(kind => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    const aliases = listResourceKinds().flatMap(kind => kind.aliases ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) expect(ids).not.toContain(alias);
  });

  it('every kind names a known category, standings run 0-100, forces draw wages and productive holdings yield', () => {
    for (const kind of listResourceKinds()) {
      expect(RESOURCE_CATEGORIES).toContain(kind.category);
      expect(kind.gloss.length).toBeGreaterThan(0);
      if (kind.category === 'standing') {
        expect(kind.floor).toBe(0);
        expect(kind.cap).toBe(100);
        expect(kind.knowable).toBe('public');
      } else {
        expect(kind.knowable).toBe('owner');
      }
      if (kind.category === 'forces' && kind.id !== 'levy_pending') expect(kind.weekly?.upkeep).toBeGreaterThan(0);
      if (kind.category === 'holdings') expect(kind.weekly?.income).toBeGreaterThan(0);
    }
  });

  it('keeps every key the shipped presets seed (constants/baseScenario.ts) canonical', async () => {
    const { ALL_INITIAL_ENTITIES } = await import('../constants/baseScenario');
    for (const entity of ALL_INITIAL_ENTITIES) {
      for (const key of Object.keys(entity.resources)) {
        expect(canonicalResourceKey(key), `${entity.entity_id}:${key}`).toBe(key);
      }
    }
  });
});
