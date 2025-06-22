# Glory of Rome: Entity Ontology Design Document

## 1. Introduction

This document outlines the definitive data structures, or "ontology," for all entities within the *Glory of Rome* simulation. The goal is to create a clear, hierarchical, and extensible system for representing the various actors, groups, and locations that populate the game world.

The core principle of this ontology is a class-based hierarchy. A foundational `BaseEntity` class contains the universal properties shared by all objects in the simulation. This base class is then extended by more specialized subclasses, each adding attributes and behaviors relevant to its specific type. This approach ensures that data is logically organized and prevents entities from possessing irrelevant or nonsensical attributes (e.g., a building having "memories").

The entity types are defined using Pydantic `BaseModel` for data validation and clear schema definition.

## 2. Entity Hierarchy

The entity ontology is structured as follows:

```
BaseEntity
├── SentientEntity
│   ├── IndividualEntity
│   └── GroupEntity
└── LocationEntity
```

* **`BaseEntity`**: The root of the hierarchy. Contains attributes universal to every object in the game.
* **`SentientEntity`**: An abstract subclass representing entities with consciousness, memory, and social capabilities.
* **`IndividualEntity`**: Represents a single, distinct person (e.g., a Senator, a Plebian, a General).
* **`GroupEntity`**: Represents a collection of individuals acting as a single unit (e.g., a Legion, a Faction, the Senate).
* **`LocationEntity`**: Represents a physical place within the game world (e.g., the Forum, a Villa, a Province).

---

## 3. Core Class Definitions

### 3.1. `BaseEntity`

The foundational class for all entities. It encapsulates the most basic information required for an object to exist and be tracked within the simulation.

| Attribute              | Type                          | Description                                                                                    |
| :--------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------- |
| `entity_id`            | `str`                         | A unique identifier for the entity (e.g., "senator_gaius_julius").                             |
| `entity_type`          | `str`                         | The specific type of the entity (e.g., "individual", "group", "location").                     |
| `status`               | `str`                         | The current operational status (e.g., "active", "inactive", "destroyed").                      |
| `location`             | `str`                         | The `entity_id` of the `LocationEntity` where this entity currently resides.                   |
| `resources`            | `Dict[str, Union[int, float]]`| A dictionary of fungible assets controlled by the entity (e.g., gold, influence, grain).       |
| `visibility_network`   | `List[str]`                   | Defines which other entities' information this entity has access to.                           |

### 3.2. `SentientEntity`

Inherits from: `BaseEntity`

An abstract class for entities capable of thought, memory, and social interaction. It serves as the foundation for both individuals and groups.

| Attribute                 | Type                    | Description                                                                                          |
| :------------------------ | :---------------------- | :--------------------------------------------------------------------------------------------------- |
| `memories`                | `List[Memory]`          | A record of significant past events experienced by the entity.                                       |
| `relationships`           | `Dict[str, Relationship]`| The entity's social connections and dispositions towards others.                                     |
| `short_term_goals`        | `List[str]`             | Immediate objectives the entity is trying to achieve.                                                |
| `long_term_ambitions`     | `List[str]`             | The overarching life goals or strategic objectives of the entity.                                    |
| `current_state_narrative` | `str`                   | A brief, LLM-generated narrative describing the entity's current situation and emotional state.      |

### 3.3. `IndividualEntity`

Inherits from: `SentientEntity`

Represents a single person. This is the primary agent of action and change in the simulation.

| Attribute     | Type                  | Description                                                                         |
| :------------ | :-------------------- | :---------------------------------------------------------------------------------- |
| `entity_type` | `str`                 | Hardcoded to `"individual"`.                                                        |
| `position`    | `Optional[str]`       | The individual's formal role or title in society (e.g., "Consul", "Legate").        |
| `personality` | `PersonalityTraits`   | A set of scores defining the individual's character and behavioral tendencies.      |

### 3.4. `GroupEntity`

Inherits from: `SentientEntity`

Represents a collection of individuals who share a common purpose or identity. A group's actions are an aggregate of its members' will, influenced by its leadership and culture.

| Attribute | Type                             | Description                                                    |
| :-------- | :------------------------------- | :------------------------------------------------------------- |
| `entity_type`| `str`                          | Hardcoded to `"group"`.                                        |
| `size`    | `Optional[int]`                  | The approximate number of individuals in the group.            |
| `culture` | `Optional[Dict[str, List[str]]]` | The shared values, traditions, and norms of the group.         |

### 3.5. `LocationEntity`

Inherits from: `BaseEntity`

Represents a physical place in the game world. Locations are static entities that serve as the stage for events and the container for other entities.

| Attribute            | Type          | Description                                                                      |
| :------------------- | :------------ | :------------------------------------------------------------------------------- |
| `entity_type`        | `str`         | Hardcoded to `"location"`.                                                       |
| `capacity`           | `Optional[int]`| The maximum number of individuals the location can accommodate.                  |
| `contained_entities` | `List[str]`   | A list of `entity_id`s for all entities currently at this location.              |

---

## 4. Supporting Data Models

These models are used as complex attributes within the entity classes.

### 4.1. `PersonalityTraits`

Defines the psychological profile of an `IndividualEntity`. Values range from 1 to 10.

| Attribute | Type  | Description                                        |
| :-------- | :---- | :------------------------------------------------- |
| `ambition`| `int` | The drive for power, wealth, and status.           |
| `paranoia`| `int` | The level of suspicion and distrust of others.     |
| `loyalty` | `int` | The commitment to allies, patrons, and the state.  |
| `cunning` | `int` | Skill in strategy, intrigue, and political maneuvering.|
| `honor`   | `int` | Adherence to Roman virtues (`mos maiorum`).        |

### 4.2. `Relationship`

Defines a social link between two `SentientEntity` instances.

| Attribute             | Type        | Description                                                                              |
| :-------------------- | :---------- | :--------------------------------------------------------------------------------------- |
| `entity_id`           | `str`       | The target of the relationship.                                                          |
| `relationship_type`   | `str`       | The nature of the connection (e.g., "family", "ally", "rival", "patron", "client").      |
| `trust_level`         | `int`       | A score from -10 (deep hatred) to 10 (unwavering trust).                                 |
| `recent_interactions` | `List[str]` | A log of recent significant events between the two entities.                             |

### 4.3. `Memory`

Represents an entity's recollection of a specific past event.

| Attribute           | Type        | Description                                                                  |
| :------------------ | :---------- | :--------------------------------------------------------------------------- |
| `turn`              | `int`       | The simulation turn on which the event occurred.                             |
| `event_description` | `str`       | A concise, factual description of what happened.                             |
| `emotional_impact`  | `str`       | The emotional response to the memory (e.g., "gratitude", "betrayal", "pride").|
| `involved_entities` | `List[str]` | A list of `entity_id`s for all other entities involved in the memory.        |
