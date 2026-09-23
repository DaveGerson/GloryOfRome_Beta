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
  MAX_EDGES_PER_CLAIM,
  ingestPerceivedChanges,
  ingestReports,
  ingestInvestigationReveal,
  ingestSchemeClue,
  deriveDossier,
  SCHEME_CLUES_TO_REVEAL,
  SCHEME_CLUE_LINE,
  SCHEME_NATURE_UNSYNTHESIZED,
  normalizeTopic,
} from '../knowledge/store';
import { makePerceivedChange as makeChange, makeReport } from './factories';
import type { PerceivedChange } from '../perception/visibility';
import type { Report } from '../types';

describe('knowledge/store', () => {
  describe('KnowledgeClaim save-v1 shape', () => {
    it('keeps relationshipObservation optional so legacy claims remain valid', () => {
      const legacy = {
        id: 'legacy',
        subject: 'lucius',
        claim: 'A legacy claim.',
        claimKey: 'report:lucius:general:rumor',
        firstLearnedTurn: 1,
        updates: [{ turn: 1, source: 'rumor' as const, text: 'A legacy claim.' }],
      } satisfies KnowledgeClaim;
      const observed = {
        ...legacy,
        id: 'observed',
        claimKey: 'relationship-observation:2:0',
        relationshipObservation: {
          evidenceId: 'report_2_1',
          participantIds: ['severus_alexander', 'lucius'],
          quote: { speakerId: 'lucius', text: 'I stand with Severus.' },
        },
      } satisfies KnowledgeClaim;

      expect(legacy).not.toHaveProperty('relationshipObservation');
      expect(observed.relationshipObservation.evidenceId).toBe('report_2_1');
    });
  });

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
      expect(claim.claimKey).toBe('report:maximinus_thrax:general:rumor');
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
      // A full-dossier aspect (beliefs) - re-buying it appends a frozen
      // update on the same claim. The 'scheme' aspect follows the D28
      // clue-accretion path instead (see the scheme-discovery block below).
      const first = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax',
        kind: 'beliefs',
        text: 'He believes strength alone confers legitimacy.',
        turn: 4,
      });
      const second = ingestInvestigationReveal(first, {
        targetId: 'maximinus_thrax',
        kind: 'beliefs',
        text: 'He now doubts the Senate will ever bend.',
        turn: 9,
      });

      expect(second).toHaveLength(1);
      const claim = second[0];
      expect(claim.firstLearnedTurn).toBe(4);
      expect(claim.updates).toEqual([
        { turn: 4, source: 'spy', text: 'He believes strength alone confers legitimacy.' },
        { turn: 9, source: 'spy', text: 'He now doubts the Senate will ever bend.' },
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

  describe('scheme discovery (D28/D30 - awareness is perceived, nature is PAID for)', () => {
    // The reveal threshold is a tuning constant; these tests key off it rather
    // than a hardcoded number so they hold if it moves. All assume >= 2.
    const N = SCHEME_CLUES_TO_REVEAL;

    // A witnessed proximity sighting: AWARENESS only, never advances nature.
    function witness(store: KnowledgeClaim[], turn: number): KnowledgeClaim[] {
      return ingestSchemeClue(store, {
        schemerId: 'maximinus_thrax',
        turn,
        source: 'witnessed',
        text: 'You sense Maximinus Thrax is plotting something.',
      });
    }
    // A paid investigation clue: advances the nature count toward the reveal.
    function buy(store: KnowledgeClaim[], turn: number, natureHint?: string): KnowledgeClaim[] {
      return ingestSchemeClue(store, {
        schemerId: 'maximinus_thrax',
        turn,
        source: 'spy',
        text: SCHEME_CLUE_LINE,
        natureHint,
        advancesNature: true,
      });
    }

    it('a witnessed scheme sighting opens ONE discovery claim with a name-free line and AWARENESS but ZERO nature clues', () => {
      const store = ingestPerceivedChanges(
        [],
        [makeChange({
          deltaType: 'scheme',
          deltaKey: 'maximinus_thrax',
          subject: 'maximinus_thrax',
          source: 'witnessed',
          text: 'You sense Maximinus Thrax is plotting something.',
        })],
        2
      );

      expect(store).toHaveLength(1);
      const claim = store[0];
      expect(claim.claimKey).toBe('scheme:maximinus_thrax');
      expect(claim.topic).toBe('scheme');
      expect(claim.subject).toBe('maximinus_thrax');
      // Awareness is recorded (the claim exists) but the nature count stays 0:
      // proximity discloses only that someone is at work (D28/D30).
      expect(claim.schemeDiscovery).toEqual({ clues: 0, revealed: false });
      // The stored line names no scheme - only the schemer, who is fair game.
      const serialized = JSON.stringify(claim);
      expect(serialized).toContain('plotting something');
      expect(serialized).not.toMatch(/scheme"\s*:/); // no active_scheme object leaked
    });

    it('proximity records awareness on the SAME claim, and ONLY the paid investigation advances the nature count', () => {
      const witnessed = ingestPerceivedChanges(
        [],
        [makeChange({
          deltaType: 'scheme',
          deltaKey: 'maximinus_thrax',
          subject: 'maximinus_thrax',
          source: 'witnessed',
          text: 'You sense Maximinus Thrax is plotting something.',
        })],
        2
      );
      const bought = ingestInvestigationReveal(witnessed, {
        targetId: 'maximinus_thrax',
        kind: 'scheme',
        text: 'He plans to march on Rome.', // the raw reading - must NOT be stored while unrevealed
        turn: 3,
      });

      expect(bought).toHaveLength(1);
      const claim = bought[0];
      // Both accrete onto one claim, but only the paid buy advanced nature:
      // proximity (0) + one paid clue (1) = 1, not 2.
      expect(claim.schemeDiscovery?.clues).toBe(1);
      expect(claim.updates).toHaveLength(2); // awareness line + paid clue line
      // The bought reading is a nature CANDIDATE, not stored in the timeline
      // below the threshold (D28 - a single buy must not dump the scheme).
      const serialized = JSON.stringify(claim);
      expect(serialized).not.toContain('march on Rome');
      expect(claim.updates[1].text).toBe(SCHEME_CLUE_LINE);
    });

    it('proximity sightings alone NEVER advance the nature count or reveal, no matter how many accrue (the D30 fix)', () => {
      let store: KnowledgeClaim[] = [];
      // Far more sightings than the reveal threshold - a mind re-evolving its
      // scheme every turn used to auto-reveal this way; it must not now.
      for (let turn = 1; turn <= N + 5; turn++) {
        store = witness(store, turn);
      }
      const claim = store[0];
      expect(claim.schemeDiscovery?.clues).toBe(0);
      expect(claim.schemeDiscovery?.revealed).toBe(false);
      expect(claim.schemeDiscovery?.nature).toBeUndefined();
    });

    it('stays UNREVEALED with the nature hidden below the threshold of PAID clues', () => {
      let store: KnowledgeClaim[] = [];
      for (let i = 1; i < N; i++) {
        store = buy(store, i);
      }
      const claim = store[0];
      expect(claim.schemeDiscovery?.clues).toBe(N - 1);
      expect(claim.schemeDiscovery?.revealed).toBe(false);
      expect(claim.schemeDiscovery?.nature).toBeUndefined();
    });

    it('flips revealed and surfaces the bought nature exactly when the PAID clue count reaches the threshold', () => {
      let store: KnowledgeClaim[] = [];
      // Proximity awareness first (does nothing to the count), then N paid
      // clues, the last carrying the reading that becomes the earned nature.
      store = witness(store, 1);
      for (let i = 1; i < N; i++) {
        store = buy(store, i + 1);
      }
      expect(store[0].schemeDiscovery?.revealed).toBe(false);
      expect(store[0].schemeDiscovery?.clues).toBe(N - 1);

      store = buy(store, N + 1, 'A coup: he means to march the Rhine legions on Rome.');

      const claim = store[0];
      expect(claim.schemeDiscovery?.clues).toBe(N);
      expect(claim.schemeDiscovery?.revealed).toBe(true);
      expect(claim.schemeDiscovery?.nature).toBe('A coup: he means to march the Rhine legions on Rome.');
    });

    it('falls back to the honest unsynthesized nature line if the PAID threshold is crossed with no reading to draw on', () => {
      let store: KnowledgeClaim[] = [];
      for (let i = 1; i <= N; i++) {
        store = buy(store, i); // paid clues, but no natureHint on any of them
      }
      const claim = store[0];
      expect(claim.schemeDiscovery?.revealed).toBe(true);
      expect(claim.schemeDiscovery?.nature).toBe(SCHEME_NATURE_UNSYNTHESIZED);
    });
  });

  describe('deriveDossier (per-target held-intel read model, D14/D27)', () => {
    it('returns an empty dossier for a target the player holds nothing on', () => {
      expect(deriveDossier([], 'maximinus_thrax')).toEqual({ subject: 'maximinus_thrax', entries: [] });
    });

    it('ignores digest and report claims - a dossier is only what was PAID to hold (D14)', () => {
      let store = ingestPerceivedChanges(
        [],
        [makeChange({ deltaType: 'status', deltaKey: 'maximinus_thrax', subject: 'maximinus_thrax', text: 'Maximinus Thrax is now exiled.' })],
        2
      );
      store = ingestReports(store, [makeReport()]); // a rumor about the same subject
      const dossier = deriveDossier(store, 'maximinus_thrax');
      expect(dossier.entries).toEqual([]);
      expect(dossier.lastRefreshedTurn).toBeUndefined();
    });

    it('gathers each held aspect stamped with first-learned + last-refreshed turns and the latest source', () => {
      let store = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
      });
      store = ingestInvestigationReveal(store, {
        targetId: 'maximinus_thrax', kind: 'secrets', text: 'He hides a pact with the Rhine legions.', turn: 6,
      });

      const dossier = deriveDossier(store, 'maximinus_thrax');
      expect(dossier.subject).toBe('maximinus_thrax');
      // The freshest thing on file (secrets, turn 6) sets the dossier's "as of".
      expect(dossier.lastRefreshedTurn).toBe(6);

      const beliefs = dossier.entries.find(e => e.kind === 'beliefs');
      expect(beliefs).toMatchObject({
        kind: 'beliefs', topic: 'beliefs', firstLearnedTurn: 4, lastRefreshedTurn: 4, source: 'spy',
        latestText: 'He believes strength confers legitimacy.',
      });
      const secrets = dossier.entries.find(e => e.kind === 'secrets');
      expect(secrets).toMatchObject({ kind: 'secrets', firstLearnedTurn: 6, lastRefreshedTurn: 6 });
    });

    it('a re-investigated aspect keeps its frozen origin but advances last-refreshed to the newest reveal (D14)', () => {
      let store = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
      });
      store = ingestInvestigationReveal(store, {
        targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He now doubts the Senate will bend.', turn: 9,
      });

      const beliefs = deriveDossier(store, 'maximinus_thrax').entries.find(e => e.kind === 'beliefs');
      expect(beliefs?.firstLearnedTurn).toBe(4); // frozen origin
      expect(beliefs?.lastRefreshedTurn).toBe(9); // the staleness clock advances
      expect(beliefs?.latestText).toBe('He now doubts the Senate will bend.'); // the freshest snapshot
    });

    it('surfaces a scheme aspect (D28) with its discovery bookkeeping and last-clue turn', () => {
      // A proximity sighting: awareness on file, but zero PAID nature clues.
      const store = ingestSchemeClue([], {
        schemerId: 'maximinus_thrax', turn: 3, source: 'witnessed', text: 'You sense Maximinus Thrax is plotting something.',
      });
      const scheme = deriveDossier(store, 'maximinus_thrax').entries.find(e => e.kind === 'scheme');
      expect(scheme).toMatchObject({ kind: 'scheme', topic: 'scheme', lastRefreshedTurn: 3 });
      expect(scheme?.schemeDiscovery).toEqual({ clues: 0, revealed: false });
    });

    it('scopes strictly to the requested subject', () => {
      let store = ingestInvestigationReveal([], {
        targetId: 'maximinus_thrax', kind: 'beliefs', text: 'A belief.', turn: 4,
      });
      store = ingestInvestigationReveal(store, {
        targetId: 'gordian', kind: 'beliefs', text: 'Another belief.', turn: 5,
      });
      expect(deriveDossier(store, 'maximinus_thrax').entries).toHaveLength(1);
      expect(deriveDossier(store, 'gordian').entries[0].lastRefreshedTurn).toBe(5);
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

  describe('topic keying + graph edges (D29)', () => {
    it('opens TWO claims for two DIFFERENT topics about the same subject (the over-merge is fixed)', () => {
      const first = ingestReports([], [makeReport({ topic: 'health', claim: 'Thrax is gravely ill' })]);
      const second = ingestReports(first, [
        makeReport({ id: 'report_3_1', turn: 3, topic: 'succession-plot', claim: 'Thrax courts the succession' }),
      ]);

      expect(second).toHaveLength(2);
      expect(second.map(c => c.claimKey)).toEqual([
        'report:maximinus_thrax:health:rumor',
        'report:maximinus_thrax:succession-plot:rumor',
      ]);
      // The newer claim links back to the older as 'about' the same subject.
      expect(second[1].edges).toEqual([{ to: second[0].id, type: 'about' }]);
      // The first-opened claim has no priors, so no outgoing edges.
      expect(second[0].edges).toBeUndefined();
    });

    it('continues ONE timeline when the same subject+topic is restated', () => {
      const first = ingestReports([], [makeReport({ topic: 'health', claim: 'Thrax is gravely ill' })]);
      const second = ingestReports(first, [
        makeReport({ id: 'report_4_1', turn: 4, topic: 'health', claim: 'The fever worsens' }),
      ]);

      expect(second).toHaveLength(1);
      expect(second[0].topic).toBe('health');
      expect(second[0].updates.map(u => u.turn)).toEqual([2, 4]);
      expect(second[0].claim).toBe('Thrax is gravely ill'); // frozen origin
    });

    it("records a 'corroborates' edge between two DIFFERENT sources on the same subject+topic", () => {
      const first = ingestReports([], [makeReport({ topic: 'health' })]); // source 'rumor'
      const second = ingestReports(first, [
        makeReport({ id: 'report_3_1', turn: 3, source: 'scout', topic: 'health' }),
      ]);

      expect(second).toHaveLength(2);
      expect(second[1].edges).toEqual([{ to: second[0].id, type: 'corroborates' }]);
    });

    it("forks a distinct node and records a 'contradicts' edge for an explicitly contradicting update, leaving the original timeline untouched", () => {
      const first = ingestReports([], [makeReport({ topic: 'health', claim: 'Thrax is gravely ill' })]);
      const second = ingestReports(first, [
        makeReport({
          id: 'report_5_1', turn: 5, topic: 'health', stance: 'contradicts',
          claim: 'Thrax was seen drilling the legions, hale and whole',
        }),
      ]);

      expect(second).toHaveLength(2);
      const original = second[0];
      const fork = second[1];
      // The disputed claim's timeline is NOT appended to - the refutation is
      // its own node, not swallowed into what it disputes.
      expect(original.updates).toHaveLength(1);
      expect(fork.claimKey).toBe('report:maximinus_thrax:health:rumor#c0');
      expect(fork.edges).toEqual([{ to: original.id, type: 'contradicts' }]);
    });

    // BACKLOG B7: fork numbering used to COUNT surviving forks, so once an
    // early fork was evicted the next fork re-used a live fork's key.
    describe('fork-key uniqueness under eviction (B7)', () => {
      const BASE = 'report:maximinus_thrax:health:rumor';
      const contradiction = (turn: number, n: number) => makeReport({
        id: `report_${turn}_${n}`, turn, topic: 'health', stance: 'contradicts', claim: `Refutation ${n}`,
      });

      it('numbers a new fork past the highest surviving fork index, never re-using a live key', () => {
        let store = ingestReports([], [makeReport({ topic: 'health' })]);
        store = ingestReports(store, [contradiction(4, 0), contradiction(5, 1), contradiction(6, 2)]);
        expect(store.map(c => c.claimKey)).toEqual([BASE, `${BASE}#c0`, `${BASE}#c1`, `${BASE}#c2`]);
        // #c0 has been evicted; #c1 and #c2 survive.
        const afterEviction = store.filter(c => c.claimKey !== `${BASE}#c0`);

        const next = ingestReports(afterEviction, [contradiction(9, 3)]);
        const keys = next.map(c => c.claimKey);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys[keys.length - 1]).toBe(`${BASE}#c3`);
        const ids = next.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it(`stays collision-free through the real ${MAX_KNOWLEDGE_CLAIMS}-claim cap eviction path`, () => {
        let store = ingestReports([], [contradiction(1, 0)]); // #c0, the ONLY turn-1 claim
        store = ingestReports(store, [makeReport({ topic: 'health', turn: 3 })]);
        store = ingestReports(store, [contradiction(3, 1)]); // #c1
        // Fill to the cap with unrelated, newer claims so #c0 is the first
        // (and only) claim evicted once the cap is exceeded.
        for (let i = 0; store.length < MAX_KNOWLEDGE_CLAIMS; i++) {
          store = ingestReports(store, [makeReport({ id: `filler_${i}`, turn: 3, about: `filler_${i}`, topic: 'general' })]);
        }
        store = ingestReports(store, [contradiction(4, 2)]);
        store = ingestReports(store, [contradiction(4, 3)]);
        expect(store.some(c => c.claimKey === `${BASE}#c0`)).toBe(false); // evicted
        const keys = store.map(c => c.claimKey);
        expect(new Set(keys).size).toBe(keys.length);
        const ids = store.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('derives the next index from legacy saves whose forks carry no counter (no save-format change)', () => {
        const legacy: KnowledgeClaim[] = [5, 7].map(n => ({
          id: `claim_2_${BASE}#c${n}`, subject: 'maximinus_thrax', claim: `Legacy fork ${n}`, topic: 'health',
          claimKey: `${BASE}#c${n}`, firstLearnedTurn: 2, updates: [{ turn: 2, source: 'rumor' as const, text: `Legacy fork ${n}` }],
        }));
        const next = ingestReports(legacy, [contradiction(3, 9)]);
        expect(next[next.length - 1].claimKey).toBe(`${BASE}#c8`);
      });
    });

    it("records a 'derives-from' edge from a bought investigation reveal to a prior rumor about the same subject", () => {
      const afterRumor = ingestReports([], [makeReport({ topic: 'health' })]);
      const withReveal = ingestInvestigationReveal(afterRumor, {
        targetId: 'maximinus_thrax', kind: 'secrets', text: 'He hides a pact with the Rhine legions.', turn: 7,
      });

      expect(withReveal).toHaveLength(2);
      expect(withReveal[1].edges).toEqual([{ to: afterRumor[0].id, type: 'derives-from' }]);
    });

    it(`bounds a claim's outgoing edges at MAX_EDGES_PER_CLAIM (${MAX_EDGES_PER_CLAIM})`, () => {
      let store: KnowledgeClaim[] = [];
      for (let i = 0; i < MAX_EDGES_PER_CLAIM + 2; i++) {
        store = ingestReports(store, [makeReport({ id: `report_${i}`, turn: i + 1, topic: `topic-${i}` })]);
      }
      // One more claim about the SAME subject: it would link to every prior,
      // but only the newest MAX_EDGES_PER_CLAIM survive.
      store = ingestReports(store, [makeReport({ id: 'report_final', turn: 100, topic: 'final-topic' })]);

      const finalClaim = store[store.length - 1];
      expect(finalClaim.edges).toHaveLength(MAX_EDGES_PER_CLAIM);
    });
  });

  describe('normalizeTopic (pure helper, D29)', () => {
    it('slugifies to a stable lowercase-hyphenated form and defaults empty/missing input to general', () => {
      expect(normalizeTopic('Succession Plot!')).toBe('succession-plot');
      expect(normalizeTopic('  Legion  Loyalty  ')).toBe('legion-loyalty');
      expect(normalizeTopic('')).toBe('general');
      expect(normalizeTopic(undefined)).toBe('general');
    });
  });

  describe('leak guard (D5/D21 hard invariant)', () => {
    // Fields of the GM-private handling class (D11 truth ledger, rumor
    // delta truth flags in wire AND ledger casings, secret survivors, the
    // assumed flag) that must NEVER appear anywhere in the store's
    // serialized form. Asserted as serialized JSON KEY patterns
    // (`"key":`), not bare substrings: prose like "he assumed the throne"
    // must never trip the guard, and every entry below is seeded onto the
    // polluted fixtures pre-ingestion so no entry can pass vacuously.
    const FORBIDDEN_KEYS = ['is_true', 'origin_id', 'isTrue', 'originId', 'secret_truth', 'assumed'];
    const asJsonKey = (key: string) => `"${key}":`;
    const POLLUTION = {
      is_true: false,
      origin_id: 'maximinus_thrax',
      isTrue: false,
      originId: 'maximinus_thrax',
      assumed: true,
      secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'revenge' },
    };

    it('ingesting a Report polluted with every forbidden key (a lying rumor built by careless spreading) stores none of them', () => {
      // Reports never legitimately carry these - they live on rumor DELTAS
      // and the GM ledger - but a future refactor could plausibly build a
      // Report by spreading a delta. The field-by-field copy must hold.
      const pollutedReport = {
        ...makeReport({ claim: 'The Emperor has secretly fled Rome' }),
        ...POLLUTION,
      } as unknown as Report;

      // Non-vacuous by construction: every forbidden key is actually
      // present on the fixture before ingestion.
      const pollutedSerialized = JSON.stringify(pollutedReport);
      for (const key of FORBIDDEN_KEYS) {
        expect(pollutedSerialized).toContain(asJsonKey(key));
      }

      const store = ingestReports([], [pollutedReport]);
      const serialized = JSON.stringify(store);

      for (const key of FORBIDDEN_KEYS) {
        expect(serialized).not.toContain(asJsonKey(key));
      }
      // The player-visible half of the lie is stored intact - the store
      // records what the player BELIEVES, truth flags stay in the ledger.
      expect(store[0].claim).toBe('The Emperor has secretly fled Rome');
      expect(store[0].updates[0].credibility).toBe(0.6);
    });

    it('digest and investigation ingestion are equally clean end to end, without tripping on prose that merely contains a forbidden word', () => {
      const pollutedChange = {
        // The stored TEXT legitimately contains the word "assumed" - only
        // the serialized KEY may never appear.
        ...makeChange({ text: 'He assumed command of the garrison.' }),
        ...POLLUTION,
      } as unknown as PerceivedChange;

      const pollutedSerialized = JSON.stringify(pollutedChange);
      for (const key of FORBIDDEN_KEYS) {
        expect(pollutedSerialized).toContain(asJsonKey(key));
      }

      let store = ingestPerceivedChanges([], [pollutedChange], 2);
      store = ingestInvestigationReveal(store, {
        targetId: 'maximinus_thrax',
        kind: 'secrets',
        text: 'He hides a pact.',
        turn: 3,
      });

      const serialized = JSON.stringify(store);
      for (const key of FORBIDDEN_KEYS) {
        expect(serialized).not.toContain(asJsonKey(key));
      }
      // The prose itself is stored untouched.
      expect(store[0].claim).toBe('He assumed command of the garrison.');
    });
  });
});
