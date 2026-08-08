/**
 * tests/credibilityFraming.test.ts
 *
 * Pins DESIGN_DECISIONS.md D25/D26 - the honest window and sourced (never
 * numeric) credibility - as pure unit tests, no React harness:
 *   - the source+credibility -> phrase helper is monotonic and never emits a
 *     figure (D25);
 *   - the investigation result is framed as the agent's SOURCED confidence,
 *     never a system "confirmed" (D26);
 *   - a surface guard: no player-facing component renders a credibility
 *     number, while the GM console still does (D25/D5/D7).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  certaintyBand,
  certaintyRank,
  certaintyTone,
  certaintyBadgeWord,
  sourceCertaintyPhrase,
  reportReliability,
} from '../knowledge/credibilityFraming';
import { agentConfidenceFraming } from '../ai/prompts/intelligence';
import { ReportSourceEnum } from '../types';
import type { ReportSource } from '../types';

/** A fine sweep of 0-1 credibility values, plus the band boundaries. */
const CREDIBILITY_SWEEP = [
  0, 0.05, 0.2, 0.39, 0.4, 0.41, 0.55, 0.69, 0.7, 0.71, 0.85, 0.99, 1,
];

const NO_DIGIT = /\d/;

describe('certainty band derivation (D25)', () => {
  it('boundaries match the three regions of the 0-1 scale', () => {
    expect(certaintyBand(0.39)).toBe('doubtful');
    expect(certaintyBand(0.4)).toBe('hedged');
    expect(certaintyBand(0.7)).toBe('hedged');
    expect(certaintyBand(0.71)).toBe('firm');
  });

  it('rank is monotonic non-decreasing in credibility', () => {
    const ranks = CREDIBILITY_SWEEP.map(certaintyRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it('tone tracks the band and stays on the three-colour scale', () => {
    expect(certaintyTone(0.9)).toBe('laurel');
    expect(certaintyTone(0.5)).toBe('bronze');
    expect(certaintyTone(0.1)).toBe('crimson');
  });
});

describe('player-facing framing carries no number (D25)', () => {
  it('badge word is a qualifier, never a figure', () => {
    for (const c of CREDIBILITY_SWEEP) {
      expect(certaintyBadgeWord(c)).not.toMatch(NO_DIGIT);
      expect(certaintyBadgeWord(c)).not.toContain('%');
    }
  });

  it('every source x credibility phrase names a source and contains no number', () => {
    for (const source of ReportSourceEnum) {
      for (const c of CREDIBILITY_SWEEP) {
        const phrase = sourceCertaintyPhrase(source, c);
        expect(phrase).not.toMatch(NO_DIGIT);
        expect(phrase).not.toContain('%');
        expect(phrase.length).toBeGreaterThan(0);
      }
    }
  });

  it('distinct sources produce distinct lead-ins at a fixed credibility', () => {
    const leads = new Set(ReportSourceEnum.map(s => sourceCertaintyPhrase(s, 0.9)));
    expect(leads.size).toBe(ReportSourceEnum.length);
  });

  it('the phrase certainty tracks the band - the same source reads more sure the higher the credibility', () => {
    const source: ReportSource = 'spy';
    const doubtful = sourceCertaintyPhrase(source, 0.1);
    const firm = sourceCertaintyPhrase(source, 0.95);
    expect(doubtful).not.toBe(firm);
  });
});

describe('reportReliability (ReportsTab display logic)', () => {
  it('exposes tone + badge word + phrase, none carrying a number', () => {
    for (const source of ReportSourceEnum) {
      for (const c of CREDIBILITY_SWEEP) {
        const { tone, badgeWord, phrase } = reportReliability({ source, credibility: c });
        expect(['laurel', 'bronze', 'crimson']).toContain(tone);
        expect(badgeWord).not.toMatch(NO_DIGIT);
        expect(phrase).not.toMatch(NO_DIGIT);
        expect(`${badgeWord} ${phrase}`).not.toContain('%');
      }
    }
  });
});

describe('investigation verification is sourced, not system-confirmed (D26)', () => {
  const TIERS = [
    'critical_failure',
    'failure',
    'partial_success',
    'success',
    'critical_success',
  ] as const;

  it('every tier frames the result as the agent’s own confidence, with no number', () => {
    for (const tier of TIERS) {
      const framing = agentConfidenceFraming(tier);
      expect(framing).toMatch(/your agent/i);
      expect(framing).not.toMatch(NO_DIGIT);
    }
  });

  it('each tier yields a distinct framing', () => {
    const framings = new Set(TIERS.map(agentConfidenceFraming));
    expect(framings.size).toBe(TIERS.length);
  });

  it('never presents intel as a settled system fact - failure tiers hedge, success tiers vouch', () => {
    expect(agentConfidenceFraming('critical_failure')).toMatch(/cannot vouch|next to nothing/i);
    expect(agentConfidenceFraming('failure')).toMatch(/doubtful|little/i);
    expect(agentConfidenceFraming('success')).toMatch(/confident/i);
    expect(agentConfidenceFraming('critical_success')).toMatch(/certain/i);
  });
});

describe('surface guard: the credibility number renders in the GM console only (D25/D5/D7)', () => {
  // The single formatting idiom used to render a 0-1 credibility as a
  // percentage. It must appear only in GameMasterScreen.tsx.
  const NUMERIC_CREDIBILITY = 'credibility * 100';
  const componentsDir = new URL('../components/', import.meta.url);

  function collectTsx(dir: URL): URL[] {
    const out: URL[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) out.push(...collectTsx(child));
      else if (entry.name.endsWith('.tsx')) out.push(child);
    }
    return out;
  }

  it('no player-facing component formats a credibility number', () => {
    // The GM console surface is a directory: the shell (GameMasterScreen.tsx)
    // plus every view under components/gm/ — both exempt, same as before the
    // split when the idiom lived in the one monolith file.
    const offenders = collectTsx(componentsDir)
      .filter(f => !f.pathname.endsWith('GameMasterScreen.tsx'))
      .filter(f => !f.pathname.includes('/components/gm/'))
      .filter(f => readFileSync(f, 'utf8').includes(NUMERIC_CREDIBILITY))
      .map(f => f.pathname);
    expect(offenders).toEqual([]);
  });

  it('the GM console still shows the raw credibility number', () => {
    // Post-split, the idiom lives in the two views that render it, not the shell.
    const truthLedger = readFileSync(new URL('../components/gm/TruthLedgerView.tsx', import.meta.url), 'utf8');
    const playerKnowledge = readFileSync(new URL('../components/gm/PlayerKnowledgeView.tsx', import.meta.url), 'utf8');
    expect(truthLedger).toContain(NUMERIC_CREDIBILITY);
    expect(playerKnowledge).toContain(NUMERIC_CREDIBILITY);
  });

  it('ReportsTab renders through the sourced-framing helper, not a raw figure', () => {
    const reportsTab = readFileSync(new URL('../components/tabs/ReportsTab.tsx', import.meta.url), 'utf8');
    expect(reportsTab).toContain('reportReliability');
    expect(reportsTab).not.toContain(NUMERIC_CREDIBILITY);
    expect(reportsTab).not.toContain('.toFixed');
  });
});
