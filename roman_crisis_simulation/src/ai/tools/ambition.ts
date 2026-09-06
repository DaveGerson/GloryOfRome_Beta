/**
 * ai/tools/ambition.ts
 *
 * DESIGN_DECISIONS.md D8: "Player ambition is inferred, never declared."
 * `inferAmbition` is the one entry point for that inference - a cheap,
 * periodic (see App.tsx: every 3rd committed turn) flash-tier call that
 * reads a pattern out of the player's own recent chosen actions and their
 * public aftermath, with no player-visible goal UI anywhere.
 *
 * The zod schema and Gemini responseSchema below are defined LOCALLY in
 * this file rather than in ai/core/zodSchemas.ts / ai/core/schemas.ts.
 * Those two files belong to a concurrent workstream for this stage of
 * development; this call's shape is small, stable, and owned entirely by
 * this feature, so duplicating the (tiny) schema-pair convention here keeps
 * this file self-contained without touching shared files under active
 * concurrent edit. If ambition inference ever grows shared fields with
 * another call family, that would be the moment to reconsider promoting
 * these into the shared schema files.
 */

import { Type } from '@google/genai';
import { z } from 'zod';
import { Entity } from '../../types';
import { GeminiClient, generateStructured, GEMINI_FLASH, THINKING_QUICK } from '../core/geminiService';
import { buildAmbitionInferencePrompt, buildApparentAmbitionPlayerBrief } from '../prompts/ambition';
import { deserializeTurnSubmission, isReservedTurnSubmissionArtifact, projectForExternalInference } from '../../playerInput/turnSubmission';

/** Local zod schema for `inferAmbition`'s output - see the file-level doc comment for why this lives here instead of ai/core/zodSchemas.ts. */
export const zAmbitionInference = z.object({
  apparent_ambition: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
}).passthrough();

export type AmbitionInference = z.infer<typeof zAmbitionInference>;

/** Local Gemini `responseSchema`, mirroring `zAmbitionInference` above - see the file-level doc comment for why this lives here instead of ai/core/schemas.ts. */
const AmbitionInferenceSchema = {
  type: Type.OBJECT,
  properties: {
    apparent_ambition: {
      type: Type.STRING,
      description: "ONE sentence, third-person external read of the pattern in the character's recent actions (e.g. \"Appears to be consolidating personal loyalty within the legions at the Senate's expense.\"). Never a first-person goal statement or an instruction.",
    },
    confidence: {
      type: Type.STRING,
      enum: ['low', 'medium', 'high'],
      description: "How legible/consistent the pattern is: 'low' for thin or contradictory evidence, 'medium' for a discernible lean, 'high' only for an unmistakable, sustained pattern.",
    },
  },
  required: ['apparent_ambition', 'confidence'],
};

/** Canned mock-mode result - mock mode has no real model to infer a pattern from, so this is a fixed, plausible placeholder rather than an attempt to simulate inference. */
const MOCK_AMBITION_INFERENCE: AmbitionInference = {
  apparent_ambition: 'Appears to be quietly consolidating personal power while keeping potential rivals off balance.',
  confidence: 'medium',
};

/**
 * Infers the player's APPARENT ambition (D8) from their recent chosen
 * actions and the public headlines those actions produced. Never asks the
 * player to declare a goal, and its output is never rendered on any
 * player-facing surface. Only the GM console (GameMasterScreen) may read it.
 *
 * `ai` is typed as the narrow `GeminiClient` structural interface (rather
 * than `GoogleGenAI`, the convention elsewhere in ai/tools/*.ts) so a test
 * can pass a bare `{ models: { generateContent: vi.fn() } }` mock, matching
 * ai/core/mortality.ts's precedent - see tests/ambition.test.ts. Any real
 * `GoogleGenAI` instance satisfies this interface structurally, so callers
 * (App.tsx) pass their existing `GoogleGenAI` ref unchanged.
 */
export async function inferAmbition(
  ai: GeminiClient,
  player: Entity,
  recentIntents: string[],
  recentHeadlines: string[],
  isMockMode: boolean
): Promise<AmbitionInference> {
  if (isMockMode) {
    return MOCK_AMBITION_INFERENCE;
  }

  const observableIntents = recentIntents.flatMap((intent) => {
    const submission = deserializeTurnSubmission(intent);
    // A reserved artifact namespace is canonical-only: malformed or future
    // variants are not legacy freeform text and must never be inferred from.
    const observable = submission
      ? projectForExternalInference(submission)
      : isReservedTurnSubmissionArtifact(intent)
        ? null
        : intent;
    return observable ? [observable] : [];
  });
  const { systemInstruction, prompt } = buildAmbitionInferencePrompt(
    buildApparentAmbitionPlayerBrief(player),
    observableIntents,
    recentHeadlines,
  );
  return generateStructured<AmbitionInference>(ai, {
    callName: 'ambitionInference',
    model: GEMINI_FLASH,
    systemInstruction,
    prompt,
    responseSchema: AmbitionInferenceSchema,
    zodSchema: zAmbitionInference,
    // The quick posture - this is a cheap, periodic read of an existing
    // pattern, not a high-stakes deliberation like adjudication/mortality.
    thinkingConfig: THINKING_QUICK,
  });
}
