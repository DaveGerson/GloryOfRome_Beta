"""
This module defines the PersonalityTrait, a more descriptive and narrative-driven
way to represent an entity's character.
"""
from pydantic import BaseModel, Field
from typing import Optional

class PersonalityTrait(BaseModel):
    """
    Represents a single, descriptive personality trait of an individual.

    Instead of a numeric scale, this model uses prose to describe how a
    trait manifests, allowing for more nuanced character portrayals by the LLM.
    """
    name: str = Field(..., description="The name of the personality trait (e.g., 'Ambitious', 'Cautious').")
    description: str = Field(..., description="A prose description of how this trait manifests in the individual.")
    reason: Optional[str] = Field(None, description="An optional explanation for why the entity has this trait, often tied to a past event.")

    class Config:
        """Pydantic configuration."""
        extra = 'forbid'

