from pydantic import Field
from typing import List
from typing import Optional

from .sentient_entity import SentientEntity
from ..supporting.personality import PersonalityTrait

class IndividualEntity(SentientEntity):
    """
    Represents a single person. This is the primary agent of action and change in the simulation.
    """
    personality_traits: List[PersonalityTrait] = Field(default_factory=list, description="A list of descriptive personality traits.")


