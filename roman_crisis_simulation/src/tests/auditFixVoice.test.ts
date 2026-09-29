/**
 * tests/auditFixVoice.test.ts
 *
 * Regression cases for the voice cluster of the September 2026 audit: the
 * narrator's guard (narration/performanceScript.ts), the clip player
 * (narration/narrationPlayer.ts), the cast's size cap (narration/voiceCast.ts)
 * and the request deadlines (ai/core/geminiService.ts). The React seams are
 * pinned in tests/auditFixVoiceUi.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import {
  findIntroducedContent,
  performedTranscriptFor,
  unwrapDirectorOutput,
  validatePerformance,
} from '../narration/performanceScript';
import { buildNarrationTtsPrompt } from '../ai/prompts/narrationPerformance';
import { NarrationPlayer } from '../narration/narrationPlayer';
import { MAX_CAST_MEMBERS, assembleCast, completeCast, deterministicCast, fallbackNarrator, fallbackProposal, type CastingCandidate } from '../narration/voiceCast';
import { castVoices } from '../ai/tools/voiceCasting';
import {
  AiServiceError,
  GEMINI_FLASH,
  GEMINI_PRO,
  GEMINI_TTS,
  REQUEST_DEADLINE_MS,
  generateSpeech,
  generateText,
  generateTextStream,
  type GeminiClient,
} from '../ai/core/geminiService';
import { buildPrivateScenePrompt } from '../hooks/usePrivateSceneController';
import { continuePrivateScene } from '../ai/tools/privateScene';
import { PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS, parsePrivateScenePromptInput } from '../ai/prompts/privateScene';
import { PRIVATE_SCENE_MAX_UTTERANCE_CHARS, type PrivateSceneRecord } from '../privateScene/model';
import { makeEntity } from './factories';

const PASSAGE = 'The Praetorians mutter in their camp. Maximinus raises a cup, and the Senate waits.';

describe('fidelity guard: a name mid-sentence is caught whatever punctuation stands before it', () => {
  // The audit's five retellings: each brought in a name the passage never
  // mentions, and each used to pass because the word after `;`, `:`, `(`, a
  // single quote or a stray `[` read as a sentence opener.
  const cases: Array<[string, string, string]> = [
    ['a semicolon', 'The Praetorians mutter in their camp; Philip gathers his cohorts.', 'Philip'],
    ['a colon', 'The camp mutters, and one city shelters the heir: Emesa.', 'Emesa'],
    ['a parenthesis', 'The heir hides in the east (Emesa), and the Senate waits.', 'Emesa'],
    ['a single quote', "The camp mutters of 'Emesa', and the Senate waits.", 'Emesa'],
    ['an unclosed square bracket', 'The heir hides in [Emesa, and the Senate waits.', 'Emesa'],
  ];

  for (const [position, retelling, name] of cases) {
    it(`after ${position}`, () => {
      const performed = performedTranscriptFor(PASSAGE, retelling);
      // Every sentence of these one-sentence retellings brings in the name,
      // so nothing is left to voice: the plain narration is performed.
      expect(performed.usedFallback).toBe(true);
      expect(performed.rejection).toBe('introduces_new_name');
      expect(performed.transcript).not.toContain(name);
      expect(buildNarrationTtsPrompt(performed.transcript)).not.toContain(name);
    });
  }

  it('catches the name in the guard itself, not only after the voice has cleaned the script', () => {
    expect(findIntroducedContent(PASSAGE, 'The Praetorians mutter in their camp; Philip gathers his cohorts.')).toEqual({ kind: 'name', value: 'Philip' });
    expect(findIntroducedContent(PASSAGE, 'The camp mutters, and one city shelters the heir: Emesa.')).toEqual({ kind: 'name', value: 'Emesa' });
    expect(validatePerformance(PASSAGE, 'The heir hides in the east (Emesa), and the Senate waits.')).toEqual({ ok: false, reason: 'introduces_new_name' });
  });

  it('catches a plural possessive and a quotation inside a sentence', () => {
    expect(findIntroducedContent(PASSAGE, "The Praetorians' Philip gathers his cohorts.")).toEqual({ kind: 'name', value: 'Philip' });
    expect(findIntroducedContent(PASSAGE, 'The camp mutters, and the Senate waits for "Philip gathers his cohorts".')).toEqual({ kind: 'name', value: 'Philip' });
  });

  it('patches out only the offending sentence when the rest stands', () => {
    const retelling = 'The Praetorians mutter in their camp. Maximinus raises a cup. The camp mutters; Philip gathers his cohorts. The Senate waits.';
    const performed = performedTranscriptFor(PASSAGE, retelling);
    expect(performed.usedFallback).toBe(false);
    expect(performed.patchedOut).toEqual(['The camp mutters; Philip gathers his cohorts.']);
    expect(performed.transcript).not.toContain('Philip');
  });

  it('still lets a word open a sentence, a line, or quoted speech', () => {
    expect(findIntroducedContent(PASSAGE, 'The camp mutters. Tonight the Senate waits.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'The camp mutters!\nTonight the Senate waits.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'Maximinus raises a cup, "Drink!" and the Senate waits.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'Maximinus roars: "Drink, all of you." The Senate waits.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'The camp mutters. "Drink," says Maximinus.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'The cup is raised." Tonight the Senate waits.')).toBeNull();
    // Curly quotes open speech as straight ones do.
    expect(findIntroducedContent(PASSAGE, 'Maximinus raises a cup, “Drink!” and the Senate waits.')).toBeNull();
    expect(findIntroducedContent(PASSAGE, 'The Senate waits for “Philip” to come.')).toEqual({ kind: 'name', value: 'Philip' });
  });

  it('sends the voice the text the guard judged: a stray bracket is gone before either reads it', () => {
    const performed = performedTranscriptFor(PASSAGE, '<grave> The Praetorians mutter in their camp] and the Senate waits.');
    expect(performed.usedFallback).toBe(false);
    expect(performed.transcript).toBe('<grave> The Praetorians mutter in their camp and the Senate waits.');
  });
});

describe('speaker labels are stripped before the voice reads them aloud', () => {
  const tts = (output: string, allowedNames: readonly string[] = [], labelNames: readonly string[] = []) => {
    const performed = performedTranscriptFor(PASSAGE, output, allowedNames, labelNames);
    expect(performed.usedFallback).toBe(false);
    return buildNarrationTtsPrompt(performed.transcript);
  };

  it('strips "Confidant:", the label the prompt itself forbids', () => {
    expect(tts('Confidant: <grave> The Praetorians mutter in their camp, and the Senate waits.'))
      .toBe('## Transcript:\n<grave> The Praetorians mutter in their camp, and the Senate waits.');
  });

  it('strips a bare "Transcript:" line', () => {
    expect(tts('Transcript:\n<grave> The Praetorians mutter in their camp, and the Senate waits.'))
      .toBe('## Transcript:\n<grave> The Praetorians mutter in their camp, and the Senate waits.');
  });

  it("strips a character's name used as a label before a cue", () => {
    expect(tts('Maximinus: <gruff> The Praetorians mutter in their camp, and the Senate waits.'))
      .toBe('## Transcript:\n<gruff> The Praetorians mutter in their camp, and the Senate waits.');
  });

  it("strips the narrator's own name, and the narrating character's, whatever follows", () => {
    expect(tts('The Dramatic Reader: The Praetorians mutter in their camp, and the Senate waits.', [], ['The Dramatic Reader']))
      .toBe('## Transcript:\nThe Praetorians mutter in their camp, and the Senate waits.');
    expect(tts('Maximinus Thrax: The Praetorians mutter in their camp, and the Senate waits.', ['Maximinus Thrax']))
      .toBe('## Transcript:\nThe Praetorians mutter in their camp, and the Senate waits.');
  });

  it('leaves prose that merely opens with a word and a colon', () => {
    expect(unwrapDirectorOutput('Rome: a city holding its breath.')).toBe('Rome: a city holding its breath.');
  });
});

describe('NarrationPlayer: a stopped preparation is let go', () => {
  const fakeAudio = () => ({
    preload: '', src: '', currentTime: 0,
    play: vi.fn(async () => {}), pause: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), removeAttribute: vi.fn(),
  }) as unknown as HTMLAudioElement;

  beforeEach(() => {
    let n = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:audit-${++n}`), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a press after a stop renders afresh instead of waiting on a render that never settles', async () => {
    const signals: AbortSignal[] = [];
    const render = vi.fn((_text: string, _index: number, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<Blob>(() => {}) : Promise.resolve(new Blob(['x']));
    });
    const player = new NarrationPlayer({ createAudio: fakeAudio });
    player.setRenderer(render, 'test');
    player.toggle(2, 'The Senate waits.'); // preparing, and it hangs
    player.toggle(2, 'The Senate waits.'); // stop
    expect(signals[0].aborted).toBe(true);
    await player.play(2, 'The Senate waits.');
    expect(render).toHaveBeenCalledTimes(2);
    expect(signals[1].aborted).toBe(false);
    expect(player.getSnapshot()).toEqual({ index: 2, status: 'playing' });
    player.dispose();
  });

  it('starting another clip tells the one being prepared, and a clip that lands anyway is kept', async () => {
    let land: (blob: Blob) => void = () => {};
    const signals: AbortSignal[] = [];
    const render = vi.fn((_text: string, _index: number, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<Blob>(resolve => { land = resolve; }) : Promise.resolve(new Blob(['y']));
    });
    const player = new NarrationPlayer({ createAudio: fakeAudio });
    player.setRenderer(render, 'test');
    void player.play(0, 'First.');
    await player.play(1, 'Second.');
    expect(signals[0].aborted).toBe(true);
    land(new Blob(['x'])); // its voice call was already out: the audio is kept
    await Promise.resolve();
    await Promise.resolve();
    await player.play(0, 'First.');
    expect(render).toHaveBeenCalledTimes(2);
    player.dispose();
  });

  it('dispose tells every preparation still out', () => {
    const signals: AbortSignal[] = [];
    const player = new NarrationPlayer({ createAudio: fakeAudio });
    player.setRenderer((_t, _i, signal) => { signals.push(signal); return new Promise<Blob>(() => {}); }, 'test');
    void player.play(0, 'First.');
    player.dispose();
    expect(signals[0].aborted).toBe(true);
  });

  it('a press while the same clip is still wanted joins it: no second render', async () => {
    const render = vi.fn(async () => new Blob(['x']));
    const player = new NarrationPlayer({ createAudio: fakeAudio });
    player.setRenderer(render, 'test');
    const first = player.play(3, 'Once.');
    const second = player.play(3, 'Once.');
    await Promise.all([first, second]);
    expect(render).toHaveBeenCalledTimes(1);
    player.dispose();
  });
});

describe('voice cast at its size cap: the departed give way to newcomers', () => {
  const DEFAULTS = { narratorId: 'senatorial-partner', voiceName: 'Enceladus' };
  const departed: CastingCandidate[] = Array.from({ length: MAX_CAST_MEMBERS }, (_, i) => ({ entityId: `gone_${i}`, name: `Gone ${i}`, entityType: 'individual' }));
  const julia: CastingCandidate = { entityId: 'julia', name: 'Julia Mamaea', position: 'Regent', entityType: 'individual' };
  const full = deterministicCast(departed, DEFAULTS);

  it('assembleCast seats a live newcomer in place of the oldest departed member', () => {
    const cast = assembleCast(fallbackNarrator(DEFAULTS), full.members, [fallbackProposal(julia)], full.revision + 1, {}, new Set(['julia']));
    expect(cast.members.julia).toBeDefined();
    expect(Object.keys(cast.members)).toHaveLength(MAX_CAST_MEMBERS);
    expect(cast.members.gone_0).toBeUndefined();
    expect(cast.members.gone_1).toBeDefined();
  });

  it('without knowing who lives, the cap still cuts the newest proposals, as before', () => {
    const cast = assembleCast(fallbackNarrator(DEFAULTS), full.members, [fallbackProposal(julia)], full.revision + 1);
    expect(cast.members.julia).toBeUndefined();
  });

  it('a newcomers casting seats the newcomer, and the effective cast voices them before it runs', async () => {
    const result = await castVoices({ models: { generateContent: vi.fn() } }, {
      mode: 'newcomers', theme: 'A crisis.', player: null, candidates: [julia], defaultNarrator: DEFAULTS, existing: full, liveIds: ['julia'],
    }, true);
    expect(result.cast.members.julia).toBeDefined();
    expect(completeCast(full, [julia], DEFAULTS).members.julia).toBeDefined();
  });
});

describe('request deadlines: a stalled call fails into the transient path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const hang = () => new Promise<never>(() => {});
  const settled = <T,>(promise: Promise<T>) => promise.then(value => ({ value }), (error: unknown) => ({ error }));

  it('a flash-tier call that never answers is retried, then fails as transient, after its deadline', async () => {
    const generateContent = vi.fn(hang);
    const outcome = settled(generateText({ models: { generateContent } }, { callName: 'narrationPerformance', model: GEMINI_FLASH, prompt: 'p' }));
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.standard - 1);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.standard * 3 + 10_000);
    const { error } = await outcome as { error: AiServiceError };
    expect(error).toBeInstanceOf(AiServiceError);
    expect(error.kind).toBe('transient');
    expect(error.message).toMatch(/timeout/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('never cuts short a slow pro-tier call inside its longer deadline', async () => {
    let answer: (value: { text: string }) => void = () => {};
    const generateContent = vi.fn(() => new Promise<{ text: string }>(resolve => { answer = resolve; }));
    const outcome = settled(generateText({ models: { generateContent } }, { callName: 'narration', model: GEMINI_PRO, prompt: 'p' }));
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.pro - 1_000);
    answer({ text: 'At last.' });
    expect(await outcome).toEqual({ value: 'At last.' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('text-to-speech waits its own, longer deadline', async () => {
    const generateContent = vi.fn(hang);
    const outcome = settled(generateSpeech({ models: { generateContent } }, { callName: 'narrationVoice', model: GEMINI_TTS, prompt: 'p', voiceName: 'Enceladus' }));
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.standard + 1_000);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.speech * 3 + 10_000);
    const { error } = await outcome as { error: AiServiceError };
    expect(error.kind).toBe('transient');
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('a stream that goes silent mid-way fails as a dropped stream, and is asked to close', async () => {
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    let pulls = 0;
    const stream: AsyncIterable<{ text?: string }> = {
      [Symbol.asyncIterator]: () => ({
        next: () => (pulls++ === 0 ? Promise.resolve({ done: false as const, value: { text: 'The Senate ' } }) : hang()),
        return: close,
      }),
    };
    const client: GeminiClient = { models: { generateContent: vi.fn(), generateContentStream: vi.fn(async () => stream) } };
    const outcome = settled(generateTextStream(client, { callName: 'narration', model: GEMINI_FLASH, prompt: 'p' }, () => {}));
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS.standard + 1);
    const { error } = await outcome as { error: AiServiceError };
    expect(error.kind).toBe('transient');
    expect(error.message).toMatch(/mid-stream.*timeout/);
    expect(close).toHaveBeenCalled();
  });

  it('a long, healthy stream runs past any single deadline as long as it keeps coming', async () => {
    const gap = REQUEST_DEADLINE_MS.standard - 10_000;
    async function* slowButSteady() {
      for (let i = 0; i < 8; i++) {
        await new Promise(resolve => setTimeout(resolve, gap));
        yield { text: `${i} ` };
      }
    }
    const client: GeminiClient = { models: { generateContent: vi.fn(), generateContentStream: vi.fn(async () => slowButSteady()) } };
    const outcome = settled(generateTextStream(client, { callName: 'narration', model: GEMINI_FLASH, prompt: 'p' }, () => {}));
    await vi.advanceTimersByTimeAsync(gap * 8 + 1_000);
    expect(await outcome).toEqual({ value: '0 1 2 3 4 5 6 7 ' });
  });
});

describe('private scene prompt: what the model may leave empty never refuses the scene', () => {
  const player = makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', position: 'Emperor', current_state_narrative: 'Young and watched.' });
  const npc = makeEntity({
    entity_id: 'maximinus_thrax', name: 'Maximinus Thrax', position: 'General', current_state_narrative: 'A giant among soldiers.',
    short_term_goals: ['Hold the Rhine.'],
  });
  const opening: PrivateSceneRecord['transcript'] = [{ sequence: 1, speaker: 'player', text: 'Hello.' }];
  const ai = {} as GoogleGenAI;

  it('an NPC with a null voice and position, and a player with a null position, can still be invited', async () => {
    const nulled = { ...npc, voice: null, position: null } as unknown as typeof npc;
    const faceless = { ...player, position: null } as unknown as typeof player;
    const input = buildPrivateScenePrompt(faceless, nulled, opening, 1);
    expect(input.npc.voice).toBeUndefined();
    expect(input.npc.position).toBeUndefined();
    expect(input.player.position).toBeUndefined();
    await expect(continuePrivateScene(ai, input, true)).resolves.toMatchObject({ disposition: 'continues' });
  });

  it('blank self-description, location and context items are left out, not refused', async () => {
    const blank = { ...npc, current_state_narrative: '   ', location: '', short_term_goals: ['', 'Hold the Rhine.'], beliefs: [' '], secrets: [], memories: [] };
    const input = buildPrivateScenePrompt(player, blank, opening, 1);
    expect(input.npc.selfDescription).toBeUndefined();
    expect(input.npc.location).toBeUndefined();
    expect(input.npc.goals).toEqual(['Hold the Rhine.']);
    expect(input.npc.beliefs).toEqual([]);
    await expect(continuePrivateScene(ai, input, true)).resolves.toBeDefined();
  });

  it('a scene written at the per-line limit reaches its sixth exchange, the newest line whole', async () => {
    // Quotes and line breaks double under JSON escaping: the worst case for the budget.
    const line = (mark: string) => `${mark}"\n`.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS).slice(0, PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
    const transcript: PrivateSceneRecord['transcript'] = Array.from({ length: 11 }, (_, i) => ({
      sequence: i + 1, speaker: i % 2 === 0 ? 'player' as const : 'npc' as const, text: line(i % 2 === 0 ? 'x' : 'y'),
    }));
    const input = buildPrivateScenePrompt(player, npc, transcript, 6);
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS);
    expect(() => parsePrivateScenePromptInput(input)).not.toThrow();
    expect(input.transcript).toHaveLength(11);
    expect(input.transcript[10].text).toBe(transcript[10].text);
    expect(input.transcript[0].text.length).toBeLessThan(transcript[0].text.length);
    await expect(continuePrivateScene(ai, input, true)).resolves.toBeDefined();
  });

  it('an NPC described at every field\'s limit still fits at the sixth exchange', async () => {
    // Mostly quotes, each doubled by JSON escaping.
    const full = (mark: string) => `${mark}"""`.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS).slice(0, PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
    const verbose = {
      ...npc, current_state_narrative: full('s'), voice: full('v'), location: full('l'), position: full('p'),
      short_term_goals: Array.from({ length: 8 }, () => full('g')), beliefs: Array.from({ length: 8 }, () => full('b')),
    };
    const transcript: PrivateSceneRecord['transcript'] = Array.from({ length: 11 }, (_, i) => ({
      sequence: i + 1, speaker: i % 2 === 0 ? 'player' as const : 'npc' as const, text: full(i % 2 === 0 ? 'x' : 'y'),
    }));
    const input = buildPrivateScenePrompt(player, verbose, transcript, 6);
    expect(() => parsePrivateScenePromptInput(input)).not.toThrow();
    expect(input.transcript[10].text).toBe(transcript[10].text);
    expect(input.npc.selfDescription?.startsWith('s"""s')).toBe(true);
    await expect(continuePrivateScene(ai, input, true)).resolves.toBeDefined();
  });

  it('a short scene is sent exactly as it was said', () => {
    const transcript: PrivateSceneRecord['transcript'] = [
      { sequence: 1, speaker: 'player', text: 'Will the Guard hold?' },
      { sequence: 2, speaker: 'npc', text: 'For now.' },
      { sequence: 3, speaker: 'player', text: 'And after?' },
    ];
    expect(buildPrivateScenePrompt(player, npc, transcript, 2).transcript).toEqual(transcript.map(({ speaker, text }) => ({ speaker, text })));
  });
});
