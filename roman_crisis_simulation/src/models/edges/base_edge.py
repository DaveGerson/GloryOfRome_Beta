"""
This module defines the BaseEdge, a foundational data model for representing
all forms of relationships and interactions between entities.
"""
import uuid
from pydantic import BaseModel, Field
from typing import List

class BaseEdge(BaseModel):
    """
    The core data model for any interaction or relationship (an "edge")
    between two or more entities (the "nodes").

    This new base class unifies Events, Obligations, and Relationships,
    allowing them to be treated as a single collection of historical facts
    and ongoing connections.
    """
    edge_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for this specific edge instance.")
    turn_created: int = Field(..., description="The simulation turn number when this edge was created.")
    description: str = Field(..., description="A prose description of the edge (e.g., 'a formal alliance', 'a secret debt').")
    participants: List[str] = Field(..., min_length=2, description="A list of entity IDs involved in this edge.")

    class Config:
        """Pydantic configuration."""
        extra = 'forbid'

