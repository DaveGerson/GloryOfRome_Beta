# Deployed narrators

Every `*.json` file in this folder is a **narrator profile**. It is bundled at
build time, validated on load, and offered in **Settings → Narrator** next to
the built-in *Lamplit Storyteller*. The picker only shows when the voice is
on and more than one narrator is deployed. The schema and the built-in
profile live in `../narrators.ts`.

A profile tunes both calls behind the narration voice:

| Half | Field | What it does |
|---|---|---|
| `prep` | `model` | The intermediary prep model, the "director". It turns one committed narration into a performable transcript by adding `<delivery directions>`. The default is `gemini-3.8-flash`. A tuned model resource name such as `tunedModels/rome-director-1` works here too. |
| | `thinkingLevel` | `minimal` / `low` / `medium` / `high`. Default `low`: the job is a careful copy, not reasoning. |
| | `temperature` | `0`–`2`. |
| | `directorNotes` | The narrator's house style: where directions fall and how they read. They are appended beneath the fixed hard rules and can never relax them. |
| `voice` | `model` | The TTS model (`gemini-3.8-flash-tts`). |
| | `voiceName` | A prebuilt voice (the reference uses `Brio`). |
| | `temperature` | `0`–`2` (the reference uses `1`). |
| | `styleNote` | Who the narrator is. This frames the transcript for the TTS model. |

What no profile can change is the **word-for-word guard**
(`../performanceScript.ts`). Every script the director returns is checked
with the directions stripped, and it must match the committed narration
exactly. Each direction also has to pass the no-names, no-numbers,
no-quotes and length rules. A refused script is voiced as plain narration
under a generic direction. This is the D4/D5 player-knowledge boundary; it
holds whatever the profile says.

## Building a tuned narrator

1. Copy `../tuning/narrator.template.json` somewhere outside this folder,
   give it a unique `id`, and write its notes.
2. Tune it against the sample passages in `../tuning/fixtures.json` with your
   own key. The run is paid and never part of CI:

   ```sh
   GEMINI_API_KEY=... GOR_NARRATOR=path/to/profile.json npm run narrator:tune
   # add GOR_NARRATOR_AUDIO=1 to also render every passage to .wav
   ```

   Each run writes `../tuning/out/<id>/<timestamp>/`, which is git-ignored.
   It holds `report.md` (the acceptance rate, refusal reasons, and every
   director script verbatim), `results.json`, and the `.wav` files. Adjust
   the notes, temperature, thinking level or prep model until the guard
   accepts nearly every script and the audio sounds right.
3. **Deploy** by moving the JSON into this folder and committing it.
   `tests/narrators.test.ts` validates every deployed profile, so an invalid
   one fails the build rather than shipping. Players pick it in Settings,
   and the choice is a device preference, never part of a save.

To retire a narrator, delete its file. Anyone who had chosen it falls back
to the built-in automatically.
