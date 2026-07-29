import type { EventHistoryEntry, TurnHistoryEntry } from '../../types';

/**
 * components/tabs/chronicleSpine.ts — the Reign register's rows (audit item 37).
 *
 * ChronicleTab was fed only by `eventHistory`, the handful of AUTHORED fate
 * events, so fourteen weeks of play yielded three entries: the one surface
 * whose job is to make a reign feel like history was the emptiest in the app,
 * and no amount of play filled it.
 *
 * `turnHistory` — which the app already stores and persists — holds every
 * week, its headline and the order the player gave. This builds the spine from
 * it, marks the weeks a fate landed in, and collapses quiet stretches so a
 * forty-week reign stays scannable.
 *
 * Pure and synchronous: no AI call, no new state, no new persisted field.
 */

export type ChronicleMarker =
  /** An ordinary week — an 8px gold disc. */
  | 'week'
  /** A week an authored fate landed in — a 10px Tyrian wax seal. */
  | 'fate'
  /** The reign's end — crimson. */
  | 'end'
  /** A collapsed run of quiet weeks — a hollow ring. */
  | 'collapsed';

export interface ChronicleRow {
  /** Stable across renders: the first week the row covers. */
  key: string;
  marker: ChronicleMarker;
  /** "Week VI" or "Weeks I–IX". */
  weekLabel: string;
  /** The headline for a single week, or the count line for a collapsed run. */
  headline: string;
  /** What the player did that week, if the row is a single week. */
  order?: string;
  /** Present on a fate week. */
  badge?: string;
  /** The weeks a collapsed row stands for, so it can be unrolled in place. */
  collapsed?: ChronicleRow[];
}

/** A week is "quiet" when no fate landed in it and it ended the reign for nobody. */
const MIN_COLLAPSIBLE_RUN = 3;

const toRomanNumeral = (n: number): string => {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '', rest = Math.max(1, Math.round(n));
  for (const [value, numeral] of table) while (rest >= value) { out += numeral; rest -= value; }
  return out;
};

/** The first sentence of a narration — the week's headline, not the whole scroll. */
function headlineOf(entry: TurnHistoryEntry): string {
  const narration = (entry.narration ?? '').trim();
  if (!narration) return 'The week passed without record.';
  const firstSentence = narration.split(/(?<=[.!?])\s/)[0] ?? narration;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;
}

function rowFor(entry: TurnHistoryEntry, fate: EventHistoryEntry | undefined, isEnd: boolean): ChronicleRow {
  return {
    key: `week-${entry.turnNumber}`,
    marker: isEnd ? 'end' : fate ? 'fate' : 'week',
    weekLabel: `Week ${toRomanNumeral(entry.turnNumber)}`,
    headline: fate ? fate.eventTitle : headlineOf(entry),
    order: entry.playerIntent,
    ...(isEnd ? { badge: 'The end' } : fate ? { badge: 'A fate' } : {}),
  };
}

/**
 * The reign, newest week first, with runs of three or more ordinary weeks
 * collapsed into one unrollable row.
 *
 * `reignEnded` marks the final week crimson; the caller knows whether the
 * player is dead, so this module does not guess it from the narration.
 */
export function buildChronicleSpine(
  turnHistory: readonly TurnHistoryEntry[],
  eventHistory: readonly EventHistoryEntry[],
  reignEnded = false,
): ChronicleRow[] {
  if (turnHistory.length === 0) return [];

  const fateByTurn = new Map<number, EventHistoryEntry>();
  for (const fate of eventHistory) fateByTurn.set(fate.turnNumber, fate);
  const lastTurn = turnHistory[turnHistory.length - 1].turnNumber;

  const rows = turnHistory.map(entry =>
    rowFor(entry, fateByTurn.get(entry.turnNumber), reignEnded && entry.turnNumber === lastTurn));

  // Collapse in chronological order first, so a collapsed range reads
  // "Weeks I–IX" rather than backwards, then reverse the finished list.
  const folded: ChronicleRow[] = [];
  let run: ChronicleRow[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length < MIN_COLLAPSIBLE_RUN) {
      folded.push(...run);
    } else {
      const first = run[0], last = run[run.length - 1];
      folded.push({
        key: `${first.key}-through-${last.key}`,
        marker: 'collapsed',
        weekLabel: `${first.weekLabel.replace('Week', 'Weeks')}–${last.weekLabel.replace('Week ', '')}`,
        headline: `${run.length} quieter weeks`,
        collapsed: run,
      });
    }
    run = [];
  };
  for (const row of rows) {
    if (row.marker === 'week') run.push(row);
    else { flushRun(); folded.push(row); }
  }
  flushRun();

  return folded.reverse();
}
