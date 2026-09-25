/**
 * narration/voiceCast.ts
 *
 * The campaign's voice cast: who speaks in which voice. One narrator (the
 * reader the casting chose for this campaign, with a voice and a delivery
 * note) and, for every INDIVIDUAL the player knows, a voice and a short
 * delivery note fitting who they are. The cast is what makes Julia Mamaea
 * narrate "in character" in a woman's voice, and a private-scene NPC sound
 * like themselves.
 *
 * Who casts it:
 *  - the casting director (ai/tools/voiceCasting.ts, `castVoices`), one
 *    structured call on the prep model, when a campaign's voice is first
 *    needed, and again, small, for each newcomer the player comes to know;
 *  - or, when that call fails, in Mock Mode, or before it has run, the
 *    DETERMINISTIC casting below (`deterministicMember`): register-aware
 *    where the name or standing gives a clear signal, otherwise a stable
 *    hash over the catalog.
 * Either way `ensureUniqueCast` then makes every member unique.
 *
 * Uniqueness (`ensureUniqueCast`): no two members - the narrator included -
 * share the same voice AND delivery note. While the catalog's thirty voices
 * last, every member gets a voice of their own (a duplicate is re-voiced
 * within the same believed register); beyond thirty, a distinct delivery
 * note separates members who share a voice.
 *
 * Privacy (D4/D5): everything here is derived from PLAYER-VISIBLE data only -
 * `castingCandidatesFor` projects a known individual to name, position,
 * epithet and entity type, via the same `knownRecipientOptionsForPlayer`
 * list "In character…" uses (narration/narratorChoice.ts). Never
 * personality, schemes, secrets, beliefs, relationships, memories or goals.
 * The cast is shown to the player (Settings → The cast) and saved with the
 * campaign (persistence/saveGame.ts, the optional `voiceCast` field), so it
 * travels with an exported reign.
 *
 * Styles (delivery notes) are sanitized exactly like a player's custom voice
 * style (narration/voiceStyle.ts `sanitizeVoiceStyleText`), capped at 80
 * characters. A note is a MANNER for a writer ("clipped soldier's
 * sentences, few words"); the voice carries the sound. It NEVER reaches the
 * TTS input - the TTS model speaks every word it is given. Where a prep call
 * exists (the cast narrator, a character narrating "In character…") the note
 * feeds that call's delivery brief (`castStyle`,
 * ai/prompts/narrationPerformance.ts `buildDeliveryBrief`); where none does
 * (a private-scene NPC's committed line) it is shown, and sent nowhere.
 */

import { z } from 'zod';
import type { Entity } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import { knownRecipientOptionsForPlayer } from '../knowledge/relationships';
import { hashText } from './narrationPlayer';
import { CASTING_VOICES, catalogVoice, isCatalogVoice, type VoiceRegister } from './voiceCatalog';
import { MAX_CUSTOM_VOICE_STYLE_CHARS, sanitizeVoiceStyleText, type VoiceStyle } from './voiceStyle';

export const MAX_CAST_STYLE_CHARS = MAX_CUSTOM_VOICE_STYLE_CHARS;
export const MAX_CAST_RATIONALE_CHARS = 160;
export const MAX_CAST_MEMBERS = 200;
/** The narrator's slot in `ensureUniqueCast`; no entity id can contain '#'. */
export const NARRATOR_SLOT_ID = '#narrator';

const ENTITY_ID = /^[\w.:-]{1,80}$/;
const NARRATOR_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

const catalogVoiceId = z.string().refine(isCatalogVoice, 'not a catalog voice');
const castStyleText = z.string().max(MAX_CAST_STYLE_CHARS);
const rationaleText = z.string().max(MAX_CAST_RATIONALE_CHARS);

/** A player's override of one member's casting: either part, or both. */
const castOverrideSchema = z.object({
  voiceName: catalogVoiceId.optional(),
  style: castStyleText.optional(),
}).strict();

const castMemberSchema = z.object({
  /** Their name as the player knows it, for the Settings list. */
  name: z.string().min(1).max(80),
  voiceName: catalogVoiceId,
  /** The delivery note, '' for none. */
  style: castStyleText,
  /** One line on why, shown to the player. */
  rationale: rationaleText,
  /** Who cast them: the casting director, or the deterministic rule. */
  source: z.enum(['agent', 'fallback']),
  override: castOverrideSchema.optional(),
}).strict();

const castNarratorSchema = z.object({
  /** The reader (a preset narrator's id) the casting chose for this campaign. */
  narratorId: z.string().regex(NARRATOR_ID),
  voiceName: catalogVoiceId,
  style: castStyleText,
  rationale: rationaleText,
  source: z.enum(['agent', 'fallback']),
}).strict();

export const voiceCastSchema = z.object({
  version: z.literal(1),
  /** Bumped on every change, so the newer of two copies wins (buildSaveState). */
  revision: z.number().int().nonnegative(),
  narrator: castNarratorSchema,
  members: z.record(z.string().regex(ENTITY_ID), castMemberSchema)
    .refine(members => Object.keys(members).length <= MAX_CAST_MEMBERS, 'too many cast members'),
}).strict();

export type VoiceCast = z.infer<typeof voiceCastSchema>;
export type CastMember = z.infer<typeof castMemberSchema>;
export type CastNarrator = z.infer<typeof castNarratorSchema>;
export type CastOverride = z.infer<typeof castOverrideSchema>;

/**
 * A persisted cast, validated - or null. Used on load (GAME_LOADED) so a
 * hand-edited or corrupted save can never put an unknown voice or an
 * unsanitized delivery note into a prep prompt.
 */
export function normalizeVoiceCast(value: unknown): VoiceCast | null {
  const parsed = voiceCastSchema.safeParse(value);
  if (!parsed.success) return null;
  const cast = parsed.data;
  const members: Record<string, CastMember> = {};
  for (const [id, m] of Object.entries(cast.members)) {
    const { override, ...rest } = m;
    const cleanOverride: CastOverride = {
      ...(override?.voiceName ? { voiceName: override.voiceName } : {}),
      ...(override?.style !== undefined ? { style: sanitizeCastStyle(override.style) } : {}),
    };
    members[id] = {
      ...rest,
      style: sanitizeCastStyle(rest.style),
      ...(Object.keys(cleanOverride).length > 0 ? { override: cleanOverride } : {}),
    };
  }
  return { ...cast, narrator: { ...cast.narrator, style: sanitizeCastStyle(cast.narrator.style) }, members };
}

/** Delivery language only, capped: the same sanitizer as a player's custom voice style. */
export function sanitizeCastStyle(raw: string | null | undefined): string {
  return sanitizeVoiceStyleText(raw ?? '').slice(0, MAX_CAST_STYLE_CHARS).trim();
}

// ---------------------------------------------------------------------------
// Who may be cast: the player-visible projection.

/** A known individual, as the casting sees them: player-visible fields only. */
export interface CastingCandidate {
  entityId: string;
  name: string;
  position?: string;
  epithet?: string;
  entityType: 'individual';
}

/**
 * Every living individual the player knows, as name, position, epithet and
 * entity type - nothing else of the entity is read. Built on
 * `knownRecipientOptionsForPlayer`, the same player-knowledge list
 * "In character…" and the composer's recipients use. The player is not cast:
 * their own lines are never voiced.
 */
export function castingCandidatesFor(player: Entity | null | undefined, entities: Entity[], knowledge: KnowledgeClaim[]): CastingCandidate[] {
  if (!player) return [];
  const byId = new Map(entities.map(entity => [entity.entity_id, entity]));
  const candidates: CastingCandidate[] = [];
  for (const option of knownRecipientOptionsForPlayer(player, entities, knowledge)) {
    const entity = byId.get(option.entityId);
    if (!entity || entity.entity_type !== 'individual' || entity.status !== 'alive' || !ENTITY_ID.test(entity.entity_id)) continue;
    const position = entity.position?.trim();
    const epithet = entity.epithet?.trim();
    candidates.push({
      entityId: entity.entity_id,
      name: option.displayName.slice(0, 80),
      ...(position ? { position } : {}),
      ...(epithet ? { epithet } : {}),
      entityType: 'individual',
    });
    if (candidates.length >= MAX_CAST_MEMBERS) break;
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Deterministic casting: register and station from name and standing.

const FEMININE_TITLES = /\b(?:augusta|empress|regina|queen|mother|matron|matrona|priestess|vestal|lady|domina|princess|wife|widow|daughter|sister|grandmother|mistress|handmaiden|heiress|abbess|duchess|countess|she)\b/i;
const MASCULINE_TITLES = /\b(?:emperor|augustus|king|general|legate|centurion|prefect|tribune|consul|father|son|brother|lord|dominus|prince|husband|uncle|nephew|grandfather|legionary|praetor|proconsul|duke|count)\b/i;
/** Latin (and a few Greek) men's names that end in -a; checked before the -a rule. */
const MASCULINE_A_NAMES = new Set([
  'agrippa', 'sulla', 'galba', 'seneca', 'cinna', 'nerva', 'casca', 'caracalla', 'messalla', 'messala', 'scaevola',
  'catilina', 'dolabella', 'mela', 'ahala', 'murena', 'nasica', 'sura', 'numa', 'aquila', 'caligula',
  'attila', 'pansa', 'luca', 'andrea', 'nicola',
]);

/**
 * The register a candidate's NAME and STANDING point to, applied cautiously:
 * a feminine or masculine title in the position or epithet (Augusta,
 * Empress, Mother...; Emperor, General, Legate...), else the first name's
 * ending (-a for a Latin woman's name, barring known men's names such as
 * Agrippa; -us for a man's). Anything unclear is 'unknown'.
 */
export function inferRegister(candidate: Pick<CastingCandidate, 'name' | 'position' | 'epithet'>): VoiceRegister {
  const standing = `${candidate.position ?? ''} ${candidate.epithet ?? ''}`;
  const feminineTitle = FEMININE_TITLES.test(standing);
  const masculineTitle = MASCULINE_TITLES.test(standing);
  if (feminineTitle && !masculineTitle) return 'feminine';
  if (masculineTitle && !feminineTitle) return 'masculine';
  const first = candidate.name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, '') ?? '';
  if (first.length >= 3) {
    if (first.endsWith('a') && !MASCULINE_A_NAMES.has(first)) return 'feminine';
    if (first.endsWith('us')) return 'masculine';
  }
  return 'unknown';
}

interface Station {
  test: RegExp;
  style: string;
  voices: { feminine: readonly string[]; masculine: readonly string[] };
}

/**
 * A station read from the public position and epithet: a delivery note and
 * the voices that suit it. First match wins. Player-visible copy (the style
 * notes are shown in Settings → The cast): veto queue, roadmaps/BACKLOG.md B13.
 */
const STATIONS: readonly Station[] = [
  { test: /\b(?:empress|augusta|regent|regina|queen|mother)\b/i, style: 'cool, imperious and measured', voices: { feminine: ['Gacrux', 'Kore', 'Despina'], masculine: ['Orus', 'Schedar'] } },
  { test: /\b(?:emperor|augustus|caesar|king|prince|princeps)\b/i, style: 'measured and courtly, weighing every word', voices: { feminine: ['Kore', 'Erinome'], masculine: ['Iapetus', 'Orus', 'Schedar'] } },
  { test: /\b(?:general|legions?|legate|centurion|soldier|tribune|prefect|commander|legionary|veteran|guard|praetorian)\b/i, style: "clipped soldier's sentences, few words", voices: { feminine: ['Kore', 'Pulcherrima'], masculine: ['Algenib', 'Alnilam', 'Orus'] } },
  { test: /\b(?:senator|consul|orator|magistrate|curia|conscript)\b/i, style: "an orator's rolling, measured cadence", voices: { feminine: ['Erinome', 'Gacrux'], masculine: ['Charon', 'Rasalgethi', 'Sadaltager'] } },
  { test: /\b(?:informant|broker|spy|agent|vulture|whisperer|smuggler)\b/i, style: 'low, sly and knowing', voices: { feminine: ['Despina', 'Achernar'], masculine: ['Algieba', 'Umbriel'] } },
  { test: /\b(?:priest|priestess|vestal|augur|pontifex|oracle|haruspex)\b/i, style: 'solemn and hushed', voices: { feminine: ['Vindemiatrix', 'Achernar'], masculine: ['Schedar', 'Enceladus'] } },
  { test: /\b(?:merchant|trader|banker|moneylender|shipper)\b/i, style: 'brisk, warm and persuasive', voices: { feminine: ['Sulafat', 'Laomedeia'], masculine: ['Achird', 'Puck'] } },
  { test: /\b(?:slave|servant|freedman|freedwoman|steward|attendant)\b/i, style: 'quiet and careful', voices: { feminine: ['Achernar', 'Leda'], masculine: ['Umbriel', 'Zubenelgenubi'] } },
  { test: /\b(?:philosopher|scholar|tutor|physician|jurist|historian)\b/i, style: 'precise and thoughtful', voices: { feminine: ['Erinome', 'Autonoe'], masculine: ['Sadaltager', 'Iapetus'] } },
];

/** Player-visible rationales for the deterministic casting (veto queue, B13). */
export const FALLBACK_RATIONALE = {
  rule: 'Cast by rule from their name and standing, without the casting director.',
  hash: 'Cast by rule: a steady pick from the catalog, without the casting director.',
  narrator: 'The reader this game starts with, in its own voice, without the casting director.',
} as const;

function hashOrder(key: string, voices: readonly string[]): string[] {
  return [...voices].sort((a, b) => {
    const ha = parseInt(hashText(`${key}|${a}`), 16);
    const hb = parseInt(hashText(`${key}|${b}`), 16);
    return ha - hb || a.localeCompare(b);
  });
}

function registerVoices(register: VoiceRegister): string[] {
  return CASTING_VOICES.filter(v => register === 'unknown' || v.register === register).map(v => v.id);
}

/** One slot for `ensureUniqueCast`: a proposed voice and style, and where to look if the voice is taken. */
export interface CastSlot {
  id: string;
  voiceName: string;
  style: string;
  /** The register to stay within when re-voicing; defaults to the proposed voice's believed register. */
  register?: VoiceRegister;
  /** Voices to try first when re-voicing, in order. */
  preferred?: readonly string[];
}

/**
 * The deterministic casting of one candidate: a voice suited to their
 * register and station, a stable hash among the rest when nothing is clear,
 * and the station's delivery note (or none).
 */
export function deterministicMember(candidate: CastingCandidate): CastSlot & { rationale: string } {
  const register = inferRegister(candidate);
  const standing = `${candidate.position ?? ''} ${candidate.epithet ?? ''}`;
  const station = STATIONS.find(s => s.test.test(standing));
  const stationVoices = station
    ? (register === 'unknown' ? [] : station.voices[register])
    : [];
  const preferred = [...stationVoices, ...hashOrder(candidate.entityId, registerVoices(register))];
  return {
    id: candidate.entityId,
    voiceName: preferred[0],
    style: station?.style ?? '',
    register,
    preferred,
    rationale: register !== 'unknown' || station ? FALLBACK_RATIONALE.rule : FALLBACK_RATIONALE.hash,
  };
}

// ---------------------------------------------------------------------------
// Uniqueness.

/**
 * Delivery variants that set apart two members who must share a voice.
 * Letters, commas and spaces only, so they pass `sanitizeVoiceStyleText`.
 */
const DELIVERY_VARIANTS = [
  'a shade slower', 'a shade quicker', 'lower and softer', 'a little brighter', 'warmer', 'drier',
  'more hushed', 'more clipped', 'with a slight rasp', 'gentler', 'sterner', 'wearier', 'more lilting',
  'more deliberate', 'breathier', 'crisper',
] as const;

function styleKey(style: string): string {
  return sanitizeCastStyle(style).toLowerCase();
}

function pairKey(voiceName: string, style: string): string {
  return `${voiceName}|${styleKey(style)}`;
}

function withVariant(base: string, variant: string): string {
  const clean = sanitizeCastStyle(base);
  if (!clean) return variant;
  const room = MAX_CAST_STYLE_CHARS - variant.length - 2;
  const trimmed = clean.slice(0, Math.max(0, room)).replace(/[\s,.;!?\-–—]+$/u, '').trim();
  return trimmed ? `${trimmed}, ${variant}` : variant;
}

/** Every variant, then every ordered pair of variants: enough for far more than MAX_CAST_MEMBERS. */
function* variantsOf(base: string): Generator<string> {
  for (const v of DELIVERY_VARIANTS) yield withVariant(base, v);
  for (const a of DELIVERY_VARIANTS) {
    for (const b of DELIVERY_VARIANTS) if (a !== b) yield withVariant(base, `${a}, ${b}`);
  }
}

/**
 * Makes a cast unique, deterministically, in the order given (earlier slots
 * keep what they have; the narrator goes first):
 *
 *  1. a slot whose voice is already taken is re-voiced while any catalog
 *     voice is still free - its `preferred` voices first, then free voices of
 *     its register (hash-ordered by id), then any free voice;
 *  2. once all thirty are taken, a slot whose voice AND style repeat an
 *     earlier slot's gets a distinct delivery note (its own, plus a variant).
 *
 * Styles come back sanitized. Pure; never throws.
 */
export function ensureUniqueCast(slots: readonly CastSlot[]): CastSlot[] {
  const usedVoices = new Set<string>();
  const usedPairs = new Set<string>();
  const palette = CASTING_VOICES.map(v => v.id);
  const result: CastSlot[] = [];
  for (const slot of slots) {
    let voiceName = isCatalogVoice(slot.voiceName) ? slot.voiceName : palette[0];
    let style = sanitizeCastStyle(slot.style);
    if (usedVoices.has(voiceName) && palette.some(v => !usedVoices.has(v))) {
      const register = slot.register && slot.register !== 'unknown' ? slot.register : catalogVoice(voiceName)?.register ?? 'unknown';
      const order = [
        ...(slot.preferred ?? []),
        ...hashOrder(slot.id, registerVoices(register)),
        ...hashOrder(slot.id, palette),
      ];
      voiceName = order.find(v => isCatalogVoice(v) && !usedVoices.has(v) && v !== 'Brio') ?? voiceName;
    }
    if (usedPairs.has(pairKey(voiceName, style))) {
      for (const variant of variantsOf(style)) {
        if (!usedPairs.has(pairKey(voiceName, variant))) {
          style = variant;
          break;
        }
      }
    }
    usedVoices.add(voiceName);
    usedPairs.add(pairKey(voiceName, style));
    result.push({ ...slot, voiceName, style });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Building and merging casts.

/** The narrator a cast falls back to: the default reader in its own voice. */
export interface DefaultNarrator {
  narratorId: string;
  voiceName: string;
}

/** A proposed member, before uniqueness: from the casting director or the rule. */
export interface ProposedMember extends CastSlot {
  name: string;
  rationale: string;
  source: CastMember['source'];
}

function member(proposal: ProposedMember, slot: CastSlot, override?: CastOverride): CastMember {
  return {
    name: proposal.name,
    voiceName: slot.voiceName,
    style: slot.style,
    rationale: proposal.rationale.slice(0, MAX_CAST_RATIONALE_CHARS),
    source: proposal.source,
    ...(override && (override.voiceName !== undefined || override.style !== undefined) ? { override } : {}),
  };
}

export function fallbackProposal(candidate: CastingCandidate): ProposedMember {
  const det = deterministicMember(candidate);
  return { ...det, name: candidate.name, source: 'fallback' };
}

export function fallbackNarrator(defaults: DefaultNarrator): CastNarrator {
  return { narratorId: defaults.narratorId, voiceName: defaults.voiceName, style: '', rationale: FALLBACK_RATIONALE.narrator, source: 'fallback' };
}

/**
 * Builds a cast: the narrator first, then `keep` (existing members, left
 * as they are unless they collide), then the new proposals; uniqueness
 * enforced over all of them. Overrides on kept members are preserved.
 */
export function assembleCast(
  narrator: CastNarrator,
  keep: Readonly<Record<string, CastMember>>,
  proposals: readonly ProposedMember[],
  revision: number,
  overrides: Readonly<Record<string, CastOverride | undefined>> = {},
): VoiceCast {
  const kept = Object.entries(keep).map(([id, m]): ProposedMember => ({
    id, name: m.name, voiceName: m.voiceName, style: m.style, rationale: m.rationale, source: m.source,
  }));
  const keptIds = new Set(kept.map(k => k.id));
  const fresh = proposals.filter(p => !keptIds.has(p.id) && p.id !== NARRATOR_SLOT_ID);
  const all = [...kept, ...fresh].slice(0, MAX_CAST_MEMBERS);
  const slots = ensureUniqueCast([
    { id: NARRATOR_SLOT_ID, voiceName: narrator.voiceName, style: narrator.style },
    ...all,
  ]);
  const members: Record<string, CastMember> = {};
  all.forEach((proposal, index) => {
    members[proposal.id] = member(proposal, slots[index + 1], overrides[proposal.id] ?? keep[proposal.id]?.override);
  });
  return { version: 1, revision, narrator: { ...narrator, voiceName: slots[0].voiceName, style: slots[0].style }, members };
}

/** The whole cast by rule alone: Mock Mode, a failed casting call, or before one has run. */
export function deterministicCast(candidates: readonly CastingCandidate[], defaults: DefaultNarrator, revision = 1): VoiceCast {
  return assembleCast(fallbackNarrator(defaults), {}, candidates.map(fallbackProposal), revision);
}

/**
 * The cast every voice uses now: the stored cast, with anyone the player
 * knows but who is not yet cast filled in by rule (not stored - the casting
 * director will cast them properly when next the voice is needed). No stored
 * cast at all: the whole cast by rule.
 */
export function completeCast(stored: VoiceCast | null, candidates: readonly CastingCandidate[], defaults: DefaultNarrator): VoiceCast {
  if (!stored) return deterministicCast(candidates, defaults, 0);
  const missing = candidates.filter(c => !stored.members[c.entityId]);
  if (missing.length === 0) return stored;
  return assembleCast(stored.narrator, stored.members, missing.map(fallbackProposal), stored.revision);
}

/** The newer of two casts by revision (the first wins a tie), for carrying a cast forward into a save. */
export function newestVoiceCast(...casts: Array<VoiceCast | null | undefined>): VoiceCast | null {
  return casts.reduce<VoiceCast | null>((newest, cast) => (cast && (!newest || cast.revision > newest.revision) ? cast : newest), null);
}

// ---------------------------------------------------------------------------
// Reading the cast.

/**
 * A cast delivery note as a voice style (sanitized), or null when it is empty.
 * It shapes the WRITING only: a prep call's delivery brief
 * (ai/prompts/narrationPerformance.ts `buildDeliveryBrief`). Nothing turns
 * it into TTS input.
 */
export function castStyle(text: string | null | undefined): VoiceStyle | null {
  const clean = sanitizeCastStyle(text);
  return clean ? { preset: 'custom', text: clean } : null;
}

export interface CastVoice {
  voiceName: string;
  style: VoiceStyle | null;
}

/** One member's voice and style as it performs: their override over their casting. */
export function effectiveMember(m: CastMember): { voiceName: string; style: string } {
  return {
    voiceName: m.override?.voiceName ?? m.voiceName,
    style: m.override?.style ?? m.style,
  };
}

/** A character's voice and delivery, or null when they are not in the cast. */
export function memberVoice(cast: VoiceCast | null | undefined, entityId: string): CastVoice | null {
  const m = cast?.members[entityId];
  if (!m) return null;
  const { voiceName, style } = effectiveMember(m);
  return { voiceName, style: castStyle(style) };
}

/** Sets (or, when it matches the casting, clears) a member's override. Returns a new cast. */
export function withMemberOverride(cast: VoiceCast, entityId: string, change: CastOverride): VoiceCast {
  const current = cast.members[entityId];
  if (!current) return cast;
  const merged: CastOverride = { ...current.override, ...change };
  if (merged.style !== undefined) merged.style = sanitizeCastStyle(merged.style);
  if (merged.voiceName !== undefined && (!isCatalogVoice(merged.voiceName) || merged.voiceName === current.voiceName)) delete merged.voiceName;
  if (merged.style !== undefined && merged.style === current.style) delete merged.style;
  const { override: _previous, ...rest } = current;
  const next: CastMember = Object.keys(merged).length > 0 ? { ...rest, override: merged } : rest;
  return { ...cast, revision: cast.revision + 1, members: { ...cast.members, [entityId]: next } };
}

/** Drops a member's override: back to the casting. Returns a new cast. */
export function withoutMemberOverride(cast: VoiceCast, entityId: string): VoiceCast {
  const current = cast.members[entityId];
  if (!current?.override) return cast;
  const { override: _dropped, ...rest } = current;
  return { ...cast, revision: cast.revision + 1, members: { ...cast.members, [entityId]: rest } };
}
