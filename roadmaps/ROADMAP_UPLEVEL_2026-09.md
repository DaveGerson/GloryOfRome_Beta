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
| P5 | **Reading and motion settings**: text size, reduced motion, streaming off, progress announcements. | Also settles the double progress announcement noted in the UI track. | 3 d |
| P6 | **Per-tab "what changed since you last looked"** counts instead of the pulse dot. | Turns the intel panel into a to-do list and helps screen-reader users. | 3–4 d |
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
- **The Events tab refusal copy** reuses the dossier's line word for word.
  It is new on this screen, so it goes in the veto queue.
- **NOX as the default theme.** Is the night skin the right first
  impression? To revert, delete the one small script block in `index.html`.
- **CI check names changed** from `ci` to `verify:static`, `verify:unit`
  and `verify:integration`. Update branch protection if it requires `ci`.
