# ====================================================================
# FILE: roman_crisis_simulation/src/simulation/state_manager.py
# ====================================================================

from typing import Dict, Optional, Union
from ..models.entity import BaseEntity
from ..models.edges import Event, Obligation


# Note: In a real implementation, this would be initialized with all game objects
# from a scenario file. For this example, we'll populate it manually.

class SimulationState:
    """
    A singleton class that holds the entire state of the game world.
    It acts as an in-memory database for all entity and edge objects.
    """

    def __init__(self):
        self.entities: Dict[str, BaseEntity] = {}
        self.events: Dict[str, Event] = {}
        self.obligations: Dict[str, Obligation] = {}

    def get_entity(self, entity_id: str) -> Optional[BaseEntity]:
        """Retrieves an entity object by its ID."""
        return self.entities.get(entity_id)

    def add_entity(self, entity: BaseEntity):
        """Adds a new entity to the simulation."""
        if entity.entity_id in self.entities:
            raise ValueError(f"Entity with ID {entity.entity_id} already exists.")
        self.entities[entity.entity_id] = entity

    # ... other methods to add/get events, obligations, etc.


# Instantiate a single global state object for the simulation to use.
SIMULATION_STATE = SimulationState()