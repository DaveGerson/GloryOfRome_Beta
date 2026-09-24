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
 *  - `prep` - the intermediary prep model that turns one committed
 *    narration into the clean spoken prose the voice reads. Its model id
 *    may be a tuned model (`tunedModels/...`); `persona` is who the narrator
 *    is, whom they speak to, and how they retell a scene.
 *  - `voice` - the text-to-speech call: model, the narrator's own prebuilt
 *    voice, and temperature. A player's explicit voice choice in Settings
 *    (persistence/uiPrefs.ts) overrides the voice; nothing else does.
 *
 * What a profile can NOT change: the fixed rules every prep prompt carries
 * (ai/prompts/narrationPerformance.ts - clean spoken prose only, the passage
 * is data, never invent names, numbers or events) and the deterministic
 * guard behind them (narration/performanceScript.ts), which refuses a
 * retelling that brings in a name or a figure the committed narration never
 * mentioned (D4/D5). A persona tunes the ask; the guard is the guarantee.
 *
 * Deploying: a profile is a JSON file in `narration/narrators/`. Every such
 * file is bundled at build time, validated against `narratorProfileSchema`
 * on load, and offered in the Settings menu beside the built-in. An invalid
 * file is dropped with a console warning, never crashes the game - and
 * tests/narrators.test.tsx fails the build before one can ship. See
 * narration/narrators/README.md.
 */

import { z } from 'zod';
import {
  DEFAULT_NARRATOR_VOICE,
  GEMINI_NARRATION_PREP,
  GEMINI_TTS,
  NARRATION_PREP_THINKING_LEVEL,
} from '../ai/core/geminiService';

/** Model ids: Gemini ids, `models/...` names and tuned-model resource names (`tunedModels/x-1`). */
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
    /** Who the narrator is and how they retell. Placed ahead of the fixed rules, never replacing them. */
    persona: z.string().trim().min(40).max(4000),
  }).strict(),
  voice: z.object({
    model: z.string().regex(MODEL_ID),
    /** The narrator's own prebuilt voice; a player's explicit Settings choice overrides it. */
    voiceName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
    temperature: z.number().min(0).max(2),
  }).strict(),
}).strict();

export type NarratorProfile = z.infer<typeof narratorProfileSchema>;

/**
 * The built-in narrator: the owner's senatorial partner (PR #9) - a loyal
 * confidant who retells each week to the player with a tragedian's
 * fervor and makes plain what it means for them - on the flash prep model
 * at LOW thinking, voiced by Enceladus at the reference temperature of 1.
 */
export const SENATORIAL_PARTNER_NARRATOR: NarratorProfile = {
  id: 'senatorial-partner',
  name: 'The Senatorial Partner',
  description: 'Your sworn ally in the Senate: recounts each week with fervor and makes plain what it means for you.',
  prep: {
    model: GEMINI_NARRATION_PREP,
    thinkingLevel: NARRATION_PREP_THINKING_LEVEL,
    temperature: 0.7,
    persona: `You are a trusted senatorial partner, loyal patrician confidant, and dramatic Roman bard to the player in imperial Rome, 235 CE. You speak with the aristocratic, grave, and urgent cadence of a classical English stage tragedian in private council.

Your mission is NOT to be a detached, impartial chronicler. You are the player's sworn ally and senior associate in the Senate and provinces. You are bound to their fate: their triumphs are yours, and the daggers aimed at them threaten you both.
Perform and recount the scene aloud directly to the player as their passionate partner in power, recounting what just transpired with dramatic fervor, theatrical tension, and senatorial gravitas, while making it CRYSTAL CLEAR what these events actually mean for the player.

CORE DUTIES TO YOUR PARTNER (THE PLAYER):
1. CLARIFY WHAT ACTUALLY HAPPENED: Cut through murky metaphors and ambiguity. Recount the events with dramatic fervor and vivid color, but ensure the player instantly understands the concrete reality of what just occurred and who did what.
2. EXPLAIN WHAT IT MEANS FOR THE PLAYER: Directly tell the player how their standing, safety, authority, alliances, or resources were affected. Address them directly (e.g. "my friend", "Dominus", "Caesar", or "you"). Never leave them guessing whether an outcome helped or harmed them.
3. HIGHLIGHT THE IMMEDIATE STAKES & PERIL: Tell them who in the passage is moving against us, whose loyalty wavers, and what urgent challenge or opportunity now faces our faction.
4. DRAMATIC BUT ACTIONABLE: Combine theatrical pizzazz, classical rhetorical rhythm, and dramatic intensity with razor-sharp political counsel.

Address the player directly as their devoted partner and associate, in the second person: you, we, our position.`,
  },
  voice: {
    model: GEMINI_TTS,
    voiceName: DEFAULT_NARRATOR_VOICE,
    temperature: 1,
  },
};

export const DEFAULT_NARRATOR_ID = SENATORIAL_PARTNER_NARRATOR.id;

/**
 * Validates deployed profile modules (as `import.meta.glob` yields them:
 * path -> parsed JSON, possibly under `default`). Invalid entries and ids
 * that collide with an earlier profile are dropped with a warning.
 */
export function loadNarratorProfiles(
  modules: Record<string, unknown>,
  builtIns: readonly NarratorProfile[] = [SENATORIAL_PARTNER_NARRATOR],
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
  return narrators.find(p => p.id === id) ?? narrators[0] ?? SENATORIAL_PARTNER_NARRATOR;
}
