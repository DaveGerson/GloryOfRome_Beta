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
  breakingMarkNameMayShow,
  buildTellScreen,
  composureCuesFrom,
  composureSubjectHandle,
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
  stemOf,
  tellWorldOf,
} from '../ai/core/composure';
import { validateDelivery } from '../narration/performanceScript';
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

/** A roll as rollComposure writes it: handle and all. */
function rolled(subjectKind: 'mark' | 'tie', subjectId: string, subjectName: string, tier: ComposureTier, extra: Partial<ComposureRoll> = {}): ComposureRoll {
  return { subjectKind, subjectId, handle: `${subjectKind}:${subjectId}`, subjectName, roll: 6, modifier: 0, difficulty: 10, tier, ...extra };
}

describe('D50 composure: what an NPC is told of the player - code lines, never the model', () => {
  const severus = makeEntity({
    entity_id: 'player', name: 'Severus',
    conditions: [mark({ id: 'nightmares', name: 'nightmares of the Guard' })],
    affiliations: [tie({ id: 'lararium', name: 'the sages of the lararium', kind: 'religion' })],
  });
  const markRoll = (tier: ComposureTier) => rolled('mark', 'nightmares', 'nightmares of the Guard', tier);
  const tieRoll = (tier: ComposureTier, tieKind: AffiliationKind = 'religion') => rolled('tie', 'lararium', 'the sages of the lararium', tier, { tieKind });

  it('says nothing for what held', () => {
    expect(playerComposureTell(markRoll('holds'), severus)).toBeNull();
    expect(playerComposureTell(tieRoll('holds'), severus)).toBeNull();
  });

  it('a mark that frays shows its weight, not its cause; one that breaks shows its NAME only', () => {
    expect(playerComposureTell(markRoll('frays'), severus)).toBe('Something weighs on Severus: at moments it shows in the voice or the eyes, its cause unspoken.');
    expect(playerComposureTell(markRoll('breaks'), severus)).toBe('It shows plainly on Severus: nightmares of the Guard.');
  });

  it('a tie that frays is a hint; one that breaks is a plain sign of its KIND - never its name', () => {
    expect(playerComposureTell(tieRoll('frays'), severus)).toBe('Severus lets slip a hint of some private devotion or allegiance — a gesture, a word caught back.');
    expect(playerComposureTell(tieRoll('breaks'), severus)).toBe('Severus shows plain signs of some secret faith, though it goes unnamed.');
    expect(playerComposureTell(tieRoll('breaks', 'cult'), severus)).toBe('Severus shows plain signs of some secret cult, though it goes unnamed.');
    expect(playerComposureTell(tieRoll('breaks', 'faction'), severus)).toContain('some secret faction');
    for (const tier of ['frays', 'breaks'] as const) expect(playerComposureTell(tieRoll(tier), severus)).not.toContain('lararium');
  });

  it('S2: a breaking mark whose NAME would betray another thing the player keeps is told unnamed', () => {
    const convert = makeEntity({
      entity_id: 'player', name: 'Severus',
      conditions: [mark({ id: 'dread', name: 'Dread of being found out as a Christian' })],
      affiliations: [tie({ id: 'christ', name: 'the Christian faith', kind: 'religion' })],
    });
    const breaking = rolled('mark', 'dread', 'Dread of being found out as a Christian', 'breaks');
    expect(playerComposureTell(breaking, convert)).toBe('Something weighs plainly on Severus, though it goes unnamed.');
    // Nothing else kept that the name could betray: it is told by name.
    expect(playerComposureTell(breaking, { ...convert, affiliations: [] })).toBe('It shows plainly on Severus: Dread of being found out as a Christian.');
  });
});

describe('D50 composure: the narrator is told a mark\'s name only when it broke and betrays nothing else', () => {
  const bearer = makeEntity({
    entity_id: 'lycinia', name: 'Lycinia Stolo',
    conditions: [mark({ id: 'terror', name: 'Terror that her rites to Bacchus will be found out' }), mark({ id: 'grief', name: 'grief for her brother' })],
    affiliations: [tie({ id: 'cult_of_bacchus', name: 'Cult of Bacchus' })],
  });

  it('S1: never for a fraying mark; for a breaking one, not when its name carries a kept tie', () => {
    expect(breakingMarkNameMayShow(bearer, rolled('mark', 'terror', 'Terror that her rites to Bacchus will be found out', 'frays'))).toBe(false);
    expect(breakingMarkNameMayShow(bearer, rolled('mark', 'terror', 'Terror that her rites to Bacchus will be found out', 'breaks'))).toBe(false);
    expect(breakingMarkNameMayShow(bearer, rolled('mark', 'grief', 'grief for her brother', 'breaks'))).toBe(true);
    expect(breakingMarkNameMayShow({ ...bearer, affiliations: [] }, rolled('mark', 'terror', 'Terror that her rites to Bacchus will be found out', 'breaks'))).toBe(true);
    const cues = composureCuesFrom([{ entityId: 'lycinia', entityName: 'Lycinia Stolo', rolls: [
      rolled('mark', 'terror', 'Terror that her rites to Bacchus will be found out', 'breaks'),
      rolled('mark', 'grief', 'grief for her brother', 'breaks'),
      rolled('tie', 'cult_of_bacchus', 'Cult of Bacchus', 'holds', { tieKind: 'cult' }),
    ] }], [bearer]);
    expect(cues.map(cue => [cue.handle, cue.named])).toEqual([['c1', false], ['c2', true]]);
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
    rolled('mark', 'grief_for_varius', 'NPC_MARK_NAME_SENTINEL', 'frays', { severity: 'serious' }),
    rolled('mark', 'dread', 'a dread of the Guard', 'holds', { severity: 'light' }),
    rolled('tie', 'circle_of_origen', 'the circle of Origen', 'breaks', { tieKind: 'religion' }),
  ];

  it('keeps a valid delivery and a sign for a subject that frayed or broke, by its handle', () => {
    const screened = screenNpcTells({
      delivery: 'voice catching',
      signs: [
        { subject: 'mark:grief_for_varius', sign: 'Her voice catches, and she looks to the window.' },
        { subject: 'tie:circle_of_origen', sign: 'Her lips move in a prayer she does not finish.' },
      ],
    }, npc, rolls);
    expect(screened).toEqual({
      delivery: 'voice catching',
      signs: [
        { subject: 'mark:grief_for_varius', sign: 'Her voice catches, and she looks to the window.' },
        { subject: 'tie:circle_of_origen', sign: 'Her lips move in a prayer she does not finish.' },
      ],
    });
  });

  it('drops a sign for a subject that HELD, one that is not this NPC\'s hidden subject, a bare id, and a second for the same subject', () => {
    const screened = screenNpcTells({
      signs: [
        { subject: 'mark:dread', sign: 'She glances at the door.' },
        { subject: 'mark:scar', sign: 'She rubs the old scar.' },
        { subject: 'mark:someone_elses', sign: 'A shiver.' },
        { subject: 'grief_for_varius', sign: 'She looks away.' },
        { subject: 'mark:grief_for_varius', sign: 'Her voice catches.' },
        { subject: 'mark:grief_for_varius', sign: 'She looks away again.' },
      ],
    }, npc, rolls);
    expect(screened.signs).toEqual([{ subject: 'mark:grief_for_varius', sign: 'Her voice catches.' }]);
  });

  it('SENTINEL: drops any sign or delivery that names or recounts a hidden mark or tie', () => {
    const screened = screenNpcTells({
      delivery: 'NPC_MARK_NAME_SENTINEL',
      signs: [
        { subject: 'mark:grief_for_varius', sign: 'She speaks of NPC_MARK_NAME_SENTINEL.' },
        { subject: 'mark:grief_for_varius', sign: 'npc_mark_account_sentinel: she mourns in secret.' },
        { subject: 'tie:circle_of_origen', sign: 'She murmurs a word of Origen.' },
        { subject: 'tie:circle_of_origen', sign: 'She betrays the circle of Origen.' },
      ],
    }, npc, rolls);
    expect(screened).toEqual({ signs: [] });
    expect(screenNpcTells({ delivery: 'grief for varius', signs: [] }, npc, rolls).delivery).toBeUndefined();
  });

  it('drops an invalid delivery - a name, a figure, a runaway, quotation - and bounds the signs', () => {
    for (const delivery of ['with a glance at Philip', 'sighing 3 times', 'x'.repeat(61), 'with "irony"', 'rolled a natural 20', 42]) {
      expect(screenNpcTells({ delivery }, npc, rolls).delivery, String(delivery)).toBeUndefined();
    }
    expect(screenNpcTells({ delivery: '(Voice catching.)' }, npc, rolls).delivery).toBe('voice catching');
    expect(screenNpcTells({ delivery: 'As if stifling a sob' }, npc, rolls).delivery).toBe('as if stifling a sob');
    const many = screenNpcTells({ signs: [
      { subject: 'mark:grief_for_varius', sign: 'One.' }, { subject: 'tie:circle_of_origen', sign: 'Two.' }, { subject: 'mark:grief_for_varius', sign: 'Three.' },
    ] }, npc, rolls);
    expect(many.signs.length).toBeLessThanOrEqual(MAX_SIGNS_PER_REPLY);
    for (const sign of ['Her hand shakes 3 times.', 'x'.repeat(161), '', 7, 'She rolled a natural 20.']) {
      expect(screenNpcTells({ signs: [{ subject: 'mark:grief_for_varius', sign }] }, npc, rolls).signs, String(sign)).toEqual([]);
    }
    expect(screenNpcTells({ signs: 'not a list' }, npc, rolls).signs).toEqual([]);
  });

  it('gives the narrator opaque handles for what frayed or broke, never for what held, and screens its signs the same way', () => {
    const bearers = [{ entityId: 'julia', entityName: 'Julia Mamaea', rolls }];
    const cues = composureCuesFrom(bearers, [npc]);
    expect(cues.map(cue => [cue.handle, cue.roll.handle, cue.named])).toEqual([['c1', 'mark:grief_for_varius', false], ['c2', 'tie:circle_of_origen', false]]);
    const signs = screenNarrationSigns([
      { entity: 'julia', handle: 'c1', sign: 'Her voice caught on the word.' },
      { entity: 'julia', handle: 'c1', sign: 'Again.' },
      { entity: 'someone', handle: 'c2', sign: 'A prayer.' },
      { entity: 'julia', handle: 'c9', sign: 'Nothing.' },
      { entity: 'julia', handle: 'c2', sign: 'She murmurs to Origen.' },
    ], cues, [npc], bearers);
    expect(signs).toEqual([{ entityId: 'julia', subject: 'mark:grief_for_varius', sign: 'Her voice caught on the word.' }]);
    expect(screenNarrationSigns(undefined, cues, [npc], bearers)).toEqual([]);
    expect(screenNarrationSigns(Array.from({ length: 9 }, (_, i) => ({ handle: `c${(i % 2) + 1}`, sign: 'A tell.' })), cues, [npc], bearers).length).toBeLessThanOrEqual(MAX_NARRATION_SIGNS);
  });
});

describe('D50 composure: the screen\'s stems (S3)', () => {
  const tieScreen = (name: string) => buildTellScreen(makeEntity({ entity_id: 'x', name: 'X', affiliations: [tie({ id: 't', name })] }), []);

  it('reduces a word to its stem by common endings, never below four letters', () => {
    expect(stemOf('Christians')).toBe('christ');
    expect(stemOf('Christianity')).toBe('christ');
    expect(stemOf('Bacchus')).toBe('bacch');
    expect(stemOf('Mithras')).toBe('mithra');
    expect(stemOf('Origen')).toBe('origen');
    expect(stemOf('rites')).toBe('rite');
    expect(stemOf('Marcus')).toBe('marc');
  });

  it('never lets a secret tie\'s name through, by its stem at a word\'s start, whatever the tier or case', () => {
    const probes: Array<[string, string]> = [
      ['the Christian faith', 'She whispers a word to Christ.'],
      ['the Christian faith', 'She has the look of the Christians.'],
      ['the cult of Bacchus', 'A Bacchic hymn catches in her throat.'],
      ['the cult of Bacchus', 'She sways like a Bacchant.'],
      ['the cult of bacchus', 'She hums something bacchic.'],
      ['the mysteries of Mithras', 'She makes the sign of Mithras.'],
      ['the circle of Origen', 'An Origenist phrase slips out.'],
    ];
    for (const [name, sign] of probes) {
      expect(tieScreen(name).sign(sign), `${name}: ${sign}`).toBeNull();
      expect(tieScreen(name).delivery(sign.replace(/\.$/, '').toLowerCase().slice(0, 40)), `${name} delivery`).toBeNull();
    }
    expect(tieScreen('the cult of Bacchus').sign('Her hand goes still.')).toBe('Her hand goes still.');
  });

  it('keeps nothing of a HELD subject - mark or tie - in a sign or a delivery', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'marcus', name: 'grief for Marcus', description: 'She lost him at the river.' })] });
    const screen = buildTellScreen(bearer, [rolled('mark', 'marcus', 'grief for Marcus', 'holds')]);
    expect(screen.delivery('flinching at the name marcus')).toBeNull();
    expect(screen.sign('Her grief is plain.')).toBeNull();
    expect(screen.sign('She will not look at the river.')).toBeNull();
    expect(screen.sign('She looks away.')).toBe('She looks away.');
  });

  it('keeps nothing of a FRAYING mark - its name or its account, the cause', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'arena', name: 'dread of the arena', description: 'She saw her brother Titus die on the sand.' })] });
    const screen = buildTellScreen(bearer, [rolled('mark', 'arena', 'dread of the arena', 'frays')]);
    expect(screen.sign('She will not look toward the arena.')).toBeNull();
    expect(screen.sign('She flinches at the name Titus.')).toBeNull();
    expect(screen.sign('Her voice catches.')).toBe('Her voice catches.');
  });

  it('lets a BREAKING mark\'s name show, never its account\'s proper nouns', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'grief', name: 'grief', description: 'She mourns Varius, her son.' })] });
    const screen = buildTellScreen(bearer, [rolled('mark', 'grief', 'grief', 'breaks')]);
    expect(screen.sign('Her grief is plain to see.')).toBe('Her grief is plain to see.');
    expect(screen.sign('She mourns openly.')).toBe('She mourns openly.');
    expect(screen.sign('She mourns Varius openly.')).toBeNull();
  });

  it('does not over-block: a short word matches whole, a longer one at a word\'s start, never inside a word', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [
      mark({ id: 'war', name: 'War' }), mark({ id: 'ill', name: 'Ill' }), mark({ id: 'fear', name: 'Fear' }),
    ] });
    const screen = buildTellScreen(bearer, []);
    expect(screen.sign('She glances toward the door.')).toBe('She glances toward the door.');
    expect(screen.sign('She will not say.')).toBe('She will not say.');
    expect(screen.sign('Talk of war silences her.')).toBeNull();
    expect(screen.sign('A fearful glance.')).toBeNull();
  });

  it('drops a tell made only of punctuation (M3), or one that speaks of the mechanics (M7)', () => {
    const screen = buildTellScreen(makeEntity({ entity_id: 'x', name: 'X' }), []);
    for (const text of ['—', '...', '!?', 'Her composure roll failed.', 'At difficulty nine, she breaks.', 'By chance she looks up.', 'She would rather die.']) {
      expect(screen.sign(text), text).toBeNull();
    }
    for (const text of ['—', '...', '!?', 'at difficulty nine', 'as her composure fails', 'rolled eyes']) {
      expect(screen.delivery(text), text).toBeNull();
    }
    expect(screen.delivery('eyes lowered')).toBe('eyes lowered');
    // Whole words only: a mechanics word inside another word is ordinary prose.
    for (const text of ['Her checkered cloak trembles.', 'She dies a little inside.', 'A parchment unrolled in her hands.']) {
      expect(screen.sign(text), text).toBe(text);
    }
    expect(screen.delivery('checkered by doubt')).toBe('checkered by doubt');
  });

  it('names no one on the roster in a delivery, in any case (M4), and no -ed name passes as a word of manner', () => {
    const screen = buildTellScreen(makeEntity({ entity_id: 'x', name: 'X' }), [], { individualNames: ['Julia Mamaea', 'Maximinus Thrax'] });
    expect(screen.delivery('with a glance at mamaea')).toBeNull();
    expect(screen.delivery('thrax-like, curt')).toBeNull();
    expect(screen.delivery('with a glance at the door')).toBe('with a glance at the door');
    expect(validateDelivery('Manfred whispers', ['Manfred of Gaul'])).toBeNull();
    expect(validateDelivery('Choked, barely audible')).toBe('choked, barely audible');
    expect(validateDelivery('Trembling')).toBe('trembling');
  });
});

describe('D50 composure: one handle space for marks and ties (S4)', () => {
  it('gives a mark and a tie that share an id distinct handles, and screens each by its own', () => {
    const bearer = makeEntity({
      entity_id: 'x', name: 'X',
      conditions: [mark({ id: 'mithras', name: 'dread of the dark', severity: 'grave' })],
      affiliations: [tie({ id: 'mithras', name: 'the mysteries of the bull' })],
    });
    const rolls = rollComposure(bearer, createSeededRng(9)).map(roll => ({ ...roll, tier: roll.subjectKind === 'mark' ? 'frays' as const : 'holds' as const }));
    expect(rolls.map(roll => roll.handle)).toEqual(['mark:mithras', 'tie:mithras']);
    const screened = screenNpcTells({ signs: [{ subject: 'tie:mithras', sign: 'She looks down.' }, { subject: 'mark:mithras', sign: 'Her voice catches.' }] }, bearer, rolls);
    expect(screened.signs).toEqual([{ subject: 'mark:mithras', sign: 'Her voice catches.' }]);
  });

  it('reads a bare id saved before handles as the one subject with it, and drops one it cannot place', () => {
    const rolls = [rolled('mark', 'grief', 'grief', 'frays'), rolled('mark', 'mithras', 'a', 'frays'), rolled('tie', 'mithras', 'b', 'frays')];
    expect(composureSubjectHandle('grief', rolls)).toBe('mark:grief');
    expect(composureSubjectHandle('mithras', rolls)).toBeNull();
    expect(composureSubjectHandle('nothing', rolls)).toBeNull();
    expect(composureSubjectHandle('tie:mithras', rolls)).toBe('tie:mithras');
  });
});

describe('D50 composure: reading the persisted records', () => {
  it('drops a malformed roll or sign, rebuilds each handle, and reads an absent record as none', () => {
    const good = rolled('mark', 'a', 'a grief', 'frays', { severity: 'light', roll: 3, modifier: 0.5, difficulty: 7 });
    const { handle: _handle, ...legacy } = good;
    expect(normalizeComposureRolls([good, { ...good, roll: 0 }, { ...good, tier: 'crumbles' }, null, 'x', { ...good, extra: 'POISON' }, legacy, { ...good, handle: 'tie:forged' }])).toEqual([good, good, good, good]);
    expect(normalizeComposureRolls(undefined)).toEqual([]);
    expect(composureRollsOf({})).toEqual([]);
    expect(composureRollsOf({ composureRolls: [{ entityId: 'j', entityName: 'J', rolls: [good, { bad: true }] }, { nope: 1 }] as never })).toEqual([
      { entityId: 'j', entityName: 'J', rolls: [good] },
    ]);
    // A 6901844-era sign names its subject by bare id: read against the entry's rolls.
    expect(composureSignsOf({
      composureRolls: [{ entityId: 'j', entityName: 'J', rolls: [good] }],
      composureSigns: [{ entityId: 'j', subject: 'a', sign: 'A tell.' }, { entityId: 'j', subject: 'mark:a', sign: 'Another.' }, { entityId: 'j' }, { entityId: 'j', subject: 'zzz', sign: 'Lost.' }] as never,
    })).toEqual([
      { entityId: 'j', subject: 'mark:a', sign: 'A tell.' },
      { entityId: 'j', subject: 'mark:a', sign: 'Another.' },
    ]);
  });
});

describe('D50 composure: the names a tell may give a hidden subject by', () => {
  const tieScreen = (name: string) => buildTellScreen(makeEntity({ entity_id: 'x', name: 'X', affiliations: [tie({ id: 't', name })] }), []);

  it('reads a secret tie\'s name but its articles and "of": "the One" is caught by "One", and a mark that names it goes unnamed', () => {
    expect(tieScreen('The One').sign('He murmurs of the One.')).toBeNull();
    expect(tieScreen('The One').sign('He murmurs a prayer.')).toBe('He murmurs a prayer.');
    // A tie whose name leaves no such word is caught by its whole name, less its article.
    expect(tieScreen('The Ox').sign('He swears by the Ox.')).toBeNull();
    expect(tieScreen('The Ox').sign('He swears under his breath.')).toBe('He swears under his breath.');
    const bearer = makeEntity({
      entity_id: 'player', name: 'Severus',
      conditions: [mark({ id: 'awe', name: 'Awe of the One' })],
      affiliations: [tie({ id: 'the_one', name: 'The One', kind: 'religion' })],
    });
    const breaking = rolled('mark', 'awe', 'Awe of the One', 'breaks');
    expect(breakingMarkNameMayShow(bearer, breaking)).toBe(false);
    // Told unnamed to the NPC, and to the narrator.
    expect(playerComposureTell(breaking, bearer)).toBe('Something weighs plainly on Severus, though it goes unnamed.');
    expect(composureCuesFrom([{ entityId: 'player', entityName: 'Severus', rolls: [breaking] }], [bearer]).map(cue => cue.named)).toEqual([false]);
  });

  it('matches a capitalized four-letter name by its first three letters too: Isis in "Isiac", Mars in "Martial"', () => {
    expect(tieScreen('the cult of Isis').sign('An Isiac rattle hangs at her belt.')).toBeNull();
    expect(tieScreen('the soldiers of Mars').sign('He stands with a Martial stiffness.')).toBeNull();
    expect(tieScreen('the cult of Isis').sign('Her hand goes still.')).toBe('Her hand goes still.');
    // An account's proper noun too, though the mark broke.
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'vow', name: 'a broken vow', description: 'She swore it before Mars.' })] });
    const screen = buildTellScreen(bearer, [rolled('mark', 'vow', 'a broken vow', 'breaks')]);
    expect(screen.sign('She keeps a martial bearing.')).toBeNull();
    expect(screen.sign('Her broken vow shows plainly.')).toBe('Her broken vow shows plainly.');
  });

  it('folds the spellings a name wanders between: Iesus and Jesus, Khristos and Christ, Bakchos and Bacchus', () => {
    expect(tieScreen('the followers of Jesus').sign('He whispers the name of Iesus.')).toBeNull();
    expect(tieScreen('the followers of Iesus').sign('He whispers the name of Jesus.')).toBeNull();
    expect(tieScreen('the Christian faith').sign('A prayer to Khristos escapes her.')).toBeNull();
    expect(tieScreen('the cult of Bacchus').sign('She hums a hymn to Bakchos.')).toBeNull();
    expect(tieScreen('the cult of Bacchus').sign('She hums under her breath.')).toBe('She hums under her breath.');
  });

  it('counts an account\'s word as a proper noun when it is a word of a known figure\'s or place\'s name, in any case', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({ id: 'grief', name: 'grief', description: 'her son marcus drowned off ostia' })] });
    const rolls = [rolled('mark', 'grief', 'grief', 'breaks')];
    const world = tellWorldOf([makeEntity({ entity_id: 'marcus', name: 'Marcus Varius', location: 'Palatine Hill' })], ['Ostia']);
    const screen = buildTellScreen(bearer, rolls, world);
    expect(screen.sign('She will not speak of Marcus.')).toBeNull();
    expect(screen.sign('Talk of ostia silences her.')).toBeNull();
    expect(screen.sign('Her grief is plain to see.')).toBe('Her grief is plain to see.');
    // Unknown to the world, a lower-case word of a broken mark's account is no proper noun.
    expect(buildTellScreen(bearer, rolls).sign('Talk of ostia silences her.')).toBe('Talk of ostia silences her.');
    // The narrator's signs are screened knowing the roster and the world's places.
    const bearers = [{ entityId: 'x', entityName: 'X', rolls }];
    const cues = composureCuesFrom(bearers, [bearer]);
    expect(screenNarrationSigns([{ handle: 'c1', sign: 'Talk of ostia silences her.' }], cues, [bearer], bearers, ['Ostia'])).toEqual([]);
    expect(screenNarrationSigns([{ handle: 'c1', sign: 'Her grief is plain to see.' }], cues, [bearer], bearers, ['Ostia']).map(sign => sign.sign)).toEqual(['Her grief is plain to see.']);
  });

  it('screens a held or fraying mark by its name, its account\'s proper nouns and longer words - never the words a tell is made of', () => {
    const bearer = makeEntity({ entity_id: 'x', name: 'X', conditions: [mark({
      id: 'loss', name: 'a loss at sea', description: 'Her son Marcus drowned off Ostia; her voice still breaks at the harbour.',
    })] });
    for (const tier of ['holds', 'frays'] as const) {
      const screen = buildTellScreen(bearer, [rolled('mark', 'loss', 'a loss at sea', tier)]);
      expect(screen.sign('Her voice catches, and she looks away.'), tier).toBe('Her voice catches, and she looks away.');
      expect(screen.sign('She thinks of the drowned.'), tier).toBeNull();
      expect(screen.sign('She flinches at the name Marcus.'), tier).toBeNull();
      expect(screen.sign('She will not look toward Ostia.'), tier).toBeNull();
      expect(screen.sign('A harbour bell makes her flinch.'), tier).toBeNull();
      expect(screen.sign('Talk of the sea silences her.'), tier).toBeNull();
    }
  });

  it('reads a delivery\'s opening word in lower case unless it names an individual, and weighs only individuals\' names', () => {
    const roster = [
      makeEntity({ entity_id: 'manfred', name: 'Manfred of Gaul' }),
      makeEntity({ entity_id: 'julia', name: 'Julia Mamaea' }),
      makeEntity({ entity_id: 'guard', name: 'Praetorian Guard', entity_type: 'faction' }),
      makeEntity({ entity_id: 'cabal', name: 'Roman Military Cabal', entity_type: 'faction' }),
    ];
    const screen = buildTellScreen(makeEntity({ entity_id: 'x', name: 'X' }), [], tellWorldOf(roster));
    const kept: Array<[string, string]> = [
      ['Startled', 'startled'], ['Frightened', 'frightened'], ['Resigned', 'resigned'], ['Exasperated', 'exasperated'],
      ['with Roman pride', 'with Roman pride'], ['on guard', 'on guard'], ['with military bluntness', 'with military bluntness'],
    ];
    for (const [raw, delivery] of kept) expect(screen.delivery(raw), raw).toBe(delivery);
    for (const raw of ['manfred whispers', 'Manfred whispers', 'with a glance at mamaea']) expect(screen.delivery(raw), raw).toBeNull();
    // A cue adjective in an individual's name still says how, not who.
    expect(validateDelivery('with Roman pride', ['Titus the Roman'])).toBe('with Roman pride');
  });
});
