import React, { useRef, useEffect } from 'react';
import { Message } from '../types';
import { TurnStage } from '../ai/core/turn';
import { ActionPill } from './ui/Game';
import { structuredSubmissionForHistory, TurnSubmissionHistory } from './TurnSubmissionHistory';
import { deserializeTurnSubmission } from '../playerInput/turnSubmission';
import { TurnRibbon } from './ui/Brand';
import { Button } from './ui/Core';
import { toSegments } from './textFormat';

// Themed status copy for the "thinking" theater (ROADMAP_0_MASTER_PLAN.md
// Phase 3 item 1) - one line per real `runNewTurn` pipeline step (see
// ai/core/turn.ts's `TurnStage`), shown live as the ACTUAL stage the
// pipeline just entered, replacing the old timer-based random rotation.
export const TURN_STAGE_STATUS_COPY: Record<TurnStage, string> = {
    story_relevance: 'The chronicler surveys the week…',
    npc_minds: 'Behind shuttered doors, minds settle on their designs…',
    adjudication: 'Your rivals move in the dark…',
    private_conversation: 'Two figures withdraw behind a curtain…',
    mortality: 'The Fates weigh a life…',
    simulation_state: 'Couriers ride from the frontier…',
    monologue: 'Your own thoughts gather…',
    narration: 'The chronicler sets down the day…',
    relationship_updates: 'Loyalties quietly shift…',
};

// Shown whenever PROCESSING is true but no stage has been reported yet -
// e.g. the brief instant before runNewTurn's first onStage call lands, or
// Mock Mode's mockRunNewTurn, which resolves near-instantly and never
// reports a stage at all (see App.tsx's executeTurn). Never left blank.
const DEFAULT_PROCESSING_STATUS = TURN_STAGE_STATUS_COPY.story_relevance;

function getStageStatusText(stage: TurnStage | null | undefined): string {
    return stage ? TURN_STAGE_STATUS_COPY[stage] : DEFAULT_PROCESSING_STATUS;
}

/**
 * A visible, animated "typing" bubble shown in the message stream while the
 * Game Master is processing a turn — makes the 30-60s wait feel alive
 * instead of frozen. The status line now reflects the REAL pipeline stage
 * (`stage`, from `runNewTurn`'s `onStage` callback via App.tsx) rather than
 * a timer-driven rotation through generic copy.
 */
export const TypingIndicator: React.FC<{ stage?: TurnStage | null }> = ({ stage = null }) => {
    const statusText = getStageStatusText(stage);

    return (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 14 }}>
            <div className="gor-typing" role="status" aria-live="polite">
                <span className="gor-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span className="gor-typing-text">{statusText}</span>
            </div>
        </div>
    );
};

/**
 * A transient, in-progress GM bubble that fills with the narration call's
 * streamed text as it arrives (ROADMAP_0_MASTER_PLAN.md Phase 3 item 2) -
 * NOT a `Message` and never added to the committed `messages` list; App.tsx
 * renders this only while `gameState === PROCESSING` and swaps it for the
 * real, final `ChatMessage` the instant the turn commits (or clears it on
 * any error - see App.tsx's executeTurn). `text` arrives already gated
 * (see ai/core/streamSplit.ts) - a trailing `SUGGESTION:` block can never
 * leak in here.
 */
export const StreamingNarrationBubble: React.FC<{ text: string }> = ({ text }) => {
    if (!text) return null;

    return (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 14 }} aria-live="polite">
            <div className="gor-msg gor-msg-gm">
                {text}
                <span
                    aria-hidden="true"
                    style={{ display: 'inline-block', width: 8, height: 17, background: 'var(--crimson-500)', marginLeft: 2, verticalAlign: 'middle', animation: 'gorEmber 1.2s ease-in-out infinite' }}
                />
            </div>
        </div>
    );
};

/**
 * Renders **bold** only; everything else is plain text rendered as React
 * text nodes, so it is escaped-by-construction - no HTML parsing ever runs
 * on model/narration output. See ./textFormat.ts.
 */
const FormattedText: React.FC<{ text: string }> = ({ text }) => (
    <>
        {toSegments(text).map((segment, i) =>
            segment.bold ? <strong key={i}>{segment.text}</strong> : <React.Fragment key={i}>{segment.text}</React.Fragment>
        )}
    </>
);

export const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
    if (message.sender === 'ribbon') {
        return <TurnRibbon>{message.text}</TurnRibbon>;
    }

    if (message.sender === 'player_monologue') {
        return (
            <div style={{ width: '100%', maxWidth: 640, margin: '0 auto 14px' }}>
                <div className="gor-msg-kicker">Inner Thoughts</div>
                <div className="gor-msg gor-msg-monologue" style={{ maxWidth: 'none' }}><FormattedText text={message.text} /></div>
            </div>
        );
    }

    const isPlayer = message.sender === 'player';
    const structuredSubmission = isPlayer ? structuredSubmissionForHistory(message.text) : null;
    const parsedPlayerSubmission = isPlayer ? deserializeTurnSubmission(message.text) : null;
    const playerText = parsedPlayerSubmission?.kind === 'freeform' ? parsedPlayerSubmission.text : message.text;
    return (
        <div style={{ display: 'flex', justifyContent: isPlayer ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
            <div className={`gor-msg ${isPlayer ? 'gor-msg-player' : 'gor-msg-gm'}`}>
                {structuredSubmission
                    ? <TurnSubmissionHistory submission={structuredSubmission} audience="player" />
                    : <FormattedText text={playerText} />}
            </div>
        </div>
    );
};

export const ChatInput: React.FC<{
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    disabled: boolean;
    isProcessing?: boolean;
    /** The pipeline's current stage while `isProcessing` - drives the same themed copy as `TypingIndicator`. */
    turnStage?: TurnStage | null;
    /**
     * Overrides the computed placeholder outright (e.g. the Phase 2
     * dead-player stopgap's "Your story has ended." - see App.tsx). Takes
     * priority over the processing/disabled copy below.
     */
    placeholderOverride?: string;
}> = ({ value, onChange, onSubmit, disabled, isProcessing = false, turnStage = null, placeholderOverride }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [value]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !disabled) {
                onSubmit();
            }
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value.trim() && !disabled) {
            onSubmit();
        }
    };

    const placeholderText = placeholderOverride
        ? placeholderOverride
        : isProcessing
        ? getStageStatusText(turnStage)
        : disabled
        ? "Awaiting the Senate's judgment..."
        : "Enter your action... (Shift+Enter for new line)";

    return (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexGrow: 1 }}>
            <textarea
                id="chat-input"
                ref={textareaRef}
                className="gor-textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={placeholderText}
                style={{ flex: 1, resize: 'none', maxHeight: 160, overflowY: 'auto' }}
                aria-label="Chat input"
                rows={1}
            />
            <Button type="submit" disabled={disabled || !value.trim()} aria-label="Send message">
                Speak
            </Button>
        </form>
    );
};

export const ActionPills: React.FC<{ actions: string[]; onSelectAction: (action: string) => void }> = ({ actions, onSelectAction }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
        {actions.map((action, index) => (
            <ActionPill key={index} delay={index * 80} onClick={() => onSelectAction(action)}>
                {action}
            </ActionPill>
        ))}
    </div>
);
