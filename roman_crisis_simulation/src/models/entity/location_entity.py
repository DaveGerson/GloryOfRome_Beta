from pydantic import Field
from typing import Optional, List

from .base_entity import BaseEntity

class LocationEntity(BaseEntity):
    """
    Represents a physical place in the game world.
    Locations are static entities that serve as the stage for events and the container for other entities.
    """
    entity_type: str = Field("location", description="Hardcoded to 'location'.")
    capacity: Optional[int] = Field(None, description="The maximum number of individuals the location can accommodate.")
    contained_entities: List[str] = Field(default_factory=list, description="A list of entity_id's for all entities currently at this location.")