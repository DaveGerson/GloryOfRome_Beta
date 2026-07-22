/**
 * tests/seededRng.test.ts
 *
 * The seeded random source in ai/core/resolution.ts (`createSeededRng` /
 * `generateSeed`) and `rollD20`'s two contracts: with a seeded generator
 * the roll sequence is fully determined by the seed (the reproducibility
 * invariant every recorded turnSeed / investigation seed relies on), and
 * without one it draws from `Math.random` exactly as it always has.
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng, generateSeed, rollD20 } from '../ai/core/resolution';

describe('ai/core/resolution.ts createSeededRng', () => {
  it('the same seed produces an identical sequence', () => {
    const a = createSeededRng(12345);
    const b = createSeededRng(12345);
    const seqA = Array.from({ length: 200 }, () => a());
    const seqB = Array.from({ length: 200 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('every draw is a float in [0, 1)', () => {
    const rng = createSeededRng(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('handles the full 32-bit seed range, including 0 and 2^32 - 1', () => {
    for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const rng = createSeededRng(seed);
      const first = rng();
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(1);
      // Deterministic: rebuilding from the same seed reproduces the draw.
      expect(createSeededRng(seed)()).toBe(first);
    }
  });
});

describe('ai/core/resolution.ts generateSeed', () => {
  it('returns a 32-bit unsigned integer', () => {
    for (let i = 0; i < 200; i++) {
      const seed = generateSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe('ai/core/resolution.ts rollD20 with a seeded rng', () => {
  it('the same seed produces an identical roll sequence', () => {
    const a = createSeededRng(0xa5a5a5a5);
    const b = createSeededRng(0xa5a5a5a5);
    const rollsA = Array.from({ length: 100 }, () => rollD20(a));
    const rollsB = Array.from({ length: 100 }, () => rollD20(b));
    expect(rollsA).toEqual(rollsB);
  });

  it('different seeds produce diverging roll sequences', () => {
    const a = createSeededRng(7);
    const b = createSeededRng(8);
    const rollsA = Array.from({ length: 50 }, () => rollD20(a));
    const rollsB = Array.from({ length: 50 }, () => rollD20(b));
    expect(rollsA).not.toEqual(rollsB);
  });

  it('seeded draws are integers 1-20 and cover the full face range over many draws', () => {
    const rng = createSeededRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const roll = rollD20(rng);
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
      seen.add(roll);
    }
    expect(seen.size).toBe(20);
  });
});

describe('ai/core/resolution.ts rollD20 without an rng (Math.random fallback)', () => {
  it('still returns integers in [1, 20] across many draws', () => {
    for (let i = 0; i < 500; i++) {
      const roll = rollD20();
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });
});
