# roman_crisis_simulation/src/tests/test_entities.py
# Unit tests for all Entity models.

import unittest
from pydantic import ValidationError

# Import the specific generator functions from our fixtures
from .fixtures.turn_one_data import _generate_individual_entities, _generate_group_entities, _generate_location_entities

# Import the models to be tested
from ..models.entity import IndividualEntity, GroupEntity, LocationEntity
from ..models.supporting import PersonalityTrait

class TestIndividualEntities(unittest.TestCase):
    """Tests for the IndividualEntity model."""

    @classmethod
    def setUpClass(cls):
        """Set up data once for all tests in this class."""
        cls.individual_entities = _generate_individual_entities()

    def test_creation_and_attributes(self):
        """Tests the successful creation and basic attributes of an IndividualEntity."""
        player = self.individual_entities.get("player_character")
        self.assertIsInstance(player, IndividualEntity)
        self.assertEqual(player.name, "Gaius Verres")
        self.assertEqual(player.location, "loc_rome")
        self.assertIsNotNone(player.description)

    def test_personality_structure(self):
        """Tests that the personality attribute is correctly structured as a list of PersonalityTraits."""
        rival = self.individual_entities.get("rival_senator")
        self.assertIsInstance(rival.personality, list)
        self.assertGreater(len(rival.personality), 0)
        self.assertIsInstance(rival.personality[0], PersonalityTrait)
        self.assertEqual(rival.personality[0].name, "Inflexible")

    def test_validation_error_on_missing_field(self):
        """Tests that Pydantic's validation raises an error for missing required fields."""
        with self.assertRaises(ValidationError):
            # The 'id' and 'name' fields are required.
            IndividualEntity(description="A test character.")

class TestGroupEntities(unittest.TestCase):
    """Tests for the GroupEntity model."""

    @classmethod
    def setUpClass(cls):
        """Set up data once for all tests in this class."""
        cls.group_entities = _generate_group_entities()

    def test_creation_and_attributes(self):
        """Tests the successful creation and basic attributes of a GroupEntity."""
        senate = self.group_entities.get("senate")
        self.assertIsInstance(senate, GroupEntity)
        self.assertEqual(senate.id, "group_senate")
        self.assertEqual(senate.name, "The Roman Senate")
        self.assertTrue(senate.description.startswith("The venerable and powerful"))

class TestLocationEntities(unittest.TestCase):
    """Tests for the LocationEntity model."""

    @classmethod
    def setUpClass(cls):
        """Set up data once for all tests in this class."""
        cls.location_entities = _generate_location_entities()

    def test_creation_and_attributes(self):
        """Tests the successful creation and basic attributes of a LocationEntity."""
        rome = self.location_entities.get("rome")
        self.assertIsInstance(rome, LocationEntity)
        self.assertEqual(rome.name, "Rome")
        self.assertTrue("magnificent and chaotic heart" in rome.description)

if __name__ == '__main__':
    unittest.main(verbosity=2)
