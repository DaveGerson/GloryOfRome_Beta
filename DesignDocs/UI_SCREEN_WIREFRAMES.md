# Glory of Rome — Current Interface Descriptions (Wireframes)

**Purpose:** A complete, neutral description of every interface that exists in the game today —
structure, elements, behaviors, and states — intended as input for a holistic visual redesign.
It describes *what is*, not what should be; redesign proposals live separately in
`UI_SYSTEMS_CURRENT_AND_FUTURE.md` Part II.

For each screen:
- a **wireframe** showing structure, zones, and hierarchy (not pixel-accurate),
- an **element inventory** listing every widget, its data source, and its behavior,
- the **states and variants** the screen can be in.

Current visual styling, briefly (full detail in `UI_SYSTEMS_CURRENT_AND_FUTURE.md` §2):
an "aged parchment & carved stone" Roman theme — Cinzel serif typefaces, sepia/stone palette
with imperial-red accents and amber highlights, double-line borders between regions,
translucent stone-textured card surfaces, a dark noise-textured surface for the GM overlay,
and a small motion vocabulary (fade-in entrances, button hover-lift, staggered pill slide-up,
bouncing typing dots).

All file references are relative to `roman_crisis_simulation/src/`.

---

## 0. Screen Map

There is no router. One shell renders everything; the `GameState` enum (`types.ts:3-8`) and two
flags decide what is visible.

```
                    ┌─────────────────────────────┐
                    │  APP SHELL (always mounted) │
                    │  Header + CrisisBanner      │
                    │  + 2-pane body              │
                    └──────────────┬──────────────┘
              GameState == SETUP   │   GameState != SETUP
           ┌───────────────────────┴───────────────────────┐
           ▼                                               ▼
 ┌───────────────────────┐                   ┌───────────────────────────┐
 │ S1 CHARACTER SELECT   │                   │ S2 MAIN GAME VIEW         │
 │  (fills chat pane;    │                   │  chat pane + side panel   │
 │   side panel = idle)  │                   │  (6 tabs)                 │
 └───────────────────────┘                   └─────────────┬─────────────┘
                                                           │ overlays (modal, on top)
                                       ┌───────────────────┼──────────────────┐
                                       ▼                   ▼                  ▼
                             ┌──────────────────┐ ┌────────────────┐ ┌───────────────┐
                             │ S3 GM SCREEN     │ │ S4 EVENT MODAL │ │ S5 ERROR      │
                             │ (isGmScreen-     │ │ (activeEvent   │ │ BOUNDARY      │
                             │  Visible flag)   │ │  != null)      │ │ (render crash)│
                             └──────────────────┘ └────────────────┘ └───────────────┘
```

Input-enablement per state: `AWAITING_PLAYER_INPUT` (input live; pills/retry may show),
`PROCESSING` (input locked, typing indicator visible), `AWAITING_EVENT_CHOICE` (S4 blocks the
screen until a choice is made).

---

## S0. App Shell (persistent chrome)

Files: `App.tsx:487-572`, `components/Header.tsx`, `components/CrisisBanner.tsx`

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              [eagle icon]                                  │
│                       ROMAN CRISIS SIMULATION                 [Mock ☑]*    │  ← Header
│      Year: 235 CE │ Week: 14 │ Econ: Strained │ Politics: Volatile         │  ← world meter strip
├────────────────────────────────────────────────────────────────────────────┤
│ ⚠  ONGOING CRISIS   Succession dispute grips the capital                ⚠ │  ← CrisisBanner (conditional)
├──────────────────────────────────────────────┬─────────────────────────────┤
│                                              │                             │
│              CHAT PANE (2/3)                 │      SIDE PANEL (1/3)       │
│              [see S2a]                       │      [see S2b]              │
│                                              │                             │
└──────────────────────────────────────────────┴─────────────────────────────┘
* dev builds only
```

**Element inventory**
| Element | Data | Behavior |
|---|---|---|
| Game title + large eagle icon | static | none |
| Year / Week | `worldState.year`, `.week` | advances each turn; week rolls over to a new year at 52 |
| Economic Stability / Political Climate | `worldState.economic_stability`, `.political_climate` | plain text; currently never changes (no game system writes these fields) |
| Mock Mode checkbox | dev-only (`import.meta.env.DEV`) | routes all AI calls to canned mocks |
| Crisis banner | `simulationState.major_ongoing_crisis` | renders only when non-null; full-width, `role="alert"`, warning glyphs both sides |

**States:** crisis banner present/absent; mock toggle present (dev) / absent (prod).

**Notes:** the header is tall (icon + display-size title) relative to the information it
carries; the page never scrolls at the top level — both panes scroll internally within a fixed
full-viewport layout. There is no responsive/mobile layout; the 2/3–1/3 split is fixed.

---

## S1. Character Selection

File: `components/CharacterSelection.tsx`. Fills the chat pane during `SETUP`. During this
state the side panel shows only a centered line: *"Awaiting Character Selection…"*.

### S1a — Default (shown with an existing save)

```
┌──────────────────────────────────────────────────────────────┐
│                     CHOOSE YOUR DESTINY                      │  ← page title
│    The year is 235 CE. The Empire teeters… Who will you be?  │  ← subtitle
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  CONTINUE YOUR REIGN                    ┌──────────────┐ │ │  ← save card (only if
│ │  Playing as Maximinus Thrax — Turn 12   │ [Continue]   │ │ │    autosave exists);
│ │  Saved 7/18/2026, 3:41 PM               │  Start anew  │ │ │    amber-highlighted
│ │                                         └──────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌───────────────────────────┐  ┌───────────────────────────┐ │
│ │ THE YOUNG EMPEROR         │  │ THE AMBITIOUS GENERAL     │ │  ← 2-column grid of
│ │ Difficulty: Hard          │  │ Difficulty: Medium        │ │    preset character
│ │ Rule as the idealistic…   │  │ Lead the frontier…        │ │    cards (text only,
│ │ [        Select         ] │  │ [        Select         ] │ │    no portraits)
│ └───────────────────────────┘  └───────────────────────────┘ │
│ ┌───────────────────────────┐  ┌───────────────────────────┐ │
│ │ THE WEALTHY SENATOR       │  │ THE CUNNING SPYMASTER     │ │
│ │ …                         │  │ …                         │ │
│ └───────────────────────────┘  └───────────────────────────┘ │
│ ┌───────────────────────────┐                                │
│ │ CREATE YOUR OWN           │   ← 5th card, opens S1b        │
│ │ [    Self-Describe      ] │                                │
│ └───────────────────────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

### S1b — Custom creation form (replaces the grid)

```
┌──────────────────────────────────────────────────────────────┐
│                    FORGE A NEW DESTINY                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Use default 235 CE scenario [checkbox] Custom gamestate  │ │  ← world-mode switch: one
│ └──────────────────────────────────────────────────────────┘ │    checkbox between two labels
│  META-NARRATIVE                    (only when custom = on)   │
│  helper copy: "Describe the core theme of your story…"       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [textarea, ~3 rows, placeholder example]               │  │
│  └────────────────────────────────────────────────────────┘  │
│  YOUR PERSONA                                                │
│  helper copy: name, position, core motivations…              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [textarea, ~6 rows, placeholder example]               │  │
│  └────────────────────────────────────────────────────────┘  │
│  (inline error text, red, on validation failure)             │
│  ← Back to suggestions            [Create Character]         │  ← button label becomes
└──────────────────────────────────────────────────────────────┘    "Generate World" if custom
```

### S1c — Loading

Full-pane centered text: **"Consulting the Fates…"** / "Your destiny is being written."
No progress bar or stage indication, though world generation takes many seconds and can fail
(failure returns to S1b with an inline error line).

**Element inventory & behavior**
| Element | Behavior |
|---|---|
| Save card | Continue → restores the full autosave and enters the game; "Start anew" link → native `window.confirm()` dialog, then deletes the save |
| Preset card ×4 | name, difficulty label (Hard/Medium), one-line pitch, Select button → starts the game immediately with that character |
| Create-your-own card | switches the pane to S1b |
| Scenario toggle | checkbox choosing between default 235 CE scenario and AI-generated custom world; toggling reveals/hides the meta-narrative field |
| Textareas | required-field validation with inline error string; entered text survives Back |
| Back link | returns to S1a |

---

## S2. Main Game View

### S2a — Chat pane (left 2/3)

Files: `App.tsx:501-546`, `components/Chat.tsx`

```
┌──────────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────┐              │
│  │ GM narration bubble                        │              │  ← left-aligned; stone
│  │ multi-paragraph prose, **bold** supported  │              │    surface, red left
│  └────────────────────────────────────────────┘              │    edge; ~28rem max width
│                 ┌───────────────────────────────────────┐    │
│                 │ Player action bubble                  │    │  ← right-aligned; solid
│                 └───────────────────────────────────────┘    │    imperial red, light text
│              ────────  INNER THOUGHTS  ────────              │
│  ┊ centered card, dashed border, italic prose             ┊  │  ← third message voice
│              ──────────────────────────────────              │    (player monologue)
│  ┌──────────────────────────┐                                │
│  │ ● ● ●  Whispers cross    │   ← typing indicator bubble,   │
│  │        the Senate floor… │     only while PROCESSING;     │
│  └──────────────────────────┘     flavor text rotates ~3.2s  │
│ ─────────────────────────────────────────────────────────────│  ← input dock (bordered
│           [ ↻ Retry: "Bribe the Praetorian…" ]               │    bar at pane bottom)
│   ( Suggested action ) ( Suggested action ) ( Suggested )    │  ← action pills, ≤3,
│  ┌───────────────────────────────────────────┐ ┌──────────┐  │    staggered entrance
│  │ Enter your action… (Shift+Enter newline)  │ │  SEND    │  │  ← autosizing textarea
│  └───────────────────────────────────────────┘ └──────────┘  │
│                                               [ GM LOG ]     │  ← opens S3
└──────────────────────────────────────────────────────────────┘
```

**Message stream**
- Three visually distinct message voices: **GM narration** (left, stone panel, red edge),
  **player action** (right, solid red), **inner monologue** (centered, dashed border, italic,
  with an "Inner Thoughts" caption). System/error notices currently reuse the GM voice.
- Text formatting is bold-only: `**bold**` converted by regex and injected via
  `dangerouslySetInnerHTML` (unsanitized LLM output).
- Auto-scrolls to the newest message; `aria-live="polite"`; each message fades in.
- The full turn narration appears at once when the turn completes — there is no streaming and
  no per-stage progress during the multi-call pipeline (tens of seconds); the typing indicator
  and rotating placeholder copy are the only feedback.

**Input dock**
| Element | Behavior |
|---|---|
| Textarea | autosizes with content (max ~10rem); Enter sends, Shift+Enter inserts newline; disabled during PROCESSING; placeholder cycles the same themed status copy while processing |
| SEND button | disabled during PROCESSING |
| Action pills | up to ~3 AI-suggested actions per turn; clicking **fills** the input (does not send); hidden during processing |
| Retry button | appears only after a *transient* AI failure; single click re-runs the exact failed action (truncated to 60 chars in the label); the failed action text is also restored into the textarea |
| GM LOG button | opens S3; disabled until at least one turn has been played |

**Pane states:** awaiting-input (idle) · awaiting-input + pills · awaiting-input + retry
(+ pills) · processing (locked + indicator) · event-pending (S4 overlays everything).

### S2b — Side panel (right 1/3)

Files: `components/SidePanel.tsx`, `components/PlayerStatus.tsx`, `components/tabs/*`

```
┌───────────────────────────────────┐
│ MAXIMINUS THRAX                   │  ← PlayerStatus card
│ Commander of Legio XXII           │    (always visible above tabs;
│ ─────────────────────────────     │     subtle vertical gradient)
│ Current Goal (?)                  │
│   Secure the loyalty of the Rhine │  ← first short_term_goal
│ Current State (?)                 │
│   The legions grumble…            │  ← first 2 sentences of
├───────────────────────────────────┤     character narrative
│ EVENTS│REPORTS│CHRONICLE│DRAMATIS │  ← 6 equal-width uppercase
│ PERSONAE│EMPIRE│ASSETS            │    text tabs; wraps to 2 rows
├───────────────────────────────────┤    at this pane width; active
│                                   │    tab = red text + underline
│  [active tab content, scrolls]    │
│                                   │
└───────────────────────────────────┘
```

The "(?)" marks are `InfoTooltip` hover bubbles. Tabs have no icons, no change indicators, and
no ARIA tablist semantics. Tab content scrolls independently of the chat pane.

#### Tab 1 — EVENTS (`tabs/CurrentEventsTab.tsx`)
```
│ Recent Occurrences                │
│ ┌───────────────────────────────┐ │
│ │ Grain riots erupt in Ostia    │ │  ← headline row (whole row
│ │ ┌───────────────────────────┐ │ │    is a button)
│ │ │ Seeking clarification…    │ │ │  ← inline expansion: fires a
│ │ │ → analysis paragraph      │ │ │    live AI "clarify motives"
│ │ └───────────────────────────┘ │ │    call, shows loading text
│ └───────────────────────────────┘ │
│ ┌───────────────────────────────┐ │
│ │ The Senate delays the vote    │ │
│ └───────────────────────────────┘ │
│ (empty: "The city is quiet. No    │
│  new events to report.")          │
```
Click toggles expansion (re-click collapses). Only the current turn's headlines are listed —
the list is replaced wholesale each turn.

#### Tab 2 — REPORTS (`tabs/ReportsTab.tsx`)
```
│ Intelligence Reports              │
│ ┌───────────────────────────────┐ │
│ │ Turn 11: "Pontius is moving   │ │
│ │ money to Antioch"   (Dubious  │ │  ← credibility badge pill:
│ │ Source: paid informant   38%) │ │    Credible >70% (green) /
│ │ About: gaius pontius magnus   │ │    Uncertain (yellow) /
│ └───────────────────────────────┘ │    Dubious <40% (red)
│  … newest first, accumulates      │
│  across turns …                   │
```
Each report: turn number, quoted claim, source, subject, and a color-coded credibility badge
with percentage. Reports persist and accumulate across the campaign.

#### Tab 3 — CHRONICLE (`tabs/ChronicleTab.tsx`)
```
│ Chronicle of Events               │
│ ┌───────────────────────────────┐ │
│ │ Turn 9                        │ │
│ │ THE PRAETORIAN DEMAND         │ │  ← scripted-event title
│ │ Your Choice: "Pay the         │ │
│ │  donative"                    │ │
│ └───────────────────────────────┘ │
│ (empty: "No major events have     │
│  been recorded…")                 │
```
Logs **scripted-event choices only** (title + chosen option + turn), newest first. Turn-by-turn
narration history is *not* shown here — it exists only inside S3.

#### Tab 4 — DRAMATIS PERSONAE (`tabs/DramatisPersonaeTab.tsx`) — the deepest view in the game
```
│ Dramatis Personae                 │
│ ┌───────────────────────────────┐ │
│ │ ▌PRAETORIAN GUARD             │ │  ← faction header band (red);
│ │ ▌"Restless and unpaid…"       │ │    name may carry a glossary
│ ├───────────────────────────────┤ │    tooltip with Wikipedia link
│ │ Marcus Aedinius Julianus      │ │  ← member card (collapsed):
│ │ Praetorian Prefect    [Intel] │ │    name, position, expand btn
│ │ ▓▓▓▓▓▓▓░░░░░░░                │ │  ← trust bar: −10…+10 mapped
│ │ Trust: 3   Respect: 5         │ │    to green/grey/red fill
│ │ Threat: 6  Align: 2  Dep: 1   │ │  ← 5 numeric relationship axes
│ ├───────────────────────────────┤ │
│ │ ── expanded (Intel open) ──   │ │
│ │ "current state narrative…"    │ │
│ │ Goals: secure pay, curb…      │ │
│ │ ┌───────────────────────────┐ │ │
│ │ │ RAW THOUGHTS (Free)       │ │ │  ← free AI probe: player's
│ │ │ "Click to gauge your…"    │ │ │    gut read on this person
│ │ └───────────────────────────┘ │ │
│ │ Intelligence Briefing         │ │
│ │  Beliefs (?)      [Unknown]   │ │  ← three paywalled categories;
│ │            [Reveal (1 Inv.)]  │ │    each Reveal costs 1
│ │  Active Scheme (?) [Unknown]  │ │    "investigations" resource;
│ │            [Reveal (1 Inv.)]  │ │    button disabled when the
│ │  Secrets (?)       [Unknown]  │ │    player can't afford it;
│ │            [Reveal (1 Inv.)]  │ │    revealed content renders in
│ └───────────────────────────────┘ │    place (list, or scheme
│  UNALIGNED                        │    goal+steps block)
│  (same cards, no faction band)    │
```
Behaviors: NPCs grouped by faction, then an "Unaligned" section; dead characters are hidden;
revealing Secrets also converts them into `blackmail_on_<target>` entries visible in the ASSETS
tab and generates an intelligence report. Revealed intel is held in component-local state — it
disappears when the tab unmounts (there is no persistent dossier).

#### Tab 5 — EMPIRE (`tabs/EmpireTab.tsx`)
```
│ Locations in Rome                 │
│ ┌───────────────────────────────┐ │
│ │ Palatine Hill (glossary link) │ │
│ │ Status: Stable                │ │  ← keyword-matched color:
│ │ Control: Imperial Court       │ │    stable=green, unrest=yellow,
│ │ Local Events:                 │ │    rebellion/revolt=red
│ │  • …                          │ │
│ │ Characters Present:           │ │  ← living individuals whose
│ │  • …                          │ │    location matches the region
│ └───────────────────────────────┘ │
│  (one card per region; no map)    │
```

#### Tab 6 — ASSETS (`tabs/ResourcesTab.tsx`)
```
│ Direct Assets (?)                 │
│   Denarii (?)          120,000    │  ← label + tooltip … value
│   Investigations (?)         3    │    (right-aligned, bold)
│   Blackmail on Pontius (?)        │
│      "skimmed the grain fund"     │  ← array-valued resources
│                                   │    render as quoted,
│ Influence & Support (?)           │    truncated lines
│   Legion Support (?)      High    │
│   Senatorial Support (?)   Low    │
│   Legitimacy (?)            42    │
│ (either group can be empty, with  │
│  themed empty copy)               │
```
Resources are split by key into two curated groups: **Direct Assets** (denarii, fortune,
investigations, deep analyses, blackmail material) and **Influence & Support** (everything
else). Every row carries an explanation tooltip; `blackmail_on_*` rows get dynamically
generated tooltip text. Values are raw numbers/strings with no scale, cap, or change indicator.

---

## S3. Game Master Screen (overlay)

File: `components/GameMasterScreen.tsx`. Full-screen dimmed backdrop; centered 80%×80% panel
on a dark noise-textured surface; monospace type — visually a "dev console" register, distinct
from the rest of the game. Serves two roles at once: a player-facing director tool (the
intervention box) and a developer inspection surface (raw pipeline data).

```
┌────────────────────────────────────────────────────────────────┐
│ GAME MASTER TOOLS                                          ✕   │  ← close (no Escape key,
│ ┌────────────────────────────────────────────────────────────┐ │     no focus trap)
│ │ GM INTERVENTION                                            │ │
│ │ "Add a directive for the AI to consider in the next        │ │
│ │  turn's adjudication…"                                     │ │
│ │ ┌────────────────────────────────────────────────────────┐ │ │
│ │ │ [textarea] e.g. "A plague breaks out in the Suburra."  │ │ │
│ │ └────────────────────────────────────────────────────────┘ │ │
│ │ [Set Directive for Next Turn]   ✓ Directive Saved!         │ │  ← confirmation text
│ └────────────────────────────────────────────────────────────┘ │     flashes for 3s
│ SUMMARY│ENTITY STATES│ACTIONS│DELTAS│PRIVATE│RAW JSON          │  ← 6 tabs (own style,
│ ┌────────────────────────────────────────────────────────────┐ │     different from S2b's)
│ │ TURN 12                                (newest first)      │ │
│ │  [active tab's content for this turn]                      │ │
│ │ ────────────────────────────────────────────────────────── │ │
│ │ TURN 11 …                                                  │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Tab contents (each renders per-turn sections, newest first):
| Tab | Content |
|---|---|
| SUMMARY | player intent (quoted) + generated narration |
| ENTITY STATES | full post-turn dump per entity: status, location, resources, personality, skills, beliefs, secrets, active scheme (name/goal/steps), last 3 memories, relationship axes vs. every other entity |
| ACTIONS | each NPC's adjudicated action this turn (id, intent, target, notes) |
| DELTAS | structured state changes (type, key, delta value, reason) |
| PRIVATE | GM-private notes from adjudication |
| RAW JSON | collapsible per-call records of every AI call (call name, model, latency, attempt count, validated flag, prompt size, full raw response) + pretty-printed adjudication JSON |

The intervention directive is consumed by the next turn's adjudication and then cleared.

---

## S4. Event Modal (overlay)

File: `components/EventModal.tsx`. Dimmed backdrop; centered card (~max-w-2xl); decorative
double red border. **Mandatory choice** — there is no close, Escape, or click-outside; the game
stays in `AWAITING_EVENT_CHOICE` until an option is picked.

```
┌──────────────────────────────────────────────┐
│            THE PRAETORIAN DEMAND             │  ← event title (display type)
│ ──────────────────────────────────────────── │
│   The Guard assembles before the palace…     │  ← description (centered prose)
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Pay the donative                         │ │  ← choice card: bold title +
│ │ Empty the treasury to buy their loyalty. │ │    one-line consequence hint;
│ └──────────────────────────────────────────┘ │    whole card is the button;
│ ┌──────────────────────────────────────────┐ │    border highlights on hover
│ │ Refuse and address the men yourself      │ │
│ │ Trust your oratory. Risk everything.     │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Choosing applies the option's state deltas immediately, posts a GM chat message recording the
choice, logs it to the Chronicle tab, and returns to `AWAITING_PLAYER_INPUT`. No probability,
cost, or stakes metadata is displayed — only title + hint text. Entrance is the standard 0.5s
fade (no special staging).

---

## S5. Error Boundary (full-screen)

File: `components/ErrorBoundary.tsx`. Replaces the entire app on a render crash.

```
┌──────────────────────────────────────────────┐
│            THE REPUBLIC ENDURES              │
│  A fracture appeared in the chronicle and    │
│  the scene could not be rendered. Your       │
│  progress is not lost…                       │
│ ┌──────────────────────────────────────────┐ │
│ │ <error.message, monospace, small>        │ │
│ └──────────────────────────────────────────┘ │
│         [ Restore Last Save ]                │  ← label falls back to
└──────────────────────────────────────────────┘     "Reload" when no save exists
```

The button reloads the page; with an autosave present, the player lands on S1a's
"Continue Your Reign" card.

**Related in-chat error surfaces** (not separate screens): transient AI failure → GM-voice
bubble ("The courier was waylaid — the Fates offer another chance.") plus the Retry button and
restored input; fatal AI failure → GM-voice bubble containing the real error detail, with the
action restored to the input. In both cases game state is rolled back to the pre-turn snapshot.

---

## 6. Primitive Inventory

Every reusable widget pattern the current UI contains — the vocabulary a holistic redesign
needs to cover. Near-duplicates are noted (today several of these exist as multiple hand-rolled
variants rather than shared components).

| Primitive | Where it appears today | Current behavior/notes |
|---|---|---|
| Panel / card surface | every tab card, chat bubbles, modals (`.roman-stone-panel`) | translucent stone texture, inset shadow, slight blur |
| Buttons | Send, Select, Reveal, Continue, Retry, GM Log, links | several ad-hoc red/stone/dark variants; shared hover-lift animation; disabled = grey |
| Pill button | ActionPills | staggered slide-up entrance; hover swaps to red |
| Tab bar | side panel (6 tabs) and GM screen (6 tabs) | two different hand-rolled styles; text-only labels; no ARIA tablist roles; no change indicators |
| Modal / dialog | GM screen, EventModal | hand-rolled fixed overlays; no focus trap, no Escape; EventModal is intentionally unskippable |
| Meter / bar | TrustBar | −10…+10 mapped to fill % with green/grey/red thresholds; value in a `title` attribute |
| Badge | CredibilityBadge | 3 severity levels + percentage, color-coded pill; region stability uses colored text instead |
| Stat row | ResourcesTab | label + tooltip left, bold value right; array values as quoted truncated lines; no units/caps/deltas |
| Info tooltip | InfoTooltip "?" icons | hover-only CSS bubble; no touch or keyboard support |
| Glossary term | GlossaryTooltip | dotted underline, hover bubble with description + external Wikipedia link |
| Typing / progress indicator | TypingIndicator | 3 bouncing dots + rotating themed copy; single generic stage |
| Expandable list item | Events headlines, EntityDetails, RAW JSON `<details>` | three different disclosure implementations |
| Empty state | every tab | themed copy, text only |
| Inline error text | forms, chat error bubbles | red text (forms); GM-voice bubble (chat) |
| Destructive confirm | "Start anew" | native `window.confirm()` |
| Transient confirmation | "Directive Saved!" | text appears for 3 s |

**Motion vocabulary:** fade-in entrances (0.5 s), button hover-lift + active press, staggered
pill slide-up (50 ms increments), tooltip fade+rise, bouncing dots. No
`prefers-reduced-motion` handling.

## 7. Structural Facts a Redesign Inherits

Neutral constraints and characteristics of the current system, listed so a holistic redesign
starts from ground truth:

1. **The chat stream is the core surface.** The game is a conversational loop with 30–60 s
   AI-processed turns; every other surface is instrumentation around it.
2. **Four message roles exist in the data** (GM, player, monologue, system/error) but only
   three visual voices — system messages borrow the GM style.
3. **Uncertain and hidden information are gameplay primitives**: credibility-scored reports,
   trust meters, and "[Unknown] → Reveal (cost)" paywalled intel appear throughout.
4. **Resource-gated actions** are a recurring pattern: the cost is printed on the button and
   the button disables when unaffordable.
5. **Fixed-viewport desktop layout**: the page never scrolls; panes scroll internally;
   there is no responsive breakpoint, and modals are sized in viewport percentages.
6. **Overlays layer over a live session** — no navigation ever unmounts the game.
7. **Accessibility present today**: `aria-live` message stream, `aria-label`s on inputs,
   `role="alert"` banner. Absent today: dialog semantics/focus traps, tablist roles,
   keyboard tooltip access, non-color severity redundancy, reduced-motion support.
8. **Planned-but-unbuilt surfaces** (empty files or roadmap items that a new design system
   will be asked to cover next): a world-state/"drama meter" tab, a relationship map tab, a
   game-over/epilogue screen, persistent NPC dossiers, a rumor feed, and a settings surface —
   see `UI_SYSTEMS_CURRENT_AND_FUTURE.md` Part II.
