# **Turn Structure and Mechanics: A Deep Dive**

> ## ⚠️ STALE DOCUMENT
> This walkthrough predates the resolution layer (hidden action rolls),
> the mortality pipeline, the Director's persistent intents, the per-turn
> NPC mind calls, the perception/knowledge layers, and the pipeline's
> parallelized legs — its step ordering and its "6–7 Gemini calls per
> turn" accounting no longer match the code. **The accurate pipeline
> record is `ai/prompts/README.md`** (one entry per call, in order, with
> models and consumers); `ai/core/turn.ts`'s own comments document the
> exact stage sequence. The prose below is kept for the player-implication
> commentary only.

The core of the Roman Crisis Simulation is its turn-based engine, where each turn simulates one tumultuous week in Rome. A turn is not just a simple "player move, computer move" sequence. Instead, it's a comprehensive simulation where the player's actions happen concurrently with the schemes and reactions of every other character in the world. This creates a dynamic and unpredictable narrative.

Here is a detailed, step-by-step breakdown of how a single turn unfolds, both mechanically and from a player's perspective.

### **1\. The Player's Action (The Intent)**

It all begins with you. You type your action for the week into the input box—this is your **Intent**.

* **Mechanics**: The text you enter is captured by the main App.tsx component. This string of text is the primary input that will shape the entire turn's simulation. It's stored as the playerIntent variable.  
* **Player Implication**: The clarity and specificity of your intent matter significantly. "I will host a lavish banquet for influential senators to win their favor" provides the AI with more context and direction than "Talk to the Senate." The more detailed your intent, the more nuanced and logical the simulation's response can be. Think of yourself as giving orders to a subordinate; the better the order, the better the execution.

### **2\. Context Compilation & Story Relevance**

Before simulating the week, the game determines which characters are most central to the unfolding drama and gathers all the necessary information for the AI Game Master.

* **Mechanics**: The runNewTurn function in ai/core/turn.ts makes its first call to the Gemini AI using the getStoryRelevance function (ai/tools/intelligence.ts), on the **gemini-3-pro-preview** model. It sends the previous turn's public headlines and the current WorldState (e.g., political climate is 'Volatile'). The AI responds by identifying 2-4 "spotlight entities"—characters whose actions are most likely to drive the story forward this week—and may also suggest adding/removing an entity or location to keep the world evolving. Subsequently, the compileContext function assembles a massive text prompt. This "World Bible" includes:  
  * The current WorldState.  
  * Detailed profiles of every Entity, including their personality, goals, relationships, and resources. Spotlight NPCs are explicitly marked as "proactive."  
  * A summary of the last six turns to provide historical context.  
  * A `Meta-Narrative` string. This is a high-level directive (e.g., 'An imperial succession crisis' or 'A gothic horror story') that guides the AI's tonal and thematic choices throughout the simulation, ensuring consistency.  
  * And, crucially, your **Intent** for the current turn.  
* **Player Implication**: This is a key feature that makes the world feel alive. It means that major NPCs aren't just waiting for you to act; they are actively pursuing their own goals. If your rival, Maximinus Thrax, is in the spotlight, you can expect him to make a significant move this turn, regardless of what you do. Your action is also placed into the context of the entire world; the AI will judge it not in a vacuum, but based on who you are, who your allies and enemies are, and the current political climate.

### **3\. Proactive NPC Simulation**

The AI Game Master receives the "World Bible" and begins the simulation. The first phase is to determine what the most important NPCs do on their own initiative.

* **Mechanics**: This is the first part of the main adjudication call to Gemini (on the **gemini-3-pro-preview** model, with `thinkingConfig.thinkingBudget: 1024`). The AI is specifically instructed to look at the "spotlight" NPCs and, based on their personality and active\_scheme, decide on a proactive course of action for the week. For example, if Maximinus Thrax's scheme is to "undermine the Emperor," he might independently decide to spread propaganda or attempt to bribe a guard captain.  
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

### **5.5. Meta-Narrative State Update**

Immediately after the Adjudication JSON comes back, the game updates a separate, high-level tracker of the empire's overall condition, before any deltas are applied to individual entities.

* **Mechanics**: The runNewTurn function calls getUpdatedSimulationState (ai/tools/intelligence.ts), on the **gemini-3-pro-preview** model. It sends the previous SimulationState plus the turn's headlines and a sample of the deltas, and asks the AI to return a new SimulationState object with fields like imperial\_status ('Stable' | 'Contested' | 'Vacant'), senate\_status, military\_status, plebeian\_mood, and major\_ongoing\_crisis. The AI is instructed with hard rules (e.g., if an emperor was killed, imperial\_status MUST become 'Vacant').  
* **Player Implication**: This is the empire's "big picture" health bar, distinct from any single entity's stats. It's what lets the game recognize when a Civil War or Succession Crisis has begun, even before that reality is reflected in any one character's sheet.

### **6\. State Application (Making It Real)**

The game's code now takes the AI's Adjudication plan and executes it, permanently changing the game world.

* **Mechanics**: The applyAdjudication function in ai/core/engine.ts iterates through every delta in the Adjudication object and applies the changes to the entities and worldState objects being managed in App.tsx. Resources are updated, relationships shift, statuses change, and new reports (from rumors) are created.  
* **Player Implication**: This is the point of no return. The consequences of the week's events are now locked in. Your resources have been spent, your reputation has changed, and the world has moved on. You can see these new values reflected in the Side Panel tabs.

### **6.5. Off-Screen NPC Communication Simulation**

To create a deeper sense of a living world, the simulation performs one final, secret step before telling you what happened.

*   **Mechanics**: After the main turn's state changes are applied, and only if there are at least 2 spotlight entities from Step 2, a new Gemini call (`simulatePrivateConversation`, on the **gemini-3-pro-preview** model) is made using the two most important "spotlight" NPCs as inputs. The AI generates a summary of a secret conversation between them and 1-3 resulting `EventDeltas` (e.g., trust increases, a new secret is created). These deltas are immediately applied to the game state, and the summary is added to the private GM Log. If fewer than 2 spotlight entities exist this turn, this step is skipped entirely.
*   **Player Implication**: This adds a layer of genuine intrigue. The world evolves not just in response to your actions, but through the independent scheming of its inhabitants. You won't be told about these secret meetings directly. You will only see their consequences—a sudden change in an NPC's attitude, an unexpected new resource appearing for a rival—creating new mysteries for you to solve through espionage.

### **7\. Narrative Generation (Crafting the Story)**

The game world is updated, but you, the player, see numbers and stats. The simulation now translates these mechanical changes into a compelling narrative, in two more sequential Gemini calls.

* **Mechanics**:  
  1. **Player Monologue** (called first): getPlayerMonologue (ai/tools/intelligence.ts), on the **gemini-2.5-flash** model. It sends your *updated* character profile (with new resources, relationships, etc.), this week's headlines, and your last few turns' intents, asking the AI to generate a brief, first-person inner thought reflecting your character's personality and recent strategy.  
  2. **Main Narration** (called second): A direct `ai.models.generateContent` call inline in runNewTurn, on the **gemini-3-pro-preview** model (`thinkingConfig.thinkingBudget: 512`). It sends the entire Adjudication object plus your updated character profile and asks the AI to write a 2-3 paragraph story summarizing the turn from your perspective (direct consequences → observed/reported events → sourced information), followed by exactly 3 "SUGGESTION:"-prefixed next actions, which are parsed out of the response text.  
* **Player Implication**: This is how the game communicates the results to you. Instead of just seeing "-5000 denarii," you read a story about the crippling cost of the grain dole you authorized. The monologue gives you insight into your character's evolving state of mind, enhancing your future decisions.

### **7.5. Relationship Update Pass**

With the narration text now in hand, the game makes one last pass to catch relationship shifts that the main adjudication might have missed or under-specified.

* **Mechanics**: getRelationshipUpdates (ai/tools/intelligence.ts), on the **gemini-3-pro-preview** model. It sends the finished narration and headlines, plus a brief of every living entity's current relationships, and asks the AI to propose 'relation' deltas (trust\_level, respect\_level, perceived\_threat, ideological\_alignment, dependency\_level) for pairs whose feelings were directly or strongly implicitly affected by the turn's events. If any are returned, they are applied immediately via applyDeltas and logged to the private GM log.  
* **Player Implication**: This keeps relationship stats honest with the story you actually read, rather than only what the earlier, more mechanically-focused adjudication call thought to change.

### **8\. Event Check (Checking for Fateful Events)**

Finally, with the new state of the world in place, the game checks if this new reality has triggered any special, pre-scripted events.

* **Mechanics**: The checkForTriggeredEvent function in events/engine.ts runs. It checks the list of GameEvents from constants/events.ts. Each event has a trigger condition (e.g., worldState.economic\_stability \=== 'Crisis'). If the conditions are met for an event that hasn't happened yet, the game state is paused, and the EventModal is displayed.  
* **Player Implication**: This adds another layer of narrative richness. Your actions might not just have immediate consequences but could push the world state over a threshold that triggers a major crisis, like a grain shortage or a military mutiny, forcing you to make a difficult and impactful choice.

### **Summary of Gemini AI Calls Per Turn**

A single player turn (runNewTurn in ai/core/turn.ts) makes **6 sequential Gemini calls, plus 1 conditional call** (7 total in the best case). Every call except the player monologue uses **gemini-3-pro-preview**; the monologue call uses the cheaper/faster **gemini-2.5-flash**. isMockMode bypasses all of them via mockRunNewTurn.

1.  **getStoryRelevance** — *gemini-3-pro-preview*  
   * **Purpose**: Determine which 2-4 NPCs are the primary drivers of the story for this turn (and optionally suggest adding/removing an entity or location).  
   * **Context Included**: Previous turn's headlines, current WorldState (political climate, etc.), turn number.  
   * **Result Usage**: The "spotlight entities" are woven into the main prompt (compileContext) to instruct the AI to simulate proactive actions for them, and reused in Step 4 below.  
2.  **Main Adjudication Call** — *gemini-3-pro-preview* (`thinkingBudget: 1024`)  
   * **Purpose**: Simulate the entire week's events — proactive spotlight-NPC actions, the consequences of the player's intent, and every other NPC's reaction — as a single structured `Adjudication` JSON object (schema in ai/core/schemas.ts).  
   * **Context Included**: The complete "World Bible" from compileContext — all Entity data, WorldState, recent history, the player's intent, the Meta-Narrative theme, and Step 1's spotlight entities.  
   * **Result Usage**: Parsed into the `Adjudication` object used by every subsequent step.  
3.  **getUpdatedSimulationState** — *gemini-3-pro-preview*  
   * **Purpose**: Update the empire-wide `SimulationState` (imperial\_status, senate\_status, military\_status, plebeian\_mood, major\_ongoing\_crisis) based on the Adjudication's headlines and deltas.  
   * **Result Usage**: Returned SimulationState is stored as-is; this happens before `applyAdjudication` mutates entities/world state.  
   * *(Non-AI step in between: `applyAdjudication`/`applyDeltas` mechanically apply all of the Adjudication's deltas to entities, worldState, and reports.)*  
4.  **simulatePrivateConversation** — *gemini-3-pro-preview* — **conditional**: only runs if Step 1 produced 2+ spotlight entities.  
   * **Purpose**: Simulate a secret off-screen conversation between the top 2 spotlight NPCs.  
   * **Result Usage**: Its 1-3 `EventDelta`s are applied immediately via `applyDeltas`; its dialogue snippet is appended to `adjudication.gm_private`.  
5.  **getPlayerMonologue** — *gemini-2.5-flash*  
   * **Purpose**: Generate a brief first-person inner thought for the player character.  
   * **Context Included**: The player's *updated* Entity profile, this turn's headlines, and the player's last few turns' intents.  
   * **Result Usage**: Displayed to the player as the "Inner Thoughts" monologue.  
6.  **Main Narration Call** (inline `ai.models.generateContent`, not a named tool function) — *gemini-3-pro-preview* (`thinkingBudget: 512`)  
   * **Purpose**: Turn the Adjudication JSON into a 2-3 paragraph narrative plus exactly 3 suggested next actions.  
   * **Context Included**: The full Adjudication object and the player's updated Entity profile.  
   * **Result Usage**: Split on the `SUGGESTION:` marker into the displayed narration text and the 3 suggested-action prompts.  
7.  **getRelationshipUpdates** — *gemini-3-pro-preview*  
   * **Purpose**: Propose additional relationship deltas based on the finished narration text (a pass the main adjudication call may under-specify).  
   * **Context Included**: The narration, headlines, and a brief of every living entity's current relationships.  
   * **Result Usage**: Any returned deltas are applied immediately via `applyDeltas` and logged to `adjudication.gm_private`.

After all of this, `runNewTurn` returns and App.tsx commits the results, increments its own `turnNumber` state, and then `checkForTriggeredEvent` (events/engine.ts, Step 8 above) runs — a synchronous, non-AI check.