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

**Recommendation:** Use free text inside the field, such as “To the Praetorian prefect: ...”. Do not add an entity selector in the MVP; a selector introduces visibility validation, aliases, groups, unknown actors, and multi-recipient delivery rules.

> **Owner response:**

### Q02 — Must the Game Master explicitly answer every Question or Context entry?

**Recommendation:** Address it when the answer is knowable and relevant; otherwise narrate uncertainty or explain that the character lacks the information. Do not force a separate Q-and-A paragraph every turn.

> **Owner response:**

### Q03 — Which fields should determine whether the turn receives hidden action resolution?

**Recommendation:** Assess the observable attempt in Action and Message or Order. Private Intent may clarify the objective but cannot improve the roll; Question or Context cannot create a consequential roll by itself.

> **Owner response:**

### Q04 — Which downstream AI consumers may see Private Intent?

**Recommendation:** The omniscient adjudicator, narrator, player-monologue generator, and player-only suggested-action generator may see it. NPC minds, relationship updates, apparent-ambition inference, the knowledge store, and perception digests may not. This preserves D5 and D8 while letting the player's motive shape their own story.

> **Owner response:**

### Q05 — How should Private Intent appear in the player's own history?

**Recommendation:** Keep it visible to its author in a clearly labeled, visually private subsection, collapsed after the turn commits. “Private” means unknown in-world, not hidden from the player who wrote it.

> **Owner response:**

### Q06 — What should player-facing copies and exports do with Private Intent?

**Recommendation:** Exclude it by default. A future explicit “include private intent” export may add it after warning the player. GM/debug exports retain the complete artifact for reproducibility.

> **Owner response:**

### Q07 — Should Chat and Structured input normalize into one typed domain contract?

**Recommendation:** Yes: one versioned union with `freeform` and `structured` variants. Freeform text stays freeform rather than being silently mislabeled as Action. Both variants enter the same turn pipeline.

> **Owner response:**

### Q08 — How should structured submissions be added to turn history and saves?

**Recommendation:** Add an optional canonical submission artifact beside the existing required `playerIntent` string. Old version-1 saves normalize legacy `playerIntent` to a freeform submission; no retroactive field guessing and no save-version bump.

> **Owner response:**

### Q09 — What should the mode control be called and where should it live?

**Recommendation:** Use a visible **Chat | Structured** segmented control directly above the input dock. Avoid labels suggesting one mode is strategically stronger.

> **Owner response:**

### Q10 — Should the selected mode persist?

**Recommendation:** Persist the last selected mode as a local UI preference, not campaign state. New users still start in Chat; returning users resume their preferred composer.

> **Owner response:**

### Q11 — What should happen to drafts when the player switches modes?

**Recommendation:** Preserve separate in-session drafts for Chat and Structured. Switching restores the relevant draft; it never guesses a field mapping or flattens Private Intent into plaintext.

> **Owner response:**

### Q12 — What content limit should structured submissions use?

**Recommendation:** Use an 8,000-character combined limit across the four fields. Show remaining characters near the limit and block submission when exceeded. Never truncate silently.

> **Owner response:**

### Q13 — What keyboard behavior should Structured mode use?

**Recommendation:** Enter inserts a newline; Ctrl+Enter or Cmd+Enter submits the artifact. Chat retains its existing Enter-to-submit and Shift+Enter-for-newline behavior.

> **Owner response:**

### Q14 — What should an AI-suggested Action Pill do in Structured mode?

**Recommendation:** Fill the Action field without submitting or inventing speech, motive, or context. If Action already contains text, require confirmation before replacement. Pills never switch modes automatically.

> **Owner response:**

### Q15 — What exactly should Retry resend?

**Recommendation:** One-click Retry resends the immutable normalized artifact from the failed attempt. Restoring and editing the fields creates a new submission attempt. Preserve the same submission ID for exact retry and use a distinct attempt ID to prevent ambiguous duplicate commits.

> **Owner response:**

### Q16 — What data may generate a player-facing relationship observation?

**Recommendation:** Only perception-filtered events, sourced reports, investigation results, direct interactions, and stable public facts the player knows. Hidden relationship values may drive mechanics but may never generate or select player-facing prose.

> **Owner response:**

### Q17 — What should one relationship observation look like?

**Recommendation:** Use a short behavioral statement with source and age, such as “Turn 7 — witnessed: Sabinus defended your proposal before the Senate.” Preserve contradictory observations separately rather than resolving them into an engine verdict.

> **Owner response:**

### Q18 — Which forms of synthesized relationship interpretation are prohibited?

**Recommendation:** Prohibit numbers, bars, directional arrows, heat colors, confidence percentages, tiers, and summaries such as “hostile,” “trusting,” or “uneasy ally” when they encode hidden sentiment. Stable public roles such as kinship, office, or faction may still appear as factual context.

> **Owner response:**

### Q19 — Should the MVP include player-authored private notes about NPCs?

**Recommendation:** No. Notes align with player-authored interpretation, but add persistence, editing, search, and export policy. First test whether sourced observations alone provide enough support; add notes later as a separately scoped feature if they do not.

> **Owner response:**

### Q20 — What evidence is required before this feature may merge?

**Recommendation:** Require pure-helper tests for normalization and projections; sentinel leak tests across every forbidden Private Intent consumer; legacy-save and retry tests; mixed Chat/Structured journey coverage; accessibility checks; full CI; independent code review; adversarial privacy review; and an interactive browser smoke. Any private-field leak, mode-specific mechanical advantage, silent truncation, incompatible save, or duplicate commit blocks release.

> **Owner response:**

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
