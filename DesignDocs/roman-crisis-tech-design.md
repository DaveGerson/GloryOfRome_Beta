# Roman Crisis Simulation - Technical Design Document

## Executive Summary

A Python-based political simulation game set in Rome circa 235 CE, featuring AI-driven entities powered by Gemini 2.0 Pro/Flash. The game emphasizes emergent storytelling through information asymmetry, complex relationships, and narrative-focused gameplay.

## Technical Architecture

### Core Technologies
- **Language**: Python 3.10+
- **AI Model**: Gemini 2.0 Pro/Flash with function calling
- **Data Storage**: Local JSON files with versioned game folders
- **Interface**: Command-line interface (CLI)
- **Context Management**: Gemini context caching for entity states

### Project Structure
```
roman_crisis_simulation/
├── src/
│   ├── main.py                 # CLI entry point
│   ├── game_master.py          # Game Master AI logic
│   ├── entity_manager.py       # Entity AI processing
│   ├── gemini_client.py        # Gemini API wrapper
│   ├── data_manager.py         # File I/O and state management
│   ├── models/
│   │   ├── entity.py           # Entity data models
│   │   ├── world_state.py     # World state models
│   │   └── turn_data.py       # Turn processing models
│   └── prompts/
│       ├── game_master_prompts.py
│       └── entity_prompts.py
├── games/
│   ├── game_001/
│   │   ├── turns/
│   │   ├── entities/
│   │   └── world_state/
│   └── game_002/
└── config.py
```

## Data Models

### Entity Model (with Gemini Function Calling Schema)

```python
from typing import Dict, List, Optional, Union
from pydantic import BaseModel, Field

class PersonalityTraits(BaseModel):
    ambition: int = Field(..., ge=1, le=10, description="Drive for power and advancement")
    paranoia: int = Field(..., ge=1, le=10, description="Suspicion of others' motives")
    loyalty: int = Field(..., ge=1, le=10, description="Commitment to allies and oaths")
    cunning: int = Field(..., ge=1, le=10, description="Political intelligence and scheming")
    honor: int = Field(..., ge=1, le=10, description="Adherence to Roman virtues")
    
class Relationship(BaseModel):
    entity_id: str
    relationship_type: str = Field(..., description="family, ally, rival, subordinate, etc.")
    trust_level: int = Field(..., ge=-10, le=10, description="Trust rating from -10 to 10")
    recent_interactions: List[str] = Field(default_factory=list)
    
class Memory(BaseModel):
    turn: int
    event_description: str
    emotional_impact: str
    involved_entities: List[str] = Field(default_factory=list)

class Entity(BaseModel):
    entity_id: str
    entity_type: str = Field(..., description="individual or group")
    status: str = Field(..., description="alive, dead, exiled, missing")
    position: Optional[str] = Field(None, description="Current role/title")
    location: str
    
    # For individuals
    personality: Optional[PersonalityTraits] = None
    
    # For groups
    size: Optional[int] = None
    culture: Optional[Dict[str, List[str]]] = None
    
    # Shared attributes
    relationships: Dict[str, Relationship] = Field(default_factory=dict)
    memories: List[Memory] = Field(default_factory=list)
    resources: Dict[str, Union[int, float]] = Field(default_factory=dict)
    visibility_network: List[str] = Field(default_factory=list)
    
    # Dynamic state description (5 sentences)
    current_state_narrative: str = Field(..., description="5 sentence description of current physical/emotional state")
    
    # Goal evolution
    short_term_goals: List[str] = Field(default_factory=list, description="Immediate objectives")
    long_term_ambitions: List[str] = Field(default_factory=list, description="Life goals")
```

### Turn Data Models

```python
class EntityAction(BaseModel):
    entity_id: str
    turn_number: int
    
    # Structured responses via function calling
    situation_interpretation: str = Field(..., description="How the entity interprets received information")
    emotional_response: str = Field(..., description="Emotional reaction to events")
    
    # Actions
    high_level_actions: List[str] = Field(..., description="Strategic decisions")
    entity_interactions: List[Dict[str, str]] = Field(default_factory=list, description="Specific interactions with other entities")
    resource_allocations: Dict[str, Union[int, str]] = Field(default_factory=dict)
    
    # Open text for flexibility
    additional_narrative: Optional[str] = Field(None, description="Any additional context or color")
    internal_reasoning: str = Field(..., description="Why these decisions were made")
    
class GameMasterAdjudication(BaseModel):
    turn_number: int
    
    # Conflict resolutions
    resolved_conflicts: List[Dict[str, str]] = Field(default_factory=list)
    adjudication_reasoning: List[str] = Field(default_factory=list)
    
    # Environmental updates
    environmental_changes: Dict[str, str] = Field(default_factory=dict)
    new_entities_introduced: List[str] = Field(default_factory=list)
    entities_removed: List[Dict[str, str]] = Field(default_factory=list)
    
    # Narrative elements
    dramatic_moments: List[str] = Field(default_factory=list)
    historical_divergences: List[str] = Field(default_factory=list)
    
    # Open narrative
    turn_synopsis: str = Field(..., description="Private GM narrative of what occurred")
    player_visible_summary: str = Field(..., description="What the player's entity would know")
```

### Information Packet Model

```python
class InformationPacket(BaseModel):
    entity_id: str
    turn_number: int
    
    # Filtered information based on visibility
    general_news: List[str] = Field(..., description="Public knowledge in Rome")
    specific_intelligence: List[Dict[str, str]] = Field(..., description="Information from spy networks")
    observed_events: List[str] = Field(..., description="Things directly witnessed")
    rumors_and_hearsay: List[Dict[str, str]] = Field(..., description="Unverified information with source")
    
    # Environmental awareness
    environmental_factors: Dict[str, str] = Field(default_factory=dict)
    
    # Open narrative section
    narrative_context: str = Field(..., description="Narrative description of what the entity experiences")
```

## Gemini Integration

### API Client with Context Caching

```python
import google.generativeai as genai
from typing import Dict, Any, Optional
import json
import hashlib

class GeminiClient:
    def __init__(self, api_key: str, model_name: str = "gemini-2.0-pro-flash"):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)
        self.context_cache = {}
        
    def get_entity_context_key(self, entity: Entity) -> str:
        """Generate cache key for entity context"""
        # Create deterministic key from entity's permanent attributes
        context_data = {
            "entity_id": entity.entity_id,
            "personality": entity.personality.dict() if entity.personality else None,
            "long_term_ambitions": entity.long_term_ambitions,
            "culture": entity.culture
        }
        return hashlib.md5(json.dumps(context_data, sort_keys=True).encode()).hexdigest()
    
    def call_with_function(self, 
                          prompt: str, 
                          function_schema: Dict[str, Any],
                          context_key: Optional[str] = None,
                          temperature: float = 0.7) -> Dict[str, Any]:
        """Call Gemini with function calling enabled"""
        
        # Check context cache
        cached_context = self.context_cache.get(context_key) if context_key else None
        
        # Build full prompt with context
        full_prompt = prompt
        if cached_context:
            full_prompt = f"{cached_context}\n\n{prompt}"
        
        # Configure function calling
        response = self.model.generate_content(
            full_prompt,
            generation_config={
                "temperature": temperature,
                "response_mime_type": "application/json",
                "response_schema": function_schema
            }
        )
        
        return json.loads(response.text)
    
    def update_context_cache(self, entity: Entity):
        """Update cached context for an entity"""
        key = self.get_entity_context_key(entity)
        
        context = f"""You are {entity.entity_id}, a {entity.entity_type} in Rome, 235 CE.

Core Identity:
- Position: {entity.position}
- Location: {entity.location}
{"- Personality: " + json.dumps(entity.personality.dict()) if entity.personality else ""}
{"- Culture: " + json.dumps(entity.culture) if entity.culture else ""}

Long-term Ambitions:
{json.dumps(entity.long_term_ambitions, indent=2)}

Key Relationships:
{self._format_relationships(entity.relationships)}

This context remains constant. Variable information will be provided each turn."""
        
        self.context_cache[key] = context
        
    def _format_relationships(self, relationships: Dict[str, Relationship]) -> str:
        formatted = []
        for entity_id, rel in relationships.items():
            formatted.append(f"- {entity_id}: {rel.relationship_type} (trust: {rel.trust_level})")
        return "\n".join(formatted)
```

## Turn Processing Pipeline

### Game Master Agent

```python
class GameMasterAgent:
    def __init__(self, gemini_client: GeminiClient):
        self.client = gemini_client
        self.adjudication_schema = GameMasterAdjudication.schema()
        
    def process_turn(self, 
                    entity_actions: List[EntityAction], 
                    world_state: WorldState,
                    turn_number: int) -> GameMasterAdjudication:
        
        prompt = self._build_gm_prompt(entity_actions, world_state, turn_number)
        
        response = self.client.call_with_function(
            prompt=prompt,
            function_schema=self.adjudication_schema,
            temperature=0.8  # Higher for creative adjudication
        )
        
        return GameMasterAdjudication(**response)
    
    def _build_gm_prompt(self, actions, world_state, turn_number):
        return f"""You are the Game Master for a Roman political simulation set in {235 + turn_number//52} CE.

Your role: Adjudicate conflicts, update the world, and create dramatic narrative moments.
Prioritize: Historical plausibility initially, then gradually allow divergence based on player actions.
Goal: Create engaging drama while maintaining simulation integrity.

Current World State:
{json.dumps(world_state.dict(), indent=2)}

Entity Actions This Turn:
{self._format_entity_actions(actions)}

Tasks:
1. Resolve any conflicting actions (explain your reasoning)
2. Update environmental factors based on collective actions
3. Identify dramatic moments worth highlighting
4. Determine if new entities should be introduced (max 20% increase)
5. Note any historical divergences beginning to emerge

Remember: Information asymmetry is key. Entities only know what they could realistically know.
Focus on creating the most narratively interesting outcomes when conflicts arise."""
```

### Entity Agent Manager

```python
class EntityAgentManager:
    def __init__(self, gemini_client: GeminiClient):
        self.client = gemini_client
        self.action_schema = EntityAction.schema()
        
    async def process_entity_turn(self, 
                                 entity: Entity,
                                 information_packet: InformationPacket,
                                 turn_number: int) -> EntityAction:
        
        # Update context cache if needed
        self.client.update_context_cache(entity)
        
        prompt = self._build_entity_prompt(entity, information_packet, turn_number)
        
        response = self.client.call_with_function(
            prompt=prompt,
            function_schema=self.action_schema,
            context_key=self.client.get_entity_context_key(entity),
            temperature=0.7
        )
        
        return EntityAction(**response)
    
    def _build_entity_prompt(self, entity, info_packet, turn_number):
        return f"""Current Turn: {turn_number} (Week {turn_number} of your story)

Your Current State:
{entity.current_state_narrative}

Short-term Goals: {json.dumps(entity.short_term_goals)}

Information Received This Turn:
{json.dumps(info_packet.dict(), indent=2)}

Recent Memories:
{self._format_recent_memories(entity.memories, turn_number)}

Available Resources:
{json.dumps(entity.resources)}

Respond with your actions for this turn. Remember:
- You only know what you've been told or observed
- Make assumptions where information is incomplete
- Act according to your personality and current emotional state
- Consider both immediate needs and long-term ambitions
- Your spy networks (if any) provide accurate information
- Other information may be rumors or misinformation"""
```

## Game Flow Implementation

### Main Game Loop

```python
class RomanCrisisGame:
    def __init__(self, game_folder: str):
        self.game_folder = game_folder
        self.gemini_client = GeminiClient(api_key=GEMINI_API_KEY)
        self.gm_agent = GameMasterAgent(self.gemini_client)
        self.entity_manager = EntityAgentManager(self.gemini_client)
        self.data_manager = DataManager(game_folder)
        
    async def run_turn(self, turn_number: int):
        print(f"\n=== TURN {turn_number}: Week {turn_number} of Crisis ===")
        
        # 1. Load current state
        world_state = self.data_manager.load_world_state()
        entities = self.data_manager.load_all_entities()
        
        # 2. GM prepares information packets
        info_packets = self.gm_agent.prepare_information_packets(
            world_state, entities, turn_number
        )
        
        # 3. Process entity decisions asynchronously
        entity_actions = []
        for entity in entities:
            if entity.status == "alive" and not self._should_skip_entity(entity):
                try:
                    action = await self.entity_manager.process_entity_turn(
                        entity, info_packets[entity.entity_id], turn_number
                    )
                    entity_actions.append(action)
                except Exception as e:
                    print(f"Error processing {entity.entity_id}: {e}")
                    # Retry logic here
        
        # 4. GM adjudicates
        adjudication = self.gm_agent.process_turn(
            entity_actions, world_state, turn_number
        )
        
        # 5. Update world state
        self._apply_adjudication(adjudication, world_state, entities)
        
        # 6. Save all data
        self.data_manager.save_turn_data(turn_number, {
            "info_packets": info_packets,
            "entity_actions": entity_actions,
            "adjudication": adjudication
        })
        
        # 7. Present to player
        self._display_player_summary(adjudication, entities)
```

### CLI Interface

```python
class CLIInterface:
    def __init__(self, game: RomanCrisisGame):
        self.game = game
        
    def main_menu(self):
        while True:
            print("\n=== ROMAN CRISIS SIMULATION ===")
            print("[N] Next Turn")
            print("[V] View Entity Details")
            print("[R] Review Past Turn")
            print("[W] World State Summary")
            print("[G] GM Synopsis (Debug)")
            print("[S] Save and Exit")
            print("[Q] Quit without Saving")
            
            choice = input("\n> ").upper()
            
            if choice == 'N':
                asyncio.run(self.game.run_turn(self.game.current_turn))
            elif choice == 'V':
                self.view_entity_menu()
            # ... other options
```

## Initial Setup & Entities

### Starting Scenario: Eve of Severus Alexander's Assassination (235 CE)

```python
INITIAL_ENTITIES = [
    {
        "entity_id": "severus_alexander",
        "entity_type": "individual",
        "position": "Emperor",
        "personality": {
            "ambition": 3,
            "paranoia": 7,
            "loyalty": 8,
            "cunning": 4,
            "honor": 9
        },
        "location": "imperial_palace",
        "current_state_narrative": "Young and idealistic, you struggle to maintain order as the legions grow restless. Your mother Julia Mamaea's influence protects you but also undermines your authority. You sense the growing discontent but hope your just rule will prevail. The German frontier weighs heavily on your mind. Sleep comes fitfully these days.",
        "long_term_ambitions": ["Restore the glory of the Antonine dynasty", "Achieve peace with Persia", "Reform the military"]
    },
    {
        "entity_id": "maximinus_thrax",
        "entity_type": "individual", 
        "position": "Legion Commander",
        "personality": {
            "ambition": 10,
            "paranoia": 6,
            "loyalty": 2,
            "cunning": 7,
            "honor": 4
        },
        "location": "germania_frontier",
        "current_state_narrative": "A giant of a man from Thracian peasant stock, you've risen through sheer force and military skill. The perfumed senators despise you, but the soldiers love you. You grow tired of the boy emperor's weakness. The men whisper of change in their tents. Your moment approaches.",
        "long_term_ambitions": ["Become Emperor", "Crush the barbarians", "Reward the military"]
    },
    {
        "entity_id": "praetorian_guard",
        "entity_type": "group",
        "size": 5000,
        "location": "praetorian_camp",
        "culture": {
            "primary_concerns": ["pay", "privilege", "stability"],
            "loyalties": ["highest_bidder", "strong_leadership"]
        },
        "current_state_narrative": "The elite guard grows restless under weak leadership. Whispers of the frontier legions' discontent reach the camp. Some remain loyal to tradition, others eye opportunities. The last donative was smaller than expected. Discipline holds, but for how long?",
        "long_term_ambitions": ["Maintain privileged position", "Maximize profit from regime changes"]
    },
    {
        "entity_id": "julia_mamaea",
        "entity_type": "individual",
        "position": "Augusta (Emperor's Mother)",
        "personality": {
            "ambition": 8,
            "paranoia": 9,
            "loyalty": 10,
            "cunning": 8,
            "honor": 6
        },
        "location": "imperial_palace",
        "current_state_narrative": "You've guided your son since childhood, but the burden grows heavy. Every shadow might hide an assassin. You trust no one fully, not even family. The treasury concerns you - the soldiers always want more. You must protect Alexander at all costs.",
        "long_term_ambitions": ["Protect son's throne", "Maintain Severan dynasty", "Accumulate wealth for security"]
    },
    {
        "entity_id": "senate_faction",
        "entity_type": "group",
        "size": 300,
        "location": "senate_house",
        "culture": {
            "primary_concerns": ["tradition", "privilege", "peace"],
            "stereotypes": ["soldiers_are_brutes", "emperors_should_respect_senate"]
        },
        "current_state_narrative": "The ancient body watches nervously as military men grow bold. Some dream of restored Republican glory, others merely seek survival. The young emperor respects tradition, but his weakness invites chaos. Alliances shift daily in hushed conversations.",
        "long_term_ambitions": ["Preserve senatorial dignity", "Prevent military dictatorship", "Maintain estates and wealth"]
    }
]
```

### Player Character Options

```python
PLAYER_CHARACTER_OPTIONS = [
    {
        "name": "The Young Emperor",
        "entity_id": "severus_alexander",
        "description": "Rule as the idealistic but embattled emperor. Can you prevent your assassination and save the empire from chaos?",
        "difficulty": "Hard"
    },
    {
        "name": "The Ambitious General", 
        "entity_id": "maximinus_thrax",
        "description": "Lead the frontier legions in revolt. Seize the purple through strength and cunning.",
        "difficulty": "Medium"
    },
    {
        "name": "The Scheming Senator",
        "entity_id": "custom_senator",
        "description": "Navigate the treacherous waters of Roman politics. Build alliances and survive the coming storm.",
        "difficulty": "Medium"
    },
    {
        "name": "The Praetorian Prefect",
        "entity_id": "custom_praetorian",
        "description": "Command the emperor's guard. Your choices will determine who rules Rome.",
        "difficulty": "Easy"
    }
]
```

## Error Handling & Retry Logic

```python
class GeminiRetryHandler:
    def __init__(self, max_retries: int = 3, timeout: int = 30):
        self.max_retries = max_retries
        self.timeout = timeout
        
    async def call_with_retry(self, func, *args, **kwargs):
        for attempt in range(self.max_retries):
            try:
                return await asyncio.wait_for(
                    func(*args, **kwargs), 
                    timeout=self.timeout
                )
            except asyncio.TimeoutError:
                print(f"Timeout on attempt {attempt + 1}, retrying...")
                continue
            except Exception as e:
                if attempt == self.max_retries - 1:
                    print(f"Failed after {self.max_retries} attempts: {e}")
                    raise
                print(f"Error on attempt {attempt + 1}: {e}, retrying...")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
```

## Development Phases

### Phase 1: Core Implementation (Week 1-2)
1. Set up project structure and Gemini client
2. Implement data models and file management
3. Create basic Game Master adjudication
4. Build simple CLI interface
5. Test with 2-3 entities

### Phase 2: Full Game Loop (Week 3-4)
1. Implement entity decision processing
2. Add information filtering system
3. Create turn persistence and loading
4. Expand to 5-8 entities
5. Add player character control

### Phase 3: Polish & Features (Week 5-6)
1. Enhance narrative generation
2. Add dynamic entity creation/removal
3. Implement player intervention options
4. Optimize API costs with better caching
5. Create victory condition checking

## Cost Estimation

### Per Turn Costs (Estimated)
- Game Master Adjudication: ~2,000 tokens input, ~1,500 output
- Per Entity Decision: ~1,500 tokens input, ~800 output
- Information Packets: ~500 tokens per entity

### With 10 Entities:
- Input: ~20,000 tokens per turn
- Output: ~10,000 tokens per turn
- **Estimated cost**: $0.10-0.20 per turn with Gemini Pro

### Optimization Strategies:
1. Context caching for personality/relationships (50% reduction)
2. Batch similar entities when possible
3. Compress historical data references
4. Use Gemini Flash for non-critical decisions

This design provides a solid foundation for implementing your Roman Crisis simulation with clean separation of concerns, robust error handling, and scalable architecture. The function calling approach with Pydantic models ensures type safety while maintaining the flexibility you need for narrative elements.