import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Entity } from '../types';
import {
  PRIVATE_SCENE_MAX_NPC_RESPONSES,
  PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  appendPrivateSceneExchange,
  buildPrivateSceneAdjudicatorProjection,
  buildPrivateSceneNpcMemoryProjection,
  beginPrivateScene,
  consumePrivateSceneOutcome,
  eligiblePrivateSceneTargets,
  endPrivateScene,
  finalizePrivateScene,
  selectPendingPrivateSceneOutcome,
  type PrivateSceneModelResponse,
  type PrivateSceneRecord,
  type PrivateSceneTransitionResult,
} from '../privateScene/model';
import { makeEntity as baseMakeEntity } from './factories';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return baseMakeEntity({ location: 'The Curia', ...overrides });
}

function response(
  disposition: PrivateSceneModelResponse['disposition'] = 'continues',
  exchange = 1,
): PrivateSceneModelResponse {
  return {
    disposition,
    npcUtterance: '  I hear you.  ',
    speechActs: [
      { speaker: 'npc', kind: 'promise', text: '  I will consider it.  ', exchange },
    ],
    npcPrivate: {
      sincerity: '  guarded  ',
      hiddenIntent: '  Learn what Gaius knows.  ',
      plannedFollowThrough: ['  Consult the household.  '],
    },
  };
}

const ACTIVE_SCENE: PrivateSceneRecord = {
  sceneId: 'scene_7_1',
  macroTurn: 7,
  playerId: 'player_1',
  npcId: 'npc_network',
  playerName: 'Gaius Testus',
  npcName: 'Livia',
  status: 'active',
  transcript: [
    { sequence: 1, speaker: 'player', text: 'Stand with me.' },
    { sequence: 2, speaker: 'npc', text: 'I hear you.' },
  ],
  npcResponseCount: 1,
  speechActs: [
    { speaker: 'player', kind: 'unclassified', text: 'Stand with me.', exchange: 1 },
    { speaker: 'npc', kind: 'promise', text: 'I will consider it.', exchange: 1 },
  ],
  npcPrivate: {
    sincerity: 'guarded',
    hiddenIntent: 'Learn what Gaius knows.',
    plannedFollowThrough: ['Consult the household.'],
  },
  consequenceStatus: 'pending',
};

function cloneScene(scene: PrivateSceneRecord): PrivateSceneRecord {
  return structuredClone(scene);
}

function expectSuccess(result: PrivateSceneTransitionResult): PrivateSceneRecord {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.scene;
}

describe('private scene eligibility', () => {
  it('admits only known, living, non-player individuals reached by exact co-location or the player network', () => {
    const player = makeEntity({ visibility_network: ['npc_network', 'npc_hidden_network'] });
    const candidates = [
      player,
      makeEntity({ entity_id: 'npc_local', name: 'Local Livia' }),
      makeEntity({ entity_id: 'npc_network', name: 'Network Nerva', location: 'Ostia' }),
      makeEntity({ entity_id: 'npc_hidden_local', name: 'Hidden Local' }),
      makeEntity({ entity_id: 'npc_hidden_network', name: 'Hidden Network', location: 'Ostia' }),
      makeEntity({ entity_id: 'npc_distant', name: 'Distant Decimus', location: 'Ostia' }),
      makeEntity({ entity_id: 'npc_dead', name: 'Dead Drusus', status: 'dead' }),
      makeEntity({ entity_id: 'npc_exiled', name: 'Exiled Ennia', status: 'exiled' }),
      makeEntity({ entity_id: 'known_group', name: 'Known Group', entity_type: 'group' }),
      makeEntity({ entity_id: 'known_faction', name: 'Known Faction', entity_type: 'faction' }),
    ];

    expect(eligiblePrivateSceneTargets({
      player,
      entities: candidates,
      knownEntityIds: [
        'player_1',
        'npc_local',
        'npc_network',
        'npc_distant',
        'npc_dead',
        'npc_exiled',
        'known_group',
        'known_faction',
      ],
    // WP-16: position and location ride along for the doorway's contact
    // cards. Both are facts about an entity the eligibility filter has
    // already required the player to know; `position` is absent on these
    // fixtures, so it stays off the projection entirely.
    })).toEqual([
      { entityId: 'npc_local', displayName: 'Local Livia', location: 'The Curia' },
      { entityId: 'npc_network', displayName: 'Network Nerva', location: 'Ostia' },
    ]);
  });
});

describe('beginPrivateScene', () => {
  const player = makeEntity({ visibility_network: ['npc_network'] });
  const npc = makeEntity({ entity_id: 'npc_network', name: 'Livia', location: 'Ostia' });

  it('records the authoritative trimmed opening as a code-owned player act before NPC acts', () => {
    const scene = expectSuccess(beginPrivateScene({
      sceneId: 'scene_exact_terms',
      macroTurn: 7,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: '  Place the Third Legion under my command.  ',
      response: {
        ...response(),
        speechActs: [{ speaker: 'npc', kind: 'agreement', text: 'Agreed.', exchange: 1 }],
      },
      existing: [],
    }));

    expect(scene.speechActs).toEqual([
      {
        speaker: 'player',
        kind: 'unclassified',
        text: 'Place the Third Legion under my command.',
        exchange: 1,
      },
      { speaker: 'npc', kind: 'agreement', text: 'Agreed.', exchange: 1 },
    ]);
    expect(buildPrivateSceneAdjudicatorProjection({
      ...scene,
      status: 'closed',
      closureReason: 'player_ended',
    }).speechActs[0]).toEqual({
      speaker: 'player',
      kind: 'unclassified',
      text: 'Place the Third Legion under my command.',
    });
  });

  it('rejects provider-authored player acts at the transition boundary', () => {
    expect(beginPrivateScene({
      sceneId: 'scene_fabricated_player_act',
      macroTurn: 7,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: 'State my terms exactly.',
      response: {
        ...response(),
        speechActs: [{ speaker: 'player', kind: 'request', text: 'Fabricated terms.', exchange: 1 }],
      },
      existing: [],
    })).toMatchObject({ ok: false });
  });

  it('commits a trimmed accepted opening as NPC response 1 without retaining mutable response aliases', () => {
    const modelResponse = response();
    const result = beginPrivateScene({
      sceneId: '  scene_7_1  ',
      macroTurn: 7,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: '  Stand with me.  ',
      response: modelResponse,
      existing: [],
    });
    const scene = expectSuccess(result);

    expect(scene).toEqual(ACTIVE_SCENE);
    expect(Object.keys(result).sort()).toEqual(['ok', 'scene']);
    expect(scene).not.toHaveProperty('worldState');
    expect(scene).not.toHaveProperty('entities');
    expect(scene).not.toHaveProperty('deltas');

    modelResponse.speechActs[0].text = 'MUTATED';
    modelResponse.npcPrivate.plannedFollowThrough[0] = 'MUTATED';
    expect(scene.speechActs[0].text).toBe('Stand with me.');
    expect(scene.speechActs[1].text).toBe('I will consider it.');
    expect(scene.npcPrivate.plannedFollowThrough).toEqual(['Consult the household.']);
  });

  it('records an opening refusal as response 1 and awaits the optional player last word', () => {
    const scene = expectSuccess(beginPrivateScene({
      sceneId: 'scene_refused',
      macroTurn: 8,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: 'Help me.',
      response: response('refused'),
      existing: [],
    }));

    expect(scene.npcResponseCount).toBe(1);
    expect(scene.status).toBe('awaiting_last_word');
    expect(scene.closureReason).toBe('refused');
    expect(scene.consequenceStatus).toBe('pending');
  });

  it('rejects a second committed scene in the same macro turn and leaves existing records untouched', () => {
    const existing = [cloneScene(ACTIVE_SCENE)];
    const before = structuredClone(existing);

    expect(beginPrivateScene({
      sceneId: 'scene_7_2',
      macroTurn: 7,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: 'Another audience.',
      response: response(),
      existing,
    })).toMatchObject({ ok: false });
    expect(existing).toEqual(before);
  });

  it('rejects a target absent from the perception-safe known-entity IDs even when network-accessible', () => {
    const modelResponse = response();
    const before = structuredClone(modelResponse);

    expect(beginPrivateScene({
      sceneId: 'scene_unknown',
      macroTurn: 9,
      player,
      npc,
      knownEntityIds: [],
      opening: 'Reveal yourself.',
      response: modelResponse,
      existing: [],
    })).toMatchObject({ ok: false });
    expect(modelResponse).toEqual(before);
  });

  it.each([
    ['active', cloneScene(ACTIVE_SCENE)],
    ['awaiting a last word', {
      ...cloneScene(ACTIVE_SCENE),
      status: 'awaiting_last_word' as const,
      closureReason: 'player_ended' as const,
    }],
  ])('rejects a new scene when an earlier-turn scene is %s', (_label, existingScene) => {
    const existing = [{ ...existingScene, macroTurn: 6 }];
    const before = structuredClone(existing);

    expect(beginPrivateScene({
      sceneId: 'scene_9_1',
      macroTurn: 9,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening: 'A new audience.',
      response: response(),
      existing,
    })).toMatchObject({ ok: false });
    expect(existing).toEqual(before);
  });

  it.each([
    ['an empty opening', '', response()],
    ['a whitespace-only opening', '   ', response()],
    ['an over-limit opening', 'x'.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS + 1), response()],
    ['an over-limit NPC utterance', 'Speak.', { ...response(), npcUtterance: 'x'.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS + 1) }],
    ['a provider-owned unclassified act', 'Speak.', {
      ...response(),
      speechActs: [{ speaker: 'npc' as const, kind: 'unclassified' as const, text: 'No.', exchange: 1 }],
    }],
    ['a wrong opening exchange', 'Speak.', response('continues', 2)],
  ])('rejects %s instead of throwing', (_label, opening, modelResponse) => {
    expect(beginPrivateScene({
      sceneId: 'scene_invalid',
      macroTurn: 9,
      player,
      npc,
      knownEntityIds: ['npc_network'],
      opening,
      response: modelResponse,
      existing: [],
    })).toMatchObject({ ok: false });
  });
});

describe('appendPrivateSceneExchange', () => {
  it('records the authoritative trimmed reply as a code-owned player act before NPC acts', () => {
    const scene = expectSuccess(appendPrivateSceneExchange({
      scene: cloneScene(ACTIVE_SCENE),
      expectedNpcResponseCount: 1,
      playerUtterance: '  March at dawn, not before.  ',
      response: {
        ...response('continues', 2),
        speechActs: [{ speaker: 'npc', kind: 'agreement', text: 'At dawn.', exchange: 2 }],
      },
    }));

    expect(scene.speechActs.slice(-2)).toEqual([
      { speaker: 'player', kind: 'unclassified', text: 'March at dawn, not before.', exchange: 2 },
      { speaker: 'npc', kind: 'agreement', text: 'At dawn.', exchange: 2 },
    ]);
  });

  it('appends one immutable exchange and advances the predecessor count', () => {
    const source = cloneScene(ACTIVE_SCENE);
    const before = cloneScene(source);
    const scene = expectSuccess(appendPrivateSceneExchange({
      scene: source,
      expectedNpcResponseCount: 1,
      playerUtterance: '  Then decide quickly.  ',
      response: response('continues', 2),
    }));

    expect(scene).not.toBe(source);
    expect(scene.transcript).not.toBe(source.transcript);
    expect(scene.speechActs).not.toBe(source.speechActs);
    expect(scene.npcPrivate).not.toBe(source.npcPrivate);
    expect(scene.npcResponseCount).toBe(2);
    expect(scene.transcript.slice(-2)).toEqual([
      { sequence: 3, speaker: 'player', text: 'Then decide quickly.' },
      { sequence: 4, speaker: 'npc', text: 'I hear you.' },
    ]);
    expect(scene.speechActs.slice(-2)).toEqual([
      { speaker: 'player', kind: 'unclassified', text: 'Then decide quickly.', exchange: 2 },
      { speaker: 'npc', kind: 'promise', text: 'I will consider it.', exchange: 2 },
    ]);
    expect(source).toEqual(before);
  });

  it.each([
    ['a stale predecessor count', cloneScene(ACTIVE_SCENE), 0, response('continues', 2)],
    ['a stale speech-act exchange', cloneScene(ACTIVE_SCENE), 1, response('continues', 1)],
    ['a scene already awaiting a last word', { ...cloneScene(ACTIVE_SCENE), status: 'awaiting_last_word' as const, closureReason: 'npc_ended' as const }, 1, response('continues', 2)],
    ['a closed scene', { ...cloneScene(ACTIVE_SCENE), status: 'closed' as const, closureReason: 'player_ended' as const }, 1, response('continues', 2)],
    ['a seventh NPC response', { ...cloneScene(ACTIVE_SCENE), npcResponseCount: PRIVATE_SCENE_MAX_NPC_RESPONSES }, PRIVATE_SCENE_MAX_NPC_RESPONSES, response('continues', PRIVATE_SCENE_MAX_NPC_RESPONSES + 1)],
  ])('rejects %s without mutating the scene', (_label, source, expectedNpcResponseCount, modelResponse) => {
    const before = structuredClone(source);
    expect(appendPrivateSceneExchange({
      scene: source,
      expectedNpcResponseCount,
      playerUtterance: 'Continue.',
      response: modelResponse,
    })).toMatchObject({ ok: false });
    expect(source).toEqual(before);
  });

  it('moves an NPC-ended exchange to the one-way last-word state', () => {
    const scene = expectSuccess(appendPrivateSceneExchange({
      scene: cloneScene(ACTIVE_SCENE),
      expectedNpcResponseCount: 1,
      playerUtterance: 'Will you help?',
      response: response('ends', 2),
    }));

    expect(scene.status).toBe('awaiting_last_word');
    expect(scene.closureReason).toBe('npc_ended');
  });

  it('rejects a refused disposition after the invitation response without mutating the scene', () => {
    const source = cloneScene(ACTIVE_SCENE);
    const before = cloneScene(source);

    expect(appendPrivateSceneExchange({
      scene: source,
      expectedNpcResponseCount: 1,
      playerUtterance: 'Reconsider.',
      response: response('refused', 2),
    })).toMatchObject({ ok: false });
    expect(source).toEqual(before);
  });

  it('automatically ends response 6 at the hard response limit', () => {
    const scene = expectSuccess(appendPrivateSceneExchange({
      scene: { ...cloneScene(ACTIVE_SCENE), npcResponseCount: 5 },
      expectedNpcResponseCount: 5,
      playerUtterance: 'One final appeal.',
      response: response('continues', 6),
    }));

    expect(scene.npcResponseCount).toBe(PRIVATE_SCENE_MAX_NPC_RESPONSES);
    expect(scene.status).toBe('awaiting_last_word');
    expect(scene.closureReason).toBe('response_limit');
  });
});

describe('ending and finalizing', () => {
  it('lets the player end an active scene without mutating the source', () => {
    const source = cloneScene(ACTIVE_SCENE);
    const before = cloneScene(source);
    const scene = expectSuccess(endPrivateScene(source));

    expect(scene.status).toBe('awaiting_last_word');
    expect(scene.closureReason).toBe('player_ended');
    expect(source).toEqual(before);
  });

  it('closes with one trimmed, local player last word and a code-owned unclassified act', () => {
    const awaiting = expectSuccess(endPrivateScene(cloneScene(ACTIVE_SCENE)));
    const sourceBefore = cloneScene(awaiting);
    const scene = expectSuccess(finalizePrivateScene(awaiting, '  Remember this.  '));

    expect(scene.status).toBe('closed');
    expect(scene.lastWord).toBe('Remember this.');
    expect(scene.transcript.at(-1)).toEqual({ sequence: 3, speaker: 'player', text: 'Remember this.' });
    expect(scene.speechActs.at(-1)).toEqual({
      speaker: 'player',
      kind: 'unclassified',
      text: 'Remember this.',
      exchange: 2,
    });
    expect(scene.npcResponseCount).toBe(1);
    expect(awaiting).toEqual(sourceBefore);
  });

  it('allows the player to decline the last word', () => {
    const awaiting = expectSuccess(endPrivateScene(cloneScene(ACTIVE_SCENE)));
    const scene = expectSuccess(finalizePrivateScene(awaiting, null));

    expect(scene.status).toBe('closed');
    expect(scene).not.toHaveProperty('lastWord');
    expect(scene.transcript).toHaveLength(2);
  });

  it('rejects a second last word, wrong status, empty text, and over-limit text without mutation', () => {
    const awaiting = expectSuccess(endPrivateScene(cloneScene(ACTIVE_SCENE)));
    const closed = expectSuccess(finalizePrivateScene(awaiting, 'Enough.'));

    for (const [source, lastWord] of [
      [closed, 'Again.'],
      [cloneScene(ACTIVE_SCENE), 'Too soon.'],
      [awaiting, '   '],
      [awaiting, 'x'.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS + 1)],
    ] as const) {
      const before = cloneScene(source);
      expect(finalizePrivateScene(source, lastWord)).toMatchObject({ ok: false });
      expect(source).toEqual(before);
    }
  });
});

describe('pending private-scene outcomes', () => {
  const closedPending: PrivateSceneRecord = {
    ...ACTIVE_SCENE,
    status: 'closed',
    closureReason: 'player_ended',
  };

  it('selects the first closed pending outcome and ignores active or consumed records', () => {
    const consumed = { ...closedPending, sceneId: 'scene_consumed', consequenceStatus: 'consumed' as const, consumedByTurn: 9 };
    const pending = { ...closedPending, sceneId: 'scene_pending', macroTurn: 8 };
    expect(selectPendingPrivateSceneOutcome([ACTIVE_SCENE, consumed, pending])).toBe(pending);
    expect(selectPendingPrivateSceneOutcome([ACTIVE_SCENE, consumed])).toBeNull();
  });

  it('immutably marks a closed pending outcome consumed on a later macro turn', () => {
    const scenes = [
      { ...cloneScene(ACTIVE_SCENE), sceneId: 'scene_active' },
      cloneScene(closedPending),
    ];
    const before = structuredClone(scenes);
    const scene = expectSuccess(consumePrivateSceneOutcome(scenes, 'scene_7_1', 8));

    expect(scene.consequenceStatus).toBe('consumed');
    expect(scene.consumedByTurn).toBe(8);
    expect(scenes).toEqual(before);
  });

  it.each([
    ['a stale scene id', 'missing', 8, closedPending],
    ['the originating macro turn', 'scene_7_1', 7, closedPending],
    ['an earlier macro turn', 'scene_7_1', 6, closedPending],
    ['an active scene', 'scene_7_1', 8, ACTIVE_SCENE],
    ['an already consumed scene', 'scene_7_1', 9, { ...closedPending, consequenceStatus: 'consumed' as const, consumedByTurn: 8 }],
  ])('rejects %s without mutating records', (_label, sceneId, consumedByTurn, candidate) => {
    const scenes = [cloneScene(candidate)];
    const before = structuredClone(scenes);
    expect(consumePrivateSceneOutcome(scenes, sceneId, consumedByTurn)).toMatchObject({ ok: false });
    expect(scenes).toEqual(before);
  });
});

describe('public transition boundary', () => {
  it('exposes only a discriminated result containing a private-scene record', () => {
    expectTypeOf<PrivateSceneTransitionResult>().toMatchTypeOf<
      | { ok: true; scene: PrivateSceneRecord }
      | { ok: false; error: string }
    >();
  });
});

describe('main-turn audience projections', () => {
  it('refuses to project an already-consumed outcome back into main adjudication', () => {
    const consumed: PrivateSceneRecord = {
      ...ACTIVE_SCENE,
      status: 'closed',
      closureReason: 'player_ended',
      consequenceStatus: 'consumed',
      consumedByTurn: 7,
    };
    expect(() => buildPrivateSceneAdjudicatorProjection(consumed)).toThrow(/pending private scene/i);
  });

  it('keeps adjudication compact while giving only the participating NPC three full copied transcripts', () => {
    const pending: PrivateSceneRecord = { ...ACTIVE_SCENE, status: 'closed', closureReason: 'player_ended', transcript: [{ sequence: 1, speaker: 'player', text: 'TRANSCRIPT_SECRET' }] };
    const unrelated: PrivateSceneRecord = { ...pending, sceneId: 'other', npcId: 'other_npc', npcName: 'Other', macroTurn: 6, transcript: [{ sequence: 1, speaker: 'player', text: 'UNRELATED_TRANSCRIPT' }] };
    const participantHistory = [1, 2, 3, 4].map(macroTurn => ({
      ...pending,
      sceneId: `participant-${macroTurn}`,
      macroTurn,
      transcript: [{ sequence: 1, speaker: 'player' as const, text: `Exact participant transcript ${macroTurn}` }],
      speechActs: [{ speaker: 'npc' as const, kind: 'claim' as const, text: `Participant memory ${macroTurn}`, exchange: 1 }],
    }));
    const adjudication = buildPrivateSceneAdjudicatorProjection(pending);
    const memory = buildPrivateSceneNpcMemoryProjection([...participantHistory, unrelated], pending.npcId);
    expect(JSON.stringify(adjudication)).not.toContain('TRANSCRIPT_SECRET');
    expect(adjudication.latestNpcInternalIntent).toBe(pending.npcPrivate.hiddenIntent);
    expect(memory).toHaveLength(3);
    expect(memory.map(item => item.speechActs[0]?.text)).toEqual([
      'Participant memory 4',
      'Participant memory 3',
      'Participant memory 2',
    ]);
    expect(memory.map(item => item.transcript[0]?.text)).toEqual([
      'Exact participant transcript 4',
      'Exact participant transcript 3',
      'Exact participant transcript 2',
    ]);
    expect(memory[0].transcript).not.toBe(participantHistory[3].transcript);
    expect(memory[0].transcript[0]).not.toBe(participantHistory[3].transcript[0]);
    expect(JSON.stringify(memory)).not.toContain('UNRELATED_TRANSCRIPT');
    expect(JSON.stringify(memory)).not.toContain('Participant memory 1');
  });
});
