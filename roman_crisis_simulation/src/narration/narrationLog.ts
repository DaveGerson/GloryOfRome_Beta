/**
 * narration/narrationLog.ts
 *
 * Every performed narration, kept as text: the chronicle's narrations, the
 * Imperial Dispatch, and a private-scene NPC's spoken lines. Each entry
 * records where the words came from (a human label and the first
 * `SOURCE_EXCERPT_CHARS` characters of the source), who spoke them in what
 * voice and style, the final spoken transcript, what the fidelity patch cut
 * (`patchedOut`), the cues the guard dropped (`droppedCues`) and whether it
 * fell back to the plain narration.
 *
 * Privacy (D4/D5): the log is only ever written from transcripts that have
 * already been vetted and voiced to the player - the guard's output
 * (narration/performanceScript.ts), a committed private-scene line, or the
 * Dispatch the player just heard. Nothing GM-private can reach it, because
 * nothing GM-private reaches the voice.
 *
 * Storage: a device preference (persistence/uiPrefs.ts, localStorage),
 * never the save file. Capped at `MAX_NARRATION_LOG_ENTRIES`, oldest dropped
 * first; every read and write is guarded, so blocked or full storage costs
 * the log its memory, never the game. Stored entries are validated on load
 * and anything malformed is dropped.
 *
 * Reuse (tokens): `findReusable` returns a logged transcript for the same
 * source text told by the same narrator (the narrator's key covers its
 * prompt, and a character narrating in character), so pressing play again -
 * even after a reload, once the in-memory audio cache is gone - voices the
 * logged words without a second prep call. Only a retelling the guard
 * accepted is reused; a fallback is not (it may have been a failed call).
 */

import { z } from 'zod';
import { hashText } from './narrationPlayer';
import { voiceStyleSchema, type VoiceStyle } from './voiceStyle';
import { NARRATION_LOG_KEY, getJsonPref, setJsonPref } from '../persistence/uiPrefs';

export const MAX_NARRATION_LOG_ENTRIES = 150;
export const SOURCE_EXCERPT_CHARS = 140;

export type NarrationSourceKind = 'chronicle' | 'dispatch' | 'private_scene';

const entrySchema = z.object({
  id: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  at: z.string().max(40),
  week: z.number().int().nullable(),
  turn: z.number().int().nullable(),
  kind: z.enum(['chronicle', 'dispatch', 'private_scene']),
  sourceLabel: z.string().max(200),
  sourceExcerpt: z.string().max(SOURCE_EXCERPT_CHARS + 1),
  sourceHash: z.string().max(16),
  narratorKey: z.string().max(200),
  narratorName: z.string().max(80),
  voice: z.string().max(40),
  voiceStyle: voiceStyleSchema.nullable(),
  transcript: z.string().max(6000),
  patchedOut: z.array(z.string().max(3000)).max(100),
  // Absent from entries logged before cues could be dropped one by one.
  droppedCues: z.array(z.string().max(400)).max(100).default([]),
  usedFallback: z.boolean(),
}).strict();

export type NarrationLogEntry = z.infer<typeof entrySchema>;

export interface NarrationLogInput {
  kind: NarrationSourceKind;
  sourceLabel: string;
  /** The full source text: excerpted and hashed here, never stored whole. */
  sourceText: string;
  narratorKey: string;
  narratorName: string;
  voice: string;
  voiceStyle: VoiceStyle | null;
  transcript: string;
  patchedOut: readonly string[];
  /** Cues the guard dropped from an accepted script (none for other sources). */
  droppedCues?: readonly string[];
  usedFallback: boolean;
  week?: number | null;
  turn?: number | null;
}

/** The first `SOURCE_EXCERPT_CHARS` characters of a source, on a word boundary where one is near. */
export function sourceExcerpt(text: string): string {
  const flat = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SOURCE_EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, SOURCE_EXCERPT_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > SOURCE_EXCERPT_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The comparison key of a source text: whitespace-insensitive. */
export function sourceKey(text: string): string {
  return hashText(text.replace(/\s+/g, ' ').trim());
}

function loadEntries(): NarrationLogEntry[] {
  const stored = getJsonPref(NARRATION_LOG_KEY);
  if (!Array.isArray(stored)) return [];
  const entries: NarrationLogEntry[] = [];
  for (const candidate of stored) {
    const parsed = entrySchema.safeParse(candidate);
    if (parsed.success) entries.push(parsed.data);
    if (entries.length >= MAX_NARRATION_LOG_ENTRIES) break;
  }
  return entries;
}

/**
 * The log: a tiny external store (subscribe / getSnapshot, for
 * `useSyncExternalStore`), newest entry first.
 */
export class NarrationLogStore {
  private entries: readonly NarrationLogEntry[];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date; load?: boolean } = {}) {
    this.now = options.now ?? (() => new Date());
    this.entries = options.load === false ? [] : loadEntries();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): readonly NarrationLogEntry[] => this.entries;

  /** Re-reads the device's stored log (a test seam, and harmless otherwise). */
  reload(): void {
    this.entries = loadEntries();
    this.emit();
  }

  record(input: NarrationLogInput): NarrationLogEntry {
    const seq = (this.entries[0]?.seq ?? 0) + 1;
    const at = this.now();
    const entry: NarrationLogEntry = {
      id: `n${at.getTime().toString(36)}-${seq}`,
      seq,
      at: at.toISOString(),
      week: input.week ?? null,
      turn: input.turn ?? null,
      kind: input.kind,
      sourceLabel: input.sourceLabel.slice(0, 200),
      sourceExcerpt: sourceExcerpt(input.sourceText),
      sourceHash: sourceKey(input.sourceText),
      narratorKey: input.narratorKey.slice(0, 200),
      narratorName: input.narratorName.slice(0, 80),
      voice: input.voice.slice(0, 40),
      voiceStyle: input.voiceStyle,
      transcript: input.transcript.slice(0, 6000),
      patchedOut: input.patchedOut.slice(0, 100).map(s => s.slice(0, 3000)),
      droppedCues: (input.droppedCues ?? []).slice(0, 100).map(s => s.slice(0, 400)),
      usedFallback: input.usedFallback,
    };
    this.entries = [entry, ...this.entries].slice(0, MAX_NARRATION_LOG_ENTRIES);
    this.persist();
    this.emit();
    return entry;
  }

  /** A logged, guard-accepted transcript of `sourceText` by `narratorKey`, if there is one. */
  findReusable(sourceText: string, narratorKey: string): NarrationLogEntry | undefined {
    const hash = sourceKey(sourceText);
    return this.entries.find(e => e.sourceHash === hash && e.narratorKey === narratorKey && !e.usedFallback && e.transcript.trim().length > 0);
  }

  clear(): void {
    this.entries = [];
    this.persist();
    this.emit();
  }

  private persist(): void {
    setJsonPref(NARRATION_LOG_KEY, this.entries.length > 0 ? this.entries : null);
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}

/** The App's one log, shared by every voice (chronicle, Dispatch, private scenes). */
export const narrationLog = new NarrationLogStore();
