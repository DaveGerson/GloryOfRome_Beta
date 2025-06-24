from typing import Dict, Any
from ..services.llm_service import LanguageModelService

class MockLLMClient(LanguageModelService):
    """
    A mock implementation of the LanguageModelService.
    It provides a hardcoded initial state for Turn 0, depicting the day before Caesar's assassination.
    For subsequent actions, it can provide simple, default responses for testing purposes.
    """

    def generate_initial_state(self) -> Dict[str, Any]:
        """
        Instantiates the game world on March 14th, 44 BC.
        """
        print("MOCK_CLIENT: Generating hardcoded initial state for Turn 0...")
        return {
            "simulation_time": {
                "turn": 0,
                "day": 14,
                "month": "March",
                "year": -44, # 44 BC
                "time_of_day": "Evening"
            },
            "entities": {
                "individuals": [
                    {
                        "entity_id": "julius_caesar",
                        "name": "Gaius Julius Caesar",
                        "status": "Dictator Perpetuo",
                        "location_id": "domus_publica",
                        "goals": ["Prepare for Parthian campaign", "Attend Senate meeting tomorrow"],
                        "knowledge": ["Aware of broad political opposition, but not the specific plot."],
                        "relationships": {"mark_antony": "loyal_friend", "brutus": "trusted_friend"}
                    },
                    {
                        "entity_id": "marcus_brutus",
                        "name": "Marcus Junius Brutus",
                        "status": "Praetor urbanus",
                        "location_id": "domus_bruti",
                        "goals": ["Restore the Republic", "Assassinate Caesar"],
                        "knowledge": ["Full knowledge of the assassination plot.", "Meeting with conspirators tonight."],
                        "relationships": {"julius_caesar": "complex_friendship", "cassius": "co_conspirator"}
                    },
                    {
                        "entity_id": "gaius_cassius",
                        "name": "Gaius Cassius Longinus",
                        "status": "Praetor peregrinus",
                        "location_id": "domus_cassii",
                        "goals": ["Eliminate the tyrant Caesar", "Lead the conspiracy"],
                        "knowledge": ["Full knowledge of the plot.", "Host of the final conspirators' meeting."],
                        "relationships": {"marcus_brutus": "co_conspirator", "julius_caesar": "enemy"}
                    },
                    {
                        "entity_id": "mark_antony",
                        "name": "Marcus Antonius",
                        "status": "Consul",
                        "location_id": "domus_antony",
                        "goals": ["Support Caesar", "Enjoy the privileges of power"],
                        "knowledge": ["Vaguely aware of rumors against Caesar, but not the specifics."],
                        "relationships": {"julius_caesar": "unwavering_loyalty"}
                    }
                ],
                "locations": [
                    {"entity_id": "domus_publica", "name": "Domus Publica", "description": "Caesar's official residence in the Forum."},
                    {"entity_id": "domus_bruti", "name": "House of Brutus", "description": "A modest but respected home."},
                    {"entity_id": "domus_cassii", "name": "House of Cassius", "description": "The site of the final meeting of the conspirators."},
                    {"entity_id": "curia_pompey", "name": "Curia of Pompey", "description": "A Senate house. The planned location for tomorrow's meeting."}
                ]
            },
            "world_state": {
                "narrative": "It is the evening of the 14th of March. A nervous energy grips Rome. Caesar, now dictator for life, plans to depart for a grand military campaign in three days. In the morning, the Senate will convene. Unbeknownst to Caesar and his allies, a group of senators led by Brutus and Cassius are making their final, fateful preparations to end his life on the floor of the Senate itself."
            }
        }

    def get_entity_action(self, entity_state: Dict[str, Any]) -> Dict[str, Any]:
        """Mocked action generation."""
        print(f"MOCK_CLIENT: Generating placeholder action for {entity_state.get('entity_id')}")
        return {"action": "wait", "details": "The entity ponders its next move."}

    def adjudicate_turn(self, turn_data: Dict[str, Any]) -> Dict[str, Any]:
        """Mocked turn adjudication."""
        print("MOCK_CLIENT: Adjudicating turn with placeholder logic.")
        return {"outcome": "The situation remains tense.", "state_updates": {}}
