import React from 'react';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import {
  addActionRow, addMessageOrOrderRow, customRecipientSelectValue, encodeKnownRecipientSelectValue,
  selectMessageRecipient, updateActionRow, updateCustomRecipient, updateMessageCommand,
  updatePrivateIntent, updateQuestionOrContext,
} from '../playerInput/composerState';
import { Button, RegisterHeading } from './ui/Core';
import { WaxSeal } from './ui/Brand';

const CUSTOM_RECIPIENT_VALUE = customRecipientSelectValue();

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const addRowStyle: React.CSSProperties = { alignSelf: 'flex-start' };

/**
 * The wax on a letter: a Tyrian seal carrying the recipient's initial once one
 * is chosen, and an unsealed dashed disc while the letter is still unaddressed.
 * Purely decorative — the recipient itself is chosen by the `<select>` beside it.
 */
const RecipientSeal: React.FC<{ initial: string | null }> = ({ initial }) => (
  initial
    ? <WaxSeal letter={initial} size={38} tone="tyrian" />
    : <span className="gor-seal-blank" aria-hidden="true">·</span>
);

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
  const initialFor = (recipient: StructuredTurnDraft['messagesOrOrders'][number]['recipient']): string | null => {
    if (recipient?.kind === 'known_entity') {
      const known = recipientOptions.find(option => option.entityId === recipient.entityId);
      return known?.displayName.trim().charAt(0).toUpperCase() || null;
    }
    if (recipient?.kind === 'free_text') return recipient.text.trim().charAt(0).toUpperCase() || null;
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-labelledby="structured-actions" style={fieldStyle}>
        <RegisterHeading numeral="I" headingId="structured-actions" title="What you do" />
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
            ❧ A further order
          </Button>
        </span>
      </section>
      <section aria-labelledby="structured-messages" style={fieldStyle}>
        <RegisterHeading numeral="II" headingId="structured-messages" title="Whom you address" />
        {draft.messagesOrOrders.map((row, index) => {
          const recipientValue = row.recipient?.kind === 'known_entity'
            ? encodeKnownRecipientSelectValue(row.recipient.entityId)
            : row.recipient?.kind === 'free_text' ? customRecipientSelectValue() : '';
          return (
            <div key={index} className="gor-register-letter">
              <RecipientSeal initial={initialFor(row.recipient)} />
              <div className="gor-register-letter-body">
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
            </div>
          );
        })}
        <span style={addRowStyle}>
          <Button type="button" variant="ghost" size="sm" aria-label="Add message or order row" disabled={disabled}
            onClick={() => onChange(addMessageOrOrderRow(draft))}>
            ❧ Another letter
          </Button>
        </span>
      </section>
      {/* Neither of these is an order, so they sit beside each other under
          their own left rules rather than continuing the stack of commands. */}
      <div className="gor-register-pair">
        <section aria-labelledby="structured-intent" className="gor-register-aside gor-register-aside-intent" style={fieldStyle}>
          <RegisterHeading numeral="III" headingId="structured-intent" title="What you intend" />
          <p className="gor-hint" style={{ margin: 0 }}>Private to your avatar; this expresses what you intend, not an action by itself.</p>
          <textarea className="gor-textarea" rows={2} aria-label="Private Intent" value={draft.privateIntent} disabled={disabled} {...describeIssue('privateIntent')}
            onChange={event => onChange(updatePrivateIntent(draft, event.target.value))} onKeyDown={submitOnShortcut} />
        </section>
        <section aria-labelledby="structured-context" className="gor-register-aside" style={fieldStyle}>
          <RegisterHeading numeral="IV" headingId="structured-context" title="What you ask" />
          <p className="gor-hint" style={{ margin: 0 }}>Your question or context does not cause autonomous action.</p>
          <textarea className="gor-textarea" rows={2} aria-label="Question / Context" value={draft.questionOrContext} disabled={disabled} {...describeIssue('questionOrContext')}
            onChange={event => onChange(updateQuestionOrContext(draft, event.target.value))} onKeyDown={submitOnShortcut} />
        </section>
      </div>
      <div className="gor-register-foot">
        {/* The visible label is the player's imperative; the aria-label stays
            "Submit turn" — the name every caller and test already knows. */}
        <Button type="button" aria-label="Submit turn" disabled={disabled || submissionBlocked} onClick={onSubmit}>Seal &amp; send</Button>
        <span className="gor-register-shortcut" aria-hidden="true">⌃⏎</span>
      </div>
    </div>
  );
};
