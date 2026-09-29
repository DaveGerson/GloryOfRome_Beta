# Glory of Rome — Fan-out Uplevel (September 2026)

A single pass that split the codebase into six tracks. Each track was run by
its own agent in its own worktree, with its own list of files it could touch,
then merged onto one integration branch. The branch is
`claude/codebase-refactor-improvements-fvavwh`. This file records **what
landed** and the **bigger changes proposed** for the next phases. Binding
rulings stay in `DESIGN_DECISIONS.md`, and deferred items stay in
`BACKLOG.md`. Nothing here overrides either.

Baseline before the pass: 1897 unit tests, 10 journeys, all green.
After the pass: **2067 unit tests, 10 journeys**, all green. Typecheck, lint
with zero warnings, the deterministic eval and the build all pass on every
merge.

---

## Part 1 — What landed

### Track A · Composition root (`App.tsx`)
- `App.tsx` **1507 → 477 lines**. It had about 32 `useState` calls and now
  has one. It no longer calls `useEffect` directly.
- New hooks:
  - Shell and settings: `useSettings`, `useGmConsole`, `useWeekBeat`,
    `useShellEffects`, `useOnboarding`.
  - Transactions: `useCampaignTransactions`, the save-then-dispatch spine.
  - Game flows: `usePrivateSceneController`, `useTurnFlow` (which wraps
    `useExecuteTurn`), `useEventFlow`, `useCampaignLifecycle`,
    `useIntelCommits`, `usePlayerPerception`.
- Shared transaction types and pure helpers live in `app/transactions.ts`.
  `useExecuteTurn` now imports them instead of keeping its own copies.
- `GameMasterScreen`, `EpilogueScreen`, `SettingsMenu` and
  `OnboardingOverlay` are lazy-loaded and preloaded right after the app
  mounts. The main chunk went from **459 kB to about 404 kB**.

### Track B · AI core (`ai/core`)
- `runNewTurn` is now eight named stages that share one context:
  director → player action → NPC minds → adjudication → mortality →
  apply state → player-facing text → assemble result. Stage order, dice
  consumption and redactions are unchanged.
- **B7(a) closed.** There is a new incremental `createPayloadTextExtractor`.
  A 128 KB streamed payload went from **4052 ms to 0.7 ms**. Tests check
  that it gives exactly the old function's answer at every chunk, over
  thousands of random ways of splitting the payload.
- Bugs fixed, each with a regression test:
  - A dead character could be revived publicly by a second death claim
    that rolled a survival fate.
  - Two death claims for the same character each got a roll, so a lucky
    second roll could overturn a failed player death save.
  - The model's difficulty value reached the dice unclamped. At DC 60 even
    a natural 20 was a critical failure.
  - When the leak check stopped narration mid-stream, the error was
    reported as a *transient* one, so the player was offered a retry.
  - A resource delta with no resource name wrote a resource literally
    called `"undefined"` into the save.

### Track C · Game logic (events / knowledge / perception / prompts)
- **D41 gap closed.** `buildClarificationPrompt` now escapes its text with
  `asPromptData`. `KNOWN_DEFERRED_GAPS` is empty, so the guard enforces
  every prompt.
- **`economic_stability` vocabulary.** `events/stabilityVocabulary.ts` defines
  five ordered grades and maps the model's synonyms onto them. Before this,
  authored events stopped firing when the model wrote a synonym such as
  "Collapsing". A test fails if an event compares the raw string.
- **Fork-key collision (a real bug).** Once old forks were evicted, the
  next contradiction could reuse a key still in use. Fork numbers now come
  from the highest number still in the store. The save format is unchanged.
- `whispers_of_mutiny` kept firing forever because it counted loyalty to a
  dead rival.
- A dead spy contact kept passing news from their last region to the
  player (a D5 leak).

### Track D · UI engineering (components, accessibility, performance)
- Colour tokens meet the WCAG AA contrast floor in the day and night skins.
  `tests/colorContrast.test.ts` checks every text token against every
  surface.
- `ChatMessage` is memoised: about 15 ms to 2 ms per streamed chunk with
  240 messages. SidePanel's report grouping is no longer quadratic.
- Focus and screen readers:
  - The focus trap now skips elements Tab skips, and PrivateScene uses the
    shared trap.
  - Focus returns to the composer after a send.
  - Confirm dialogs move focus to the safe choice.
  - Live regions no longer re-read half sentences, and tooltips and glossary
    terms close on Escape.
- Split along clean seams:
  - `CharacterSelection` 434 → 238 lines, with the custom-character form
    moved to `CustomDestinyForm`.
  - `GameMasterScreen`, `SettingsMenu` and `PrivateScene` each lost about
    90–120 lines.
  - The duplicated import flow is now one hook, `useReignImport`.
- The Events tab no longer drops a failed clarification silently. It shows
  a refusal instead.

### Track E · Platform (persistence / tooling / CI / docs)
- Saves carry a version, and older saves are upgraded on load through a
  registry of migration steps. A test fails if `SAVE_VERSION` is bumped
  without a migration step.
- A failed save now says why: `quota_exceeded`, `storage_unavailable` or
  `build_failed`.
- `persistence/crossTab.ts` detects when another tab writes the save (B7).
  It only reports; it is not wired into the UI yet (see P1 below).
- More strict TypeScript flags are on: `noFallthroughCasesInSwitch`,
  `noImplicitReturns`, `noUncheckedSideEffectImports`,
  `allowUnreachableCode: false` and `allowUnusedLabels: false`.
- CI runs three parallel jobs, `verify:static`, `verify:unit` and
  `verify:integration`, which are the same scripts `npm run verify` runs.
  CI also has read-only permissions, cancels superseded runs, has a timeout,
  and runs an `eval:ci` leg that forces the API key empty.
- `src/README.md` and the root README now match the actual architecture.

### Track F · Visual design pass
A full visual pass over `design/**` in an "imperial Rome after dark"
direction. Before and after screenshots are in `docs/ui-refresh/`, numbered
01–03 for before and 04–10 for after.
- **Fonts ship with the app.** Cinzel, Cinzel Decorative and EB Garamond are
  a Latin subset of about 150 KB, licences included. Before, a blocked CDN
  fell back to Times New Roman everywhere.
- **Layout and chrome.** New layers in `design/shell.css` and
  `design/tokens/depth.css`; no existing token was renamed.
  - A slimmer masthead with a gold-leaf title.
  - The chat is a centred manuscript column, with narration leaves the desk
    fades into.
  - The side panel is a recessed register, and all seven tabs fit on one
    row.
  - Dialogs fade in over a blurred backdrop.
  - Every animation turns off under reduced motion.
- **NOX (night) is the default** for devices that never chose a theme. An
  explicit LVX (day) choice is still honoured.
- **Phone layout (< 768 px).** Chat and intel sit side by side as swipeable
  panes (UI doc §10.2).
- **Visible focus.** The selected tab now shows a keyboard focus ring, and
  the seven 9–9.5 px labels that failed contrast now use `--text-quiet`.

---

## Part 2 — Bigger changes, proposed

These are grouped into waves by leverage ÷ effort. Each item names the
existing code it builds on, because nearly everything here extends what is
already there rather than replacing it.

### Wave 1 — Make the game *feel* different (gameplay, ~2–4 weeks)

| # | Proposal | Builds on | Effort |
|---|---|---|---|
| G1 | **Scheme deduction board (B3).** The player picks a suspected scheme type from 4–5 options and may accuse once. Each clue eliminates one wrong option. A correct accusation reveals the scheme and brings leverage. A wrong one plants a false rumor about the accused and costs the player standing. Intel becomes a wager the player makes, not a timer. | scheme clue accretion, contradiction edges, truth ledger (D11) | 2–3 wk |
| G2 | **Economy with momentum.** The five grades drift one step per season from inputs the player controls: the grain dole, levies, regional stability, unpaid donatives. The adjudicator may only nudge the economy by ±1 grade per turn. Crises become consequences the player can see coming. | `stabilityVocabulary.ts`, world deltas, authored events | 3–4 d |
| G3 | **Faction blocs with a collective mind (B6).** The Plebs, the Senate and the Praetorians each get a mood aggregated from their members, plus off-screen moves: strikes, bread riots, closing the Curia, demanding a donative. They become opponents that act on their own and can be played against each other. | D22 seam, per-NPC minds, `plebeian_mood` | 2 wk |
| G4 | **Spy networks the player tends.** Contacts can die, be turned, or go quiet. A turned contact feeds false news through the same channel, and the relationship map draws the lie faithfully (D13). | `visibility_network`, rumor claims, private scenes | 1 wk |
| G5 | **Intel currency exchange (B1).** The player can convert denarii, favors or client dependency into investigations, with a loss on each trade, per-season caps, and brokers for some trades. This finally makes the dormant graded refresh pricing in D27 matter. | `resources.ts`, `dossierCost.ts` | 1 wk |
| G6 | **Fortuna's Favor (B10).** The GM nudge costs temple denarii and leaves an omen rumor that NPCs react to. It shifts the odds of existing seeded rolls but never rewrites facts. | seeded rolls in `resolution.ts`, rumor pipeline | 1 wk |

### Wave 2 — Faster, cheaper turns (AI architecture, ~2–3 weeks)

| # | Proposal | Why | Effort |
|---|---|---|---|
| A1 | **Deadlines and cancellation in `geminiService`.** Add per-tier timeouts and pass an `AbortSignal` through a turn. A failed parallel call cancels its siblings, and the player gets a "cancel this turn" button. | A hung stream stalls a turn indefinitely today. | 2 d |
| A2 | **Overlap adjudication with NPC minds.** Start adjudicating with the director's intents, and take in any minds that arrive within about 1.5 s. | Removes about one flash round-trip from the critical path. | 3–4 d |
| A3 | **Context caching** for the large, stable system prompt and world prefixes. | Fewer input tokens and a faster first token on the two most expensive calls. | 3–5 d |
| A4 | **Route calls by stakes.** Move simulation-state, the inner monologue and obviously invalid death claims to flash, and gate the switch with the eval harness. | Roughly 30–40 % fewer pro tokens per turn. | 2–3 d |
| A5 | **Incremental player-boundary stream gates.** Apply the extractor's approach to `createNarrationStreamGate` and `createPlayerVisibleStreamGate`. | These gates are now the most expensive part of the streaming path. | 2 d |
| A6 | **Stream the adjudication itself.** Mortality and simulation-state start as soon as their fields are complete. The commit stays behind the full boundary check. | The largest possible latency win. | 2 wk |

### Wave 3 — State architecture (maintainability, ~2 weeks)

| # | Proposal | Why | Effort |
|---|---|---|---|
| S1 | **Thunk-style `commit(action)`.** Build the save candidate by running the reducer on current state, instead of each handler building it by hand. | Removes, by design, the class of bug where a stale closure reverted another field. | 3–4 d |
| S2 | **`executeTurn` as an explicit state machine** of pure steps: snapshot → pipeline → follow-ups → commit or rollback. | `useExecuteTurn` is still 696 lines. The journey harness could then run the same code instead of a hand-kept mirror. | 1 wk |
| S3 | **Hook-only contexts** instead of dependency bags of 15–40 fields. Children keep plain props, as D17 requires. | Easier to read, and fewer places for stale dependencies. | 2–3 d |
| S4 | **Strict-types campaign with a gate.** A `typecheck:strict` script counts errors per flag and CI fails if a count goes up. Then turn on `noImplicitOverride` (5 errors) and `noUnusedLocals` (7), then `noUncheckedIndexedAccess` outside tests (69). | Tightens types steadily, one flag at a time. | S per step |
| S5 | **An error boundary per surface**: each lazy screen and each SidePanel tab. | One broken surface degrades only itself. | 1–2 d |

### Wave 4 — Platform and reach (~3–5 weeks)

| # | Proposal | Why | Effort |
|---|---|---|---|
| P1 | **Wire cross-tab detection.** Show a notice with Reload / "keep this tab's reign", pause autosave until the player chooses, and show a storage-full message using the new failure reason. The notice copy is veto-queue, so the owner decides the wording. | Closes the last B7 persistence risk. | 1 d |
| P2 | **Browser end-to-end tests with Playwright** as a fourth CI job, running Mock Mode in preview. Cover boot, a turn, reload, export/import, two-tab play and the GM hotkey. | jsdom does not exercise real storage events, focus, layout or bundle loading. | 2–3 d |
| P3 | **IndexedDB storage with multiple save slots** and autosave history (undo to turn N), plus a `BroadcastChannel` tab lock. | Lifts the ~5 MB ceiling. The migration registry makes the move safe. | 1 wk |
| P4 | **Mobile single-column layout.** Below about 900 px, show a Chat ↔ Intel switcher, collapse player status into a bar, and make dialogs full-screen. | The biggest reach gain (UI doc item 10.2). | 1–2 wk |
| P5 | **Reading and motion settings**: text size, reduced motion, streaming off, progress announcements. *(LANDED 2026-09-28 except progress announcements — see Part 3.)* | Also settles the double progress announcement noted in the UI track. | 3 d |
| P6 | **Per-tab "what changed since you last looked"** counts instead of the pulse dot. *(LANDED 2026-09-28 — see Part 3.)* | Turns the intel panel into a to-do list and helps screen-reader users. | 3–4 d |
| P7 | **Shareable end-of-reign recap** built from the Chronicle and the epilogue. | Players share their story, which is a growth loop. | 1 wk |
| P8 | **Opt-in telemetry** for stage latency, retry and validation rates, save failure reasons and error-boundary crashes. | Tuning becomes measurement, and it feeds the eval corpus. | 2–3 d |
| P9 | **Hosted mode (B9)**: a Gemini proxy, optional sign-in, and saves on the server. | No need to bring your own key; saves follow the player across devices. | 2+ wk |

### Recommended order
1. **P1, A1, A5**: small changes that close risks.
2. **G2 → G1**: the gameplay changes that best show off the new substrate.
3. **S1 + S2** before G3/G4, because both of those add more turn-time
   follow-ups.
4. **A2 → A4 → A3**, measured with the eval harness and P8.
5. **P4 + P2**, then P3 and P7.

### Open owner decisions surfaced by this pass
- **D12 modal-weave double hit.** The gate needs the adjudicator to declare
  which authored event it wove in. That is a schema change; ruling needed.
- **Turn progress is announced twice**: in the chat loom and in the
  composer's stage line. Which surface keeps the announcement?
  *Resolved on best practice, 2026-09-28 (Part 4): the composer's stage
  line.*
- **The Events tab refusal copy** reuses the dossier's line word for word.
  It is new on this screen, so it goes in the veto queue.
  *Recommended on best practice (Part 4): keep the shared line. The copy
  is still the owner's to veto.*
- **NOX as the default theme.** Is the night skin the right first
  impression? To revert, delete the one small script block in `index.html`.
  *Resolved on best practice, 2026-09-28 (Part 4): a device that never
  chose follows the system's appearance. Reverting is now a two-line
  change (see Part 4).*
- **CI check names changed** from `ci` to `verify:static`, `verify:unit`
  and `verify:integration`. Update branch protection if it requires `ci`.

---

## Part 3 — Landed since: the game-screen UI pass (2026-09-28)

One pass over the game screen, aimed at the two things a player feels
every week: how much of the screen the chronicle gets, and how quickly
they can reach what they need. New copy is in the veto queue
(`BACKLOG.md`, "Reading, motion and the command palette"); nothing here
touches the save format, the AI pipeline or any ruling in
`DESIGN_DECISIONS.md`.

- **P5, reading and motion.** A new Reading register in the configuration
  menu (D43: the single home for options). As amended in Part 4, it has
  four controls:
  - *Text size* (Standard / Large / Larger) scales everything the player
    reads (the chronicle, the side panel, the dossier, fates, private
    scenes, the narration log), not the chrome.
  - *Reduce motion* turns off every animation and the gliding scroll, even
    when the device does not ask for less motion.
  - *Show the narration word by word*, turned off, keeps the loom up
    instead of streaming the pen.
  - *Single-key shortcuts* can be turned off (WCAG 2.1.4).

  All four are device preferences (`persistence/readingPrefs.ts`), painted
  on `<html>` as data attributes (absent by default, so a device that never
  chose renders as before) and seeded in `index.html` before first paint.
  The double progress announcement is settled in Part 4.
- **P6, what changed since you last looked.** A pulsing tab now shows how
  many perceived changes landed on it, as a gold coin and in its
  accessible name ("Reports (2 new)"). The count comes from the same
  filtered digest as the pulse (`tabChangeCountsFor`,
  `hooks/usePlayerPerception.ts`), so it can say nothing the Dispatches
  card did not. Personae counts relationship observations only (D36).
- **A command palette** (Ctrl+K / ⌘K, the masthead's Commands button, or
  `?`). It reaches the side panel's seven tabs (with their counts), the
  tablet, a private scene, the narration log, the week's counsel, the
  latest line, Settings and, when on, the GM log. Outside a text field,
  1–7 open the tabs and `/` goes to the tablet. It only reaches
  things, never sets an option (D43), and offers only what can run now.
  Each command presses the same control the player would
  (`app/domCommands.ts`), so every guard on those controls still applies.
  Lazy-loaded like the other overlays.
- **The chat log follows only a reader at the foot**
  (`hooks/useChatFollow.ts`). The old hook scrolled to the bottom on every
  change, yanking a reader who had scrolled back, and never followed the
  streamed narration. Now it follows the pen while you are at the foot,
  always returns you there when you send a week, and otherwise offers "Back
  to the latest" (gold "New in the chronicle" once something has landed).
- **The screen gives the chronicle its height back.** On the game screen
  the masthead is compact (about 40px back). The player's dossier folds to
  its name line (a device preference). The tablet takes the full width of
  the column, with the desk's tools (Private scene, Narration log, GM Log)
  on its mode bar. The week's counsel is a compact, labelled row. The
  Imperial Dispatch bar moved from inline styles to classes, so the night
  skin reaches it. Economic stability gains a five-pip grade meter, and a
  world stat a public 'world' delta moved last week carries a "changed
  this week" mark (UI_SYSTEMS 6.5, partly).

Checks: 2450 unit tests (from 2385), 10 journeys, typecheck, lint with
zero warnings, the deterministic eval and the build all pass. The main
chunk grew by about 11 kB (3.9 kB gzipped); the palette is its own 3.6 kB
chunk. Screenshots: `docs/ui-refresh/16-*.png`.

---

## Part 4 — Design review: open questions settled on best practice (2026-09-28)

The open design questions from Part 3 were settled on design best practice
rather than left open, as this pass was asked to. Each entry names the question,
the answer, the principle it rests on, and how to reverse it. None of these
changes a ruling in `DESIGN_DECISIONS.md`. All new or changed copy is in the
veto queue (`BACKLOG.md`, "Reading, motion and the command palette").

**Turn progress is announced once, by the composer's stage line.** The loom
sat inside the chat log (`role="log"`) as a live region of its own, so a
screen reader heard each stage twice. When the stage line is created at the
same moment as its message, the first stage is often not heard at all.
- *Principle:* one status message, one live region (WCAG 4.1.3). A live
  region must exist before its message arrives (ARIA practice; this repo
  already applies it to the API-key notice).
- *What changed:* the stage line is always in the DOM. It is visually hidden
  and empty while idle. The loom is drawn but not spoken (`aria-hidden`),
  the same call as the streaming bubble beside it.
- *Why this surface:* it lasts the whole turn, in both narration modes (the
  loom gives way to the pen as soon as narration streams). It sits where
  the week was sent. The code already named it the progress voice while
  streaming.
- *To reverse:* restore `role="status"` on `.gor-loom` and conditional
  rendering in `TurnComposer`.

**The character count is no longer a live region.** As one, it
re-announced itself after every keystroke. That is the chatter the GOV.UK
character-count pattern exists to prevent.
- *What changed:* the count still describes the tablet (read with it when
  focused). Within 10% of the limit it is spoken once typing pauses, which
  is GOV.UK's other half, its threshold. Going over the limit or an invalid
  draft still interrupts as an alert.

**On/off preferences are switches, and no two controls share a label.**
Reduce motion, Show the narration word by word, and Single-key shortcuts
are switches. Text size keeps its three-way radio group.
- *Principle:* a binary setting that takes effect at once is a switch
  (NN/g, Apple HIG, Material). Its visible label is its accessible name
  (WCAG 2.5.3). "Reduce motion" is the platforms' own term.
- *What it fixes:* the first cut's "As written" / "Whole" collided with
  Voice style's "As written". A mismatch between the visible label "Keys"
  and the accessible name is also gone.
- *Storage:* the stored values are unchanged, so earlier choices survive.

**The economy meter shows no direction arrow.**
- *Principle:* D26, the system is an honest window. An arrow needs last
  week's value, and none is kept: the pre-turn snapshot lives only in
  session, so an arrow that vanished on reload would be worse than none.
- *What stands:* the level (five pips) and the fact of change (✦ "Changed
  this week") are shown. The Dispatches card says what changed.
- *To add trends honestly later:* a bounded per-week history of the two
  macro values in the save, through the migration registry. That would
  also feed the sparkline in UI_SYSTEMS 6.5.

**Copy speaks the screen's own words.** The palette and the Reading notes
had leaked the code's vocabulary: "registers" for the tabs the onboarding
calls "the side panel", "the desk", "the house".
- *Principle:* recognition over recall, and one name per action (Nielsen
  #2 and #4).
- *Labels match what they press:* Open Settings, Open a private scene,
  Open the GM log. "Back to the latest" is the same words on the palette
  row and the follow button.
- *Grammar:* the placeholder read "a counsel". It is now "Seek a tab, a
  tool or counsel…".
- *Platform wording:* the chord is written ⌘K on Apple devices and Ctrl+K
  elsewhere.

**Keys work on every keyboard layout.** Single keys match the character
typed and ignore Shift: `/` is Shift+7 on German keyboards, and the digits
are shifted on French AZERTY. Ctrl+K falls back to the physical K key when
the layout types another script (Cyrillic, Greek).

**The palette is accessible in the details.**
- Each option is named in words ("Reports, 2 new"), not by its run-together
  text. Its id is its command's, so `aria-activedescendant` changes when a
  search changes the active command, not only when an arrow does.
- The listbox holds only groups and options; the empty state moved outside
  it.
- The number of matching commands is announced once typing pauses (GOV.UK
  autocomplete pattern), never per keystroke. It counts the rows actually
  shown and re-counts when the list changes under the same search. It is
  written into two alternating regions, so a second search with the same
  count is still heard.
- The active row keeps a visible outline in forced-colours mode.
- The search affordance is an inline SVG magnifier. The ❖ glyph had fallen
  back to a bare ◆, which read as ornament on phones, where the button's
  word is hidden.
- The fold chevron shows its name on hover.

**Counsel is set to be read.** The suggestions had shrunk to 11.5px display
capitals. Long all-caps text costs legibility, and these are sentences the
player reads to decide. They now use the body face, in sentence case, at
15px, inside the same pill frame.

**Text size covers everything the player reads.** That means fates, private
scenes (live and archived) and the narration log's words, beside the
chronicle, the side panel and the dossier. The note says the masthead, tabs
and menus keep their size, which is true. A dialog taller than the window
now scrolls from its top instead of being clipped at both ends.
- *Why it matters:* a fate has no close control, so on a short screen, or
  at a larger size, its choices must stay reachable (WCAG 1.4.10).
- *No padding on the backdrop:* the GM console sizes itself against it, and
  padding shrank the console by 32px.

**First visit follows the system's appearance.** A light system opens on
LVX; a dark one, or one that does not say, on NOX. An explicit choice
always wins. Until the player makes one, the lighting follows the system
as it changes. The Lighting control gains "◐ Device": the default for a
device that never chose, and the way back to following the system after
a choice. Without it, following the system would be a one-way door. It is
one exclusive choice of three, so it is a radio group, like Text size. Its
note is its description, and the glyphs stay out of the names ("Device",
"LVX", "NOX"). The pre-paint script reads storage and the system apart, so
blocked storage still follows the system, as the hook does.
- *Principle:* Apple HIG and Material both say to respect the system
  appearance when an app ships both, and to offer "follow the system"
  beside light and dark. People who need light or dark for their eyes
  set it there.
- *Returning players:* the old script stored "nox" on first visit, so they
  keep what they saw.
- *To open every new device on NOX again:* treat a null `gor-theme` as
  'nox' in the `index.html` script and in `resolveLighting`
  (`hooks/useSettings.ts`).

**Switches and segments keep their state in forced colours.** Background
colour was all that told an on switch from an off one, or the chosen
segment from the rest, and forced colours drop it. The state is repainted
in system colours, which survive (checked in Chromium's forced-colours
emulation).

**An independent review.** A reviewer who had not written the code checked
this part against the same standards. It found two minor bugs (the
pre-paint script and the palette count), the gaps listed above, the
backdrop padding's cost to the GM console, and weak spots in the tests. All
are fixed and tested: the pre-paint script now runs in a test against
`resolveLighting`, and test stubs and `<html>` state are reset between
tests.

**The Events tab refusal copy (recommendation only).** Reusing the
dossier's line is right: the same refusal should read the same everywhere
(Nielsen #4, consistency). No change was made; the owner keeps the veto.

Checks after Part 4: 2479 unit tests (from 2450), 10 journeys, typecheck,
lint with zero warnings, the deterministic eval and the build all pass.
Over Parts 3 and 4 together the main chunk grew by about 13 kB (4.5 kB
gzipped); the palette is its own 4 kB chunk. Screenshots:
`docs/ui-refresh/16-*.png` (refreshed) and `17-first-visit-light-system.png`.

## Part 5 — The fan-out audit: every mechanic and the GUI, checked and fixed (2026-09-29)

The owner asked for every mechanic to be checked, the GUI included, to be
sure it works as intended. The check ran as a fan-out: twelve auditors, one
per area, each with its own lens (game rules, knowledge and perception,
state and persistence, the narration voice, and the GUI both live in a
browser and in the code), and an independent skeptic behind each one that
tried to refute every finding before it counted. **122 findings survived**
(some found by more than one auditor). Two need an owner ruling and were
left whole; everything else was fixed.

**How it was fixed.** The fixes ran in six groups, each owning its own
files and working in its own git worktree: rules, design system,
perception and knowledge, voice and private scenes, the desk, and campaign
state. Each group re-confirmed its findings against the code before
changing anything, and added regression tests. A reviewer who had not
written the code then re-traced every repro against each group's commit.
The reviewers found 20 defects (6 of them serious). A follow-up pass fixed
all of them except one, a docs edit, which is made in BACKLOG B7. The six
branches were then merged, and the seams between them fixed and tested
(`tests/auditIntegration.test.ts`).

**What was wrong, in brief** (full records in the `audit-fix/*` commits):
- *Rules.* A survived death save could still ship an "assassinated"
  headline, and it restored an exiled player to "alive". The player's own
  settled fate never reached the narrator. Authored events moved the
  player's trust in a faction instead of the faction's trust in the player.
  An NPC's overdraft was reported to the player as their own treasury.
  Other defects: a malformed scheme could wedge every later turn; a
  relocation whose reason mentioned a killing was read as a death; Rome's
  events fired in generated worlds; the Rhine acclamation fired on an empty
  crisis; off-scale model traits pre-decided rolls; and a suggestion could
  stream into the narration.
- *Perception and knowledge.* A witnessed move read "X is now changed." A
  departure from the player's own room went unwitnessed. A dead NPC could
  still be "sensed plotting". Paid deep analysis vanished on a tab switch.
  One rumour repeated four times read as "4 sources agree". The player's own
  order could reveal a hidden figure's existence. The cap evicted paid
  dossiers first. The Chronicle printed raw submission JSON.
- *Campaign state.* One click on a destiny overwrote a saved reign without
  a word; a newer build's save was hidden and then overwritten. A fate
  awaiting its choice was lost on reload. Retry clobbered an edited draft.
  A keyless send offered a Retry that could not work, and a keyless custom
  destiny fired three doomed requests.
- *Voice and private scenes.* SILENT did not stop a TTS call already in
  flight. A stalled request could wedge a clip for the session. The
  fidelity guard let unmentioned names through mid-sentence. The sixth
  exchange of a long scene always failed. A reply draft carried over to the
  next NPC. Closing a scene left the NPC talking.
- *The desk.* A counsel pill replaced a typed draft. A streaming chunk
  yanked a reader back down. The log announced the player's words twice.
  Tab counts stuck across weeks and disagreed with the palette. The
  Structured tablet squeezed the chronicle to 56px at 1280x720.
- *Design system.* Unstyled buttons had no focus ring, and focus vanished
  in forced colours. Inline animations ignored the device's reduced-motion
  setting. The Settings dialog was clipped on a phone, and the GM console
  was taller than the window. There were contrast failures in both skins,
  and the favicon was missing.

**Calls made on best practice** (each reversible, none changes a ruling):
- *Turn vs Week.* Every stamp that holds a turn counter now reads "Turn";
  only calendar surfaces read "Week" (D44 note of the same date). The
  alternative, a turn-to-week map, would need a new per-turn record that
  old saves lack, so the labels would have been mixed.
- *Death headlines are fixed in the prompt, not by redaction.* Rewriting
  headlines after the roll would take another model call per death claim.
  The adjudicator now phrases a death as the attempt; the residual risk is
  in BACKLOG.
- *Label in name (WCAG 2.5.3).* Controls are named by their visible words
  ("Speak", "Seal & send", "Settings", "Commands"), so a speech-input user
  can say what they see.
- *A seen tab is keyed to the week.* The "N new" memory is held by App per
  committed turn, shared by the tab rail and the palette, and kept on the
  device so a reload does not re-announce it. On a phone the open tab
  counts as seen only once the panel is actually in view.
- *Failure copy lives in one place (D45).* The private scene's notices
  moved into `components/ui/FailureNotices.tsx`, each titled by what failed.

**Left for the owner** (BACKLOG B14): whether the world may act on an idle
player on a no-attempt turn; whether investigations should draw on ground
truth; what a loss band with no loss authored should do; whether a figure's
faction is public; and four smaller design calls. New copy is in the veto
queue ("The fan-out audit's fixes (2026-09-29)"); residuals are listed at
the end of BACKLOG.

Checks after Part 5: 2785 unit tests (from 2479), 10 journeys, typecheck,
lint, the deterministic eval and the build all pass. A live tour on the
merged build (1280x720 LVX, 375px NOX, forced colours) found no console
errors and no 404s, no page scroll in either composer mode, and no raw JSON
in the Chronicle. Screenshots: `docs/ui-refresh/18-*.png`.
