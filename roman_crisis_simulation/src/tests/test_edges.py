# roman_crisis_simulation/src/tests/test_edges.py
# Unit tests for all Edge models.

import unittest
from pydantic import ValidationError

# Import the main generator functions from our fixtures
from .fixtures.turn_one_data import generate_turn_one_entities, generate_turn_one_edges

# Import the models to be tested
from ..models.edges import Relationship, Obligation
from ..models.supporting import SocialRelationship

class TestEdgeModels(unittest.TestCase):
    """Tests for the Relationship and Obligation models."""

    @classmethod
    def setUpClass(cls):
        """Set up data once for all tests in this class."""
        cls.entities = generate_turn_one_entities()
        cls.edges = generate_turn_one_edges(cls.entities)
        cls.player_id = cls.entities["player_character"].id
        cls.rival_id = cls.entities["rival_senator"].id
        cls.senate_id = cls.entities["senate"].id

    def test_relationship_creation(self):
        """Tests the successful creation of a Relationship edge."""
        # Find the relationship from the player to the rival
        relationship = next((edge for edge in self.edges if isinstance(edge, Relationship) and edge.target == self.rival_id), None)
        self.assertIsNotNone(relationship)
        self.assertEqual(relationship.source, self.player_id)
        self.assertEqual(relationship.relationship_type, "rivalry")
        self.assertIsInstance(relationship.social_relationship, SocialRelationship)
        self.assertEqual(relationship.social_relationship.trust, -0.7)

    def test_obligation_creation(self):
        """Tests the successful creation of an Obligation edge."""
        # Find the obligation from the player to the senate
        obligation = next((edge for edge in self.edges if isinstance(edge, Obligation) and edge.target == self.senate_id), None)
        self.assertIsNotNone(obligation)
        self.assertEqual(obligation.source, self.player_id)
        self.assertEqual(obligation.obligation_type, "sworn_duty")
        self.assertEqual(obligation.magnitude, 0.8)

    def test_validation_error_on_missing_source(self):
        """Tests that Pydantic raises a validation error if source or target is missing."""
        with self.assertRaises(ValidationError):
            # 'source' and 'target' are required fields.
            Relationship(description="An incomplete relationship", relationship_type="test")

if __name__ == '__main__':
    unittest.main(verbosity=2)
