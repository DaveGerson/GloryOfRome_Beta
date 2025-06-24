# roman_crisis_simulation/src/simulation/state_updater.py
# This module defines the StateUpdater class, responsible for applying validated changes to the game state.

from typing import Dict, Any, Type, List
from pydantic import ValidationError

from .state_manager import StateManager
from ..models.entity import BaseEntity, IndividualEntity, GroupEntity, LocationEntity
from ..models.edges import BaseEdge, Relationship, Obligation

# --- Model Factories ---
# These dictionaries map a string identifier to a Pydantic model class.
# This allows us to dynamically create the correct model type from the data in a state patch.

ENTITY_TYPE_MAP: Dict[str, Type[BaseEntity]] = {
    "individual": IndividualEntity,
    "group": GroupEntity,
    "location": LocationEntity,
}

EDGE_TYPE_MAP: Dict[str, Type[BaseEdge]] = {
    "relationship": Relationship,
    "obligation": Obligation,
}


class StateUpdater:
    """
    Handles the validation and application of state patches to the StateManager.
    This class is the gatekeeper for all state changes, ensuring that modifications
    proposed by the AI adhere to the rules and structure of the simulation.
    It uses modern Pydantic features for safe, model-aware updates.
    """

    def __init__(self, state_manager: StateManager):
        """
        Initializes the StateUpdater with a reference to the main StateManager.

        Args:
            state_manager: The active StateManager instance for the simulation.
        """
        self.state_manager = state_manager

    def _validate_patch(self, patch: Dict[str, Any]) -> bool:
        """
        Validates a state patch against game rules before applying it.
        This is a critical step to prevent the AI from making invalid or nonsensical changes.
        """
        # Validate entity updates
        for update_data in patch.get("entity_updates", []):
            entity_id = update_data.get("id")
            if not self.state_manager.get_entity_by_id(entity_id):
                print(f"Validation Error: Entity '{entity_id}' in 'entity_updates' not found.")
                return False

        # Validate new edges
        for edge_data in patch.get("new_edges", []):
            source_id = edge_data.get("source")
            target_id = edge_data.get("target")
            if not self.state_manager.get_entity_by_id(source_id):
                print(f"Validation Error: Source entity '{source_id}' for new edge not found.")
                return False
            if not self.state_manager.get_entity_by_id(target_id):
                print(f"Validation Error: Target entity '{target_id}' for new edge not found.")
                return False

        # Add more validation here: check resources, locations, action validity, etc.
        return True

    def apply_state_patch(self, patch: Dict[str, List[Dict[str, Any]]]) -> bool:
        """
        Applies a validated state patch to the StateManager.

        The patch format is a dictionary containing lists of operations:
        - 'entity_updates': A list of modifications to existing entities.
        - 'new_entities': A list of new entities to create.
        - 'new_edges': A list of new edges to create.

        Args:
            patch: The dictionary containing the state change instructions.

        Returns:
            True if the patch was applied successfully, False otherwise.
        """
        if not self._validate_patch(patch):
            print("State patch failed validation. No changes were applied.")
            return False

        try:
            # 1. Apply updates to existing entities
            for update_data in patch.get("entity_updates", []):
                entity_id = update_data["id"]
                updates_dict = update_data["updates"]
                entity = self.state_manager.get_entity_by_id(entity_id)
                if entity:
                    # Use Pydantic's `model_copy` for a safe, type-aware update.
                    # This creates a new model instance with the updated fields.
                    updated_entity = entity.model_copy(update=updates_dict)
                    self.state_manager.add_entity(updated_entity)  # `add_entity` overwrites existing

            # 2. Add new entities
            for entity_data in patch.get("new_entities", []):
                entity_type_str = entity_data.pop("entity_type", None)
                EntityModel = ENTITY_TYPE_MAP.get(entity_type_str)
                if EntityModel:
                    new_entity = EntityModel(**entity_data)
                    self.state_manager.add_entity(new_entity)
                else:
                    print(f"Warning: Unknown entity type '{entity_type_str}' in patch. Skipping.")

            # 3. Add new edges
            for edge_data in patch.get("new_edges", []):
                edge_type_str = edge_data.pop("edge_type", None)
                EdgeModel = EDGE_TYPE_MAP.get(edge_type_str)
                if EdgeModel:
                    new_edge = EdgeModel(**edge_data)
                    self.state_manager.add_edge(new_edge)
                else:
                    print(f"Warning: Unknown edge type '{edge_type_str}' in patch. Skipping.")

        except ValidationError as e:
            print(f"Error applying patch: A model validation error occurred.\n{e}")
            # In a real application, you might want to roll back any partial changes here.
            return False
        except Exception as e:
            print(f"An unexpected error occurred while applying the patch: {e}")
            return False

        print("State patch applied successfully.")
        return True
