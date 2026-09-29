/**
 * @vitest-environment jsdom
 *
 * D49 - affiliations, openly professed or kept secret. Covers the engine
 * rules (ai/core/affiliations.ts via applyDeltas), perception (an open tie
 * is public knowledge; a secret one is seen only by a witness in the room),
 * the player's knowledge of ties (witnessed, or learned through the seam the
 * investigation wiring will use), every prompt's slice - and the sentinels:
 * the player's secret ties never reach an NPC mind or a private scene, and
 * another figure's secret tie never reaches a player-facing prompt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Affiliation, Entity, EventDelta, WorldState } from '../types';
import { applyDeltas } from '../ai/core/engine';
import { MAX_ENTITY_AFFILIATIONS, normalizeAffiliations, publicAffiliationsOf, secretAffiliationsOf } from '../ai/core/affiliations';
import { buildPlayerPerceivedDigest, buildPerceivedDigest, classifyDelta, toPreTurnRoster } from '../perception/visibility';
import { figuresInViewOf } from '../perception/npcPerception';
import { ingestLearnedAffiliation, ingestPerceivedChanges, knownAffiliationsOf } from '../knowledge/store';
import { getEntityBrief, REDACTED_PRIVATE_TIE_REASON } from '../ai/prompts/fragments';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildNpcMindPrompt } from '../ai/prompts/npcMind';
import { buildNarrationPrompt, buildPlayerMonologuePrompt, sanitizeAdjudicationForNarration } from '../ai/prompts/narration';
import { buildSimulationStateUpdatePrompt } from '../ai/prompts/intelligence';
import { buildPrivateScenePrompt as buildScenePromptInput } from '../hooks/usePrivateSceneController';
import { buildPrivateScenePrompt } from '../ai/prompts/privateScene';
import { buildCharacterCreationPrompt } from '../ai/prompts/characterCreation';
import { playerOwnsDelta } from '../ai/core/playerBoundary';
import { CharacterCreationEntitySchema, EntitySchema } from '../ai/core/schemas';
import { zEntity } from '../ai/core/zodSchemas';
import { ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { loadGame, saveGame } from '../persistence/saveGame';
import { createInitialGameState, gameReducer } from '../state/gameReducer';
import {
  buildAdjudicationPromptInput,
  makeAdjudication,
  makeEntity as baseMakeEntity,
  makeLegacySaveState,
  makeSimulationState,
} from './factories';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'entity_id' | 'name'>): Entity {
  return baseMakeEntity({ location: 'Palatine Hill', ...overrides });
}

const world: WorldState = {
  year: 235,
  week: 4,
  economic_stability: 'Stable',
  political_climate: 'Volatile',
  regions: {
    'Palatine Hill': { stability: 'Tense', controlling_faction: null, current_events: [] },
    'The Suburra': { stability: 'Stable', controlling_faction: null, current_events: [] },
  },
};

const PLAYER_SECRET = 'PLAYER_SECRET_TIE_SENTINEL';
const playerOpen: Affiliation = { id: 'state_cult', name: 'the gods of the Roman state', kind: 'religion', public: true };
const playerSecret: Affiliation = { id: 'player_secret', name: PLAYER_SECRET, kind: 'religion', public: false };
const npcSecret: Affiliation = { id: 'npc_secret', name: 'NPC_SECRET_TIE_SENTINEL', kind: 'cult', public: false };

function tieDelta(key: string, affiliation: EventDelta['affiliation'], reason = 'What happened.', extra: Partial<EventDelta> = {}): EventDelta {
  return { type: 'affiliation', key, delta: 0, reason, affiliation, ...extra };
}

const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', visibility_network: ['spy'], affiliations: [playerOpen, playerSecret] });
const courtier = makeEntity({ entity_id: 'courtier', name: 'Local Courtier' });
const spy = makeEntity({ entity_id: 'spy', name: 'Trusted Spy', location: 'The Suburra' });
const distant = makeEntity({ entity_id: 'distant', name: 'Far Senator', location: 'The Suburra' });
const roster = [player, courtier, spy, distant];

function turn(deltas: EventDelta[], before: Entity[] = roster) {
  const { updatedEntities, gmNotes } = applyDeltas(deltas, before, world, 5, 'player');
  return { after: updatedEntities, before, gmNotes };
}

describe('D49 engine: a tie taken up, given up, avowed or exposed', () => {
  it('takes up a tie in secret unless said to be open, keeping a faction link', () => {
    const { after, gmNotes } = turn([
      tieDelta('courtier:cult_of_bacchus', { change: 'join', name: 'the cult of Bacchus', kind: 'cult' }),
      tieDelta('distant:boosters', { change: 'join', name: 'the boosters of the triumph', kind: 'cause', public: true, faction_id: 'senatorial_party' }),
    ]);
    expect(gmNotes).toEqual([]);
    expect(after[1].affiliations).toEqual([{ id: 'cult_of_bacchus', name: 'the cult of Bacchus', kind: 'cult', public: false }]);
    expect(after[3].affiliations).toEqual([{ id: 'boosters', name: 'the boosters of the triumph', kind: 'cause', public: true, faction_id: 'senatorial_party' }]);
  });

  it('a tie once public is never made secret again; leave removes it; going public and exposure make it open', () => {
    const holder = { ...courtier, affiliations: [{ ...npcSecret }, { ...playerOpen, id: 'open_tie' }] };
    const rejoined = turn([tieDelta('courtier:open_tie', { change: 'join', public: false })], [player, holder]).after[1];
    expect(rejoined.affiliations!.find(tie => tie.id === 'open_tie')!.public).toBe(true);
    const exposed = turn([tieDelta('courtier:npc_secret', { change: 'expose' })], [player, holder]).after[1];
    expect(exposed.affiliations!.find(tie => tie.id === 'npc_secret')!.public).toBe(true);
    const avowed = turn([tieDelta('courtier:npc_secret', { change: 'go_public' })], [player, holder]).after[1];
    expect(avowed.affiliations!.find(tie => tie.id === 'npc_secret')!.public).toBe(true);
    const left = turn([tieDelta('courtier:npc_secret', { change: 'leave' }), tieDelta('courtier:open_tie', { change: 'leave' })], [player, holder]).after[1];
    expect('affiliations' in left).toBe(false);
  });

  it('an exposure may name a tie never recorded - it is added as openly known', () => {
    const { after } = turn([tieDelta('courtier:christians', { change: 'expose', name: 'the Christians', kind: 'religion' })]);
    expect(after[1].affiliations).toEqual([{ id: 'christians', name: 'the Christians', kind: 'religion', public: true }]);
  });

  it('refuses and records a missing payload, a nameless join, leaving a tie not held, an unknown holder, and a join past the bound', () => {
    const full = { ...courtier, affiliations: Array.from({ length: MAX_ENTITY_AFFILIATIONS }, (_, i) => ({ ...npcSecret, id: `tie_${i}` })) };
    const { after, gmNotes } = turn([
      { type: 'affiliation', key: 'courtier:x', delta: 0, reason: 'No payload.' },
      tieDelta('courtier:x', { change: 'join' }),
      tieDelta('courtier:x', { change: 'leave' }),
      tieDelta('nobody:x', { change: 'join', name: 'x' }),
      tieDelta('courtier:one_more', { change: 'join', name: 'one more' }),
    ], [player, full]);
    expect(gmNotes).toHaveLength(5);
    expect(after[1].affiliations).toHaveLength(MAX_ENTITY_AFFILIATIONS);
  });

  it('secretAffiliationsOf - the investigation seam - reads only the secret ties; publicAffiliationsOf only the open ones', () => {
    expect(secretAffiliationsOf(player)).toEqual([playerSecret]);
    expect(publicAffiliationsOf(player)).toEqual([playerOpen]);
    expect(secretAffiliationsOf(courtier)).toEqual([]);
  });
});

describe('D49 perception: an open tie is public knowledge, a secret one is seen only by a witness', () => {
  it('the holder always knows their own - secret included - on no tab', () => {
    const deltas = [tieDelta('player:mithras', { change: 'join', name: 'the mysteries of Mithras', kind: 'cult' })];
    const { after, before } = turn(deltas);
    const [change] = buildPlayerPerceivedDigest(deltas, after[0], after, world, before);
    expect(change).toMatchObject({ source: 'self', text: 'You are now of the mysteries of Mithras, in secret.', tabs: [] });
    expect(change.perceivedAffiliation).toEqual({ id: 'mithras', name: 'the mysteries of Mithras', kind: 'cult', public: false, member: true });
  });

  it('a secret rite in the player\'s room is witnessed - never through a contact, never from afar', () => {
    const inRoom = [tieDelta('courtier:isis', { change: 'join', name: 'the mysteries of Isis', kind: 'cult' })];
    const first = turn(inRoom);
    const [seen] = buildPlayerPerceivedDigest(inRoom, first.after[0], first.after, world, first.before);
    expect(seen).toMatchObject({ source: 'witnessed', text: 'You glimpse Local Courtier among the mysteries of Isis, in secret.', tabs: ['dramatis_personae'] });
    const viaContact = [tieDelta('spy:isis', { change: 'join', name: 'the mysteries of Isis', kind: 'cult' })];
    const second = turn(viaContact);
    expect(classifyDelta(viaContact[0], second.after[0], second.after, world, second.before)).toEqual({ visible: false, source: null });
  });

  it('an open change is public knowledge wherever it happens; leaving, avowing and exposure read as such', () => {
    const openJoin = [tieDelta('distant:boosters', { change: 'join', name: 'the boosters of the triumph', kind: 'cause', public: true })];
    const joined = turn(openJoin);
    expect(buildPlayerPerceivedDigest(openJoin, joined.after[0], joined.after, world, joined.before)[0])
      .toMatchObject({ source: 'public', text: 'Far Senator is now openly of the boosters of the triumph.' });

    const holder = [player, courtier, spy, { ...distant, affiliations: [{ ...npcSecret }, { id: 'boosters', name: 'the boosters of the triumph', kind: 'cause' as const, public: true }] }];
    const leave = [tieDelta('distant:boosters', { change: 'leave' })];
    const left = turn(leave, holder);
    expect(buildPlayerPerceivedDigest(leave, left.after[0], left.after, world, toPreTurnRoster(holder))[0].text)
      .toBe('Far Senator breaks openly with the boosters of the triumph.');
    // Without the turn's starting roster a departure cannot be seen.
    expect(buildPlayerPerceivedDigest(leave, left.after[0], left.after, world)).toEqual([]);

    const expose = [tieDelta('distant:npc_secret', { change: 'expose' })];
    const exposed = turn(expose, holder);
    const [line] = buildPlayerPerceivedDigest(expose, exposed.after[0], exposed.after, world, holder);
    expect(line).toMatchObject({ source: 'public', text: 'Far Senator stands exposed: a hidden tie to NPC_SECRET_TIE_SENTINEL.' });
    const avow = [tieDelta('distant:npc_secret', { change: 'go_public' })];
    const avowed = turn(avow, holder);
    expect(buildPlayerPerceivedDigest(avow, avowed.after[0], avowed.after, world, holder)[0].text)
      .toBe('Far Senator openly avows a tie to NPC_SECRET_TIE_SENTINEL, long kept hidden.');
    // A secret departure far away is no one's news.
    const quietLeave = [tieDelta('distant:npc_secret', { change: 'leave' })];
    const quiet = turn(quietLeave, holder);
    expect(buildPlayerPerceivedDigest(quietLeave, quiet.after[0], quiet.after, world, holder)).toEqual([]);
  });

  it('the player\'s own secret, exposed, reaches every viewer; a restated tie is no news; the dead are never seen', () => {
    const expose = [tieDelta('player:player_secret', { change: 'expose' }, 'Laid bare.', { origin_id: 'distant' })];
    const exposed = turn(expose);
    expect(buildPlayerPerceivedDigest(expose, exposed.after[0], exposed.after, world, roster)[0].text)
      .toBe(`Your hidden tie to ${PLAYER_SECRET} stands exposed.`);
    expect(buildPerceivedDigest(expose, exposed.after[3], exposed.after, world, roster)[0].source).toBe('public');
    const restate = [tieDelta('player:state_cult', { change: 'join', name: 'the gods of the Roman state', kind: 'religion', public: true })];
    const restated = turn(restate);
    expect(buildPlayerPerceivedDigest(restate, restated.after[0], restated.after, world, roster)).toEqual([]);
    const dead = [player, { ...courtier, status: 'dead' as const }];
    const rite = [tieDelta('courtier:isis', { change: 'join', name: 'the mysteries of Isis', kind: 'cult' })];
    const onDead = turn(rite, dead);
    expect(buildPlayerPerceivedDigest(rite, onDead.after[0], onDead.after, world, dead)).toEqual([]);
  });

  it('knowledge holds a witnessed secret tie and one learned by other means, and lets go of one seen given up', () => {
    const rite = [tieDelta('courtier:isis', { change: 'join', name: 'the mysteries of Isis', kind: 'cult' })];
    const first = turn(rite);
    let store = ingestPerceivedChanges([], buildPlayerPerceivedDigest(rite, first.after[0], first.after, world, first.before), 5);
    store = ingestLearnedAffiliation(store, { entityId: 'courtier', affiliation: { id: 'npc_secret', name: 'the Christians', kind: 'religion' }, text: 'Your agent saw him at the house church.', turn: 6 });
    expect(knownAffiliationsOf(store, 'courtier').map(tie => [tie.id, tie.public])).toEqual([['isis', false], ['npc_secret', false]]);
    expect(store.find(claim => claim.claimKey === 'investigation:courtier:affiliation:npc_secret')?.updates[0].source).toBe('spy');
    const leave = [tieDelta('courtier:isis', { change: 'leave' })];
    const second = turn(leave, first.after);
    store = ingestPerceivedChanges(store, buildPlayerPerceivedDigest(leave, second.after[0], second.after, world, toPreTurnRoster(first.after)), 7);
    expect(knownAffiliationsOf(store, 'courtier').map(tie => tie.id)).toEqual(['npc_secret']);
  });
});

describe('D49 prompts: the GM knows every tie; a mind and a scene never the player\'s secret; the player\'s prose never another\'s secret', () => {
  const julia = makeEntity({
    entity_id: 'julia', name: 'Julia Mamaea', affiliations: [{ id: 'origen', name: 'the circle of Origen', kind: 'religion', public: false }],
    relationships: { player: { entity_id: 'player', relationship_type: 'family', trust_level: 9, recent_interactions: [] } },
    secrets: ['Has a private treasury.'],
  });

  it('the omniscient brief marks a secret tie as such, with its handle', () => {
    expect(getEntityBrief(player)).toContain(`Affiliations: the gods of the Roman state (handle 'state_cult'; religion; openly professed); ${PLAYER_SECRET} (handle 'player_secret'; religion; SECRET - known only to its holder`);
    expect(getEntityBrief(courtier)).not.toContain('Affiliations');
  });

  it('the adjudicator sees the player\'s secret tie, marked, and the delta contract for ties', () => {
    const { systemInstruction, prompt } = buildAdjudicationPrompt(buildAdjudicationPromptInput({ playerEntity: player }));
    expect(systemInstruction).toContain('- AFFILIATIONS (ties openly professed or kept secret):');
    expect(systemInstruction).toContain("with change 'expose' and 'origin_id' naming the exposer");
    expect(prompt).toContain(`The player's affiliations (a SECRET one is unknown to every NPC who has not learned it): the gods of the Roman state (handle 'state_cult'; religion; openly professed); ${PLAYER_SECRET} (handle 'player_secret'; religion; SECRET`);
  });

  it('SENTINEL: a mind sees its own secret tie and the player\'s OPEN one - never the player\'s secret', () => {
    const figures = figuresInViewOf(julia, [player, julia, distant]);
    expect(figures.map(figure => figure.entity_id)).toEqual(['player']);
    const { prompt } = buildNpcMindPrompt({ self: julia, perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year 235.', turnNumber: 5, figuresInView: figures });
    expect(prompt).toContain('Your ties: the circle of Origen (religion; KEPT SECRET - known only to you');
    expect(prompt).toContain('- Severus Alexander (here with you): openly of the gods of the Roman state (religion)');
    expect(prompt).not.toContain(PLAYER_SECRET);
    expect(JSON.stringify(figures)).not.toContain(PLAYER_SECRET);
  });

  it('SENTINEL: a private scene\'s prompt carries the player\'s public face only - never a secret tie', () => {
    const input = buildScenePromptInput(player, julia, [{ sequence: 1, speaker: 'player', text: 'Mother, a word.' }], 1);
    const { systemInstruction, prompt } = buildPrivateScenePrompt(input);
    expect(`${systemInstruction}\n${prompt}`).not.toContain(PLAYER_SECRET);
  });

  it('the narration and monologue carry the player\'s own ties (secret marked) and only the OPEN ties of others', () => {
    const openFigure = { ...distant, affiliations: [npcSecret, { id: 'boosters', name: 'the boosters of the triumph', kind: 'cause' as const, public: true }] };
    const narration = buildNarrationPrompt('A crisis.', player, 'Hold court', [{ text: 'Far Senator speaks.', source: 'public' }], [], undefined, [openFigure]);
    expect(narration.prompt).toContain(`- ${PLAYER_SECRET} (religion; KEPT SECRET - known only to you`);
    expect(narration.prompt).toContain('- Far Senator: the boosters of the triumph (cause)');
    expect(narration.prompt).not.toContain('NPC_SECRET_TIE_SENTINEL');
    expect(narration.systemInstruction).toContain("Likewise the player's OWN TIES");
    const monologue = buildPlayerMonologuePrompt({ ...player, position: 'Emperor' }, ['Far Senator speaks.'], ['Hold court'], true, [openFigure]);
    expect(monologue.systemInstruction).toContain(`Your ties: the gods of the Roman state (religion; openly professed); ${PLAYER_SECRET} (religion; KEPT SECRET`);
    expect(monologue.prompt).toContain('the boosters of the triumph (cause)');
    expect(`${monologue.systemInstruction}${monologue.prompt}`).not.toContain('NPC_SECRET_TIE_SENTINEL');
    // No ties, no blocks: the prompts read as before.
    expect(buildNarrationPrompt('A crisis.', courtier, 'Hold court', []).prompt).not.toContain('TIES');
  });

  it('the sim-state prompt never carries a secret tie - neither its narrative nor its handle', () => {
    const adjudication = makeAdjudication({
      deltas: [
        tieDelta('julia:circle_of_origen', { change: 'join', name: 'the circle of Origen', kind: 'religion' }, 'SECRET_JOIN_REASON'),
        tieDelta('julia:bacchus', { change: 'leave' }, 'UNSTATED_LEAVE_REASON'),
        tieDelta('magnus:boosters', { change: 'join', name: 'the boosters', kind: 'cause', public: true }, 'Magnus declares for a triumph.'),
      ],
    });
    const { prompt } = buildSimulationStateUpdatePrompt(adjudication, makeSimulationState());
    expect(prompt).not.toContain('SECRET_JOIN_REASON');
    expect(prompt).not.toContain('circle_of_origen');
    expect(prompt).not.toContain('UNSTATED_LEAVE_REASON');
    expect(prompt).toContain(`affiliation on julia because ${REDACTED_PRIVATE_TIE_REASON}`);
    expect(prompt).toContain('affiliation on magnus:boosters because Magnus declares for a triumph.');
    const sanitized = JSON.stringify(sanitizeAdjudicationForNarration(adjudication));
    expect(sanitized).not.toContain('circle');
    expect(sanitized).toContain('the boosters');
  });

  it('character creation and world generation may propose ties, an occasional one kept secret', () => {
    expect(buildCharacterCreationPrompt('A priest of Mithras.', []).systemInstruction).toContain("0-2 'affiliations'");
    expect((EntitySchema.properties as Record<string, unknown>).affiliations).toBeDefined();
    expect(EntitySchema.required).not.toContain('affiliations');
    expect((CharacterCreationEntitySchema.properties as Record<string, unknown>).affiliations).toBeDefined();
    expect(CharacterCreationEntitySchema.required).not.toContain('affiliations');
  });

  it('the base cast carries plausible ties - the regent\'s quiet sympathy for Origen among them, kept secret', () => {
    const mamaea = ALL_INITIAL_ENTITIES.find(entity => entity.entity_id === 'julia_mamaea')!;
    expect(secretAffiliationsOf(mamaea).map(tie => tie.name)).toEqual(['the circle of Origen']);
    expect(ALL_INITIAL_ENTITIES.filter(entity => (entity.affiliations ?? []).length > 0).length).toBeGreaterThanOrEqual(4);
    for (const entity of ALL_INITIAL_ENTITIES) {
      expect(normalizeAffiliations(entity.affiliations ?? [])?.length ?? 0).toBe((entity.affiliations ?? []).length);
    }
  });
});

describe('D49 player boundary: joining is the holder\'s act, exposure the world\'s', () => {
  it('an exposure keyed under the player is theirs only through a player origin; a join, leave or avowal is theirs', () => {
    expect(playerOwnsDelta(tieDelta('player:player_secret', { change: 'expose' }, 'Laid bare.', { origin_id: 'distant' }), player)).toBe(false);
    expect(playerOwnsDelta(tieDelta('player:player_secret', { change: 'expose' }), player)).toBe(false);
    expect(playerOwnsDelta(tieDelta('player:x', { change: 'join', name: 'x' }), player)).toBe(true);
    expect(playerOwnsDelta(tieDelta('player:player_secret', { change: 'go_public' }), player)).toBe(true);
  });
});

describe('D49 save compatibility and the model boundary', () => {
  beforeEach(() => localStorage.clear());

  it('ties round-trip through a save; a sound roster loads as the same objects; a damaged tie is dropped', () => {
    const holder = baseMakeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', affiliations: [playerOpen, playerSecret] });
    expect(saveGame(makeLegacySaveState({ entities: [holder] })).ok).toBe(true);
    const loaded = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loadGame()!.state });
    expect(loaded.entities[0].affiliations).toEqual([playerOpen, playerSecret]);

    const sound = [holder];
    expect(gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: makeLegacySaveState({ entities: sound }) }).entities).toBe(sound);

    const damaged = makeLegacySaveState({
      entities: [baseMakeEntity({ entity_id: 'severus_alexander', name: 'S', affiliations: [playerOpen, { name: 'no kind or public' }, 7] as unknown as Affiliation[] })],
    });
    expect(gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: damaged }).entities[0].affiliations).toEqual([
      playerOpen,
      { id: 'no_kind_or_public', name: 'no kind or public', kind: 'other', public: false },
    ]);
  });

  it('a model-authored entity\'s ties are rebuilt record by record: handle from the name, secret by default', () => {
    const parsed = zEntity.parse({
      ...baseMakeEntity({ entity_id: 'vorenus', name: 'Lucius Vorenus' }),
      affiliations: [{ name: 'The Mysteries of Mithras', kind: 'cult' }, { kind: 'cause' }],
    });
    expect(parsed.affiliations).toEqual([{ id: 'the_mysteries_of_mithras', name: 'The Mysteries of Mithras', kind: 'cult', public: false }]);
  });
});
