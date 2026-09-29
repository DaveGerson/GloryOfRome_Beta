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

/**
 * The fatal notice's "Edit the week" focuses the composer that is actually
 * mounted, and in structured mode that is this register's first field —
 * `#chat-input` does not exist here. App.tsx focuses `#chat-input,
 * #structured-input`; exactly one of the two is ever in the document.
 */
export const STRUCTURED_INPUT_ELEMENT_ID = 'structured-input';

interface StructuredTurnComposerProps {
  draft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  disabled: boolean;
  /** Item 49: while the roads are shut, the send is held here too. */
  online?: boolean;
  submissionBlocked?: boolean;
  aggregateIssue?: boolean;
  validationIssues?: readonly { field: string; message: string }[];
  /** The tablet's status line: the remaining count, or the draft's issue. */
  statusId?: string;
  /** Told which letter (row of II) focus is in as it enters one, and null as it leaves it. */
  onLetterFocus?(index: number | null): void;
  /** ⌃⏎ on a draft that cannot be sent yet. */
  onSubmitBlocked?(): void;
  onChange(draft: StructuredTurnDraft): void;
  onSubmit(): void;
}

/**
 * The register headings, which are also the names of the two fields that
 * sit alone under theirs - a field's name starts with the words the player
 * sees above it (WCAG 2.5.3).
 */
export const STRUCTURED_REGISTER_TITLES = {
  actions: 'What you do',
  messages: 'Whom you address',
  intent: 'What you intend',
  context: 'What you ask',
} as const;

/** The visible words of the two add-row buttons, which are also their names. */
export const STRUCTURED_ADD_ROW_LABELS = {
  action: 'A further order',
  letter: 'Another letter',
} as const;

export const StructuredTurnComposer: React.FC<StructuredTurnComposerProps> = ({
  draft, recipientOptions, disabled, online = true, submissionBlocked = false, aggregateIssue = false, validationIssues = [], statusId,
  onLetterFocus, onSubmitBlocked, onChange, onSubmit,
}) => {
  const hasIssue = (field: string) => validationIssues.some(issue =>
    issue.field === 'submission' || issue.field === field);
  const describeIssue = (field: string) => aggregateIssue || hasIssue(field)
    ? { 'aria-invalid': true, ...(statusId ? { 'aria-describedby': statusId } : {}) }
    : {};
  const submitOnShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (disabled) return;
      if (submissionBlocked) onSubmitBlocked?.();
      else onSubmit();
    }
  };
  /** Focus crossing a letter's edge - not moving between its own fields. */
  const crossesEdge = (event: React.FocusEvent<HTMLElement>) =>
    !event.currentTarget.contains(event.relatedTarget as Node | null);
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
        <RegisterHeading numeral="I" headingId="structured-actions" title={STRUCTURED_REGISTER_TITLES.actions} />
        {draft.actions.map((action, index) => (
          <textarea
            key={index}
            id={index === 0 ? STRUCTURED_INPUT_ELEMENT_ID : undefined}
            className="gor-textarea"
            rows={2}
            aria-label={`Action ${index + 1}`}
            value={action}
            disabled={disabled}
            // The tablet's first field is described by its status line - the
            // remaining count - as the chat tablet is (UPLEVEL Part 4).
            {...(index === 0 && statusId ? { 'aria-describedby': statusId } : {})}
            {...describeIssue(`actions.${index}`)}
            onChange={event => onChange(updateActionRow(draft, index, event.target.value))}
            onKeyDown={submitOnShortcut}
          />
        ))}
        <span style={addRowStyle}>
          <Button type="button" variant="ghost" size="sm" aria-label={STRUCTURED_ADD_ROW_LABELS.action} disabled={disabled}
            onClick={() => onChange(addActionRow(draft))}>
            <span aria-hidden="true">❧</span> {STRUCTURED_ADD_ROW_LABELS.action}
          </Button>
        </span>
      </section>
      <section aria-labelledby="structured-messages" style={fieldStyle}>
        <RegisterHeading numeral="II" headingId="structured-messages" title={STRUCTURED_REGISTER_TITLES.messages} />
        {draft.messagesOrOrders.map((row, index) => {
          const recipientValue = row.recipient?.kind === 'known_entity'
            ? encodeKnownRecipientSelectValue(row.recipient.entityId)
            : row.recipient?.kind === 'free_text' ? customRecipientSelectValue() : '';
          return (
            <div key={index} className="gor-register-letter"
              onFocus={event => { if (crossesEdge(event)) onLetterFocus?.(index); }}
              onBlur={event => { if (crossesEdge(event)) onLetterFocus?.(null); }}>
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
          <Button type="button" variant="ghost" size="sm" aria-label={STRUCTURED_ADD_ROW_LABELS.letter} disabled={disabled}
            onClick={() => onChange(addMessageOrOrderRow(draft))}>
            <span aria-hidden="true">❧</span> {STRUCTURED_ADD_ROW_LABELS.letter}
          </Button>
        </span>
      </section>
      {/* Neither of these is an order, so they sit beside each other under
          their own left rules rather than continuing the stack of commands. */}
      <div className="gor-register-pair">
        <section aria-labelledby="structured-intent" className="gor-register-aside gor-register-aside-intent" style={fieldStyle}>
          <RegisterHeading numeral="III" headingId="structured-intent" title={STRUCTURED_REGISTER_TITLES.intent} />
          <p className="gor-hint" style={{ margin: 0 }}>Private to your avatar; this expresses what you intend, not an action by itself.</p>
          <textarea className="gor-textarea" rows={2} aria-label={STRUCTURED_REGISTER_TITLES.intent} value={draft.privateIntent} disabled={disabled} {...describeIssue('privateIntent')}
            onChange={event => onChange(updatePrivateIntent(draft, event.target.value))} onKeyDown={submitOnShortcut} />
        </section>
        <section aria-labelledby="structured-context" className="gor-register-aside" style={fieldStyle}>
          <RegisterHeading numeral="IV" headingId="structured-context" title={STRUCTURED_REGISTER_TITLES.context} />
          <p className="gor-hint" style={{ margin: 0 }}>Your question or context does not cause autonomous action.</p>
          <textarea className="gor-textarea" rows={2} aria-label={STRUCTURED_REGISTER_TITLES.context} value={draft.questionOrContext} disabled={disabled} {...describeIssue('questionOrContext')}
            onChange={event => onChange(updateQuestionOrContext(draft, event.target.value))} onKeyDown={submitOnShortcut} />
        </section>
      </div>
      <div className="gor-register-foot">
        {/* Named by what it says - "Seal & send", or offline "Hold until the
            roads reopen" - so a player who speaks the label reaches it. */}
        <Button type="button" disabled={disabled || submissionBlocked} onClick={onSubmit}>
          {online ? 'Seal & send' : 'Hold until the roads reopen'}
        </Button>
        <span className="gor-register-shortcut" aria-hidden="true">⌃⏎</span>
      </div>
    </div>
  );
};
