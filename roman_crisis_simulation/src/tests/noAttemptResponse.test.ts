import { describe, expect, it } from 'vitest';
import type { KnowledgeClaim, KnowledgeSource } from '../knowledge/store';
import {
  projectForNoAttemptResponse,
} from '../playerInput/turnSubmission';
import {
  buildNoAttemptEvidence,
  NO_ATTEMPT_NO_ANSWER,
  PRIVATE_INTENT_ACKNOWLEDGEMENT,
  renderNoAttemptResponse,
  validateNoAttemptSelection,
  type NoAttemptEvidence,
  type NoAttemptEvidenceSelection,
} from '../playerView/noAttemptResponse';
import type { TurnSubmission } from '../types';

const SOURCE_LABELS: Record<KnowledgeSource, string> = {
  self: 'From your own experience',
  witnessed: 'You witnessed',
  network: 'Via your network',
  public: 'Common knowledge',
  scout: 'From a scout',
  spy: 'From a spy',
  merchant: 'From a merchant',
  messenger: 'From a messenger',
  rumor: 'Rumor',
};

describe('projectForNoAttemptResponse', () => {
  it.each([
    {
      label: 'a question-only structured submission',
      submission: {
        version: 1,
        kind: 'structured',
        questionOrContext: 'What can I tell from the empty benches?',
      } satisfies TurnSubmission,
      expected: {
        kind: 'question',
        question: 'What can I tell from the empty benches?',
      },
    },
    {
      label: 'a private-intent-only structured submission',
      submission: {
        version: 1,
        kind: 'structured',
        privateIntent: 'PRIVATE_SENTINEL',
      } satisfies TurnSubmission,
      expected: { kind: 'private_intent' },
    },
    {
      label: 'a question plus private intent, with only the trimmed question projected',
      submission: {
        version: 1,
        kind: 'structured',
        privateIntent: 'PRIVATE_SENTINEL',
        questionOrContext: '  Who is watching?  ',
      } satisfies TurnSubmission,
      expected: { kind: 'question', question: 'Who is watching?' },
    },
  ])('classifies $label', ({ submission, expected }) => {
    expect(projectForNoAttemptResponse(submission)).toEqual(expected);
    expect(JSON.stringify(projectForNoAttemptResponse(submission))).not.toContain('PRIVATE_SENTINEL');
  });

  it.each([
    {
      label: 'an action-bearing structured submission',
      submission: {
        version: 1,
        kind: 'structured',
        actions: ['Attend the Senate'],
        privateIntent: 'PRIVATE_SENTINEL',
        questionOrContext: 'Who is watching?',
      } satisfies TurnSubmission,
    },
    {
      label: 'a message-bearing structured submission',
      submission: {
        version: 1,
        kind: 'structured',
        messagesOrOrders: [{
          recipient: { kind: 'free_text', text: 'the night watch' },
          command: 'Hold the eastern gate.',
        }],
        privateIntent: 'PRIVATE_SENTINEL',
        questionOrContext: 'Who is watching?',
      } satisfies TurnSubmission,
    },
    {
      label: 'a freeform submission',
      submission: {
        version: 1,
        kind: 'freeform',
        text: 'Who is watching?',
      } satisfies TurnSubmission,
    },
  ])('does not classify $label as no-attempt', ({ submission }) => {
    expect(projectForNoAttemptResponse(submission)).toBeNull();
  });
});

describe('buildNoAttemptEvidence', () => {
  it('orders newest updates first, preserves stable source order, deduplicates exact pairs, and copies only allowlisted fields', () => {
    const pollutedUpdate = {
      turn: 8,
      source: 'spy',
      text: 'A paid observer saw Lucius leave.',
      secret_truth: 'PRIVATE_SECRET_SENTINEL',
      gm_private: 'GM_PRIVATE_SENTINEL',
      roll: 20,
      tier: 'critical',
    } as KnowledgeClaim['updates'][number];
    const knowledge: KnowledgeClaim[] = [
      {
        id: 'claim-private-id-1',
        subject: 'lucius',
        claim: 'Frozen claim text is not evidence.',
        claimKey: 'digest:lucius:presence:network',
        firstLearnedTurn: 3,
        updates: [
          { turn: 3, source: 'network', text: 'Lucius left before the vote.' },
          { turn: 9, source: 'network', text: 'The west benches are empty.' },
          { turn: 9, source: 'witnessed', text: 'Marcellus entered alone.' },
          pollutedUpdate,
        ],
        edges: [{ to: 'hidden-claim-id', type: 'about' }],
      },
      {
        id: 'claim-private-id-2',
        subject: 'forum',
        claim: 'Another frozen claim text is not evidence.',
        claimKey: 'report:forum:attendance:public',
        firstLearnedTurn: 6,
        updates: [
          { turn: 9, source: 'public', text: 'The eastern doors remain open.' },
          { turn: 7, source: 'network', text: 'Lucius left before the vote.' },
          { turn: 6, source: 'public', text: 'The west benches are empty.' },
        ],
      },
    ];

    const evidence = buildNoAttemptEvidence(knowledge);

    expect(evidence).toEqual([
      { id: 'evidence-1', source: 'network', text: 'The west benches are empty.' },
      { id: 'evidence-2', source: 'witnessed', text: 'Marcellus entered alone.' },
      { id: 'evidence-3', source: 'public', text: 'The eastern doors remain open.' },
      { id: 'evidence-4', source: 'spy', text: 'A paid observer saw Lucius leave.' },
      { id: 'evidence-5', source: 'network', text: 'Lucius left before the vote.' },
      { id: 'evidence-6', source: 'public', text: 'The west benches are empty.' },
    ]);
    expect(Object.keys(evidence[3])).toEqual(['id', 'source', 'text']);
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE_SECRET_SENTINEL');
    expect(JSON.stringify(evidence)).not.toContain('GM_PRIVATE_SENTINEL');
    expect(JSON.stringify(evidence)).not.toContain('claim-private-id');
    expect(JSON.stringify(evidence)).not.toContain('hidden-claim-id');
  });

  it('keeps only the newest 60 updates and assigns local IDs after ordering', () => {
    const knowledge: KnowledgeClaim[] = [{
      id: 'bounded-claim',
      subject: 'rome',
      claim: 'Bounded history.',
      claimKey: 'report:rome:history:rumor',
      firstLearnedTurn: 1,
      updates: Array.from({ length: 65 }, (_, index) => ({
        turn: index + 1,
        source: 'rumor' as const,
        text: `Report ${index + 1}`,
      })),
    }];

    const evidence = buildNoAttemptEvidence(knowledge);

    expect(evidence).toHaveLength(60);
    expect(evidence.map(({ id }) => id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `evidence-${index + 1}`),
    );
    expect(evidence[0]).toEqual({ id: 'evidence-1', source: 'rumor', text: 'Report 65' });
    expect(evidence[59]).toEqual({ id: 'evidence-60', source: 'rumor', text: 'Report 6' });
    expect(evidence.map(({ text }) => text)).not.toContain('Report 5');
  });
});

describe('validateNoAttemptSelection', () => {
  const evidence: NoAttemptEvidence[] = Array.from({ length: 6 }, (_, index) => ({
    id: `evidence-${index + 1}`,
    source: index % 2 === 0 ? 'network' : 'public',
    text: `Observation ${index + 1}`,
  }));

  it('resolves one to five unique offered IDs to canonical evidence order', () => {
    const selection: NoAttemptEvidenceSelection = {
      decision: 'answer',
      evidenceIds: ['evidence-5', 'evidence-3', 'evidence-1', 'evidence-4', 'evidence-2'],
    };

    expect(validateNoAttemptSelection(selection, evidence)).toEqual({
      kind: 'answer',
      evidence: evidence.slice(0, 5),
    });
  });

  it.each([
    {
      label: 'an unknown ID',
      selection: { decision: 'answer', evidenceIds: ['evidence-unknown'] },
    },
    {
      label: 'a duplicate ID',
      selection: { decision: 'answer', evidenceIds: ['evidence-1', 'evidence-1'] },
    },
    {
      label: 'zero IDs for answer',
      selection: { decision: 'answer', evidenceIds: [] },
    },
    {
      label: 'more than five IDs',
      selection: {
        decision: 'answer',
        evidenceIds: [
          'evidence-1',
          'evidence-2',
          'evidence-3',
          'evidence-4',
          'evidence-5',
          'evidence-6',
        ],
      },
    },
    {
      label: 'nonempty IDs for no_answer',
      selection: { decision: 'no_answer', evidenceIds: ['evidence-1'] },
    },
  ] satisfies Array<{ label: string; selection: NoAttemptEvidenceSelection }>)('rejects $label', ({ selection }) => {
    expect(validateNoAttemptSelection(selection, evidence)).toEqual({
      kind: 'no_answer',
      reason: 'invalid_selection',
    });
  });

  it.each([
    { decision: 'ANSWER', evidenceIds: ['evidence-1'] },
    { decision: 'answer', evidenceIds: [1] },
    { decision: 'answer', evidenceIds: 'evidence-1' },
  ])('rejects malformed runtime values without coercion: %j', (selection) => {
    expect(validateNoAttemptSelection(
      selection as unknown as NoAttemptEvidenceSelection,
      evidence,
    )).toEqual({ kind: 'no_answer', reason: 'invalid_selection' });
  });

  it('returns no_evidence before attempting to interpret a selection', () => {
    expect(validateNoAttemptSelection({
      decision: 'answer',
      evidenceIds: ['evidence-unknown'],
    }, [])).toEqual({ kind: 'no_answer', reason: 'no_evidence' });
  });

  it('preserves an explicit valid provider no-answer decision', () => {
    expect(validateNoAttemptSelection({ decision: 'no_answer', evidenceIds: [] }, evidence)).toEqual({
      kind: 'no_answer',
      reason: 'model_no_answer',
    });
  });
});

describe('renderNoAttemptResponse', () => {
  it('renders selected canonical evidence with literal deterministic copy', () => {
    expect(renderNoAttemptResponse({
      kind: 'answer',
      evidence: [{
        id: 'evidence-1',
        source: 'network',
        text: 'Lucius left the forum before the vote.',
      }],
    })).toBe(
      'What you can currently tell:\n- Via your network: Lucius left the forum before the vote.',
    );
  });

  it.each(Object.entries(SOURCE_LABELS) as Array<[KnowledgeSource, string]>)
  ('renders the fixed label for %s evidence', (source, label) => {
    expect(renderNoAttemptResponse({
      kind: 'answer',
      evidence: [{ id: 'evidence-1', source, text: 'Observed.' }],
    })).toBe(`What you can currently tell:\n- ${label}: Observed.`);
  });

  it.each([
    'no_evidence',
    'model_no_answer',
    'invalid_selection',
    'selector_failure',
  ] as const)('renders the same fixed no-answer copy for %s', (reason) => {
    expect(renderNoAttemptResponse({ kind: 'no_answer', reason })).toBe(NO_ATTEMPT_NO_ANSWER);
    expect(renderNoAttemptResponse({ kind: 'no_answer', reason })).toBe(
      'Nothing in your current observations answers that yet.',
    );
  });

  it('exports the fixed private-intent acknowledgement without implying an action', () => {
    expect(PRIVATE_INTENT_ACKNOWLEDGEMENT).toBe(
      'Your private intent is noted. No action is taken on your behalf.',
    );
  });
});
