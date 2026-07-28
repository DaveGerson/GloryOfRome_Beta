# Task 2 disposition map — `tests/playerBoundary.test.ts`

Companion to `tests/playerBoundaryContract.test.ts` (the Task 2 red suite) and
`docs/superpowers/plans/2026-07-28-schema-declared-attribution.md`. For every
block of the existing suite: **PORT** = still meaningful after the
declaration-primary rewrite (keep, possibly re-anchored on the tripwire);
**RETIRE** = tests a deleted mechanism (cited per row). Line numbers refer to
the file as of commit 66cd8e4. The old file is UNEDITED at this stage; this map
is applied when the implementation lands (plan step 2.3/2.4).

Legend for the retired machinery (all deleted per the approved plan):
`splitSubordinateClauses`, `possessedPhrasePredicate`/`possessedHeadPredicate`,
`ClauseScope`/anaphora sets, passive-agent scanning
(`passiveAgentPattern`/`OBLIQUE_FIRST_PERSON_PASSIVE_AGENTS`),
`POSSESSED_CONDITION_PREDICATE`, `STATE_ADJECTIVES` apparatus,
`PLAYER_OBJECT_PREDECESSORS`, `containsPlayerAttributedAction` and its
per-part `and`/`but`/`that` subject inheritance.

| # | Block (describe → sub-block) | Lines | Disposition | Rationale |
|---|---|---|---|---|
| 1 | `player-visible mechanics boundary` — entire describe (token/dice/tier rejection, presentation wrappers, stream gate, casualty-prose acceptance, GM-only mechanics) | 22–138 | **PORT** | Hidden-mechanics half is untouched by the refactor. Keep verbatim. |
| 2 | `no-attempt player ownership boundary` → "fails closed on an unowned player-subject predicate" — sentence-initial subject rows: `'Gaius Testus signs the decree.'`, `'The Emperor votes with the optimates.'`, `'You meet the legate at dawn.'`, `'The player refuses the petition.'`, `'The avatar flees the Forum.'`, the five `'I …'` rows | 147–177 (subset) | **PORT** | Sentence-initial player subject + non-allowlisted head verb — exactly the tripwire register. Re-anchor on `tripwireFlagsPlayerConduct` / kept shells. |
| 3 | same it.each — grammar rows: `'The decree is signed by you.'`, `'At dawn you sign the decree.'`, `'A messenger reports that you sign the decree.'`, `'You see the courier and dispatch guards.'`, `'You do not sign but dispatch spies.'`, `"You'll dispatch spies."`, `'Your guards arrest the envoy.'`, `'Before sunrise I summon the Senate.'` | 147–177 (subset) | **RETIRE** | Passive-agent scan (`signed by you`), mid-sentence subject scan (`At dawn…`, `Before sunrise…`), `that`-clause part split, `and`/`but` subject inheritance, possessive phrase classification (`Your guards…`) — all deleted. `"You'll dispatch spies."` awaits the will/would modal decision (see IMPLEMENTER NOTES in the red suite). Declaration owns these registers now; the contract suite pins the flat-scan bounds. |
| 4 | → "allows an explicit non-action, observation, cognition, state, or intention" | 179–199 | **PORT** | The legal no-attempt register — these are the tripwire's FALSE cases and the curated allowlists survive as flat data. |
| 5 | → observable-attempt bypass | 201–203 | **PORT** | Gate inertness on attempt turns is unchanged contract. |
| 6 | → remove_entities player-alias rows | 205–211 | **PORT** | Structural half (`valueRemovesPlayer`/`assertNoPlayerRemoval`), kept verbatim. |
| 7 | → NPC-authored rumor about the player allowed | 213–231 | **PORT** | `playerOwnsDelta` rumor-origin rule, kept verbatim. |
| 8 | → player-originated rumor rejected | 233–250 | **PORT** | Same. |
| 9 | → DEBT HAS TEETH: world-driven dependency_level allowed | 258–277 | **PORT** | `WORLD_DRIVEN_RELATION_ATTRIBUTES` ownership rule, kept verbatim. |
| 10 | → still rejects player-owned deltas (player-origin dependency, trust keyed under player, player resource) | 279–302 | **PORT** | `playerOwnsDelta` key-root/origin rules, kept verbatim. |
| 11 | → prose/structural split: non-player-origin rumor with player-acting prose no longer fails the turn | 309–321 | **PORT** | The consequence split (structural throws, prose redacts) survives; only the prose classifier inside changes. |
| 12 | → still rejects a no-attempt entityAction bearing the player id | 323–333 | **PORT** | Structural identity-slot gate, kept verbatim. |
| 13 | `no-attempt title-collision prose boundary` → third party styled by the player's shared title allowed; player acting by name rejected; shared title still matches in identity slots | 352–368 | **PORT** | `SHARED_TITLE_POSITIONS` / `proseSubjectAliases` / `samePlayerIdentity` all survive as flat data; the tripwire inherits the same alias rules (re-pinned in the contract suite). |
| 14 | → possessive condition allowed (`'The Emperor's grip weakens.'`, `'Your grip weakens.'`) | 370–380 | **PORT** | Still-legal prose (now trivially so: the tripwire never fires on possessives). Keep as non-firing pins. |
| 15 | → rejects possessive agent/contraction/instrument rows (`'The Emperor's guards arrest…'`, `'The Emperor's marching…'`, `'The Emperor's army weakens the walls…'`) | 382–390 (subset) | **RETIRE** | `possessedPhrasePredicate`/`POSSESSED_VERBAL_REMNANT`/possessed-instrument classification deleted. Declaration territory. |
| 16 | → same it.each, row `'The Emperor votes with the optimates.'` | 382–390 (subset) | **PORT** | Sentence-initial unique-title subject — tripwire register (already re-pinned in the contract suite). |
| 17 | → subordinate-clause-laundered possessive actions rejected | 397–404 | **RETIRE** | `splitSubordinateClauses` deleted. |
| 18 | → genuine possessive condition with trailing subordinate clause allowed | 406–412 | **PORT** | Still-legal prose; trivially silent under the tripwire. Cheap keep. |
| 19 | → subordinator-headed possessed phrase rejected (`'Your as-yet-unnamed heir seizes…'` etc.) | 421–431 | **RETIRE** | `DANGLING_POSSESSIVE_OPENERS`/possessed-phrase machinery deleted. |
| 20 | → additional intransitive condition verbs allowed (`'Your health fails.'` …) | 433–442 | **PORT** | Still-legal prose; trivially silent under the tripwire. Cheap keep. |
| 21 | `no-attempt subordinate-clause classification boundary` — entire describe (comma-less laundering, anaphoric third-person possessors, DECLARED GAP 1 blocks, widened subordinators, severed possessives, article-headed modifiers) | 445–616 | **RETIRE** | Tests `splitSubordinateClauses`, `possessedHeadPredicate`, `POSSESSED_CONDITION_PREDICATE`, and the `ClauseScope` anaphora sets wholesale — all deleted. The DECLARED GAP 1 sentences are superseded: both B7 gap sentences are first-class contract cases in `playerBoundaryContract.test.ts` (tripwire-silent; closed/passed by declaration). Retire with a comment pointing at the spec. |
| 22 | `no-attempt possessive/subject clause precedence boundary` — object-position possessives, HOLE-A/HOLE-B matrices, anaphoric object determiners, quoted-action + trailing condition, oblique first-person passive (`'…burned by me.'`), possessive-passive gap docs, negated/object-position obliques, inert dual-role clauses | 618–801 (all except row 23) | **RETIRE** | Tests `playerClausePredicate` dual-role precedence, `playerPossessivePredicate`, passive-agent scanning, and `PLAYER_OBJECT_PREDECESSORS` — all deleted. The possessive-passive "documents the unclosed gap" block (B7 gap 2) is superseded by the declaration contract. |
| 23 | → same describe, bare-sentence rows: `'You burned your granary.'`, `'You seized your treasury.'`, `'You poisoned your wine.'`, `'You murdered your rival.'`, `'I burned your granary.'`, `'Gaius Testus burned his granary.'`, `'The Emperor seized his treasury.'` | 707–715 | **PORT** | Sentence-initial player subject + conduct verb — pure tripwire register (representatives already re-pinned in the contract suite). |

## Summary

- **PORT: 16 blocks** — hidden-mechanics half (1), ownership/structural/DEBT
  mechanics (6), consequence split (1), legal no-attempt register (1),
  observable-attempt bypass (1), title/alias rules (2), still-legal possessive
  prose pins (3), tripwire-register reject rows salvaged from grammar suites (1
  aggregate: rows in #2, #16, #23).
- **RETIRE: 7 blocks** — two whole describes (#21, #22) plus five sub-blocks
  (#3, #15, #17, #19, and the modal-future row noted in #3), all citing deleted
  machinery: subordinate-clause splitting, possessive phrase classification,
  anaphora scopes, passive-agent scanning, object-predecessor role
  classification, and per-part subject inheritance.
- The two B7 gap sentences (DECLARED GAP 1, possessive passive-agent gap) do
  not lose coverage: they move from "documented accepted gap" in the retired
  blocks to first-class declaration-contract cases in
  `tests/playerBoundaryContract.test.ts`.
