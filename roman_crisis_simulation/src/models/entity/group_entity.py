from pydantic import Field
from typing import Optional, Dict, List

from .sentient_entity import SentientEntity

class GroupEntity(SentientEntity):
    """
    Represents a collection of individuals who share a common purpose or identity.
    A group's actions are an aggregate of its members' will, influenced by its leadership and culture.
    """
    ideology: str = Field(..., description="A prose description of the group's core beliefs, goals, and motivations.")
    culture: Optional[Dict[str, List[str]]] = Field(None, description="The shared values, traditions, and norms of the group.")
    cohesion: str = Field(..., description="A prose description of the group's internal perspectives on key topics that result in a lack of alignment or cohesion.")
    membership_criteria: str = Field("Open", description="A description of the requirements to join this group (e.g., 'By birth', 'Wealthy landowners only', 'Must be elected').")