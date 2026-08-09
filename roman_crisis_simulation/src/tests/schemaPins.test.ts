/**
 * tests/schemaPins.test.ts
 *
 * Q9 (docs/superpowers/specs/2026-08-09-q3-q10-batches-design.md, Batch 2):
 * lockstep pins for the four high-traffic zod <-> types.ts pairs that had no
 * drift guard - zRelationship<->Relationship, zMemory<->Memory,
 * zScheme<->Scheme (zSchemeStep<->SchemeStep nested), and
 * zWorldState<->WorldState (zRegionState<->RegionState nested). Their
 * Entity / NpcMindDecision / EvalJudgeVerdict siblings carry the same pin in
 * voice.test.ts / npcMinds.test.ts / evalHarness.test.ts.
 *
 * Each pair is pinned three ways, with NO z.infer bridge (the pairs are
 * hand-maintained by design - see the zodSchemas.ts header):
 *  1. runtime key-set pin: Object.keys(schema.shape).sort() against a
 *     literal sorted key array (the pin itself). The literal also carries
 *     `satisfies readonly (keyof Interface)[]`, so a key REMOVED from the
 *     interface breaks the pin at compile time too.
 *  2. zod -> interface: a parsed output assigns to the interface -
 *     compiler-enforced (npx tsc --noEmit). A field ADDED to the interface
 *     but missing from the schema output is a missing-property error here.
 *  3. interface -> zod: an interface-typed literal parses through the
 *     schema at runtime (parse accepts unknown, so this leg is runtime).
 *
 * Nullable-vs-optional boundary (documented in ai/core/actorsBoundary.ts and
 * the zodSchemas.ts field comments): model-facing enrichment fields are
 * `.nullable().optional()` on the zod side - a model may send null OR omit -
 * while types.ts declares them optional-only. That gap is DELIBERATE, not
 * drift; the zod->interface leg normalizes it explicitly (`?? undefined`)
 * where it exists (zRelationship's four enrichment fields), and the
 * null-on-both-sides field (RegionState.controlling_faction: nullable, NOT
 * optional, both sides) is pinned as such.
 */
import { describe, it, expect } from 'vitest';
import {
  zRelationship,
  zMemory,
  zScheme,
  zSchemeStep,
  zWorldState,
  zRegionState,
} from '../ai/core/zodSchemas';
import type {
  Relationship,
  Memory,
  Scheme,
  SchemeStep,
  WorldState,
  RegionState,
} from '../types';

// --- Fixtures (interface-typed: the compile-time interface -> zod leg) -----

const FULL_RELATIONSHIP: Relationship = {
  entity_id: 'npc_thrax',
  relationship_type: 'rival',
  trust_level: -4,
  respect_level: 6,
  perceived_threat: 7,
  ideological_alignment: -2,
  dependency_level: 1,
  recent_interactions: ['Clashed over the Rhine command'],
};

/** Legacy/minimal shape: the four enrichment fields ABSENT (never null). */
const MINIMAL_RELATIONSHIP: Relationship = {
  entity_id: 'npc_venena',
  relationship_type: 'ally',
  trust_level: 5,
  recent_interactions: [],
};

const MEMORY: Memory = {
  turn: 3,
  event_description: 'The Praetorians demanded a donative at the palace gates.',
  emotional_impact: 'alarmed',
  involved_entities: ['praetorian_guard', 'severus_alexander'],
};

const SCHEME: Scheme = {
  name: 'The Rhine Gambit',
  overall_goal: 'March the legions on Rome before the Senate can react.',
  steps: [
    { objective: 'Secure the veterans', status: 'completed' },
    { objective: 'Cross the Alps unseen', status: 'in_progress' },
    { objective: 'Enter Rome in triumph', status: 'pending' },
  ],
};

const WORLD_STATE: WorldState = {
  year: 235,
  week: 4,
  economic_stability: 'strained',
  political_climate: 'volatile',
  regions: {
    italia: { stability: 'unrest', controlling_faction: 'senate', current_events: ['Grain riots in Ostia'] },
    germania_superior: { stability: 'militarized', controlling_faction: null, current_events: [] },
  },
};

// --- The key-set pins (sorted literals) ------------------------------------

const RELATIONSHIP_KEYS = [
  'dependency_level',
  'entity_id',
  'ideological_alignment',
  'perceived_threat',
  'recent_interactions',
  'relationship_type',
  'respect_level',
  'trust_level',
] as const satisfies readonly (keyof Relationship)[];

const MEMORY_KEYS = [
  'emotional_impact',
  'event_description',
  'involved_entities',
  'turn',
] as const satisfies readonly (keyof Memory)[];

const SCHEME_KEYS = ['name', 'overall_goal', 'steps'] as const satisfies readonly (keyof Scheme)[];
const SCHEME_STEP_KEYS = ['objective', 'status'] as const satisfies readonly (keyof SchemeStep)[];

const WORLD_STATE_KEYS = [
  'economic_stability',
  'political_climate',
  'regions',
  'week',
  'year',
] as const satisfies readonly (keyof WorldState)[];

const REGION_STATE_KEYS = [
  'controlling_faction',
  'current_events',
  'stability',
] as const satisfies readonly (keyof RegionState)[];

// --- zRelationship <-> Relationship ----------------------------------------

describe('relationship pair: zRelationship <-> Relationship (lockstep)', () => {
  it('pins the key set', () => {
    expect(Object.keys(zRelationship.shape).sort()).toEqual([...RELATIONSHIP_KEYS]);
  });

  it('an interface-typed literal parses and round-trips (interface -> zod), full and legacy-minimal', () => {
    expect(zRelationship.parse(FULL_RELATIONSHIP)).toEqual(FULL_RELATIONSHIP);
    expect(zRelationship.parse(MINIMAL_RELATIONSHIP)).toEqual(MINIMAL_RELATIONSHIP);
  });

  it('a parsed output assigns to the interface (zod -> interface), nulls normalized at the documented boundary', () => {
    const parsed = zRelationship.parse(FULL_RELATIONSHIP);
    // Field-by-field so a per-field type drift is a compile error on its own
    // line. The four enrichment fields are `.nullable().optional()` on the
    // zod side but optional-only on the interface - the documented
    // nullable-vs-optional boundary (ai/core/actorsBoundary.ts); the
    // `?? undefined` IS that boundary's normalization, made explicit. The
    // other four fields assign directly - any null-widening there is drift.
    const asInterface: Relationship = {
      entity_id: parsed.entity_id,
      relationship_type: parsed.relationship_type,
      trust_level: parsed.trust_level,
      respect_level: parsed.respect_level ?? undefined,
      perceived_threat: parsed.perceived_threat ?? undefined,
      ideological_alignment: parsed.ideological_alignment ?? undefined,
      dependency_level: parsed.dependency_level ?? undefined,
      recent_interactions: parsed.recent_interactions,
    };
    expect(asInterface).toEqual(FULL_RELATIONSHIP);
  });

  it('the model boundary stays loose: null on every enrichment field validates; the required core does not loosen', () => {
    // If someone "tightens" zod by dropping `.nullable()` here, this fails -
    // that would break real model responses, so the looseness is pinned.
    const withNulls = {
      ...FULL_RELATIONSHIP,
      respect_level: null,
      perceived_threat: null,
      ideological_alignment: null,
      dependency_level: null,
    };
    expect(zRelationship.safeParse(withNulls).success).toBe(true);

    const missingCore = { ...FULL_RELATIONSHIP } as Record<string, unknown>;
    delete missingCore.trust_level;
    expect(zRelationship.safeParse(missingCore).success).toBe(false);
  });
});

// --- zMemory <-> Memory -----------------------------------------------------

describe('memory pair: zMemory <-> Memory (lockstep)', () => {
  it('pins the key set', () => {
    expect(Object.keys(zMemory.shape).sort()).toEqual([...MEMORY_KEYS]);
  });

  it('both directions: the interface literal parses, and the parsed output assigns straight back', () => {
    const parsed = zMemory.parse(MEMORY);
    // No nullable-vs-optional gap on this pair: direct assignment is
    // compiler-enforced whole-shape assignability.
    const asInterface: Memory = parsed;
    expect(asInterface).toEqual(MEMORY);
  });

  it('rejects a memory missing a required field', () => {
    const broken = { ...MEMORY } as Record<string, unknown>;
    delete broken.turn;
    expect(zMemory.safeParse(broken).success).toBe(false);
  });
});

// --- zScheme <-> Scheme (zSchemeStep <-> SchemeStep nested) -----------------

describe('scheme pair: zScheme <-> Scheme + zSchemeStep <-> SchemeStep (lockstep)', () => {
  it('pins both key sets', () => {
    expect(Object.keys(zScheme.shape).sort()).toEqual([...SCHEME_KEYS]);
    expect(Object.keys(zSchemeStep.shape).sort()).toEqual([...SCHEME_STEP_KEYS]);
  });

  it('both directions: the interface literal parses, and the parsed output (steps included) assigns back', () => {
    const parsed = zScheme.parse(SCHEME);
    const asInterface: Scheme = parsed;
    expect(asInterface).toEqual(SCHEME);
    // The nested step's status enum stays in lockstep with
    // SchemeStep['status'] - compiler-enforced by this assignment.
    const step: SchemeStep = parsed.steps[1];
    expect(step.status).toBe('in_progress');
  });

  it('rejects a step status outside the SchemeStep union', () => {
    const broken = {
      ...SCHEME,
      steps: [{ objective: 'Burn the bridges', status: 'abandoned' }],
    };
    expect(zScheme.safeParse(broken).success).toBe(false);
  });
});

// --- zWorldState <-> WorldState (zRegionState <-> RegionState nested) -------

describe('world-state pair: zWorldState <-> WorldState + zRegionState <-> RegionState (lockstep)', () => {
  it('pins both key sets', () => {
    expect(Object.keys(zWorldState.shape).sort()).toEqual([...WORLD_STATE_KEYS]);
    expect(Object.keys(zRegionState.shape).sort()).toEqual([...REGION_STATE_KEYS]);
  });

  it('both directions: the interface literal parses, and the parsed output (regions included) assigns back', () => {
    const parsed = zWorldState.parse(WORLD_STATE);
    const asInterface: WorldState = parsed;
    expect(asInterface).toEqual(WORLD_STATE);
    const region: RegionState = parsed.regions.germania_superior;
    expect(region.controlling_faction).toBeNull();
  });

  it('controlling_faction is null-on-BOTH-sides (nullable, NOT optional): null validates, absence does not', () => {
    // Unlike zRelationship's enrichment fields, this field carries `| null`
    // in types.ts too - so the schema must reject omission, not tolerate it.
    const broken = {
      ...WORLD_STATE,
      regions: { italia: { stability: 'unrest', current_events: [] } },
    };
    expect(zWorldState.safeParse(broken).success).toBe(false);
  });
});
