/**
 * ai/tools/voiceCasting.ts
 *
 * `castVoices` - the casting director (B13): one structured call on the
 * prep model (`GEMINI_NARRATION_PREP` at LOW thinking) that casts the
 * campaign's voices (ai/prompts/voiceCasting.ts). Two modes:
 *
 *  - 'full': the narrator (a deployed reader, a voice, a delivery note) and
 *    every individual the player knows. Runs once, when a campaign's voice is
 *    first needed, and again on "Recast everyone".
 *  - 'newcomers': only the individuals not yet cast, around the voices
 *    already taken. Runs when someone new becomes known and the voice is on.
 *
 * Validation, member by member: an entity id outside the input set is
 * dropped; an unknown voice id (or a member the answer left out) gets the
 * deterministic casting instead (narration/voiceCast.ts); every note is
 * sanitized like a player's custom voice style and capped at 80 characters;
 * every rationale is cleaned and capped. `ensureUniqueCast` then runs over
 * the whole cast. A failed or refused call falls back to the deterministic
 * casting for everyone asked - it never throws and never blocks play.
 *
 * Mock Mode: no call; the deterministic casting.
 *
 * The zod and Gemini schemas are local to this feature, like
 * ai/tools/ambition.ts's.
 */

import { Type } from '@google/genai';
import { z } from 'zod';
import {
  GEMINI_NARRATION_PREP,
  NARRATION_PREP_THINKING_LEVEL,
  generateStructured,
  type GeminiClient,
} from '../core/geminiService';
import {
  buildVoiceCastingPrompt,
  type CastingNarratorOption,
} from '../prompts/voiceCasting';
import {
  MAX_CAST_RATIONALE_CHARS,
  assembleCast,
  effectiveMember,
  fallbackNarrator,
  fallbackProposal,
  sanitizeCastStyle,
  type CastNarrator,
  type CastingCandidate,
  type DefaultNarrator,
  type ProposedMember,
  type VoiceCast,
} from '../../narration/voiceCast';
import { VOICE_CATALOG, catalogVoice, isCatalogVoice } from '../../narration/voiceCatalog';
import { cleanPlayerText } from '../../narration/customNarrators';

/** The shape the model returns; semantic validation happens member by member afterwards. */
export const zVoiceCasting = z.object({
  narrator: z.object({
    narratorId: z.string(),
    voiceName: z.string(),
    style: z.string(),
    rationale: z.string(),
  }).nullish(),
  cast: z.array(z.object({
    entityId: z.string(),
    voiceName: z.string(),
    style: z.string(),
    rationale: z.string(),
  })),
});

export type VoiceCastingAnswer = z.infer<typeof zVoiceCasting>;

const VOICE_IDS = VOICE_CATALOG.map(v => v.id);

const castEntrySchema = {
  type: Type.OBJECT,
  properties: {
    entityId: { type: Type.STRING },
    voiceName: { type: Type.STRING, enum: VOICE_IDS },
    style: { type: Type.STRING, description: 'How they speak: at most 80 characters of delivery language.' },
    rationale: { type: Type.STRING, description: 'One short line, shown to the player, on why this voice fits.' },
  },
  required: ['entityId', 'voiceName', 'style', 'rationale'],
};

export const VoiceCastingSchema = {
  type: Type.OBJECT,
  properties: {
    narrator: {
      type: Type.OBJECT,
      properties: {
        narratorId: { type: Type.STRING },
        voiceName: { type: Type.STRING, enum: VOICE_IDS },
        style: { type: Type.STRING },
        rationale: { type: Type.STRING },
      },
      required: ['narratorId', 'voiceName', 'style', 'rationale'],
    },
    cast: { type: Type.ARRAY, items: castEntrySchema },
  },
  required: ['cast'],
};

/** Shown when the director gave a voice but no reason (veto queue, B13). */
export const DEFAULT_AGENT_RATIONALE = 'Cast by the casting director.';

export interface CastVoicesInput {
  mode: 'full' | 'newcomers';
  theme: string;
  player: { name: string; position?: string } | null;
  /** 'full': everyone the player knows. 'newcomers': only those not yet cast. */
  candidates: readonly CastingCandidate[];
  /** The deployed readers the director may choose among. */
  narrators: readonly CastingNarratorOption[];
  /** The reader, and its voice, the cast falls back to. */
  defaultNarrator: DefaultNarrator;
  /** The cast so far: its narrator and members are kept in 'newcomers' mode, its overrides in both. */
  existing: VoiceCast | null;
}

export interface CastVoicesResult {
  cast: VoiceCast;
  /** Whether any member (or the narrator) was cast by rule rather than by the director. */
  usedFallback: boolean;
}

function cleanRationale(raw: string): string {
  return cleanPlayerText(raw).slice(0, MAX_CAST_RATIONALE_CHARS).trim() || DEFAULT_AGENT_RATIONALE;
}

/**
 * Turns the director's answer into proposals, member by member (see the
 * module header). Pure; exported for tests.
 */
export function validateCasting(
  answer: VoiceCastingAnswer | null,
  input: Pick<CastVoicesInput, 'mode' | 'candidates' | 'narrators' | 'defaultNarrator' | 'existing'>,
): { narrator: CastNarrator; proposals: ProposedMember[]; fallbackIds: string[] } {
  const byId = new Map(input.candidates.map(c => [c.entityId, c]));
  const accepted = new Map<string, ProposedMember>();
  for (const entry of answer?.cast ?? []) {
    const candidate = byId.get(entry.entityId);
    if (!candidate || accepted.has(entry.entityId) || !isCatalogVoice(entry.voiceName)) continue;
    accepted.set(entry.entityId, {
      id: candidate.entityId,
      name: candidate.name,
      voiceName: entry.voiceName,
      style: sanitizeCastStyle(entry.style),
      register: catalogVoice(entry.voiceName)?.register,
      rationale: cleanRationale(entry.rationale),
      source: 'agent',
    });
  }
  const fallbackIds: string[] = [];
  const proposals = input.candidates.map(candidate => {
    const proposal = accepted.get(candidate.entityId);
    if (proposal) return proposal;
    fallbackIds.push(candidate.entityId);
    return fallbackProposal(candidate);
  });

  let narrator: CastNarrator;
  if (input.mode === 'newcomers' && input.existing) {
    narrator = input.existing.narrator;
  } else {
    const raw = answer?.narrator;
    const knownReader = raw && input.narrators.some(n => n.id === raw.narratorId);
    if (raw && knownReader && isCatalogVoice(raw.voiceName)) {
      narrator = {
        narratorId: raw.narratorId,
        voiceName: raw.voiceName,
        style: sanitizeCastStyle(raw.style),
        rationale: cleanRationale(raw.rationale),
        source: 'agent',
      };
    } else {
      narrator = fallbackNarrator(input.defaultNarrator);
      fallbackIds.push('narrator');
    }
  }
  return { narrator, proposals, fallbackIds };
}

/**
 * Casts the voices. Never throws: any failure is the deterministic casting.
 * The returned cast's revision is one past `existing`'s.
 */
export async function castVoices(ai: GeminiClient, input: CastVoicesInput, isMockMode: boolean): Promise<CastVoicesResult> {
  let answer: VoiceCastingAnswer | null = null;
  if (!isMockMode && input.candidates.length + (input.mode === 'full' ? 1 : 0) > 0) {
    const existingMembers = input.existing?.members ?? {};
    const { systemInstruction, prompt } = buildVoiceCastingPrompt({
      mode: input.mode,
      theme: input.theme,
      player: input.player,
      candidates: input.candidates,
      narrators: input.narrators,
      taken: input.mode === 'newcomers' && input.existing
        ? [
          { name: 'The narrator', voiceName: input.existing.narrator.voiceName, style: input.existing.narrator.style },
          ...Object.values(existingMembers).map(m => ({ name: m.name, ...effectiveMember(m) })),
        ]
        : undefined,
    });
    try {
      answer = await generateStructured<VoiceCastingAnswer>(ai, {
        callName: 'castVoices',
        model: GEMINI_NARRATION_PREP,
        systemInstruction,
        prompt,
        responseSchema: VoiceCastingSchema,
        zodSchema: zVoiceCasting,
        thinkingConfig: { thinkingLevel: NARRATION_PREP_THINKING_LEVEL.toUpperCase() },
        temperature: 0.6,
      });
    } catch (error) {
      console.warn('castVoices: the casting call failed; casting by rule instead', error);
    }
  }

  const { narrator, proposals, fallbackIds } = validateCasting(answer, input);
  if (answer && fallbackIds.length > 0) {
    console.warn(`castVoices: cast ${fallbackIds.length} member(s) by rule where the answer did not hold`);
  }
  const revision = (input.existing?.revision ?? 0) + 1;
  const keep = input.mode === 'newcomers' && input.existing ? input.existing.members : {};
  // A full recast keeps, as they were, anyone the player once knew but who
  // is not asked about now (dead, or no longer known): after the fresh cast.
  const asked = new Set(input.candidates.map(c => c.entityId));
  const stale: ProposedMember[] = input.mode === 'full' && input.existing
    ? Object.entries(input.existing.members)
      .filter(([id]) => !asked.has(id))
      .map(([id, m]) => ({ id, name: m.name, voiceName: m.voiceName, style: m.style, rationale: m.rationale, source: m.source }))
    : [];
  const overrides = Object.fromEntries(Object.entries(input.existing?.members ?? {}).map(([id, m]) => [id, m.override]));
  const cast = assembleCast(narrator, keep, [...proposals, ...stale], revision, overrides);
  return { cast, usedFallback: isMockMode || !answer || fallbackIds.length > 0 };
}
