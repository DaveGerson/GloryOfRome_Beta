from pydantic import BaseModel, Field
from typing import List, Dict, Any
from .data_structures import PerceptionPacket, IntentStatement

class EntityAgent:
    """
    A mock agent that decides on an action for a given entity.
    In a real system, this would involve a call to the Gemini API.
    """

    def __init__(self, entity_id: str):
        self.entity_id = entity_id

    def generate_intent(self, perception_packet: PerceptionPacket) -> IntentStatement:
        """
        Receives a PerceptionPacket and returns an IntentStatement.
        This simulates the agent's deliberation process.
        """
        print(f"\n[AGENT] EntityAgent for '{self.entity_id}' is thinking...")
        print(f"  > Received narrative: {perception_packet.narrative_synopsis}")

        # --- MOCK GEMINI CALL FOR ACTION GENERATION ---
        # This is where you would format a prompt with the perception packet
        # and the entity's goals/personality, then call the Gemini API.
        # For now, we return a hardcoded intent based on the recipient.
        if self.entity_id == "brutus":
            return IntentStatement(
                actor_id="brutus",
                high_level_action="Assassinate Caesar to prevent a monarchy.",
                thought_process="Caesar's ambition is too great. He must be stopped for the good of the Republic, even if it means betrayal.",
                specific_interactions=["Stab Caesar in the Senate House."]
            )
        elif self.entity_id == "caesar":
            return IntentStatement(
                actor_id="caesar",
                high_level_action="Accept the title of Dictator for Life.",
                thought_process="The Senate is weak and corrupt. Only with absolute power can I restore order and glory to Rome.",
                specific_interactions=["Give a speech to the Senate accepting perpetual dictatorship."]
            )
        else:
            return IntentStatement(actor_id=self.entity_id, high_level_action="Observe the day's events.",
                                   thought_process="It is best to remain cautious for now.")
        # --- END OF MOCK CALL ---


class GameMasterAgent:
    """
    A mock agent that adjudicates intents and generates perception packets.
    This simulates the "Game Master" role.
    """

    def adjudicate_intents(self, intents: List[IntentStatement]) -> List[IntentStatement]:
        """
        Resolves conflicts between submitted intents.
        For example, an assassination attempt takes precedence over other actions.
        """
        print("\n[GAME MASTER] Adjudicating submitted intents...")
        # --- MOCK CONFLICT RESOLUTION ---
        final_intents = []
        assassination_target = None

        # Find if there is an assassination
        for intent in intents:
            if "ssassinat" in intent.high_level_action:  # Simple check
                # In a real system, this would parse the 'specific_interactions'
                # to find the target. We'll hardcode it for the example.
                assassination_target = "caesar"
                print(f"  > Conflict detected: Assassination of '{assassination_target}' takes precedence.")

        # Filter out actions of the assassinated target
        for intent in intents:
            if intent.actor_id == assassination_target:
                print(f"  > Invalidating intent from '{intent.actor_id}' due to assassination.")
                continue  # Skip this intent
            final_intents.append(intent)

        return final_intents
        # --- END OF MOCK RESOLUTION ---

    def parse_intent_to_patch(self, intent: IntentStatement) -> Dict:
        """
        Translates a single, valid IntentStatement into a JSON State Patch.
        This simulates the "Parser Agent" role.
        """
        print(f"[GAME MASTER] Parsing intent from '{intent.actor_id}'...")
        # --- MOCK GEMINI CALL FOR PARSING ---
        # This is where you'd give the intent prose to Gemini and ask for a
        # structured JSON patch in return.
        if "ssassinat" in intent.high_level_action and intent.actor_id == "brutus":
            print("  > Translating to state patch: Change Caesar's status to 'dead'.")
            return {
                "entity_updates": [{
                    "entity_id": "caesar",
                    "updates": {"status": "dead"}
                    # Note: dpath doesn't support direct replacement well, this needs careful handling in StateUpdater
                }]
            }
        return {}  # Return an empty patch if no action is taken
        # --- END OF MOCK CALL ---

    def generate_perception_packet(self, entity_id: str, turn_number: int, simulation_state) -> PerceptionPacket:
        """
        Generates a PerceptionPacket for a specific entity based on the final world state.
        """
        print(f"[GAME MASTER] Generating perception for '{entity_id}'...")
        # --- MOCK PERCEPTION GENERATION ---
        # This would check visibility networks and locations to generate a custom narrative.
        caesar_status = simulation_state.get_entity("caesar").status
        narrative = f"Turn {turn_number} has ended. The political climate is tense."
        if caesar_status == "dead":
            narrative = "Tragedy has struck Rome! Julius Caesar has been assassinated in the Senate House."

        return PerceptionPacket(
            recipient_id=entity_id,
            turn_number=turn_number,
            narrative_synopsis=narrative,
            metadata_updates={}
        )
