import React, { useRef, useState } from 'react';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import {
  addActionRow, addMessageOrOrderRow, customRecipientSelectValue, encodeKnownRecipientSelectValue,
  selectMessageRecipient, updateActionRow, updateCustomRecipient, updateMessageCommand,
  updatePrivateIntent, updateQuestionOrContext,
} from '../playerInput/composerState';
import { Button, RegisterHeading } from './ui/Core';
import { WaxSeal } from './ui/Brand';
import { useFocusRequest } from './ui/useFocusRequest';

const CUSTOM_RECIPIENT_VALUE = customRecipientSelectValue();

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const addRowStyle: React.CSSProperties = { alignSelf: 'flex-start' };

interface FoldedRegisterProps {
  headingId: string;
  numeral: string;
  title: string;
  hint: string;
  className: string;
  value: string;
  disabled: boolean;
  fieldProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  onValueChange(value: string): void;
}

/**
 * Registers III and IV are optional, so each folds behind its heading and is
 * closed by default (progressive disclosure, B14): Seal & send then clears a
 * short laptop's desk. The heading is the disclosure button. Opening a
 * register moves focus into its field. A register that holds words is open,
 * and stays open from then on - a restored draft is never folded out of
 * sight, and clearing the field never folds it shut under the cursor - so
 * while it holds words its heading is a plain way to the field, no longer
 * a disclosure. The field is described by its hint, so a reader who opens
 * the register hears it.
 */
const FoldedRegister: React.FC<FoldedRegisterProps> = ({
  headingId, numeral, title, hint, className, value, disabled, fieldProps, onValueChange,
}) => {
  const [unfolded, setUnfolded] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const requestFocus = useFocusRequest();
  const holdsWords = value !== '';
  // Words arriving (typed, or restored) unfold it for good: adjusted during
  // render, React's pattern for state that follows a prop.
  if (holdsWords && !unfolded) setUnfolded(true);
  const open = unfolded || holdsWords;
  const panelId = `${headingId}-panel`;
  const hintId = `${headingId}-hint`;
  const describedBy = [hintId, fieldProps['aria-describedby']].filter(Boolean).join(' ');
  const toggle = () => {
    if (holdsWords) {
      fieldRef.current?.focus();
      return;
    }
    if (!open) requestFocus(fieldRef);
    setUnfolded(!open);
  };
  return (
    <section aria-labelledby={headingId} className={className} style={fieldStyle}>
      <RegisterHeading numeral={numeral} headingId={headingId} title={
        // Locked with the rest of the tablet; a folded register is empty, so nothing is kept from sight.
        <button type="button" className="gor-register-fold" aria-expanded={holdsWords ? undefined : open} aria-controls={holdsWords ? undefined : panelId} disabled={disabled} onClick={toggle}>
          <span className="gor-register-fold-mark" aria-hidden="true" />{title}
        </button>
      } />
      {/* An inline display would outrank `hidden`, so the column is laid out only while open. */}
      <div id={panelId} hidden={!open} style={open ? fieldStyle : undefined}>
        <p id={hintId} className="gor-hint" style={{ margin: 0 }}>{hint}</p>
        <textarea ref={fieldRef} className="gor-textarea" rows={2} aria-label={title} value={value} disabled={disabled}
          {...fieldProps} aria-describedby={describedBy} onChange={event => onValueChange(event.target.value)} />
      </div>
    </section>
  );
};

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
  /** Drawn over the registers (the seal pressed as the week is sent). */
  overlay?: React.ReactNode;
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
  onLetterFocus, onSubmitBlocked, overlay, onChange, onSubmit,
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

  return (<>
    {/* The registers scroll within the desk when they outgrow it, so the
        chronicle above keeps its reading height (design/shell.css); the
        send sits below them, never scrolled out of sight, as Speak does. */}
    <div className="gor-register-scroll" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <FoldedRegister headingId="structured-intent" numeral="III" title={STRUCTURED_REGISTER_TITLES.intent}
          className="gor-register-aside gor-register-aside-intent"
          hint="Private to your avatar; this expresses what you intend, not an action by itself."
          value={draft.privateIntent} disabled={disabled}
          fieldProps={{ ...describeIssue('privateIntent'), onKeyDown: submitOnShortcut }}
          onValueChange={value => onChange(updatePrivateIntent(draft, value))} />
        <FoldedRegister headingId="structured-context" numeral="IV" title={STRUCTURED_REGISTER_TITLES.context}
          className="gor-register-aside"
          hint="Your question or context does not cause autonomous action."
          value={draft.questionOrContext} disabled={disabled}
          fieldProps={{ ...describeIssue('questionOrContext'), onKeyDown: submitOnShortcut }}
          onValueChange={value => onChange(updateQuestionOrContext(draft, value))} />
      </div>
      {overlay}
    </div>
    <div className="gor-register-foot">
      {/* Named by what it says - "Seal & send", or offline "Hold until the
          roads reopen" - so a player who speaks the label reaches it. */}
      <Button type="button" disabled={disabled || submissionBlocked} onClick={onSubmit}>
        {online ? 'Seal & send' : 'Hold until the roads reopen'}
      </Button>
      <span className="gor-register-shortcut" aria-hidden="true">⌃⏎</span>
    </div>
  </>);
};
