The goal of this project is to create a dynamic and highly interactive simulation of the Roman empire where users can
dynamically roleplay being a prominent politician or general in the Roman empire. In particular, the duplicitousness of
everybody at this point in time leads to a world where everybody is at each others throats and managing the complexity
of the events occuring "out of your line of sight" is incredibly important. In addition to the tumultuousness of the
time, the upbringing and history of everybody involved has a key role to play in the game.

The challenge is that the complexity of human nature cannot be programmed in a deterministic way because there are too
many inputs, and the inputs are too abstract to be hand-coded. AI is a potential solve for this gap because it can
handle and develop an understanding of far more inputs than humans could event think about and structure, let alone
develop programatic rules for.

## Repo layout

- `roman_crisis_simulation/src` — the app (React + Vite + TypeScript, Gemini-backed).
- `roadmaps/` — the phased master plan (`ROADMAP_0_MASTER_PLAN.md`), the six domain
  analyses it was built from, `DESIGN_DECISIONS.md` (binding owner rulings), the
  Phase 4 audit/decision record (`PHASE_4_BRAINSTORM.md`), the Phase 4 and Phase 6
  plans, the open backlog (`BACKLOG.md`), and the tech-debt record
  (`TECH_DEBT_QUESTIONNAIRE.md`).
- `docs/superpowers/` — per-feature design specs and implementation plans.
- `DesignDocs/` — UI specs, wireframes, and design notes. `DesignDocs/archive/` holds
  superseded pre-implementation design history (an abandoned Python/CLI design) — see
  `DesignDocs/archive/README.md`.

The app's own architecture guide is `roman_crisis_simulation/src/README.md`.

## Running it

```
cd roman_crisis_simulation/src
npm ci
npm run dev
```

Paste your own Gemini API key in the in-app **⚙ Settings** menu, or play offline in Mock
Mode (see the app README).

Checks — exactly what CI runs (CI runs the three legs in parallel):

```
npm run verify   # = verify:static (typecheck, lint)
                 # + verify:unit (vitest)
                 # + verify:integration (journeys, deterministic eval, build)
```
