# Glory of Rome — UI Systems: Current State & Future Design

> **Status (July 2026):** written before the Phase 2-3 engine work and the PR #4 design-system
> re-skin; annotations below mark what has since shipped.

This document is the comprehensive reference for the user interface of the Roman Crisis Simulation.
It has two parts:

- **Part I — Current UI Systems**: an exhaustive inventory of every screen, component, and
  cross-cutting UI system required to run the game today, with file references.
- **Part II — Future UI Design**: a catalog of design ideas to modernize the interface and
  enhance the game's capabilities, organized by theme with priority/effort guidance and
  cross-references to the existing domain roadmaps in `roadmaps/`.

All paths below are relative to `roman_crisis_simulation/src/` unless noted otherwise.

> **Companion document:** `UI_SCREEN_WIREFRAMES.md` describes each of these screens *visually* —
> structural wireframes, element inventories, and states — intended as the ground-truth input
> for a holistic visual redesign.

---

# Part I — Current UI Systems

## 1. Architecture Overview

The UI is a **single-page React 19 application** with no router and no external UI framework.
One top-level component owns essentially all game state.

| Concern | Implementation |
|---|---|
| Framework | React 19 (`react`, `react-dom`) loaded via CDN import map in `index.html` |
| Build tool | Vite 6 (`vite.config.ts`), TypeScript ~5.8, Vitest for tests |
| Styling | Tailwind CSS via **CDN script** (`index.html:8`) + ~140 lines of hand-written CSS in `index.html` *(STALE — Tailwind removed entirely; styling is now the `gor-*` design system in `design/` — tokens, `components.css`, plus a `nocturne.css` night skin, see 5.1-5.3)* |
| Fonts | Google Fonts: *Cinzel* (body) and *Cinzel Decorative* (headings) |
| State management | ~20 `useState` hooks in `App.tsx` — no Redux/Zustand/Context; props drilled into children |
| Routing | None — screens are switched by the `GameState` enum |
| AI client | `GoogleGenAI` instance created in `App.tsx:56` and passed down as a prop to tabs that make on-demand AI calls |
| Persistence | `localStorage` autosave via `persistence/saveGame.ts`, versioned blob |

### 1.1 The UI State Machine

`GameState` (`types.ts:3-8`) is the master switch that determines what the player sees and
what input is allowed:

```
SETUP ──(character chosen)──► AWAITING_PLAYER_INPUT ──(send action)──► PROCESSING
   ▲                                   ▲                                    │
   │                                   │◄──(turn commit + no event)─────────┤
   └── (fresh load, no continue)       │                                    │
                                       └◄─(choice made)── AWAITING_EVENT_CHOICE ◄─(event triggered)
```

- `SETUP` — character selection screen occupies the chat pane; side panel shows a placeholder.
- `AWAITING_PLAYER_INPUT` — chat input enabled; action pills and retry button may render.
- `PROCESSING` — input disabled, `TypingIndicator` bubble animates, placeholder cycles themed copy,
  `beforeunload` guard is armed (`App.tsx:134-144`).
- `AWAITING_EVENT_CHOICE` — `EventModal` blocks the screen until a choice is made.

Notably absent: a `GAME_OVER` state (flagged in `ROADMAP_4_FUNNESS.md` P0.1 — a dead player can
keep taking turns). *(SHIPPED — `GameState.GAME_OVER` now exists in `types.ts`; a dead player's
turn routes there and renders `EpilogueScreen`, see 7.2)*

### 1.2 Layout

`App.tsx:487-572` renders a fixed full-viewport, desktop-only layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Header (title, aquila icon, year/week, world meters)         │
├──────────────────────────────────────────────────────────────┤
│ CrisisBanner (only when a major crisis is active)            │
├─────────────────────────────────────┬────────────────────────┤
│ Chat pane (w-2/3)                   │ SidePanel (w-1/3)      │
│  • CharacterSelection (SETUP), or   │  • PlayerStatus card   │
│  • Message stream (scrolling)       │  • 6-tab intelligence  │  *(STALE — now 7 tabs, see 3.5)*
│  • Retry button / ActionPills       │    dashboard           │
│  • ChatInput + GM LOG button        │                        │
└─────────────────────────────────────┴────────────────────────┘
      Overlays: GameMasterScreen (modal) · EventModal (modal)
```

There is **no responsive/mobile layout** — the `w-2/3`/`w-1/3` split is hard-coded.

---

## 2. Visual Design System

Defined entirely in `index.html` inline CSS plus Tailwind utility classes.
*(STALE — the whole section below describes the pre-PR #4 look. The app has been re-skinned onto
the `gor-*` design system (`design/tokens/*.css`, `design/components.css`, `design/styles.css`);
`index.html` no longer carries any inline CSS or Tailwind. A second theme, Nox Romae
(`design/nocturne.css`), ships alongside the day theme via an LVX/NOX switch — see 5.2/5.3. The
token names, palette, and some component names below (`.roman-stone-panel`, etc.) no longer match
the code; treat this section as historical intent, not current implementation.)*

**Theme: "aged parchment & carved stone" Roman aesthetic.**

| Token / class | Purpose |
|---|---|
| Body background | Layered parchment: linear gradient + inline-SVG fractal-noise texture + radial vignette; fixed inset box-shadow (`body::before`) for an aged-paper frame |
| Palette | Sepia text `#3a2e2c`; stone greys (`#e8e6e1`, `#c9c5b8`, `#d8d5ce`); imperial red (`red-800/900`) for primary actions and GM accents; amber for crisis/save highlights; dark stone (`stone-800/900`) for the GM debug surface |
| `.font-decorative` | Cinzel Decorative for titles ("Choose Your Destiny", event titles) |
| `.roman-stone-panel` | The core card surface: translucent stone color, inset shadow, subtle `backdrop-filter: blur` glassmorphism |
| `.roman-inset-text` | White text-shadow to simulate carved lettering |
| `.gm-panel-bg` | Dark, noise-textured surface for the Game Master modal |
| Custom scrollbar | Parchment track, aged-wood thumb |
| `.animate-fade-in` | 0.5s fade for messages, modals, revealed sections |
| `.btn-animate` | Hover lift (translateY + shadow) on all buttons |
| `.pill-animate` | Staggered slide-up entrance for action pills (per-pill `animationDelay`) |
| `.tooltip-bubble` | Shared hover-tooltip style used by `InfoTooltip` and `GlossaryTooltip` |

Border language: `border-double` 4px borders separate the major layout regions, echoing engraved
plaques.

---

## 3. Screen & Component Inventory

### 3.1 Header — `components/Header.tsx`
- Inline-SVG **Aquila (eagle) icon**, game title in decorative type.
- World-state strip: **Year / Week / Economic Stability / Political Climate** (from `WorldState`).
  Note: the two meters currently never change — no delta type writes top-level `WorldState`
  (see `ROADMAP_4_FUNNESS.md` §2). *(STALE — a `'world'` delta type now writes
  `economic_stability`/`political_climate` (`ai/core/engine.ts`'s `'world'` case, driven by the
  adjudication prompt); the meters are live. They still render as plain text, not the trend
  meters 6.5 proposes.)*
- **Mock Mode** checkbox — dev-only (`import.meta.env.DEV` gated), routes all AI calls to mocks.

### 3.2 CrisisBanner — `components/CrisisBanner.tsx`
- Full-width alert (`role="alert"`) rendered between Header and panes when
  `simulationState.major_ongoing_crisis` is non-null.
- Red gradient, amber warning glyphs, "ONGOING CRISIS" label — the first surfaced piece of the
  otherwise-hidden `SimulationState`.

### 3.3 CharacterSelection — `components/CharacterSelection.tsx`
The entire pre-game flow, rendered in the chat pane during `SETUP`:
- **"Continue Your Reign" card** (when an autosave exists): character name, turn number, saved-at
  timestamp; Continue button + "Start anew" (with `window.confirm` guard) — wired to
  `persistence/saveGame.ts` via `App.tsx`.
- **Four preset character cards** (Emperor / General / Senator / Spymaster) with difficulty labels
  and hover border highlight.
- **"Create Your Own" flow**: free-text persona textarea; optional **custom world generation**
  toggle with a *meta-narrative* textarea that drives full AI world-gen (`initiateWorld`).
- Loading state ("Consulting the Fates…") and inline error copy.

### 3.4 Chat System — `components/Chat.tsx` + `App.tsx`
The primary game surface — the turn loop is conversational.

- **`ChatMessage`** — three visually distinct sender styles:
  - `gm`: stone panel, red left border (the Game Master's narration).
  - `player`: right-aligned imperial-red bubble.
  - `player_monologue`: centered, dashed-border, italic "Inner Thoughts" card.
  - Renders `**bold**` via regex → `dangerouslySetInnerHTML` (unsanitized LLM text — known risk,
    `ROADMAP_3` P2.2).
- **`ChatInput`** — auto-resizing textarea (max-height clamp), Enter-to-send /
  Shift+Enter newline, disabled during `PROCESSING`, placeholder cycles themed status copy while
  processing.
- **`ActionPills`** — up to ~3 AI-suggested actions rendered as staggered-entrance pill buttons;
  clicking fills the input (doesn't auto-send).
- **`TypingIndicator`** — animated three-dot bubble with rotating flavor text
  ("Whispers cross the Senate floor…", 3.2s cycle via `useRotatingMessage`) shown in-stream during
  the 30–60s multi-call turn pipeline.
- **Retry affordance** (`App.tsx:509-519`) — after a *transient* AI failure (`AiServiceError`),
  a one-click "↻ Retry" button re-runs the exact failed action; the input is also re-filled so the
  player never retypes.
- **Auto-scroll** to newest message (`messagesEndRef.scrollIntoView`), `aria-live="polite"` on the
  message list.
- **GM LOG button** — opens the Game Master screen; disabled until at least one turn exists.

### 3.5 SidePanel — `components/SidePanel.tsx`
The right-hand **intelligence dashboard** (1/3 width): a `PlayerStatus` card above a 6-tab
switcher. Tab state is local; content scrolls independently.
*(STALE — now a 7-tab switcher: World, Events, Reports, Chronicle, Personae, Empire, Assets
(`SidePanel.tsx:21-29`), World State being the new, first/default tab. The tab bar also now has
`role="tablist"`/`role="tab"` semantics and a per-tab "new intelligence" pulse indicator driven by
`perception/visibility.ts` — see 10.1.)*

#### PlayerStatus — `components/PlayerStatus.tsx`
Name, position, **Current Goal** (first `short_term_goals` entry) and **Current State**
(first two sentences of the character narrative), each with an `InfoTooltip`.

*(SHIPPED — a new first tab, World State (`components/tabs/WorldStateTab.tsx`), is not listed
here; it fills exactly the role 7.1's "Drama Meter" proposed — see 3.10 and 7.1.)*

#### Tab: Events — `components/tabs/CurrentEventsTab.tsx`
- Lists this turn's AI-generated headlines.
- Clicking a headline makes a **live AI call** (`getClarificationOnEvent`) and expands an inline
  "clarification" panel — free-form intelligence drill-down.

#### Tab: Reports — `components/tabs/ReportsTab.tsx`
- Reverse-chronological intelligence reports with claim, source, subject.
- **`CredibilityBadge`** — Credible / Uncertain / Dubious pill, color-coded by numeric credibility.

#### Tab: Chronicle — `components/tabs/ChronicleTab.tsx`
- Reverse-chronological log of **scripted-event choices** (`eventHistory`): turn number, event
  title, chosen option. (Does not yet include turn narration — see `ROADMAP_3` P1.2.)

#### Tab: Dramatis Personae — `components/tabs/DramatisPersonaeTab.tsx`
The deepest UI in the game — the espionage loop:
- NPCs grouped into **faction sections** (red faction header with narrative blurb, optional
  `GlossaryTooltip` with Wikipedia link) plus an "Unaligned" group; dead entities filtered out.
- Per-NPC **`EntityDetails`** card:
  - **`TrustBar`** — colored meter mapping trust (−10…+10) to red/grey/green.
  - Five relationship axes displayed numerically: Trust, Respect, Threat, Alignment, Dependency.
  - Expandable **Intel** section: character narrative, goals, and a free **"Raw Thoughts"**
    AI call (player's gut read on the target).
  - **Intelligence Briefing** — three paywalled `IntelSection`s (*Beliefs*, *Active Scheme*,
    *Secrets*), each costing 1 `investigations` resource; buttons disable when the player can't
    afford the cost; results render as lists or a structured `SchemeIntelDisplay` (goal + steps).
  - Uncovered secrets are converted into `blackmail_on_<target>` resources (visible in Assets).
  - Caveat: uncovered intel is **component-local state** — it resets when the tab unmounts
    (persistent dossiers are a roadmap item, `ROADMAP_3` P1.3c).

#### Tab: Empire — `components/tabs/EmpireTab.tsx`
- Card per region of `worldState.regions`: **stability** (keyword-based color coding:
  stable=green, unrest=yellow, rebellion/revolt=red), **controlling faction**, local events, and
  characters currently present.
- `GlossaryTooltip` entries for historical locations (Palatine Hill, the Curia, etc.).

#### Tab: Assets — `components/tabs/ResourcesTab.tsx`
- Splits `playerEntity.resources` into **Direct Assets** (denarii, fortune, investigations,
  deep analyses, blackmail material) and **Influence & Support** (legion/senatorial support,
  legitimacy, …).
- Every row has a curated `InfoTooltip` explanation; dynamic tooltips for `blackmail_on_*` keys;
  array resources (blackmail secrets) render as truncated quoted lists.

### 3.6 GameMasterScreen — `components/GameMasterScreen.tsx`
Full-screen dark modal (`gm-panel-bg`, monospace) — part debug console, part director's booth:
- **GM Intervention** — free-text directive injected into the next turn's adjudication prompt
  ("A plague breaks out in the Suburra."), with saved confirmation flash.
- Six tabs over per-turn history (newest first): *(STALE — now seven; a *Ground Truth* tab was
  added between Private and Raw JSON, see below)*
  - *Summary* — player intent + generated narration.
  - *Entity States* — full post-turn dump per entity: status, location, resources, personality,
    skills, beliefs, secrets, active schemes (`SchemeDisplay`), last-3 memories, relationship axes.
  - *Actions* — NPC actions adjudicated this turn (intent/target/notes).
  - *Deltas* — structured state changes with reasons.
  - *Private* — GM-private notes.
  - *Ground Truth* *(SHIPPED, new)* — side-by-side of raw ground truth vs. what
    `perception/visibility.ts` would let the player perceive, for auditing the perception filter.
  - *Raw JSON* — captured raw AI calls (`RawCallRecord`: model, latency, attempts, validation
    status, full prompt/response) + parsed adjudication. This is the observability surface for the
    AI pipeline.

### 3.7 EventModal — `components/EventModal.tsx`
- Blocking modal for scripted events (from `events/engine.ts` trigger checks after each turn).
- Decorative double red border, event title/description, and full-width **choice cards**
  (title + consequence description). No Escape/close — a choice is mandatory.

### 3.8 ErrorBoundary — `components/ErrorBoundary.tsx`
- Last-resort render-crash catcher styled in-theme ("The Republic Endures").
- Shows the error message and a **Restore Last Save** / Reload button (aware of `hasSave()`).

### 3.9 Shared Primitives
- **`InfoTooltip`** (`components/InfoTooltip.tsx`) — hover "?" icon with explanation bubble; used
  across PlayerStatus, Resources, and intel sections.
- **`GlossaryTooltip`** (`components/GlossaryTooltip.tsx`) — dotted-underline term with historical
  description + external Wikipedia link; used in Dramatis Personae and Empire tabs.

### 3.10 Dead / Placeholder Files
- `components/tabs/WorldStateTab.tsx` — **0 bytes**, unimported (intended home of the
  SimulationState "drama meter", `ROADMAP_4` P0.2). *(SHIPPED — see
  components/tabs/WorldStateTab.tsx; now 148 lines, wired into SidePanel as the World tab, see 3.5
  and 7.1)*
- `components/tabs/RelationshipsTab.tsx` — **0 bytes**, unimported (intended home of the
  relationship map, `ROADMAP_3` P1.3a). *(Still true — still a 0-byte, unimported file as of July
  2026; see 8.1. A relationship map is now committed for Phase 4B as a view over the
  player-knowledge store — interpretation and hearsay only, never ground truth — per
  `roadmaps/DESIGN_DECISIONS.md` D13 and `roadmaps/ROADMAP_PHASE_4.md`.)*

---

## 4. Cross-Cutting UI Systems

### 4.1 Turn-Processing Feedback
The turn pipeline (`ai/core/turn.ts`) makes ~7 sequential Gemini calls (tens of seconds). Current
feedback: `TypingIndicator` bubble + rotating placeholder copy + disabled input. There is **no
per-stage progress and no streaming** — the full narration appears at once (staged progress and
streaming are `ROADMAP_3` P0.1 / master-plan Phase 3).

### 4.2 Persistence & Session Continuity
- **Autosave on every commit point**: campaign start, each successful turn, event choices,
  resource spends (`saveGame(buildSaveState(...))` calls throughout `App.tsx`).
- Versioned save blob (`{version, savedAt, state}`) in `localStorage`.
- **Continue Your Reign** card on the character screen; **Start anew** clears the save.
- `beforeunload` warning only while a turn is in flight (the one window with unsaved outcome).
- Pre-turn snapshot (`preTurnSnapshotRef`) enables explicit rollback on turn failure.

### 4.3 Error UX
Three tiers, all in-fiction:
1. **Transient AI failure** → "The courier was waylaid — the Fates offer another chance." + Retry
   button + restored input.
2. **Fatal AI failure** → real error detail in a GM bubble, input restored, state rolled back.
3. **Render crash** → `ErrorBoundary` full-screen recovery with restore-from-save.

### 4.4 Dev/Player Separation
Dev affordances (Mock Mode toggle, startup smoke test with `alert()`) are gated behind
`import.meta.env.DEV`. The GM screen remains player-visible (deliberately, as an intervention
tool) but reads as a debugger — rebranding is a roadmap item (`ROADMAP_3` P0.4 residue).
*(STALE — the GM console is now hidden by default in every build; `Ctrl+Shift+G` toggles it
(works in prod, not just DEV, "since the console itself is meant to stay reachable for tuning,
just hidden by default" per `App.tsx`), with a dev-only checkbox in the Header as a discoverable
backup. The "deliberately player-visible" framing is now "deliberately reachable, hidden by
default." Rebranding (12.4) still hasn't happened.)*

### 4.5 Accessibility (current state)
Present: `aria-live` on the message stream and typing indicator, `aria-label`s on inputs/buttons,
`role="alert"` on the crisis banner, semantic form elements.
Missing: dialog semantics (`role="dialog"`, `aria-modal`, focus trap, Escape) on both modals;
`role="tablist"` on tab bars; keyboard navigation; reduced-motion support; color-only meaning in
trust bars/stability colors; unsanitized `dangerouslySetInnerHTML` on LLM output.
*(PARTIALLY SHIPPED — see 10.1: `GameMasterScreen` and `EventModal` now render `role="dialog"`
`aria-modal="true"`, and both tab bars (`SidePanel`, `GameMasterScreen`) now have
`role="tablist"`/`role="tab"`/`aria-selected`. Still missing: focus trap and Escape-to-close on
both modals, and keyboard arrow-key navigation on the tab bars. `prefers-reduced-motion` is now
respected for the tab pulse animation specifically (`SidePanel.tsx`), not audited elsewhere.)*

### 4.6 Known Structural Debt (UI-relevant)
- Tailwind, React, and `@google/genai` load from **CDNs at runtime** (`index.html`) — no offline
  capability, styling depends on a third-party script tag, and the Vite bundle doesn't own deps.
  *(PARTIALLY STALE — Tailwind is gone; the app no longer depends on a third-party styling CDN at
  all (see 5.1, §2). React and `@google/genai` are still loaded via the `index.html` import map,
  so the "Vite bundle doesn't own deps" debt still applies to those two.)*
- The Gemini **API key is embedded client-side** (`vite.config.ts` define) — any public deploy
  leaks it; a backend proxy is the real fix (`ROADMAP_3` P2.3 / `ROADMAP_5`). *(Still true —
  unchanged.)*
- `App.tsx` is a ~575-line god component; every subsystem's state and handlers live there.
  *(STALE figure — `App.tsx` is now ~971 lines with ~30 `useState` hooks; still a single
  component with no `useReducer`/context, see 5.4.)*
- Props drilling of the `ai` client + mock flag into leaf tabs couples presentation to the AI
  layer. *(Still true — unchanged.)*

---

# Part II — Future UI Design

Ideas below are grouped by theme. Each is tagged **[Priority / Effort]** (P0 = do first;
S/M/L effort) and cross-referenced to existing roadmap items where they overlap. The sequencing
philosophy follows the master plan: *make the loop feel alive and legible first, then deepen the
intelligence surfaces, then broaden into new capabilities.*

## 5. Modernize the Foundation

**5.1 Own the toolchain [P0 / M]** — Move Tailwind, React, and `@google/genai` from CDN/import-map
into the Vite bundle with a proper `tailwind.config` (content scanning, purge). Extract the inline
CSS from `index.html` into a real stylesheet/`@layer` setup. This unblocks everything below
(plugins, tokens, tree-shaking, offline PWA) and removes a runtime dependency on third-party CDNs.
*(= ROADMAP_3 P2.3a)* *(PARTIALLY SHIPPED — Tailwind wasn't moved into the bundle, it was removed
outright and replaced by the `gor-*` design system in `design/`; the inline CSS is out of
`index.html`. React and `@google/genai` are still on the CDN import map, unmoved.)*

**5.2 Design tokens & theme layer [P1 / S]** — Codify the existing parchment/stone/imperial-red
language as CSS variables / Tailwind theme tokens (`--surface-stone`, `--accent-imperial`,
`--text-carved`, spacing, border styles). Enables consistent reskins and the night-mode below.
*(SHIPPED — see `design/tokens/{colors,typography,spacing,effects,fonts}.css`; token names differ
from the ones sketched here (`--gold-500`, `--crimson-500`, `--tyrian-400`, etc.) but the layer
exists and both themes below are built on it.)*

**5.3 "Candlelit" dark mode [P2 / M]** — A second theme: dark marble, torchlight ambers, ivory
text. Long narrative reading sessions benefit; the GM screen already proves the dark aesthetic
works. Driven entirely by the token layer (5.2). *(SHIPPED — as "Nox Romae" (`design/nocturne.css`),
toggled against the day theme via an LVX/NOX switch; lazy-loaded per `index.html`'s comment.)*

**5.4 Component library & state refactor [P1 / M]** — Extract shared primitives (Panel, Button,
Tab bar, Meter, Badge, Modal) into a `components/ui/` kit; migrate `App.tsx` state into a
`useReducer` store or Zustand slice (game state, chat, intel, settings) so new screens (Epilogue,
Map, Dossiers) don't each add another prop-drilling chain. Modals should share one accessible
`<Dialog>` primitive (focus trap, Escape, `aria-modal`). *(enables ROADMAP_3 P2.2)*
*(HALF SHIPPED — the component-library half is done: `components/ui/{Core,Brand,Feedback,Forms,
Game}.tsx` covers Button/Card/Badge/Meter/Switch/Radio/Textarea/ActionPill/TypingIndicator etc.
The state-refactor half did NOT ship: `App.tsx` is still ~30 `useState` hooks, no
`useReducer`/context (see 4.6). No shared `<Dialog>` primitive exists either — `GameMasterScreen`
and `EventModal` each roll their own `role="dialog"` markup, still without focus trap/Escape.)*

**5.5 Safe rich-text rendering [P0 / S]** — Replace the bold-regex + `dangerouslySetInnerHTML`
with a tiny markdown-subset renderer (escape HTML, then `**bold**`/`*italic*`/line breaks).
Prerequisite for richer narration formatting (headlines, quoted dialogue, letters).
*(= ROADMAP_3 P2.2b)*

## 6. Make the Turn Loop Feel Alive (highest player-felt impact)

**6.1 Staged "thinking" theater [P0 / M]** — Surface the ~7 pipeline stages as a live, themed
progress bubble ("The Senate reacts…", "Your rivals move in the dark…", "The chronicler sets down
the day…") driven by an `onStage` callback from `runNewTurn`, replacing the generic dot-loop.
Add a subtle stage checklist so long waits show *motion*, not just animation. *(= ROADMAP_3 P0.1a)*
*(SHIPPED — `ai/core/turn.ts` exports `TurnStage` and calls `options?.onStage?.(...)` at each
pipeline step; `App.tsx`'s `turnStage` state drives `TypingIndicator`, see components/ui/Game.tsx.)*

**6.2 Streaming narration [P0 / M]** — Stream the narration call token-by-token into the GM
bubble (typewriter dispatch). This is where the drama lives; it converts the longest wait into
suspense. *(= ROADMAP_3 P0.1b)* *(SHIPPED — `App.tsx`'s `streamingNarration` state + `onNarrationChunk`
callback feed `StreamingNarrationBubble` (`components/Chat.tsx`) during the narration call.)*

**6.3 "What Changed This Turn" digest [P0 / M]** — Render `adjudication.deltas` as a compact,
color-coded diff card between the player's action and the narration: "Trust with Maximinus −3 ·
Denarii −20,000 · The Suburra → Riots". Pulse the affected SidePanel tab. Zero new AI calls — the
data already exists. *(= ROADMAP_4 P0.3)* *(SHIPPED — see components/DispatchesDigest.tsx +
perception/visibility.ts's `buildPerceivedDigest`/`tabsForDelta`; `App.tsx` wires the result into
both the digest card and `SidePanel`'s `pulsingTabs`. Note the digest is perception-filtered, not
a raw delta dump, per the D5 "never omniscient" rule — see 8.1's cross-reference in
`perception/visibility.ts`'s doc comment.)*

**6.4 Delta micro-animations ("juice") [P1 / S]** — Animated count-up/down on resource numbers,
trust-bar fill transitions, brief red/green flash on changed rows, tab-icon badges with change
counts. Pure presentation over existing state.

**6.5 Live world meters [P1 / S]** — Once the `world` delta type unfreezes
`economic_stability`/`political_climate` (*ROADMAP_4 P2.1*), upgrade the Header strip from plain
text to compact trend meters (value + directional arrow + spark of recent history).
*(PARTIALLY SHIPPED — the blocker is gone: the `'world'` delta type now unfreezes both fields
(`ai/core/engine.ts`). `Header.tsx` still renders them as plain text `Stat` rows, not trend
meters/arrows/sparkline — that visual upgrade is still open.)*

## 7. Surface the Drama (stakes, endings, tension)

**7.1 Drama Meter / WorldStateTab [P0 / S]** — Fill the empty `WorldStateTab.tsx` with all five
`SimulationState` fields (imperial status, crisis, stability trend, …) with color-coded severity;
escalate the CrisisBanner treatment when status turns catastrophic ("SUCCESSION CRISIS — THE
THRONE IS VACANT"). Highest impact-per-hour in the codebase. *(= ROADMAP_4 P0.2)*
*(SHIPPED — see components/tabs/WorldStateTab.tsx: imperial/senate/military/plebeian status +
ongoing crisis, each severity-badged, plus a perception-filtered regional intelligence picture.
CrisisBanner's own escalation treatment for catastrophic status was not separately verified.)*

**7.2 Epilogue / Game Over screen [P0 / L]** — With `GameState.GAME_OVER` (*ROADMAP_4 P0.1*),
build an `EpilogueScreen`: a Tacitus-style obituary generated from `turnHistory` + `eventHistory`,
styled as a carved memorial stele — deified or damned. Include reign statistics (turns survived,
crises weathered, schemes uncovered, betrayals suffered) and a "begin a new reign" path.
*(SHIPPED — see components/EpilogueScreen.tsx: AI-generated obituary (with a static fallback
epitaph for Mock Mode / fatal AI failure), reign stats, and inferred-ambition flavor. `App.tsx`
routes to `GameState.GAME_OVER` on player death and renders it in place of the main game view.)*

**7.3 Odds & stakes preview [P1 / M]** — When risk/reward gambles land (*ROADMAP_4 P1.2*), show
pre-commit odds in the EventModal and on risky pills ("~70% the Guard holds"), and a dice-reveal
moment in the digest when the roll resolves. Uncertainty made visible is what makes gambles fun.

**7.4 Dramatic event staging [P2 / S]** — Give `EventModal` a portentous entrance: background
dim + slow fade, wax-seal "break" animation on open, distinct framing for crisis vs. opportunity
events, and a consequence-preview line per choice. *(= ROADMAP_3 P2.4)*

**7.5 Tension pacing cues [P2 / S]** — When the `tensionBudget` system exists (*ROADMAP_4 P1.4*),
reflect it ambiently: the parchment vignette darkens slightly, the crisis banner smolders, the
processing copy turns ominous on high-tension turns. The player should *feel* a payoff turn coming.

## 8. Intelligence Architecture (the scheming dashboard)

**8.1 Relationship map [P1 / L]** — Fill `RelationshipsTab.tsx` with a player-centric node-link
graph: nodes = characters (faction-colored, dead greyed), edge color = trust, thickness =
dependency, glyphs for threat/alignment. Click a node → jump to their dossier. Animate edge
changes after each turn so betrayals are *watchable*. (SVG + a small force layout; no heavy dep
needed at this entity count.) *(= ROADMAP_3 P1.3a)*
*(Still not built — `RelationshipsTab.tsx` remains a 0-byte, unimported file as of July 2026. Now
committed for Phase 4B, but NOT in this form: per `roadmaps/DESIGN_DECISIONS.md` D13 the map renders
only what the player interprets and has heard (edges with provenance/age, sourced from the knowledge
store — they can be wrong, not just stale), never ground-truth axis values. See
`roadmaps/ROADMAP_PHASE_4.md` 4B.4 and the brainstorm's G6 for the reasoning.)*

**8.2 Persistent dossiers [P1 / M]** — Promote per-NPC intel from component-local state to a
persisted, accreting file per target: every uncovered belief/scheme/secret, raw-thought reads,
investigation reports, and a relationship-history sparkline. The dossier is the espionage
player's trophy case. *(= ROADMAP_3 P1.3c)*

**8.3 Rumor feed [P1 / M]** — A chronological, deliberately-unreliable stream combining
headlines, leaked private-conversation fragments, and report claims, each tagged with source +
credibility. Distinct visual voice (handwritten-note styling vs. official dispatch). Feeds the
paranoia loop. *(= ROADMAP_3 P1.3b, ROADMAP_4 P1.3c)*

**8.4 Illuminated Chronicle [P1 / M]** — Rebuild `ChronicleTab` as the player-facing saga: one
card per turn (intent → narration excerpt → headline outcomes → event choices), styled as an
illuminated manuscript with drop caps and turn-number folios. Reuses `turnHistory`; the GM screen
keeps the raw view. *(= ROADMAP_3 P1.2)*
*(Still not built — `ChronicleTab.tsx` (now 22 lines, re-skinned onto the `gor-*` tokens) is still
a scripted-event choice log (turn, event title, chosen option), not the `turnHistory`-driven
illuminated saga described here.)*

**8.5 Interactive Empire map [P2 / L]** — Replace the Empire tab's card list with a stylized SVG
map of Rome/the provinces: regions tinted by stability, faction-control banners, character markers,
click-through to region detail. The tabula-style map *is* the fantasy; cards remain as the
accessible fallback view.

## 9. Onboarding, Guidance & Learnability

**9.1 First-reign onboarding [P1 / S-M]** — A dismissable 3-step overlay on the first
`AWAITING_PLAYER_INPUT`: how turns work, what the tabs hold, what investigations/denarii buy.
Seed 2–3 starter suggested actions before turn 1 so the input is never a blank page. Persist a
"seen" flag. *(= ROADMAP_3 P1.4)*
*(SHIPPED — see components/OnboardingOverlay.tsx (3-step, dismissable, in-fiction copy) +
components/starterActions.ts's `deriveStarterActions` (pure function, 3 starter pills, no AI
call), both wired from `App.tsx`'s `startGameWithCharacter`. The "seen" flag persists via
`persistence/onboarding.ts`.)*

**9.2 Codex / expanded glossary [P2 / M]** — Grow the two hard-coded `GlossaryTooltip` maps into
a data-driven codex: historical terms, game concepts (trust axes, credibility, schemes), and
discovered lore, browsable from a Help surface and linkified throughout narration.

**9.3 Contextual empty states [P2 / S]** — Every tab already has themed empty copy; extend it
with actionable hints ("Spend an Investigation in Dramatis Personae to fill this page").

## 10. Accessibility & Responsiveness

**10.1 Dialog & tab semantics [P0 / S]** — `role="dialog"` + `aria-modal` + focus trap +
Escape on both modals; `role="tablist"`/`tab`/`aria-selected` + arrow-key navigation on both tab
bars. *(= ROADMAP_3 P2.2a)*
*(PARTIALLY SHIPPED — `role="dialog"`/`aria-modal` now on `GameMasterScreen` and `EventModal`;
`role="tablist"`/`role="tab"`/`aria-selected` now on both tab bars (`SidePanel`,
`GameMasterScreen`). Still missing: focus trap, Escape-to-close, and arrow-key tab navigation.)*

**10.2 Mobile / responsive layout [P1 / L]** — Below `md:`, collapse to a single column with a
bottom switcher (Chat ↔ Intel); PlayerStatus becomes a collapsible summary bar; modals go
full-screen; pills wrap into a horizontal scroller. The conversational core is naturally
phone-shaped — this widens the audience considerably. *(= ROADMAP_3 P2.1)*
*(Still not built — no responsive breakpoints/media queries found in `design/`; the layout is
still the fixed flex-based 2:1 desktop split. Tailwind's `md:`/`w-2/3`/`w-1/3` are gone, replaced
with inline `flex: 2`/`flex: 1` styles, but the fixed-split constraint itself is unchanged.)*
*(PARTIALLY SHIPPED — UI refresh: `design/shell.css` section VIII. Below 768px chat and intel
become two horizontally swipeable leaves (scroll-snap, the panel's edge showing as the
affordance), the masthead drops to title + a 2×2 stat grid, and suggestion pills become one
swipeable row; the side-panel tab row is a size container that settles into a 4 + 3 grid when
narrow. Before/after evidence: `docs/ui-refresh/`. Still not built: modals going full-screen.)*

**10.3 Inclusive meters [P2 / S]** — Add text/pattern redundancy to color-coded meters (trust,
stability, credibility); respect `prefers-reduced-motion` for all entrance/typing animations;
audit the sepia palette for contrast.

## 11. Atmosphere & Sensory Polish

**11.1 Character portraits [P2 / M]** — AI-generated (or curated) bust-style portraits per
character: in dossiers, next to GM narration when an NPC acts, and on the selection cards.
Massively increases attachment to rivals. Cache per entity; graceful initial-letter medallion
fallback.

**11.2 Ambient sound & event stings [P2 / M]** — Optional low ambient bed (forum murmur, distant
crowd) + short stings for event reveal, betrayal, crisis onset, and turn resolution. Master
mute + volume in a small settings surface; default respects autoplay policies.

**11.3 Scannable transcript typography [P1 / S]** — Distinct visual beats inside narration:
styled headline blocks, quoted dialogue with speaker attribution, letters/decrees rendered as
in-fiction documents. Builds on the safe renderer (5.5). *(= ROADMAP_4 P2.3)*

**11.4 Iconography set [P2 / S]** — A small consistent Roman-styled icon set (laurel, denarius,
dagger, scroll, eagle) for resources, tabs, and delta digests, replacing text-only labels.

## 12. Session & Meta Capabilities

**12.1 Multiple save slots + import/export [P1 / M]** — Extend `saveGame.ts` to named slots with
a save-management UI on `CharacterSelection` (thumbnail = character + turn + crisis). JSON file
export/import doubles as backup and campaign sharing.

**12.2 Shareable reign recap [P2 / M]** — One-click "Chronicle of my reign" export: a rendered
summary (key turns, betrayals, ending) as a styled image/HTML page. This is the "you won't
believe what Maximinus did" viral artifact the Funness roadmap's vision calls for.

**12.3 Settings surface [P1 / S]** — A small modal for: theme (5.3), audio (11.2), text size,
reduced motion, streaming on/off, and (dev) mock mode — replacing the header checkbox.
*(SHIPPED as the consolidated configuration menu, July 2026 (D31/D43,
`components/SettingsMenu.tsx`): API key, Fates pacing, LVX/NOX lighting, GM console/intervention
availability, and a dev-build-only Developer card (Mock Mode + the GM-console runtime switch)
all live there with visible descriptions; the fixed bottom-right chrome and the dev-only Header
pills are gone. No audio/text-size/reduced-motion/streaming-toggle controls yet.)*

**12.4 GM screen as "Director's Booth" [P2 / M]** — Rebrand the player-facing half (Intervention,
Summary, Entity States) as an intentional sandbox-director feature with in-theme framing
("The Hand of Fate"); keep Raw JSON / Deltas / raw-call capture behind the dev gate.
*(= ROADMAP_3 P0.4 residue)*

## 13. AI-Native Interaction Enhancements (longer horizon)

**13.1 Voice input & narrated dispatches [P3 / M]** — Web Speech API dictation into `ChatInput`;
optional TTS reading of GM narration (a "court herald"). Pairs naturally with streaming (6.2).

**13.2 Generated scene illustrations [P3 / L]** — For payoff turns and scripted events, generate
a single evocative scene image (mosaic/fresco style) to crown the narration. Expensive; gate to
high-tension moments only.

**13.3 Ask-the-Chronicler [P3 / M]** — A free-form question box scoped to *known* information
(chronicle, reports, uncovered intel): "What do I know about Maximinus's allies?" — an AI recall
assistant over the player's own knowledge, carefully firewalled from hidden state.

**13.4 Replay / spectator mode [P3 / L]** — Step through a finished campaign turn-by-turn from
`turnHistory` (chat + delta digest + map state per turn) — useful for sharing, debugging, and
prompt evaluation alike.

---

## 14. Suggested Sequencing (UI work only)

*(Status note, July 2026: most of Wave 1 shipped — 6.1, 6.2, 6.3, 7.1 are all done (see their
entries above); 5.5 and 10.1's remaining pieces (focus trap/Escape/arrow-nav) have not. Wave 2 is
partial — 7.2 and half of 5.4 shipped; 5.1's toolchain move is partial; 12.3 has not shipped. Wave
3's 9.1 shipped; 8.1/8.2/8.3/8.4 have not. See each item's inline annotation above for specifics.)*

| Wave | Items | Rationale |
|---|---|---|
| **Wave 1 — Loop feel & safety** | 6.1 staged progress, 6.2 streaming, 6.3 digest, 7.1 drama meter, 5.5 safe renderer, 10.1 dialog a11y | Aligns with master-plan Phases 2–3; all player-felt, mostly surfacing existing data |
| **Wave 2 — Foundation & stakes** | 5.1 toolchain, 5.4 component/state refactor, 7.2 epilogue screen, 12.3 settings, 6.4 juice | Structural debt paid down right before the surface area grows |
| **Wave 3 — Intelligence depth** | 8.1 relationship map, 8.2 dossiers, 8.3 rumor feed, 8.4 chronicle, 9.1 onboarding, 11.3 transcript typography | The scheming dashboard — the game's identity |
| **Wave 4 — Reach & polish** | 10.2 mobile, 8.5 empire map, 11.1 portraits, 12.1 save slots, 5.3 dark mode, 7.4 event staging | Broaden audience and deepen atmosphere |
| **Wave 5 — AI-native extras** | 13.1–13.4, 12.2 recap export, 11.2 audio | Differentiators once the core is polished |

**What NOT to do early** (echoing the domain roadmaps): no router/multi-page navigation, no
account system/cloud saves, and no heavy visualization work (8.1, 8.5) before the turn loop feels
alive (Wave 1) — legibility and drama first, breadth later.
