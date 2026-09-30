/**
 * tests/composure.test.ts
 *
 * D50's composure roll (ai/core/composure.ts): whether a character can keep
 * an inward mark or a secret tie from showing in one scene. Pins the odds
 * table at an average bearer, the traits that move it, determinism over a
 * seeded generator, the lines CODE writes for what an NPC sees of the
 * player, the screen every model-authored tell passes, and the defensive
 * readers of the persisted records.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPOSURE_TIER_THRESHOLDS,
  MARK_COMPOSURE_DIFFICULTY,
  MAX_NARRATION_SIGNS,
  MAX_SIGNS_PER_REPLY,
  TIE_COMPOSURE_DIFFICULTY,
  composureCuesFrom,
  composureRollsOf,
  composureSignsOf,
  composureSubjectsOf,
  deriveComposureModifier,
  normalizeComposureRolls,
  playerComposureTell,
  resolveComposure,
  rollComposure,
  screenNarrationSigns,
  screenNpcTells,
} from '../ai/core/composure';
import { createSeededRng } from '../ai/core/resolution';
import type { Affiliation, AffiliationKind, ComposureRoll, ComposureTier, Condition, ConditionSeverity } from '../types';
import { makeEntity, makePersonality } from './factories';

const mark = (overrides: Partial<Condition> & Pick<Condition, 'id' | 'name'>): Condition =>
  ({ description: '', outward: false, severity: 'serious', since_turn: 1, ...overrides });
const tie = (overrides: Partial<Affiliation> & Pick<Affiliation, 'id' | 'name'>): Affiliation =>
  ({ kind: 'cult', public: false, ...overrides });

/** Every d20 face against one difficulty and modifier: the share of faces in each tier. */
function odds(difficulty: number, modifier = 0): Record<ComposureTier, number> {
  const counts: Record<ComposureTier, number> = { holds: 0, frays: 0, breaks: 0 };
  for (let roll = 1; roll <= 20; roll++) counts[resolveComposure({ roll, modifier, difficulty }).tier] += 1;
  return { holds: counts.holds * 5, frays: counts.frays * 5, breaks: counts.breaks * 5 };
}

describe('D50 composure: the roll', () => {
  it('pins the odds table at an average bearer, per mark weight', () => {
    const table: Record<ConditionSeverity, Record<ComposureTier, number>> = {
      light: { holds: 70, frays: 25, breaks: 5 },
      serious: { holds: 55, frays: 25, breaks: 20 },
      grave: { holds: 40, frays: 25, breaks: 35 },
    };
    for (const severity of ['light', 'serious', 'grave'] as const) {
      expect(odds(MARK_COMPOSURE_DIFFICULTY[severity]), severity).toEqual(table[severity]);
    }
  });

  it('pins the odds table at an average bearer, per secret tie kind - a faith or a cult weighs more than a faction', () => {
    const table: Record<AffiliationKind, Record<ComposureTier, number>> = {
      faction: { holds: 75, frays: 25, breaks: 0 },
      cause: { holds: 75, frays: 25, breaks: 0 },
      other: { holds: 70, frays: 25, breaks: 5 },
      cult: { holds: 60, frays: 25, breaks: 15 },
      religion: { holds: 60, frays: 25, breaks: 15 },
    };
    for (const kind of ['faction', 'cause', 'other', 'cult', 'religion'] as const) {
      expect(odds(TIE_COMPOSURE_DIFFICULTY[kind]), kind).toEqual(table[kind]);
    }
  });

  it('rises with weight: a graver mark holds less and breaks more', () => {
    const light = odds(MARK_COMPOSURE_DIFFICULTY.light);
    const serious = odds(MARK_COMPOSURE_DIFFICULTY.serious);
    const grave = odds(MARK_COMPOSURE_DIFFICULTY.grave);
    expect(light.holds).toBeGreaterThan(serious.holds);
    expect(serious.holds).toBeGreaterThan(grave.holds);
    expect(light.breaks).toBeLessThan(serious.breaks);
    expect(serious.breaks).toBeLessThan(grave.breaks);
  });

  it('lands each margin in its band at the thresholds', () => {
    expect(resolveComposure({ roll: 10, modifier: 0, difficulty: 10 }).tier).toBe('holds');
    expect(resolveComposure({ roll: 9, modifier: 0, difficulty: 10 }).tier).toBe('frays');
    expect(resolveComposure({ roll: 5, modifier: 0, difficulty: 10 })).toEqual({ margin: COMPOSURE_TIER_THRESHOLDS.FRAYS_MIN, tier: 'frays' });
    expect(resolveComposure({ roll: 4, modifier: 0, difficulty: 10 }).tier).toBe('breaks');
    expect(() => resolveComposure({ roll: 21, modifier: 0, difficulty: 10 })).toThrow(/1-20/);
  });

  it('cunning helps hide anything; paranoia helps keep a secret tie but not a mark', () => {
    const average = makePersonality();
    const cunning = makePersonality({ cunning: 9 });
    const dull = makePersonality({ cunning: 1 });
    const guarded = makePersonality({ paranoia: 9 });
    expect(deriveComposureModifier(average, 'mark')).toBe(0);
    expect(deriveComposureModifier(cunning, 'mark')).toBe(2);
    expect(deriveComposureModifier(dull, 'mark')).toBe(-2);
    expect(deriveComposureModifier(guarded, 'mark')).toBe(0);
    expect(deriveComposureModifier(guarded, 'tie')).toBe(1);
    expect(deriveComposureModifier(makePersonality({ cunning: 9, paranoia: 9 }), 'tie')).toBe(3);
    // Off-scale traits count only on their 1-10 scale; no personality is average.
    expect(deriveComposureModifier(makePersonality({ cunning: 90 }), 'mark')).toBe(2.5);
    expect(deriveComposureModifier(undefined, 'tie')).toBe(0);
    // And it moves the odds: a cunning bearer holds a grave mark more often.
    expect(odds(MARK_COMPOSURE_DIFFICULTY.grave, deriveComposureModifier(cunning, 'mark')).holds).toBe(50);
    expect(odds(MARK_COMPOSURE_DIFFICULTY.grave, deriveComposureModifier(dull, 'mark')).holds).toBe(30);
  });

  it('rolls one d20 per inward mark and secret tie - never an outward mark or an open tie - in a fixed order', () => {
    const bearer = makeEntity({
      entity_id: 'julia', name: 'Julia',
      conditions: [
        mark({ id: 'scar', name: 'a scar', outward: true }),
        mark({ id: 'nightmares', name: 'nightmares', severity: 'grave' }),
      ],
      affiliations: [
        tie({ id: 'state', name: 'the gods of the state', kind: 'religion', public: true }),
        tie({ id: 'origen', name: 'the circle of Origen', kind: 'religion' }),
      ],
    });
    expect(composureSubjectsOf(bearer).map(subject => subject.id)).toEqual(['nightmares', 'origen']);
    const rolls = rollComposure(bearer, createSeededRng(7));
    expect(rolls.map(roll => [roll.subjectKind, roll.subjectId, roll.difficulty])).toEqual([
      ['mark', 'nightmares', MARK_COMPOSURE_DIFFICULTY.grave],
      ['tie', 'origen', TIE_COMPOSURE_DIFFICULTY.religion],
    ]);
    for (const roll of rolls) {
      expect(roll.roll).toBeGreaterThanOrEqual(1);
      expect(roll.roll).toBeLessThanOrEqual(20);
      expect(roll.tier).toBe(resolveComposure(roll).tier);
    }
    expect(rolls[0].severity).toBe('grave');
    expect(rolls[1].tieKind).toBe('religion');
  });

  it('is deterministic given the generator, and draws nothing for a bearer who hides nothing', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'a', name: 'a grief' }), mark({ id: 'b', name: 'a dread' })] });
    expect(rollComposure(bearer, createSeededRng(123))).toEqual(rollComposure(bearer, createSeededRng(123)));
    const rng = createSeededRng(5);
    expect(rollComposure(makeEntity({ entity_id: 'plain', name: 'Plain' }), rng)).toEqual([]);
    // The generator was not touched: its next draw is its first.
    expect(rng()).toBe(createSeededRng(5)());
  });
});

describe('D50 composure: what an NPC is told of the player - code lines, never the model', () => {
  const roll = (subjectKind: 'mark' | 'tie', tier: ComposureTier, extra: Partial<ComposureRoll> = {}) =>
    ({ subjectKind, subjectName: subjectKind === 'mark' ? 'nightmares of the Guard' : 'the sages of the lararium', tier, ...extra });

  it('says nothing for what held', () => {
    expect(playerComposureTell(roll('mark', 'holds'), 'Severus')).toBeNull();
    expect(playerComposureTell(roll('tie', 'holds'), 'Severus')).toBeNull();
  });

  it('a mark that frays shows its weight, not its cause; one that breaks shows its NAME only', () => {
    expect(playerComposureTell(roll('mark', 'frays'), 'Severus')).toBe('Something weighs on Severus: at moments it shows in the voice or the eyes, its cause unspoken.');
    expect(playerComposureTell(roll('mark', 'breaks'), 'Severus')).toBe('It shows plainly on Severus: nightmares of the Guard.');
  });

  it('a tie that frays is a hint; one that breaks is a plain sign of its KIND - never its name', () => {
    expect(playerComposureTell(roll('tie', 'frays'), 'Severus')).toBe('Severus lets slip a hint of some private devotion or allegiance — a gesture, a word caught back.');
    expect(playerComposureTell(roll('tie', 'breaks', { tieKind: 'religion' }), 'Severus')).toBe('Severus shows plain signs of some secret faith, though it goes unnamed.');
    expect(playerComposureTell(roll('tie', 'breaks', { tieKind: 'cult' }), 'Severus')).toBe('Severus shows plain signs of some secret cult, though it goes unnamed.');
    expect(playerComposureTell(roll('tie', 'breaks', { tieKind: 'faction' }), 'Severus')).toContain('some secret faction');
    for (const tier of ['frays', 'breaks'] as const) {
      expect(playerComposureTell(roll('tie', tier, { tieKind: 'religion' }), 'Severus')).not.toContain('lararium');
    }
  });
});

describe('D50 composure: the screen a model-authored tell passes', () => {
  const npc = makeEntity({
    entity_id: 'julia', name: 'Julia Mamaea',
    conditions: [
      mark({ id: 'grief_for_varius', name: 'NPC_MARK_NAME_SENTINEL', description: 'NPC_MARK_ACCOUNT_SENTINEL: she mourns in secret.' }),
      mark({ id: 'dread', name: 'a dread of the Guard', severity: 'light' }),
      mark({ id: 'scar', name: 'a scar on the hand', outward: true }),
    ],
    affiliations: [tie({ id: 'circle_of_origen', name: 'the circle of Origen', kind: 'religion' })],
  });
  const rolls: ComposureRoll[] = [
    { subjectKind: 'mark', subjectId: 'grief_for_varius', subjectName: 'NPC_MARK_NAME_SENTINEL', severity: 'serious', roll: 6, modifier: 0, difficulty: 10, tier: 'frays' },
    { subjectKind: 'mark', subjectId: 'dread', subjectName: 'a dread of the Guard', severity: 'light', roll: 18, modifier: 0, difficulty: 7, tier: 'holds' },
    { subjectKind: 'tie', subjectId: 'circle_of_origen', subjectName: 'the circle of Origen', tieKind: 'religion', roll: 1, modifier: 0, difficulty: 9, tier: 'breaks' },
  ];

  it('keeps a valid delivery and a sign for a subject that frayed or broke', () => {
    const screened = screenNpcTells({
      delivery: 'voice catching',
      signs: [
        { subject: 'grief_for_varius', sign: 'Her voice catches, and she looks to the window.' },
        { subject: 'circle_of_origen', sign: 'Her lips move in a prayer she does not finish.' },
      ],
    }, npc, rolls);
    expect(screened).toEqual({
      delivery: 'voice catching',
      signs: [
        { subject: 'grief_for_varius', sign: 'Her voice catches, and she looks to the window.' },
        { subject: 'circle_of_origen', sign: 'Her lips move in a prayer she does not finish.' },
      ],
    });
  });

  it('drops a sign for a subject that HELD, one that is not this NPC\'s hidden subject, and a second for the same subject', () => {
    const screened = screenNpcTells({
      signs: [
        { subject: 'dread', sign: 'She glances at the door.' },
        { subject: 'scar', sign: 'She rubs the old scar.' },
        { subject: 'someone_elses', sign: 'A shiver.' },
        { subject: 'grief_for_varius', sign: 'Her voice catches.' },
        { subject: 'grief_for_varius', sign: 'She looks away again.' },
      ],
    }, npc, rolls);
    expect(screened.signs).toEqual([{ subject: 'grief_for_varius', sign: 'Her voice catches.' }]);
  });

  it('SENTINEL: drops any sign or delivery that names or recounts a hidden mark or tie', () => {
    const screened = screenNpcTells({
      delivery: 'NPC_MARK_NAME_SENTINEL',
      signs: [
        { subject: 'grief_for_varius', sign: 'She speaks of NPC_MARK_NAME_SENTINEL.' },
        { subject: 'grief_for_varius', sign: 'npc_mark_account_sentinel: she mourns in secret.' },
        { subject: 'circle_of_origen', sign: 'She murmurs a word of Origen.' },
        { subject: 'circle_of_origen', sign: 'She betrays the circle of Origen.' },
      ],
    }, npc, rolls);
    expect(screened).toEqual({ signs: [] });
    const withGrief = screenNpcTells({ delivery: 'grief for varius', signs: [] }, npc, rolls);
    expect(withGrief.delivery).toBeUndefined();
  });

  it('drops an invalid delivery - a name, a figure, a runaway, quotation - and bounds the signs', () => {
    for (const delivery of ['Philip whispers', 'sighing 3 times', 'x'.repeat(61), 'with "irony"', 'rolled a natural 20', 42]) {
      expect(screenNpcTells({ delivery }, npc, rolls).delivery, String(delivery)).toBeUndefined();
    }
    expect(screenNpcTells({ delivery: '(Voice catching.)' }, npc, rolls).delivery).toBe('voice catching');
    expect(screenNpcTells({ delivery: 'As if stifling a sob' }, npc, rolls).delivery).toBe('as if stifling a sob');
    const many = screenNpcTells({ signs: [
      { subject: 'grief_for_varius', sign: 'One.' }, { subject: 'circle_of_origen', sign: 'Two.' }, { subject: 'grief_for_varius', sign: 'Three.' },
    ] }, npc, rolls);
    expect(many.signs.length).toBeLessThanOrEqual(MAX_SIGNS_PER_REPLY);
    for (const sign of ['Her hand shakes 3 times.', 'x'.repeat(161), '', 7, 'She rolled a natural 20.']) {
      expect(screenNpcTells({ signs: [{ subject: 'grief_for_varius', sign }] }, npc, rolls).signs, String(sign)).toEqual([]);
    }
    expect(screenNpcTells({ signs: 'not a list' }, npc, rolls).signs).toEqual([]);
  });

  it('gives the narrator opaque handles for what frayed or broke, never for what held, and screens its signs the same way', () => {
    const cues = composureCuesFrom([{ entityId: 'julia', entityName: 'Julia Mamaea', rolls }]);
    expect(cues.map(cue => [cue.handle, cue.roll.subjectId])).toEqual([['c1', 'grief_for_varius'], ['c2', 'circle_of_origen']]);
    const signs = screenNarrationSigns([
      { entity: 'julia', handle: 'c1', sign: 'Her voice caught on the word.' },
      { entity: 'julia', handle: 'c1', sign: 'Again.' },
      { entity: 'someone', handle: 'c2', sign: 'A prayer.' },
      { entity: 'julia', handle: 'c9', sign: 'Nothing.' },
      { entity: 'julia', handle: 'c2', sign: 'She murmurs to Origen.' },
    ], cues, [npc]);
    expect(signs).toEqual([{ entityId: 'julia', subject: 'grief_for_varius', sign: 'Her voice caught on the word.' }]);
    expect(screenNarrationSigns(undefined, cues, [npc])).toEqual([]);
    expect(screenNarrationSigns(Array.from({ length: 9 }, (_, i) => ({ handle: `c${(i % 2) + 1}`, sign: `A tell.` })), cues, [npc]).length).toBeLessThanOrEqual(MAX_NARRATION_SIGNS);
  });
});

describe('D50 composure: reading the persisted records', () => {
  it('drops a malformed roll or sign, and reads an absent record as none', () => {
    const good: ComposureRoll = { subjectKind: 'mark', subjectId: 'a', subjectName: 'a grief', severity: 'light', roll: 3, modifier: 0.5, difficulty: 7, tier: 'frays' };
    expect(normalizeComposureRolls([good, { ...good, roll: 0 }, { ...good, tier: 'crumbles' }, null, 'x', { ...good, extra: 'POISON' }])).toEqual([good, good]);
    expect(normalizeComposureRolls(undefined)).toEqual([]);
    expect(composureRollsOf({})).toEqual([]);
    expect(composureRollsOf({ composureRolls: [{ entityId: 'j', entityName: 'J', rolls: [good, { bad: true }] }, { nope: 1 }] as never })).toEqual([
      { entityId: 'j', entityName: 'J', rolls: [good] },
    ]);
    expect(composureSignsOf({ composureSigns: [{ entityId: 'j', subject: 'a', sign: 'A tell.' }, { entityId: 'j' }] as never })).toEqual([
      { entityId: 'j', subject: 'a', sign: 'A tell.' },
    ]);
  });
});
