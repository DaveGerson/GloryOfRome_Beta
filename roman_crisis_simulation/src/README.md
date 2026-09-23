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

# **Codebase**

## **Current Structure of Game Files**

A React 19 + TypeScript + Vite single-page app with no server: every Gemini call is made from the browser with the player's own key (D34), and all persistence is `localStorage`. The load-bearing idea is **information asymmetry enforced in code**: the adjudicator's output is ground truth, and dedicated layers decide what each viewer (the player, each NPC, the GM console) is allowed to see.

* **/ (this folder)**: entry points (`index.html`, `index.tsx`), the composition root (`App.tsx`), the shared domain types (`types.ts`), and tooling config (`package.json`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts`, and one `vitest.*.config.ts` per test leg).
* **/state**: the single game-domain reducer and its React context (D17). Every slice the autosave reads lives here; `App.tsx` is the only consumer of the context and passes plain props down.
* **/hooks**: stateful orchestration extracted out of `App.tsx` — chiefly `useExecuteTurn.ts`, the turn transaction (submit → `runNewTurn` → knowledge/relationship follow-ups → commit or roll back).
* **/ai**: everything that talks to the model.
  * **/ai/core**: the turn pipeline (`turn.ts`), the pure state applier (`engine.ts`), the single Gemini gateway (`geminiService.ts`: model tiers, retries, zod validation, call capture), deterministic resolution and mortality (`resolution.ts`, `mortality.ts`), response schemas (`schemas.ts` for Gemini, `zodSchemas.ts` for runtime validation), and the player-visibility boundaries (`playerBoundary.ts`, `actorsBoundary.ts`).
  * **/ai/tools**: single-purpose model calls outside the main turn — action assessment, NPC minds, intelligence/investigation, ambition inference, private scenes, relationship observations, character creation.
  * **/ai/prompts**: every prompt builder, one file per call family; `ai/prompts/README.md` is the inventory (call → builder → model → schema → pipeline stage).
  * **ai/mocks.ts**: offline stand-ins for every call, powering Mock Mode and the test suites.
* **/perception**: the viewer filter. `visibility.ts` decides which ground-truth deltas a given viewer could plausibly perceive (D5); `npcPerception.ts` applies the same rules to each NPC (D10).
* **/knowledge**: the player's side of the asymmetry — the claim store (`store.ts`, D21), commit-time ingestion (`commit.ts`), relationship observations, credibility framing that never shows numbers (D25/D26), and dossier refresh pricing (D27).
* **/playerInput**: the structured turn submission — its versioned wire format and validation (`turnSubmission.ts`) and the composer's draft state (`composerState.ts`).
* **/playerView**: player-facing answers built only from what the player already knows (e.g. `noAttemptResponse.ts` for question-only / private-intent turns).
* **/privateScene**: the pure model of one-on-one audiences with an NPC (lifecycle, speech acts, closure rules). NPC-private fields stay GM-only.
* **/events**: evaluation of scripted events against the current state (`engine.ts`), including repeatable-event cooldowns.
* **/constants**: static starting data — the 235 CE scenario and the scripted event definitions.
* **/persistence**: everything read from or written to the browser. `saveGame.ts` is the single autosave slot (versioned envelope, never throws, typed failure reasons); `saveMigrations.ts` is its upgrade registry; `crossTab.ts` detects another tab writing the same slot; `apiKey.ts`, `settings.ts`, `uiPrefs.ts`, `onboarding.ts` are device preferences kept out of the save; `evalCorpus.ts` builds the GM console's eval export.
* **/components**: the UI. Top-level screens and panels live directly here; `tabs/` holds the side-panel tabs, `gm/` the GM console views, `ui/` shared primitives (forms, alerts, focus trapping, failure notices).
* **/design**: CSS design tokens and component styles.
* **/eval**: the offline eval harness over an exported corpus — deterministic checks (`harness.ts`) plus an optional LLM judge (`judge.ts`). Never imported by app code; see `eval/README.md`.
* **/tests**: the vitest suites (`*.test.ts[x]`), shared factories, and `tests/journeys/` — end-to-end campaign journeys driven through the real `App` with mocked AI.

## **Key Files**

* `App.tsx`: the composition root — screens, handlers, and all persistence calls. Game state lives in `state/`, the turn transaction in `hooks/useExecuteTurn.ts`.
* `types.ts`: the domain model (`Entity`, `WorldState`, `Adjudication`, `EventDelta`, `Report`, turn history, …).
* `ai/core/turn.ts`: `runNewTurn`, the per-turn pipeline (see below); `ai/core/turn_logic.md` is the long-form explanation.
* `ai/core/engine.ts`: applies an `Adjudication`'s deltas to entities and world state, and maintains the GM-private truth ledger.
* `ai/core/geminiService.ts`: the one chokepoint for model calls.
* `ai/core/initiator.ts`: generates a fresh scenario from a player-supplied meta-narrative.
* `perception/visibility.ts`: the ground-truth → player-visible filter.
* `knowledge/store.ts`: the player's belief graph.
* `persistence/saveGame.ts`: save/load/import/export of the campaign.
* `components/GameMasterScreen.tsx`: the GM console (Ctrl+Shift+G) — raw calls, ground truth, perception, fixtures and the eval-corpus export.

## **Checks**

Run from this folder. `npm run verify` is exactly what CI runs, as three legs (CI runs them in parallel):

* `npm run verify:static` — `typecheck` + `lint`.
* `npm run verify:unit` — the vitest suite.
* `npm run verify:integration` — `test:journeys`, `eval:ci` (the deterministic eval over `eval/fixtures/ci-corpus.json`, judge forced off), and `build`.

`npm run eval` with `GOR_EVAL_CORPUS` (and optionally `GEMINI_API_KEY`) runs the eval against your own exported corpus.

# **Game Logic and Execution Structure**

## **Turn Structure and Mechanics**

The game operates on a turn-based system where each turn represents one week of in-game time. For the full breakdown, **see `ai/core/turn_logic.md`** and the stage inventory in `ai/prompts/README.md`. The high-level pipeline in `runNewTurn` (its `TurnStage`s in brackets):

1.  **Director and assessment** [`story_relevance`]: the Director picks the spotlight NPCs for this turn and carries their persistent intents forward; concurrently, a cheap assessment call decides whether the player's action is consequential enough to warrant a hidden roll, and what to roll against.
2.  **NPC minds** [`npc_minds`]: each spotlight NPC decides its own move in character, from its *bounded* knowledge only.
3.  **Adjudication** [`adjudication`]: the Game Master receives the world, the NPC decisions, and the player's action with its code-decided outcome (the roll is resolved deterministically in `ai/core/resolution.ts`; the model narrates a pre-decided result) and returns one structured `Adjudication`: actions, atomic `EventDelta`s, headlines, and GM-private notes.
4.  **Mortality** [`mortality`, only when a death is claimed]: every claimed death passes code-side gates before it sticks.
5.  **State application**: `engine.ts` applies the deltas; the perception layer decides what the player and each NPC actually learned.
6.  **Simulation state, monologue, narration** [`simulation_state`, `monologue`, `narration`, in parallel]: the hidden simulation state is updated, and the player-facing narration (streamed) and inner monologue are written from the player's knowledge.
7.  **Commit**: `hooks/useExecuteTurn.ts` folds the result into knowledge and relationships and commits it atomically with the autosave — or rolls the whole turn back. `App.tsx` then checks whether the new state triggers a scripted `GameEvent` (`events/engine.ts`).

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

## **Proposed Feature Enhancements**

* **Faction Cohesion & Internal Politics**: Add a `cohesion` property to factions (e.g., from 0 to 10). Low cohesion could cause factions to splinter, with ambitious members breaking off to form their own sub-factions or defecting. This would make managing a faction more challenging and dynamic. *Feasibility: Medium. Requires new logic for faction splits and updates to the AI's adjudication rules.*
* **Reputation System**: Add a reputation object to the Entity type (e.g., { honor: 5, ruthlessness: \-3 }). Player actions would modify their reputation, and NPCs would react based on these traits in addition to trust. For example, a ruthless player might find it harder to form alliances but easier to intimidate rivals. *Feasibility: High. This is a simple extension of the existing delta system.*  
* **Dynamic Rumor Mill**: Enhance the rumor delta type. Instead of just adding a report, rumors could spread through the NPC network. A rumor's credibility could change over time, and NPCs could act on false information, leading to unpredictable and chaotic outcomes. *Feasibility: Medium. This requires adding logic for how information propagates between entities.*  
* **Historical Event Injections**: Create a system where, at certain dates (e.g., Year 238 CE), the GM can inject major historical events (like the rise of the Gordian emperors). The AI would then have to adjudicate how the current, potentially alternate-history game state reacts to this external shock. *Feasibility: Medium. It requires a timeline system but leverages the existing GM intervention functionality.*