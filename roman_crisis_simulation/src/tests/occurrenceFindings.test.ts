/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  KnowledgeClaim, OCCURRENCE_QUESTIONS, ingestOccurrenceFinding, occurrenceFindings, deriveDossier,
  examinedOccurrences, occurrenceClaimKey, occurrenceSiblingInStore,
} from '../knowledge/store';
import { loadGame, saveGame } from '../persistence/saveGame';
import { makeAppSave } from './factories';

const OCCURRENCE = 'The grain fleet is late again.';

describe('occurrence findings (audit item 40 — an AI call the player waited on must not evaporate)', () => {
  it('holds nothing until a question is asked', () => {
    expect(occurrenceFindings([], OCCURRENCE)).toEqual([]);
  });

  it('persists one finding against its own question', () => {
    const store = ingestOccurrenceFinding([], {
      occurrence: OCCURRENCE, question: 'who_gains', text: 'The Suburra grain factors.', turn: 6,
    });
    expect(occurrenceFindings(store, OCCURRENCE)).toEqual([
      { question: 'who_gains', text: 'The Suburra grain factors.', turn: 6 },
    ]);
  });

  it('keeps the three questions apart on one occurrence', () => {
    let store: KnowledgeClaim[] = [];
    for (const question of OCCURRENCE_QUESTIONS) {
      store = ingestOccurrenceFinding(store, { occurrence: OCCURRENCE, question, text: `Answer to ${question}.`, turn: 6 });
    }
    const findings = occurrenceFindings(store, OCCURRENCE);
    expect(findings.map(finding => finding.question)).toEqual([...OCCURRENCE_QUESTIONS]);
  });

  it('keeps two occurrences apart', () => {
    let store = ingestOccurrenceFinding([], { occurrence: OCCURRENCE, question: 'who_gains', text: 'A.', turn: 6 });
    store = ingestOccurrenceFinding(store, { occurrence: 'The Praetorians drill by night.', question: 'who_gains', text: 'B.', turn: 6 });
    expect(occurrenceFindings(store, OCCURRENCE).map(f => f.text)).toEqual(['A.']);
    expect(occurrenceFindings(store, 'The Praetorians drill by night.').map(f => f.text)).toEqual(['B.']);
  });

  it('freezes the week the finding was first learned across a re-ask', () => {
    let store = ingestOccurrenceFinding([], { occurrence: OCCURRENCE, question: 'what_follows', text: 'Bread riots.', turn: 4 });
    store = ingestOccurrenceFinding(store, { occurrence: OCCURRENCE, question: 'what_follows', text: 'Bread riots, and worse.', turn: 9 });
    const [finding] = occurrenceFindings(store, OCCURRENCE);
    expect(finding.turn).toBe(4);
    expect(finding.text).toBe('Bread riots, and worse.');
  });

  // An occurrence is a public event, not a person: it must not appear as an
  // aspect of anybody's dossier.
  it('never enters a subject dossier', () => {
    const store = ingestOccurrenceFinding([], { occurrence: OCCURRENCE, question: 'who_gains', text: 'Factors.', turn: 6 });
    expect(deriveDossier(store, 'world').entries).toEqual([]);
  });
});

describe('occurrence claim keys cannot merge two occurrences', () => {
  // Two headlines whose slugs agree for the whole 60 characters kept.
  const FLEET_OSTIA = 'The grain fleet from Alexandria is three weeks overdue at the port of Ostia, and the Senate is told';
  const FLEET_PUTEOLI = 'The grain fleet from Alexandria is three weeks overdue at the port of Puteoli instead';

  it('keeps headlines that share their first 60 characters apart', () => {
    expect(FLEET_OSTIA.slice(0, 60)).toBe(FLEET_PUTEOLI.slice(0, 60));
    expect(occurrenceClaimKey(FLEET_OSTIA, 'who_gains')).not.toBe(occurrenceClaimKey(FLEET_PUTEOLI, 'who_gains'));
    let store = ingestOccurrenceFinding([], { occurrence: FLEET_OSTIA, question: 'who_gains', text: 'The Ostian factors.', turn: 3, cameBackEmpty: false });
    store = ingestOccurrenceFinding(store, { occurrence: FLEET_PUTEOLI, question: 'who_gains', text: 'No one you can name.', turn: 3, cameBackEmpty: true });
    expect(store).toHaveLength(2);
    expect(occurrenceFindings(store, FLEET_OSTIA).map(f => f.text)).toEqual(['The Ostian factors.']);
    expect(occurrenceFindings(store, FLEET_PUTEOLI).map(f => f.text)).toEqual(['No one you can name.']);
    // The other question on each reads its own sibling, not its neighbour's.
    expect(occurrenceSiblingInStore(store, FLEET_OSTIA, 'who_is_behind_it')).toBe('named');
    expect(occurrenceSiblingInStore(store, FLEET_PUTEOLI, 'who_is_behind_it')).toBe('empty');
    expect(examinedOccurrences(store).sort()).toEqual([FLEET_OSTIA, FLEET_PUTEOLI].sort());
  });

  it('keeps headlines of nothing but punctuation apart, and keys them readably all the same', () => {
    const key = occurrenceClaimKey('?!?', 'who_gains');
    expect(key).toMatch(/^investigation:occurrence:-[0-9a-z]+:who_gains$/);
    expect(key).not.toBe(occurrenceClaimKey('…', 'who_gains'));
    let store = ingestOccurrenceFinding([], { occurrence: '?!?', question: 'what_follows', text: 'Confusion.', turn: 2 });
    store = ingestOccurrenceFinding(store, { occurrence: '…', question: 'what_follows', text: 'Silence.', turn: 2 });
    expect(occurrenceFindings(store, '?!?').map(f => f.text)).toEqual(['Confusion.']);
    expect(occurrenceFindings(store, '…').map(f => f.text)).toEqual(['Silence.']);
    // The readable slug still leads an ordinary key, and the same headline keeps its key.
    expect(occurrenceClaimKey(OCCURRENCE, 'who_gains')).toMatch(/^investigation:occurrence:the_grain_fleet_is_late_again-[0-9a-z]+:who_gains$/);
    expect(occurrenceClaimKey(` ${OCCURRENCE} `, 'who_gains')).toBe(occurrenceClaimKey(OCCURRENCE, 'who_gains'));
  });

  it('still reads a save made before the hash: its slug-keyed findings, its siblings, and its ledger links', () => {
    // As an older save holds them: slug-only keys - one finding with its
    // headline frozen beside it, one from before the headline was kept -
    // and a ledger entry whose reportId names its finding's key.
    const legacyKey = (question: string) => `investigation:occurrence:the_grain_fleet_is_late_again:${question}`;
    const older: KnowledgeClaim[] = [
      {
        id: 'claim_4_legacy_behind', subject: 'world', claim: 'The factors of the Suburra.', topic: 'occurrence',
        claimKey: legacyKey('who_is_behind_it'), firstLearnedTurn: 4,
        updates: [{ turn: 4, source: 'spy', text: 'The factors of the Suburra.' }],
        occurrence: OCCURRENCE, cameBackEmpty: false,
      },
      {
        id: 'claim_3_legacy_follows', subject: 'world', claim: 'Bread riots.', topic: 'occurrence',
        claimKey: legacyKey('what_follows'), firstLearnedTurn: 3,
        updates: [{ turn: 3, source: 'spy', text: 'Bread riots.' }],
      },
    ];
    const ledgerEntry = { id: 'truth_4_occurrence_1_who_is_behind_it', turn: 4, claim: 'The factors of the Suburra.', aboutId: 'world', isTrue: true, reportId: legacyKey('who_is_behind_it') };
    saveGame(makeAppSave({ knowledge: older, truthLedger: [ledgerEntry] }));
    const loaded = loadGame()!.state;
    const store = loaded.knowledge ?? [];

    expect(occurrenceFindings(store, OCCURRENCE)).toEqual([
      { question: 'who_is_behind_it', text: 'The factors of the Suburra.', turn: 4 },
      { question: 'what_follows', text: 'Bread riots.', turn: 3 },
    ]);
    expect(occurrenceSiblingInStore(store, OCCURRENCE, 'who_gains')).toBe('named');
    expect(examinedOccurrences(store, [OCCURRENCE])).toEqual([OCCURRENCE]);
    // The ledger still names the claim its finding is filed under.
    expect(store.map(claim => claim.claimKey)).toContain(loaded.truthLedger![0].reportId);
    // A headline that only slugs like the older one does not inherit the
    // finding whose frozen headline is another.
    const lookalike = 'The grain fleet is late, again!';
    expect(occurrenceFindings(store, lookalike).map(f => f.question)).toEqual(['what_follows']);
    expect(occurrenceSiblingInStore(store, lookalike, 'who_gains')).toBeNull();

    // A new question on the old occurrence lands under the new key, beside the old ones.
    const next = ingestOccurrenceFinding(store, { occurrence: OCCURRENCE, question: 'who_gains', text: 'The Prefect of the Grain.', turn: 6, cameBackEmpty: false });
    expect(next.find(claim => claim.claimKey === occurrenceClaimKey(OCCURRENCE, 'who_gains'))).toBeDefined();
    expect(occurrenceFindings(next, OCCURRENCE).map(f => f.question)).toEqual(['who_gains', 'who_is_behind_it', 'what_follows']);
  });
});
