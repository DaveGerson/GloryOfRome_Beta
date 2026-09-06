import type { GoogleGenAI } from '@google/genai';
import type { PrivateSceneModelResponse } from '../../privateScene/model';
import { generateStructured, GEMINI_PRO, THINKING_STANDARD } from '../core/geminiService';
import { PrivateSceneModelResponseSchema } from '../core/schemas';
import { zPrivateSceneModelResponse } from '../core/zodSchemas';
import { mockContinuePrivateScene } from '../mocks';
import {
  buildPrivateScenePrompt,
  parsePrivateScenePromptInput,
  type PrivateScenePromptInput,
} from '../prompts/privateScene';

function validateResponseForRequest(
  response: PrivateSceneModelResponse,
  input: ReturnType<typeof parsePrivateScenePromptInput>,
): PrivateSceneModelResponse {
  const parsed = zPrivateSceneModelResponse.parse(response);
  if (input.phase === 'exchange' && parsed.disposition === 'refused') {
    throw new Error('Private-scene response cannot refuse after the invitation phase.');
  }
  if (parsed.speechActs.some(act => act.exchange !== input.exchange)) {
    throw new Error('Private-scene response exchange does not match the requested exchange.');
  }
  return parsed;
}

export async function continuePrivateScene(
  ai: GoogleGenAI,
  input: PrivateScenePromptInput,
  isMockMode: boolean,
): Promise<PrivateSceneModelResponse> {
  const boundedInput = parsePrivateScenePromptInput(input);
  if (isMockMode) return validateResponseForRequest(mockContinuePrivateScene(boundedInput), boundedInput);

  const { systemInstruction, prompt } = buildPrivateScenePrompt(boundedInput);
  const response = await generateStructured<PrivateSceneModelResponse>(ai, {
    callName: 'privateScene',
    model: GEMINI_PRO,
    systemInstruction,
    prompt,
    responseSchema: PrivateSceneModelResponseSchema,
    zodSchema: zPrivateSceneModelResponse,
    thinkingConfig: THINKING_STANDARD,
    temperature: 0.8,
  });
  return validateResponseForRequest(response, boundedInput);
}
