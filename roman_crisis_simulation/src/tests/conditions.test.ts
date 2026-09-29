/**
 * @vitest-environment jsdom
 *
 * D48 - the condition tracker: lasting marks, and hard assets lost being
 * removed. Covers the engine rules (ai/core/conditions.ts via applyDeltas),
 * perception (an outward mark is seen like a status change, an inward one
 * never by anyone but its bearer), the player's knowledge of what they saw,
 * the prompts that weigh conditions (and the ones that must never carry an
 * NPC's inward mark), the mortality outcome boundary, and save
 * compatibility.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Condition, Entity, EventDelta, WorldState } from '../types';
import { applyDeltas } from '../ai/core/engine';
import { MAX_ENTITY_CONDITIONS, normalizeConditions } from '../ai/core/conditions';
import { buildPerceivedDigest, buildPlayerPerceivedDigest, classifyDelta, toPreTurnRoster } from '../perception/visibility';
import { figuresInViewOf } from '../perception/npcPerception';
import { ingestPerceivedChanges, perceivedConditionsOf } from '../knowledge/store';
import { getEntityBrief, REDACTED_PRIVATE_MARK_REASON } from '../ai/prompts/fragments';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildNpcMindPrompt } from '../ai/prompts/npcMind';
import { buildNarrationPrompt, buildPlayerMonologuePrompt } from '../ai/prompts/narration';
import { buildSimulationStateUpdatePrompt } from '../ai/prompts/intelligence';
import { buildMortalityOutcomePrompt } from '../ai/prompts/mortality';
import { partitionOutcomeDeltas } from '../ai/core/mortality';
import { playerOwnsDelta, redactInventedPlayerProse } from '../ai/core/playerBoundary';
import { zEntity } from '../ai/core/zodSchemas';
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

const scar: Condition = {
  id: 'scarred_cheek',
  name: 'a nasty scar',
  description: 'A jagged line from brow to jaw.',
  outward: true,
  severity: 'serious',
  since_turn: 2,
};

const nightmares: Condition = {
  id: 'nightmares',
  name: 'nightmares',
  description: 'INWARD_MARK_SENTINEL: he wakes screaming of the Rhine.',
  outward: false,
  severity: 'grave',
  since_turn: 3,
};

function conditionDelta(key: string, condition: EventDelta['condition'], reason = 'What happened.'): EventDelta {
  return { type: 'condition', key, delta: 0, reason, condition };
}

const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', visibility_network: ['spy'] });
const courtier = makeEntity({ entity_id: 'courtier', name: 'Local Courtier' });
const distant = makeEntity({ entity_id: 'distant', name: 'Maximinus Thrax', location: 'The Suburra' });
const spy = makeEntity({ entity_id: 'spy', name: 'Trusted Spy', location: 'The Suburra' });
const roster = [player, courtier, distant, spy];

function apply(deltas: EventDelta[], entities: Entity[] = roster, turn = 5) {
  return applyDeltas(deltas, entities, world, turn, 'player');
}

describe('D48 engine: a condition delta adds, deepens, eases and heals', () => {
  it('adds a mark keyed by its handle, stamped with the turn, weighted and placed as authored', () => {
    const { updatedEntities, gmNotes } = apply([
      conditionDelta('courtier:scarred_cheek', { change: 'add', name: 'a nasty scar', description: 'A jagged line.', outward: true, severity: 'grave' }),
    ]);
    expect(gmNotes).toEqual([]);
    expect(updatedEntities.find(e => e.entity_id === 'courtier')!.conditions).toEqual([
      { id: 'scarred_cheek', name: 'a nasty scar', description: 'A jagged line.', outward: true, severity: 'grave', since_turn: 5 },
    ]);
    // Pure: the input roster is untouched.
    expect(courtier.conditions).toBeUndefined();
  });

  it('an unstated visibility is INWARD and an unstated weight is serious (the private default)', () => {
    const { updatedEntities } = apply([conditionDelta('courtier:grief', { change: 'add', name: 'grief for a son' })]);
    const [mark] = updatedEntities.find(e => e.entity_id === 'courtier')!.conditions!;
    expect(mark.outward).toBe(false);
    expect(mark.severity).toBe('serious');
  });

  it('refuses and records a nameless add, a missing payload and an unknown bearer - the roster is left unchanged', () => {
    const { updatedEntities, gmNotes } = apply([
      conditionDelta('courtier:thing', { change: 'add' }),
      { type: 'condition', key: 'courtier:thing', delta: 0, reason: 'No payload.' },
      conditionDelta('nobody:scar', { change: 'add', name: 'a scar' }),
    ]);
    expect(updatedEntities.find(e => e.entity_id === 'courtier')!.conditions).toBeUndefined();
    expect(gmNotes).toHaveLength(3);
    expect(gmNotes.every(note => note.startsWith('[Engine] Refused a \'condition\' delta'))).toBe(true);
  });

  it('an add of a mark already borne restates it - no duplicate, the turn it was taken is kept (mock replays are idempotent)', () => {
    const marked = { ...courtier, conditions: [scar] };
    const { updatedEntities } = apply([
      conditionDelta('courtier:scarred_cheek', { change: 'add', name: 'a nasty scar', description: 'Paler now.', outward: true }),
    ], [player, marked]);
    expect(updatedEntities[1].conditions).toEqual([{ ...scar, description: 'Paler now.' }]);
  });

  it('deepen and ease move one step within light..grave; a stated weight moving the right way is honoured', () => {
    const marked = { ...courtier, conditions: [{ ...scar, severity: 'light' as const }] };
    const deepened = apply([conditionDelta('courtier:scarred_cheek', { change: 'deepen' })], [player, marked]).updatedEntities[1];
    expect(deepened.conditions![0].severity).toBe('serious');
    const toGrave = apply([conditionDelta('courtier:scarred_cheek', { change: 'deepen', severity: 'grave' })], [player, marked]).updatedEntities[1];
    expect(toGrave.conditions![0].severity).toBe('grave');
    // A "deepen" naming a LIGHTER weight is not honoured - it still deepens.
    const graveMark = { ...courtier, conditions: [{ ...scar, severity: 'grave' as const }] };
    const eased = apply([conditionDelta('courtier:scarred_cheek', { change: 'ease', description: 'Healing clean.' })], [player, graveMark]).updatedEntities[1];
    expect(eased.conditions![0]).toMatchObject({ severity: 'serious', description: 'Healing clean.', since_turn: 2 });
    const lightest = apply([conditionDelta('courtier:scarred_cheek', { change: 'ease' })], [player, marked]).updatedEntities[1];
    expect(lightest.conditions![0].severity).toBe('light');
  });

  it('heal removes the mark, and a bearer left with none carries no field at all', () => {
    const marked = { ...courtier, conditions: [scar] };
    const { updatedEntities, gmNotes } = apply([conditionDelta('courtier:scarred_cheek', { change: 'heal' })], [player, marked]);
    expect(gmNotes).toEqual([]);
    expect('conditions' in updatedEntities[1]).toBe(false);
    // Healing a mark never borne is refused and recorded.
    expect(apply([conditionDelta('courtier:scarred_cheek', { change: 'heal' })]).gmNotes).toHaveLength(1);
  });

  it(`refuses a new mark past the bound of ${MAX_ENTITY_CONDITIONS}, keeping every older one`, () => {
    const full = Array.from({ length: MAX_ENTITY_CONDITIONS }, (_, i) => ({ ...scar, id: `mark_${i}` }));
    const { updatedEntities, gmNotes } = apply([conditionDelta('courtier:one_more', { change: 'add', name: 'one more' })], [player, { ...courtier, conditions: full }]);
    expect(updatedEntities[1].conditions).toHaveLength(MAX_ENTITY_CONDITIONS);
    expect(gmNotes).toHaveLength(1);
  });
});

describe('D48 engine: a hard asset lost is removed', () => {
  const holder = makeEntity({
    entity_id: 'player',
    name: 'Severus Alexander',
    resources: { denarii: 900, estates: ['the villa at Baiae', 'a farm near Tibur'], townhouse: 'a house on the Esquiline' },
  });

  it('removes one item off a list holding, and the whole of a text holding', () => {
    const { updatedEntities, gmNotes } = applyDeltas([
      { type: 'resource', key: 'player:estates', delta: -1, reason: 'Seized.', lost_item: 'The Villa at Baiae' },
      { type: 'resource', key: 'player:townhouse', delta: -1, reason: 'Burned.', lost_item: 'the Esquiline house' },
    ], [holder], world, 5, 'player');
    expect(gmNotes).toEqual([]);
    expect(updatedEntities[0].resources.estates).toEqual(['a farm near Tibur']);
    expect('townhouse' in updatedEntities[0].resources).toBe(false);
  });

  it('drops a list emptied of its last item, refuses an item it does not hold, and leaves a numeric resource to its delta', () => {
    const lone = { ...holder, resources: { estates: ['a farm near Tibur'], denarii: 900 } };
    const { updatedEntities, gmNotes } = applyDeltas([
      { type: 'resource', key: 'player:estates', delta: -1, reason: 'Sold.', lost_item: 'a vineyard at Falernum' },
      { type: 'resource', key: 'player:estates', delta: -1, reason: 'Sold.', lost_item: 'a farm near Tibur' },
      { type: 'resource', key: 'player:denarii', delta: -400, reason: 'Fined.', lost_item: 'four hundred denarii' },
    ], [lone], world, 5, 'player');
    expect(gmNotes).toHaveLength(1);
    expect(gmNotes[0]).toContain('holds no item "a vineyard at Falernum"');
    expect('estates' in updatedEntities[0].resources).toBe(false);
    expect(updatedEntities[0].resources.denarii).toBe(500);
  });

  it('the player hears of the loss by name; a refused loss is never announced', () => {
    const deltas: EventDelta[] = [
      { type: 'resource', key: 'player:estates', delta: -1, reason: 'Seized.', lost_item: 'the villa at Baiae' },
      { type: 'resource', key: 'player:estates', delta: -1, reason: 'Seized.', lost_item: 'a palace in Antioch' },
    ];
    const { updatedEntities } = applyDeltas(deltas, [holder], world, 5, 'player');
    const digest = buildPlayerPerceivedDigest(deltas, updatedEntities[0], updatedEntities, world, [holder]);
    expect(digest.map(change => change.text)).toEqual(['You have lost the villa at Baiae.']);
    expect(digest[0].tabs).toEqual(['resources']);
    // The slim history roster keeps the holdings a loss can name - never the
    // numbers - so the re-derived dispatch says the same.
    const slim = toPreTurnRoster([holder]);
    expect(slim[0].resources).toEqual({ estates: ['the villa at Baiae', 'a farm near Tibur'], townhouse: 'a house on the Esquiline' });
    expect(buildPlayerPerceivedDigest(deltas, updatedEntities[0], updatedEntities, world, slim).map(change => change.text))
      .toEqual(['You have lost the villa at Baiae.']);
  });
});

describe('D48 perception: outward marks are seen like a status change, inward ones never by another', () => {
  function turn(deltas: EventDelta[], before: Entity[] = roster) {
    const { updatedEntities } = applyDeltas(deltas, before, world, 5, 'player');
    return { after: updatedEntities, before };
  }

  it('the player always knows their own marks, inward ones included, on no tab (their status panel owns them)', () => {
    const deltas = [conditionDelta('player:nightmares', { change: 'add', name: 'nightmares', description: 'Wakes screaming.', outward: false, severity: 'grave' })];
    const { after, before } = turn(deltas);
    const [change] = buildPlayerPerceivedDigest(deltas, after[0], after, world, before);
    expect(change).toMatchObject({ source: 'self', text: 'You bear a new mark: nightmares.', tabs: [] });
    expect(change.perceivedCondition).toMatchObject({ id: 'nightmares', outward: false, gone: false });
  });

  it('an NPC\'s INWARD mark never reaches the player - not even standing in the same room', () => {
    const deltas = [conditionDelta('courtier:nightmares', { change: 'add', name: 'nightmares', description: nightmares.description, outward: false })];
    const { after, before } = turn(deltas);
    expect(classifyDelta(deltas[0], after[0], after, world, before)).toEqual({ visible: false, source: null });
    expect(buildPlayerPerceivedDigest(deltas, after[0], after, world, before)).toEqual([]);
    // Its bearer knows it.
    const [own] = buildPerceivedDigest(deltas, after[1], after, world, before);
    expect(own.source).toBe('self');
  });

  it('an outward mark gained in the player\'s room is witnessed, in the game\'s voice, for Personae', () => {
    const deltas = [conditionDelta('courtier:scarred_cheek', { change: 'add', name: 'a nasty scar', description: 'A jagged line.', outward: true, severity: 'serious' })];
    const { after, before } = turn(deltas);
    const [change] = buildPlayerPerceivedDigest(deltas, after[0], after, world, before);
    expect(change).toMatchObject({ source: 'witnessed', text: 'Local Courtier now bears a mark: a nasty scar.', tabs: ['dramatis_personae'], subject: 'courtier' });
  });

  it('a distant outward mark reaches the player only through a contact who can see it', () => {
    const onDistant = [conditionDelta('distant:limp', { change: 'add', name: 'a limp', outward: true })];
    const onSpy = [conditionDelta('spy:limp', { change: 'add', name: 'a limp', outward: true })];
    const first = turn(onDistant);
    expect(buildPlayerPerceivedDigest(onDistant, first.after[0], first.after, world, first.before)).toEqual([]);
    const second = turn(onSpy);
    expect(buildPlayerPerceivedDigest(onSpy, second.after[0], second.after, world, second.before)[0].source).toBe('network');
  });

  it('a heal is seen only with the pre-turn roster (the slim history copy carries marks), and a restated mark is no news', () => {
    const marked = [player, { ...courtier, conditions: [scar] }, distant, spy];
    const heal = [conditionDelta('courtier:scarred_cheek', { change: 'heal' })];
    const healed = turn(heal, marked);
    const slim = toPreTurnRoster(marked);
    expect(slim[1].conditions).toEqual([scar]);
    expect('conditions' in slim[0]).toBe(false);
    const [change] = buildPlayerPerceivedDigest(heal, healed.after[0], healed.after, world, slim);
    expect(change.text).toBe('Local Courtier no longer shows a nasty scar.');
    expect(change.perceivedCondition?.gone).toBe(true);
    // Without a record of the turn's start a heal cannot be seen.
    expect(buildPlayerPerceivedDigest(heal, healed.after[0], healed.after, world)).toEqual([]);
    // Canned play re-adds the same mark every week: nothing new to see.
    const restate = [conditionDelta('courtier:scarred_cheek', { change: 'add', name: 'a nasty scar', outward: true })];
    const restated = turn(restate, marked);
    expect(buildPlayerPerceivedDigest(restate, restated.after[0], restated.after, world, marked)).toEqual([]);
  });

  it('deepening and easing read as such; a mark on the dead is never seen (D3)', () => {
    const marked = [player, { ...courtier, conditions: [scar] }];
    const deepen = [conditionDelta('courtier:scarred_cheek', { change: 'deepen' })];
    const deepened = turn(deepen, marked);
    expect(buildPlayerPerceivedDigest(deepen, deepened.after[0], deepened.after, world, marked)[0].text)
      .toBe('A mark on Local Courtier grows worse: a nasty scar.');
    const dead = [player, { ...courtier, status: 'dead' as const, conditions: [scar] }];
    const onDead = turn(deepen, dead);
    expect(buildPlayerPerceivedDigest(deepen, onDead.after[0], onDead.after, world, dead)).toEqual([]);
  });

  it('the knowledge store keeps the marks the player SAW, drops one seen healed, and never holds an inward one', () => {
    const marked = [player, { ...courtier, conditions: [scar] }, distant, spy];
    const add = [
      conditionDelta('courtier:limp', { change: 'add', name: 'a limp', description: 'He favours the left leg.', outward: true, severity: 'light' }),
      conditionDelta('courtier:nightmares', { change: 'add', name: 'nightmares', description: nightmares.description, outward: false }),
    ];
    const first = turn(add, marked);
    let store = ingestPerceivedChanges([], buildPlayerPerceivedDigest(add, first.after[0], first.after, world, marked), 5);
    expect(perceivedConditionsOf(store, 'courtier').map(mark => mark.name)).toEqual(['a limp']);
    expect(JSON.stringify(store)).not.toContain('INWARD_MARK_SENTINEL');
    // The scar he bore before the player ever saw him is not "known" either.
    expect(perceivedConditionsOf(store, 'courtier').some(mark => mark.id === 'scarred_cheek')).toBe(false);
    const heal = [conditionDelta('courtier:limp', { change: 'heal' })];
    const second = turn(heal, first.after);
    store = ingestPerceivedChanges(store, buildPlayerPerceivedDigest(heal, second.after[0], second.after, world, toPreTurnRoster(first.after)), 6);
    expect(perceivedConditionsOf(store, 'courtier')).toEqual([]);
  });
});

describe('D48 prompts: conditions shape intended actions, and an inward mark reaches only its bearer and the GM', () => {
  const marked = makeEntity({ entity_id: 'courtier', name: 'Local Courtier', conditions: [scar, nightmares] });

  it('the omniscient brief carries every mark with its handle and who can see it; an unmarked entity reads as before', () => {
    const brief = getEntityBrief(marked);
    expect(brief).toContain("Conditions: a nasty scar (handle 'scarred_cheek'; serious; outward - others can see it): A jagged line from brow to jaw.");
    expect(brief).toContain("nightmares (handle 'nightmares'; grave; inward - known only to its bearer)");
    expect(getEntityBrief(courtier)).not.toContain('Conditions');
  });

  it('the adjudicator is told to weigh marks, author them from what happened, and remove a lost hard asset', () => {
    const playerMarked = { ...player, conditions: [nightmares] };
    const { systemInstruction, prompt } = buildAdjudicationPrompt(buildAdjudicationPromptInput({ playerEntity: playerMarked }));
    expect(systemInstruction).toContain('- CONDITIONS (lasting marks):');
    expect(systemInstruction).toContain('never flavour for its own sake');
    expect(systemInstruction).toContain('- HARD ASSETS ARE REMOVED:');
    expect(systemInstruction).toContain("a 'condition' delta keyed under the player");
    expect(prompt).toContain("Lasting marks the player bears (weigh them when resolving the player's attempt): nightmares (handle 'nightmares'; grave; inward");
    const unmarked = buildAdjudicationPrompt(buildAdjudicationPromptInput()).prompt;
    expect(unmarked).not.toContain('Lasting marks the player bears');
  });

  it('a mind sees all of its own marks, and only the OUTWARD marks of those it can see', () => {
    const selfMarked = makeEntity({ entity_id: 'mind', name: 'Julia Mamaea', conditions: [{ ...nightmares, description: 'OWN_INWARD_MARK' }] });
    const rival = makeEntity({ entity_id: 'rival', name: 'Gaius Pontius', conditions: [scar, nightmares] });
    const away = makeEntity({ entity_id: 'away', name: 'Far Senator', location: 'The Suburra', conditions: [{ ...scar, description: 'FAR_SCAR_SENTINEL' }] });
    const figures = figuresInViewOf(selfMarked, [selfMarked, rival, away]);
    expect(figures).toEqual([{ entity_id: 'rival', name: 'Gaius Pontius', present: true, outwardConditions: [{ name: 'a nasty scar', description: scar.description, severity: 'serious' }], publicAffiliations: [] }]);
    const { prompt } = buildNpcMindPrompt({
      self: selfMarked, perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year 235.', turnNumber: 5, figuresInView: figures,
    });
    expect(prompt).toContain('Lasting marks you bear (let them weigh on what you set out to do): nightmares (grave; inward - known only to its bearer): OWN_INWARD_MARK');
    expect(prompt).toContain('FIGURES AROUND YOU');
    expect(prompt).toContain('- Gaius Pontius (here with you): bears a nasty scar (serious): A jagged line from brow to jaw.');
    expect(prompt).not.toContain('INWARD_MARK_SENTINEL');
    expect(prompt).not.toContain('FAR_SCAR_SENTINEL');
  });

  it('the player\'s own marks reach the narration and the monologue; the narration may not narrate an unremoved loss', () => {
    const playerMarked = { ...player, position: 'Emperor', conditions: [scar, nightmares] };
    const { systemInstruction, prompt } = buildNarrationPrompt('A crisis.', playerMarked, 'Hold court', []);
    expect(prompt).toContain('LASTING MARKS THE PLAYER BEARS');
    expect(prompt).toContain('- nightmares (grave; inward - known only to its bearer)');
    expect(systemInstruction).toContain('**The Narration Is the State:** Never narrate the loss of a hard asset');
    const monologue = buildPlayerMonologuePrompt(playerMarked, ['The city was quiet.'], ['Hold court']);
    expect(monologue.systemInstruction).toContain('The lasting marks you bear');
    expect(buildNarrationPrompt('A crisis.', player, 'Hold court', []).prompt).not.toContain('LASTING MARKS');
  });

  it('the sim-state prompt (its output renders for the player) never carries a private mark\'s narrative', () => {
    const adjudication = makeAdjudication({
      deltas: [
        conditionDelta('courtier:nightmares', { change: 'add', name: 'nightmares', outward: false }, 'PRIVATE_MARK_REASON_SENTINEL'),
        conditionDelta('courtier:scar', { change: 'deepen' }, 'UNSTATED_VISIBILITY_SENTINEL'),
        conditionDelta('courtier:limp', { change: 'add', name: 'a limp', outward: true }, 'Lamed in the riot.'),
      ],
    });
    const { prompt } = buildSimulationStateUpdatePrompt(adjudication, makeSimulationState());
    expect(prompt).not.toContain('PRIVATE_MARK_REASON_SENTINEL');
    expect(prompt).not.toContain('UNSTATED_VISIBILITY_SENTINEL');
    expect(prompt).toContain(REDACTED_PRIVATE_MARK_REASON);
    expect(prompt).toContain('Lamed in the riot.');
  });
});

describe('D48 mortality: a loss band\'s loss is a removed asset and/or a condition', () => {
  it('the outcome call is told the loss IS a removed asset or a condition, and that the band is not a state', () => {
    const { systemInstruction } = buildMortalityOutcomePrompt({
      candidates: [{ entity_id: 'player', name: 'Severus', isPlayer: true, band: 'survive_with_loss', cause: 'A blade.', entityBrief: 'Emperor.' }],
    });
    expect(systemInstruction).toContain("The loss IS a removed hard asset");
    expect(systemInstruction).toContain("a new 'condition'");
    expect(systemInstruction).toContain('THE BAND IS NOT A STATE');
    expect(systemInstruction).toContain("a condition they bear eased or healed");
  });

  it('accepts a condition on the claimed entity and rejects one keyed to anyone else', () => {
    const known = new Set(['player', 'courtier']);
    const own = conditionDelta('player:spear_wound', { change: 'add', name: 'a spear wound', outward: true });
    const other = conditionDelta('courtier:spear_wound', { change: 'add', name: 'a spear wound', outward: true });
    const bare: EventDelta = { type: 'condition', key: 'player:spear_wound', delta: 0, reason: 'No payload.' };
    const { safe, unauthorized } = partitionOutcomeDeltas([own, other, bare], 'player', known);
    expect(safe).toEqual([own]);
    expect(unauthorized).toEqual([other, bare]);
  });
});

describe('D48 player boundary: a mark befalls its bearer', () => {
  it('a condition keyed under the player is the world acting on them only from a named world origin (D46)', () => {
    const wound = conditionDelta('player:scar', { change: 'add', name: 'a scar' });
    const roster = [player, makeEntity({ entity_id: 'thrax', name: 'Maximinus Thrax' })];
    expect(playerOwnsDelta({ ...wound, origin_id: 'thrax' }, player, roster)).toBe(false);
    // No origin, an origin off the roster, or the player's own: theirs, so refused on a no-attempt turn.
    expect(playerOwnsDelta(wound, player, roster)).toBe(true);
    expect(playerOwnsDelta({ ...wound, origin_id: 'npc_invented' }, player, roster)).toBe(true);
    expect(playerOwnsDelta({ ...wound, origin_id: 'player' }, player, roster)).toBe(true);
  });

  it('on a no-attempt turn a description inventing the player\'s conduct is cut; the mark stays', () => {
    const adjudication = makeAdjudication({
      deltas: [conditionDelta('player:scar', { change: 'add', name: 'a scar', description: 'Severus Alexander draws his blade on the guard. The cut runs deep.', outward: true })],
    });
    const redactions = redactInventedPlayerProse(adjudication, player, false);
    expect(redactions.map(r => r.surface)).toContain('deltas[0].condition.description');
    expect(adjudication.deltas[0].condition).toMatchObject({ change: 'add', name: 'a scar', description: 'The cut runs deep.' });
  });
});

describe('D48 save compatibility and the model boundary', () => {
  beforeEach(() => localStorage.clear());

  it('conditions round-trip through a save; an old save without them loads unchanged; a malformed mark is dropped', () => {
    const markedPlayer = baseMakeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', conditions: [scar, nightmares] });
    expect(saveGame(makeLegacySaveState({ entities: [markedPlayer] })).ok).toBe(true);
    const loaded = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loadGame()!.state });
    expect(loaded.entities[0].conditions).toEqual([scar, nightmares]);

    const legacyEntities = [baseMakeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander' })];
    const legacy = makeLegacySaveState({ entities: legacyEntities });
    expect(gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: legacy }).entities).toBe(legacyEntities);

    const damaged = makeLegacySaveState({
      entities: [baseMakeEntity({ entity_id: 'severus_alexander', name: 'S', conditions: [scar, { name: 42 }, 'junk'] as unknown as Condition[] })],
    });
    expect(gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: damaged }).entities[0].conditions).toEqual([scar]);
  });

  it('a model-authored entity\'s marks are rebuilt record by record: handle from the name, private by default, nameless dropped', () => {
    const parsed = zEntity.parse({
      ...baseMakeEntity({ entity_id: 'vorenus', name: 'Lucius Vorenus' }),
      conditions: [{ name: 'An Old Spear Wound', description: 'Aches in the cold.', severity: 'light' }, { description: 'No name.' }],
    });
    expect(parsed.conditions).toEqual([
      { id: 'an_old_spear_wound', name: 'An Old Spear Wound', description: 'Aches in the cold.', outward: false, severity: 'light', since_turn: 0 },
    ]);
    expect('conditions' in zEntity.parse(baseMakeEntity({ entity_id: 'plain', name: 'Plain' }))).toBe(false);
    expect(normalizeConditions('not a list')).toBeUndefined();
  });
});
