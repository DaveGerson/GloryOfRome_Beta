/**
 * @vitest-environment jsdom
 *
 * tests/composureScene.test.tsx
 *
 * D50 in the private scene: both parties' composure is rolled ONCE as the
 * scene opens and kept with it; the NPC is told its own hidden subjects'
 * tiers, and of the player only what code wrote; its tells (a delivery for
 * the line, signs for what showed) are screened before the record, the
 * transcript, the voice or Personae takes them; and the player is shown
 * their own composure in words - the outcome and exactly what the NPC was
 * told, never a number.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import type { ComposureRoll, Condition } from '../types';
import { COMPOSURE_TIER_INSTRUCTIONS, playerComposureTell, screenNpcTells } from '../ai/core/composure';
import { zPrivateSceneModelResponse } from '../ai/core/zodSchemas';
import { buildPrivateScenePrompt } from '../ai/prompts/privateScene';
import { buildPrivateSceneNpcMemoryBlock } from '../ai/prompts/npcMind';
import { mockContinuePrivateScene } from '../ai/mocks';
import {
  buildPrivateScenePrompt as buildScenePromptInput,
  rollSceneComposure,
  usePrivateSceneController,
  type PrivateSceneControllerDeps,
} from '../hooks/usePrivateSceneController';
import { usePrivateSceneVoice } from '../hooks/usePrivateSceneVoice';
import {
  appendPrivateSceneExchange,
  beginPrivateScene,
  buildPrivateSceneNpcMemoryProjection,
  endPrivateScene,
  finalizePrivateScene,
  type PrivateSceneComposure,
  type PrivateSceneModelResponse,
  type PrivateSceneRecord,
} from '../privateScene/model';
import { projectPrivateSceneForPlayer } from '../perception/visibility';
import { sceneLineForSpeech } from '../narration/sceneVoice';
import { NarrationLogStore } from '../narration/narrationLog';
import { normalizeLoadedPrivateScenes } from '../persistence/saveGame';
import { ingestSignsSeen, signsSeenOf, type KnowledgeClaim } from '../knowledge/store';
import { PrivateScene } from '../components/PrivateScene';
import { COMPOSURE_COPY } from '../components/ComposureNotes';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import type { GeminiClient } from '../ai/core/geminiService';
import type { GameAction } from '../state/gameReducer';
import type { RunDomainMutation } from '../state/domainMutation';
import type { DomainCommit } from '../app/transactions';
import type { SaveGameState } from '../persistence/saveGame';
import { makeEntity, makePersonality, makeTurnHistoryEntry } from './factories';
import { tabChangeCountsFor } from '../hooks/usePlayerPerception';
import { renderHook } from './renderHook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mark = (overrides: Partial<Condition> & Pick<Condition, 'id' | 'name'>): Condition =>
  ({ description: '', outward: false, severity: 'serious', since_turn: 1, ...overrides });

const player = makeEntity({
  entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill', personality: makePersonality(),
  visibility_network: ['julia'],
  resources: { investigations: 1, deep_analyses: 0 },
  conditions: [
    mark({ id: 'scar', name: 'a scar across the jaw', outward: true, description: 'PLAYER_OUTWARD_ACCOUNT_SENTINEL' }),
    mark({ id: 'dread', name: 'INWARD_DREAD_MARKER', description: 'PLAYER_MARK_ACCOUNT_SENTINEL' }),
  ],
  affiliations: [{ id: 'lararium', name: 'PLAYER_SECRET_TIE_SENTINEL', kind: 'religion', public: false }],
});
const julia = makeEntity({
  entity_id: 'julia', name: 'Julia Mamaea', position: 'Regent', location: 'Palatine Hill', personality: makePersonality({ cunning: 8 }),
  conditions: [
    mark({ id: 'grief', name: 'NPC_MARK_NAME_SENTINEL', description: 'NPC_MARK_ACCOUNT_SENTINEL', severity: 'grave' }),
    mark({ id: 'burn', name: 'a burned hand', outward: true }),
  ],
  affiliations: [
    { id: 'origen', name: 'the circle of Origen', kind: 'religion', public: false },
    { id: 'state', name: 'the gods of the state', kind: 'religion', public: true },
  ],
});

const npcRoll = (subjectId: string, tier: ComposureRoll['tier']): ComposureRoll => subjectId === 'grief'
  ? { subjectKind: 'mark', subjectId, handle: `mark:${subjectId}`, subjectName: 'NPC_MARK_NAME_SENTINEL', severity: 'grave', roll: 9, modifier: 1.5, difficulty: 13, tier }
  : { subjectKind: 'tie', subjectId, handle: `tie:${subjectId}`, subjectName: 'the circle of Origen', tieKind: 'religion', roll: 17, modifier: 2, difficulty: 9, tier };
const playerRolls = (markTier: ComposureRoll['tier'], tieTier: ComposureRoll['tier']) => ([
  { subjectKind: 'mark', subjectId: 'dread', handle: 'mark:dread', subjectName: 'INWARD_DREAD_MARKER', severity: 'serious', roll: 2, modifier: 0, difficulty: 10, tier: markTier },
  { subjectKind: 'tie', subjectId: 'lararium', handle: 'tie:lararium', subjectName: 'PLAYER_SECRET_TIE_SENTINEL', tieKind: 'religion', roll: 7, modifier: 0, difficulty: 9, tier: tieTier },
] satisfies ComposureRoll[]).map(roll => ({ ...roll, told: playerComposureTell(roll, player) }));
const composure = (overrides: Partial<PrivateSceneComposure> = {}): PrivateSceneComposure => ({
  seed: 42,
  npc: [npcRoll('grief', 'frays'), npcRoll('origen', 'holds')],
  player: playerRolls('breaks', 'frays'),
  ...overrides,
});

const opening = [{ sequence: 1, speaker: 'player' as const, text: 'Mother, a word.' }];
const response = (extra: Partial<PrivateSceneModelResponse> = {}): PrivateSceneModelResponse => ({
  disposition: 'continues',
  npcUtterance: 'Speak, my son.',
  speechActs: [{ speaker: 'npc', kind: 'request', text: 'Speak, my son.', exchange: 1 }],
  npcPrivate: { sincerity: 'Guarded.', hiddenIntent: 'Learn what he fears.', plannedFollowThrough: [] },
  ...extra,
});

/** The PRIVATE SCENE CONTEXT data block of one request, parsed. */
function contextOf(prompt: string): { npc: Record<string, unknown>; player: Record<string, unknown> } {
  const start = prompt.indexOf('PRIVATE SCENE CONTEXT\n') + 'PRIVATE SCENE CONTEXT\n'.length;
  const end = prompt.indexOf('\n\nIf phase is invitation');
  return JSON.parse(prompt.slice(start, end));
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function openScene(extra: Partial<Parameters<typeof beginPrivateScene>[0]> = {}): PrivateSceneRecord {
  const result = beginPrivateScene({
    sceneId: 'private-scene-2-julia', macroTurn: 2, player, npc: julia, knownEntityIds: ['julia'],
    opening: 'Mother, a word.', response: response(), existing: [], composure: composure(), ...extra,
  });
  if (!result.ok) throw new Error(result.error);
  return result.scene;
}

describe('D50: the NPC prompt', () => {
  it('tells the NPC each of ITS hidden subjects\' tier, with the fixed instruction per tier - outward marks and open ties are not subjects', () => {
    const { systemInstruction, prompt } = buildPrivateScenePrompt(buildScenePromptInput(player, julia, opening, 1, composure()));
    expect(contextOf(prompt).npc.composure).toEqual([
      { subject: 'mark:grief', of: 'NPC_MARK_NAME_SENTINEL', kind: 'mark', tier: 'frays' },
      { subject: 'tie:origen', of: 'the circle of Origen', kind: 'tie', tier: 'holds' },
    ]);
    for (const tier of ['holds', 'frays', 'breaks'] as const) {
      expect(systemInstruction).toContain(`- ${tier}: ${COMPOSURE_TIER_INSTRUCTIONS[tier]}`);
    }
    // The dice never ride.
    expect(prompt).not.toMatch(/"(?:roll|modifier|difficulty|seed)"/);
  });

  it('SENTINEL: of the player\'s inward marks and secret ties, ONLY the code-written tells reach the NPC', () => {
    const all = (c?: PrivateSceneComposure) => {
      const { systemInstruction, prompt } = buildPrivateScenePrompt(buildScenePromptInput(player, julia, opening, 1, c));
      return { request: `${systemInstruction}\n${prompt}`, tells: contextOf(prompt).player.tells };
    };
    // A mark that breaks: its NAME, once, inside the exact line; a tie that frays: a hint, never its name.
    const broke = all(composure());
    expect(broke.tells).toEqual([
      'It shows plainly on Severus Alexander: INWARD_DREAD_MARKER.',
      'Severus Alexander lets slip a hint of some private devotion or allegiance — a gesture, a word caught back.',
    ]);
    expect(countOf(broke.request, 'INWARD_DREAD_MARKER')).toBe(1);
    expect(broke.request).not.toContain('PLAYER_MARK_ACCOUNT_SENTINEL');
    expect(broke.request).not.toContain('PLAYER_SECRET_TIE_SENTINEL');
    expect(broke.request).not.toContain('PLAYER_OUTWARD_ACCOUNT_SENTINEL');
    // A tie that breaks: its KIND, never its name; a mark that frays: never its name.
    const tieBroke = all(composure({ player: playerRolls('frays', 'breaks') }));
    expect(tieBroke.tells).toEqual([
      'Something weighs on Severus Alexander: at moments it shows in the voice or the eyes, its cause unspoken.',
      'Severus Alexander shows plain signs of some secret faith, though it goes unnamed.',
    ]);
    expect(tieBroke.request).not.toContain('INWARD_DREAD_MARKER');
    expect(tieBroke.request).not.toContain('PLAYER_SECRET_TIE_SENTINEL');
    // Everything held: nothing at all.
    const held = all(composure({ player: playerRolls('holds', 'holds') }));
    expect(held.tells).toBeUndefined();
    for (const sentinel of ['INWARD_DREAD_MARKER', 'PLAYER_SECRET_TIE_SENTINEL', 'PLAYER_MARK_ACCOUNT_SENTINEL']) {
      expect(held.request).not.toContain(sentinel);
    }
  });

  it('rolls both parties once from one seed - the NPC\'s first, then the player\'s - with code\'s line for each', () => {
    const a = rollSceneComposure(player, julia, 1234);
    expect(rollSceneComposure(player, julia, 1234)).toEqual(a);
    expect(a.seed).toBe(1234);
    expect(a.npc.map(roll => roll.subjectId)).toEqual(['grief', 'origen']);
    expect(a.player.map(roll => roll.subjectId)).toEqual(['dread', 'lararium']);
    for (const roll of a.player) expect(roll.told).toBe(playerComposureTell(roll, player));
  });
});

describe('D50: the reply boundary', () => {
  it('never refuses a reply over a bad delivery or sign - code drops them instead', () => {
    for (const extra of [
      { delivery: null, signs: 'not a list' },
      { delivery: 'I rolled a natural 20', signs: [{ subject: 'mark:grief', sign: 'Trust level 8/10.' }] },
      { delivery: 42, signs: [null, { subject: 7 }] },
    ]) {
      const parsed = zPrivateSceneModelResponse.safeParse({ ...response(), ...extra });
      expect(parsed.success, JSON.stringify(extra)).toBe(true);
      expect(screenNpcTells(parsed.data!, julia, composure().npc)).toEqual({ signs: [] });
    }
    // The rest of the reply is still held to its rules.
    expect(zPrivateSceneModelResponse.safeParse({ ...response(), npcUtterance: 'I rolled a natural 20.', delivery: 'coldly' }).success).toBe(false);
  });
});

describe('D50: the scene record', () => {
  it('keeps the composure GM-side, the delivery on the NPC line, and a sign only for a subject that did not hold', () => {
    const scene = openScene({
      tells: {
        delivery: 'voice catching',
        signs: [
          { subject: 'mark:grief', sign: 'Her voice catches.' },
          // Handed straight to the model, past the controller's screen: the record still refuses it.
          { subject: 'tie:origen', sign: 'She murmurs a prayer.' },
        ],
      },
    });
    expect(scene.composureSeed).toBe(42);
    expect(scene.npcComposure).toEqual(composure().npc);
    expect(scene.playerComposure).toEqual(composure().player);
    expect(scene.transcript[1]).toEqual({ sequence: 2, speaker: 'npc', text: 'Speak, my son.', delivery: 'voice catching' });
    expect(scene.composureSigns).toEqual([{ subject: 'mark:grief', sign: 'Her voice catches.', exchange: 1 }]);
  });

  it('a later reply adds its signs under its exchange, never re-rolls, and never lands an invalid delivery', () => {
    const scene = openScene();
    const next = appendPrivateSceneExchange({
      scene, expectedNpcResponseCount: 1, playerUtterance: 'You seem troubled.',
      response: response({ speechActs: [{ speaker: 'npc', kind: 'claim', text: 'Speak, my son.', exchange: 2 }] }),
      tells: { delivery: 'with a glance at Philip', signs: [{ subject: 'mark:grief', sign: 'She looks away.' }] },
    });
    if (!next.ok) throw new Error(next.error);
    expect(next.scene.npcComposure).toEqual(scene.npcComposure);
    expect(next.scene.playerComposure).toEqual(scene.playerComposure);
    expect(next.scene.composureSeed).toBe(42);
    expect(next.scene.transcript[3]).not.toHaveProperty('delivery');
    expect(next.scene.composureSigns).toEqual([{ subject: 'mark:grief', sign: 'She looks away.', exchange: 2 }]);
  });

  it('lets the NPC remember exactly what it was told of the player, through its existing audience memory', () => {
    const ended = endPrivateScene(openScene());
    if (!ended.ok) throw new Error(ended.error);
    const closed = finalizePrivateScene(ended.scene, null);
    if (!closed.ok) throw new Error(closed.error);
    const [memory] = buildPrivateSceneNpcMemoryProjection([closed.scene], 'julia');
    expect(memory.playerTells).toEqual(composure().player.map(roll => roll.told));
    const block = buildPrivateSceneNpcMemoryBlock([memory]);
    expect(block).toContain('What you noticed of them');
    expect(block).toContain(JSON.stringify('It shows plainly on Severus Alexander: INWARD_DREAD_MARKER.'));
    expect(block).not.toContain('PLAYER_SECRET_TIE_SENTINEL');
  });
});

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
afterEach(async () => {
  while (mounted.length) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  vi.restoreAllMocks();
});

function renderScene(scene: PrivateSceneRecord): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<PrivateScene
    scenes={[projectPrivateSceneForPlayer(scene)]} currentMacroTurn={scene.macroTurn} canStartScene={false}
    eligibleTargets={[]} openingDraft="" replyDraft="" lastWordDraft="" loading={false} error={null}
    onOpeningDraftChange={() => {}} onReplyDraftChange={() => {}} onLastWordDraftChange={() => {}}
    onInvite={() => {}} onReply={() => {}} onEnd={() => {}} onLastWord={() => {}} onSkipLastWord={() => {}}
  />));
  act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!.click());
  return container;
}

describe('D50: what the player sees', () => {
  it('projects the player\'s composure in words - the outcome and the exact line - and nothing GM-side', () => {
    const scene = openScene({ tells: { delivery: 'voice catching', signs: [{ subject: 'mark:grief', sign: 'Her voice catches.' }] } });
    const view = projectPrivateSceneForPlayer(scene);
    expect(view.composureNotes).toEqual([
      { subjectKind: 'mark', subjectName: 'INWARD_DREAD_MARKER', outcome: 'broke', told: 'It shows plainly on Severus Alexander: INWARD_DREAD_MARKER.' },
      { subjectKind: 'tie', subjectName: 'PLAYER_SECRET_TIE_SENTINEL', tieKind: 'religion', outcome: 'frayed', told: 'Severus Alexander lets slip a hint of some private devotion or allegiance — a gesture, a word caught back.' },
    ]);
    expect(JSON.stringify(view.composureNotes)).not.toMatch(/\d/);
    const serialized = JSON.stringify(view);
    for (const hidden of ['npcComposure', 'playerComposure', 'composureSigns', 'composureSeed', 'NPC_MARK_NAME_SENTINEL', 'Her voice catches.', '"grief"']) {
      expect(serialized).not.toContain(hidden);
    }
    expect(view.transcript[1].delivery).toBe('voice catching');
  });

  it('renders each note - held, frayed or broke, what it means, exactly what the NPC was told - with no number, and the delivery as a stage direction', () => {
    const scene = openScene({
      composure: composure({ player: playerRolls('holds', 'breaks') }),
      tells: { delivery: 'voice catching', signs: [] },
    });
    const container = renderScene(scene);
    const note = container.querySelector<HTMLElement>('.gor-composure')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain(COMPOSURE_COPY.title);
    expect(note.textContent).toContain('Held');
    expect(note.textContent).toContain(COMPOSURE_COPY.meaning.mark.held);
    expect(note.textContent).toContain('Julia Mamaea was told nothing of it.');
    expect(note.textContent).toContain('Broke');
    expect(note.textContent).toContain('It showed plainly that you keep some secret faith, though not which.');
    expect(note.textContent).toContain('What Julia Mamaea was told:');
    expect(note.querySelector('q')!.textContent).toBe('Severus Alexander shows plain signs of some secret faith, though it goes unnamed.');
    expect(note.textContent).not.toMatch(/\d/);
    const delivery = container.querySelector<HTMLElement>('.gor-scene-delivery')!;
    expect(delivery.tagName).toBe('EM');
    expect(delivery.textContent).toBe('(voice catching)');
    expect(container.textContent).not.toContain('NPC_MARK_NAME_SENTINEL');
  });

  it('shows the notes again on the shelf once the scene is closed', () => {
    const ended = endPrivateScene(openScene());
    if (!ended.ok) throw new Error(ended.error);
    const closed = finalizePrivateScene(ended.scene, null);
    if (!closed.ok) throw new Error(closed.error);
    const container = renderScene({ ...closed.scene, macroTurn: 1 });
    expect(container.querySelector('.gor-shelf-pane .gor-composure')).not.toBeNull();
  });
});

const AUDIO_RESPONSE = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };

describe('D50: the voice performs only what the text shows', () => {
  it('opens the line with its validated delivery as one cue - and never a cue from an invalid delivery', () => {
    expect(sceneLineForSpeech({ text: '*She sets down her cup.* Speak, my son.', delivery: 'voice catching' })).toBe('<voice catching> Speak, my son.');
    expect(sceneLineForSpeech({ text: 'Speak, my son.' })).toBe('Speak, my son.');
    for (const delivery of ['with a glance at Philip', 'sighing 3 times', 'with "irony"', 'x'.repeat(80)]) {
      expect(sceneLineForSpeech({ text: 'Speak, my son.', delivery })).toBe('Speak, my son.');
    }
    expect(sceneLineForSpeech({ text: '*silence*', delivery: 'voice catching' })).toBe('');
  });

  it('hands the TTS call the cue from the player-visible delivery, and nothing from a delivery that does not validate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const generateContent = vi.fn(async (params: { config?: Record<string, unknown> }) => (params.config?.responseModalities ? AUDIO_RESPONSE : { text: 'never' }));
    const ai: GeminiClient = { models: { generateContent } };
    const hook = renderHook(usePrivateSceneVoice, { ai, isMockMode: false, resolvedApiKey: 'k', narrationVoiceMode: 'on_demand', voiceCast: null, week: 2, log: new NarrationLogStore({ load: false }) });
    act(() => hook.current.onSetEnabled(true));
    const view = projectPrivateSceneForPlayer(openScene({ tells: { delivery: 'voice catching', signs: [] } }));
    act(() => hook.current.onToggle(view, view.transcript[1]));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(generateContent.mock.calls[0][0]).toMatchObject({ contents: '## Transcript:\n<voice catching> Speak, my son.' });

    // A delivery that does not validate (a hand-edited view) is never acted.
    const forged = { ...view, sceneId: 'forged', transcript: [view.transcript[0], { ...view.transcript[1], delivery: 'NPC_MARK_NAME_SENTINEL' }] };
    act(() => hook.current.onToggle(forged, forged.transcript[1]));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(generateContent.mock.calls[1][0]).toMatchObject({ contents: '## Transcript:\nSpeak, my son.' });
    expect(JSON.stringify(generateContent.mock.calls)).not.toContain('NPC_MARK_NAME_SENTINEL');
    hook.unmount();
  });
});

describe('D50: signs seen on Personae', () => {
  it('keeps a sign as a witnessed claim - figure and sentence only - and shows it, never the mark or tie behind it', async () => {
    const knowledge = ingestSignsSeen([], [{ entityId: 'julia', sign: 'Her voice catches when the Guard is named.' }], 2);
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({ subject: 'julia', claimKey: 'sign:julia', updates: [{ turn: 2, source: 'witnessed', text: 'Her voice catches when the Guard is named.' }] });
    const more = ingestSignsSeen(knowledge, [{ entityId: 'julia', sign: 'She does not finish her prayer.' }], 3);
    expect(signsSeenOf(more, 'julia')).toEqual([
      { text: 'Her voice catches when the Guard is named.', turn: 2 },
      { text: 'She does not finish her prayer.', turn: 3 },
    ]);
    expect(ingestSignsSeen(more, [], 4)).toBe(more);
    // The same tell, whatever its case or spacing, is not kept twice.
    const again = ingestSignsSeen(more, [{ entityId: 'julia', sign: '  her voice CATCHES when the Guard   is named. ' }], 4);
    expect(signsSeenOf(again, 'julia')).toHaveLength(2);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
    await act(async () => {
      root.render(<DramatisPersonaeTab
        playerEntity={player} entities={[player, julia]} knowledge={more} turnNumber={4}
        onSpendDeepAnalysis={() => {}} onInvestigationOutcome={() => {}} runDomainMutation={runDomainMutation}
        ai={{} as GoogleGenAI} isMockMode={true}
      />);
    });
    expect(container.textContent).toContain('Signs seen');
    expect(container.textContent).toContain('Her voice catches when the Guard is named.');
    expect(container.textContent).toContain('She does not finish her prayer.');
    for (const hidden of ['NPC_MARK_NAME_SENTINEL', 'NPC_MARK_ACCOUNT_SENTINEL', 'grief', 'the circle of Origen', 'origen']) {
      expect(container.textContent).not.toContain(hidden);
    }
  });
});

/** A seed whose scene composure gives Julia's mark and faith these tiers. */
function seedFor(markTier: ComposureRoll['tier'], tieTier: ComposureRoll['tier']): number {
  for (let seed = 1; seed < 100_000; seed++) {
    const rolled = rollSceneComposure(player, julia, seed);
    if (rolled.npc[0].tier === markTier && rolled.npc[1].tier === tieTier) return seed;
  }
  throw new Error('no seed');
}

describe('D50: the controller, in Mock Mode', () => {
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const committed: GameAction[] = [];
  const deps = (scenesRef: { current: PrivateSceneRecord[] }, knowledge: KnowledgeClaim[] = []): PrivateSceneControllerDeps => ({
    ai: {} as GoogleGenAI,
    isMockMode: true,
    online: true,
    privateScenes: scenesRef.current,
    playerEntity: player,
    entities: [player, julia],
    privateSceneKnownIds: ['julia'],
    knowledge,
    turnNumber: 2,
    privateSceneInteractionLocked: false,
    runDomainMutation: (async (work: Parameters<RunDomainMutation>[0]) => ({ acquired: true, value: await work({ isCurrent: () => true }) })) as RunDomainMutation,
    commitDomainMutation: (commit: DomainCommit) => { commit.beforeDispatch?.(); committed.push(commit.action); commit.onCommitted?.(); return true; },
    buildSaveState: () => ({}) as SaveGameState,
    privateSceneLockRef: { current: false },
    privateScenesRef: scenesRef,
  });

  it('rolls once as the scene opens, keeps it through a reload, records what showed as a sign - and never rolls again', async () => {
    committed.length = 0;
    const seed = seedFor('frays', 'holds');
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, deps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('Mother, a word.'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(seed / 0x100000000);
    act(() => hook.current.handlePrivateSceneInvite('julia'));
    await settle();
    random.mockRestore();

    const scene = scenesRef.current[0];
    expect(scene.composureSeed).toBe(seed);
    expect(scene.npcComposure!.map(roll => roll.tier)).toEqual(['frays', 'holds']);
    expect(scene.playerComposure).toEqual(rollSceneComposure(player, julia, seed).player);
    // The mock NPC let the fraying mark show: a delivery for its line, one sign.
    expect(scene.transcript[1].delivery).toBe('voice catching');
    expect(scene.composureSigns).toEqual([{ subject: 'mark:grief', sign: 'A catch comes into their voice, and they look away.', exchange: 1 }]);
    const first = committed[0] as Extract<GameAction, { type: 'PRIVATE_SCENES_COMMITTED' }>;
    expect(first.knowledge).toBeDefined();
    expect(signsSeenOf(first.knowledge!, 'julia')).toEqual([{ text: 'A catch comes into their voice, and they look away.', turn: 2 }]);
    expect(JSON.stringify(first.knowledge)).not.toMatch(/grief|NPC_MARK|Origen|origen/);
    // The Personae coin counts it once: now, in the interlude after week 1 -
    // and not again when week 2 (the week the scene was held in) lands.
    expect(tabChangeCountsFor([], first.knowledge!, makeTurnHistoryEntry({ turnNumber: 1 })).get('dramatis_personae')).toBe(1);
    expect(tabChangeCountsFor([], first.knowledge!, makeTurnHistoryEntry({ turnNumber: 2 })).has('dramatis_personae')).toBe(false);

    // Reload: the persisted scene comes back whole - the same rolls, the same seed.
    const reloaded = normalizeLoadedPrivateScenes(JSON.parse(JSON.stringify(scenesRef.current)));
    expect(reloaded).toEqual(scenesRef.current);
    scenesRef.current = reloaded;
    hook.rerender(deps(scenesRef, first.knowledge));

    // A reply reads the composure back from the record: no new seed is drawn.
    const draws = vi.spyOn(Math, 'random');
    act(() => hook.current.setPrivateSceneReplyDraft('You look pale, mother.'));
    act(() => hook.current.handlePrivateSceneReply(scene.sceneId));
    await settle();
    expect(draws).not.toHaveBeenCalled();
    const after = scenesRef.current[0];
    expect(after.npcResponseCount).toBe(2);
    expect(after.composureSeed).toBe(seed);
    expect(after.npcComposure).toEqual(scene.npcComposure);
    expect(after.playerComposure).toEqual(scene.playerComposure);
    expect(after.composureSigns).toHaveLength(2);
    hook.unmount();
  });

  it('when everything holds, the NPC shows nothing and the player keeps no sign', async () => {
    committed.length = 0;
    const seed = seedFor('holds', 'holds');
    const scenesRef = { current: [] as PrivateSceneRecord[] };
    const hook = renderHook(usePrivateSceneController, deps(scenesRef));
    act(() => hook.current.setPrivateSceneOpeningDraft('Mother, a word.'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(seed / 0x100000000);
    act(() => hook.current.handlePrivateSceneInvite('julia'));
    await settle();
    random.mockRestore();
    const scene = scenesRef.current[0];
    expect(scene.transcript[1]).not.toHaveProperty('delivery');
    expect(scene.composureSigns).toBeUndefined();
    expect((committed[0] as Extract<GameAction, { type: 'PRIVATE_SCENES_COMMITTED' }>).knowledge).toBeUndefined();
    hook.unmount();
  });
});

describe('D50: the save boundary', () => {
  it('loads a scene saved before D50 unchanged, and drops a malformed composure field or a forged delivery rather than the scene', () => {
    const legacy: PrivateSceneRecord = {
      sceneId: 's', macroTurn: 1, playerId: 'player', npcId: 'julia', playerName: 'Severus', npcName: 'Julia',
      status: 'active', transcript: [{ sequence: 1, speaker: 'player', text: 'Hail.' }, { sequence: 2, speaker: 'npc', text: 'Hail.' }],
      npcResponseCount: 1, speechActs: [], npcPrivate: { sincerity: 'x', hiddenIntent: 'y', plannedFollowThrough: [] }, consequenceStatus: 'pending',
    };
    expect(normalizeLoadedPrivateScenes([legacy])).toEqual([legacy]);
    const damaged = {
      ...legacy,
      transcript: [legacy.transcript[0], { ...legacy.transcript[1], delivery: 'with a glance at Philip' }],
      composureSeed: 'soon',
      npcComposure: [npcRoll('grief', 'frays'), { subjectKind: 'mark', roll: 99 }],
      playerComposure: 'nope',
      composureSigns: [{ subject: 'grief', sign: 'Her voice catches.', exchange: 1 }, { subject: 'grief' }],
      smuggled: 'POISON',
    };
    const [loaded] = normalizeLoadedPrivateScenes([damaged]);
    expect(loaded.transcript[1]).toEqual({ sequence: 2, speaker: 'npc', text: 'Hail.' });
    expect(loaded).not.toHaveProperty('composureSeed');
    expect(loaded).not.toHaveProperty('playerComposure');
    expect(loaded).not.toHaveProperty('smuggled');
    expect(loaded.npcComposure).toEqual([npcRoll('grief', 'frays')]);
    expect(loaded.composureSigns).toEqual([{ subject: 'mark:grief', sign: 'Her voice catches.', exchange: 1 }]);

    // A roll saved before handles gains its handle; a bare sign id two subjects share cannot be placed, and is dropped.
    const { handle: _handle, ...unhandled } = npcRoll('grief', 'frays');
    const shared = { ...npcRoll('origen', 'frays'), subjectId: 'grief', handle: 'tie:grief' };
    const [ambiguous] = normalizeLoadedPrivateScenes([{ ...legacy, npcComposure: [unhandled, shared], composureSigns: [{ subject: 'grief', sign: 'Which?', exchange: 1 }, { subject: 'tie:grief', sign: 'This one.', exchange: 1 }] }]);
    expect(ambiguous.npcComposure!.map(roll => roll.handle)).toEqual(['mark:grief', 'tie:grief']);
    expect(ambiguous.composureSigns).toEqual([{ subject: 'tie:grief', sign: 'This one.', exchange: 1 }]);
  });
});

describe('D50: the Mock Mode NPC', () => {
  const input = (tiers: ComposureRoll['tier'][]) => buildScenePromptInput(player, julia, opening, 1, composure({
    npc: [npcRoll('grief', tiers[0]), npcRoll('origen', tiers[1])],
  }));

  it('shows a subject that frays or breaks - a delivery and a sign - and nothing for one that holds, deterministically', () => {
    expect(mockContinuePrivateScene(input(['frays', 'holds']))).toMatchObject({
      delivery: 'voice catching', signs: [{ subject: 'mark:grief', sign: 'A catch comes into their voice, and they look away.' }],
    });
    expect(mockContinuePrivateScene(input(['holds', 'breaks']))).toMatchObject({
      delivery: 'as if fighting to keep it down', signs: [{ subject: 'tie:origen', sign: 'It is plain in their face and bearing, whatever they say.' }],
    });
    const held = mockContinuePrivateScene(input(['holds', 'holds']));
    expect(held).not.toHaveProperty('delivery');
    expect(held).not.toHaveProperty('signs');
    expect(mockContinuePrivateScene(input(['frays', 'holds']))).toEqual(mockContinuePrivateScene(input(['frays', 'holds'])));
  });
});
