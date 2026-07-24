import { describe, expect, it } from 'vitest';
import {
  addMessageOrOrderRow,
  addActionRow,
  appendSuggestedAction,
  canonicalArtifactStatus,
  emptyStructuredDraft,
  selectMessageRecipient,
  updateActionRow,
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
            'julia_domna',
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
});
