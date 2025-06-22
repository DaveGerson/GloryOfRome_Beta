from pydantic import Field
from typing import Optional

from .sentient_entity import SentientEntity
from ..supporting.personality import PersonalityTraits

class IndividualEntity(SentientEntity):
    """
    Represents a single person. This is the primary agent of action and change in the simulation.
    """
    entity_type: str = Field("individual", description="Hardcoded to 'individual'.")
    position: Optional[str] = Field(None, description="The individual's formal role or title in society (e.g., 'Consul', 'Legate').")
    personality: PersonalityTraits = Field(..., description="A set of scores defining the individual's character and behavioral tendencies.")
