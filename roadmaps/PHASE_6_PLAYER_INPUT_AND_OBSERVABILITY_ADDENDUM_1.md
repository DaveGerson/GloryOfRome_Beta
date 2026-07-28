# Phase 6 Player Input and Observability Grill — Addendum 1

**Why this exists:** Q12 changed the proposed input limit from 8,000 characters to “closer to 20k,” but did not establish the unit and the response ends mid-sentence. The implementation can be planned, but its validation boundary cannot be tested until this is explicit.

**Timebox:** About two minutes. This addendum contains two questions.

## A01 — What exact maximum applies to one structured turn submission?

**Recommendation:** Use **20,000 characters across the entire submitted artifact**, displayed to the player as a character count. This is roughly 5,000 tokens for typical English prose, requires no model-specific tokenizer or API call, fails locally before submission, and keeps the future 50-turn context-compaction problem separate from the size of one turn.

If you instead intend **20,000 model tokens for one turn**, say whether the MVP should enforce that through a conservative local estimate or through Gemini token counting. Exact provider token counting would require a new service-layer call and add latency to composition.

> **Owner response:**
20,000 characters across the entire submitted artifact.

## A02 — How should the player identify a recipient in Message or Order?

**Initial recommendation:** Use a **free-text recipient field** on each row for the MVP. This supports named people, offices, groups, aliases, and unknown intermediaries without exposing the hidden entity roster through autocomplete. The adjudicator resolves the intended recipient from the authored text.

If you instead intend an entity selector, the next addendum must define which known entities appear, how aliases and groups resolve, and how the control avoids revealing actors the player has not discovered.

> **Owner response:**
Use an entity selector populated only from entities known to the player, with a “Someone else…” option that opens a free-text recipient field.

**Resolved implementation:** Populate the selector only from the perception-safe known-entity read model. “Someone else…” stores authored free text and never queries or autocompletes from the hidden roster.
