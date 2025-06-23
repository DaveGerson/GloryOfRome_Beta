from pydantic import BaseModel, Field

class Obligation(BaseModel):
    """
    Represents a specific, transactional duty or debt between two entities. A directed edge.
    """
    obligation_id: str = Field(..., description="A unique identifier for the obligation.")
    debtor_id: str = Field(..., description="The entity_id of the entity that owes the obligation.")
    creditor_id: str = Field(..., description="The entity_id of the entity to whom the obligation is owed.")
    obligation_type: str = Field(..., description="The nature of the debt (e.g., 'financial_debt', 'political_favor', 'oath_of_loyalty').")
    status: str = Field(..., description="The current state of the obligation (e.g., 'pending', 'fulfilled', 'broken').")
    description: str = Field(..., description="A description of what is owed.")