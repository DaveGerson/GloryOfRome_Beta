import type { GoogleGenAI } from '@google/genai';
import type { PrivateSceneModelResponse } from '../../privateScene/model';
import { generateStructured, GEMINI_PRO } from '../core/geminiService';
import { PrivateSceneModelResponseSchema } from '../core/schemas';
import { zPrivateSceneModelResponse } from '../core/zodSchemas';
import { mockContinuePrivateScene } from '../mocks';
import { buildPrivateScenePrompt, type PrivateScenePromptInput } from '../prompts/privateScene';

export async function continuePrivateScene(
  ai: GoogleGenAI,
  input: PrivateScenePromptInput,
  isMockMode: boolean,
): Promise<PrivateSceneModelResponse> {
  if (isMockMode) return mockContinuePrivateScene(input);

  const { systemInstruction, prompt } = buildPrivateScenePrompt(input);
  return generateStructured<PrivateSceneModelResponse>(ai, {
    callName: 'privateScene',
    model: GEMINI_PRO,
    systemInstruction,
    prompt,
    responseSchema: PrivateSceneModelResponseSchema,
    zodSchema: zPrivateSceneModelResponse,
    thinkingConfig: { thinkingBudget: 512 },
    temperature: 0.8,
  });
}
