import React, { useEffect, useRef, useState } from 'react';
import type { TurnStage } from '../ai/core/turn';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import { appendSuggestedAction, canonicalArtifactStatus } from '../playerInput/composerState';
import { MAX_TURN_SUBMISSION_CHARACTERS } from '../playerInput/turnSubmission';
import { getComposerMode, setComposerMode } from '../persistence/uiPrefs';
import { StructuredTurnComposer } from './StructuredTurnComposer';
import { TURN_STAGE_STATUS_COPY } from './Chat';
import { ActionPill } from './ui/Game';
import { Button } from './ui/Core';
import { SegmentedControl } from './ui/Forms';

export type ComposerMode = 'chat' | 'structured';

export interface TurnComposerProps {
  chatDraft: string;
  structuredDraft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  suggestedActions: string[];
  disabled: boolean;
  isProcessing: boolean;
  turnStage?: TurnStage | null;
  onChatDraftChange(value: string): void;
  onStructuredDraftChange(value: StructuredTurnDraft): void;
  onSubmit(input: string | StructuredTurnDraft): void;
}

const formatCharacterCount = (count: number): string => count.toLocaleString('en-US');

const isBlankStructuredDraft = (draft: StructuredTurnDraft): boolean =>
  draft.actions.every(action => !action.trim())
  && draft.messagesOrOrders.every(row => row.recipient === null && !row.command.trim())
  && !draft.privateIntent.trim()
  && !draft.questionOrContext.trim();

const COMPOSER_MODE_OPTIONS = [
  { value: 'chat', label: 'Chat' },
  { value: 'structured', label: 'Structured' },
] as const;

/**
 * OnboardingOverlay returns focus here on close — the id predates this
 * component (it lived on the retired ChatInput) and must stay stable.
 */
const CHAT_INPUT_ELEMENT_ID = 'chat-input';

export const TurnComposer: React.FC<TurnComposerProps> = ({
  chatDraft, structuredDraft, recipientOptions, suggestedActions, disabled, isProcessing,
  onChatDraftChange, onStructuredDraftChange, onSubmit, turnStage,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const locked = disabled || isProcessing;
  const artifactStatus = canonicalArtifactStatus(mode === 'chat' ? chatDraft : structuredDraft, recipientOptions);
  const blankChat = mode === 'chat' && !chatDraft.trim();
  const blankStructured = mode === 'structured' && isBlankStructuredDraft(structuredDraft);
  const pristine = blankChat || blankStructured;
  const remaining = artifactStatus.ok
    ? artifactStatus.remainingCharacters
    : pristine ? MAX_TURN_SUBMISSION_CHARACTERS : null;
  const overLimit = artifactStatus.ok && artifactStatus.overLimit;
  const statusId = 'composer-submission-status';
  const validationMessage = artifactStatus.ok || pristine
    ? null
    : artifactStatus.issues.map(issue => issue.message).join(' ');

  useEffect(() => {
    const textarea = chatTextareaRef.current;
    if (mode !== 'chat' || !textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [chatDraft, mode]);

  const selectMode = (next: ComposerMode) => {
    setMode(next);
    setComposerMode(next);
  };
  const submitChat = () => {
    if (!locked && artifactStatus.ok && !overLimit && chatDraft.trim()) onSubmit(chatDraft);
  };
  const submitStructured = () => {
    if (!locked && artifactStatus.ok && !overLimit) onSubmit(structuredDraft);
  };

  const chatPlaceholder = isProcessing
    ? TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance']
    : disabled
    ? "Awaiting the Senate's judgment..."
    : 'Enter your action... (Shift+Enter for new line)';

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {suggestedActions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {suggestedActions.map((action, index) => (
            <ActionPill key={action} aria-label={action} delay={index * 80} disabled={locked} onClick={() => {
              if (mode === 'structured') onStructuredDraftChange(appendSuggestedAction(structuredDraft, action));
              else onChatDraftChange(action);
            }}>{action}</ActionPill>
          ))}
        </div>
      )}
      <SegmentedControl
        ariaLabel="Composer mode"
        options={COMPOSER_MODE_OPTIONS}
        value={mode}
        onChange={selectMode}
        disabled={locked}
      />
      {isProcessing && (
        <p className="gor-hint" role="status" aria-live="polite" style={{ margin: 0 }}>
          {TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance']}
        </p>
      )}
      {mode === 'chat' ? (
        <form
          onSubmit={event => { event.preventDefault(); submitChat(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <textarea
            id={CHAT_INPUT_ELEMENT_ID}
            ref={chatTextareaRef}
            className="gor-textarea"
            aria-label="Chat input"
            value={chatDraft}
            disabled={locked}
            rows={1}
            placeholder={chatPlaceholder}
            style={{ resize: 'none', maxHeight: 160, overflowY: 'auto' }}
            aria-invalid={overLimit || undefined}
            aria-describedby={statusId}
            onChange={event => onChatDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey
                  && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                submitChat();
              }
            }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            {overLimit ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
            ) : validationMessage ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{validationMessage} {remaining} characters remaining</p>
            ) : (
              <p id={statusId} role="status" className="gor-hint" style={{ margin: 0 }}>{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            )}
            <Button type="submit" aria-label="Send message" disabled={locked || overLimit || !artifactStatus.ok || !chatDraft.trim()}>Speak</Button>
          </div>
        </form>
      ) : (
        <>
          {overLimit ? (
            <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
          ) : validationMessage ? (
            <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{validationMessage}</p>
          ) : (
            <p id={statusId} role="status" className="gor-hint" style={{ margin: 0 }}>{formatCharacterCount(remaining ?? 0)} characters remaining</p>
          )}
          <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked} submissionBlocked={overLimit || !artifactStatus.ok}
            aggregateIssue={overLimit} validationIssues={artifactStatus.ok ? [] : artifactStatus.issues} statusId={statusId}
            onChange={onStructuredDraftChange} onSubmit={submitStructured} />
        </>
      )}
    </div>
  );
};
