from pydantic import BaseModel, Field
from typing import List

class Memory(BaseModel):
    """
    Represents an entity's recollection of a specific past event.
    """
    turn: int = Field(..., description="The simulation turn on which the event occurred.")
    event_description: str = Field(..., description="A concise, factual description of what happened.")
    emotional_impact: str = Field(..., description="The emotional response to the memory (e.g., 'gratitude', 'betrayal', 'pride').")
    involved_entities: List[str] = Field(default_factory=list, description="A list of entity_id's for all other entities involved in the memory.")
