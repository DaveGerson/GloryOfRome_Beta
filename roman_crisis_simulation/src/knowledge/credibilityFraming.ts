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
