/**
 * @vitest-environment jsdom
 */
// Note: This test file is written with Vitest/Jest syntax.
// You will need to set up a test runner in your project to execute these tests.
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAdjudication } from '../ai/core/engine';
import { getMockInitialState } from './mockData';
import { Entity, WorldState, Adjudication, Report } from '../types';

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
  });

  // --- Relation Deltas ---
  describe('Relation Deltas', () => {
    it('should change trust level between two entities using the old key format', () => {
      const adjudication = deepCopy(baseAdjudication);
      // Legacy format test
      adjudication.deltas.push({ type: 'relation', key: 'severus_alexander:maximinus_thrax', delta: 3, reason: 'Successful negotiation' });

      const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
      const entityA = updatedEntities.find(e => e.entity_id === 'severus_alexander');
      const entityB = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');

      expect(entityA?.relationships['maximinus_thrax'].trust_level).toBe(-4); // -7 + 3
      expect(entityB?.relationships['severus_alexander'].trust_level).toBe(-5); // -8 + 3
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
        const newRegionState = { stability: 'Peaceful', controlling_faction: null, current_events: ['A new market has opened.'] };
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

  // --- Headlines ---
  describe('Headlines', () => {
    it('should add a memory to an entity mentioned in a headline', () => {
        const adjudication = deepCopy(baseAdjudication);
        adjudication.headlines.push("A shocking proclamation by Maximinus Thrax has stunned the city.");

        const { updatedEntities } = applyAdjudication(adjudication, mockEntities, mockWorldState, mockReports);
        const entity = updatedEntities.find(e => e.entity_id === 'maximinus_thrax');
        
        expect(entity?.memories.length).toBe(1);
        expect(entity?.memories[0].event_description).toBe("A shocking proclamation by Maximinus Thrax has stunned the city.");
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