/**
 * narration/customNarrators.ts
 *
 * Narrators the player writes themselves, in Settings: a name, a one-line
 * description, a persona brief, and the narrator's own voice and delivery
 * style. A device preference (persistence/uiPrefs.ts, localStorage), never
 * part of a save.
 *
 * Validation is layered. The stored record is checked against
 * `customNarratorSchema` (lengths, a catalog voice, a known style), and the
 * narrator profile built from it must pass the same `narratorProfileSchema`
 * every deployed narrator passes - a record that fails either is dropped on
 * load, never voiced.
 *
 * The brief is player-typed text that reaches a prompt, so under D41 it is
 * DATA: `buildCustomNarratorPersona` (ai/prompts/narrationPerformance.ts)
 * embeds it JSON-quoted under a heading that says it describes who narrates
 * and is never a command. The fixed rules always follow it - so a player's
 * narrator writes an acted script with performance cues like any other -
 * and the guard (narration/performanceScript.ts) checks every script it
 * produces, cues included, exactly as for any other narrator.
 */

import { z } from 'zod';
import { GEMINI_NARRATION_PREP, GEMINI_TTS, NARRATION_PREP_THINKING_LEVEL } from '../ai/core/geminiService';
import { buildCustomNarratorPersona } from '../ai/prompts/narrationPerformance';
import { narratorProfileSchema, type NarratorProfile } from './narrators';
import { voiceStyleSchema, sanitizeVoiceStyleText, type VoiceStyle } from './voiceStyle';
import { CUSTOM_NARRATORS_KEY, getJsonPref, setJsonPref } from '../persistence/uiPrefs';
import { VOICE_CATALOG } from './voiceCatalog';

export const CUSTOM_NARRATOR_LIMITS = { name: 40, description: 160, brief: 1200 } as const;
/** Enough for a small company of narrators; more would flood the picker. */
export const MAX_CUSTOM_NARRATORS = 12;

/** Any voice in the catalog (the curated six are among them, so older records stay valid). */
const VOICE_IDS = VOICE_CATALOG.map(v => v.id) as [string, ...string[]];
const CUSTOM_ID = /^custom-[a-z0-9]{4,24}$/;

export const customNarratorSchema = z.object({
  id: z.string().regex(CUSTOM_ID),
  name: z.string().trim().min(1).max(CUSTOM_NARRATOR_LIMITS.name),
  description: z.string().trim().max(CUSTOM_NARRATOR_LIMITS.description),
  brief: z.string().trim().min(1).max(CUSTOM_NARRATOR_LIMITS.brief),
  voiceName: z.enum(VOICE_IDS),
  voiceStyle: voiceStyleSchema.nullable(),
}).strict();

export type CustomNarrator = z.infer<typeof customNarratorSchema>;

/** What the editor submits: a record without its id (new) or with one (edit). */
export type CustomNarratorDraft = Omit<CustomNarrator, 'id'> & { id?: string };

export type CustomNarratorSaveResult =
  | { ok: true; narrator: CustomNarrator; narrators: CustomNarrator[] }
  | { ok: false; issues: { field: string; message: string }[] };

/** The description shown when the player left theirs blank. */
export const CUSTOM_NARRATOR_DEFAULT_DESCRIPTION = 'A narrator of your own making.';

/**
 * Player text, made safe to hold: control characters and the line and
 * paragraph separators (which JSON leaves raw) become spaces; the brief
 * keeps its ordinary line breaks.
 */
export function cleanPlayerText(text: string, keepLineBreaks = false): string {
  let cleaned = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    cleaned += control && !(keepLineBreaks && ch === '\n') ? ' ' : ch;
  }
  return keepLineBreaks
    ? cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : cleaned.replace(/\s+/g, ' ').trim();
}

/** The profile a custom narrator performs as, validated like any deployed one. Null if it will not validate. */
export function customNarratorProfile(narrator: CustomNarrator): NarratorProfile | null {
  const parsed = narratorProfileSchema.safeParse({
    id: narrator.id,
    name: narrator.name,
    description: narrator.description || CUSTOM_NARRATOR_DEFAULT_DESCRIPTION,
    prep: {
      model: GEMINI_NARRATION_PREP,
      thinkingLevel: NARRATION_PREP_THINKING_LEVEL,
      temperature: 0.7,
      persona: buildCustomNarratorPersona(narrator),
    },
    voice: { model: GEMINI_TTS, voiceName: narrator.voiceName, temperature: 1 },
  });
  return parsed.success ? parsed.data : null;
}

function isValid(candidate: unknown): candidate is CustomNarrator {
  const parsed = customNarratorSchema.safeParse(candidate);
  return parsed.success && customNarratorProfile(parsed.data) !== null;
}

/** The device's custom narrators: every stored record that still validates, first-come on a duplicate id. */
export function loadCustomNarrators(): CustomNarrator[] {
  const stored = getJsonPref(CUSTOM_NARRATORS_KEY);
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const narrators: CustomNarrator[] = [];
  for (const candidate of stored) {
    if (!isValid(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    narrators.push(customNarratorSchema.parse(candidate));
    if (narrators.length >= MAX_CUSTOM_NARRATORS) break;
  }
  return narrators;
}

function persist(narrators: readonly CustomNarrator[]): void {
  setJsonPref(CUSTOM_NARRATORS_KEY, narrators.length > 0 ? narrators : null);
}

function newId(existing: readonly CustomNarrator[]): string {
  const taken = new Set(existing.map(n => n.id));
  for (;;) {
    const id = `custom-${Math.random().toString(36).slice(2, 10).padEnd(6, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/** Creates (no id) or replaces (a known id) a custom narrator, then persists the list. */
export function saveCustomNarrator(existing: readonly CustomNarrator[], draft: CustomNarratorDraft): CustomNarratorSaveResult {
  const editing = draft.id !== undefined ? existing.find(n => n.id === draft.id) : undefined;
  if (draft.id !== undefined && !editing) return { ok: false, issues: [{ field: 'id', message: 'That narrator is no longer here.' }] };
  if (!editing && existing.length >= MAX_CUSTOM_NARRATORS) {
    return { ok: false, issues: [{ field: 'name', message: `You may keep ${MAX_CUSTOM_NARRATORS} narrators at most.` }] };
  }
  const style: VoiceStyle | null = draft.voiceStyle?.preset === 'custom'
    ? (sanitizeVoiceStyleText(draft.voiceStyle.text) ? { preset: 'custom', text: sanitizeVoiceStyleText(draft.voiceStyle.text) } : null)
    : draft.voiceStyle ?? null;
  const candidate = {
    id: editing?.id ?? newId(existing),
    name: cleanPlayerText(draft.name),
    description: cleanPlayerText(draft.description),
    brief: cleanPlayerText(draft.brief, true),
    voiceName: draft.voiceName,
    voiceStyle: style,
  };
  const parsed = customNarratorSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(issue => ({ field: String(issue.path[0] ?? 'narrator'), message: issueMessage(String(issue.path[0] ?? ''), issue.code) })) };
  }
  if (!customNarratorProfile(parsed.data)) return { ok: false, issues: [{ field: 'brief', message: 'That brief will not hold together as a narrator.' }] };
  const narrators = editing
    ? existing.map(n => (n.id === editing.id ? parsed.data : n))
    : [...existing, parsed.data];
  persist(narrators);
  return { ok: true, narrator: parsed.data, narrators };
}

/** Removes a custom narrator and persists the list. */
export function deleteCustomNarrator(existing: readonly CustomNarrator[], id: string): CustomNarrator[] {
  const narrators = existing.filter(n => n.id !== id);
  persist(narrators);
  return narrators;
}

/** Player-visible validation copy (veto-queue: roadmaps/BACKLOG.md B13). */
function issueMessage(field: string, code: string): string {
  const tooLong = code === 'too_big';
  switch (field) {
    case 'name': return tooLong ? `A name runs to ${CUSTOM_NARRATOR_LIMITS.name} characters at most.` : 'Give the narrator a name.';
    case 'description': return `A description runs to ${CUSTOM_NARRATOR_LIMITS.description} characters at most.`;
    case 'brief': return tooLong ? `A brief runs to ${CUSTOM_NARRATOR_LIMITS.brief} characters at most.` : 'Say who narrates.';
    case 'voiceName': return 'Choose one of the voices.';
    default: return 'Something in this narrator will not hold.';
  }
}
