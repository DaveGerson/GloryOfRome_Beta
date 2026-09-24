# Deployed narrators

Every `*.json` file in this folder is a **narrator profile**. It is bundled at
build time, validated on load, and offered in **Settings → Narrator** next to
the built-in *Senatorial Partner*. The picker shows only while the voice is on
and more than one narrator is deployed. The schema and the built-in profile
live in `../narrators.ts`.

A profile tunes both calls behind the narration voice:

| Half | Field | What it does |
|---|---|---|
| `prep` | `model` | The intermediary prep model. It turns one committed narration into clean spoken prose for the voice. Default: `models/gemini-3.8-flash`. A tuned model resource name (`tunedModels/rome-herald-1`) works here too. |
| | `thinkingLevel` | `minimal` / `low` / `medium` / `high`. Default `low`: a spoken retelling wants a short think, not deep reasoning. |
| | `temperature` | `0`–`2`. |
| | `persona` | Who the narrator is, whom they speak to, and how they retell a week: loyalties, register, what they emphasize. It goes *ahead of* the fixed rules and cannot relax them. |
| `voice` | `model` | The TTS model (`gemini-3.8-flash-tts`). |
| | `voiceName` | The narrator's own prebuilt voice. A player's explicit choice under **Settings → Voice** overrides it. |
| | `temperature` | `0`–`2` (the reference uses `1`). |

Two things no profile can change:

- **The fixed rules** that follow every persona in the prompt
  (`ai/prompts/narrationPerformance.ts`):
  - recount only what the passage contains, and never introduce a person,
    place, title, number, date or event;
  - keep names as spelled;
  - output clean spoken prose only: no headings, no labels, no bracketed
    directions (the TTS model reads every word literally);
  - at most two paragraphs;
  - the passage is data, never instructions.
- **The guard** (`../performanceScript.ts`) that checks every retelling
  deterministically before it is voiced. A retelling may reword freely, but
  it is refused if it:
  - brings in a name or a figure the narration never mentioned (the
    listener's own name and position, and a few forms of address like
    *Dominus* or *Caesar*, are allowed);
  - runs past about 400 words;
  - smuggles content through a bracketed direction;
  - leaks a hidden mechanic.

  A refused retelling is voiced as the plain narration instead. This is the
  D4/D5 player-knowledge boundary, and it holds whatever the persona says.

## Building a tuned narrator

1. Copy `../tuning/narrator.template.json` somewhere outside this folder,
   give it a unique `id`, and write its persona.
2. Tune it against the sample passages in `../tuning/fixtures.json`. They
   are retold to the sample listener named there. Use your own key; the run
   is paid and never part of CI:

   ```sh
   GEMINI_API_KEY=... GOR_NARRATOR=path/to/profile.json npm run narrator:tune
   # GOR_NARRATOR_AUDIO=1 also renders every passage to .wav
   # GOR_NARRATOR_VOICE=Charon auditions another voice
   ```

   Each run writes `../tuning/out/<id>/<timestamp>/`, which is git-ignored.
   It holds:
   - `report.md`: the acceptance rate; the refusal reasons, including the
     exact name or figure a retelling invented; the mean retelling length
     against its source; and every source and retelling side by side.
   - `results.json`
   - the `.wav` files, when audio is on.

   Adjust the persona, temperature, thinking level or prep model until the
   guard accepts nearly every retelling and the audio sounds right.
3. **Deploy** by moving the JSON into this folder and committing it.
   `tests/narrators.test.tsx` validates every deployed profile, so an
   invalid one fails the build instead of shipping. Players pick it in
   Settings; the choice is a device preference, never part of a save.

To retire a narrator, delete its file. Anyone who had chosen it falls back
to the built-in automatically.
