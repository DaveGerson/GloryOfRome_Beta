from models.entity import IndividualEntity
from models.supporting import PersonalityTraits
from simulation.state_manager import SIMULATION_STATE
from simulation.simulation_controller import SimulationController


def setup_scenario():
    """Creates a simple scenario with two entities."""
    print("--- SETTING UP SCENARIO ---")
    caesar = IndividualEntity(
        entity_id="caesar",
        entity_type="individual",
        status="active",
        location="senate_house",
        resources={"gold": 500},
        personality=PersonalityTraits(ambition=10, paranoia=5, loyalty=6, cunning=8, honor=7),
        current_state_narrative="At the peak of his power, Caesar feels invincible."
    )
    brutus = IndividualEntity(
        entity_id="brutus",
        entity_type="individual",
        status="active",
        location="senate_house",
        resources={"gold": 100},
        personality=PersonalityTraits(ambition=7, paranoia=6, loyalty=8, cunning=7, honor=9),
        current_state_narrative="Brutus is deeply troubled by Caesar's growing power."
    )
    SIMULATION_STATE.add_entity(caesar)
    SIMULATION_STATE.add_entity(brutus)
    print("Scenario setup complete. Entities: Caesar, Brutus")


if __name__ == "__main__":
    setup_scenario()
    controller = SimulationController(SIMULATION_STATE)
    controller.run_turn()

    # You can inspect the final state to see the results
    final_caesar_state = SIMULATION_STATE.get_entity("caesar")
    print(f"\nFinal state of Caesar: STATUS = {final_caesar_state.status}")

