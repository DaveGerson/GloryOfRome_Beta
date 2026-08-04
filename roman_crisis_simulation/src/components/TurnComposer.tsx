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
import { WaxSeal } from './ui/Brand';
import { TurnFailureNotice } from './ui/FailureNotices';

export type ComposerMode = 'chat' | 'structured';

export interface TurnComposerProps {
  chatDraft: string;
  structuredDraft: StructuredTurnDraft;
  recipientOptions: readonly KnownRecipientOption[];
  suggestedActions: string[];
  disabled: boolean;
  isProcessing: boolean;
  turnStage?: TurnStage | null;
  /** The player's initial, pressed into the wax when a week is sealed. */
  playerInitial?: string;
  /**
   * Item 46: whether anything CAN be sent. False shows a bronze pre-flight
   * notice above the tablet from first paint, rather than letting the player
   * write a week and only then discover the device carries no key.
   * `App.tsx`'s pre-call guard stays as the backstop, in the same words.
   */
  canReachTheFates?: boolean;
  /** Item 49: while the roads are shut, Speak says so instead of failing. */
  online?: boolean;
  onOpenSettings?(): void;
  onEnableMockMode?(): void;
  onChatDraftChange(value: string): void;
  onStructuredDraftChange(value: StructuredTurnDraft): void;
  onSubmit(input: string | StructuredTurnDraft): void;
}

/**
 * How long the seal stays on the tablet after a week is committed. The press
 * itself runs 520ms (`gorSealPress` in components.css); the extra beat lets
 * the finished impression be read before it lifts. Purely decorative - the
 * submission has already been handed to App by the time this starts.
 */
const SEAL_PRESS_HOLD_MS = 620;

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
  onChatDraftChange, onStructuredDraftChange, onSubmit, turnStage, playerInitial,
  canReachTheFates = true, online = true, onOpenSettings, onEnableMockMode,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const [sealing, setSealing] = useState(false);
  const sealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const remainingShare = Math.min(100, Math.max(0, ((remaining ?? 0) / MAX_TURN_SUBMISSION_CHARACTERS) * 100));
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

  // Clear any seal still on the tablet if the composer unmounts mid-press.
  useEffect(() => () => {
    if (sealTimerRef.current !== null) clearTimeout(sealTimerRef.current);
  }, []);

  const selectMode = (next: ComposerMode) => {
    setMode(next);
    setComposerMode(next);
  };
  /**
   * Presses the wax. Deliberately fired AFTER `onSubmit` at every call site so
   * the request is already away - the impression is a confirmation of
   * something that happened, never a gate in front of it.
   */
  const stampSeal = () => {
    setSealing(true);
    if (sealTimerRef.current !== null) clearTimeout(sealTimerRef.current);
    sealTimerRef.current = setTimeout(() => {
      sealTimerRef.current = null;
      setSealing(false);
    }, SEAL_PRESS_HOLD_MS);
  };
  const submitChat = () => {
    if (!locked && artifactStatus.ok && !overLimit && chatDraft.trim()) {
      onSubmit(chatDraft);
      stampSeal();
    }
  };
  const submitStructured = () => {
    if (!locked && artifactStatus.ok && !overLimit) {
      onSubmit(structuredDraft);
      stampSeal();
    }
  };

  const sealLetter = (playerInitial ?? '').trim().charAt(0).toUpperCase() || 'R';
  const waxSeal = sealing
    ? <span className="gor-seal-press" aria-hidden="true"><WaxSeal letter={sealLetter} size={46} tone="crimson" /></span>
    : null;

  const chatPlaceholder = isProcessing
    ? TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance']
    : disabled
    ? "Awaiting the Senate's judgment..."
    : 'Enter your action... (Shift+Enter for new line)';

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Item 46: said before the week is written, not after it is lost. */}
      {!canReachTheFates && onOpenSettings && onEnableMockMode && (
        <TurnFailureNotice
          failure={{ kind: 'no_key' }}
          onEditTheWeek={() => {}}
          onOpenSettings={onOpenSettings}
          onEnableMockMode={onEnableMockMode}
        />
      )}
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
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
            {waxSeal}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            {overLimit ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
            ) : validationMessage ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{validationMessage} {remaining} characters remaining</p>
            ) : (
              <p id={statusId} role="status" className="gor-hint" style={{ margin: 0 }}>{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            )}
            <Button
              type="submit"
              aria-label="Send message"
              disabled={!online || locked || overLimit || !artifactStatus.ok || !chatDraft.trim()}
            >
              {online ? 'Speak' : 'Hold until the roads reopen'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {overLimit ? (
            <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
          ) : validationMessage ? (
            <p id={statusId} role="alert" className="gor-hint gor-hint-error" style={{ margin: 0 }}>{validationMessage}</p>
          ) : (
            // The remaining budget as a hairline gauge (WP-6): the sentence is
            // still the accessible status - the track only draws it.
            <div className="gor-gauge">
              <span className="gor-gauge-track" aria-hidden="true">
                <span className="gor-gauge-fill" style={{ width: `${remainingShare}%` }} />
              </span>
              <p id={statusId} role="status" className="gor-gauge-count">{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked} submissionBlocked={overLimit || !artifactStatus.ok}
              aggregateIssue={overLimit} validationIssues={artifactStatus.ok ? [] : artifactStatus.issues} statusId={statusId}
              onChange={onStructuredDraftChange} onSubmit={submitStructured} />
            {waxSeal}
          </div>
        </>
      )}
    </div>
  );
};
