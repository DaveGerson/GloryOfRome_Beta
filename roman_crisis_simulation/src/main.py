# roman_crisis_simulation/src/main.py
# The main entry point for the Roman Crisis Simulation.

import json
from simulation.state_manager import StateManager
from tests.fixtures.turn_one_data import generate_turn_one_entities, generate_turn_one_edges


def setup_scenario():
    """
    Sets up the initial game state for Turn 1 by loading data from the fixtures.
    This ensures consistency between testing and live simulation runs.
    """
    print("Setting up the initial scenario for Turn 1...")

    # Use the fixture functions to get the validated base data
    entities_dict = generate_turn_one_entities()
    edges_list = generate_turn_one_edges(entities_dict)

    # The StateManager expects a list of entities, not a dictionary
    entities_list = list(entities_dict.values())

    # Initialize the state manager with this data
    state_manager = StateManager(entities=entities_list, edges=edges_list)

    print(
        f"Successfully loaded {state_manager.get_entity_count()} entities and {state_manager.get_edge_count()} edges.")
    print("Scenario setup complete.")
    return state_manager


def run_simulation(state_manager):
    """
    A placeholder for the main simulation loop.
    """
    print("\n--- Starting Simulation ---")
    player_character = state_manager.get_entity_by_id("char_player")

    if player_character:
        print(f"Player Character: {player_character.name}")
        print(f"Description: {player_character.description}")
        print("Personality Traits:")
        for trait in player_character.personality:
            print(f"- {trait.name}: {trait.description}")
    else:
        print("Could not find the player character!")

    # Here you would implement the main game loop, processing turns,
    # handling player input, and calling the LLM services.
    print("\n(Simulation loop would run here)")
    print("--- Simulation Ended ---")


if __name__ == "__main__":
    """
    Main execution block.
    """
    # 1. Set up the initial state of the world.
    game_state = setup_scenario()

    # 2. Run the main simulation loop.
    run_simulation(game_state)

    # 3. (Optional) Save the final state.
    # final_state_json = game_state.to_json()
    # with open("final_state.json", "w") as f:
    #     f.write(final_state_json)
    # print("\nFinal game state saved to final_state.json")