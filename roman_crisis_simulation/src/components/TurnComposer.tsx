import React, { useState } from 'react';
import type { TurnStage } from '../ai/core/turn';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import { appendSuggestedAction } from '../playerInput/composerState';
import { getComposerMode, setComposerMode } from '../persistence/uiPrefs';
import { StructuredTurnComposer } from './StructuredTurnComposer';

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

const MAX_CHAT_CHARACTERS = 20_000;

export const TurnComposer: React.FC<TurnComposerProps> = ({
  chatDraft, structuredDraft, recipientOptions, suggestedActions, disabled, isProcessing,
  onChatDraftChange, onStructuredDraftChange, onSubmit,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const locked = disabled || isProcessing;
  const remaining = MAX_CHAT_CHARACTERS - chatDraft.length;
  const chatOverLimit = remaining < 0;
  const statusId = 'chat-character-status';

  const selectMode = (next: ComposerMode) => {
    setMode(next);
    setComposerMode(next);
  };
  const submitChat = () => {
    if (!locked && !chatOverLimit && chatDraft.trim()) onSubmit(chatDraft);
  };
  const submitStructured = () => {
    if (!locked) onSubmit(structuredDraft);
  };

  return (
    <div>
      <div role="group" aria-label="Composer mode">
        <button type="button" aria-pressed={mode === 'chat'} disabled={locked} onClick={() => selectMode('chat')}>Chat</button>
        <button type="button" aria-pressed={mode === 'structured'} disabled={locked} onClick={() => selectMode('structured')}>Structured</button>
      </div>
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
            aria-invalid={chatOverLimit || undefined} aria-describedby={statusId}
            onChange={event => onChatDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitChat();
              }
            }} />
          {chatOverLimit ? (
            <p id={statusId} role="alert">{Math.abs(remaining)} character{Math.abs(remaining) === 1 ? '' : 's'} over limit</p>
          ) : (
            <p id={statusId} role="status">{remaining} characters remaining</p>
          )}
          <button type="submit" aria-label="Send message" disabled={locked || chatOverLimit || !chatDraft.trim()}>Send message</button>
        </form>
      ) : (
        <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked}
          onChange={onStructuredDraftChange} onSubmit={submitStructured} />
      )}
    </div>
  );
};
