# B7a hardening + the tablist contract — Design

Date: 2026-08-05 · Status: approved (owner directed both items in-session;
architect rulings below). Two work items, two commits, one pipeline pass.

---

# Work item 1 — B7a: the four import-review residuals

## 1a. `entities[].name` non-string

Ruling: guard at BOTH derive sites, not the validator — the shallow-validator
doctrine stands (boot cannot crash on what it accepts; deeper malformation
parity with hand-edits). The two boot readers are `App.tsx`'s
`loadSavedGameSummary` and `importSaveBlob`'s derive, already required to
mirror each other. In both: the derived name is
`typeof name === 'string' ? name : 'Unknown'` — NOT `String(...)` coercion
(a numeric name is malformed data; "Unknown" is honest, "5" is a pretense).
This also closes the boot crash: `(characterName || 'R').charAt(0)` can no
longer meet a non-string. Tests: an `entities:[{entity_id:'p',name:5}]`
import returns `ok` with `characterName:'Unknown'`, and a slot containing
that shape boots to a summary (call `loadSavedGameSummary`'s seam or pin
via CharacterSelection render) instead of crash-looping.

## 1b. A poisoned slot gets an in-app escape

Ruling: `ErrorBoundary` gains a SECONDARY, confirm-gated action beside
"Restore Last Save": "Abandon the reign and begin anew." First press swaps
in the Abandon-grammar inline confirm (crimson sentence "Abandon your saved
reign? It cannot be undone." + danger confirm + ghost "Keep my reign" that
reverts); confirm calls `clearSave()` (guarded — a throwing clear must not
crash the boundary; fall back to a direct guarded `localStorage.removeItem`)
then `window.location.reload()`. Rationale recorded in the component
comment: ErrorBoundary catches ANY render crash, so the action is
deliberately secondary and confirm-gated — but a slot that crashes render
previously had NO in-app escape at all (reload loops forever). Tests:
ErrorBoundary (it is a class component — mount it with a thrower child)
shows the action; first press shows confirm; confirm clears the slot and
fires the stubbed reload; "Keep my reign" backs out with the slot intact.

## 1c. The D8 ambition tail vs a fresh import

Ruling: a successful import bumps `campaignGenerationRef` — the tail
already guards on generation equality (`useExecuteTurn.ts:606-614`), so
the bump invalidates any in-flight `updateSavedAmbition` exactly the way
turn-rollback invalidation works. Implementation: App wraps the raw
`importSaveBlob` in a `handleImportReign` callback — `const result =
importSaveBlob(text); if (result.ok) campaignGenerationRef.current += 1;
return result;` — and BOTH homes receive the wrapper (they currently
receive `importSaveBlob` bare). Test: unit-level — after an ok import via
the wrapper, the ref differs; plus (if cheap in the existing ambition-tail
test file's idiom) a pin that a pending tail landing after an import
generation bump does not write. If the tail pin is disproportionate, the
ref-bump pin plus the existing generation-guard tests suffice — say so.

## 1d. The unpinned Replace-confirm disabled state

Extend the existing Settings lock test in `reignImportSurfaces.test.tsx`:
stage a file selection so the Replace confirm is showing, set the lock,
assert Replace is `disabled` (and that "Keep my reign" is not).

## B7a records

Close the four bullets in BACKLOG's B7a (each: fixed, date, where), keeping
the section as memory with a one-line closure per item rather than deleting.

---

# Work item 2 — the tablist contract (dashboard + GM console bars)

The standing residual: `SidePanel.tsx` (7 tabs) and `GameMasterScreen.tsx`
(11 tabs) declare `role="tablist"`/`role="tab"` with `aria-selected` only.
Unlike the sub-rails (converted away because they are filters), these two
genuinely control panels — the ruling of record says complete the contract,
not drop the roles. `components/ui/rovingRadio.ts` has the keyboard half,
selector-locked to `[role="radio"]`.

## Rulings

- **Generalize `rovingRadio.ts`** by parameterizing its item selector /
  role, defaulting to `radio` so every existing call site is untouched.
  Export whatever shape the file's own idiom suggests (a `role` option or a
  selector argument) — the sub-rail conversions and their tests must not
  change.
- **Automatic activation**: arrow keys move focus AND activate the tab
  (matching the radio semantics the helper already implements, and WAI-APG
  guidance for instantly-rendering panels — both bars are pure client
  renders). Left/Right and Home/End minimum; wrap at the ends if that is
  what the helper already does for radios (keep one behavior).
- **Roving tabindex**: exactly one tab with `tabIndex=0` (the selected
  one), the rest `-1`.
- **`aria-controls` + `role="tabpanel"`**: each tab carries
  `aria-controls={panelId}`; the panel container gets `role="tabpanel"`,
  a stable `id`, and `aria-labelledby={activeTabId}`. One panel element per
  bar (the content swaps inside it) is acceptable and simpler than seven
  mounted panels — the id/labelledby just tracks the active tab. Panels do
  NOT get `tabindex` (both have focusable content).
- Both bars get the same treatment; the GM console's campaign-wide vs
  per-turn tab split changes nothing about the contract.

## Tests

New `tablistContract.test.tsx` (house mount style), covering BOTH surfaces:
- exactly one `tabIndex=0` in each tablist, on the selected tab;
- ArrowRight/ArrowLeft move focus AND selection (assert both), Home/End
  jump, wrap behavior pinned to whatever the radios do;
- every `aria-controls` references an element that exists with
  `role="tabpanel"` and a matching `aria-labelledby`;
- the existing sub-rail (`aria-pressed`) surfaces are UNTOUCHED — pin that
  no sub-rail gained `role="tab"` (one guard assertion).
Existing suites (`panelRegisters`, `gmScreenSmoke`, SidePanel/GM tests)
must pass unedited.

## Records

Close the BACKLOG "`role="tablist`" is claimed and unkept" residual and the
D45 cross-reference if any; note `rovingRadio`'s generalization in its own
doc comment.

---

## Out of scope (both items)

Deeper per-entity import validation beyond 1a; ErrorBoundary redesign;
vertical-arrow tablist orientation; touching the sub-rails.
