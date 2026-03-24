# **Turn Structure and Mechanics: A Deep Dive**

The core of the Roman Crisis Simulation is its turn-based engine, where each turn simulates one tumultuous week in Rome. A turn is not just a simple "player move, computer move" sequence. Instead, it's a comprehensive simulation where the player's actions happen concurrently with the schemes and reactions of every other character in the world. This creates a dynamic and unpredictable narrative.

Here is a detailed, step-by-step breakdown of how a single turn unfolds, both mechanically and from a player's perspective.

### **1\. The Player's Action (The Intent)**

It all begins with you. You type your action for the week into the input box—this is your **Intent**.

* **Mechanics**: The text you enter is captured by the main App.tsx component. This string of text is the primary input that will shape the entire turn's simulation. It's stored as the playerIntent variable.  
* **Player Implication**: The clarity and specificity of your intent matter significantly. "I will host a lavish banquet for influential senators to win their favor" provides the AI with more context and direction than "Talk to the Senate." The more detailed your intent, the more nuanced and logical the simulation's response can be. Think of yourself as giving orders to a subordinate; the better the order, the better the execution.

### **2\. Context Compilation & Story Relevance**

Before simulating the week, the game determines which characters are most central to the unfolding drama and gathers all the necessary information for the AI Game Master.

* **Mechanics**: The runNewTurn function in ai/core/turn.ts makes its first call to the Gemini AI using the getStoryRelevance function. It sends the previous turn's public headlines and the current WorldState (e.g., political climate is 'Volatile'). The AI responds by identifying 1-3 "spotlight entities"—characters whose actions are most likely to drive the story forward this week. Subsequently, the compileContext function assembles a massive text prompt. This "World Bible" includes:  
  * The current WorldState.  
  * Detailed profiles of every Entity, including their personality, goals, relationships, and resources. Spotlight NPCs are explicitly marked as "proactive."  
  * A summary of the last six turns to provide historical context.  
  * A `Meta-Narrative` string. This is a high-level directive (e.g., 'An imperial succession crisis' or 'A gothic horror story') that guides the AI's tonal and thematic choices throughout the simulation, ensuring consistency.  
  * And, crucially, your **Intent** for the current turn.  
* **Player Implication**: This is a key feature that makes the world feel alive. It means that major NPCs aren't just waiting for you to act; they are actively pursuing their own goals. If your rival, Maximinus Thrax, is in the spotlight, you can expect him to make a significant move this turn, regardless of what you do. Your action is also placed into the context of the entire world; the AI will judge it not in a vacuum, but based on who you are, who your allies and enemies are, and the current political climate.

### **3\. Proactive NPC Simulation**

The AI Game Master receives the "World Bible" and begins the simulation. The first phase is to determine what the most important NPCs do on their own initiative.

* **Mechanics**: This is the first part of the main adjudication call to Gemini. The AI is specifically instructed to look at the "spotlight" NPCs and, based on their personality and active\_scheme, decide on a proactive course of action for the week. For example, if Maximinus Thrax's scheme is to "undermine the Emperor," he might independently decide to spread propaganda or attempt to bribe a guard captain.  
* **Player Implication**: The world moves without you. This phase ensures that plots are always in motion and that the political situation can change even if you choose to do nothing. It prevents the game from becoming a simple reactive sandbox and makes it feel like a living, breathing world.

### **4\. Player Action Adjudication & NPC Reactions**

In the second phase of the simulation, the AI adjudicates the outcome of your action and simulates how *all* other characters react to it, as well as to the proactive moves from the previous step.

* **Mechanics**: Still within the same Gemini call, the AI now focuses on your playerIntent. It determines the likely success and consequences of your action. It then simulates the reactions of every relevant NPC. A senator might be pleased by your banquet, while a rival might become suspicious.  
* **Player Implication**: This is where the direct consequences of your actions are calculated. Your action is just one of many inputs into a complex system. You might try to win over the Senate, but if Maximinus Thrax's proactive move was to intimidate those same senators, the outcome might be a net loss of stability. This is where emergent storytelling truly happens.

A critical part of this simulation is strategic adaptation. The AI doesn't just execute pre-written plans. If an NPC's `active_scheme` is completed, becomes impossible, or is simply no longer the best strategic option due to the turn's events, the AI is empowered to generate a completely new scheme for that character. This is reflected in the final `Adjudication` object as a `scheme` delta, ensuring that characters are constantly re-evaluating their long-term strategies in response to the player and the world.

### **5\. State Adjudication (The "Source Code" of the Turn)**

The AI's simulation is complete. It doesn't return a story; instead, it returns a highly structured JSON object called the Adjudication. This object is the raw, mechanical "source code" of the turn's events.

* **Mechanics**: The Adjudication object, defined by ai/core/schemas.ts, is the sole output of the main Gemini call. It contains:  
  * entityActions: A log of the key actions taken by NPCs (e.g., maximinus\_thrax \-\> propaganda).  
  * deltas: An array of all the atomic state changes that result from all actions (e.g., severus\_alexander:denarii decreases by 5000; relationship\_trust between you and the Senate increases by 2).  
  * headlines: A list of the major, publicly known events of the week.  
  * gm\_private: Secret events or information known only to the Game Master (and visible in the GM screen).  
* **Player Implication**: This behind-the-scenes data structure is what ensures the game's logic is consistent and transparent. Every change to the world is explicitly recorded before it is turned into a narrative.

### **6\. State Application (Making It Real)**

The game's code now takes the AI's Adjudication plan and executes it, permanently changing the game world.

* **Mechanics**: The applyAdjudication function in ai/core/engine.ts iterates through every delta in the Adjudication object and applies the changes to the entities and worldState objects being managed in App.tsx. Resources are updated, relationships shift, statuses change, and new reports (from rumors) are created.  
* **Player Implication**: This is the point of no return. The consequences of the week's events are now locked in. Your resources have been spent, your reputation has changed, and the world has moved on. You can see these new values reflected in the Side Panel tabs.

### **6.5. Off-Screen NPC Communication Simulation**

To create a deeper sense of a living world, the simulation performs one final, secret step before telling you what happened.

*   **Mechanics**: After the main turn's state changes are applied, a new Gemini call (`simulatePrivateConversation`) is made using the two most important "spotlight" NPCs as inputs. The AI generates a summary of a secret conversation between them and a small set of resulting `EventDeltas` (e.g., trust increases, a new secret is created). These deltas are immediately applied to the game state, and the summary is added to the private GM Log.
*   **Player Implication**: This adds a layer of genuine intrigue. The world evolves not just in response to your actions, but through the independent scheming of its inhabitants. You won't be told about these secret meetings directly. You will only see their consequences—a sudden change in an NPC's attitude, an unexpected new resource appearing for a rival—creating new mysteries for you to solve through espionage.

### **7\. Narrative Generation (Crafting the Story)**

The game world is updated, but you, the player, see numbers and stats. The simulation now translates these mechanical changes into a compelling narrative.

* **Mechanics**: The runNewTurn function makes two final, separate calls to the Gemini AI:  
  1. **Main Narration**: It sends the entire Adjudication object and asks the AI to write a 1-2 paragraph story summarizing the turn from your perspective.  
  2. **Player Monologue**: It sends your *updated* character profile (with new resources, relationships, etc.) and the turn's headlines, asking the AI to generate a brief, first-person inner thought reflecting your character's personality and goals.  
* **Player Implication**: This is how the game communicates the results to you. Instead of just seeing "-5000 denarii," you read a story about the crippling cost of the grain dole you authorized. The monologue gives you insight into your character's evolving state of mind, enhancing your future decisions.

### **8\. Event Check (Checking for Fateful Events)**

Finally, with the new state of the world in place, the game checks if this new reality has triggered any special, pre-scripted events.

* **Mechanics**: The checkForTriggeredEvent function in events/engine.ts runs. It checks the list of GameEvents from constants/events.ts. Each event has a trigger condition (e.g., worldState.economic\_stability \=== 'Crisis'). If the conditions are met for an event that hasn't happened yet, the game state is paused, and the EventModal is displayed.  
* **Player Implication**: This adds another layer of narrative richness. Your actions might not just have immediate consequences but could push the world state over a threshold that triggers a major crisis, like a grain shortage or a military mutiny, forcing you to make a difficult and impactful choice.

### **Summary of Gemini AI Calls Per Turn**

A single player turn involves three distinct calls to the **gemini-2.5-pro** model:

1.  **Story Relevance Call**  
   * **Purpose**: To determine which 1-3 NPCs are the primary drivers of the story for this turn.  
   * **Context Included**: Previous turn's headlines, current WorldState (political climate, etc.).  
   * **Result Usage**: The list of "spotlight entities" is added to the main prompt to instruct the AI to simulate proactive actions for them.  
2.  **Main Adjudication Call**  
   * **Purpose**: To simulate the entire week's events, including NPC actions and the consequences of the player's intent.  
   * **Context Included**: The complete "World Bible"—all Entity data, WorldState, recent history, the player's intent, the Meta-Narrative theme, and the spotlight entities from the first call.  
   * **Result Usage**: The returned Adjudication JSON object is used to mechanically update the entire game state via the applyAdjudication function.  
3.  **Narrative & Monologue Generation Call**  
   * **Purpose**: To translate the mechanical results of the turn into a compelling story for the player.  
   * **Context Included**: The Adjudication object (for the main narrative) and the player's updated Entity profile (for the monologue).  
   * **Result Usage**: The generated text is displayed directly to the player in the chat interface as the main story summary and the "Inner Thoughts" monologue.