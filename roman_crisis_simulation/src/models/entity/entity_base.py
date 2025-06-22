from typing import Dict, List, Optional, Union
from pydantic import BaseModel, Field


class PersonalityTraits(BaseModel):
    """
    Defines the personality traits of an individual entity.
    These traits influence the entity's decision-making process.
    """
    ambition: int = Field(..., ge=1, le=10, description="Drive for power and advancement")
    paranoia: int = Field(..., ge=1, le=10, description="Suspicion of others' motives")
    loyalty: int = Field(..., ge=1, le=10, description="Commitment to allies and oaths")
    cunning: int = Field(..., ge=1, le=10, description="Political intelligence and scheming")
    honor: int = Field(..., ge=1, le=10, description="Adherence to Roman virtues")


class Relationship(BaseModel):
    """
    Represents the relationship between two entities.
    This includes the nature of the relationship and the level of trust.
    """
    entity_id: str = Field(..., description="The unique identifier of the other entity in the relationship.")
    relationship_type: str = Field(...,
                                   description="The type of relationship (e.g., family, ally, rival, subordinate).")
    trust_level: int = Field(..., ge=-10, le=10,
                             description="A rating of trust from -10 (deeply distrustful) to 10 (unbreakably loyal).")
    recent_interactions: List[str] = Field(default_factory=list,
                                           description="A list of recent significant interactions.")


class Memory(BaseModel):
    """
    Represents a memory of a specific event from a past turn.
    Memories shape an entity's future actions and emotional state.
    """
    turn: int = Field(..., description="The turn number when the event occurred.")
    event_description: str = Field(..., description="A description of the event that took place.")
    emotional_impact: str = Field(..., description="The emotional effect this memory has on the entity.")
    involved_entities: List[str] = Field(default_factory=list,
                                         description="A list of other entities involved in the event.")


class Entity(BaseModel):
    """
    The core data model for any character or group in the simulation.
    This can represent an individual (like a senator) or a collective (like a legion).
    """
    entity_id: str = Field(..., description="The unique identifier for the entity (e.g., 'severus_alexander').")
    entity_type: str = Field(..., description="The type of entity, either 'individual' or 'group'.")
    status: str = Field(..., description="The current status of the entity (e.g., alive, dead, exiled, missing).")
    position: Optional[str] = Field(None, description="The entity's current role, title, or position in society.")
    location: str = Field(..., description="The current physical location of the entity within the game world.")

    # --- Attributes for 'individual' entities ---
    personality: Optional[PersonalityTraits] = Field(None,
                                                     description="The personality profile for an individual entity.")

    # --- Attributes for 'group' entities ---
    size: Optional[int] = Field(None, description="The approximate number of members in a group entity.")
    culture: Optional[Dict[str, List[str]]] = Field(None,
                                                    description="The cultural values and norms of a group entity.")

    # --- Shared attributes for all entities ---
    relationships: Dict[str, Relationship] = Field(default_factory=dict,
                                                   description="A dictionary of the entity's relationships with others.")
    memories: List[Memory] = Field(default_factory=list, description="A list of the entity's significant memories.")
    resources: Dict[str, Union[int, float]] = Field(default_factory=dict,
                                                    description="The resources controlled by the entity (e.g., gold, influence).")
    visibility_network: List[str] = Field(default_factory=list,
                                          description="Defines what information the entity has access to.")

    # Dynamic state description updated each turn
    current_state_narrative: str = Field(
        ...,
        description="A 5-sentence narrative describing the entity's current physical and emotional state."
    )

    # Goal evolution
    short_term_goals: List[str] = Field(default_factory=list, description="Immediate objectives for the upcoming turn.")
    long_term_ambitions: List[str] = Field(default_factory=list,
                                           description="The overarching goals and life ambitions of the entity.")

    # --- Helper methods for updating state ---

    def add_memory(self, turn: int, event: str, impact: str, involved: List[str] = None):
        """Adds a new memory to the entity's list of memories."""
        if involved is None:
            involved = []
        new_memory = Memory(
            turn=turn,
            event_description=event,
            emotional_impact=impact,
            involved_entities=involved
        )
        self.memories.append(new_memory)

    def update_relationship_trust(self, target_entity_id: str, trust_change: int):
        """Updates the trust level with a specific entity."""
        if target_entity_id in self.relationships:
            # Clamp the trust level between -10 and 10
            new_trust = self.relationships[target_entity_id].trust_level + trust_change
            self.relationships[target_entity_id].trust_level = max(-10, min(10, new_trust))
        else:
            # This could be a place to create a new relationship if one doesn't exist
            print(f"Warning: No existing relationship with {target_entity_id} to update.")

    def add_recent_interaction(self, target_entity_id: str, interaction_description: str):
        """Adds a description of a recent interaction to a relationship."""
        if target_entity_id in self.relationships:
            self.relationships[target_entity_id].recent_interactions.append(interaction_description)
            # Optional: trim the list to keep it from growing indefinitely
            max_interactions = 10
            if len(self.relationships[target_entity_id].recent_interactions) > max_interactions:
                self.relationships[target_entity_id].recent_interactions.pop(0)
        else:
            print(f"Warning: No existing relationship with {target_entity_id} to add interaction to.")
