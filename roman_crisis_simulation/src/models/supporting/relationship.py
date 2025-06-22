from pydantic import BaseModel, Field
from typing import List

class Relationship(BaseModel):
    """
    Defines a social link between two SentientEntity instances.
    """
    entity_id: str = Field(..., description="The target of the relationship.")
    relationship_type: str = Field(..., description="The nature of the connection (e.g., 'family', 'ally', 'rival', 'patron', 'client').")
    trust_level: int = Field(..., ge=-10, le=10, description="A score from -10 (deep hatred) to 10 (unwavering trust).")
    recent_interactions: List[str] = Field(default_factory=list, description="A log of recent significant events between the two entities.")
