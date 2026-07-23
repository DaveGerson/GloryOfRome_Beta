/**
 * @vitest-environment jsdom
 */
// Note: This test file is written with Vitest/Jest syntax.
// You will need to set up a test runner in your project to execute these tests.
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAdjudication, MAX_ENTITY_MEMORIES, MAX_RECENT_INTERACTIONS } from '../ai/core/engine';
import { applyEventChoiceDeltas } from '../events/engine';
import { getMockInitialState } from './mockData';
import { Entity, WorldState, Adjudication, Report, PlayerEventChoice, Memory } from '../types';

// Helper for deep copying state to ensure test isolation
const deepCopy = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

describe('applyAdjudication', () => {
  let mockEntities: Entity[];
  let mockWorldState: WorldState;
  let mockReports: Report[];

  beforeEach(() => {
    const initialState = getMockInitialState();
    mockEntities = initialState.entities;
    mockWorldState = initialState.worldState;
    mockReports = [];
  });

  const baseAdjudication: Adjudication = {
    turn: 1,
    entityActions: [],
    deltas: [],
    headlines: [],
    gm_private: [],
  };

  // --- Player-removal guard (D1/D2) ---
  describe('remove_entities player guard', () => {
    it('never removes the player entity even when the response names it, and records the refusal', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.remove_entities = ['severus_alexander'];

      const { updatedEntities } = applyAdjudication(
        adjudication, mockEntities, mockWorldState, mockReports, [],
        { playerEntityId: 'severus_alexander' }
      );

      expect(updatedEntities.some(e => e.entity_id === 'severus_alexander')).toBe(true);
      expect(adjudication.gm_private.some(n => n.includes('Refused to remove the player'))).toBe(true);
    });

    it('still removes a non-player entity named in remove_entities', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.remove_entities = ['maximinus_thrax'];

      const { updatedEntities } = applyAdjudication(
        adjudication, mockEntities, mockWorldState, mockReports, [],
        { playerEntityId: 'severus_alexander' }
      );

      expect(updatedEntities.some(e => e.entity_id === 'maximinus_thrax')).toBe(false);
      expect(updatedEntities.some(e => e.entity_id === 'severus_alexander')).toBe(true);
    });
  });

  // --- Resource Deltas ---
  describe('Resource Deltas', () => {
    it('should add a resource to an entity', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: 5000, reason: 'Taxes' });
      
      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      
      expect((entity?.resources.denarii as number)).toBe(55000);
    });

    it('should subtract a resource from an entity', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -10000, reason: 'Donation' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'severus_alexander');

      expect((entity?.resources.denarii as number)).toBe(40000);
    });

    it('should create and set a new resource if it does not exist', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'resource', key: 'maximinus_thrax:influence', delta: 10, reason: 'Gained support' });
      
      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.resources.influence).toBe(10);
    });

    it('should not error for a resource delta on a non-existent entity', () => {
       const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'resource', key: 'non_existent_entity:gold', delta: 100, reason: '' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedEntities).toEqual(mockEntities);
    });

    // --- Systemic Resource Registry (DESIGN_DECISIONS.md D6) ---
    describe('Systemic resources: denarii (D6)', () => {
      it('should allow a non-systemic resource to go negative freely (regression)', () => {
        const adjudication = deepCopy(baseAdjudication);
        // legion_support is not in the systemic registry - should behave exactly
        // as before: a bare running total, free to go negative.
        adjudication.deltas.push({ type: 'resource', key: 'maximinus_thrax:legion_support', delta: -200, reason: 'Legions mutiny' });

        const { updatedEntities, updatedReports } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        expect(entity?.resources.legion_support).toBe(-115); // 85 - 200
        expect(updatedReports.length).toBe(0);
      });

      it('should clamp denarii to 0 and convert the overdraft shortfall to debt_denarii, emitting a report', () => {
        const adjudication = deepCopy(baseAdjudication);
        // severus_alexander starts with 50000 denarii.
        adjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -60000, reason: 'A disastrous campaign bankrupts the treasury' });

        const { updatedEntities, updatedReports } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'severus_alexander');

        expect(entity?.resources.denarii).toBe(0);
        expect(entity?.resources.debt_denarii).toBe(10000); // shortfall: 60000 - 50000

        const debtReport = updatedReports.find(r => (r.claim as string).includes('coffers run dry'));
        expect(debtReport).toBeDefined();
        expect(debtReport?.claim).toBe('Your coffers run dry — the shortfall of 10000 denarii is owed to your creditors.');
      });

      it('should accumulate debt_denarii across repeated overdrafts on the same entity', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -60000, reason: 'First overdraft' });

        const first = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entityAfterFirst = first.updatedEntities.find(e => e.entity_id === 'severus_alexander')!;
        expect(entityAfterFirst.resources.denarii).toBe(0);
        expect(entityAfterFirst.resources.debt_denarii).toBe(10000);

        const secondAdjudication = deepCopy(baseAdjudication);
        secondAdjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -2500, reason: 'Second overdraft, already at zero' });

        const second = applyAdjudication(secondAdjudication, first.updatedEntities, first.updatedWorldState, first.updatedReports);
        const entityAfterSecond = second.updatedEntities.find(e => e.entity_id === 'severus_alexander')!;

        expect(entityAfterSecond.resources.denarii).toBe(0);
        expect(entityAfterSecond.resources.debt_denarii).toBe(12500); // 10000 + 2500 accumulated
      });

      it('should emit exactly one low-treasury warning when crossing the threshold, and not again while still below it', () => {
        // severus_alexander starts at 50000 (well above LOW_TREASURY_THRESHOLD = 5000).
        const firstAdjudication = deepCopy(baseAdjudication);
        firstAdjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -46000, reason: 'Crosses below the low-treasury threshold' }); // 50000 -> 4000

        const first = applyAdjudication(firstAdjudication, mockEntities, mockWorldState, mockReports);
        const entityAfterFirst = first.updatedEntities.find(e => e.entity_id === 'severus_alexander')!;
        expect(entityAfterFirst.resources.denarii).toBe(4000);

        const warningReports = first.updatedReports.filter(r => (r.claim as string).includes('fallen below'));
        expect(warningReports.length).toBe(1);

        // Apply a second delta that keeps denarii below the threshold - should
        // NOT emit a second warning (only the crossing itself warns).
        const secondAdjudication = deepCopy(baseAdjudication);
        secondAdjudication.deltas.push({ type: 'resource', key: 'severus_alexander:denarii', delta: -1000, reason: 'Still below threshold' }); // 4000 -> 3000

        const second = applyAdjudication(secondAdjudication, first.updatedEntities, first.updatedWorldState, first.updatedReports);
        const entityAfterSecond = second.updatedEntities.find(e => e.entity_id === 'severus_alexander')!;
        expect(entityAfterSecond.resources.denarii).toBe(3000);

        const warningReportsAfterSecond = second.updatedReports.filter(r => (r.claim as string).includes('fallen below'));
        expect(warningReportsAfterSecond.length).toBe(1); // still just the one from the crossing
      });
    });
  });

  // --- Relation Deltas ---
  describe('Relation Deltas', () => {
    it('should change trust level directionally using the old key format', () => {
      const adjudication = deepCopy(baseAdjudication);
      // Legacy format test. Relation deltas are directional: 'A:B' changes only
      // A's perception of B — mutual shifts require a second delta with the
      // ids reversed.
      adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax', delta: 3, reason: 'Successful negotiation' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entityA = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      const entityB = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entityA?.relationships['maximinus_thrax'].trust_level).toBe(-4); // -7 + 3
      expect(entityB?.relationships['severus_alexander'].trust_level).toBe(-8); // unchanged: delta is directional
    });

    it('should change trust level using the new attribute-specific key format', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax:trust_level', delta: 2, reason: 'Brief truce' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entityA = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      expect(entityA?.relationships['maximinus_thrax'].trust_level).toBe(-5); // -7 + 2
    });

    it('should change perceived_threat and clamp it between 0 and 10', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:gaius_pontius_magnus:perceived_threat', delta: 3, reason: 'Heard rumors of a plot' });
        adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax:perceived_threat', delta: 20, reason: 'Overwhelming force' }); // Should clamp to 10

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'severus_alexander');

        expect(entity?.relationships['gaius_pontius_magnus'].perceived_threat).toBe(3); // 0 + 3
        expect(entity?.relationships['maximinus_thrax'].perceived_threat).toBe(10); // 9 + 20 clamped to 10
    });

    it('should change respect_level and clamp it between -10 and 10', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax:respect_level', delta: 5, reason: 'Witnessed tactical brilliance' });
      adjudication.deltas.push({ type: 'relation', key: 'gaius_pontius_magnus:severus_alexander:respect_level', delta: -20, reason: 'Acted dishonorably' }); // Should clamp to -10

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const emperor = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      const senator = updatedEntities.find(e => e.entity_id === 'gaius_pontius_magnus');

      expect(emperor?.relationships['maximinus_thrax'].respect_level).toBe(8); // 3 + 5
      expect(senator?.relationships['severus_alexander'].respect_level).toBe(-10); // 3 - 20 clamped to -10
    });


    it('should clamp trust level at -10 and 10', () => {
       const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax', delta: 100, reason: 'Miracle' });
      adjudication.deltas.push({ type: 'relation', key: 'maximinus_thrax:severus_alexander', delta: -100, reason: 'Betrayal' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entityA = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      
      expect(entityA?.relationships['maximinus_thrax'].trust_level).toBe(10); // Clamped at 10
      
      const { updatedEntities: secondUpdate } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entityB = secondUpdate.find(e => e.entity_id === 'maximinus_thrax');
      expect(entityB?.relationships['severus_alexander'].trust_level).toBe(-10); // Clamped at -10
    });
  });

  // --- Status Deltas ---
  describe('Status Deltas', () => {
    it('should change an entity status to dead', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'Is now dead' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('dead');
    });

    // Stopgap bug fix: engine.ts previously only matched the literal substring
    // 'dead', so natural AI phrasings like "has died" or "was killed" never
    // matched and the entity silently stayed 'alive'. These cases lock in the
    // broadened (but still substring/regex-based, pre-enum-redesign) matching.
    it('should change an entity status to dead on "has died" phrasing', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'Maximinus Thrax has died of his wounds' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('dead');
    });

    it('should change an entity status to dead on the bare word "dead"', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'dead' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('dead');
    });

    it('should change an entity status to dead on "was killed" phrasing', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'He was killed in an ambush outside the camp' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('dead');
    });

    it('should change an entity status to exiled', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'Was exiled to a remote province' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('exiled');
    });

    // Documented stopgap behavior: this substring/regex approach cannot truly
    // understand negation. We special-case the common "survived a close call"
    // phrasing so it does NOT kill the entity, but this is a heuristic, not a
    // general solution - the proper fix is the structured `new_status` enum
    // field (P0.2 in ROADMAP_6_MAINTAINABILITY.md), which removes freeform
    // reason-string interpretation from control flow entirely.
    it('should NOT kill an entity for "nearly died but survived" phrasing', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'He nearly died but survived the assassination attempt' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.status).toBe('alive');
    });

    it('should move an entity to a new valid location', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'moves to Palatine Hill' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.location).toBe('Palatine Hill');
    });

    it('should not move an entity to an invalid location', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'status', key: 'maximinus_thrax', delta: 0, reason: 'moves to Gaul' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entity?.location).toBe('Praetorian Camp'); // Unchanged
    });

    // --- MAINT-P0.2: structured new_status/new_location fields ---
    // These take precedence over free-text 'reason' parsing entirely; 'reason'
    // is narrative/display text only and is never consulted when the
    // structured field is present.
    describe('Structured new_status/new_location (MAINT-P0.2)', () => {
      it('should kill an entity when new_status is "dead", even if reason text says the opposite', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
          type: 'status',
          key: 'maximinus_thrax',
          delta: 0,
          reason: 'He miraculously survived the assassination attempt.',
          new_status: 'dead',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        // Structured field wins: despite "survived" wording (which would
        // suppress a death under the legacy regex), new_status:'dead' is
        // authoritative.
        expect(entity?.status).toBe('dead');
      });

      it('should exile an entity via new_status regardless of reason phrasing', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
          type: 'status',
          key: 'maximinus_thrax',
          delta: 0,
          reason: 'Political maneuvering forces a change in circumstances.',
          new_status: 'exiled',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        expect(entity?.status).toBe('exiled');
      });

      it('should move an entity to a new valid location via the structured new_location field', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
          type: 'status',
          key: 'maximinus_thrax',
          delta: 0,
          reason: 'Relocates to the imperial residence.',
          new_location: 'Palatine Hill',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        expect(entity?.location).toBe('Palatine Hill');
      });

      it('should leave location unchanged when new_location names an unrecognized region', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
          type: 'status',
          key: 'maximinus_thrax',
          delta: 0,
          reason: 'Flees the city.',
          new_location: 'Gaul',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        expect(entity?.location).toBe('Praetorian Camp'); // Unchanged - 'Gaul' is not a known region
      });

      it('should apply both a structured status change and a structured location change from the same delta', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
          type: 'status',
          key: 'maximinus_thrax',
          delta: 0,
          reason: 'Banished from Rome after the failed coup.',
          new_status: 'exiled',
          new_location: 'Palatine Hill',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

        expect(entity?.status).toBe('exiled');
        expect(entity?.location).toBe('Palatine Hill');
      });
    });
  });

  // --- Region Deltas ---
  describe('Region Deltas', () => {
    it("should change a region's stability", () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'region', key: 'Palatine Hill:stability', delta: 0, reason: 'Rebellion' });

      const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedWorldState.regions['Palatine Hill'].stability).toBe('Rebellion');
    });

    it('should add a new region to the world state', () => {
        const adjudication = deepCopy(baseAdjudication);
        const newRegionState = { stability: 'Peaceful', controlling_faction: null as string | null, current_events: ['A new market has opened.'] };
        adjudication.deltas.push({ type: 'add_region', key: 'Capitoline Hill', delta: 0, reason: JSON.stringify(newRegionState) });

        const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        
        expect(updatedWorldState.regions['Capitoline Hill']).toBeDefined();
        expect(updatedWorldState.regions['Capitoline Hill'].stability).toBe('Peaceful');
        expect(Object.keys(updatedWorldState.regions).length).toBe(Object.keys(mockWorldState.regions).length + 1);
    });

    it('should remove an existing region from the world state', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({ type: 'remove_region', key: 'Praetorian Camp', delta: 0, reason: 'The camp was disbanded.' });

        const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

        expect(updatedWorldState.regions['Praetorian Camp']).toBeUndefined();
        expect(Object.keys(updatedWorldState.regions).length).toBe(Object.keys(mockWorldState.regions).length - 1);
    });

    it('should not error when trying to remove a non-existent region', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({ type: 'remove_region', key: 'The Forum', delta: 0, reason: 'Never existed.' });

        const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        expect(updatedWorldState).toEqual(mockWorldState);
    });
  });

  // --- World Deltas (D6/Phase 2: unfreezes the Header meters) ---
  describe('World Deltas', () => {
    it("should update economic_stability from a 'world' delta", () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'world', key: 'economic_stability', delta: 0, reason: 'Failing' });

      const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedWorldState.economic_stability).toBe('Failing');
      expect(updatedWorldState.political_climate).toBe(mockWorldState.political_climate); // unchanged
    });

    it("should update political_climate from a 'world' delta", () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'world', key: 'political_climate', delta: 0, reason: 'Openly Hostile' });

      const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedWorldState.political_climate).toBe('Openly Hostile');
    });

    it("should no-op on an unrecognized 'world' delta key", () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'world', key: 'imperial_mood', delta: 0, reason: 'Ecstatic' });

      const { updatedWorldState } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedWorldState).toEqual(mockWorldState);
      expect((updatedWorldState as any).imperial_mood).toBeUndefined();
    });
  });

  // --- Rumor Deltas ---
  describe('Rumor Deltas', () => {
    it('should create a new report from a rumor delta', () => {
      const adjudication = deepCopy(baseAdjudication);
      adjudication.deltas.push({ type: 'rumor', key: 'severus_alexander', delta: 0.65, reason: 'Secretly meeting with barbarians' });
      
      const { updatedReports } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

      expect(updatedReports.length).toBe(1);
      expect(updatedReports[0].source).toBe('rumor');
      expect(updatedReports[0].claim).toBe('Secretly meeting with barbarians');
      expect(updatedReports[0].credibility).toBe(0.65);
      expect(updatedReports[0].about).toBe('severus_alexander');
    });
  });

  // --- Perception-grounded memories ---
  // Memory stamping follows each entity's OWN vantage (perception/
  // npcPerception.ts over perception/visibility.ts's viewer-agnostic
  // rules): an entity remembers only what it could witness, introspect,
  // hear through its visibility_network, or pick up as public news.
  // Fixture vantages (tests/mockData.ts): severus @ Palatine Hill with
  // network [maximinus, gaius]; maximinus @ Praetorian Camp with network
  // [severus]; gaius @ The Curia with network [severus, maximinus].
  describe('Perception-grounded memories', () => {
    // A 'world' macro delta is public to every viewer - the deterministic
    // one-memory-per-entity write the cap tests below lean on.
    const worldNewsDelta = { type: 'world', key: 'economic_stability', delta: 0, reason: 'Failing' } as const;
    const WORLD_NEWS_LINE = "Word spreads through every market: the empire's economy is now Failing.";

    it('stamps a memory only for entities whose vantage admits the event', () => {
        const adjudication = deepCopy(baseAdjudication);
        // Gaius's own resource shift: 'self' for gaius, 'network' for
        // severus (gaius is a contact), invisible to maximinus (gaius is
        // neither at the Praetorian Camp nor in maximinus's network).
        adjudication.deltas.push({ type: 'resource', key: 'gaius_pontius_magnus:denarii', delta: 1000, reason: 'A bribe collected' });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const gaius = updatedEntities.find(e => e.entity_id === 'gaius_pontius_magnus')!;
        const severus = updatedEntities.find(e => e.entity_id === 'severus_alexander')!;
        const maximinus = updatedEntities.find(e => e.entity_id === 'maximinus_thrax')!;

        expect(gaius.memories.length).toBe(1);
        expect(gaius.memories[0].event_description).toBe('Your denarii grows.');
        expect(gaius.memories[0].turn).toBe(adjudication.turn);
        expect(severus.memories.length).toBe(1);
        expect(severus.memories[0].event_description).toBe("Gaius Pontius Magnus's denarii grows.");
        expect(severus.memories[0].involved_entities).toEqual(['gaius_pontius_magnus']);
        expect(maximinus.memories.length).toBe(0);
    });

    it('does not stamp memories from headline name-matching (headlines are not perception)', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.headlines.push('A shocking proclamation by Maximinus Thrax has stunned the city.');

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

        // A headline can name an entity the world over - being NAMED in
        // news is not the same as an event reaching that entity's vantage.
        // With no deltas, nothing was perceivable by anyone.
        expect(updatedEntities.every(e => e.memories.length === 0)).toBe(true);
    });

    it('delivers public news into every perceiving entity\'s memories', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push(deepCopy(worldNewsDelta));

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

        for (const entity of updatedEntities) {
            expect(entity.memories.length).toBe(1);
            expect(entity.memories[0].event_description).toBe(WORLD_NEWS_LINE);
        }
    });

    it('keeps the player\'s entity out of the memory loop when the perception context names them', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({ type: 'resource', key: 'gaius_pontius_magnus:denarii', delta: 1000, reason: 'A bribe collected' });

        const { updatedEntities } = applyAdjudication(
            adjudication, mockEntities, mockWorldState, mockReports, [],
            { playerEntityId: 'severus_alexander' }
        );
        const severus = updatedEntities.find(e => e.entity_id === 'severus_alexander')!;
        const gaius = updatedEntities.find(e => e.entity_id === 'gaius_pontius_magnus')!;

        // Severus's network admits the event, but player knowledge lives in
        // the D21 knowledge store - never in this loop.
        expect(severus.memories.length).toBe(0);
        expect(gaius.memories.length).toBe(1);
    });

    it(`caps memories at MAX_ENTITY_MEMORIES (${MAX_ENTITY_MEMORIES}), dropping the oldest and keeping the newest`, () => {
        const makeMemory = (i: number): Memory => ({
            turn: i, event_description: `Old event ${i}`, emotional_impact: 'Notable', involved_entities: [],
        });
        const target = mockEntities.find(e => e.entity_id === 'maximinus_thrax')!;
        target.memories = Array.from({ length: MAX_ENTITY_MEMORIES }, (_, i) => makeMemory(i));

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push(deepCopy(worldNewsDelta));

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax')!;

        expect(entity.memories.length).toBe(MAX_ENTITY_MEMORIES);
        // The oldest was dropped...
        expect(entity.memories[0].event_description).toBe('Old event 1');
        expect(entity.memories.some(m => m.event_description === 'Old event 0')).toBe(false);
        // ...and the newest is the fresh perceived memory.
        expect(entity.memories[MAX_ENTITY_MEMORIES - 1].event_description).toBe(WORLD_NEWS_LINE);
    });

    it(`repairs a legacy over-long memory list (MAX + 20) down to exactly MAX in a single write, keeping the newest`, () => {
        // A save written before the bound existed can carry far more than
        // MAX_ENTITY_MEMORIES; one new write must trim all the way down,
        // not just by one - pins the splice(0, length - MAX) math.
        const overflow = 20;
        const makeMemory = (i: number): Memory => ({
            turn: i, event_description: `Old event ${i}`, emotional_impact: 'Notable', involved_entities: [],
        });
        const target = mockEntities.find(e => e.entity_id === 'maximinus_thrax')!;
        target.memories = Array.from({ length: MAX_ENTITY_MEMORIES + overflow }, (_, i) => makeMemory(i));

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push(deepCopy(worldNewsDelta));

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax')!;

        expect(entity.memories.length).toBe(MAX_ENTITY_MEMORIES);
        // The oldest (overflow + 1) entries are gone; the survivors start
        // right after them and end with the fresh perceived memory.
        expect(entity.memories[0].event_description).toBe(`Old event ${overflow + 1}`);
        expect(entity.memories[MAX_ENTITY_MEMORIES - 1].event_description).toBe(WORLD_NEWS_LINE);
    });

    it('does not drop anything when a memory write lands exactly on the cap', () => {
        const makeMemory = (i: number): Memory => ({
            turn: i, event_description: `Old event ${i}`, emotional_impact: 'Notable', involved_entities: [],
        });
        const target = mockEntities.find(e => e.entity_id === 'maximinus_thrax')!;
        target.memories = Array.from({ length: MAX_ENTITY_MEMORIES - 1 }, (_, i) => makeMemory(i));

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push(deepCopy(worldNewsDelta));

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax')!;

        expect(entity.memories.length).toBe(MAX_ENTITY_MEMORIES);
        expect(entity.memories[0].event_description).toBe('Old event 0');
        expect(entity.memories[MAX_ENTITY_MEMORIES - 1].event_description).toBe(WORLD_NEWS_LINE);
    });
  });

  // --- Write-site bounds on relationship interaction logs ---
  describe('recent_interactions cap', () => {
    it(`caps recent_interactions at MAX_RECENT_INTERACTIONS (${MAX_RECENT_INTERACTIONS}), dropping the oldest and keeping the newest`, () => {
        const emperor = mockEntities.find(e => e.entity_id === 'severus_alexander')!;
        emperor.relationships['maximinus_thrax'].recent_interactions =
            Array.from({ length: MAX_RECENT_INTERACTIONS }, (_, i) => `Turn ${i}: old interaction ${i}`);

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
            type: 'relation',
            key: 'severus_alexander:maximinus_thrax:trust_level',
            delta: -1,
            reason: 'A public insult',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const interactions = updatedEntities.find(e => e.entity_id === 'severus_alexander')!
            .relationships['maximinus_thrax'].recent_interactions;

        expect(interactions.length).toBe(MAX_RECENT_INTERACTIONS);
        // The oldest was dropped...
        expect(interactions[0]).toBe('Turn 1: old interaction 1');
        expect(interactions).not.toContain('Turn 0: old interaction 0');
        // ...and the newest is the fresh interaction line.
        expect(interactions[MAX_RECENT_INTERACTIONS - 1]).toBe('Turn 1: A public insult');
    });

    it(`repairs a legacy over-long interaction list (MAX + 20) down to exactly MAX in a single write, keeping the newest`, () => {
        // Same legacy-repair contract as the memories cap: one new write
        // trims an over-long pre-bound list all the way to the cap.
        const overflow = 20;
        const emperor = mockEntities.find(e => e.entity_id === 'severus_alexander')!;
        emperor.relationships['maximinus_thrax'].recent_interactions =
            Array.from({ length: MAX_RECENT_INTERACTIONS + overflow }, (_, i) => `Turn ${i}: old interaction ${i}`);

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
            type: 'relation',
            key: 'severus_alexander:maximinus_thrax:trust_level',
            delta: -1,
            reason: 'A public insult',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const interactions = updatedEntities.find(e => e.entity_id === 'severus_alexander')!
            .relationships['maximinus_thrax'].recent_interactions;

        expect(interactions.length).toBe(MAX_RECENT_INTERACTIONS);
        expect(interactions[0]).toBe(`Turn ${overflow + 1}: old interaction ${overflow + 1}`);
        expect(interactions[MAX_RECENT_INTERACTIONS - 1]).toBe('Turn 1: A public insult');
    });

    it('does not drop anything when an interaction write lands exactly on the cap', () => {
        const emperor = mockEntities.find(e => e.entity_id === 'severus_alexander')!;
        emperor.relationships['maximinus_thrax'].recent_interactions =
            Array.from({ length: MAX_RECENT_INTERACTIONS - 1 }, (_, i) => `Turn ${i}: old interaction ${i}`);

        const adjudication = deepCopy(baseAdjudication);
        adjudication.deltas.push({
            type: 'relation',
            key: 'severus_alexander:maximinus_thrax:trust_level',
            delta: -1,
            reason: 'A public insult',
        });

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const interactions = updatedEntities.find(e => e.entity_id === 'severus_alexander')!
            .relationships['maximinus_thrax'].recent_interactions;

        expect(interactions.length).toBe(MAX_RECENT_INTERACTIONS);
        expect(interactions[0]).toBe('Turn 0: old interaction 0');
        expect(interactions[MAX_RECENT_INTERACTIONS - 1]).toBe('Turn 1: A public insult');
    });
  });

  // --- Entity Additions and Removals ---
  describe('Entity Additions and Removals', () => {
    const newEntity: Entity = {
        entity_id: "new_gladiator", name: "New Gladiator", entity_type: "individual", status: "alive", position: "Champion", location: "The Suburra",
        short_term_goals: [], long_term_ambitions: [], current_state_narrative: "", relationships: {}, memories: [], resources: {}, visibility_network: []
    };

    it('should add a new entity to the game state', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.add_entities = [newEntity];
        
        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        
        expect(updatedEntities.length).toBe(mockEntities.length + 1);
        expect(updatedEntities.find(e => e.entity_id === 'new_gladiator')).toBeDefined();
    });

    it('should remove an entity and clean up its relationships', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.remove_entities = ['gaius_pontius_magnus'];

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

        expect(updatedEntities.length).toBe(mockEntities.length - 1);
        expect(updatedEntities.find(e => e.entity_id === 'gaius_pontius_magnus')).toBeUndefined();
        
        const emperor = updatedEntities.find(e => e.entity_id === 'severus_alexander');
        expect(emperor?.relationships['gaius_pontius_magnus']).toBeUndefined();
    });

    it('should handle both adding and removing entities in the same turn', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.add_entities = [newEntity];
        adjudication.remove_entities = ['gaius_pontius_magnus'];

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);

        expect(updatedEntities.length).toBe(mockEntities.length); // 3 + 1 - 1 = 3
        expect(updatedEntities.find(e => e.entity_id === 'new_gladiator')).toBeDefined();
        expect(updatedEntities.find(e => e.entity_id === 'gaius_pontius_magnus')).toBeUndefined();
    });
  });
});

// applyEventChoiceDeltas (events/engine.ts) shares applyDeltas' state-transition
// logic for authored event choices; these tests cover the turnNumber param
// specifically (the memory-stamp bug described above applyEventChoiceDeltas).
describe('applyEventChoiceDeltas', () => {
  let mockEntities: Entity[];
  let mockWorldState: WorldState;

  beforeEach(() => {
    const initialState = getMockInitialState();
    mockEntities = initialState.entities;
    mockWorldState = initialState.worldState;
  });

  const baseChoice: PlayerEventChoice = {
    text: 'Test choice',
    description: 'A test event choice',
    deltas: [],
  };

  it('falls back to currentWorldState.week for the memory stamp when turnNumber is omitted', () => {
    const choice = deepCopy(baseChoice);
    choice.deltas.push({
      type: 'relation',
      key: 'severus_alexander:maximinus_thrax:trust_level',
      delta: -1,
      reason: 'A cold dismissal',
    });
    const player = mockEntities.find(e => e.entity_id === 'severus_alexander')!;

    const { updatedEntities } = applyEventChoiceDeltas(choice, player, mockEntities, mockWorldState);
    const emperor = updatedEntities.find(e => e.entity_id === 'severus_alexander');

    expect(emperor?.relationships['maximinus_thrax'].recent_interactions).toContain(
      `Turn ${mockWorldState.week}: A cold dismissal`
    );
  });

  it('stamps the memory with an explicitly-passed turnNumber instead of falling back to week', () => {
    const choice = deepCopy(baseChoice);
    choice.deltas.push({
      type: 'relation',
      key: 'severus_alexander:maximinus_thrax:trust_level',
      delta: -1,
      reason: 'A cold dismissal',
    });
    const player = mockEntities.find(e => e.entity_id === 'severus_alexander')!;
    const explicitTurnNumber = 7; // deliberately different from mockWorldState.week (1)

    const { updatedEntities } = applyEventChoiceDeltas(choice, player, mockEntities, mockWorldState, explicitTurnNumber);
    const emperor = updatedEntities.find(e => e.entity_id === 'severus_alexander');

    expect(emperor?.relationships['maximinus_thrax'].recent_interactions).toContain(
      `Turn ${explicitTurnNumber}: A cold dismissal`
    );
    expect(emperor?.relationships['maximinus_thrax'].recent_interactions).not.toContain(
      `Turn ${mockWorldState.week}: A cold dismissal`
    );
  });
});