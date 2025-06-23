from pydantic import BaseModel, Field
from typing import Dict

# This type represents an external facing event that occured between two individuals.
class Event(BaseModel):
    """
    A record of something that happens at a specific point in time, involving multiple
    entities and producing a set of outcomes. Events are the primary drivers of change.
    """
    event_id: str = Field(..., description="A unique identifier for the event.")
    turn: int = Field(..., description="The simulation turn on which the event occurred.")
    event_type: str = Field(..., description="The category of the event (e.g., 'Marriage', 'Assassination', 'Senate Vote').")
    description: str = Field(..., description="A narrative description of the event and its outcome.")
    participants: Dict[str, str] = Field(..., description="A dictionary mapping entity_id to the role they played (e.g., 'perpetrator', 'victim').")
    location: str = Field(..., description="The entity_id of the LocationEntity where the event took place.")