import React from 'react';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import {
  addActionRow, addMessageOrOrderRow, customRecipientSelectValue, encodeKnownRecipientSelectValue,
  selectMessageRecipient, updateActionRow, updateCustomRecipient, updateMessageCommand,
  updatePrivateIntent, updateQuestionOrContext,
} from '../playerInput/composerState';

const CUSTOM_RECIPIENT_VALUE = customRecipientSelectValue();

interface StructuredTurnComposerProps {
  draft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  disabled: boolean;
  submissionBlocked?: boolean;
  validationIssues?: readonly { field: string; message: string }[];
  statusId?: string;
  onChange(draft: StructuredTurnDraft): void;
  onSubmit(): void;
}

export const StructuredTurnComposer: React.FC<StructuredTurnComposerProps> = ({
  draft, recipientOptions, disabled, submissionBlocked = false, validationIssues = [], statusId, onChange, onSubmit,
}) => {
  const hasIssue = (field: string) => validationIssues.some(issue =>
    issue.field === 'submission' || issue.field === field);
  const describeIssue = (field: string) => hasIssue(field)
    ? { 'aria-invalid': true, ...(statusId ? { 'aria-describedby': statusId } : {}) }
    : {};
  const submitOnShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <div>
      <section aria-labelledby="structured-actions">
        <h3 id="structured-actions">Actions</h3>
        {draft.actions.map((action, index) => (
          <textarea
            key={index}
            aria-label={`Action ${index + 1}`}
            value={action}
            disabled={disabled}
            {...describeIssue(`actions.${index}`)}
            onChange={event => onChange(updateActionRow(draft, index, event.target.value))}
            onKeyDown={submitOnShortcut}
          />
        ))}
        <button type="button" aria-label="Add action row" disabled={disabled}
          onClick={() => onChange(addActionRow(draft))}>
          +
        </button>
      </section>
      <section aria-labelledby="structured-messages">
        <h3 id="structured-messages">Messages / Orders</h3>
        {draft.messagesOrOrders.map((row, index) => {
          const recipientValue = row.recipient?.kind === 'known_entity'
            ? encodeKnownRecipientSelectValue(row.recipient.entityId)
            : row.recipient?.kind === 'free_text' ? customRecipientSelectValue() : '';
          return (
            <div key={index}>
              <select
                aria-label={`Recipient ${index + 1}`}
                value={recipientValue}
                disabled={disabled}
                {...describeIssue(`messagesOrOrders.${index}.recipient`)}
                onChange={event => {
                  const value = event.target.value;
                  onChange(selectMessageRecipient(draft, index, value));
                }}
              >
                <option value="">Select a recipient</option>
                {recipientOptions.map(option => <option key={option.entityId} value={encodeKnownRecipientSelectValue(option.entityId)}>{option.displayName}</option>)}
                <option value={CUSTOM_RECIPIENT_VALUE}>Someone else…</option>
              </select>
              {row.recipient?.kind === 'free_text' && (
                <input
                  aria-label={`Custom recipient ${index + 1}`}
                  value={row.recipient.text}
                  autoComplete="off"
                  disabled={disabled}
                  {...describeIssue(`messagesOrOrders.${index}.recipient`)}
                  onChange={event => onChange(updateCustomRecipient(draft, index, event.target.value))}
                  onKeyDown={submitOnShortcut}
                />
              )}
              <textarea
                aria-label={`Message or order ${index + 1}`}
                value={row.command}
                disabled={disabled}
                {...describeIssue(`messagesOrOrders.${index}.command`)}
                onChange={event => onChange(updateMessageCommand(draft, index, event.target.value))}
                onKeyDown={submitOnShortcut}
              />
            </div>
          );
        })}
        <button type="button" aria-label="Add message or order row" disabled={disabled}
          onClick={() => onChange(addMessageOrOrderRow(draft))}>
          +
        </button>
      </section>
      <section aria-labelledby="structured-intent">
        <h3 id="structured-intent">Private Intent</h3>
        <p>Private to your avatar; this expresses what you intend, not an action by itself.</p>
        <textarea aria-label="Private Intent" value={draft.privateIntent} disabled={disabled} {...describeIssue('privateIntent')}
          onChange={event => onChange(updatePrivateIntent(draft, event.target.value))} onKeyDown={submitOnShortcut} />
      </section>
      <section aria-labelledby="structured-context">
        <h3 id="structured-context">Question / Context</h3>
        <p>Your question or context does not cause autonomous action.</p>
        <textarea aria-label="Question / Context" value={draft.questionOrContext} disabled={disabled} {...describeIssue('questionOrContext')}
          onChange={event => onChange(updateQuestionOrContext(draft, event.target.value))} onKeyDown={submitOnShortcut} />
      </section>
      <button type="button" aria-label="Submit turn" disabled={disabled || submissionBlocked} onClick={onSubmit}>Submit turn</button>
    </div>
  );
};
