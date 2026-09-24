/**
 * narration/narrators.ts
 *
 * Narrator profiles: everything that makes one narrator sound unlike
 * another, gathered in one validated record so a tuned narrator can be
 * built, tried against the tuning harness (narration/tuning/), and deployed
 * without touching the pipeline code.
 *
 * A profile has two halves, matching the two calls in
 * ai/tools/narrationVoice.ts:
 *
 *  - `prep` - the intermediary prep model (the "director") that turns one
 *    committed narration into a performed transcript. Its model id may be
 *    a tuned model (`tunedModels/...`); `directorNotes` is the narrator's
 *    house style for where and how directions fall.
 *  - `voice` - the text-to-speech call: model, prebuilt voice, temperature,
 *    and the style note that frames the transcript.
 *
 * What a profile can NOT change: the word-for-word guard
 * (narration/performanceScript.ts). A profile tunes the ask; the guard is
 * the guarantee (D4/D5), and it runs unchanged whatever a profile says.
 *
 * Deploying: a profile is a JSON file in `narration/narrators/`. Every such
 * file is bundled at build time, validated against `narratorProfileSchema`
 * on load, and offered in the Settings menu beside the built-in
 * LAMPLIGHT_NARRATOR. An invalid file is dropped with a console warning,
 * never crashes the game - and `tests/narrators.test.ts` fails the build
 * before one can ship. See narration/narrators/README.md.
 */

import { z } from 'zod';
import {
  DEFAULT_NARRATOR_VOICE,
  GEMINI_NARRATION_PREP,
  GEMINI_TTS,
  NARRATION_PREP_THINKING_LEVEL,
} from '../ai/core/geminiService';

/** Model ids: Gemini ids and tuned-model resource names (`tunedModels/x-1`). */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,199}$/;

export const narratorProfileSchema = z.object({
  /** Stable key, persisted as the device's narrator choice. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, 'lowercase letters, digits and dashes, 2-48 chars'),
  /** Player-visible name in the Settings menu. */
  name: z.string().trim().min(1).max(40),
  /** Player-visible one-line description under the picker. */
  description: z.string().trim().min(1).max(160),
  prep: z.object({
    model: z.string().regex(MODEL_ID),
    thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']),
    temperature: z.number().min(0).max(2),
    /** House style for the director. Appended below the fixed hard rules, never replacing them. */
    directorNotes: z.string().trim().max(1200),
  }).strict(),
  voice: z.object({
    model: z.string().regex(MODEL_ID),
    voiceName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
    temperature: z.number().min(0).max(2),
    /** The note that frames the transcript for the TTS model. */
    styleNote: z.string().trim().min(1).max(800),
  }).strict(),
}).strict();

export type NarratorProfile = z.infer<typeof narratorProfileSchema>;

/**
 * The built-in narrator: the owner's reference voice (Brio, temperature 1)
 * with the grave lamplit storyteller the voice shipped with, and its
 * director on the flash prep model at low thinking.
 */
export const LAMPLIGHT_NARRATOR: NarratorProfile = {
  id: 'lamplight',
  name: 'The Lamplit Storyteller',
  description: 'A grave, theatrical storyteller by lamplight, giving each quoted speaker a voice of their own.',
  prep: {
    model: GEMINI_NARRATION_PREP,
    thinkingLevel: NARRATION_PREP_THINKING_LEVEL,
    temperature: 0.7,
    directorNotes: 'Favor measured gravity. Let dread build through pauses rather than volume, and save raised voices for true violence or triumph.',
  },
  voice: {
    model: GEMINI_TTS,
    voiceName: DEFAULT_NARRATOR_VOICE,
    temperature: 1,
    styleNote: 'Read this as a dramatic narrator of imperial Rome: a grave, theatrical storyteller by lamplight. Give each quoted speaker a voice of their own.',
  },
};

export const DEFAULT_NARRATOR_ID = LAMPLIGHT_NARRATOR.id;

/**
 * Validates deployed profile modules (as `import.meta.glob` yields them:
 * path -> parsed JSON, possibly under `default`). Invalid entries and ids
 * that collide with an earlier profile are dropped with a warning.
 */
export function loadNarratorProfiles(
  modules: Record<string, unknown>,
  builtIns: readonly NarratorProfile[] = [LAMPLIGHT_NARRATOR],
): NarratorProfile[] {
  const profiles = [...builtIns];
  const seen = new Set(profiles.map(p => p.id));
  for (const path of Object.keys(modules).sort()) {
    const raw = modules[path];
    const candidate = typeof raw === 'object' && raw !== null && 'default' in raw ? (raw as { default: unknown }).default : raw;
    const parsed = narratorProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn(`narrators: ${path} is not a valid narrator profile and was not deployed`, parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`));
      continue;
    }
    if (seen.has(parsed.data.id)) {
      console.warn(`narrators: ${path} reuses the narrator id '${parsed.data.id}' and was not deployed`);
      continue;
    }
    seen.add(parsed.data.id);
    profiles.push(parsed.data);
  }
  return profiles;
}

/** Every deployed narrator JSON in narration/narrators/, bundled at build time. */
const DEPLOYED_MODULES: Record<string, unknown> = import.meta.glob('./narrators/*.json', { eager: true });

/** The narrators this build offers: the built-in first, then each deployed profile. */
export const NARRATORS: readonly NarratorProfile[] = loadNarratorProfiles(DEPLOYED_MODULES);

/** The profile for `id`, falling back to the built-in for an unknown or retired id. */
export function narratorById(id: string | null | undefined, narrators: readonly NarratorProfile[] = NARRATORS): NarratorProfile {
  return narrators.find(p => p.id === id) ?? narrators[0] ?? LAMPLIGHT_NARRATOR;
}
