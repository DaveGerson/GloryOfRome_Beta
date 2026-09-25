/**
 * tests/voiceCast.test.ts
 *
 * The voice catalog and the voice cast's pure core
 * (narration/voiceCatalog.ts, narration/voiceCast.ts):
 *
 *  - the catalog is pinned, id by id, so a typo cannot ship;
 *  - the deterministic, register-aware casting (the fallback and Mock Mode);
 *  - `ensureUniqueCast`: distinct voices while the thirty last, then
 *    distinct delivery notes - past thirty members too;
 *  - overrides, completing a cast, and validating a stored one.
 */
import { describe, expect, it } from 'vitest';
import { CASTING_VOICES, VOICE_CATALOG, catalogVoice, isCatalogVoice } from '../narration/voiceCatalog';
import {
  FALLBACK_RATIONALE,
  MAX_CAST_STYLE_CHARS,
  NARRATOR_SLOT_ID,
  castStyle,
  castingCandidatesFor,
  completeCast,
  deterministicCast,
  deterministicMember,
  ensureUniqueCast,
  inferRegister,
  memberVoice,
  newestVoiceCast,
  normalizeVoiceCast,
  withMemberOverride,
  withoutMemberOverride,
  type CastSlot,
  type CastingCandidate,
} from '../narration/voiceCast';
import { sanitizeVoiceStyleText } from '../narration/voiceStyle';
import { ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { makeEntity } from './factories';

const DEFAULTS = { narratorId: 'senatorial-partner', voiceName: 'Enceladus' };
const person = (entityId: string, name: string, position?: string, epithet?: string): CastingCandidate =>
  ({ entityId, name, ...(position ? { position } : {}), ...(epithet ? { epithet } : {}), entityType: 'individual' });

describe('the voice catalog', () => {
  it('is pinned: the thirty Gemini TTS voices with their published descriptors and believed registers, then Brio', () => {
    expect(VOICE_CATALOG.map(v => `${v.id}:${v.descriptor}:${v.register}`)).toEqual([
      'Zephyr:Bright:feminine', 'Puck:Upbeat:masculine', 'Charon:Informative:masculine', 'Kore:Firm:feminine',
      'Fenrir:Excitable:masculine', 'Leda:Youthful:feminine', 'Orus:Firm:masculine', 'Aoede:Breezy:feminine',
      'Callirrhoe:Easy-going:feminine', 'Autonoe:Bright:feminine', 'Enceladus:Breathy:masculine', 'Iapetus:Clear:masculine',
      'Umbriel:Easy-going:masculine', 'Algieba:Smooth:masculine', 'Despina:Smooth:feminine', 'Erinome:Clear:feminine',
      'Algenib:Gravelly:masculine', 'Rasalgethi:Informative:masculine', 'Laomedeia:Upbeat:feminine', 'Achernar:Soft:feminine',
      'Alnilam:Firm:masculine', 'Schedar:Even:masculine', 'Gacrux:Mature:feminine', 'Pulcherrima:Forward:feminine',
      'Achird:Friendly:masculine', 'Zubenelgenubi:Casual:masculine', 'Vindemiatrix:Gentle:feminine', 'Sadachbia:Lively:masculine',
      'Sadaltager:Knowledgeable:masculine', 'Sulafat:Warm:feminine', 'Brio:Reference:unknown',
    ]);
    expect(CASTING_VOICES).toHaveLength(30);
    expect(CASTING_VOICES.filter(v => v.register === 'feminine')).toHaveLength(14);
    expect(isCatalogVoice('Brio')).toBe(true);
    expect(isCatalogVoice('Nobody')).toBe(false);
    expect(catalogVoice('Gacrux')?.descriptor).toBe('Mature');
  });

  it('holds every voice a shipped narrator or the curated list uses', async () => {
    const { NARRATOR_VOICES } = await import('../persistence/uiPrefs');
    const { NARRATORS } = await import('../narration/narrators');
    for (const id of [...NARRATOR_VOICES.map(v => v.id), ...NARRATORS.map(n => n.voice.voiceName)]) expect(isCatalogVoice(id)).toBe(true);
  });
});

describe('deterministic, register-aware casting', () => {
  it('reads register from a title first, then cautiously from a Latin first name', () => {
    expect(inferRegister(person('a', 'Julia Mamaea', 'Regent', 'Mother of the Camp'))).toBe('feminine');
    expect(inferRegister(person('b', 'Varia', 'Augusta'))).toBe('feminine');
    expect(inferRegister(person('c', 'Some Name', 'Empress'))).toBe('feminine');
    expect(inferRegister(person('d', 'Severus Alexander', 'Emperor'))).toBe('masculine');
    expect(inferRegister(person('e', 'Maximinus Thrax', 'General of the Legions'))).toBe('masculine');
    expect(inferRegister(person('f', 'Lycinia Stolo', 'Informant Broker'))).toBe('feminine');
    expect(inferRegister(person('g', 'Gaius Pontius Magnus', 'Senior Senator'))).toBe('masculine');
    // Men's names ending in -a are not taken for women's.
    expect(inferRegister(person('h', 'Agrippa Postumus'))).toBe('unknown');
    expect(inferRegister(person('i', 'Seneca'))).toBe('unknown');
    // Nothing clear: unknown, never a guess.
    expect(inferRegister(person('j', 'Philip'))).toBe('unknown');
    expect(inferRegister(person('k', 'Ox'))).toBe('unknown');
    // Conflicting titles defer to the name.
    expect(inferRegister(person('l', 'Aurelia', 'Mother of the Emperor'))).toBe('feminine');
  });

  it('casts the base 235 CE scenario by name and standing: a woman in a woman\'s voice, a soldier in a growl', () => {
    const player = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'severus_alexander')!;
    const known = { ...player, visibility_network: ALL_INITIAL_ENTITIES.map(e => e.entity_id) };
    const candidates = castingCandidatesFor(known, ALL_INITIAL_ENTITIES.map(e => (e.entity_id === known.entity_id ? known : e)), []);
    const cast = deterministicCast(candidates, DEFAULTS);
    const by = (id: string) => cast.members[id];
    expect(by('julia_mamaea')).toMatchObject({ voiceName: 'Gacrux', style: 'cool, imperious and measured', source: 'fallback' });
    expect(by('maximinus_thrax')).toMatchObject({ voiceName: 'Algenib', style: "a soldier's rough growl, few words" });
    expect(by('lycinia_stolo')).toMatchObject({ voiceName: 'Despina', style: 'low, sly and knowing' });
    expect(by('gaius_pontius_magnus')).toMatchObject({ voiceName: 'Charon', style: "an orator's rolling, measured cadence" });
    expect(catalogVoice(by('julia_mamaea').voiceName)?.register).toBe('feminine');
    expect(catalogVoice(by('lycinia_stolo').voiceName)?.register).toBe('feminine');
    expect(by('julia_mamaea').rationale).toBe(FALLBACK_RATIONALE.rule);
    // Factions and groups are never cast; the player is never cast.
    expect(Object.keys(cast.members).sort()).toEqual(['gaius_pontius_magnus', 'julia_mamaea', 'lycinia_stolo', 'maximinus_thrax']);
    expect(cast.narrator).toMatchObject({ narratorId: 'senatorial-partner', voiceName: 'Enceladus', style: '', source: 'fallback' });
  });

  it('with no signal, a stable hash over the whole catalog, and the same answer every time', () => {
    const a = deterministicMember(person('npc_x', 'Ox'));
    expect(a).toEqual(deterministicMember(person('npc_x', 'Ox')));
    expect(a.rationale).toBe(FALLBACK_RATIONALE.hash);
    expect(a.style).toBe('');
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(id => deterministicMember(person(id, 'Ox')).voiceName));
    expect(spread.size).toBeGreaterThan(3);
  });
});

describe('ensureUniqueCast', () => {
  const pairs = (slots: CastSlot[]) => slots.map(s => `${s.voiceName}|${sanitizeVoiceStyleText(s.style).toLowerCase()}`);

  it('keeps a cast that is already unique exactly as it is', () => {
    const slots = [
      { id: NARRATOR_SLOT_ID, voiceName: 'Enceladus', style: '' },
      { id: 'a', voiceName: 'Gacrux', style: 'cool' },
      { id: 'b', voiceName: 'Algenib', style: 'growl' },
    ];
    expect(ensureUniqueCast(slots)).toEqual(slots);
  });

  it('re-voices a duplicate within its register while voices remain, never taking the narrator\'s', () => {
    const out = ensureUniqueCast([
      { id: NARRATOR_SLOT_ID, voiceName: 'Gacrux', style: '' },
      { id: 'julia', voiceName: 'Gacrux', style: 'cool, imperious' },
      { id: 'thrax', voiceName: 'Algenib', style: 'growl' },
      { id: 'brother', voiceName: 'Algenib', style: 'growl' },
    ]);
    expect(out[0].voiceName).toBe('Gacrux');
    expect(out[1].voiceName).not.toBe('Gacrux');
    expect(catalogVoice(out[1].voiceName)?.register).toBe('feminine');
    expect(out[1].style).toBe('cool, imperious');
    expect(out[3].voiceName).not.toBe('Algenib');
    expect(catalogVoice(out[3].voiceName)?.register).toBe('masculine');
    expect(new Set(out.map(s => s.voiceName)).size).toBe(4);
  });

  it('tries a slot\'s preferred voices first', () => {
    const out = ensureUniqueCast([
      { id: 'a', voiceName: 'Kore', style: '' },
      { id: 'b', voiceName: 'Kore', style: '', preferred: ['Kore', 'Despina'] },
    ]);
    expect(out[1].voiceName).toBe('Despina');
  });

  it('past thirty members, separates same-voice members by a distinct, sanitized delivery note', () => {
    const slots: CastSlot[] = Array.from({ length: 75 }, (_, i) => ({ id: `npc_${i}`, voiceName: 'Charon', style: i % 2 ? 'grave' : '' }));
    const out = ensureUniqueCast([{ id: NARRATOR_SLOT_ID, voiceName: 'Enceladus', style: '' }, ...slots]);
    expect(out).toHaveLength(76);
    // Every catalog voice is used before any is shared.
    expect(new Set(out.slice(0, 30).map(s => s.voiceName)).size).toBe(30);
    expect(out.every(s => s.voiceName !== 'Brio')).toBe(true);
    // No two members share voice + note.
    expect(new Set(pairs(out)).size).toBe(76);
    for (const s of out) {
      expect(s.style.length).toBeLessThanOrEqual(MAX_CAST_STYLE_CHARS);
      expect(sanitizeVoiceStyleText(s.style)).toBe(s.style);
    }
    // Deterministic.
    expect(ensureUniqueCast([{ id: NARRATOR_SLOT_ID, voiceName: 'Enceladus', style: '' }, ...slots])).toEqual(out);
  });

  it('holds for two hundred members all asking for one voice and one long note', () => {
    const long = 'a slow and deliberate cadence, grave and weighty, with long pauses between every clause';
    const slots: CastSlot[] = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, voiceName: 'Kore', style: long }));
    const out = ensureUniqueCast(slots);
    expect(new Set(pairs(out)).size).toBe(200);
    for (const s of out) expect(s.style.length).toBeLessThanOrEqual(MAX_CAST_STYLE_CHARS);
  });

  it('an unknown voice becomes a catalog voice', () => {
    expect(isCatalogVoice(ensureUniqueCast([{ id: 'a', voiceName: 'Nobody', style: '' }])[0].voiceName)).toBe(true);
  });
});

describe('reading and editing a cast', () => {
  const cast = deterministicCast([person('julia', 'Julia Mamaea', 'Regent'), person('thrax', 'Maximinus Thrax', 'General')], DEFAULTS);

  it('a member performs in their override over their casting; bespoke off drops every note', () => {
    expect(memberVoice(cast, 'julia', true)).toEqual({ voiceName: 'Gacrux', style: { preset: 'custom', text: 'cool, imperious and measured' } });
    expect(memberVoice(cast, 'julia', false)).toEqual({ voiceName: 'Gacrux', style: null });
    expect(memberVoice(cast, 'nobody', true)).toBeNull();
    const overridden = withMemberOverride(cast, 'julia', { voiceName: 'Kore', style: 'quiet, "cold" [now]: 5' });
    expect(overridden.revision).toBe(cast.revision + 1);
    expect(overridden.members.julia.override).toEqual({ voiceName: 'Kore', style: 'quiet, cold now' });
    expect(memberVoice(overridden, 'julia', true)).toEqual({ voiceName: 'Kore', style: { preset: 'custom', text: 'quiet, cold now' } });
    const reset = withoutMemberOverride(overridden, 'julia');
    expect(reset.members.julia.override).toBeUndefined();
    expect(memberVoice(reset, 'julia', true)?.voiceName).toBe('Gacrux');
    // Overriding back to the casting clears the override; an unknown voice is ignored.
    expect(withMemberOverride(cast, 'julia', { voiceName: 'Gacrux' }).members.julia.override).toBeUndefined();
    expect(withMemberOverride(cast, 'julia', { voiceName: 'Nobody' }).members.julia.override).toBeUndefined();
    expect(castStyle('', true)).toBeNull();
  });

  it('completes a stored cast with the uncast by rule, leaving the stored members as they are', () => {
    const more = completeCast(cast, [person('julia', 'Julia Mamaea', 'Regent'), person('thrax', 'Maximinus Thrax', 'General'), person('new', 'Aurelia', 'Priestess')], DEFAULTS);
    expect(more.members.julia).toEqual(cast.members.julia);
    expect(more.members.thrax).toEqual(cast.members.thrax);
    expect(more.members.new).toMatchObject({ source: 'fallback', style: 'solemn and hushed' });
    expect(catalogVoice(more.members.new.voiceName)?.register).toBe('feminine');
    expect(completeCast(cast, [person('julia', 'Julia Mamaea')], DEFAULTS)).toBe(cast);
    expect(completeCast(null, [], DEFAULTS).revision).toBe(0);
  });

  it('newestVoiceCast prefers the higher revision', () => {
    const newer = { ...cast, revision: cast.revision + 3 };
    expect(newestVoiceCast(cast, newer)).toBe(newer);
    expect(newestVoiceCast(newer, cast)).toBe(newer);
    expect(newestVoiceCast(null, undefined)).toBeNull();
  });

  it('a stored cast is validated: unknown voices, bad ids or a wrong shape are refused; notes are re-sanitized', () => {
    expect(normalizeVoiceCast(cast)).toEqual(cast);
    expect(normalizeVoiceCast(undefined)).toBeNull();
    expect(normalizeVoiceCast({ ...cast, version: 2 })).toBeNull();
    expect(normalizeVoiceCast({ ...cast, members: { julia: { ...cast.members.julia, voiceName: 'Nobody' } } })).toBeNull();
    expect(normalizeVoiceCast({ ...cast, members: { 'bad id!': cast.members.julia } })).toBeNull();
    expect(normalizeVoiceCast({ ...cast, extra: 1 })).toBeNull();
    const dirty = normalizeVoiceCast({ ...cast, members: { julia: { ...cast.members.julia, style: 'Say: <b>5</b> cool' } } });
    expect(dirty?.members.julia.style).toBe('Say bb cool');
  });

  it('casting candidates are the living individuals the player knows, and only their public face', () => {
    const player = makeEntity({ entity_id: 'p', name: 'Player', visibility_network: ['a', 'b', 'c', 'd'] });
    const entities = [
      player,
      makeEntity({ entity_id: 'a', name: 'Aurelia', position: 'Priestess', epithet: 'the Pious', secrets: ['X'] }),
      makeEntity({ entity_id: 'b', name: 'Dead Man', status: 'dead' }),
      makeEntity({ entity_id: 'c', name: 'The Guard', entity_type: 'faction' }),
      makeEntity({ entity_id: 'z', name: 'Stranger' }),
    ];
    expect(castingCandidatesFor(player, entities, [])).toEqual([
      { entityId: 'a', name: 'Aurelia', position: 'Priestess', epithet: 'the Pious', entityType: 'individual' },
    ]);
    expect(castingCandidatesFor(null, entities, [])).toEqual([]);
  });
});
