import { describe, expect, it } from 'vitest';
import { describeResource, formatResourceValue } from '../components/tabs/resourceDescriptors';
import { buildChronicleSpine } from '../components/tabs/chronicleSpine';
import { contradictsHigherCertainty, corroboration } from '../knowledge/credibilityFraming';
import type { EventHistoryEntry, ReportSource, TurnHistoryEntry } from '../types';

describe('resourceDescriptors (audit item 34)', () => {
  // The live bug: the percent suffix used to be gated on
  // `!Number.isInteger(value)`, so 62.5 rendered "62.5%" and 80 rendered "80" —
  // the same quantity in two units.
  it('never infers a unit from the value', () => {
    const scale = describeResource('legion_support');
    expect(scale.unit).toBe('scale');
    expect(formatResourceValue(62.5, scale.unit)).toBe('62.5');
    expect(formatResourceValue(80, scale.unit)).toBe('80');
  });

  it('writes money with separators and counts bare', () => {
    expect(formatResourceValue(12500, describeResource('denarii').unit)).toBe('12,500');
    expect(formatResourceValue(3, describeResource('investigations').unit)).toBe('3');
  });

  it('gives blackmail keys a person, not a raw key', () => {
    const descriptor = describeResource('blackmail_on_maximinus_thrax');
    expect(descriptor.label).toBe('Maximinus Thrax');
    expect(descriptor.register).toBe('leverage');
  });

  it('buckets by declaration, not by substring match on the key', () => {
    expect(describeResource('denarii').register).toBe('coin');
    expect(describeResource('senatorial_support').register).toBe('standing');
    // "investigations" is a substring of nothing else, but "personal_fortune"
    // used to be caught by the same `.includes` sweep as "blackmail".
    expect(describeResource('personal_fortune').register).toBe('coin');
  });

  it('titles an undeclared resource without guessing its unit', () => {
    const unknown = describeResource('grain_reserve');
    expect(unknown.label).toBe('Grain Reserve');
    expect(formatResourceValue(62.5, unknown.unit)).toBe('62.5');
  });
});

const report = (over: Partial<{ source: ReportSource; credibility: number; topic: string; stance: 'corroborates' | 'contradicts' }> = {}) => ({
  source: 'spy' as ReportSource,
  credibility: 0.8,
  ...over,
});

describe('corroboration (audit item 35 — the signal D25 promises)', () => {
  it('calls a lone account single', () => {
    expect(corroboration([report()])).toEqual({ verdict: 'single', sources: 1 });
  });

  it('calls agreeing accounts agreement, with a count of sources', () => {
    expect(corroboration([report(), report({ source: 'messenger' })]))
      .toEqual({ verdict: 'agree', sources: 2 });
  });

  it('calls an explicit refutation a conflict', () => {
    const group = [report(), report({ source: 'rumor', credibility: 0.5, stance: 'contradicts' })];
    expect(corroboration(group).verdict).toBe('conflict');
  });

  it('treats firm and doubtful accounts of one topic as a conflict', () => {
    const group = [report({ topic: 'praetorians', credibility: 0.9 }), report({ topic: 'praetorians', credibility: 0.2 })];
    expect(corroboration(group).verdict).toBe('conflict');
  });

  it('does not call two accounts of DIFFERENT topics a conflict', () => {
    const group = [report({ topic: 'praetorians', credibility: 0.9 }), report({ topic: 'grain', credibility: 0.2 })];
    expect(corroboration(group).verdict).toBe('agree');
  });

  it('marks only the refuting account as contradicting the ones above it', () => {
    const firm = report({ topic: 'praetorians', credibility: 0.9 });
    const refuting = report({ topic: 'praetorians', credibility: 0.3, stance: 'contradicts' as const });
    expect(contradictsHigherCertainty(refuting, [firm, refuting])).toBe(true);
    expect(contradictsHigherCertainty(firm, [firm, refuting])).toBe(false);
  });
});

const turn = (turnNumber: number, narration: string): TurnHistoryEntry => ({
  turnNumber,
  playerIntent: `Order ${turnNumber}`,
  narration,
  adjudication: { headlines: [], deltas: [], entityActions: [], gm_private: [] } as unknown as TurnHistoryEntry['adjudication'],
});

const fate = (turnNumber: number, eventTitle: string): EventHistoryEntry =>
  ({ eventId: `e${turnNumber}`, turnNumber, eventTitle, choiceText: 'You chose.' } as EventHistoryEntry);

describe('buildChronicleSpine (audit item 37 — a reign, not three entries)', () => {
  it('holds nothing before the first week', () => {
    expect(buildChronicleSpine([], [])).toEqual([]);
  });

  it('gives a fourteen-week reign fourteen rows when nothing collapses', () => {
    // Every week carries a fate, so no run of ordinary weeks forms.
    const weeks = Array.from({ length: 14 }, (_, i) => turn(i + 1, `Week ${i + 1} happened.`));
    const fates = weeks.map(week => fate(week.turnNumber, `Fate ${week.turnNumber}`));
    expect(buildChronicleSpine(weeks, fates)).toHaveLength(14);
  });

  it('collapses a run of three or more quiet weeks into one unrollable row', () => {
    const weeks = Array.from({ length: 5 }, (_, i) => turn(i + 1, `Week ${i + 1} happened.`));
    const spine = buildChronicleSpine(weeks, [fate(5, 'The Donative')]);
    expect(spine.map(row => row.marker)).toEqual(['fate', 'collapsed']);
    const collapsed = spine[1];
    expect(collapsed.weekLabel).toBe('Weeks I–IV');
    expect(collapsed.headline).toBe('4 quieter weeks');
    expect(collapsed.collapsed).toHaveLength(4);
  });

  it('leaves a run shorter than three weeks uncollapsed', () => {
    const weeks = [turn(1, 'One.'), turn(2, 'Two.'), turn(3, 'Three.')];
    const spine = buildChronicleSpine(weeks, [fate(1, 'A fate'), fate(3, 'Another')]);
    expect(spine.map(row => row.marker)).toEqual(['fate', 'week', 'fate']);
  });

  it('marks the reign the player did not survive', () => {
    const weeks = [turn(1, 'One.'), turn(2, 'Two.')];
    const spine = buildChronicleSpine(weeks, [], true);
    expect(spine[0].marker).toBe('end');
    expect(spine[0].badge).toBe('The end');
  });

  it('runs newest week first and carries the order the player gave', () => {
    const weeks = [turn(1, 'One.'), turn(2, 'Two.')];
    const spine = buildChronicleSpine(weeks, []);
    expect(spine[0].weekLabel).toBe('Week II');
    expect(spine[0].order).toBe('Order 2');
  });

  it('takes only the first sentence of a narration as the headline', () => {
    const spine = buildChronicleSpine([turn(1, 'The Curia stirred. Then it stirred again.')], []);
    expect(spine[0].headline).toBe('The Curia stirred.');
  });
});
