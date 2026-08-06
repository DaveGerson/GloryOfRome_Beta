/**
 * knowledge/credibilityFraming.ts - the player-facing translation of a
 * datapoint's credibility (DESIGN_DECISIONS.md D25/D26).
 *
 * D25: no quantitative credibility ever reaches the player - no percentage,
 * no bar, no 0-1 number. The player judges trust from the SOURCE of a
 * datapoint and how that source frames its own certainty; corroborating or
 * conflicting sources are the signal. D26: the value the player sees must
 * never look system-authoritative - it is always an in-fiction voice the
 * player may choose to distrust.
 *
 * The backend keeps the raw number (it still drives the GM console's
 * true-vs-believed instrument, D7). This module derives, from that number
 * plus the source, the in-fiction phrasing the player sees INSTEAD. The
 * derivation is one-way: the number is consumed here and never re-emitted,
 * so a player surface that renders only these helpers' output can never
 * leak the figure.
 *
 * Intentionally pure (no React, no AI imports) so every band boundary and
 * every authored phrase is unit-testable in isolation.
 */

import type { ReportSource } from '../types';
import type { PerceptionSource } from '../perception/visibility';

/**
 * The three ordinal certainty regions. Boundaries match the cutpoints the
 * player-facing badge already used (> 0.7 / >= 0.4) so the GM's number and
 * the player's phrasing describe the SAME three regions of the 0-1 scale -
 * the console and the surface never disagree about which band a datum is in.
 */
export type CertaintyBand = 'firm' | 'hedged' | 'doubtful';

export function certaintyBand(credibility: number): CertaintyBand {
  if (credibility > 0.7) return 'firm';
  if (credibility >= 0.4) return 'hedged';
  return 'doubtful';
}

/**
 * Ordinal rank of a band (doubtful < hedged < firm). Exists so the mapping's
 * monotonicity - higher credibility never yields a less-certain band - is
 * directly assertable; not shown to the player.
 */
const BAND_RANK: Record<CertaintyBand, number> = { doubtful: 0, hedged: 1, firm: 2 };

export function certaintyRank(credibility: number): number {
  return BAND_RANK[certaintyBand(credibility)];
}

/** Severity tone for the certainty badge - the existing three-colour scale, keyed off the band rather than the raw number. */
export function certaintyTone(credibility: number): 'laurel' | 'bronze' | 'crimson' {
  const band = certaintyBand(credibility);
  return band === 'firm' ? 'laurel' : band === 'hedged' ? 'bronze' : 'crimson';
}

/** A one-word certainty characterization for the badge - a qualifier, never a number. */
const BAND_BADGE_WORD: Record<CertaintyBand, string> = {
  firm: 'Firm',
  hedged: 'Guarded',
  doubtful: 'Doubtful',
};

export function certaintyBadgeWord(credibility: number): string {
  return BAND_BADGE_WORD[certaintyBand(credibility)];
}

/**
 * Who the datapoint came from, as a subject phrase - the "source" half of
 * D25's source-framed trust. Composed with a certainty clause below rather
 * than authored per (source x band) pair, so the two axes stay independent
 * and the wording surface small.
 */
const SOURCE_LEAD: Record<ReportSource, string> = {
  scout: 'Your scout',
  spy: 'Your agent',
  merchant: 'A merchant',
  messenger: 'A courier',
  rumor: 'The rumor mill',
};

/**
 * How firmly the source stands behind the claim - the "how the source frames
 * its own certainty" half of D25. Predicate phrases that compose after any
 * SOURCE_LEAD subject.
 */
const CERTAINTY_CLAUSE: Record<CertaintyBand, string> = {
  firm: 'stands firmly behind this account.',
  hedged: 'reports this, but will not vouch for every detail.',
  doubtful: 'passes this along with little faith in it.',
};

/**
 * The full in-fiction reliability line the player reads in place of a
 * number: who reported it and how firmly that source frames its own
 * certainty. Contains no figure - a player surface can render this verbatim
 * without ever leaking the backend credibility (D25/D26).
 */
export function sourceCertaintyPhrase(source: ReportSource, credibility: number): string {
  return `${SOURCE_LEAD[source]} ${CERTAINTY_CLAUSE[certaintyBand(credibility)]}`;
}

/**
 * ReportsTab-level display logic, extracted as a pure function so the "no
 * number ever reaches this line" guarantee is unit-testable without a React
 * harness. Everything a report card shows about trust is derived here from
 * source + credibility; the raw `credibility` field is consumed and never
 * forwarded.
 */
export function reportReliability(
  report: { source: ReportSource; credibility: number },
): { tone: 'laurel' | 'bronze' | 'crimson'; badgeWord: string; phrase: string } {
  return {
    tone: certaintyTone(report.credibility),
    badgeWord: certaintyBadgeWord(report.credibility),
    phrase: sourceCertaintyPhrase(report.source, report.credibility),
  };
}

/**
 * The lead of the source phrase on its own — "Your agent", "A courier", "The
 * rumour mill" — so a report card can be titled by WHO said it rather than by
 * "Turn 5", the least useful fact available (audit item 35 / item 28). Still
 * one-way: it reads only `source`, never the figure.
 */
export function sourceLead(source: ReportSource): string {
  return SOURCE_LEAD[source];
}

/**
 * The certainty clause alone, for a card that already names its source in the
 * title and would otherwise repeat it in the line beneath.
 */
export function certaintyClause(credibility: number): string {
  return CERTAINTY_CLAUSE[certaintyBand(credibility)];
}

/**
 * Leads for the D5 perception sources, so a surface that renders a
 * KnowledgeUpdate (whose source may be a perception source OR a report
 * source) can always name who is speaking. Perception entries are
 * binary-fidelity (D5 v1): they carry no credibility, so they get a lead
 * and never a certainty clause.
 */
const PERCEPTION_LEAD: Record<PerceptionSource, string> = {
  self: 'Your own reading',
  witnessed: 'Your own eyes',
  network: 'Your eyes and ears',
  public: 'Common knowledge',
};

/**
 * The source lead for ANY knowledge-update source — the total function over
 * `KnowledgeSource` (perception ∪ report vocabularies) the B2 surfaces
 * read. One-way like everything here: reads the source word, never a figure.
 */
export function knowledgeSourceLead(source: PerceptionSource | ReportSource): string {
  return source in PERCEPTION_LEAD
    ? PERCEPTION_LEAD[source as PerceptionSource]
    : SOURCE_LEAD[source as ReportSource];
}

/**
 * How a source's register reads at a glance (audit item 28): a firm agent is
 * sealed in crimson, a courier in Tyrian, and the rumour mill is not sealed at
 * all. Source + band, never the figure.
 */
export type ReportSeal = 'crimson' | 'tyrian' | 'unsealed';

export function reportSeal(report: { source: ReportSource; credibility: number }): ReportSeal {
  if (report.source === 'rumor') return 'unsealed';
  if (certaintyBand(report.credibility) === 'doubtful') return 'unsealed';
  return report.source === 'spy' || report.source === 'scout' ? 'crimson' : 'tyrian';
}

/**
 * What a GROUP of reports about one subject amounts to — D25 states plainly
 * that "corroborating or conflicting sources are the signal", and until now
 * the panel listed reports flat and reverse-chronological so three accounts of
 * the Praetorian Guard, the third contradicting the first two, looked like
 * three unrelated cards.
 *
 * Derived here rather than in the component, and deliberately from structural
 * metadata only:
 *   - `stance` (D29) is explicitly player-safe structural data — it says a
 *     follow-up BACKS or REFUTES the running claim, never whether either is
 *     true;
 *   - `topic` separates distinct matters about one subject;
 *   - certainty RANK (not the number) orders which account outweighs which.
 *
 * `credibility` is consumed inside this module and never re-emitted, so no
 * number can reach the player through this path (D25/D26).
 */
export type CorroborationVerdict = 'agree' | 'conflict' | 'single';

export interface GroupCorroboration {
  verdict: CorroborationVerdict;
  /** How many accounts the group holds — a count of sources, not a score. */
  sources: number;
}

export function corroboration(
  reports: readonly { source: ReportSource; credibility: number; topic?: string; stance?: 'corroborates' | 'contradicts' }[],
): GroupCorroboration {
  if (reports.length <= 1) return { verdict: 'single', sources: reports.length };
  if (reports.some(report => report.stance === 'contradicts')) {
    return { verdict: 'conflict', sources: reports.length };
  }
  // Absent an explicit stance, two accounts of the SAME topic that sit in
  // opposite certainty bands are treated as an unresolved disagreement rather
  // than as agreement — the player should see that the accounts do not sit
  // easily together, without ever seeing why in figures.
  const byTopic = new Map<string, Set<CertaintyBand>>();
  for (const report of reports) {
    const key = report.topic ?? '';
    const bands = byTopic.get(key) ?? new Set<CertaintyBand>();
    bands.add(certaintyBand(report.credibility));
    byTopic.set(key, bands);
  }
  for (const bands of byTopic.values()) {
    if (bands.has('firm') && bands.has('doubtful')) return { verdict: 'conflict', sources: reports.length };
  }
  return { verdict: 'agree', sources: reports.length };
}

/**
 * Whether one account in a group sits below a higher-certainty account of the
 * same topic — the "— and it contradicts the two above." note. Rank only.
 */
export function contradictsHigherCertainty(
  report: { credibility: number; topic?: string; stance?: 'corroborates' | 'contradicts' },
  group: readonly { credibility: number; topic?: string }[],
): boolean {
  if (report.stance !== 'contradicts') return false;
  const rank = certaintyRank(report.credibility);
  return group.some(other => (other.topic ?? '') === (report.topic ?? '') && certaintyRank(other.credibility) > rank);
}
