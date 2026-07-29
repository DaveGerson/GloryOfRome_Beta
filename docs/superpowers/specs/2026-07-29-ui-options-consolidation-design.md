# UI Options Consolidation & Play-Surface Restyle — Design

**Date:** 2026-07-29 · **Status:** Approved (full play-surface sweep; LVX/NOX fully into Settings)

## Problem

Four user-reported UI defects share two root causes:

1. **The composer regressed to unstyled HTML.** `TurnComposer.tsx` and
   `StructuredTurnComposer.tsx` (the main play surface) carry **zero** design-system
   classes — bare `<button>`/`<textarea>`/`<p>` — because when they replaced the old
   `ChatInput`/`ActionPills` (now dead code in `Chat.tsx`), the `gor-*` design language
   never came with them. Suggested next actions render as browser-default buttons.
2. **Options are scattered across three surfaces.** A `position: fixed` bottom-right
   overlay (FATES pacing + LVX/NOX lighting, `App.tsx`) floats over content with
   tooltip-only descriptions; dev-only Mock Mode / GM Console switches sit in the
   Header; the Settings dialog holds the rest. The gold segmented-button pattern is
   hand-rolled inline in four places.

## Design

### 1. `SegmentedControl` primitive (`ui/Forms.tsx` + `design/components.css`)

- Props: `options: { value, label, title? }[]`, `value`, `onChange(value)`,
  `ariaLabel`, optional `leading` label chip, `disabled`.
- Buttons use `aria-pressed`, `.gor-seg` / `.gor-seg-btn` classes (gold-600 active,
  surface-card idle — promoted verbatim from the existing inline pattern).
- Consumers: TurnComposer mode toggle, SettingsMenu pacing + lighting cards.

### 2. `TurnComposer` restyle

- Suggested actions → existing `ActionPill` (parchment pill, ❧ glyph, staggered rise).
- Chat/Structured mode toggle → `SegmentedControl`.
- Textarea → `gor-textarea` with auto-grow and themed placeholder copy ported from the
  dead `ChatInput` ("Enter your action… (Shift+Enter for new line)", stage copy while
  processing, "Awaiting the Senate's judgment…" when disabled).
- Send → `Button` ("Speak"); char count / validation → `gor-hint` / `gor-hint-error`.
- Delete dead `ChatInput` + `ActionPills` from `Chat.tsx` (`TypingIndicator`,
  `ChatMessage`, `StreamingNarrationBubble` remain).

### 3. `StructuredTurnComposer` restyle

Sections → `gor-field`/`gor-label`; controls → `gor-textarea`/`gor-input`/`gor-select`;
row-adders → ghost `Button` ("+ Add …"); "Submit turn" → primary `Button`; helper prose
and validation → `gor-hint`/`gor-hint-error`.

### 4. Options consolidation

- **Delete** the fixed bottom-right chrome and `App.tsx`'s duplicate `FATES_OPTIONS`.
- **SettingsMenu** becomes the single home for every option, each with a visible
  description:
  - *Gemini API Key* (unchanged).
  - *The Fates' Pacing* — upgraded to `SegmentedControl`; the three per-posture
    descriptions (previously hover-only `title`s) become visible text.
  - *Lighting* (new) — LVX/NOX via `SegmentedControl`; "Marble day or torchlit
    night — a device preference, never part of your save." Wired to App's `isNox`.
  - *Game Master Console* (unchanged: availability + intervention switches).
  - *Developer* (new, `import.meta.env.DEV` only) — absorbs the Header's dev pill:
    Mock Mode switch and the runtime "GM console open now (Ctrl+Shift+G)" switch
    (gated on `gmConsoleAvailable`, mirroring the Header handler it replaces).
- **Header** keeps only the ⚙ Settings affordance.

### 5. Full-sweep polish (approved scope)

- `PrivateScene.tsx`: dialog header matches the `gor-dialog` register; its ~11 raw
  controls get `gor-select`/`gor-textarea`/`Button`; transcript styled to the chat
  register.
- `TurnSubmissionHistory.tsx`: labels → `gor-label`, ❧ list markers, bubble-consistent
  spacing.

### 6. Docs delta

`DESIGN_DECISIONS.md` D31 ("exactly four settings") superseded by this consolidation;
`UI_SYSTEMS_CURRENT_AND_FUTURE.md` + `UI_SCREEN_WIREFRAMES.md` updated: no floating
chrome, settings consolidated, composer styled.

## Hard constraint

**Zero behavioral change.** Every aria-label, role, handler, keyboard shortcut, and
persistence path is preserved verbatim; the existing vitest suite must stay green
untouched. All changes are presentational or relocations of existing controls.

## Accepted tech debt

`GameMasterScreen.tsx`'s 5 raw elements stay unstyled (GM/dev surface, out of player
sight).
