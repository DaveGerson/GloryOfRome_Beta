import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnStage } from '../ai/core/turn';
import type { KnownRecipientOption, StructuredTurnDraft } from '../types';
import { appendSuggestedAction, canonicalArtifactStatus } from '../playerInput/composerState';
import { MAX_TURN_SUBMISSION_CHARACTERS } from '../playerInput/turnSubmission';
import { getComposerMode, setComposerMode } from '../persistence/uiPrefs';
import { StructuredTurnComposer, STRUCTURED_INPUT_ELEMENT_ID } from './StructuredTurnComposer';
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
   * A private scene still open, which is what holds the tablet (its dialog
   * closed, or the game reloaded mid-scene). The tablet says so and names
   * the way back, instead of the generic "Awaiting the Senate's judgment".
   */
  openScene?: { npcName: string; awaitingLastWord: boolean } | null;
  onOpenSettings?(): void;
  onEnableMockMode?(): void;
  onChatDraftChange(value: string): void;
  onStructuredDraftChange(value: StructuredTurnDraft): void;
  onSubmit(input: string | StructuredTurnDraft): void;
  /**
   * The desk's other tools (a private scene, the narration log, the GM
   * ledger), drawn at the end of the mode bar so the tablet itself can take
   * the full width of the column.
   */
  tools?: React.ReactNode;
}

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const TURN_COMPOSER_COPY = {
  counsel: 'Counsel',
  /** The tablet held by an open private scene: the line above it, and its placeholder. */
  sceneOpen: (npc: string) => `Your private scene with ${npc} is still open. Return to it through Private scene; the week waits until it ends.`,
  sceneLastWord: (npc: string) => `${npc} awaits your last word. Give it, or let it stand, through Private scene; the week waits until then.`,
  scenePlaceholder: (npc: string) => `The week waits on your private scene with ${npc}…`,
} as const;

/**
 * The suggestion pills carry their index, so the command palette's "Draft:"
 * rows press the very same pill - one code path for chat and structured
 * modes alike.
 */
export const SUGGESTION_INDEX_ATTRIBUTE = 'data-gor-suggestion';

const COUNSEL_LABEL_ID = 'composer-counsel-label';

/**
 * How long the seal stays on the tablet after a week is committed. The press
 * itself runs 520ms (`gorSealPress` in components.css); the extra beat lets
 * the finished impression be read before it lifts. Purely decorative - the
 * submission has already been handed to App by the time this starts.
 */
const SEAL_PRESS_HOLD_MS = 620;

const formatCharacterCount = (count: number): string => count.toLocaleString('en-US');

/**
 * The GOV.UK character count, both halves: the remaining count is spoken
 * only once typing pauses (never per keystroke), and only within a
 * threshold of the limit (its `threshold` option) - 20,000 characters from
 * a limit, a count is noise. Over the limit the alert branch speaks at once.
 */
export const COUNT_ANNOUNCE_DELAY_MS = 1000;
export const COUNT_ANNOUNCE_THRESHOLD = Math.floor(MAX_TURN_SUBMISSION_CHARACTERS / 10);

const isBlankStructuredDraft = (draft: StructuredTurnDraft): boolean =>
  draft.actions.every(action => !action.trim())
  && draft.messagesOrOrders.every(row => row.recipient === null && !row.command.trim())
  && !draft.privateIntent.trim()
  && !draft.questionOrContext.trim();

/** A letter begun but not finished: a recipient without its words, or words without their recipient. */
const isHalfWrittenLetter = (row: StructuredTurnDraft['messagesOrOrders'][number] | undefined): boolean => {
  if (!row) return false;
  const addressed = row.recipient?.kind === 'known_entity'
    || (row.recipient?.kind === 'free_text' && Boolean(row.recipient.text.trim()));
  const worded = Boolean(row.command.trim());
  return (row.recipient !== null || worded) && !(addressed && worded);
};

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
  canReachTheFates = true, online = true, openScene = null, onOpenSettings, onEnableMockMode, tools,
}) => {
  const [mode, setMode] = useState<ComposerMode>(() => getComposerMode());
  const [sealing, setSealing] = useState(false);
  const sealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // Set when a send leaves from inside the composer. Locking disables the very
  // control that held focus, so the browser drops focus to <body>; once the
  // week is written, the writing surface takes it back rather than leaving a
  // keyboard player to Tab in from the top of the page.
  const restoreFocusOnUnlockRef = useRef(false);
  const locked = disabled || isProcessing;
  const artifactStatus = canonicalArtifactStatus(mode === 'chat' ? chatDraft : structuredDraft, recipientOptions);
  const blankChat = mode === 'chat' && !chatDraft.trim();
  const blankStructured = mode === 'structured' && isBlankStructuredDraft(structuredDraft);
  const pristine = blankChat || blankStructured;
  // A letter the player is still writing is not yet an error: picking its
  // recipient is step one of two, and the alert used to interrupt a screen
  // reader right there. Its issue waits while focus stays in that letter,
  // and is shown - still as an alert (UPLEVEL Part 4) - once they leave it
  // unfinished or try to send it. Seal & send stays held meanwhile, and the
  // count reads the rest of the tablet.
  const [writingLetter, setWritingLetter] = useState<number | null>(null);
  const writingHalfLetter = mode === 'structured' && !artifactStatus.ok && writingLetter !== null
    && isHalfWrittenLetter(structuredDraft.messagesOrOrders[writingLetter])
    && artifactStatus.issues.every(issue => issue.field.startsWith(`messagesOrOrders.${writingLetter}.`));
  // The tablet with that letter set aside. Validation stops at its first
  // issue, so another letter left unfinished after this one shows only here:
  // the hold waits on the letter being written, never on one already left.
  const restDraft = writingHalfLetter
    ? { ...structuredDraft, messagesOrOrders: structuredDraft.messagesOrOrders.map((row, index) => (index === writingLetter ? { recipient: null, command: '' } : row)) }
    : null;
  const restOfTablet = restDraft ? canonicalArtifactStatus(restDraft, recipientOptions) : null;
  const issueHeld = restDraft !== null && (Boolean(restOfTablet?.ok) || isBlankStructuredDraft(restDraft));
  // What the registers mark as wrong: nothing while held; the rest's own
  // issue while this letter is being written; else the draft's.
  const shownIssues = artifactStatus.ok || issueHeld
    ? []
    : restOfTablet && !restOfTablet.ok ? restOfTablet.issues : artifactStatus.issues;
  const remaining = artifactStatus.ok
    ? artifactStatus.remainingCharacters
    : restOfTablet?.ok ? restOfTablet.remainingCharacters
    : pristine || issueHeld ? MAX_TURN_SUBMISSION_CHARACTERS : null;
  const overLimit = artifactStatus.ok && artifactStatus.overLimit;
  const remainingShare = Math.min(100, Math.max(0, ((remaining ?? 0) / MAX_TURN_SUBMISSION_CHARACTERS) * 100));
  const statusId = 'composer-submission-status';
  // Near the limit, the count is spoken once typing pauses (see
  // COUNT_ANNOUNCE_THRESHOLD); set from a timer, never on the keystroke.
  const [countAnnouncement, setCountAnnouncement] = useState('');
  const nearLimit = remaining !== null && !overLimit && remaining <= COUNT_ANNOUNCE_THRESHOLD;
  useEffect(() => {
    if (!nearLimit || remaining === null) return;
    const timer = setTimeout(
      () => setCountAnnouncement(`${formatCharacterCount(remaining)} characters remaining`),
      COUNT_ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [nearLimit, remaining]);
  const validationMessage = pristine || !shownIssues.length ? null : shownIssues.map(issue => issue.message).join(' ');

  useEffect(() => {
    const textarea = chatTextareaRef.current;
    if (mode !== 'chat' || !textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [chatDraft, mode]);

  /** The writing surface of whichever mode is up. */
  const focusTablet = useCallback(() => {
    const target = mode === 'chat'
      ? chatTextareaRef.current
      : composerRef.current?.querySelector<HTMLElement>(`#${STRUCTURED_INPUT_ELEMENT_ID}`);
    target?.focus();
  }, [mode]);

  useEffect(() => {
    if (locked || !restoreFocusOnUnlockRef.current) return;
    restoreFocusOnUnlockRef.current = false;
    // Only reclaim focus nobody else holds: a fate's EventModal (or any other
    // dialog) that opened with the new week keeps what it took.
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    focusTablet();
  }, [locked, focusTablet]);

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
  /**
   * Item 49: the send is held while the roads are shut, and the hold lives
   * HERE rather than on the Speak button's `disabled` alone — Enter-to-send,
   * the form's own submit and the structured ⌃⏎ shortcut all arrive through
   * these two functions and each one used to walk straight past an offline
   * gate that was only ever painted on one button. With no key on the device
   * (D34) the send is held the same way; the standing no-key notice above
   * says why and names what works.
   */
  const composerHoldsFocus = () => Boolean(composerRef.current?.contains(document.activeElement));
  const submitChat = () => {
    if (online && canReachTheFates && !locked && artifactStatus.ok && !overLimit && chatDraft.trim()) {
      restoreFocusOnUnlockRef.current = composerHoldsFocus();
      onSubmit(chatDraft);
      stampSeal();
    }
  };
  const submitStructured = () => {
    if (online && canReachTheFates && !locked && artifactStatus.ok && !overLimit) {
      restoreFocusOnUnlockRef.current = composerHoldsFocus();
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
    : openScene
    ? TURN_COMPOSER_COPY.scenePlaceholder(openScene.npcName)
    : disabled
    ? "Awaiting the Senate's judgment..."
    : 'Enter your action... (Shift+Enter for new line)';
  const sceneHoldId = 'composer-scene-hold';
  const sceneHold = openScene && !isProcessing
    ? (openScene.awaitingLastWord ? TURN_COMPOSER_COPY.sceneLastWord : TURN_COMPOSER_COPY.sceneOpen)(openScene.npcName)
    : null;

  return (
    // A column that may shrink under the chronicle (App.tsx's desk): only
    // the Structured registers give way, scrolling within themselves.
    <div ref={composerRef} className="gor-composer" style={{ flex: '0 1 auto', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Item 46: said before the week is written, not after it is lost. */}
      {!canReachTheFates && onOpenSettings && onEnableMockMode && (
        <TurnFailureNotice
          failure={{ kind: 'no_key' }}
          onEditTheWeek={() => {}}
          onOpenSettings={onOpenSettings}
          onEnableMockMode={() => {
            onEnableMockMode();
            // The notice goes, and the pressed control with it; the tablet
            // the player can now write on takes focus instead of <body>.
            if (!locked) focusTablet();
          }}
        />
      )}
      {suggestedActions.length > 0 && (
        // A labelled group, so a screen reader hears "Counsel" once on the
        // way in rather than a run of loose buttons. The label stays the
        // group's name even where the narrow layout hides it.
        <div className="gor-composer-pills" role="group" aria-labelledby={COUNSEL_LABEL_ID}>
          <span id={COUNSEL_LABEL_ID} className="gor-label gor-composer-pills-label">{TURN_COMPOSER_COPY.counsel}</span>
          {suggestedActions.map((action, index) => (
            <ActionPill key={action} aria-label={action} delay={index * 80} disabled={locked}
              {...{ [SUGGESTION_INDEX_ATTRIBUTE]: index }}
              onClick={() => {
                // Counsel adds to the week, in either mode; it never replaces
                // what the player wrote, which no undo could bring back.
                if (mode === 'structured') onStructuredDraftChange(appendSuggestedAction(structuredDraft, action));
                else onChatDraftChange(chatDraft.trim() ? `${chatDraft.trimEnd()}\n${action}` : action);
              }}>{action}</ActionPill>
          ))}
        </div>
      )}
      <div className="gor-composer-bar">
        <SegmentedControl
          ariaLabel="Composer mode"
          options={COMPOSER_MODE_OPTIONS}
          value={mode}
          onChange={selectMode}
          disabled={locked}
        />
        {tools && <div className="gor-composer-tools">{tools}</div>}
      </div>
      {/* Beneath the Private scene opener it names: what holds the tablet. */}
      {sceneHold && <p id={sceneHoldId} className="gor-hint" style={{ margin: 0 }}>{sceneHold}</p>}
      {/* The one voice for a week's progress. The loom in the chronicle
          draws the same stage and is hidden from assistive tech, so a screen
          reader hears each stage once, here, beside where the week was sent.
          The region is always in the DOM - visually hidden and empty while
          idle - because a live region created together with its message is
          often never announced, which cost the first stage every turn. */}
      <p className={isProcessing ? 'gor-hint' : 'gor-sr-only'} role="status" aria-live="polite" style={{ margin: 0 }}>
        {isProcessing ? TURN_STAGE_STATUS_COPY[turnStage ?? 'story_relevance'] : ''}
      </p>
      {/* The near-limit count, spoken after a pause. Always present, like the
          stage line above, for the same reason. */}
      <p className="gor-sr-only" aria-live="polite" aria-atomic="true">{countAnnouncement}</p>
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
              aria-describedby={sceneHold ? `${statusId} ${sceneHoldId}` : statusId}
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
              // The count describes the tablet (aria-describedby) and is read
              // with it; it is NOT a live region. As one it re-announced
              // itself after every keystroke - the chatter the GOV.UK character
              // count pattern exists to prevent. Near the limit it is spoken
              // after a pause (COUNT_ANNOUNCE_THRESHOLD); going over the limit,
              // or an invalid draft, interrupts as an alert (the branches above).
              <p id={statusId} className="gor-hint" style={{ margin: 0 }}>{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            )}
            {/* Named by what it says (WCAG 2.5.3): a player who speaks
                "Speak" - or, offline, "Hold until the roads reopen" -
                reaches it. */}
            <Button
              type="submit"
              disabled={!online || !canReachTheFates || locked || overLimit || !artifactStatus.ok || !chatDraft.trim()}
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
              <p id={statusId} className="gor-gauge-count">{formatCharacterCount(remaining ?? 0)} characters remaining</p>
            </div>
          )}
          {/* The registers scroll within the desk when they outgrow it, so
              the chronicle above keeps its reading height (design/shell.css). */}
          <div className="gor-register-scroll" style={{ position: 'relative' }}>
            <StructuredTurnComposer draft={structuredDraft} recipientOptions={recipientOptions} disabled={locked} online={online} submissionBlocked={overLimit || !artifactStatus.ok || !online || !canReachTheFates}
              aggregateIssue={overLimit} validationIssues={shownIssues} statusId={statusId}
              onLetterFocus={setWritingLetter}
              // Tried to send an unfinished letter: its issue is shown now.
              onSubmitBlocked={() => setWritingLetter(null)}
              onChange={onStructuredDraftChange} onSubmit={submitStructured} />
            {waxSeal}
          </div>
        </>
      )}
    </div>
  );
};
