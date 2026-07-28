/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { beginPrivateScene, type PrivateSceneRecord } from '../privateScene/model';
import { replacePrivateSceneForCommit } from '../components/PrivateScene';
import { getMockInitialState } from './mockData';

describe('private scene transaction candidates', () => {
  it('replaces exactly the candidate scene without mutating the prior durable record', () => {
    const state = getMockInitialState();
    const player = state.entities.find(entity => entity.entity_id === 'severus_alexander')!;
    const npc = state.entities.find(entity => entity.entity_id === 'maximinus_thrax')!;
    const transition = beginPrivateScene({
      sceneId: 'scene-2', macroTurn: 2, player, npc, knownEntityIds: [npc.entity_id], opening: 'Speak.', existing: [],
      response: { disposition: 'continues', npcUtterance: 'Then speak.', speechActs: [], npcPrivate: { sincerity: 'guarded', hiddenIntent: 'conceal', plannedFollowThrough: ['wait'] } },
    });
    expect(transition.ok).toBe(true);
    if (!transition.ok) return;
    const prior: PrivateSceneRecord[] = [transition.scene];
    const candidate = { ...transition.scene, status: 'awaiting_last_word' as const, closureReason: 'player_ended' as const };
    const committed = replacePrivateSceneForCommit(prior, candidate);
    expect(committed).toEqual([candidate]);
    expect(prior[0].status).toBe('active');
  });
});
