# **Overall**

## **Intent of the Game**

The Roman Crisis Simulation is an interactive narrative strategy game designed to immerse the player in the political turmoil of Rome in 235 CE. It aims to create an emergent, character-driven story where the player's decisions have a tangible impact on a dynamic world. The core experience revolves around information asymmetry, strategic planning, and navigating complex relationships.

Unlike traditional strategy games that focus on resource management and conquest, this simulation prioritizes narrative and political intrigue. The player must think like a Roman leader, using diplomacy, espionage, and manipulation to achieve their goals. The game is powered by an AI Game Master that adjudicates player actions and simulates the independent actions of non-player characters (NPCs), ensuring that the world feels alive and unpredictable. The ultimate goal is to provide a rich, replayable experience where each playthrough tells a unique story of ambition, betrayal, and power in ancient Rome.

## **Running the Game — Providing a Gemini API Key**

DESIGN_DECISIONS.md D34: bring-your-own-key is the default, preferred way to play. There is no server component and no build-time key injection — the game never bundles a key into `npm run build`'s output.

* **As a player (or the owner, on any device):** run the app (`npm run dev`, or open the built site) and click the **⚙ Settings** affordance in the header to open the configuration menu. Paste your own Gemini API key there and click Save. It's stored in that browser's `localStorage` only — never sent anywhere but Google, never written into a save file, never included in the GM console's eval-corpus export, and never logged. Clicking Clear removes it. No key at all is a valid state too: the game still boots and **Mock Mode** (the dev-only header switch) plays entirely offline with no API calls; attempting a *real* turn with no key surfaces a message pointing back at this menu instead of a raw network error.
* **As the owner, for local dev convenience only:** copy `.env.example` to `.env` and fill in `GEMINI_API_KEY`. `vite.config.ts`'s `define` block injects it, but **only for the dev server** (`npm run dev`) — `npm run build`'s output never contains it, and this convenience is dead code in production (guarded by `import.meta.env.DEV`). This is a shortcut for the owner's own machine, not how anyone else gets a key.
* **As the owner, on Windows, without a plaintext file:** store the key as a **generic credential** in Windows Credential Manager under the target `GloryOfRome:GEMINI_API_KEY` (`cmdkey /generic:GloryOfRome:GEMINI_API_KEY /user:api /pass:<key>`, or the Credential Manager UI). The dev server reads it at startup via `vite.config.ts` and injects it through the same serve-only `define` seam. Priority when several sources exist: the in-app configuration-menu key (localStorage) wins at runtime, then a filled-in `.env`, then the credential store. Same D34 boundary — dev server only, never in build output.
* The configuration menu also surfaces the D23 pacing posture (previously a bottom-right-only toggle) and the D32/D33 GM Intervention / GM console availability toggles — both default to "available", matching prior behavior.

## **The Model — Gemini 3.8**

Every call runs on **`gemini-3.8-flash`** (Gemini 3.8, September 2026), the one model Google shipped for the generation — a GA id, and by Google's own account its strongest reasoning model to date; there is no "3.8 Pro". The app's two historical call tiers survive as **thinking postures** on the same id rather than as two model ids (`ai/core/geminiService.ts`): `THINKING_DEEP` (`HIGH`) for the adjudicator, world generation and character creation; `THINKING_STANDARD` (`MEDIUM`) for narration, mortality, story relevance, the simulation-state update, investigations, private scenes and the epilogue; `THINKING_QUICK` (`LOW`) for the per-turn flash tier (the action assessment, NPC minds, the monologue, ambition inference, clarifications, the eval judge). Gemini 3.x takes a thinking *level*, never a token budget — the API rejects a request carrying both — so `ThinkingConfigLike` has no budget field at all. If the primary id is ever retired, every call falls back (sticky, per session) to `gemini-3.7-flash`, the previous-generation GA Flash model, which honours the same LOW/MEDIUM/HIGH contract. The SDK is `@google/genai` 2.x.

# **Codebase**

## **Current Structure of Game Files**

The project is structured as a modern React application using TypeScript and Vite. The file organization separates the UI (components), game logic (ai, events, constants), centralized state (state), and core application setup.

* **/ (Root)**: Contains the main entry point (index.html), React app setup (App.tsx, index.tsx), and project configurations (package.json, vite.config.ts, tsconfig.json).  
* **/ai**: The brain of the simulation. It's responsible for processing turns, making AI-driven decisions, and managing game logic.  
  * **/ai/core**: Contains the essential engine for running the simulation, including the single Gemini service wrapper (`ai/core/geminiService.ts`) that every AI call goes through.
  * **/ai/tools**: Holds specialized functions that use the AI for specific tasks like intelligence gathering or character generation.  
* **/components**: Houses all the reusable React components that form the user interface.  
  * **/components/tabs**: Contains the components for each tab in the side panel (e.g., Events, Reports).  
* **/constants**: Stores static, read-only data that defines the starting conditions of the game.  
* **/events**: Manages the logic for scripted, triggerable in-game events.  
* **/state**: Owns the centralized game-domain state. `state/GameContext.tsx` is the React context/provider; `state/gameReducer.ts` is the reducer, action types, and initial-state factory. `App.tsx` is the sole consumer of the context and stays the composition root for persistence.
* **/knowledge**: Manages what the player has learned — report commitment, credibility framing, and dossier costing for intelligence gathering.
* **/perception**: Filters simulation state down to what a given viewer (player or NPC) is allowed to see, so raw deltas and GM-private detail never reach the UI.
* **/persistence**: Handles everything saved to or read from the browser — save games, settings, the API key, onboarding state, and the eval-corpus export.
* **/eval**: Houses the offline evaluation harness and judge used to score AI output quality outside of normal gameplay.
* **/tests**: Contains unit tests to ensure the core game logic functions correctly.

## **Description of Each File**

* App.tsx: The main React component. It manages the overall game state, handles the main game loop, and orchestrates interactions between the UI and the game logic.  
* index.html: The HTML entry point for the application. It includes basic metadata, fonts, and styles.  
* index.tsx: The file that renders the main App component into the DOM.  
* types.ts: A critical file that defines all the TypeScript types and interfaces for the core data structures used throughout the simulation, such as Entity, WorldState, and Adjudication.  
* ai/core/engine.ts: Contains the core functions for applying changes to the game state. It takes the output from the AI (Adjudication) and updates the entities and world accordingly.  
* ai/core/resourceRegistry.ts: The canonical resource catalogue (D46). Declares every systemic resource kind once — key, label, category, unit, floor/cap, weekly yield or wage, who may know it — plus the model spellings that fold onto it (`gold` → `denarii`, `spies` → `agents`), and classifies undeclared keys by name alone.  
* ai/core/ledger.ts: The weekly ledger (D46). A pure engine step run once per committed turn on the player's own bag: levies arrive, holdings yield, wages fall due (shortfall becomes back pay), interest is serviced or capitalised, back pay erodes standing and drives desertions, investigations regenerate toward the agents-driven ceiling, standings drift under the crisis. Its lines ride `TurnHistoryEntry.ledger`.  
* ai/core/economyGuard.ts: The conservation guard (D46). Folds every resource delta key onto its canonical spelling and clamps the player's unsourced gains — windfalls, free intel, reputation leaps, unpaid recruits — recording each clamp as an `[Economy]` GM note.  
* ai/core/exchequer.ts: The exchange table (D46, BACKLOG B1): coin into informants, favours into inquiries, inquiries into a deep analysis, coin into levies, coin against debt or back pay, distress sales. Pure; committed through `App.tsx`'s `handleExchange`.  
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
6.  **State Application**: This `Adjudication` object is then used to mechanically update the game's state, changing character resources, relationships, locations, etc. Before it is applied, the conservation guard (`ai/core/economyGuard.ts`) folds resource keys onto their canonical names and clamps the player's unsourced gains; after it is applied, the weekly ledger (`ai/core/ledger.ts`) closes the player's books for the week — yields in, wages out, interest, back pay, desertions, intel regeneration, standing drift — as its own engine step whose lines ride the history entry rather than the adjudication's deltas (D46).  
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
  * `resources`: A flexible key-value store for assets like denarii or legion\_support. The bag stays dynamic (the model may mint a resource nobody declared), but every key is folded onto the canonical registry (`ai/core/resourceRegistry.ts`, D46) so one quantity never lives under two names: coin is `denarii` (floored at zero; an overdraft becomes `debt_denarii`), men are `troops` / `guards` / `agents` / `legions` and draw weekly wages, property is `estates` / `ships` / `workshops` and yields weekly, standings are 0–100 scales, leverage is `favors` and `blackmail_on_<entity_id>`, and a discrete thing the story minted is `holding_<slug>` (no yield, no wage). Back pay accrues as `pay_arrears`; levies bought at the exchequer wait a week as `levy_pending`. Only the player's bag is run through the weekly ledger; other entities' bags stay narrative.  
  * `short\_term\_goals` & `active\_scheme`: These drive the AI's proactive behavior for that entity.  
  * `memories`: A log of significant events the entity has experienced.  
* **WorldState**: A top-level object that holds global information about the game world. It includes the date, overall economic and political stability, and the state of various regions.  
* **RegionState**: Describes the status of a specific location in Rome (e.g., 'The Curia'), including its stability and which faction controls it.  
* **EventDelta**: The smallest unit of change in the game. Each delta represents a single, atomic modification to the state, such as `type: 'resource', key: 'severus_alexander:denarii', delta: -5000`. This granular approach makes the game's logic transparent and easy to test.  
* **LedgerLine**: One line of the player's weekly ledger (`TurnHistoryEntry.ledger`, optional — absent on legacy saves and on quiet weeks): a kind (`income`, `upkeep`, `arrears`, `interest`, `levy`, `desertion`, `regen`, `drift`, `adjustment`), the canonical resource key, a signed amount, the player-facing sentence, and an optional itemisation for the GM console. Engine-authored, never an adjudicator delta.  
* **Report**: Represents a piece of intelligence gathered by the player. It has a source, a claim, and a credibility score, reflecting the game's focus on imperfect information.

# **TODO Section**

## **Proposed Feature Enhancements**

* **Faction Cohesion & Internal Politics**: Add a `cohesion` property to factions (e.g., from 0 to 10). Low cohesion could cause factions to splinter, with ambitious members breaking off to form their own sub-factions or defecting. This would make managing a faction more challenging and dynamic. *Feasibility: Medium. Requires new logic for faction splits and updates to the AI's adjudication rules.*
* **Reputation System**: Add a reputation object to the Entity type (e.g., { honor: 5, ruthlessness: \-3 }). Player actions would modify their reputation, and NPCs would react based on these traits in addition to trust. For example, a ruthless player might find it harder to form alliances but easier to intimidate rivals. *Feasibility: High. This is a simple extension of the existing delta system.*  
* **Dynamic Rumor Mill**: Enhance the rumor delta type. Instead of just adding a report, rumors could spread through the NPC network. A rumor's credibility could change over time, and NPCs could act on false information, leading to unpredictable and chaotic outcomes. *Feasibility: Medium. This requires adding logic for how information propagates between entities.*  
* **Historical Event Injections**: Create a system where, at certain dates (e.g., Year 238 CE), the GM can inject major historical events (like the rise of the Gordian emperors). The AI would then have to adjudicate how the current, potentially alternate-history game state reacts to this external shock. *Feasibility: Medium. It requires a timeline system but leverages the existing GM intervention functionality.*