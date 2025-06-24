# roman_crisis_simulation/src/tests/test_models.py
# This file contains unit tests for the data models.

import unittest
from pydantic import ValidationError

# Import the data generation functions from our fixtures using absolute paths from the 'src' root
from .fixtures.turn_one_data import generate_turn_one_entities, generate_turn_one_edges

# Import the models to be tested using absolute paths from the 'src' root
from ..models.entity import IndividualEntity, GroupEntity, LocationEntity
from ..models.edges import Relationship
from ..models.supporting import SocialRelationship


class TestEntityModels(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Set up data for all tests in this class."""
        cls.entities = generate_turn_one_entities()

    def test_create_individual_entity(self):
        """Tests the successful creation of an IndividualEntity."""
        player = self.entities.get("player_character")
        self.assertIsInstance(player, IndividualEntity)
        self.assertEqual(player.name, "Gaius Verres")
        self.assertEqual(player.location, "loc_rome")

    def test_create_group_entity(self):
        """Tests the successful creation of a GroupEntity."""
        senate = self.entities.get("senate")
        self.assertIsInstance(senate, GroupEntity)
        self.assertEqual(senate.id, "group_senate")

    def test_create_location_entity(self):
        """Tests the successful creation of a LocationEntity."""
        rome = self.entities.get("rome")
        self.assertIsInstance(rome, LocationEntity)
        self.assertEqual(rome.name, "Rome")

    def test_individual_entity_validation(self):
        """Tests Pydantic validation on IndividualEntity."""
        with self.assertRaises(ValidationError):
            # 'name' is a required field
            IndividualEntity(id="char_test")


class TestEdgeModels(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Set up data for all tests in this class."""
        cls.entities = generate_turn_one_entities()
        cls.edges = generate_turn_one_edges(cls.entities)

    def test_create_relationship_edge(self):
        """Tests the successful creation of a Relationship edge."""
        relationship = self.edges[0]
        self.assertIsInstance(relationship, Relationship)
        self.assertEqual(relationship.source, "char_player")
        self.assertEqual(relationship.target, "char_rival")
        self.assertEqual(relationship.relationship_type, "rivalry")

    def test_relationship_trust_validation(self):
        """Tests the validation constraints on the SocialRelationship trust_level."""
        with self.assertRaises(ValidationError):
            # trust_level must be between -1.0 and 1.0
            SocialRelationship(trust=11.0)

        with self.assertRaises(ValidationError):
            # trust_level must be between -1.0 and 1.0
            SocialRelationship(trust=-2.0)

    def test_relationship_instantiation_without_social(self):
        """Tests that a Relationship can be created without a SocialRelationship."""
        try:
            Relationship(
                id="test_rel_2",  # Edges require an id
                source="char_player",
                target="char_general",
                description="A test relationship.",
                relationship_type="political"
            )
        except ValidationError as e:
            self.fail(f"Relationship creation failed unexpectedly without SocialRelationship: {e}")


if __name__ == '__main__':
    unittest.main()
