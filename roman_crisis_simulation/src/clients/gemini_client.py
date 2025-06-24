import os
import json
from typing import Dict, Any
# GenAi imports
import google as genai
from google.genai import types
# Internal Imports
from ..services.llm_service import LanguageModelService


class GeminiClient(LanguageModelService):
    """
    The real implementation of the LanguageModelService that interacts
    with the Google Gemini API.
    """

    def __init__(self, model_name: str = 'gemini-1.5-flash'):
        """
        Initializes the Gemini client.

        Args:
            model_name: The name of the Gemini model to use.
        """
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("Gemini API key not provided. Please set the GEMINI_API_KEY environment variable.")

        genai.configure(api_key=api_key)

        self.model = genai.GenerativeModel(model_name)
        print(f"GEMINI_CLIENT: Initialized with model '{model_name}'.")

    def generate_initial_state(self) -> Dict[str, Any]:
        """
        This client does not generate the static initial state; it relies on
        the MockLLMClient for Turn 0.
        """
        raise NotImplementedError(
            "GeminiClient does not generate the static initial state. Use MockLLMClient for Turn 0.")

    def get_entity_action(self, entity_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calls the Gemini API to determine an entity's action based on its state.
        """
        entity_id = entity_state.get('name', 'Unknown Entity')
        print(f"GEMINI_CLIENT: Calling API to get action for {entity_id}...")

        prompt = f"""
        You are a character in a historical simulation of the Roman Republic on the eve of Caesar's assassination.
        You are {entity_id}. 

        Your current state is: {json.dumps(entity_state, indent=2)}

        Based on your status, goals, and knowledge, decide on a single, specific action to take.
        Your action should be logical and contribute to your goals.

        Respond ONLY with a JSON object in the following format:
        {{
          "action": "your_chosen_action",
          "details": "A brief description of what you are doing and why.",
          "target_id": "entity_id_of_target_if_any",
          "location_id": "your_current_or_new_location_id"
        }}
        """

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"ERROR: Could not get action for {entity_id}. Error: {e}")
            # Return a default/fallback action
            return {"action": "error", "details": "Failed to generate AI action.", "target_id": None}

    def adjudicate_turn(self, turn_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calls the Gemini API to adjudicate the outcomes of a turn.
        """
        print("GEMINI_CLIENT: Calling API to adjudicate the turn...")

        prompt = f"""
        You are the Game Master for a historical simulation of the Roman Republic.
        It is the evening of March 14th, 44 BC.

        The following actions were taken this turn:
        {json.dumps(turn_data, indent=2)}

        Your task is to adjudicate the results of these actions.
        1. Write a compelling, third-person narrative describing what happened.
        2. Determine the specific changes to the game state. Only include entities that have changed.

        Respond ONLY with a JSON object in the following format:
        {{
          "narrative_outcome": "A paragraph describing the events of the turn.",
          "state_updates": [
            {{
              "entity_id": "id_of_changed_entity",
              "updates": {{
                "location_id": "new_location_id",
                "knowledge": ["new piece of knowledge 1", "new piece of knowledge 2"]
              }}
            }}
          ]
        }}
        """
        try:
            response = self.model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"ERROR: Could not adjudicate turn. Error: {e}")
            return {
                "narrative_outcome": "An error occurred during turn adjudication.",
                "state_updates": []
            }