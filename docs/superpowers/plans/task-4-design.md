# Task 4 design — the declaration gate wired through the turn pipeline

Status: ACCEPTED (TDD red suite: `tests/turnActorsGate.test.ts`). Spec:
`docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md`.
Predecessors: Task 1 (`ai/core/actorsBoundary.ts`), Task 2
(`ai/core/playerBoundary.ts`, contract pinned in
`tests/playerBoundaryContract.test.ts`), Task 3 (prompts, commit 8d14c91).

## 1. DECISION — narration: structured-output streaming with incremental text extraction

Narration becomes ONE `generateContentStream` call in JSON mode
(`responseMimeType: application/json`, `NarrationPayloadSchema` +
`zNarrationPayload` — both already landed, unwired). The raw JSON accumulates
chunk by chunk; a pure extractor returns the decoded prefix of the top-level
`"text"` string value seen so far; that prose prefix feeds the EXISTING gate
chain byte-for-byte unchanged (`createNarrationStreamGate` →
`createPlayerVisibleStreamGate` → `onNarrationChunk`). At stream end the full
raw text goes through `parseModelJson` + zod → `{ text, actors }`. `text`
still carries the `\nSUGGESTION:` lines exactly as today (they decode from
`\n` escapes before the marker check), so the suggestion split and both
stream gates are untouched; `actors` feeds the declaration gate before
commit.

### Constraint analysis

| Constraint | How it is met |
|---|---|
| (a) streaming UX preserved | The extractor releases decoded prose incrementally as the JSON `text` value streams. Prototype: the bubble received multiple increments across adversarial chunk splits, never one final blast. |
| (b) exactly ONE provider call | The same stream yields both the prose and the declaration. The non-streaming path (no `onNarrationChunk`) is one `generateStructured` call with the same schema pair. No repair-retry on the streaming path (below), so one call stays one call. |
| (c) final actors through the gate | The zod-validated payload's `actors` goes to `redactInventedPlayerProseFromValue(payload.text, player, hasObservableAttempt, 'narration', payload.actors)` — the Task 2 value shell's declared mode. |
| (d) stream-gate protections not weakened | Identical gates run over identical (decoded) prose. `\n` escapes decode before the `\nSUGGESTION:` marker check; the mechanics gate still throws on the first completed unsafe sentence; `finish()` revalidation and the redacted-final re-release are unchanged. |

### Why the losers lost

- **Plain-text stream + structured tail (fenced JSON actors block):** the
  declaration would be the only interchange field NOT schema-enforced. A
  model that omits or malforms the fence forces a choice between failing the
  turn on a formatting slip or silently degrading to tripwire-only — which
  reopens B7 exactly where the model is least reliable. It also needs new
  marker-buffer logic in the stream gate for the fence, has no repair path
  without a second call, and strands the already-landed
  `NarrationPayloadSchema`/`zNarrationPayload` plus the prompt teaching.
- **Second, attribution-only call after a plain text stream:** violates (b).
- **Non-streaming structured call + simulated typing:** violates (a) — the
  bubble decouples from the provider and total latency rises by the full
  generation time before the first character shows.

### Prototype evidence (risky part de-risked before commitment)

Scratch suite (mocked `@google/genai` transport with the real
`GeminiClient.generateContentStream` chunk item shape `{ text?: string }`;
real parsing code path: cumulative accumulation → extractor →
`createNarrationStreamGate` → `createPlayerVisibleStreamGate`):

```
✓ tests/__scratchJsonProsePrototype.test.ts (7 tests) 7ms
  Test Files  1 passed (1) / Tests  7 passed (7)
```

Cases proven: chunk split mid-key (`{"te|xt"`); key-order independence
(`actors` before `text`); escaped quotes; `\uXXXX` split mid-escape
(withheld until complete, then decoded); trailing lone backslash withheld;
`"text"` as a VALUE of another key, as a nested key, and inside the actors
array all ignored (depth-1 keys only); leading fence junk tolerated;
full-chain: released increments never contained `{`, `"text"`, or
`SUGGESTION`, last release equals the exact prose, and the final raw text
parses to the payload. The scratch file was deleted after the run; the
reference implementation is reproduced below for the implementer.

```ts
/** Decodes a (possibly incomplete) JSON string body. A trailing incomplete
 * escape (`\` alone, or `\u` with <4 hex digits) is WITHHELD. */
function decodeJsonStringPrefix(raw: string): string {
  let out = '';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (c !== '\\') { out += c; i++; continue; }
    if (i + 1 >= n) break; // trailing lone backslash - withhold
    const e = raw[i + 1];
    switch (e) {
      case '"': out += '"'; i += 2; break;
      case '\\': out += '\\'; i += 2; break;
      case '/': out += '/'; i += 2; break;
      case 'b': out += '\b'; i += 2; break;
      case 'f': out += '\f'; i += 2; break;
      case 'n': out += '\n'; i += 2; break;
      case 'r': out += '\r'; i += 2; break;
      case 't': out += '\t'; i += 2; break;
      case 'u': {
        if (i + 6 > n) return out; // incomplete \uXXXX - withhold
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { i += 2; break; }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        break;
      }
      default: out += e; i += 2; break; // lenient on unknown escapes
    }
  }
  return out;
}

export function extractPayloadTextPrefix(cumulativeRawJson: string): string {
  const s = cumulativeRawJson;
  const n = s.length;
  let i = 0;
  while (i < n && s[i] !== '{') i++; // tolerate leading junk/fence
  if (i >= n) return '';
  i++;
  let depth = 1;
  let expectKey = true;    // at depth 1: the next string is a KEY
  let captureNext = false; // the next depth-1 VALUE is the text payload
  while (i < n) {
    const c = s[i];
    if (c === '"') {
      const start = i + 1;
      let j = start;
      let escaped = false;
      let closed = false;
      while (j < n) {
        const ch = s[j];
        if (escaped) { escaped = false; j++; continue; }
        if (ch === '\\') { escaped = true; j++; continue; }
        if (ch === '"') { closed = true; break; }
        j++;
      }
      const raw = s.slice(start, j);
      if (depth === 1 && captureNext && !expectKey) return decodeJsonStringPrefix(raw);
      if (!closed) return ''; // some other string still open at prefix end
      if (depth === 1 && expectKey) {
        captureNext = raw === 'text';
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ']') { depth--; i++; continue; }
    if (c === ',') { if (depth === 1) { expectKey = true; captureNext = false; } i++; continue; }
    i++; // ':', whitespace, numbers, literals
  }
  return '';
}
```

### Failure policy and accepted residuals

- `generateStructuredStream` does NO repair-retry: bytes have already been
  released to the bubble, and the existing streaming ruling ("no mid-stream
  retry; callers already have a retry-the-turn affordance") extends
  naturally. A final parse/zod failure is a `fatal` AiServiceError.
  Acquisition retries + the pro-tier fallback stay identical to
  `generateTextStream` (shared `invokeWithProFallback`).
- A declared-player narration on a no-attempt turn is redacted at the FINAL
  gate, but completed sentences may already have streamed to the bubble.
  This is the same correction window the existing prose redaction already
  documents at turn.ts ("the stream has already released its prefix...
  re-released through playerVisibleStreamGate.finish") — unchanged in kind.
- A `\uXXXX`-encoded surrogate pair split exactly between its halves could
  release a lone high surrogate; bounded by the sentence-terminator release
  rule (a terminator must follow before anything reaches the bubble). Noted,
  not blocking.

## 2. New/changed seams (exact signatures)

```ts
// ai/core/geminiService.ts (NEW)
export async function generateStructuredStream<T>(
  ai: GeminiClient,
  req: GenerateStructuredRequest<T>,
  onChunk: (rawJsonSoFar: string) => void, // CUMULATIVE raw JSON text
): Promise<T>;
// json: true config; acquisition via invokeWithProFallback (like
// generateTextStream); single-pass consumption; final parseModelJson +
// zodSchema.safeParse; NO repair retry; recordCall like generateTextStream.

// ai/core/streamSplit.ts (NEW; pure, stateless like createNarrationStreamGate)
export function extractPayloadTextPrefix(cumulativeRawJson: string): string;

// ai/core/actorsBoundary.ts (NEW type exports; the "strip" for these
// payloads IS `.text` - committed values are plain strings)
export type NarrationPayloadInterchange = z.infer<typeof zNarrationPayload>;
export type PlayerMonologuePayloadInterchange = z.infer<typeof zPlayerMonologuePayload>;

// ai/tools/intelligence.ts (CHANGED return types)
getPlayerMonologue(...unchanged args): Promise<PlayerMonologuePayloadInterchange>;
//   generateStructured + PlayerMonologuePayloadSchema/zPlayerMonologuePayload,
//   still GEMINI_FLASH; assertPlayerVisibleTextSafe(payload.text) inside;
//   empty-text fallback { text: 'I am contemplative.', actors: [] };
//   mock branch: mockGetPlayerMonologue returns { text, actors }.
getUpdatedSimulationState(...unchanged args): Promise<SimulationStateInterchange>;
//   parse + assertPlayerVisibleValueSafe; the STRIP MOVES OUT to turn.ts's
//   commit boundary; mock branch returns { ...oldState, actors: [] }.

// ai/core/turn.ts (CHANGED - parameter widens; body unchanged, since
// redactInventedPlayerProse already accepts both shapes)
function enforceNoAttemptBoundary(
  adjudication: AdjudicationInterchange | Adjudication,
  playerEntity: Entity,
  hasObservableAttempt: boolean,
): void;
```

## 3. Gate-before-strip call order per surface (turn.ts)

**Adjudication**
1. `rawAdjudication = await generateStructured<AdjudicationInterchange>(...)` (unchanged).
2. `enforceNoAttemptBoundary(rawAdjudication, player, hasAttempt)` — the
   FIRST boundary run moves BEFORE the strip and sees the declarations:
   `assertNoInventedPlayerAction` reads ids/deltas/remove_entities (all
   present on the interchange), `redactInventedPlayerProse` takes its
   declaration-aware branch ({text, actors} headlines, actors siblings),
   `assertPlayerVisibleAdjudicationSafe`'s deep value walk handles the
   object headlines transparently.
3. `const adjudication = stripActorsFromAdjudication(rawAdjudication)` —
   the commit boundary for this surface. Nothing downstream (resolution
   note, mind-scheme folding, mortality, engine, history entry) ever sees
   `actors`.
4. The 2nd (post-mind-folding) and 3rd (post-mortality)
   `enforceNoAttemptBoundary` calls stay on the committed shape,
   tripwire-only BY DESIGN: the only new prose those steps introduce is
   mind-scheme JSON (non-prose) and mortality rewrites. Mortality keeps its
   own parse-time strip (ai/core/mortality.ts) — accepted residual: no
   declaration gate on mortality-authored delta reasons; they are
   code-directed and remain tripwire + mechanics covered.

**Simulation state**
1. `rawSimulationState: SimulationStateInterchange` resolves from the
   parallel leg (strip no longer inside `getUpdatedSimulationState`).
2. Gate the ONE prose field with its declaration:
   `redactInventedPlayerProseFromValue(rawSimulationState.major_ongoing_crisis ?? '',
   player, hasAttempt, 'simulationState.major_ongoing_crisis',
   rawSimulationState.actors)`.
3. Commit: `stripActorsFromSimulationState({ ...rawSimulationState,
   major_ongoing_crisis: gated.value })`. A fully-redacted crisis commits as
   `''` — the exact value the legacy traversal already produced (pinned by
   tests/mockParity.test.ts's existing crisis-redaction case). Every other
   field is a closed zod enum, so dropping the legacy whole-object traversal
   loses no coverage.
4. Redaction notes ride the existing `playerProseRedactionNotes` →
   `gm_private` channel.

**Monologue**
1. `payload = await getPlayerMonologue(...)` → `{ text, actors }`
   (no-attempt short-circuit becomes `Promise.resolve({ text: '', actors: [] })`).
2. `assertNoPlayerRemoval(payload, ...)` (unchanged).
3. `redactInventedPlayerProseFromValue(payload.text, player, hasAttempt,
   'monologue', payload.actors)`.
4. Commit `playerMonologue = gated.value` (string; `.text` is the strip).

**Narration**
1. Streaming path: `generateStructuredStream<NarrationPayloadInterchange>`
   with `NarrationPayloadSchema`/`zNarrationPayload`; the onChunk composes
   `extractPayloadTextPrefix` → `narrationStreamGate` →
   `playerVisibleStreamGate.push` → `onNarrationChunk` (the two gates and
   the callback are byte-identical to today). Non-streaming path:
   `generateStructured` with the same schema pair. One provider call either
   way; no-attempt short-circuit `{ text: '', actors: [] }`.
2. `assertPlayerVisibleTextSafe(payload.text)`; `assertNoPlayerRemoval`.
3. `redactInventedPlayerProseFromValue(payload.text, player, hasAttempt,
   'narration', payload.actors)` → `fullText` → the existing
   `'SUGGESTION:'` split → `playerVisibleStreamGate.finish(narration)`
   re-release, all unchanged.

## 4. Mock-mirror design (ai/mocks.ts)

- `MOCK_ADJUDICATION` becomes interchange-shaped ({text, actors} headlines,
  actors siblings). The mock pipeline mirrors the real order: project →
  `assertNoInventedPlayerAction` → `redactInventedPlayerProse`
  (declaration-aware, on the interchange) →
  `assertPlayerVisibleAdjudicationSafe` → `stripActorsFromAdjudication` →
  `applyAdjudication`/history. The committed history entry stores the
  stripped shape.
- Value gates (mocks.ts ~494-500): narration and monologue go 5-arg with
  their payloads' declared actors; the simulation-state gate mirrors the
  real crisis-shell seam with a synthesized empty declaration is NOT used —
  mock sim state has no provider and therefore no declaration, so it keeps
  the tripwire path over the crisis text (`actors` omitted), preserving the
  pinned mockParity crisis-redaction behavior.
- `mockGetPlayerMonologue` returns `{ text: <existing text>, actors: [] }`
  (pure cognition — faithful). Mock narration payload:
  `{ text: <existing echo text>, actors: [playerEntity.entity_id, 'maximinus_thrax'] }`
  (it narrates the player's submitted action and Thrax's stirring; built
  only on attempt turns, where the gate is inert — attribution faithful
  regardless).

### Hand-attribution table for the canned fixtures (fixtures' defaults are
### NOT semantically reliable — attribute faithfully, per this table)

| Surface | Text (abridged) | actors |
|---|---|---|
| entityAction notes (Thrax propaganda) | "Maximinus Thrax spreads rumors..." | `['maximinus_thrax']` |
| entityAction notes (donative) | "Severus Alexander attempts to shore up support..." | `['severus_alexander']` |
| delta resource `maximinus_thrax:legion_support` | "Successful propaganda campaign." | `['maximinus_thrax']` |
| delta relation `severus_alexander:maximinus_thrax` | "Slandered by military propaganda." | `['maximinus_thrax']` (the slanderer acts; Severus suffers it) |
| delta rumor german-tribute | "The Emperor is said to be considering..." | `[]` (reports a rumored deliberation — cognition, no accomplished act; `origin_id` stays the mechanical owner) |
| delta relation `severus_alexander:praetorian_guard` | "Promised a donative." | `['severus_alexander']` |
| delta add_region (Temple of Jupiter) | JSON payload, priests' rituals | `[]` (pure description) |
| delta status `gaius_pontius_magnus` | "...the Senator quietly withdraws..." | `['gaius_pontius_magnus']` |
| headline 1 | "Discontent grows in the Praetorian Camp..." | `[]` (world description; no named agent in-text) |
| headline 2 | "Emperor promises bonus to Praetorian Guard." | `['severus_alexander']` — LOAD-BEARING: closes the mock-mode B7 gap for any severus player whose aliases don't include 'Emperor' (the shipped preset's position IS 'Emperor', so today only the tripwire catches it — an alias coincidence, not a contract) |
| playerPlantedRumor reason | "...Thrax has been skimming the legions' pay..." | `['maximinus_thrax']` (the claim narrates Thrax's act) |

## 5. Blast radius the implementer must plan for (existing green tests that
## the WIRING will break until updated)

- `tests/turnPipeline.test.ts`: every `h.response.monologue.resolve(<plain text>)`
  and `h.response.narration.resolve(<plain text>)` fixture (≈15 sites) must
  become JSON payloads (`{"text": ..., "actors": [...]}`) once the calls go
  structured; the streaming chunker fixtures split raw JSON, not prose.
  Hand-attribute the actors on any fixture a gate assertion touches.
- `tests/investigation.test.ts` ("validates player-monologue text at the
  helper return boundary"): `makeMockTextAi(<plain text>)` must return the
  payload JSON; the helper now returns `{ text, actors }`.
- `tests/journeys/*` (separate config, 10 journeys): the queued canned
  narration/monologue responses in the journey harness become JSON payloads.
- `tests/smokeTest.ts` monologue call site.
- `tests/mockParity.test.ts` line ~48 keeps passing (the declaration now
  drops the headline the tripwire used to); the crisis-redaction case keeps
  passing because redaction still commits `''`.
- Prompts: narration/monologue prompts already teach the contract (Task 3);
  they still describe SUGGESTION lines INSIDE the prose — with structured
  output those live inside the payload's `text`. Verify the narration prompt
  needs no wording change for JSON mode (the schema + responseMimeType do
  the format enforcement; do NOT touch prompt files in this task without
  re-running tests/actorsPromptContract.test.ts).
