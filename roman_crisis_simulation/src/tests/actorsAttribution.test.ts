/**
 * TDD RED SUITE - actors-attribution contract, Task 1 (schemas + zod ONLY).
 *
 * THE CONTRACT: every prose-bearing INTERCHANGE field gains a sibling
 * `actors: string[]` - the entity ids whose ACTIONS the text narrates.
 *
 * THE SEMANTIC (the implementer copies this into every Gemini `actors`
 * description): actors = whose actions are narrated; mention != actor.
 * Merely MENTIONING an entity (as object, victim, or bystander) does NOT
 * put it in actors. Empty array = pure world/state description.
 *
 * SCOPE: `actors` is interchange-only - a LATER task strips it before state
 * commit; nothing here touches engine/commit code. On deltas, `actors` is
 * DISTINCT from the existing `origin_id` (which stays the mechanical owner).
 *
 * Surfaces under test:
 *   1. Narration payload            - zNarrationPayload / NarrationPayloadSchema (DO NOT EXIST YET)
 *   2. Inner monologue payload      - zPlayerMonologuePayload / PlayerMonologuePayloadSchema (DO NOT EXIST YET)
 *   3. Adjudication headlines       - string[] -> { text, actors }[]
 *   4. Each delta's `reason`        - sibling `actors` on the delta (zEventDelta / EventDeltaSchema)
 *   5. Each entityAction's `notes`  - sibling `actors` on the entityAction
 *   6. Simulation-state prose       - ONE top-level `actors` declaration covering
 *      `major_ongoing_crisis`, the response's only free-prose value (every other
 *      field is a closed enum) - principle: every free-prose field is covered by
 *      exactly one declaration
 *   7. No-attempt response tool     - sibling `actors` on zNoAttemptEvidenceSelection
 */
import { describe, expect, it } from 'vitest';
import { Type } from '@google/genai';
import type { z } from 'zod';
import * as zodSchemas from '../ai/core/zodSchemas';
import * as geminiSchemas from '../ai/core/schemas';

const {
  zAdjudication,
  zEventDelta,
  zEntityAction,
  zSimulationState,
  zNoAttemptEvidenceSelection,
} = zodSchemas;
const {
  AdjudicationSchema,
  SimulationStateSchema,
  NoAttemptEvidenceSelectionSchema,
  MortalityOutcomeSchema,
} = geminiSchemas;

// --- Helpers ---------------------------------------------------------------

/** Loose view of a Gemini responseSchema literal for structural assertions. */
type GeminiSchemaNode = {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, GeminiSchemaNode>;
  items?: GeminiSchemaNode;
};

const asNode = (schema: unknown): GeminiSchemaNode => schema as GeminiSchemaNode;

/**
 * Looks up an export the IMPLEMENTER must create. Failing the `toBeDefined`
 * assertion (not an import error) is this suite's red signal for a schema
 * that does not exist yet.
 */
function requireZodExport(name: string): z.ZodType {
  const schema = (zodSchemas as unknown as Record<string, z.ZodType | undefined>)[name];
  expect(schema, `ai/core/zodSchemas.ts must export ${name} (actors contract)`).toBeDefined();
  return schema as z.ZodType;
}

function requireGeminiExport(name: string): GeminiSchemaNode {
  const schema = (geminiSchemas as unknown as Record<string, GeminiSchemaNode | undefined>)[name];
  expect(schema, `ai/core/schemas.ts must export ${name} (actors contract)`).toBeDefined();
  return schema as GeminiSchemaNode;
}

/**
 * Structural contract for one Gemini-side `actors` declaration: a REQUIRED
 * string array with a description (into which the implementer copies the
 * semantic: actors = whose actions are narrated; mention != actor).
 */
function expectActorsDeclared(node: GeminiSchemaNode | undefined, surface: string): void {
  const actors = node?.properties?.actors;
  expect(actors, `${surface}: no 'actors' property is declared`).toBeDefined();
  expect(actors?.type, `${surface}: 'actors' must be declared type ARRAY`).toBe(Type.ARRAY);
  expect(actors?.items?.type, `${surface}: 'actors' items must be STRING entity ids`).toBe(Type.STRING);
  expect(
    (actors?.description ?? '').trim(),
    `${surface}: 'actors' needs a description carrying the attribution semantic (actors = whose actions are narrated; mention != actor; empty = pure world/state description)`,
  ).not.toBe('');
  expect(node?.required ?? [], `${surface}: 'actors' must be listed in 'required'`).toContain('actors');
}

const without = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
  const clone = { ...value };
  delete clone[key];
  return clone;
};

// --- Fixtures --------------------------------------------------------------
// In every prose fixture below Maximinus Thrax ACTS and Severus Alexander is
// merely MENTIONED (as target/victim) - so actors carries 'maximinus_thrax'
// and NEVER 'severus_alexander' (mention != actor).

const ACTOR_ID = 'maximinus_thrax';

function attributedDelta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'resource',
    key: 'severus_alexander:denarii',
    delta: -100,
    // The reason narrates Thrax's ACTION; Severus Alexander only suffers it.
    reason: 'Maximinus Thrax bribes the pay clerks; Severus Alexander loses the denarii.',
    actors: [ACTOR_ID],
    ...overrides,
  };
}

function attributedEntityAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ACTOR_ID,
    intent: 'intrigue',
    target: 'severus_alexander',
    notes: 'Maximinus Thrax seeds whispers through the camps against the Emperor.',
    actors: [ACTOR_ID],
    ...overrides,
  };
}

// One action headline (attributed) and one pure world-state headline
// (actors: [] - nobody's action is narrated, so nothing is attributed).
const ACTION_HEADLINE = { text: 'Maximinus Thrax seizes the northern legions.', actors: [ACTOR_ID] };
const WORLD_HEADLINE = { text: 'Grain runs short in the city markets.', actors: [] as string[] };

function attributedAdjudication(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turn: 4,
    entityActions: [attributedEntityAction()],
    deltas: [attributedDelta()],
    headlines: [ACTION_HEADLINE, WORLD_HEADLINE],
    gm_private: [],
    ...overrides,
  };
}

function attributedSimulationState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    imperial_status: 'Contested',
    senate_status: 'Functional',
    military_status: 'Divided',
    plebeian_mood: 'Uneasy',
    major_ongoing_crisis: 'Maximinus Thrax marches his legions on Rome.',
    actors: [ACTOR_ID],
    ...overrides,
  };
}

function attributedSelection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'answer',
    evidenceIds: ['evidence-1'],
    // The rendered answer quotes evidence describing the world - pure
    // description narrates no one's actions, so actors is empty.
    actors: [] as string[],
    ...overrides,
  };
}

// --- Surface 4: each delta's `reason` (zEventDelta) ------------------------

describe('actors contract: zEventDelta (delta reason attribution; actors = whose actions are narrated, mention != actor)', () => {
  it('REJECTS a delta whose reason lacks a sibling actors list', () => {
    expect(zEventDelta.safeParse(without(attributedDelta(), 'actors')).success).toBe(false);
  });

  it('accepts actors alongside origin_id (which stays the mechanical owner) and enforces actors as string[]', () => {
    const rumor = attributedDelta({
      type: 'rumor',
      key: 'severus_alexander',
      delta: 0.7,
      reason: 'Maximinus Thrax plants word that the Emperor bargains with the Germans.',
      is_true: false,
      origin_id: ACTOR_ID,
      topic: 'succession',
    });
    const result = zEventDelta.safeParse(rumor);
    expect(result.success, 'a fully-attributed rumor delta must parse').toBe(true);
    if (result.success) {
      const parsed = result.data as unknown as { actors?: unknown; origin_id?: unknown };
      expect(parsed.actors).toEqual([ACTOR_ID]);
      // actors is attribution of the narrated prose; origin_id remains the
      // separate mechanical owner - both survive side by side.
      expect(parsed.origin_id).toBe(ACTOR_ID);
    }
    // The typed contract, not a passthrough freeloader: non-array and
    // non-string members must be rejected.
    expect(zEventDelta.safeParse(attributedDelta({ actors: ACTOR_ID })).success).toBe(false);
    expect(zEventDelta.safeParse(attributedDelta({ actors: [42] })).success).toBe(false);
  });
});

// --- Surface 5: each entityAction's `notes` (zEntityAction) ----------------

describe('actors contract: zEntityAction (notes attribution; actors = whose actions are narrated, mention != actor)', () => {
  it('REJECTS an entityAction whose notes lack a sibling actors list', () => {
    expect(zEntityAction.safeParse(without(attributedEntityAction(), 'actors')).success).toBe(false);
  });

  it('accepts a well-formed entityAction with actors and enforces actors as string[]', () => {
    const result = zEntityAction.safeParse(attributedEntityAction());
    expect(result.success, 'an attributed entityAction must parse').toBe(true);
    if (result.success) {
      expect((result.data as unknown as { actors?: unknown }).actors).toEqual([ACTOR_ID]);
    }
    expect(zEntityAction.safeParse(attributedEntityAction({ actors: ACTOR_ID })).success).toBe(false);
    expect(zEntityAction.safeParse(attributedEntityAction({ actors: [42] })).success).toBe(false);
  });
});

// --- Surface 3: adjudication headlines string[] -> {text, actors}[] --------

describe('actors contract: zAdjudication headlines ({ text, actors } items; actors = whose actions are narrated, mention != actor)', () => {
  it('REJECTS legacy bare-string headlines', () => {
    expect(
      zAdjudication.safeParse(attributedAdjudication({ headlines: ['Maximinus Thrax seizes the northern legions.'] })).success,
    ).toBe(false);
  });

  it('accepts {text, actors} headline items (empty actors = pure world/state description) and rejects an item missing actors', () => {
    const result = zAdjudication.safeParse(attributedAdjudication());
    expect(result.success, 'an adjudication with attributed {text, actors} headlines must parse').toBe(true);
    if (result.success) {
      expect((result.data as unknown as { headlines: unknown }).headlines).toEqual([ACTION_HEADLINE, WORLD_HEADLINE]);
    }
    expect(
      zAdjudication.safeParse(attributedAdjudication({ headlines: [{ text: 'Maximinus Thrax seizes the mint.' }] })).success,
    ).toBe(false);
  });
});

// --- Surface 6: simulation-state prose (zSimulationState) ------------------
// Shape decision: ONE top-level required `actors` declaration covering
// `major_ongoing_crisis` - the response's only free-prose value (all other
// fields are closed enums). Every free-prose field is covered by exactly one
// declaration.

describe('actors contract: zSimulationState (major_ongoing_crisis attribution; actors = whose actions are narrated, mention != actor)', () => {
  it('REJECTS a simulation state whose prose lacks a top-level actors list', () => {
    expect(zSimulationState.safeParse(without(attributedSimulationState(), 'actors')).success).toBe(false);
  });

  it('accepts attributed crisis prose, accepts empty actors for a null crisis (pure state description), and enforces actors as string[]', () => {
    const result = zSimulationState.safeParse(attributedSimulationState());
    expect(result.success, 'an attributed simulation state must parse').toBe(true);
    if (result.success) {
      expect((result.data as unknown as { actors?: unknown }).actors).toEqual([ACTOR_ID]);
    }
    const quiet = zSimulationState.safeParse(attributedSimulationState({ major_ongoing_crisis: null, actors: [] }));
    expect(quiet.success, 'no crisis -> no narrated actions -> empty actors must parse').toBe(true);
    expect(zSimulationState.safeParse(attributedSimulationState({ actors: ACTOR_ID })).success).toBe(false);
    expect(zSimulationState.safeParse(attributedSimulationState({ actors: [42] })).success).toBe(false);
  });
});

// --- Surface 7: no-attempt response tool (zNoAttemptEvidenceSelection) -----

describe('actors contract: zNoAttemptEvidenceSelection (same treatment as narration/monologue; actors = whose actions are narrated, mention != actor)', () => {
  it('REJECTS a selection missing the sibling actors list', () => {
    expect(zNoAttemptEvidenceSelection.safeParse(without(attributedSelection(), 'actors')).success).toBe(false);
  });

  it('accepts a well-formed selection carrying actors', () => {
    const result = zNoAttemptEvidenceSelection.safeParse(attributedSelection());
    expect(result.success, 'a selection with a sibling actors list must parse (strict schema must declare it)').toBe(true);
    if (result.success) {
      expect((result.data as unknown as { actors?: unknown }).actors).toEqual([]);
    }
  });
});

// --- Surfaces 1 & 2: narration + inner monologue payloads ------------------
// SCHEMAS DO NOT EXIST YET. Narration and the player monologue are plain
// generateText/generateTextStream calls today (ai/core/turn.ts,
// ai/tools/intelligence.ts::getPlayerMonologue) with NO zod or Gemini schema
// on either side. These tests name the exports the implementer must create:
//   zodSchemas.ts:  zNarrationPayload, zPlayerMonologuePayload
//   schemas.ts:     NarrationPayloadSchema, PlayerMonologuePayloadSchema
// each shaped { text: string, actors: string[] } with actors REQUIRED.
// Until they exist, each test fails on the requireZodExport/requireGeminiExport
// toBeDefined assertion - the intended red signal, NOT an import error.

describe('actors contract [SCHEMAS DO NOT EXIST YET]: narration payload (zNarrationPayload; actors = whose actions are narrated, mention != actor)', () => {
  it('zodSchemas.ts exports zNarrationPayload', () => {
    requireZodExport('zNarrationPayload');
  });

  it('zNarrationPayload accepts { text, actors } (empty actors = pure world description) and REJECTS prose missing actors', () => {
    const zNarrationPayload = requireZodExport('zNarrationPayload');
    expect(zNarrationPayload.safeParse({
      text: 'Maximinus Thrax storms the camp gate while Severus Alexander watches from the wall.',
      actors: [ACTOR_ID],
    }).success).toBe(true);
    expect(zNarrationPayload.safeParse({
      text: 'Rain falls on an empty forum.',
      actors: [],
    }).success).toBe(true);
    expect(zNarrationPayload.safeParse({
      text: 'Maximinus Thrax storms the camp gate.',
    }).success).toBe(false);
    expect(zNarrationPayload.safeParse({
      text: 'Maximinus Thrax storms the camp gate.',
      actors: ACTOR_ID,
    }).success).toBe(false);
  });
});

describe('actors contract [SCHEMAS DO NOT EXIST YET]: inner monologue payload (zPlayerMonologuePayload; actors = whose actions are narrated, mention != actor)', () => {
  it('zodSchemas.ts exports zPlayerMonologuePayload', () => {
    requireZodExport('zPlayerMonologuePayload');
  });

  it('zPlayerMonologuePayload accepts { text, actors } and REJECTS prose missing actors', () => {
    const zPlayerMonologuePayload = requireZodExport('zPlayerMonologuePayload');
    expect(zPlayerMonologuePayload.safeParse({
      text: 'I moved against Thrax tonight; the whispers were my doing.',
      actors: ['severus_alexander'],
    }).success).toBe(true);
    expect(zPlayerMonologuePayload.safeParse({
      text: 'The city sleeps uneasily.',
      actors: [],
    }).success).toBe(true);
    expect(zPlayerMonologuePayload.safeParse({
      text: 'I moved against Thrax tonight.',
    }).success).toBe(false);
  });
});

// --- Gemini structured-output declarations (ai/core/schemas.ts) ------------
// Zod/Gemini lockstep (the file-header contract in both files): every zod
// surface above must have its `actors` declared - REQUIRED, ARRAY of STRING,
// with a description carrying the semantic - in the responseSchema literal.

describe('actors contract: Gemini declarations (schemas.ts) require actors on every prose surface', () => {
  it('AdjudicationSchema headlines items are {text, actors} OBJECTs, not bare STRINGs', () => {
    const headlineItems = asNode(AdjudicationSchema).properties?.headlines?.items;
    expect(
      headlineItems?.type,
      'headlines items must be OBJECT ({text, actors}), not STRING',
    ).toBe(Type.OBJECT);
    expect(headlineItems?.properties?.text?.type, 'headline items must declare a text STRING').toBe(Type.STRING);
    expect(headlineItems?.required ?? [], 'headline text must be required').toContain('text');
    expectActorsDeclared(headlineItems, 'AdjudicationSchema.headlines.items');
  });

  it('the EventDelta declaration (AdjudicationSchema.deltas.items) requires actors beside reason', () => {
    expectActorsDeclared(asNode(AdjudicationSchema).properties?.deltas?.items, 'AdjudicationSchema.deltas.items');
  });

  it('the shared EventDelta declaration also covers mortality-outcome deltas (MortalityOutcomeSchema)', () => {
    expectActorsDeclared(
      asNode(MortalityOutcomeSchema).properties?.outcomes?.items?.properties?.deltas?.items,
      'MortalityOutcomeSchema.outcomes.items.deltas.items',
    );
  });

  it('the EntityAction declaration (AdjudicationSchema.entityActions.items) requires actors beside notes', () => {
    expectActorsDeclared(
      asNode(AdjudicationSchema).properties?.entityActions?.items,
      'AdjudicationSchema.entityActions.items',
    );
  });

  it('SimulationStateSchema requires one top-level actors declaration covering major_ongoing_crisis', () => {
    expectActorsDeclared(asNode(SimulationStateSchema), 'SimulationStateSchema');
  });

  it('NoAttemptEvidenceSelectionSchema requires actors', () => {
    expectActorsDeclared(asNode(NoAttemptEvidenceSelectionSchema), 'NoAttemptEvidenceSelectionSchema');
  });

  it('[SCHEMA DOES NOT EXIST YET] NarrationPayloadSchema declares required text + actors', () => {
    const schema = requireGeminiExport('NarrationPayloadSchema');
    expect(schema.properties?.text?.type, 'NarrationPayloadSchema must declare a text STRING').toBe(Type.STRING);
    expect(schema.required ?? [], 'NarrationPayloadSchema text must be required').toContain('text');
    expectActorsDeclared(schema, 'NarrationPayloadSchema');
  });

  it('[SCHEMA DOES NOT EXIST YET] PlayerMonologuePayloadSchema declares required text + actors', () => {
    const schema = requireGeminiExport('PlayerMonologuePayloadSchema');
    expect(schema.properties?.text?.type, 'PlayerMonologuePayloadSchema must declare a text STRING').toBe(Type.STRING);
    expect(schema.required ?? [], 'PlayerMonologuePayloadSchema text must be required').toContain('text');
    expectActorsDeclared(schema, 'PlayerMonologuePayloadSchema');
  });
});
