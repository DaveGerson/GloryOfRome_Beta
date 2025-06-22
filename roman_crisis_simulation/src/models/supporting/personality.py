from pydantic import BaseModel, Field

class PersonalityTraits(BaseModel):
    """
    Defines the psychological profile of an IndividualEntity. Values range from 1 to 10.
    """
    ambition: int = Field(..., ge=1, le=10, description="The drive for power, wealth, and status.")
    paranoia: int = Field(..., ge=1, le=10, description="The level of suspicion and distrust of others.")
    loyalty: int = Field(..., ge=1, le=10, description="The commitment to allies, patrons, and the state.")
    cunning: int = Field(..., ge=1, le=10, description="Skill in strategy, intrigue, and political maneuvering.")
    honor: int = Field(..., ge=1, le=10, description="Adherence to Roman virtues (`mos maiorum`).")