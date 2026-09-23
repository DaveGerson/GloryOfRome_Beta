# Eval harness

Offline consumer of the GM console's eval corpus export
(`persistence/evalCorpus.ts`, DESIGN_DECISIONS.md D18). It replays and
checks a recorded session without touching the app: deterministic checks
need no API key at all; the LLM judge runs only when one is provided.

Nothing in `eval/` is imported from app code - it consumes the app's
shared seams (`ai/core/zodSchemas.ts`, `ai/core/json.ts`,
`ai/core/resolution.ts`, `ai/core/geminiService.ts`) one-way, so the app
bundle never carries it and `npm test` never runs it.

## Exporting a corpus

1. Play a session (real mode - mock-mode turns capture nothing).
2. Open the GM console and press **Export Eval Corpus**
   (`components/GameMasterScreen.tsx`).
3. The browser downloads `gor-eval-corpus-turnN.json` - the session's
   captured turns (prompts, responses, seeds, traces) plus the
   session-wide out-of-band call log.

## Running

From `roman_crisis_simulation/src`:

```sh
# Deterministic checks only (fully offline):
GOR_EVAL_CORPUS=/path/to/gor-eval-corpus-turnN.json npm run eval

# Deterministic checks + LLM judge (one flash call per turn):
GOR_EVAL_CORPUS=/path/to/gor-eval-corpus-turnN.json GEMINI_API_KEY=... npm run eval
```

Without `GOR_EVAL_CORPUS` everything skips with a pointer; without
`GEMINI_API_KEY` only the judge leg skips. The runner is
`eval/runEval.eval.ts`, executed under `vitest.eval.config.ts` - the
`*.eval.ts` naming keeps it out of the default `*.test.ts` glob, so the
normal `npm test` suite is unaffected either way.

`npm run eval:ci` is the pinned, always-offline variant that CI and
`npm run verify` run: `vitest.eval-ci.config.ts` sets `GOR_EVAL_CORPUS`
to the committed `eval/fixtures/ci-corpus.json` and forces
`GEMINI_API_KEY` empty, so it never makes a model call even on a machine
with a key exported.

## What the deterministic checks report (`eval/harness.ts`)

Per turn:

- **Schema validity** - each captured call's `rawResponse` is re-parsed
  (same cleaning as the live service) and re-validated against its call
  family's zod schema via an explicit callName -> schema map. Prose calls
  (narration, monologue, clarification, deep analysis, epilogue) are
  skipped. Historical corpora may contain the retired `rawThoughts` family;
  it is accurately reported as `skipped_unknown`, rather than failed,
  because the current runtime no longer emits it. A response that was
  truncated at capture time (~20k chars) shows up as `unparseable_json` -
  the corpus no longer carries enough text to re-check it.
- **Consequence-density proxies** - delta count and headline count.
- **Capture completeness** - how many calls carry full prompt text /
  system instruction, and whether the turn's seed was recorded.
- **Roll reproducibility** - where a seed and traces exist, the turn's
  hidden rolls are re-derived via `createSeededRng` and compared
  draw-for-draw. Draw order mirrors `ai/core/turn.ts`: the player action's
  resolution roll first (consequential turns only), then each mortality
  roll in claim order (invalidated claims never rolled, so they consume no
  draw).

Plus a schema-validity pass over the session-wide call log - the only
channel carrying out-of-band calls (ad-hoc investigations, clarifications,
deep analysis, ambition inference, the epilogue). Turn-bracketed calls
appear there too, so its counts overlap the per-turn ones; they are
reported separately.

The checks **report, they don't gate**: violations and mismatches are
printed for a human to read. The only hard failure is a file that isn't a
corpus export at all.

## The LLM judge (`eval/judge.ts`)

Scores each turn 1-5 (+ rationale) on five fixed axes: consequence-density,
sim-state consistency, schema validity, information-asymmetry
discipline (did anything reach a player surface its viewer could not
know), and character richness (do NPC actions read as motivated by their
own bounded knowledge, memories, intents, and voice - continuity of self
rather than plot convenience). Prompt: `ai/prompts/evalJudge.ts`; schemas:
`EvalJudgeVerdictSchema` / `zEvalJudgeVerdict`. The judge sees GM-private
ground truth by design - that is what the asymmetry axis checks against -
and its scores are advisory tuning signal only: the judge is itself
unvalidated and gates nothing.

Golden turns for calibrating the judge come from owner-played sessions
(D18) and are not part of this harness yet - there is no golden-set
comparison logic here.
