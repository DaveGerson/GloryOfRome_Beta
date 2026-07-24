import { describe, expect, it } from 'vitest';
import {
  addMessageOrOrderRow,
  appendSuggestedAction,
  emptyStructuredDraft,
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
});
