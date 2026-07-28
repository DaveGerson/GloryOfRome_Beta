# Phase 6 Player Input and Observability Grill

**Purpose:** This is the short owner-decision workbook for the structured turn composer and the replacement of numeric relationship reads with player-observable evidence.

**Timebox:** 5–10 minutes. There are exactly 20 questions. Answer by writing beneath `Owner response`; `Accept recommendation` is sufficient. Any follow-up questions created by these answers will go into a separate addendum rather than expanding this first pass.

**Status:** Working decision artifact. Blank response blocks are intentional. David's Git diff becomes the response packet for the next design pass.

**Scope boundary:** This document authorizes no mechanics implementation. Confirmed answers will first be promoted into `roadmaps/DESIGN_DECISIONS.md`, then translated into a separate TDD implementation plan.

---

## Settled rulings

These are already decided and do not need another response unless David wants to reverse one.

1. Plaintext chat remains the default input.
2. A toggle switches between Chat and Structured composition.
3. The MVP supports one submission per turn, not multiple queued submissions.
4. Structured input is still one chat response. It provides clarity, not extra powers, actions, information, or favorable resolution.
5. Structured mode has four optional fields, with at least one required:
   - **Action** — what the character physically or politically attempts.
   - **Message or Order** — what the character communicates and, in the prose, to whom.
   - **Private Intent** — the player's unspoken purpose, motive, or desired outcome.
   - **Question or Context** — what the player wants the Game Master to address or account for, without automatically making it spoken dialogue.
6. Any valid submission advances one turn, including a private-intent-only or question-only submission.
7. Private Intent is adjudicator context only. It cannot act, speak, establish facts, change what an NPC knows, or independently improve success.
8. Player-facing relationship numbers and bars should become observations and signals. The player supplies the interpretation.
9. Hidden relationship values remain available to mechanics and the GM console; they are not deleted from the simulation.

---

## Non-negotiable engineering boundaries

These are architecture invariants, not questions.

- Gemini calls remain behind `ai/core/geminiService.ts`; model IDs are never hardcoded at call sites.
- Prompt text remains in `ai/prompts/`, and any prompt/output-schema changes land together and update the prompt inventory.
- Player-facing data remains perception-filtered. Raw deltas, `gm_private`, `secret_truth`, out-of-sight state, dice, resolution tiers, and traces stay off player surfaces.
- Only player death is terminal. This feature creates no win state, quest log, or declared ambition.
- Save version 1 remains compatible through optional fields unless a version bump is deliberate. Committed state flows through `buildSaveState`.
- Structured mode cannot change action economy, odds, time passage, NPC activity, mortality, or event behavior.
- Private Intent must have explicit full and observable projections. It cannot be concatenated into one generic string that every AI consumer receives.
- The final gate remains typecheck, lint, unit tests, journey tests, build, independent review, adversarial privacy review, and interactive smoke.

---

## Twenty decisions

### Q01 — How should recipients work in Message or Order?

> **Owner response:**
Create a set of fields that list the recipient and the command. This should have a single line to start but have a + button that allows more to be added.


### Q02 — Must the Game Master explicitly answer every Question or Context entry?

> **Owner response:**
If the user specifically requests to explore something, the game master should provide a response to that question from the viewpoint of the user themselves.  Thinking about the role-playing aspect of it, the players avatar in the game would try to discern an answer to their questions and motivations, however that doesn't mean the game master should take agency to act on behalf of a player to have their avatar explore their question.

### Q03 — Which fields should determine whether the turn receives hidden action resolution?

**Recommendation:** Assess the observable attempt in Action and Message or Order. Private Intent may clarify the objective but cannot improve the roll; Question or Context cannot create a consequential roll by itself.

> **Owner response:**
I agree with the recommendation.  As a general design principle.  The world and the actual state of actions exists as an "objective" fact, but the players perception of it occurs from their viewpoint.

### Q04 — Which downstream AI consumers may see Private Intent?

**Recommendation:** The omniscient adjudicator, narrator, player-monologue generator, and player-only suggested-action generator may see it. NPC minds, relationship updates, apparent-ambition inference, the knowledge store, and perception digests may not. This preserves D5 and D8 while letting the player's motive shape their own story.

> **Owner response:**
The recommendation holds and follows our system guidelines.  NPC's can develop their own perceptions of a players intent and motivations, but they should have no visibility into what a player is actually planning.

### Q05 — How should Private Intent appear in the player's own history?

**Recommendation:** Keep it visible to its author in a clearly labeled, visually private subsection, collapsed after the turn commits. “Private” means unknown in-world, not hidden from the player who wrote it.

> **Owner response:**
Agreed

### Q06 — What should player-facing copies and exports do with Private Intent?

**Recommendation:** Exclude it by default. A future explicit “include private intent” export may add it after warning the player. GM/debug exports retain the complete artifact for reproducibility.

> **Owner response:**
I don't follow why this matters.  The exports and copies are just logging artifacts and aren't material to the gameplay.  Not sure it matters at all.

### Q07 — Should Chat and Structured input normalize into one typed domain contract?

**Recommendation:** Yes: one versioned union with `freeform` and `structured` variants. Freeform text stays freeform rather than being silently mislabeled as Action. Both variants enter the same turn pipeline.

> **Owner response:**
Agree, one file passed in and out.  In general though we should be cautious to ensure that this artifact is robust enough to express the purpose of each structured component, but that we don't needlessly burn too many tokens.

### Q08 — How should structured submissions be added to turn history and saves?

**Recommendation:** Add an optional canonical submission artifact beside the existing required `playerIntent` string. Old version-1 saves normalize legacy `playerIntent` to a freeform submission; no retroactive field guessing and no save-version bump.

> **Owner response:**
The structured submission should be convertible into plain text (it needs to be read in by an LLM anyways). We should just save it as plain text with that structure included in it.

### Q09 — What should the mode control be called and where should it live?

**Recommendation:** Use a visible **Chat | Structured** segmented control directly above the input dock. Avoid labels suggesting one mode is strategically stronger.

> **Owner response:**
Yes a toggle next to the chat window that allows the response type to switch would be ideal.

### Q10 — Should the selected mode persist?

**Recommendation:** Persist the last selected mode as a local UI preference, not campaign state. New users still start in Chat; returning users resume their preferred composer.

> **Owner response:**
Recco holds with the caveat that this is an MVP so we shouldn't make an overcomplicated set-up

### Q11 — What should happen to drafts when the player switches modes?

**Recommendation:** Preserve separate in-session drafts for Chat and Structured. Switching restores the relevant draft; it never guesses a field mapping or flattens Private Intent into plaintext.

> **Owner response:**
Recco holds, it's easy enough.  once a submission occurs we don't needd to retain the draft though.

### Q12 — What content limit should structured submissions use?

**Recommendation:** Use an 8,000-character combined limit across the four fields. Show remaining characters near the limit and block submission when exceeded. Never truncate silently.

> **Owner response:**
I think it needs to be closer to 20k though (since we are measuring in tokens rather than characters).  In general we should target a 50 turn game with the assumption there is some level of context compaction that will be added in during later phases to stretch

### Q13 — What keyboard behavior should Structured mode use?

**Recommendation:** Enter inserts a newline; Ctrl+Enter or Cmd+Enter submits the artifact. Chat retains its existing Enter-to-submit and Shift+Enter-for-newline behavior.

> **Owner response:**
Recco holds

### Q14 — What should an AI-suggested Action Pill do in Structured mode?

**Recommendation:** Fill the Action field without submitting or inventing speech, motive, or context. If Action already contains text, require confirmation before replacement. Pills never switch modes automatically.

> **Owner response:**
It should fill in the action field, but potentially (similar to message or order) multiple actions may be possible, so clicking an action toggle would add an "action"  but the other action pills should remain allowing a user to add multiple.

### Q15 — What exactly should Retry resend?

**Recommendation:** One-click Retry resends the immutable normalized artifact from the failed attempt. Restoring and editing the fields creates a new submission attempt. Preserve the same submission ID for exact retry and use a distinct attempt ID to prevent ambiguous duplicate commits.

> **Owner response:**
Retry should fully retry the action but in general at this stage in the development lifecycle a usage audience of 1 might be enough.

### Q16 — What data may generate a player-facing relationship observation?

**Recommendation:** Only perception-filtered events, sourced reports, investigation results, direct interactions, and stable public facts the player knows. Hidden relationship values may drive mechanics but may never generate or select player-facing prose.

> **Owner response:**
Any interaction between a player and another player, NPC, or object that provides information about that relationship in a meaningful way.

### Q17 — What should one relationship observation look like?

**Recommendation:** Use a short behavioral statement with source and age, such as “Turn 7 — witnessed: Sabinus defended your proposal before the Senate.” Preserve contradictory observations separately rather than resolving them into an engine verdict.

> **Owner response:**
Rather than trying to clarify in language I'll use a few examples below
- At the most recent ir'Tain Gala, Clodius seemed to intentionally avoid your gaze
- You received an incredibly expensive gift from Senator Lucius to celebrate the birth of your son
- Caius' widow and Maximus were seen talking in a huddled corner at the funeral, both were smiling more than you would anticpate at such a somber event

### Q18 — Which forms of synthesized relationship interpretation are prohibited?

**Recommendation:** Prohibit numbers, bars, directional arrows, heat colors, confidence percentages, tiers, and summaries such as “hostile,” “trusting,” or “uneasy ally” when they encode hidden sentiment. Stable public roles such as kinship, office, or faction may still appear as factual context.

> **Owner response:**
I agree to stating public roles but also include direct statements from an entity about a player (e.g. public praise/condemnation, direct statements of affection) use quotes for this.  Allow for a "blow-out" into a timeline of relationship observations since this may not always be filled out.


As a note.  If a key entity (NPC/Faction) is playing but the player has no observation of them yet, their should be a capability to hide them from the user (e.g. a foreign diplomat is supporting a bid for the throne, a senator you had killed actually lived and is is plotting against you in the shadows)

### Q19 — Should the MVP include player-authored private notes about NPCs?

**Recommendation:** No. Notes align with player-authored interpretation, but add persistence, editing, search, and export policy. First test whether sourced observations alone provide enough support; add notes later as a separately scoped feature if they do not.

> **Owner response:**
No need for notes in an MVP that aren't part of provided agent context.  A player can keepp those as pen and paper.

### Q20 — What evidence is required before this feature may merge?

**Recommendation:** Require pure-helper tests for normalization and projections; sentinel leak tests across every forbidden Private Intent consumer; legacy-save and retry tests; mixed Chat/Structured journey coverage; accessibility checks; full CI; independent code review; adversarial privacy review; and an interactive browser smoke. Any private-field leak, mode-specific mechanical advantage, silent truncation, incompatible save, or duplicate commit blocks release.

> **Owner response:**
A set of unit tests that validate all functionality that can be validated and all features and stories developed have validation that they actually exist and were built according to spec (rather than mock or given a hand-wavey pass)

---

## Default implementation details

These details follow from the settled rulings and recommendations above. They do not need individual answers unless David wants to override one.

- Structured mode is one artifact and one turn, even when several fields contain text.
- All four fields are optional, multiline, trimmed, and omitted from the artifact when blank; at least one meaningful field is required.
- Field order is Action, Message or Order, Private Intent, Question or Context everywhere.
- Exact authored text is preserved after surrounding-whitespace normalization. The system does not rewrite the draft before submission.
- Actions and orders are attempts, not declarations of success or compulsory obedience.
- Multiple linked steps and recipients are permitted in prose; adjudication may resolve only what is feasible and must explain partial completion.
- Private Intent may state a desired outcome, but only as a hope. It grants no concealment, fact, action, or modifier.
- Question or Context may not establish canon or bypass the player's knowledge boundary.
- The player card renders only nonempty fields. Freeform history retains its existing single-bubble appearance.
- Structured fields, the mode control, and submission controls are disabled while a turn is processing.
- Successful commit clears the submitted mode's draft. Failure restores the exact structured draft and commits no game state.
- Drafts do not survive browser refresh in the initial MVP; adding persistent private draft storage requires a separate privacy decision.
- Mandatory event choices remain their own input contract and do not expose the Structured composer.
- Relationship observations show evidence, provenance, and age. “No recent observations” never implies a neutral relationship.
- Personae shows a compact recent set; a future relationship map and dossier reuse the same perception-safe observation model.
- The GM console retains full structured submissions, hidden relationship values, rolls, traces, and ground truth.

---

## Answer-dependent addendum rule

The next pass may create an addendum only when an owner response introduces a new branch that cannot be safely derived. Examples include choosing a recipient selector, allowing AI access to player notes, or changing the privacy/export boundary. The addendum will:

- contain only the newly necessary questions;
- remain capped at 20 questions and a 5–10 minute timebox;
- cite the answer that created each follow-up;
- never mix its questions into implementation logs or subagent output.

## Promotion after David's diff

1. Read the diff as the answer packet.
2. Identify any direct contradiction with the settled rulings or architecture invariants.
3. Create a small addendum only if a response genuinely opens a new design branch.
4. Promote confirmed gameplay rulings into `roadmaps/DESIGN_DECISIONS.md`.
5. Produce the full/observable/player-history data-flow matrix.
6. Write the TDD implementation plan and sequence independent UI tasks only after the decisions are closed.
