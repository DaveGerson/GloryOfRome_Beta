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
  /**
   * The composer's own tools - the private-scene doorway and, when the
   * console is enabled, the GM Log - given a home in the tablet's head
   * beside the mode switch (design pass). App.tsx decides what goes here;
   * the composer only places it, so the send row below carries nothing but
   * the count and Speak.
   */
  tools?: React.ReactNode;
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

/**
 * Whether the pen may be put back in the player's hand without taking it
 * from somewhere it is wanted: nothing focused, the page body, or something
 * already inside the chronicle or the composer strip. A dialog, the side
 * panel or the masthead keeps what it has.
 */
function focusIsFreeForTheTablet(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return active.closest('.gor-chat, .gor-composer-strip') !== null;
}

export const TurnComposer: React.FC<TurnComposerProps> = ({
  chatDraft, structuredDraft, recipientOptions, suggestedActions, disabled, isProcessing,
  onChatDraftChange, onStructuredDraftChange, onSubmit, turnStage, playerInitial,
  canReachTheFates = true, online = true, tools, onOpenSettings, onEnableMockMode,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const [sealing, setSealing] = useState(false);
  const sealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const locked = disabled || isProcessing;
  const wasLockedRef = useRef(locked);
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

  /**
   * The week has turned (or the world unlocked): put the pen back in the
   * player's hand (design pass). A disabled textarea drops focus to the body
   * while the Fates work, so without this every turn ended with the player
   * clicking back into the tablet before they could write. Only on the
   * locked → unlocked edge, only in chat mode, and never stealing from a
   * dialog or the side panel (see `focusIsFreeForTheTablet`).
   */
  useEffect(() => {
    const wasLocked = wasLockedRef.current;
    wasLockedRef.current = locked;
    if (wasLocked && !locked && mode === 'chat' && focusIsFreeForTheTablet()) {
      chatTextareaRef.current?.focus();
    }
  }, [locked, mode]);

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
  /**
   * Item 49: the send is held while the roads are shut, and the hold lives
   * HERE rather than on the Speak button's `disabled` alone — Enter-to-send,
   * the form's own submit and the structured ⌃⏎ shortcut all arrive through
   * these two functions and each one used to walk straight past an offline
   * gate that was only ever painted on one button.
   */
  const submitChat = () => {
    if (online && !locked && artifactStatus.ok && !overLimit && chatDraft.trim()) {
      onSubmit(chatDraft);
      stampSeal();
    }
  };
  const submitStructured = () => {
    if (online && !locked && artifactStatus.ok && !overLimit) {
      onSubmit(structuredDraft);
      stampSeal();
    }
  };

  const sealLetter = (playerInitial ?? '').trim().charAt(0).toUpperCase() || 'R';
  const waxSeal = sealing
    ? <span className="gor-seal-press" aria-hidden="true"><WaxSeal letter={sealLetter} size={46} tone="crimson" /></span>
    : null;

  const stageCopy = TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance'];
  const chatPlaceholder = isProcessing
    ? stageCopy
    : disabled
    ? "Awaiting the Senate's judgment..."
    : 'Write the week — an order, a letter, a scheme… (Shift+Enter for a new line)';

  return (
    <div className="gor-composer">
      {/* Item 46: said before the week is written, not after it is lost. */}
      {!canReachTheFates && onOpenSettings && onEnableMockMode && (
        <TurnFailureNotice
          failure={{ kind: 'no_key' }}
          onEditTheWeek={() => {}}
          onOpenSettings={onOpenSettings}
          onEnableMockMode={onEnableMockMode}
        />
      )}
      {/* The tablet's head: how you write, what the Fates are doing, and the
          composer's own tools - so the send row below is only the count and
          Speak. The stage line stays first in DOM order among the statuses. */}
      <div className="gor-composer-head">
        <SegmentedControl
          ariaLabel="Composer mode"
          options={COMPOSER_MODE_OPTIONS}
          value={mode}
          onChange={selectMode}
          disabled={locked}
        />
        {isProcessing && (
          <p className="gor-composer-stage" role="status" aria-live="polite">{stageCopy}</p>
        )}
        {tools && <div className="gor-composer-tools">{tools}</div>}
      </div>
      {suggestedActions.length > 0 && (
        <div className="gor-counsel">
          <span className="gor-counsel-label" aria-hidden="true">Counsel</span>
          <div className="gor-counsel-pills" role="group" aria-label="Suggested actions">
            {suggestedActions.map((action, index) => (
              <ActionPill key={action} aria-label={action} delay={index * 80} disabled={locked} onClick={() => {
                if (mode === 'structured') {
                  onStructuredDraftChange(appendSuggestedAction(structuredDraft, action));
                } else {
                  // A chosen counsel lands in the tablet with the pen already
                  // on it - Enter sends, or the player edits it first.
                  onChatDraftChange(action);
                  chatTextareaRef.current?.focus();
                }
              }}>{action}</ActionPill>
            ))}
          </div>
        </div>
      )}
      {mode === 'chat' ? (
        <form
          className="gor-composer-form"
          onSubmit={event => { event.preventDefault(); submitChat(); }}
        >
          <div className="gor-composer-field">
            <textarea
              id={CHAT_INPUT_ELEMENT_ID}
              ref={chatTextareaRef}
              className="gor-textarea gor-composer-textarea"
              aria-label="Chat input"
              value={chatDraft}
              disabled={locked}
              rows={2}
              placeholder={chatPlaceholder}
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
          <div className="gor-composer-foot">
            {overLimit ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error gor-composer-count">{formatCharacterCount(artifactStatus.excessCharacters)} character{artifactStatus.excessCharacters === 1 ? '' : 's'} over limit</p>
            ) : validationMessage ? (
              <p id={statusId} role="alert" className="gor-hint gor-hint-error gor-composer-count">{validationMessage} {remaining} characters remaining</p>
            ) : (
              <p id={statusId} role="status" className="gor-hint gor-composer-count">{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            )}
            <div className="gor-composer-send">
              {!locked && online && <span className="gor-send-hint" aria-hidden="true">⏎ speaks · ⇧⏎ new line</span>}
              <Button
                type="submit"
                aria-label="Send message"
                disabled={!online || locked || overLimit || !artifactStatus.ok || !chatDraft.trim()}
              >
                {online ? 'Speak' : 'Hold until the roads reopen'}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="gor-composer-form">
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
            <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked} online={online} submissionBlocked={overLimit || !artifactStatus.ok || !online}
              aggregateIssue={overLimit} validationIssues={artifactStatus.ok ? [] : artifactStatus.issues} statusId={statusId}
              onChange={onStructuredDraftChange} onSubmit={submitStructured} />
            {waxSeal}
          </div>
        </div>
      )}
    </div>
  );
};
