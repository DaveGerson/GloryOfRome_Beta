from pydantic import Field
from typing import Optional, Dict, List

from .sentient_entity import SentientEntity

class GroupEntity(SentientEntity):
    """
    Represents a collection of individuals who share a common purpose or identity.
    A group's actions are an aggregate of its members' will, influenced by its leadership and culture.
    """
    entity_type: str = Field("group", description="Hardcoded to 'group'.")
    size: Optional[int] = Field(None, description="The approximate number of individuals in the group.")
    culture: Optional[Dict[str, List[str]]] = Field(None, description="The shared values, traditions, and norms of the group.")
