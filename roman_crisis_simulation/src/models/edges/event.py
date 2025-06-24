"""
This module defines the Event edge, a record of something that happened
at a specific time, involving specific entities.
"""
from pydantic import Field
from typing import List, Dict, Optional
from .base_edge import BaseEdge
from ..supporting.state_change import StateChange

class Event(BaseEdge):
    """
    Represents a discrete event that occurred in the simulation.

    Updates:
        - Inherits from BaseEdge.
        - Added 'structured_outcomes' to provide explicit, machine-readable
          consequences for an event.
        - Added 'perceptions' to model how different entities uniquely
          experience and remember the same event. This replaces the need
          for each entity to have its own modified copy of the event.
    """
    outcome_narrative: str = Field(..., description="A prose description of what happened as a result of the event.")
    structured_outcomes: List[StateChange] = Field(default_factory=list, description="A list of concrete state changes that occurred as a result of the event.")
    perceptions: Dict[str, str] = Field(default_factory=dict, description="A mapping of entity_id to their personal, narrative perception of the event.")
    location: Optional[str] = Field(None, description="The ID of the LocationEntity where the event took place.")

