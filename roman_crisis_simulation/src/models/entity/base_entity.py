from pydantic import BaseModel, Field
from typing import Dict, List, Union

class BaseEntity(BaseModel):
    """
    The foundational class for all entities in the simulation.
    It contains the common attributes shared by all entity types.
    """
    entity_id: str = Field(..., description="The unique identifier for the entity (e.g., 'senator_gaius_julius').")
    entity_type: str = Field(..., description="The specific type of the entity (e.g., 'individual', 'group', 'location').")
    status: str = Field(..., description="The current operational status (e.g., 'active', 'inactive', 'destroyed').")
    location: str = Field(..., description="The entity_id of the LocationEntity where this entity currently resides.")
    resources: Dict[str, Union[int, float]] = Field(default_factory=dict, description="A dictionary of fungible assets controlled by the entity (e.g., gold, influence, grain).")
    visibility_network: List[str] = Field(default_factory=list, description="Defines which other entities' information this entity has access to.")
