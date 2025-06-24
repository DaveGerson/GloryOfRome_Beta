"""
This module defines the BaseEntity, the foundational data model for all objects
in the simulation that have an independent existence.
"""
import uuid
from typing import Dict, Union
from pydantic import BaseModel, Field


class BaseEntity(BaseModel):
    """
    The core data model for any entity in the simulation.

    Attributes:
        id (str): A unique identifier for the entity.
        name (str): The name of the entity.
        description (str): A text description of the entity.
        resources (Dict[str, Union[int, float]]): A dictionary of resources held by the entity.

    Bug Fix:
        - The 'id' field is now explicitly defined as a string generated from uuid.uuid4().
          This improves serialization and compatibility compared to using a raw UUID object.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the entity.")
    name: str = Field(..., description="The name of the entity, e.g., 'Julius Caesar' or 'The Senate'.")
    description: str = Field(..., description="A brief, static description of the entity.")
    resources: Dict[str, Union[int, float]] = Field(default_factory=dict,
                                                    description="A dictionary of resources held by this entity.")

    class Config:
        """Pydantic configuration."""
        extra = 'forbid'

