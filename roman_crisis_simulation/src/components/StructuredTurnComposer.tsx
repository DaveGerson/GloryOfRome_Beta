import React from 'react';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import {
  addActionRow, addMessageOrOrderRow, customRecipientSelectValue, encodeKnownRecipientSelectValue,
  selectMessageRecipient, updateActionRow, updateCustomRecipient, updateMessageCommand,
  updatePrivateIntent, updateQuestionOrContext,
} from '../playerInput/composerState';
import { Button } from './ui/Core';

const CUSTOM_RECIPIENT_VALUE = customRecipientSelectValue();

const sectionHeadingStyle: React.CSSProperties = { margin: 0 };
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const addRowStyle: React.CSSProperties = { alignSelf: 'flex-start' };

interface StructuredTurnComposerProps {
  draft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  disabled: boolean;
  submissionBlocked?: boolean;
  aggregateIssue?: boolean;
  validationIssues?: readonly { field: string; message: string }[];
  statusId?: string;
  onChange(draft: StructuredTurnDraft): void;
  onSubmit(): void;
}

export const StructuredTurnComposer: React.FC<StructuredTurnComposerProps> = ({
  draft, recipientOptions, disabled, submissionBlocked = false, aggregateIssue = false, validationIssues = [], statusId, onChange, onSubmit,
}) => {
  const hasIssue = (field: string) => validationIssues.some(issue =>
    issue.field === 'submission' || issue.field === field);
  const describeIssue = (field: string) => aggregateIssue || hasIssue(field)
    ? { 'aria-invalid': true, ...(statusId ? { 'aria-describedby': statusId } : {}) }
    : {};
  const submitOnShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-labelledby="structured-actions" style={fieldStyle}>
        <h3 id="structured-actions" className="gor-label" style={sectionHeadingStyle}>Actions</h3>
        {draft.actions.map((action, index) => (
          <textarea
            key={index}
            className="gor-textarea"
            rows={2}
            aria-label={`Action ${index + 1}`}
            value={action}
            disabled={disabled}
            {...describeIssue(`actions.${index}`)}
            onChange={event => onChange(updateActionRow(draft, index, event.target.value))}
            onKeyDown={submitOnShortcut}
          />
        ))}
        <span style={addRowStyle}>
          <Button type="button" variant="ghost" size="sm" aria-label="Add action row" disabled={disabled}
            onClick={() => onChange(addActionRow(draft))}>
            + Add action
          </Button>
        </span>
      </section>
      <section aria-labelledby="structured-messages" style={fieldStyle}>
        <h3 id="structured-messages" className="gor-label" style={sectionHeadingStyle}>Messages / Orders</h3>
        {draft.messagesOrOrders.map((row, index) => {
          const recipientValue = row.recipient?.kind === 'known_entity'
            ? encodeKnownRecipientSelectValue(row.recipient.entityId)
            : row.recipient?.kind === 'free_text' ? customRecipientSelectValue() : '';
          return (
            <div key={index} style={fieldStyle}>
              <select
                className="gor-select"
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
                  className="gor-input"
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
                className="gor-textarea"
                rows={2}
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
        <span style={addRowStyle}>
          <Button type="button" variant="ghost" size="sm" aria-label="Add message or order row" disabled={disabled}
            onClick={() => onChange(addMessageOrOrderRow(draft))}>
            + Add message or order
          </Button>
        </span>
      </section>
      <section aria-labelledby="structured-intent" style={fieldStyle}>
        <h3 id="structured-intent" className="gor-label" style={sectionHeadingStyle}>Private Intent</h3>
        <p className="gor-hint" style={{ margin: 0 }}>Private to your avatar; this expresses what you intend, not an action by itself.</p>
        <textarea className="gor-textarea" rows={2} aria-label="Private Intent" value={draft.privateIntent} disabled={disabled} {...describeIssue('privateIntent')}
          onChange={event => onChange(updatePrivateIntent(draft, event.target.value))} onKeyDown={submitOnShortcut} />
      </section>
      <section aria-labelledby="structured-context" style={fieldStyle}>
        <h3 id="structured-context" className="gor-label" style={sectionHeadingStyle}>Question / Context</h3>
        <p className="gor-hint" style={{ margin: 0 }}>Your question or context does not cause autonomous action.</p>
        <textarea className="gor-textarea" rows={2} aria-label="Question / Context" value={draft.questionOrContext} disabled={disabled} {...describeIssue('questionOrContext')}
          onChange={event => onChange(updateQuestionOrContext(draft, event.target.value))} onKeyDown={submitOnShortcut} />
      </section>
      <span style={addRowStyle}>
        <Button type="button" aria-label="Submit turn" disabled={disabled || submissionBlocked} onClick={onSubmit}>Submit turn</Button>
      </span>
    </div>
  );
};
