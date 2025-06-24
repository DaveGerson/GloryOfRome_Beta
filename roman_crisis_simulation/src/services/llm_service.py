from abc import ABC, abstractmethod
from typing import Dict, Any


# Using Pydantic models in the signature is a good practice for type safety
# from src.models.entity.individual_entity import IndividualEntity
# from src.models.supporting.turn_data import TurnData

class LanguageModelService(ABC):
    """
    Abstract base class defining the contract for a language model service.
    This ensures any LLM client, real or mock, can be used interchangeably by the simulation.
    """

    @abstractmethod
    def generate_initial_state(self) -> Dict[str, Any]:
        """
        Generates the entire starting state for the simulation (Turn 0).
        """
        pass

    @abstractmethod
    def get_entity_action(self, entity_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Given the state of a single entity, decide on its next action.

        Args:
            entity_state: The Pydantic model of the entity as a dictionary.

        Returns:
            A dictionary representing the entity's chosen action.
        """
        pass

    @abstractmethod
    def adjudicate_turn(self, turn_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Given the actions of all entities in a turn, determine the outcomes.

        Args:
            turn_data: A dictionary containing all actions taken during the turn.

        Returns:
            A dictionary describing the updated state and narrative events.
        """
        pass