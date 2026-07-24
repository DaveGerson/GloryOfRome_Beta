import type { MessageOrOrderDraft, StructuredTurnDraft } from '../types';

const blankMessageOrOrder = (): MessageOrOrderDraft => ({ recipient: null, command: '' });

export function emptyStructuredDraft(): StructuredTurnDraft {
  return {
    actions: [''],
    messagesOrOrders: [blankMessageOrOrder()],
    privateIntent: '',
    questionOrContext: '',
  };
}

export function appendSuggestedAction(
  draft: StructuredTurnDraft,
  action: string,
): StructuredTurnDraft {
  const actions = draft.actions.length === 1 && draft.actions[0] === ''
    ? [action]
    : [...draft.actions, action];
  return { ...draft, actions };
}

export function addMessageOrOrderRow(draft: StructuredTurnDraft): StructuredTurnDraft {
  return {
    ...draft,
    messagesOrOrders: [...draft.messagesOrOrders, blankMessageOrOrder()],
  };
}
