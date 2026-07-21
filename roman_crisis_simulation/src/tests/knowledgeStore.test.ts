/**
 * Pure unit tests for knowledge/store.ts (ROADMAP_PHASE_4.md 4B item 2,
 * DESIGN_DECISIONS.md D21) - no DOM, no React harness. Local artifact
 * factories (rather than the mock data graph) keep this a pure unit test
 * of the ingestion functions, matching perception.test.ts's convention.
 *
 * The leak-guard suite at the bottom pins the stage's hard invariant
 * (D5/D21): the store's serialized form must never contain GM-private
 * truth data, even when an ingested artifact was polluted with it.
 */
import { describe, it, expect } from 'vitest';
import {
  KnowledgeClaim,
  MAX_KNOWLEDGE_CLAIMS,
  MAX_UPDATES_PER_CLAIM,
  ingestPerceivedChanges,
  ingestReports,
  ingestInvestigationReveal,
} from '../knowledge/store';
import type { PerceivedChange } from '../perception/visibility';
import type { Report } from '../types';

function makeChange(overrides: Partial<PerceivedChange> = {}): PerceivedChange {
  return {
    text: 'Your denarii dwindles.',
    source: 'self',
    tabs: ['resources'],
    subject: 'severus_alexander',
    deltaType: 'resource',
    deltaKey: 'severus_alexander:denarii',
    ...overrides,
  };
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report_2_1',
    turn: 2,
    source: 'rumor',
    about: 'maximinus_thrax',
    claim: 'Thrax courts the Rhine legions',
    credibility: 0.6,
    ...overrides,
  };
}

describe('knowledge/store', () => {
  describe('ingestPerceivedChanges (digest channel)', () => {
    it('opens a new claim from a perceived change, stamped with the turn', () => {
      const store = ingestPerceivedChanges([], [makeChange()], 3);

      expect(store).toHaveLength(1);
      const claim = store[0];
      expect(claim.subject).toBe('severus_alexander');
      expect(claim.claim).toBe('Your denarii dwindles.');
      expect(claim.claimKey).toBe('digest:resource:severus_alexander:denarii');
      expect(claim.firstLearnedTurn).toBe(3);
      // updates[0] IS the first learning - the full visible timeline.
      expect(claim.updates).toEqual([{ turn: 3, source: 'self', text: 'Your denarii dwindles.' }]);
    });

    it('appends an update to the existing claim for the same deltaType + deltaKey, freezing claim text and firstLearnedTurn', () => {
      const first = ingestPerceivedChanges([], [makeChange()], 3);
      const second = ingestPerceivedChanges(
        first,
        [makeChange({ text: 'Your denarii grows.' })],
        5
      );

      expect(second).toHaveLength(1);
      const claim = second[0];
      expect(claim.claim).toBe('Your denarii dwindles.'); // frozen at first arrival
      expect(claim.firstLearnedTurn).toBe(3); // frozen at first arrival
      expect(claim.updates).toHaveLength(2);
      expect(claim.updates[1]).toEqual({ turn: 5, source: 'self', text: 'Your denarii grows.' });
    });

    it('opens a NEW claim for a different deltaKey, even about the same subject', () => {
      const first = ingestPerceivedChanges([], [makeChange()], 3);
      const second = ingestPerceivedChanges(
        first,
        [makeChange({ deltaKey: 'severus_alexander:grain', text: 'Your grain dwindles.' })],
        3
      );
      expect(second).toHaveLength(2);
    });

    it('opens a NEW claim for the same key under a different deltaType (matching-rule boundary)', () => {
      const first = ingestPerceivedChanges([], [makeChange({ deltaType: 'status', deltaKey: 'maximinus_thrax', subject: 'maximinus_thrax', text: 'Maximinus Thrax is now exiled.' })], 2);
      const second = ingestPerceivedChanges(
        first,
        [makeChange({ deltaType: 'scheme', deltaKey: 'maximinus_thrax', subject: 'maximinus_thrax', text: 'You sense Maximinus Thrax is plotting something.' })],
        2
      );
      expect(second).toHaveLength(2);
    });

    it('skips rumor-type digest entries (Reports are the canonical rumor channel) and returns the same store reference when nothing ingests', () => {
      const store: KnowledgeClaim[] = [];
      const next = ingestPerceivedChanges(
        store,
        [makeChange({ deltaType: 'rumor', deltaKey: 'maximinus_thrax', subject: 'maximinus_thrax', source: 'public', text: 'Rumor reaches you: "Thrax plots."' })],
        2
      );
      expect(next).toBe(store);
      expect(ingestPerceivedChanges(store, [], 2)).toBe(store);
    });
  });

  describe('ingestReports (report channel)', () => {
    it("opens a new claim from a report, carrying the report's own turn, source and credibility", () => {
      const store = ingestReports([], [makeReport()]);

      expect(store).toHaveLength(1);
      const claim = store[0];
      expect(claim.subject).toBe('maximinus_thrax');
      expect(claim.claim).toBe('Thrax courts the Rhine legions');
      expect(claim.claimKey).toBe('report:maximinus_thrax:rumor');
      expect(claim.firstLearnedTurn).toBe(2);
      expect(claim.updates).toEqual([
        { turn: 2, source: 'rumor', text: 'Thrax courts the Rhine legions', credibility: 0.6 },
      ]);
    });

    it('appends an update for the same about + source - the rumor mill re-reporting (D21)', () => {
      const first = ingestReports([], [makeReport()]);
      const second = ingestReports(first, [
        makeReport({ id: 'report_4_1', turn: 4, claim: 'The legions now openly cheer Thrax', credibility: 0.8 }),
      ]);

      expect(second).toHaveLength(1);
      const claim = second[0];
      expect(claim.claim).toBe('Thrax courts the Rhine legions');
      expect(claim.firstLearnedTurn).toBe(2);
      expect(claim.updates).toHaveLength(2);
      expect(claim.updates[1]).toEqual({
        turn: 4,
        source: 'rumor',
        text: 'The legions now openly cheer Thrax',
        credibility: 0.8,
      });
    });

    it('opens a NEW claim for the same subject from a different source family (matching-rule boundary)', () => {
      const first = ingestReports([], [makeReport()]);
      const second = ingestReports(first, [makeReport({ id: 'report_3_1', turn: 3, source: 'scout' })]);
      expect(second).toHaveLength(2);
    });

    it('never cross-matches a digest claim about the same subject (channel prefixes keep the keys apart)', () => {
      const afterDigest = ingestPerceivedChanges(
        [],
        [makeChange({ deltaType: 'status', deltaKey: 'maximinus_thrax', subject: 'maximinus_thrax', text: 'Maximinus Thrax is now exiled.' })],
        2
      );
      const both = ingestReports(afterDigest, [makeReport()]);
      expect(both).toHaveLength(2);
    });

    it('returns the same store reference when handed no reports', () => {
      const store = ingestReports([], [makeReport()]);
      expect(ingestReports(store, [])).toBe(store);
    });
  });

  describe('ingestInvestigationReveal (bought-intel channel, D14)', () => {
    it("opens a new claim from a reveal, sourced 'spy'", () => {
      const store = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax',
        kind: 'secrets',
        text: 'He hides a pact with the Rhine legions.',
        turn: 6,
      });

      expect(store).toHaveLength(1);
      const claim = store[0];
      expect(claim.subject).toBe('maximinus_thrax');
      expect(claim.claimKey).toBe('investigation:maximinus_thrax:secrets');
      expect(claim.firstLearnedTurn).toBe(6);
      expect(claim.updates).toEqual([
        { turn: 6, source: 'spy', text: 'He hides a pact with the Rhine legions.' },
      ]);
    });

    it('re-investigating the same target + kind appends a freshly stamped update; the earlier reveal stays frozen (D14)', () => {
      const first = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax',
        kind: 'scheme',
        text: 'He plans to march on Rome.',
        turn: 4,
      });
      const second = ingestInvestigationReveal(first, {
        targetId: 'maximinus_thrax',
        kind: 'scheme',
        text: 'The march is set for the spring thaw.',
        turn: 9,
      });

      expect(second).toHaveLength(1);
      const claim = second[0];
      expect(claim.firstLearnedTurn).toBe(4);
      expect(claim.updates).toEqual([
        { turn: 4, source: 'spy', text: 'He plans to march on Rome.' },
        { turn: 9, source: 'spy', text: 'The march is set for the spring thaw.' },
      ]);
    });

    it('a different kind on the same target opens a NEW claim (matching-rule boundary)', () => {
      const first = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax',
        kind: 'beliefs',
        text: 'He believes strength alone confers legitimacy.',
        turn: 4,
      });
      const second = ingestInvestigationReveal(first, {
        targetId: 'maximinus_thrax',
        kind: 'secrets',
        text: 'He hides a pact.',
        turn: 4,
      });
      expect(second).toHaveLength(2);
    });
  });

  describe('bounding', () => {
    it(`evicts the OLDEST-UPDATED claim past MAX_KNOWLEDGE_CLAIMS (${MAX_KNOWLEDGE_CLAIMS}), not the oldest-created`, () => {
      // Fill exactly to the cap: one claim per subject, created turns 1..cap.
      const fillers = Array.from({ length: MAX_KNOWLEDGE_CLAIMS }, (_, i) =>
        makeReport({ id: `report_fill_${i}`, turn: i + 1, about: `subject_${i}` })
      );
      let store = ingestReports([], fillers);
      expect(store).toHaveLength(MAX_KNOWLEDGE_CLAIMS);

      // Refresh the OLDEST-CREATED claim (subject_0) so it is no longer the
      // oldest-updated - eviction must key on last update, not creation.
      store = ingestReports(store, [
        makeReport({ id: 'report_refresh', turn: MAX_KNOWLEDGE_CLAIMS + 1, about: 'subject_0' }),
      ]);
      expect(store).toHaveLength(MAX_KNOWLEDGE_CLAIMS);

      // One brand-new claim over the cap: subject_1 (last updated turn 2) is
      // now the oldest-updated and must be the one dropped.
      store = ingestReports(store, [
        makeReport({ id: 'report_new', turn: MAX_KNOWLEDGE_CLAIMS + 2, about: 'subject_new' }),
      ]);

      expect(store).toHaveLength(MAX_KNOWLEDGE_CLAIMS);
      const subjects = store.map(c => c.subject);
      expect(subjects).toContain('subject_0'); // refreshed - survives despite being oldest-created
      expect(subjects).toContain('subject_new');
      expect(subjects).not.toContain('subject_1'); // oldest-updated - evicted
    });

    it(`bounds a claim's update timeline at MAX_UPDATES_PER_CLAIM (${MAX_UPDATES_PER_CLAIM}), keeping the newest and the frozen origin fields`, () => {
      const overflow = 5;
      let store: KnowledgeClaim[] = [];
      for (let turn = 1; turn <= MAX_UPDATES_PER_CLAIM + overflow; turn++) {
        store = ingestReports(store, [
          makeReport({ id: `report_${turn}`, turn, claim: `restatement ${turn}` }),
        ]);
      }

      expect(store).toHaveLength(1);
      const claim = store[0];
      expect(claim.updates).toHaveLength(MAX_UPDATES_PER_CLAIM);
      // The newest survive; the earliest rolled off.
      expect(claim.updates[0].turn).toBe(overflow + 1);
      expect(claim.updates[claim.updates.length - 1].turn).toBe(MAX_UPDATES_PER_CLAIM + overflow);
      // The origin stays frozen even after its update object rolled off.
      expect(claim.claim).toBe('restatement 1');
      expect(claim.firstLearnedTurn).toBe(1);
    });
  });

  describe('leak guard (D5/D21 hard invariant)', () => {
    // Fields of the GM-private handling class (D11 truth ledger, rumor
    // delta truth flags, secret survivors) that must NEVER appear anywhere
    // in the store's serialized form.
    const FORBIDDEN_KEYS = ['is_true', 'origin_id', 'isTrue', 'originId', 'secret_truth', 'assumed'];

    it('ingesting a Report polluted with truth-ledger fields (a lying rumor built by careless spreading) stores none of them', () => {
      // Reports never legitimately carry these - they live on rumor DELTAS
      // and the GM ledger - but a future refactor could plausibly build a
      // Report by spreading a delta. The field-by-field copy must hold.
      const pollutedReport = {
        ...makeReport({ claim: 'The Emperor has secretly fled Rome' }),
        is_true: false,
        origin_id: 'maximinus_thrax',
        secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'revenge' },
      } as unknown as Report;

      const store = ingestReports([], [pollutedReport]);
      const serialized = JSON.stringify(store);

      for (const key of FORBIDDEN_KEYS) {
        expect(serialized).not.toContain(key);
      }
      // The player-visible half of the lie is stored intact - the store
      // records what the player BELIEVES, truth flags stay in the ledger.
      expect(store[0].claim).toBe('The Emperor has secretly fled Rome');
      expect(store[0].updates[0].credibility).toBe(0.6);
    });

    it('digest and investigation ingestion are equally clean end to end', () => {
      const pollutedChange = {
        ...makeChange(),
        is_true: true,
        origin_id: 'someone',
      } as unknown as PerceivedChange;

      let store = ingestPerceivedChanges([], [pollutedChange], 2);
      store = ingestInvestigationReveal(store, {
        targetId: 'maximinus_thrax',
        kind: 'secrets',
        text: 'He hides a pact.',
        turn: 3,
      });

      const serialized = JSON.stringify(store);
      for (const key of FORBIDDEN_KEYS) {
        expect(serialized).not.toContain(key);
      }
    });
  });
});
