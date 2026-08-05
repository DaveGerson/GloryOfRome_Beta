# Reign Export & Import — Design

Date: 2026-08-05 · Status: **approved** (owner, in-session) · Work item 2 of 2
(the executeTurn extraction) is included at the end.

## Context

Commit `d8df778` removed WP-21's "Take a copy of the reign" on privacy
grounds. The owner overruled that classification (D45, as amended): the save
blob's GM-side content is **spoiler material, not private material** — a
gameplay artifact below the player's line of sight. The surviving removal
rationale was functional: the app had no import path, so the download could
never be restored. This design adds the import route and restores export —
per the amended D45, "with one, raw-blob export/import becomes an ordinary
save-to-file feature."

## Owner decisions (2026-08-05, in-session)

1. **Export homes:** the save-failure notice (restored rescue affordance)
   AND the Settings menu (always available, NOT DEV-gated).
2. **Import homes:** the character-select screen ("Restore from a copy"
   beside Start anew) AND the Settings menu.
3. **Overwrite flow:** when a saved reign exists, an inline Abandon-style
   confirm (the exact `Start anew` pattern: crimson sentence + danger
   button + "Keep my reign") gates the overwrite.
4. **Success behavior (uniform):** write the slot, then `location.reload()`
   — the boot path (B12-verified end-to-end this session) picks up the
   imported reign. No teardown plumbing, and mid-campaign import from
   Settings costs nothing extra.
5. **Failure behavior:** never reloads, never takes the room (D45): an
   in-fiction notice states what happened and that the current reign is
   untouched; the slot is not written.

## Interfaces

### `persistence/saveGame.ts`

- Restore `rawSaveBlob(): string | null` — verbatim `SAVE_KEY` read, same
  body `d8df778` removed. Comment cites amended D45 (shareable spoiler
  material), not the old "player-safe" claim.
- Extract the validation `loadGame` already performs (JSON parse →
  `looksLikeSaveGame` shape check → `SAVE_VERSION` equality) into ONE shared
  internal validator; `loadGame` delegates to it. Import acceptance and
  load acceptance must be the same code path so they can never drift.
- New `importSaveBlob(text: string): ImportResult`, never throws:

  ```ts
  type ImportResult =
    | { ok: true; turnNumber: number; characterName: string }
    | { ok: false; reason: 'unreadable' | 'not_a_reign' | 'version_mismatch' | 'storage_failed' };
  ```

  On `ok`, the slot has been written. On failure the slot is untouched.
  `turnNumber`/`characterName` feed the confirm UI ("replace Turn IV as
  Gaius…?" is out of scope; they exist for notices and future use).
  Ordering: the UI's overwrite confirm happens BEFORE `importSaveBlob` is
  called — the function itself never asks; by the time it runs, the player
  has already consented, so `ok` may write immediately.

### `App.tsx`

- Restore `downloadTheReign()` verbatim (filename
  `gor-reign-week{turnNumber}.json`; object-URL revoke deferred 10s with
  the same Firefox/Safari comment).
- `TransactionNoteView`'s save case passes `onTakeCopy={downloadTheReign}`
  again.

### `components/ui/FailureNotices.tsx`

- `SaveFailureNotice` regains optional `onTakeCopy`; the doc comment
  flips: the escape hatch is BACK because the import route now exists —
  cite amended D45.

### `components/SettingsMenu.tsx`

- A new non-Workshop (not DEV-gated) section: export button ("Take a copy
  of the reign"), rendered only when `hasSave()` (D45 zero-state spirit:
  an affordance only where it can act); import control ("Restore from a
  copy") with the Abandon-style confirm when a save exists, inline
  crimson failure notice, reload on success.

### `components/CharacterSelection.tsx`

- "Restore from a copy" renders in BOTH states (hidden `<input type="file"
  accept="application/json">` + visible ghost button): with a `savedGame`,
  beside Start anew inside the Continue card, and file selection swaps in
  the Abandon-style confirm before applying; with no save (the fresh-device
  restore case), as a standalone quiet action below the destiny grid, no
  confirm needed. Failure renders an inline in-fiction notice. Success
  reloads. `characterName` derivation (and its missing-entity fallback)
  mirrors App's existing `loadSavedGameSummary` exactly.

## Copy (veto queue — owner may reword)

- Export action: **"Take a copy of the reign"**
- Import action: **"Restore from a copy"**
- Failure leads (all end "Your current reign is untouched."):
  - `unreadable` / `not_a_reign`: "This scroll could not be read as a reign."
  - `version_mismatch`: "This copy was written for another age of the Republic."
  - `storage_failed`: "This device would not take the writing down."
- D45's "one thing to press" clause: the import control itself stays present
  and enabled beside the failure notice — trying another file IS the
  affordance; no extra button.

## Tests (TDD — write red first)

Persistence (`tests/persistence.test.ts` or a sibling `importSave.test.ts`):

1. Round-trip: `saveGame` → `rawSaveBlob` → `clearSave` →
   `importSaveBlob(blob).ok` → `loadGame` deep-equals the original state.
2. Garbage text → `{ ok:false, reason:'unreadable' }`; a pre-existing save
   in the slot is untouched.
3. Valid JSON, wrong shape → `'not_a_reign'`; slot untouched.
4. Wrong `SAVE_VERSION` → `'version_mismatch'`; slot untouched.
5. `rawSaveBlob()` is `null` with no save and byte-identical to the slot
   with one.
6. `ok` result carries the imported `turnNumber` and `characterName`.
7. A slot write that throws (quota/storage) → `'storage_failed'`.

An App-level wiring test (the failure notice actually carries the copy
action; the import homes are actually wired) is owned by the VERIFY stage,
not the red phase — the feature died at the wiring last time (`d8df778`),
so wiring is checked by a later, adversarially-minded pass.

Surfaces:

- `designPassSurfaces.test.tsx`: FLIP the `never offers the player a copy
  of the raw reign` pin — the notice offers "Take a copy of the reign"
  again when `onTakeCopy` is passed; the pin's own comment said it could
  not return "without someone first building an import route," and now
  one exists. Update the comment to record that.
- CharacterSelection: import affordance renders; with an existing save the
  confirm gates it (confirm applies, "Keep my reign" cancels); failure
  shows the in-fiction notice and leaves the slot; success path calls the
  (stubbed) reload.
- SettingsMenu: export present only with a save; import present; not
  inside the DEV-gated Workshop block.
- jsdom note: stub `location.reload` (`vi.spyOn`/`defineProperty`) — never
  let a test actually navigate.

Journeys: the saveReload journey already pins slot round-trip through the
real pipeline; no new journey is expected, but the TDD pass must confirm
this against `tests/journeys/` and say so explicitly.

## Record updates (same commit as the feature)

- `roadmaps/BACKLOG.md`: close "Reign export needs an import route — and
  only that" (landed, date, surfaces).
- `roadmaps/DESIGN_DECISIONS.md` D45: closure sentence in the amended
  paragraph ("the import route landed 2026-08-05; export is back").
- Any remaining "no import path" phrasing in either doc: updated.

## Out of scope

- Cross-version migration on import (equality check only, same as load).
- Multiple save slots; import-merge; mid-campaign import without reload.
- Reworking the private-scene/observation offline gaps (separate item).

---

# Work item 2 — executeTurn extraction (refactor, no design questions)

- Create `src/hooks/useExecuteTurn.ts` (new `hooks/` directory) exporting
  `useExecuteTurn(deps: ExecuteTurnDeps)` that returns the callback.
- Move the `executeTurn` `useCallback` body (`App.tsx:833–1356`) VERBATIM;
  `ExecuteTurnDeps` is one explicit typed object naming everything the
  26-entry dependency array carries today. `App.tsx` keeps a thin
  `const executeTurn = useExecuteTurn({ ... })`.
- Zero behavior change. The existing 1716 unit tests and 10 journeys are
  the pin; none of their expectations may be edited for this refactor.
- The private-scene handlers are NOT in scope.
- Lands as its own commit after the feature commit.
