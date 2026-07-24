import { describe, expect, it } from 'vitest';
import { TURN_SUBMISSION_VERSION } from '../types';
import type {
  KnownRecipientOption,
  StructuredTurnDraft,
  TurnSubmission,
} from '../types';
import {
  MAX_TURN_SUBMISSION_CHARACTERS,
  TURN_SUBMISSION_PREFIX,
  deserializeTurnSubmission,
  isReservedTurnSubmissionArtifact,
  normalizeTurnSubmissionInput,
  projectForAdjudication,
  projectForExternalInference,
  projectForPlayerHistory,
  projectForPlayerOwnedAi,
  projectForResolution,
  serializeTurnSubmission,
  validateAndNormalizeTurnSubmission,
  canonicalArtifactForTurnSubmission,
  deepFreezeTurnSubmission,
} from '../playerInput/turnSubmission';

const KNOWN_RECIPIENTS: readonly KnownRecipientOption[] = [
  { entityId: 'lucius', displayName: 'Lucius' },
  { entityId: 'praetorians', displayName: 'Praetorian Guard' },
];

const context = { knownRecipients: KNOWN_RECIPIENTS };

function expectValid(
  result: ReturnType<typeof validateAndNormalizeTurnSubmission>,
): TurnSubmission {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a valid submission, got ${JSON.stringify(result.issues)}`);
  }
  return result.submission;
}

describe('canonical turn-submission constants', () => {
  it('pins the versioned envelope prefix and the complete-artifact character limit', () => {
    expect(TURN_SUBMISSION_VERSION).toBe(1);
    expect(TURN_SUBMISSION_PREFIX).toBe('GOR_TURN_SUBMISSION/1\n');
    expect(MAX_TURN_SUBMISSION_CHARACTERS).toBe(20_000);
  });
});

describe('serialization-owned artifact classification and input normalization', () => {
  it('classifies every reserved namespace artifact, including malformed and future variants, without classifying ordinary legacy text', () => {
    expect(isReservedTurnSubmissionArtifact('GOR_TURN_SUBMISSION/999\nmalformed')).toBe(true);
    expect(isReservedTurnSubmissionArtifact('  GOR_TURN_SUBMISSION/not-json')).toBe(true);
    expect(isReservedTurnSubmissionArtifact('ordinary legacy action')).toBe(false);
  });

  it('normalizes legacy strings and typed submissions through the same canonical boundary', () => {
    const structured: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['  Address the Senate  '],
    };

    expect(normalizeTurnSubmissionInput('  ordinary legacy action  ')).toEqual({
      version: 1,
      kind: 'freeform',
      text: 'ordinary legacy action',
    });
    expect(normalizeTurnSubmissionInput(structured)).toEqual({
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate'],
    });
  });

  it('preserves identity only for an object already in its exact canonical form', () => {
    const canonical: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate'],
      questionOrContext: 'What can I see from the forum?',
    };

    expect(normalizeTurnSubmissionInput(canonical)).toBe(canonical);
  });

  it('still copies and normalizes a valid typed object that is not canonical', () => {
    const dirty: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['  Address the Senate  '],
    };

    const normalized = normalizeTurnSubmissionInput(dirty);
    expect(normalized).not.toBe(dirty);
    expect(normalized).toEqual({ version: 1, kind: 'structured', actions: ['Address the Senate'] });
  });
});

describe('deepFreezeTurnSubmission', () => {
  it('freezes a canonical structured submission through arrays, rows, and recipients', () => {
    const frozen = deepFreezeTurnSubmission(expectValid(validateAndNormalizeTurnSubmission({
      actions: ['  Address the Senate  '],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'lucius' }, command: '  Meet at dusk  ' }],
      privateIntent: '',
      questionOrContext: '',
    }, context)));
    expect(Object.isFrozen(frozen)).toBe(true);
    if (frozen.kind !== 'structured') throw new Error('Expected structured submission');
    expect(Object.isFrozen(frozen.actions)).toBe(true);
    expect(Object.isFrozen(frozen.messagesOrOrders)).toBe(true);
    expect(Object.isFrozen(frozen.messagesOrOrders![0])).toBe(true);
    expect(Object.isFrozen(frozen.messagesOrOrders![0].recipient)).toBe(true);
    expect(() => { (frozen.actions as string[]).push('mutated'); }).toThrow();
    expect(() => { (frozen.messagesOrOrders![0].recipient as { entityId: string }).entityId = 'poisoned'; }).toThrow();
  });
});

describe('validateAndNormalizeTurnSubmission', () => {
  it('keeps preview and submission normalization in parity for every input family except limit enforcement', () => {
    const context = { knownRecipients: [{ entityId: 'julia_domna', displayName: 'Julia Domna' }] };
    const inputs: Array<TurnSubmission | StructuredTurnDraft> = [
      { version: 1 as const, kind: 'freeform' as const, text: ' Speak plainly ' },
      { actions: ['Address the Senate'], messagesOrOrders: [], privateIntent: '', questionOrContext: '' },
      { actions: [], messagesOrOrders: [], privateIntent: '', questionOrContext: '' },
      { actions: [], messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'stale' }, command: 'Wait.' }], privateIntent: '', questionOrContext: '' },
      { version: 1 as const, kind: 'freeform' as const, text: 'GOR_TURN_SUBMISSION/1\nnot JSON' },
      { version: 1 as const, kind: 'freeform' as const, text: 'x'.repeat(20_001) },
    ];
    for (const input of inputs) {
      const preview = canonicalArtifactForTurnSubmission(input, context);
      const submitted = validateAndNormalizeTurnSubmission(input, context);
      if (preview.ok && preview.artifact.length <= MAX_TURN_SUBMISSION_CHARACTERS) {
        expect(submitted).toEqual({ ok: true, submission: preview.submission });
      } else if (preview.ok) {
        expect(submitted).toMatchObject({ ok: false, issues: [{ field: 'submission' }] });
      } else {
        expect(submitted).toEqual({ ok: false, issues: preview.issues });
      }
    }
  });
  it('normalizes repeatable actions and both recipient variants while preserving internal authored whitespace', () => {
    const draft: StructuredTurnDraft = {
      actions: [
        '  Attend the Senate\n  and watch the benches  ',
        '   ',
        '  Address  the crowd  ',
      ],
      messagesOrOrders: [
        {
          recipient: { kind: 'known_entity', entityId: 'lucius' },
          command: '  Meet me at dusk\nBring the sealed ledger.  ',
        },
        { recipient: null, command: '   ' },
        {
          recipient: { kind: 'free_text', text: '  the night watch  ' },
          command: '  Hold  the eastern gate  ',
        },
      ],
      privateIntent: '  Appear loyal\n  while testing Lucius  ',
      questionOrContext: '  What can I infer\nfrom the empty benches?  ',
    };

    expect(expectValid(validateAndNormalizeTurnSubmission(draft, context))).toEqual({
      version: 1,
      kind: 'structured',
      actions: [
        'Attend the Senate\n  and watch the benches',
        'Address  the crowd',
      ],
      messagesOrOrders: [
        {
          recipient: {
            kind: 'known_entity',
            entityId: 'lucius',
            displayName: 'Lucius',
          },
          command: 'Meet me at dusk\nBring the sealed ledger.',
        },
        {
          recipient: { kind: 'free_text', text: 'the night watch' },
          command: 'Hold  the eastern gate',
        },
      ],
      privateIntent: 'Appear loyal\n  while testing Lucius',
      questionOrContext: 'What can I infer\nfrom the empty benches?',
    });
  });

  it('omits blank optional sections instead of persisting empty arrays or strings', () => {
    const submission = expectValid(
      validateAndNormalizeTurnSubmission(
        {
          actions: ['  Convene the Senate  ', '   '],
          messagesOrOrders: [{ recipient: null, command: '   ' }],
          privateIntent: '   ',
          questionOrContext: '\n\t',
        },
        context,
      ),
    );

    expect(submission).toEqual({
      version: 1,
      kind: 'structured',
      actions: ['Convene the Senate'],
    });
    expect(submission).not.toHaveProperty('messagesOrOrders');
    expect(submission).not.toHaveProperty('privateIntent');
    expect(submission).not.toHaveProperty('questionOrContext');
  });

  it.each([
    {
      label: 'recipient without command',
      row: {
        recipient: { kind: 'known_entity' as const, entityId: 'lucius' },
        command: '   ',
      },
    },
    {
      label: 'command without recipient',
      row: { recipient: null, command: 'Deliver the warning' },
    },
    {
      label: 'blank custom recipient with command',
      row: {
        recipient: { kind: 'free_text' as const, text: '   ' },
        command: 'Deliver the warning',
      },
    },
  ])('rejects a half-complete message/order row: $label', ({ row }) => {
    const draft: StructuredTurnDraft = {
      actions: [],
      messagesOrOrders: [row],
      privateIntent: '',
      questionOrContext: '',
    };

    expect(validateAndNormalizeTurnSubmission(draft, context).ok).toBe(false);
  });

  it('associates half-complete message/order validation with the missing or invalid field', () => {
    const staleRecipient = validateAndNormalizeTurnSubmission({
      actions: [],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'stale' }, command: 'Wait.' }],
      privateIntent: '',
      questionOrContext: '',
    }, context);
    const blankCommand = validateAndNormalizeTurnSubmission({
      actions: [],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'lucius' }, command: '   ' }],
      privateIntent: '',
      questionOrContext: '',
    }, context);
    const malformedCommand = validateAndNormalizeTurnSubmission({
      actions: [],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'lucius' }, command: 7 }],
      privateIntent: '',
      questionOrContext: '',
    } as unknown as StructuredTurnDraft, context);

    expect(staleRecipient).toMatchObject({
      ok: false,
      issues: [{ field: 'messagesOrOrders.0.recipient', message: 'Selected recipient is unavailable.' }],
    });
    expect(blankCommand).toMatchObject({
      ok: false,
      issues: [{ field: 'messagesOrOrders.0.command', message: 'Recipient and command are both required.' }],
    });
    expect(malformedCommand).toMatchObject({
      ok: false,
      issues: [{ field: 'messagesOrOrders.0.command', message: 'Message or order is malformed.' }],
    });
  });

  it('rejects a structured artifact whose every field and row is blank', () => {
    const draft: StructuredTurnDraft = {
      actions: ['  ', '\n'],
      messagesOrOrders: [{ recipient: null, command: '  ' }],
      privateIntent: '\t',
      questionOrContext: ' ',
    };

    expect(validateAndNormalizeTurnSubmission(draft, context).ok).toBe(false);
  });

  it('rejects blank freeform artifacts and trims only their surrounding whitespace', () => {
    expect(
      validateAndNormalizeTurnSubmission(
        { version: 1, kind: 'freeform', text: ' \n\t ' },
        context,
      ).ok,
    ).toBe(false);

    expect(
      expectValid(
        validateAndNormalizeTurnSubmission(
          { version: 1, kind: 'freeform', text: '  First line\n  second line  ' },
          context,
        ),
      ),
    ).toEqual({
      version: 1,
      kind: 'freeform',
      text: 'First line\n  second line',
    });
  });

  it('takes the canonical known-recipient name from the supplied safe option, not submitted text', () => {
    const tampered: TurnSubmission = {
      version: 1,
      kind: 'structured',
      messagesOrOrders: [
        {
          recipient: {
            kind: 'known_entity',
            entityId: 'lucius',
            displayName: 'TAMPERED HIDDEN NAME',
          },
          command: 'Meet me at dusk',
        },
      ],
    };

    expect(expectValid(validateAndNormalizeTurnSubmission(tampered, context))).toEqual({
      version: 1,
      kind: 'structured',
      messagesOrOrders: [
        {
          recipient: {
            kind: 'known_entity',
            entityId: 'lucius',
            displayName: 'Lucius',
          },
          command: 'Meet me at dusk',
        },
      ],
    });
  });

  it('fails validation for a stale or tampered known-recipient ID', () => {
    const draft: StructuredTurnDraft = {
      actions: [],
      messagesOrOrders: [
        {
          recipient: { kind: 'known_entity', entityId: 'hidden_or_stale_actor' },
          command: 'Meet me at dusk',
        },
      ],
      privateIntent: '',
      questionOrContext: '',
    };

    expect(validateAndNormalizeTurnSubmission(draft, context).ok).toBe(false);
  });

  it('preserves an opaque safe-option ID exactly through validation and canonical round-trip', () => {
    const opaqueEntityId = ' lucius ';
    const draft: StructuredTurnDraft = {
      actions: [],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: opaqueEntityId },
        command: 'Meet me at dusk',
      }],
      privateIntent: '',
      questionOrContext: '',
    };
    const submission = expectValid(validateAndNormalizeTurnSubmission(draft, {
      knownRecipients: [{ entityId: opaqueEntityId, displayName: 'Lucius' }],
    }));

    expect(submission).toEqual({
      version: 1,
      kind: 'structured',
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: opaqueEntityId, displayName: 'Lucius' },
        command: 'Meet me at dusk',
      }],
    });
    expect(deserializeTurnSubmission(serializeTurnSubmission(submission))).toEqual(submission);
  });

  it('rejects an all-whitespace safe-option ID without throwing', () => {
    const whitespaceEntityId = ' \t ';
    const draft: StructuredTurnDraft = {
      actions: [],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: whitespaceEntityId },
        command: 'Meet me at dusk',
      }],
      privateIntent: '',
      questionOrContext: '',
    };

    expect(validateAndNormalizeTurnSubmission(draft, {
      knownRecipients: [{ entityId: whitespaceEntityId, displayName: 'Unknown' }],
    }).ok).toBe(false);
  });

  it('stores a nonempty Someone else recipient as trimmed free text without inventing an entity ID', () => {
    const submission = expectValid(
      validateAndNormalizeTurnSubmission(
        {
          actions: [],
          messagesOrOrders: [
            {
              recipient: { kind: 'free_text', text: '  the night watch  ' },
              command: '  Bar the eastern gate  ',
            },
          ],
          privateIntent: '',
          questionOrContext: '',
        },
        context,
      ),
    );

    expect(submission).toEqual({
      version: 1,
      kind: 'structured',
      messagesOrOrders: [
        {
          recipient: { kind: 'free_text', text: 'the night watch' },
          command: 'Bar the eastern gate',
        },
      ],
    });
    expect(JSON.stringify(submission)).not.toContain('entityId');
  });
});

describe('canonical serialization and compatibility', () => {
  it('serializes structured submissions as deterministic compact JSON and round-trips multiline text exactly', () => {
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['First line\n  indented second line', 'Speak  slowly'],
      messagesOrOrders: [
        {
          recipient: {
            kind: 'known_entity',
            entityId: 'lucius',
            displayName: 'Lucius',
          },
          command: 'Meet me at dusk\nBring the ledger.',
        },
        {
          recipient: { kind: 'free_text', text: 'the night watch' },
          command: 'Hold the gate',
        },
      ],
      privateIntent: 'Back Clodius\nonly if he commits first.',
      questionOrContext: 'What changed\nsince yesterday?',
    };

    const serialized = serializeTurnSubmission(submission);

    expect(serialized).toBe(TURN_SUBMISSION_PREFIX + JSON.stringify(submission));
    expect(serialized).not.toContain('\n  "version"');
    expect(deserializeTurnSubmission(serialized)).toEqual(submission);
  });

  it('canonicalizes shuffled top-level and nested keys before serializing and validating an envelope', () => {
    const canonical: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Attend the Senate'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
        command: 'Meet me at dusk',
      }],
      privateIntent: 'Watch the exits',
    };
    const shuffled = {
      privateIntent: 'Watch the exits',
      messagesOrOrders: [{
        command: 'Meet me at dusk',
        recipient: { displayName: 'Lucius', entityId: 'lucius', kind: 'known_entity' },
      }],
      actions: ['Attend the Senate'],
      kind: 'structured',
      version: 1,
    } as TurnSubmission;

    const canonicalSerialized = serializeTurnSubmission(canonical);
    const shuffledSerialized = serializeTurnSubmission(shuffled);

    expect(shuffledSerialized).toBe(canonicalSerialized);
    expect(deserializeTurnSubmission(shuffledSerialized)).toEqual(canonical);
  });

  it('keeps ordinary legacy freeform as raw text and parses it without changing multiline content', () => {
    const text = 'Address the Senate.\n\nThen wait  for Lucius.';
    const submission: TurnSubmission = { version: 1, kind: 'freeform', text };

    expect(serializeTurnSubmission(submission)).toBe(text);
    expect(deserializeTurnSubmission(text)).toEqual(submission);
  });

  it('envelopes freeform beginning with the reserved prefix so it cannot be misread as canonical JSON', () => {
    const text = `${TURN_SUBMISSION_PREFIX}{this is authored freeform, not JSON}`;
    const submission: TurnSubmission = { version: 1, kind: 'freeform', text };

    const serialized = serializeTurnSubmission(submission);

    expect(serialized).toBe(TURN_SUBMISSION_PREFIX + JSON.stringify(submission));
    expect(serialized).not.toBe(text);
    expect(deserializeTurnSubmission(serialized)).toEqual(submission);
  });

  it('reserves every versioned submission namespace and keeps authored future-version text private', () => {
    const text = 'GOR_TURN_SUBMISSION/2\n{"version":2,"kind":"structured","privateIntent":"PRIVATE_SENTINEL_V2"}';
    const submission: TurnSubmission = { version: 1, kind: 'freeform', text };

    const serialized = serializeTurnSubmission(submission);

    expect(serialized).toBe(TURN_SUBMISSION_PREFIX + JSON.stringify(submission));
    expect(deserializeTurnSubmission(serialized)).toEqual(submission);
    expect(deserializeTurnSubmission(text)).toBeNull();
  });

  it('serializes typed structured input through canonical content normalization before round-tripping', () => {
    const typedInput: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['  Attend the Senate  ', '   '],
      messagesOrOrders: [
        {
          recipient: { kind: 'known_entity', entityId: 'lucius', displayName: '  Lucius  ' },
          command: '  Meet me at dusk\nBring the ledger.  ',
        },
        {
          recipient: { kind: 'free_text', text: '  the night watch  ' },
          command: '  Hold  the eastern gate  ',
        },
      ],
      privateIntent: '   ',
      questionOrContext: '\n\t',
    };
    const canonical: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Attend the Senate'],
      messagesOrOrders: [
        {
          recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
          command: 'Meet me at dusk\nBring the ledger.',
        },
        {
          recipient: { kind: 'free_text', text: 'the night watch' },
          command: 'Hold  the eastern gate',
        },
      ],
    };

    const serialized = serializeTurnSubmission(typedInput);

    expect(serialized).toBe(TURN_SUBMISSION_PREFIX + JSON.stringify(canonical));
    expect(deserializeTurnSubmission(serialized)).toEqual(canonical);
  });

  it.each([
    {
      label: 'an unsupported version',
      value: { version: 2, kind: 'freeform', text: 'Attend the Senate' },
    },
    {
      label: 'an unknown kind',
      value: { version: 1, kind: 'unknown', text: 'Attend the Senate' },
    },
    {
      label: 'a malformed structured row',
      value: {
        version: 1,
        kind: 'structured',
        actions: ['Attend the Senate'],
        messagesOrOrders: [{ recipient: null, command: 'Meet me at dusk' }],
      },
    },
    {
      label: 'a blank artifact',
      value: { version: 1, kind: 'structured', actions: ['   '] },
    },
    {
      label: 'an oversized artifact',
      value: {
        version: 1,
        kind: 'freeform',
        text: 'x'.repeat(MAX_TURN_SUBMISSION_CHARACTERS + 1),
      },
    },
  ])('fails loudly instead of serializing $label into unreadable bytes', ({ value }) => {
    expect(() => serializeTurnSubmission(value as unknown as TurnSubmission)).toThrow();
  });

  it.each([
    'GOR_TURN_SUBMISSION/1\n',
    'GOR_TURN_SUBMISSION/1\n{',
    'GOR_TURN_SUBMISSION/1\n"just a JSON string"',
    'GOR_TURN_SUBMISSION/1\n{"version":2,"kind":"freeform","text":"attack"}',
    'GOR_TURN_SUBMISSION/1\n{"version":1,"kind":"unknown","text":"attack"}',
  ])('fails closed for malformed or unsupported canonical text: %j', (text) => {
    expect(deserializeTurnSubmission(text)).toBeNull();
  });

  it('rejects a blank legacy artifact instead of creating an empty freeform submission', () => {
    expect(deserializeTurnSubmission(' \n\t ')).toBeNull();
  });
});

describe('the 20,000-character canonical boundary', () => {
  it('accepts exactly 20,000 freeform characters, rejects 20,001, and never truncates', () => {
    const atLimit = 'x'.repeat(MAX_TURN_SUBMISSION_CHARACTERS);
    const accepted = expectValid(
      validateAndNormalizeTurnSubmission(
        { version: 1, kind: 'freeform', text: atLimit },
        context,
      ),
    );

    expect(serializeTurnSubmission(accepted)).toBe(atLimit);
    expect(serializeTurnSubmission(accepted)).toHaveLength(20_000);
    expect(
      validateAndNormalizeTurnSubmission(
        { version: 1, kind: 'freeform', text: `${atLimit}x` },
        context,
      ).ok,
    ).toBe(false);
  });

  it('applies the legacy plaintext cap after trimming surrounding padding', () => {
    const atLimit = 'x'.repeat(MAX_TURN_SUBMISSION_CHARACTERS);
    const overLimit = `${atLimit}x`;

    expect(deserializeTurnSubmission(` \n${atLimit}\t `)).toEqual({
      version: 1,
      kind: 'freeform',
      text: atLimit,
    });
    expect(deserializeTurnSubmission(` \n${overLimit}\t `)).toBeNull();
  });

  it('counts the complete structured envelope and accepts exactly 20,000 but rejects 20,001', () => {
    const base: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: [''],
    };
    const actionLength =
      MAX_TURN_SUBMISSION_CHARACTERS -
      TURN_SUBMISSION_PREFIX.length -
      JSON.stringify(base).length;
    const atLimit: TurnSubmission = {
      ...base,
      actions: ['x'.repeat(actionLength)],
    };
    const overLimit: TurnSubmission = {
      ...base,
      actions: ['x'.repeat(actionLength + 1)],
    };

    const accepted = expectValid(validateAndNormalizeTurnSubmission(atLimit, context));
    expect(serializeTurnSubmission(accepted)).toHaveLength(20_000);
    expect(serializeTurnSubmission(accepted)).toBe(
      TURN_SUBMISSION_PREFIX + JSON.stringify(atLimit),
    );
    expect(validateAndNormalizeTurnSubmission(overLimit, context).ok).toBe(false);
  });
});

describe('runtime input discrimination', () => {
  it.each([
    {
      label: 'an unsupported structured version',
      value: { version: 2, kind: 'structured', actions: ['Attend the Senate'] },
    },
    {
      label: 'an unknown kind',
      value: { version: 1, kind: 'unrecognized', actions: ['Attend the Senate'] },
    },
    {
      label: 'a sparse draft with missing row collections',
      value: { actions: undefined, messagesOrOrders: undefined, privateIntent: 'A real private intent', questionOrContext: '' },
    },
    {
      label: 'a malformed draft row collection',
      value: { actions: ['Attend the Senate'], messagesOrOrders: [null], privateIntent: '', questionOrContext: '' },
    },
    {
      label: 'a malformed action collection',
      value: { actions: ['Attend the Senate', 7], messagesOrOrders: [], privateIntent: '', questionOrContext: '' },
    },
    {
      label: 'a malformed row command',
      value: {
        actions: ['Attend the Senate'],
        messagesOrOrders: [{ recipient: { kind: 'free_text', text: 'the night watch' }, command: 7 }],
        privateIntent: '',
        questionOrContext: '',
      },
    },
  ])('rejects $label without throwing or silently downgrading it', ({ value }) => {
    expect(() => validateAndNormalizeTurnSubmission(
      value as unknown as TurnSubmission | StructuredTurnDraft,
      context,
    )).not.toThrow();
    expect(validateAndNormalizeTurnSubmission(
      value as unknown as TurnSubmission | StructuredTurnDraft,
      context,
    ).ok).toBe(false);
  });
});

describe('consumer-specific audience projections', () => {
  const submission: TurnSubmission = {
    version: 1,
    kind: 'structured',
    actions: ['Attend the Senate'],
    messagesOrOrders: [
      {
        recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
        command: 'Meet me at dusk',
      },
      {
        recipient: { kind: 'free_text', text: 'the night watch' },
        command: 'Hold the eastern gate',
      },
    ],
    privateIntent: 'PRIVATE_SENTINEL_BACK_CLODIUS',
    questionOrContext: 'What can I infer from the empty benches?',
  };

  it.each([
    { consumer: 'resolution', project: projectForResolution },
    { consumer: 'external inference', project: projectForExternalInference },
  ])('keeps private intent out of $consumer projection', ({ project }) => {
    const projected = project(submission);

    expect(projected).toContain('Attend the Senate');
    expect(projected).toContain('To: Lucius [lucius]');
    expect(projected).toContain('To: the night watch');
    expect(projected).not.toContain('PRIVATE_SENTINEL');
    expect(projected).not.toContain('What can I infer');
  });

  it('gives player-owned AI the private intent and question alongside observable content', () => {
    const projected = projectForPlayerOwnedAi(submission);

    expect(projected).toContain('Attend the Senate');
    expect(projected).toContain('To: Lucius [lucius]');
    expect(projected).toContain('To: the night watch');
    expect(projected).toContain('PRIVATE_SENTINEL_BACK_CLODIUS');
    expect(projected).toContain('What can I infer from the empty benches?');
  });

  it('keeps adjudication channels separate instead of blending private material into the observable attempt', () => {
    const projected = projectForAdjudication(submission);

    expect(projected.observableAttempt).toContain('Attend the Senate');
    expect(projected.observableAttempt).toContain('To: Lucius [lucius]');
    expect(projected.observableAttempt).not.toContain('PRIVATE_SENTINEL');
    expect(projected.observableAttempt).not.toContain('What can I infer');
    expect(projected.privateIntent).toBe('PRIVATE_SENTINEL_BACK_CLODIUS');
    expect(projected.questionOrContext).toBe(
      'What can I infer from the empty benches?',
    );
  });

  it('renders a human recipient label in player history without exposing the implementation-only ID', () => {
    const history = JSON.stringify(projectForPlayerHistory(submission));

    expect(history).toContain('Lucius');
    expect(history).toContain('the night watch');
    expect(history).not.toContain('[lucius]');
    expect(history).not.toContain('"entityId":"lucius"');
  });

  it.each([
    {
      label: 'question-only',
      draft: {
        actions: [],
        messagesOrOrders: [],
        privateIntent: '',
        questionOrContext: 'What do the empty benches imply?',
      } satisfies StructuredTurnDraft,
    },
    {
      label: 'private-only',
      draft: {
        actions: [],
        messagesOrOrders: [],
        privateIntent: 'I want Lucius to underestimate me.',
        questionOrContext: '',
      } satisfies StructuredTurnDraft,
    },
  ])('$label artifacts are valid but have no observable or externally inferable attempt', ({ draft }) => {
    const normalized = expectValid(validateAndNormalizeTurnSubmission(draft, context));

    expect(projectForResolution(normalized)).toBeNull();
    expect(projectForExternalInference(normalized)).toBeNull();
  });
});
