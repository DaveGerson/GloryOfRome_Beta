import { describe, expect, it } from 'vitest';
import {
  addMessageOrOrderRow,
  addActionRow,
  appendSuggestedAction,
  canonicalArtifactStatus,
  decodeRecipientSelectValue,
  encodeKnownRecipientSelectValue,
  emptyStructuredDraft,
  selectMessageRecipient,
  updateActionRow,
  updateCustomRecipient,
  updateMessageCommand,
  updatePrivateIntent,
  updateQuestionOrContext,
} from '../playerInput/composerState';

describe('playerInput/composerState', () => {
  it('starts with one blank action row and one unselected message-or-order row', () => {
    expect(emptyStructuredDraft()).toEqual({
      actions: [''],
      messagesOrOrders: [{ recipient: null, command: '' }],
      privateIntent: '',
      questionOrContext: '',
    });
  });

  it('appends suggested actions in order, replacing only the initial blank row', () => {
    const empty = emptyStructuredDraft();
    const withFirstPill = appendSuggestedAction(empty, 'Address the Senate');

    expect(withFirstPill.actions).toEqual(['Address the Senate']);
    expect(appendSuggestedAction(withFirstPill, 'Write to Lucius').actions)
      .toEqual(['Address the Senate', 'Write to Lucius']);
    expect(empty.actions).toEqual(['']);
  });

  it('adds a blank, unselected message-or-order row without mutating the source draft', () => {
    const empty = emptyStructuredDraft();
    const withAnotherRow = addMessageOrOrderRow(empty);

    expect(withAnotherRow.messagesOrOrders).toHaveLength(2);
    expect(withAnotherRow.messagesOrOrders[1]).toEqual({ recipient: null, command: '' });
    expect(empty.messagesOrOrders).toHaveLength(1);
  });

  it('keeps every structured editing transition pure, including clearing a recipient after a command', () => {
    const initial = emptyStructuredDraft();
    const edited = updateQuestionOrContext(
      updatePrivateIntent(
        updateMessageCommand(
          selectMessageRecipient(
            addActionRow(updateActionRow(initial, 0, 'Address the Senate')),
            0,
            encodeKnownRecipientSelectValue('julia_domna'),
          ),
          0,
          'Bring the ledger',
        ),
        'Learn who profits.',
      ),
      'What did the courier see?',
    );

    expect(edited).toEqual({
      actions: ['Address the Senate', ''],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'julia_domna' }, command: 'Bring the ledger' }],
      privateIntent: 'Learn who profits.',
      questionOrContext: 'What did the courier see?',
    });
    expect(selectMessageRecipient(edited, 0, '')).toEqual({
      ...edited,
      messagesOrOrders: [{ recipient: null, command: '' }],
    });
    expect(initial).toEqual(emptyStructuredDraft());
  });

  it('reports the normalized canonical artifact size, including trim and reserved-envelope expansion', () => {
    expect(canonicalArtifactStatus('  Speak softly  ', [])).toMatchObject({ ok: true, characterCount: 12 });
    expect(canonicalArtifactStatus('GOR_TURN_SUBMISSION/1\nnot JSON', [])).toMatchObject({
      ok: true,
      characterCount: expect.any(Number),
    });
    expect(canonicalArtifactStatus('GOR_TURN_SUBMISSION/1\nnot JSON', []).characterCount)
      .toBeGreaterThan('GOR_TURN_SUBMISSION/1\nnot JSON'.length);
  });

  it('reports capacity, exact excess, and validation reasons without discarding editable draft data', () => {
    expect(canonicalArtifactStatus('   ', [])).toMatchObject({
      ok: false,
      characterCount: null,
      remainingCharacters: null,
      issues: [{ field: 'text', message: 'Enter a turn submission.' }],
    });
    expect(canonicalArtifactStatus('x'.repeat(20_001), [])).toMatchObject({
      ok: true,
      characterCount: 20_001,
      overLimit: true,
      excessCharacters: 1,
    });
    const valid = canonicalArtifactStatus({
      ...emptyStructuredDraft(), actions: ['Address the Senate'],
    }, []);
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('Expected valid structured artifact.');
    expect(valid.remainingCharacters).toBe(20_000 - valid.characterCount);
    expect(canonicalArtifactStatus({
      ...emptyStructuredDraft(),
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'stale' }, command: 'Wait.' }],
    }, [])).toMatchObject({
      ok: false,
      issues: [{ field: 'messagesOrOrders.0.recipient', message: 'Selected recipient is unavailable.' }],
    });
  });

  it('round-trips a known recipient whose id collides with the former custom sentinel', () => {
    const encoded = encodeKnownRecipientSelectValue('__custom_recipient__');
    expect(encoded).not.toBe('__custom_recipient__');
    expect(decodeRecipientSelectValue(encoded)).toEqual({ kind: 'known', entityId: '__custom_recipient__' });
    expect(selectMessageRecipient(emptyStructuredDraft(), 0, encoded).messagesOrOrders[0].recipient)
      .toEqual({ kind: 'known_entity', entityId: '__custom_recipient__' });
  });

  it('updates only the requested custom-recipient row immutably and clears it when switching to known', () => {
    const initial = {
      ...emptyStructuredDraft(),
      messagesOrOrders: [
        { recipient: { kind: 'free_text' as const, text: 'First' }, command: 'One' },
        { recipient: { kind: 'free_text' as const, text: 'Second' }, command: 'Two' },
      ],
    };
    const updated = updateCustomRecipient(initial, 1, 'Changed');
    expect(updated).not.toBe(initial);
    expect(updated.messagesOrOrders).not.toBe(initial.messagesOrOrders);
    expect(updated.messagesOrOrders[0]).toBe(initial.messagesOrOrders[0]);
    expect(updated.messagesOrOrders[1]).toEqual({ recipient: { kind: 'free_text', text: 'Changed' }, command: 'Two' });
    const known = selectMessageRecipient(updated, 1, encodeKnownRecipientSelectValue('julia_domna'));
    expect(known.messagesOrOrders[1]).toEqual({
      recipient: { kind: 'known_entity', entityId: 'julia_domna' }, command: 'Two',
    });
    expect(JSON.stringify(known)).not.toContain('Changed');
  });
});
