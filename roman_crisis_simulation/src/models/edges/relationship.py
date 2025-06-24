"""
This module defines the Relationship edge, representing the social connection
between two or more entities.
"""
from pydantic import Field
from typing import Dict
from .base_edge import BaseEdge

class Relationship(BaseEdge):
    """
    Represents the state of a social relationship at a specific point in time.

    Instead of a single, mutable relationship object, new Relationship
    edges can be created to represent the evolution of the connection
    between entities over time.

    Updates:
        - Now inherits from BaseEdge.
        - 'trust_levels' is a dictionary to support non-reciprocal trust.
    """
    # This dictionary allows for non-reciprocal trust.
    # For example, trust_levels['entity_A']['entity_B'] = 8
    trust_levels: Dict[str, Dict[str, int]] = Field(..., description="A nested dictionary representing trust, e.g., {entity_A_id: {entity_B_id: trust_level}}.")
    relationship_type: str = Field("social", description="The type of relationship (e.g., 'family', 'political', 'rivalry').")

