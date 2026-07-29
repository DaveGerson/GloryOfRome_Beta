import { describe, expect, it } from 'vitest';
import {
  KnowledgeClaim, OCCURRENCE_QUESTIONS, ingestOccurrenceFinding, occurrenceFindings, deriveDossier,
} from '../knowledge/store';

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
