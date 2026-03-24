# **Overall**

## **Intent of the Game**

The Roman Crisis Simulation is an interactive narrative strategy game designed to immerse the player in the political turmoil of Rome in 235 CE. It aims to create an emergent, character-driven story where the player's decisions have a tangible impact on a dynamic world. The core experience revolves around information asymmetry, strategic planning, and navigating complex relationships.

Unlike traditional strategy games that focus on resource management and conquest, this simulation prioritizes narrative and political intrigue. The player must think like a Roman leader, using diplomacy, espionage, and manipulation to achieve their goals. The game is powered by an AI Game Master that adjudicates player actions and simulates the independent actions of non-player characters (NPCs), ensuring that the world feels alive and unpredictable. The ultimate goal is to provide a rich, replayable experience where each playthrough tells a unique story of ambition, betrayal, and power in ancient Rome.

# **Codebase**

## **Current Structure of Game Files**

The project is structured as a modern React application using TypeScript and Vite. The file organization separates the UI (components), game logic (ai, events, constants), and core application setup.

* **/ (Root)**: Contains the main entry point (index.html), React app setup (App.tsx, index.tsx), and project configurations (package.json, vite.config.ts, tsconfig.json).  
* **/ai**: The brain of the simulation. It's responsible for processing turns, making AI-driven decisions, and managing game logic.  
  * **/ai/core**: Contains the essential engine for running the simulation.  
  * **/ai/tools**: Holds specialized functions that use the AI for specific tasks like intelligence gathering or character generation.  
* **/components**: Houses all the reusable React components that form the user interface.  
  * **/components/tabs**: Contains the components for each tab in the side panel (e.g., Events, Reports).  
* **/constants**: Stores static, read-only data that defines the starting conditions of the game.  
* **/events**: Manages the logic for scripted, triggerable in-game events.  
* **/tests**: Contains unit tests to ensure the core game logic functions correctly.

## **Description of Each File**

* App.tsx: The main React component. It manages the overall game state, handles the main game loop, and orchestrates interactions between the UI and the game logic.  
* index.html: The HTML entry point for the application. It includes basic metadata, fonts, and styles.  
* index.tsx: The file that renders the main App component into the DOM.  
* types.ts: A critical file that defines all the TypeScript types and interfaces for the core data structures used throughout the simulation, such as Entity, WorldState, and Adjudication.  
* ai/core/engine.ts: Contains the core functions for applying changes to the game state. It takes the output from the AI (Adjudication) and updates the entities and world accordingly.  
* ai/core/initiator.ts: Contains the `initiateWorld` function. This uses a powerful Gemini prompt to generate a complete, new starting scenario (entities, world state, etc.) based on a player-provided "Meta-Narrative" theme and character concept.  
* ai/core/schemas.ts: Defines the JSON schemas that the AI's responses must adhere to. This ensures that the data received from the AI is structured and predictable.  
* ai/core/turn.ts: Orchestrates the entire turn-processing sequence. It compiles the context for the AI, sends the request, receives the adjudication, and generates the narrative summary.  
* ai/core/turn_logic.md: A detailed document explaining the sophisticated, multi-stage process of how a game turn is simulated by the AI.  
* ai/tools/characterCreator.ts: A tool that uses the AI to dynamically generate a new player character based on a user's text description.  
* ai/tools/intelligence.ts: Contains functions for various intelligence-gathering actions, such as getting a character's thoughts, investigating secrets, or asking for clarification on events.  
* ai/mocks.ts: Provides mock data and functions for development and testing. This allows the game to be run without making live calls to the AI, ensuring predictable and fast testing cycles.  
* components/CharacterSelection.tsx: The UI component for the initial character selection screen.  
* components/Chat.tsx: Contains the components for the chat interface, including message bubbles and the input area.  
* components/EventModal.tsx: A modal component that displays triggered in-game events and presents the player with choices.  
* components/GameMasterScreen.tsx: A debug/developer tool that allows for viewing the detailed history of each turn, including the raw AI output.  
* components/Header.tsx: The header component, which displays the game title and the current world state.  
* components/SidePanel.tsx: The main container for the right-hand panel, which houses the various informational tabs.  
* constants/baseScenario.ts: Defines the initial state of the simulation, including all starting characters, factions, relationships, and world conditions for the 235 CE scenario.  
* constants/events.ts: Contains an array of predefined GameEvent objects that can be triggered during gameplay.  
* events/engine.ts: Contains the logic to check if any of the predefined GameEvents should be triggered based on the current game state.  
* tests/engine.test.ts: Unit tests for the applyAdjudication function in the core engine, ensuring that state changes are applied correctly.

# **Game Logic and Execution Structure**

## **Turn Structure and Mechanics**

The game operates on a turn-based system where each turn represents one week of in-game time. The process for each turn is a sophisticated, multi-stage AI simulation designed to create a dynamic and emergent narrative. For a detailed breakdown of the logic, **please see the `ai/core/turn_logic.md` document.** The high-level process is:

1.  **Story Relevance Analysis**: Before simulating the turn, a preliminary AI call determines which 1-3 NPCs are the most critical to the story at this moment. These become "spotlight" characters.  
2.  **Context Compilation**: A detailed prompt is built for the AI Game Master, including the full world state, all character profiles (with "spotlight" characters specially marked), recent history, and the player's intended action for the turn.  
3.  **Proactive NPC Simulation**: In the first phase of the main simulation, the AI determines the actions that the "spotlight" NPCs take on their own initiative to advance their secret plans and schemes.  
4.  **Player Action Adjudication & Reactions**: In the second phase, the AI adjudicates the outcome of the player's action and simulates how all other characters in the world react to both the player's move and the NPCs' proactive moves.  
5.  **State Adjudication**: The AI returns a single, structured `Adjudication` JSON object. This object contains a list of all actions taken, the resulting atomic state changes (`EventDelta` array), public headlines, and private GM notes.  
6.  **State Application**: This `Adjudication` object is then used to mechanically update the game's state, changing character resources, relationships, locations, etc.  
7.  **Narrative Generation**: Separate AI calls are made to generate a narrative summary of the turn's events (written from a perspective closer to the player's knowledge) and a private "inner monologue" for the player character.  
8.  **Event Check**: Finally, the new game state is checked to see if it has met the trigger conditions for any major, pre-scripted `GameEvent`.

## **Dynamic World Generation (Initiate)**

Players can now move beyond the default 235 CE scenario by providing a "Meta-Narrative" theme and a character description during setup. The "Initiate" engine, located in `ai/core/initiator.ts`, uses Gemini to generate a brand new `WorldState`, a full cast of `Entities`, and integrates the player's character, all tailored to the requested story theme. This allows for endless replayability, from gothic horror on the frontier to political comedy in the Senate. The Meta-Narrative is also used during each turn to ensure the AI's adjudication and storytelling remain tonally consistent with the chosen theme.

## **Dynamic NPC Ambition (Schemes)**

NPCs in the simulation are not static. Their long-term plans, or `active_scheme`, can change dynamically. The AI Game Master is instructed to monitor each character's situation. If an NPC's scheme is completed, fails, or becomes irrelevant due to the changing political landscape, the AI will generate a completely new, multi-step scheme for that character. This new plan will be based on their personality, their long-term ambitions, and the new opportunities or threats that have emerged. This ensures that characters adapt to the world as it changes, creating a more challenging and unpredictable strategic environment.

## **Nuanced Relationships and Personality-Driven AI**

The simulation's depth is enhanced by a more sophisticated model of character interaction. The AI's decision-making is now explicitly driven by a combination of an entity's core `personality` traits and a more detailed `relationship` model.
*   **Personality-Driven Actions**: The AI is instructed that an NPC's actions must be a direct reflection of their personality. An honorable character will be less likely to engage in treachery, while a paranoid one may see threats where there are none. Ambitious characters will take calculated risks to advance their position.
*   **Nuanced Relationships**: Beyond a simple `trust_level`, relationships now include:
    *   `perceived_threat`: How dangerous an entity considers another to be (0-10).
    *   `ideological_alignment`: How closely their beliefs and worldviews align (-10 to 10).
    *   `dependency_level`: How much an entity relies on another for support, resources, or legitimacy (0-10).
This allows the AI to make much more complex and realistic decisions. An NPC might distrust another character but be forced to cooperate due to a high dependency, or they might form an unexpected alliance with a rival because of a high ideological alignment against a common, greater threat. These factors are now primary drivers of the simulation's emergent narrative.

## **Details of the Object Model**

The simulation's data is primarily structured around the types defined in types.ts.

* **Entity**: This is the most important object. It represents any actor in the game world, whether it's an individual (severus\_alexander), a group (praetorian\_guard), or an abstract faction (senatorial\_party). An Entity contains everything needed to simulate its behavior:  
  * `personality`: A set of traits (ambition, paranoia, etc.) that directly influence decision-making.  
  * `relationships`: A record of its complex feelings and dependencies toward every other entity, including trust, perceived threat, ideological alignment, and more.  
  * `resources`: A flexible key-value store for assets like denarii or legion\_support.  
  * `short\_term\_goals` & `active\_scheme`: These drive the AI's proactive behavior for that entity.  
  * `memories`: A log of significant events the entity has experienced.  
* **WorldState**: A top-level object that holds global information about the game world. It includes the date, overall economic and political stability, and the state of various regions.  
* **RegionState**: Describes the status of a specific location in Rome (e.g., 'The Curia'), including its stability and which faction controls it.  
* **EventDelta**: The smallest unit of change in the game. Each delta represents a single, atomic modification to the state, such as `type: 'resource', key: 'severus_alexander:denarii', delta: -5000`. This granular approach makes the game's logic transparent and easy to test.  
* **Report**: Represents a piece of intelligence gathered by the player. It has a source, a claim, and a credibility score, reflecting the game's focus on imperfect information.

# **TODO Section**

## **Proposed Codebase Organization Changes**

* **Create an AI Service Layer**: Consolidate all functions that make fetch calls to the Gemini API into a single service file (e.g., ai/geminiService.ts). This would abstract the direct API interaction away from the game logic files (turn.ts, intelligence.ts). This makes the code cleaner, easier to mock for tests, and simplifies future updates to the API calls.  
* **Introduce** a State **Management Hook**: While a full library isn't necessary for a low-code environment, a custom React hook (e.g., useGameState) could be created to encapsulate all the state variables (entities, worldState, reports, etc.) and the logic for updating them. This would clean up the App.tsx component significantly and centralize state management logic.  
* **Separate Logic from Components**: Some components, like DramatisPersonaeTab.tsx, contain significant logic for handling intelligence gathering. This logic could be extracted into custom hooks (e.g., useIntelligence(targetEntity)) to make the components purely responsible for rendering the UI, improving separation of concerns.

## **Proposed Feature Enhancements**

* **Faction Cohesion & Internal Politics**: Add a `cohesion` property to factions (e.g., from 0 to 10). Low cohesion could cause factions to splinter, with ambitious members breaking off to form their own sub-factions or defecting. This would make managing a faction more challenging and dynamic. *Feasibility: Medium. Requires new logic for faction splits and updates to the AI's adjudication rules.*
* **Reputation System**: Add a reputation object to the Entity type (e.g., { honor: 5, ruthlessness: \-3 }). Player actions would modify their reputation, and NPCs would react based on these traits in addition to trust. For example, a ruthless player might find it harder to form alliances but easier to intimidate rivals. *Feasibility: High. This is a simple extension of the existing delta system.*  
* **Dynamic Rumor Mill**: Enhance the rumor delta type. Instead of just adding a report, rumors could spread through the NPC network. A rumor's credibility could change over time, and NPCs could act on false information, leading to unpredictable and chaotic outcomes. *Feasibility: Medium. This requires adding logic for how information propagates between entities.*  
* **Historical Event Injections**: Create a system where, at certain dates (e.g., Year 238 CE), the GM can inject major historical events (like the rise of the Gordian emperors). The AI would then have to adjudicate how the current, potentially alternate-history game state reacts to this external shock. *Feasibility: Medium. It requires a timeline system but leverages the existing GM intervention functionality.*