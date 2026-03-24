// This file contains mock data for testing purposes.
// It provides a consistent starting state for the game engine tests.

import { Entity, WorldState } from '../types';

export const getMockInitialState = (): { entities: Entity[], worldState: WorldState } => ({
  entities: [
    {
      entity_id: "severus_alexander",
      name: "Severus Alexander",
      entity_type: "individual", status: "alive", position: "Emperor", location: "Palatine Hill",
      short_term_goals: [], long_term_ambitions: [],
      current_state_narrative: "",
      relationships: {
        "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "imminent threat", trust_level: -7, respect_level: 3, perceived_threat: 9, recent_interactions: [] },
        "gaius_pontius_magnus": { entity_id: "gaius_pontius_magnus", relationship_type: "uneasy ally", trust_level: 4, respect_level: 3, recent_interactions: [] },
      },
      memories: [],
      resources: { denarii: 50000, deep_analyses: 4, investigations: 1 },
      visibility_network: ["maximinus_thrax", "gaius_pontius_magnus"]
    },
    {
      entity_id: "maximinus_thrax",
      name: "Maximinus Thrax",
      entity_type: "individual", status: "alive", position: "General", location: "Praetorian Camp",
      short_term_goals: [], long_term_ambitions: [],
      current_state_narrative: "",
      relationships: {
        "severus_alexander": { entity_id: "severus_alexander", relationship_type: "rival", trust_level: -8, respect_level: -6, recent_interactions: [] }
      },
      memories: [],
      resources: { legion_support: 85 },
      visibility_network: ["severus_alexander"]
    },
     {
        entity_id: "gaius_pontius_magnus",
        name: "Gaius Pontius Magnus",
        entity_type: "individual", status: "alive", position: "Senator", location: "The Curia",
        short_term_goals: [], long_term_ambitions: [],
        current_state_narrative: "",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "uneasy ally", trust_level: 4, respect_level: 3, recent_interactions: [] }
        },
        memories: [],
        resources: { denarii: 250000 },
        visibility_network: ["severus_alexander", "maximinus_thrax"]
    },
  ],
  worldState: {
    year: 235,
    week: 1,
    economic_stability: 'Stable',
    political_climate: 'Volatile',
    regions: {
      'Palatine Hill': { stability: 'Tense', controlling_faction: 'severus_alexander', current_events: [] },
      'Praetorian Camp': { stability: 'Wavering', controlling_faction: 'military_cabal', current_events: [] },
    }
  }
});