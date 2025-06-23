from typing import List
from .state_manager import SimulationState
from .state_updater import StateUpdater
from .agents import EntityAgent, GameMasterAgent
from .data_structures import IntentStatement


class SimulationController:
    """
    Manages the main simulation loop according to the blended turn cycle architecture.
    """

    def __init__(self, state: SimulationState):
        self.state = state
        self.turn_number = 0
        self.game_master = GameMasterAgent()
        self.state_updater = StateUpdater(state)
        self.entity_agents = {entity_id: EntityAgent(entity_id) for entity_id in state.entities}

    def run_turn(self):
        """Executes one full turn of the simulation."""
        print(f"--- STARTING TURN {self.turn_number} ---")

        # === PHASE 1: INTENT DECLARATION ===
        print("\n=== PHASE 1: INTENT DECLARATION ===")
        perception_packets = {
            entity_id: self.game_master.generate_perception_packet(entity_id, self.turn_number, self.state)
            for entity_id in self.state.entities
        }

        intent_statements: List[IntentStatement] = []
        for entity_id, agent in self.entity_agents.items():
            packet = perception_packets[entity_id]
            intent = agent.generate_intent(packet)
            intent_statements.append(intent)

        # === PHASE 2: ADJUDICATION AND RESOLUTION ===
        print("\n=== PHASE 2: ADJUDICATION AND RESOLUTION ===")
        valid_intents = self.game_master.adjudicate_intents(intent_statements)

        state_patches = [self.game_master.parse_intent_to_patch(intent) for intent in valid_intents]

        for patch in state_patches:
            if patch:  # Apply non-empty patches
                # Quick fix for StateUpdater status change which is not additive
                if "entity_updates" in patch:
                    for update in patch["entity_updates"]:
                        if "status" in update["updates"]:
                            entity = self.state.get_entity(update["entity_id"])
                            if entity:
                                entity.status = update["updates"]["status"]

                # self.state_updater.apply_state_patch(patch) # Original call

        print("\n[GAME MASTER] World state has been updated.")

        # === PHASE 3: PERCEPTION GENERATION (for next turn) ===
        print("\n=== PHASE 3: PERCEPTION GENERATION (for next turn's input) ===")
        # The perception packets for the *next* turn are generated here,
        # based on the state *after* resolution.
        next_turn_perceptions = {
            entity_id: self.game_master.generate_perception_packet(entity_id, self.turn_number + 1, self.state)
            for entity_id in self.state.entities
        }

        print("\n--- END OF TURN ---")
        self.turn_number += 1
        # In a real loop, you would pass next_turn_perceptions to the next iteration.
