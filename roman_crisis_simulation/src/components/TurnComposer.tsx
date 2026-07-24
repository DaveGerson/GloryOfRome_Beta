import React, { useState } from 'react';
import type { TurnStage } from '../ai/core/turn';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import { appendSuggestedAction, canonicalArtifactStatus } from '../playerInput/composerState';
import { MAX_TURN_SUBMISSION_CHARACTERS } from '../playerInput/turnSubmission';
import { getComposerMode, setComposerMode } from '../persistence/uiPrefs';
import { StructuredTurnComposer } from './StructuredTurnComposer';
import { TURN_STAGE_STATUS_COPY } from './Chat';

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

export const TurnComposer: React.FC<TurnComposerProps> = ({
  chatDraft, structuredDraft, recipientOptions, suggestedActions, disabled, isProcessing,
  onChatDraftChange, onStructuredDraftChange, onSubmit, turnStage,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const locked = disabled || isProcessing;
  const artifactStatus = canonicalArtifactStatus(mode === 'chat' ? chatDraft : structuredDraft, recipientOptions);
  const blankChat = mode === 'chat' && !chatDraft.trim();
  const remaining = artifactStatus.ok
    ? artifactStatus.remainingCharacters
    : blankChat ? MAX_TURN_SUBMISSION_CHARACTERS : null;
  const overLimit = artifactStatus.ok && artifactStatus.overLimit;
  const statusId = 'composer-submission-status';
  const validationMessage = artifactStatus.ok || blankChat
    ? null
    : artifactStatus.issues.map(issue => issue.message).join(' ');

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

  return (
    <div>
      <div role="group" aria-label="Composer mode">
        <button type="button" aria-pressed={mode === 'chat'} disabled={locked} onClick={() => selectMode('chat')}>Chat</button>
        <button type="button" aria-pressed={mode === 'structured'} disabled={locked} onClick={() => selectMode('structured')}>Structured</button>
      </div>
      {isProcessing && (
        <p role="status" aria-live="polite">{TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance']}</p>
      )}
      {suggestedActions.length > 0 && (
        <div>
          {suggestedActions.map(action => (
            <button key={action} type="button" disabled={locked} onClick={() => {
              if (mode === 'structured') onStructuredDraftChange(appendSuggestedAction(structuredDraft, action));
              else onChatDraftChange(action);
            }}>{action}</button>
          ))}
        </div>
      )}
      {mode === 'chat' ? (
        <form onSubmit={event => { event.preventDefault(); submitChat(); }}>
          <textarea aria-label="Chat input" value={chatDraft} disabled={locked}
            aria-invalid={overLimit || undefined} aria-describedby={statusId}
            onChange={event => onChatDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitChat();
              }
            }} />
          {overLimit ? (
            <p id={statusId} role="alert">{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
          ) : validationMessage ? (
            <p id={statusId} role="alert">{validationMessage} {remaining} characters remaining</p>
          ) : (
            <p id={statusId} role="status">{formatCharacterCount(remaining ?? 0)} characters remaining</p>
          )}
          <button type="submit" aria-label="Send message" disabled={locked || overLimit || !artifactStatus.ok || !chatDraft.trim()}>Send message</button>
        </form>
      ) : (
        <>
          {overLimit ? (
            <p id={statusId} role="alert">{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
          ) : validationMessage ? (
            <p id={statusId} role="alert">{validationMessage}</p>
          ) : (
            <p id={statusId} role="status">{formatCharacterCount(remaining ?? 0)} characters remaining</p>
          )}
          <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked} submissionBlocked={overLimit || !artifactStatus.ok}
            validationIssues={artifactStatus.ok ? [] : artifactStatus.issues} statusId={statusId}
            onChange={onStructuredDraftChange} onSubmit={submitStructured} />
        </>
      )}
    </div>
  );
};
