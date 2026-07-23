# Archive — pre-implementation design history

The files in this folder are early design exploration from before the project's current
architecture existed. They describe a **Python CLI** game (local JSON save folders, a
`GeminiClient` with hand-rolled context caching, player-definable "victory conditions,"
a menu-driven console interface) that was never built. The shipped app is a React + Vite +
TypeScript, Gemini-backed web app living in `roman_crisis_simulation/src` — a different
stack, and in places a different design (e.g. only death is terminal; there are no win
states or victory conditions — see `roadmaps/DESIGN_DECISIONS.md` D1).

Do not treat anything in this folder as current or aspirational design truth. For that, see:

- `roadmaps/ROADMAP_0_MASTER_PLAN.md` — the phased master plan.
- `roadmaps/DESIGN_DECISIONS.md` — binding owner rulings (D1–D34).
- `roadmaps/ROADMAP_PHASE_4.md` — the current in-flight plan.
- the code itself, under `roman_crisis_simulation/src`.

## What's here

- **`Roman Empire Game Design.json`** — the first design conversation (exported chat
  transcript). Establishes the original brief: a console/chat-driven simulation with
  player-definable victory conditions and JSON-file persistence per game session.
- **`Roman Political Simulation Discussion.json`** — the follow-up conversation
  (explicitly picks up "a previous version" of the file above) that refines the same
  Python/CLI design — entity personality models, turn-processing pipeline, information
  packets — ahead of writing it up formally.
- **`roman-crisis-tech-design.md`** — the technical design doc produced from those two
  conversations. Explicitly scoped to "Python 3.10+", Pydantic models, `asyncio`, and a
  CLI — none of which describe the shipped app.

All three are kept for historical reference only (how the idea evolved before
implementation), not because any of their technical detail still applies.
