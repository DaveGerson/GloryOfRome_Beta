/**
 * tests/seededRng.test.ts
 *
 * The seeded random source in ai/core/resolution.ts (`createSeededRng` /
 * `generateSeed`) and `rollD20`'s two contracts: with a seeded generator
 * the roll sequence is fully determined by the seed (the reproducibility
 * invariant every recorded turnSeed / investigation seed relies on), and
 * without one it draws from `Math.random` exactly as it always has.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSeededRng, deriveTurnSeed, generateSeed, rollD20 } from '../ai/core/resolution';

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('ai/core/resolution.ts deriveTurnSeed (D51)', () => {
  const bitsSet = (value: number) => {
    let count = 0;
    for (let v = value >>> 0; v !== 0; v >>>= 1) count += v & 1;
    return count;
  };

  it('is a pure function of the reign seed and the turn number - same inputs, same seed, no Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random touched'); });
    for (const reign of [0, 1, 0x5eed5eed, 0x7fffffff, 0xffffffff]) {
      for (const turn of [0, 1, 2, 3, 52, 1000]) {
        expect(deriveTurnSeed(reign, turn)).toBe(deriveTurnSeed(reign, turn));
      }
    }
    // Pinned, so the mix can never drift under a refactor: a changed value
    // would give every saved reign different dice for its next turn.
    expect([deriveTurnSeed(0, 0), deriveTurnSeed(0, 1), deriveTurnSeed(123456789, 7)])
      .toEqual([2462723854, 1020716019, 1749491315]);
  });

  it('returns a 32-bit unsigned integer across the full reign range', () => {
    for (const reign of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      for (let turn = 0; turn < 50; turn++) {
        const seed = deriveTurnSeed(reign, turn);
        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(2 ** 32);
      }
    }
  });

  it('gives turn n and turn n+1 different seeds, and no two turns of a reign the same one', () => {
    for (const reign of [0, 42, 0x5eed5eed, 0xffffffff]) {
      const seeds = Array.from({ length: 5000 }, (_, turn) => deriveTurnSeed(reign, turn));
      for (let turn = 0; turn + 1 < seeds.length; turn++) expect(seeds[turn + 1]).not.toBe(seeds[turn]);
      expect(new Set(seeds).size).toBe(seeds.length);
    }
  });

  it('spreads neighbouring turns and neighbouring reigns into unrelated seeds', () => {
    // Avalanche: a step of one turn (or one reign) flips about half of the
    // 32 output bits, on average - never a near-copy of its neighbour.
    let turnFlips = 0;
    let reignFlips = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      const reign = Math.imul(i, 0x9e3779b1) >>> 0;
      const turn = i % 200;
      turnFlips += bitsSet(deriveTurnSeed(reign, turn) ^ deriveTurnSeed(reign, turn + 1));
      reignFlips += bitsSet(deriveTurnSeed(reign, turn) ^ deriveTurnSeed(reign + 1, turn));
    }
    expect(turnFlips / samples).toBeGreaterThan(15);
    expect(turnFlips / samples).toBeLessThan(17);
    expect(reignFlips / samples).toBeGreaterThan(15);
    expect(reignFlips / samples).toBeLessThan(17);

    // ...and the dice a reign's turns open with land evenly on every face.
    const faces = new Array(21).fill(0);
    for (let turn = 1; turn <= 4000; turn++) faces[rollD20(createSeededRng(deriveTurnSeed(0x5eed5eed, turn)))]++;
    for (let face = 1; face <= 20; face++) {
      expect(faces[face], `face ${face}`).toBeGreaterThan(140);
      expect(faces[face], `face ${face}`).toBeLessThan(260);
    }
  });

  it('is not a trivial combination the two inputs could collide under', () => {
    for (let turn = 1; turn < 20; turn++) {
      const reign = 1000;
      expect(deriveTurnSeed(reign, turn)).not.toBe((reign + turn) >>> 0);
      expect(deriveTurnSeed(reign, turn)).not.toBe((reign ^ turn) >>> 0);
      // Swapping which number is the reign and which the turn is a different turn.
      expect(deriveTurnSeed(reign, turn)).not.toBe(deriveTurnSeed(turn, reign));
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
