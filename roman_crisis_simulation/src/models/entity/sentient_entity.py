from pydantic import Field
from typing import Dict, List

from .base_entity import BaseEntity
from ..supporting.memory import Memory
from ..supporting.relationship import Relationship

class SentientEntity(BaseEntity):
    """
    An abstract class for entities capable of thought, memory, and social interaction.
    It serves as the foundation for both individuals and groups.
    """
    memories: List[Memory] = Field(default_factory=list, description="A record of significant past events experienced by the entity.")
    relationships: Dict[str, Relationship] = Field(default_factory=dict, description="The entity's social connections and dispositions towards others.")
    short_term_goals: List[str] = Field(default_factory=list, description="Immediate objectives the entity is trying to achieve.")
    long_term_ambitions: List[str] = Field(default_factory=list, description="The overarching life goals or strategic objectives of the entity.")
    current_state_narrative: str = Field(..., description="A brief, LLM-generated narrative describing the entity's current situation and emotional state.")