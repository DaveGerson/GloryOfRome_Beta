
import React, { useRef, useEffect } from 'react';
import { Message } from '../types';
import { TurnStage } from '../ai/core/turn';

// Themed status copy for the "thinking" theater (ROADMAP_0_MASTER_PLAN.md
// Phase 3 item 1) - one line per real `runNewTurn` pipeline step (see
// ai/core/turn.ts's `TurnStage`), shown live as the ACTUAL stage the
// pipeline just entered, replacing the old timer-based random rotation.
const STAGE_STATUS_COPY: Record<TurnStage, string> = {
    story_relevance: 'The chronicler surveys the week…',
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
const DEFAULT_PROCESSING_STATUS = STAGE_STATUS_COPY.story_relevance;

function getStageStatusText(stage: TurnStage | null | undefined): string {
    return stage ? STAGE_STATUS_COPY[stage] : DEFAULT_PROCESSING_STATUS;
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
        <div className="flex justify-start mb-4 animate-fade-in" aria-live="polite">
            <div className="roman-stone-panel text-stone-800 border-l-4 border-red-800 rounded-lg px-4 py-3 max-w-md flex items-center gap-3">
                <div className="flex gap-1" aria-hidden="true">
                    <span className="w-2 h-2 bg-red-800 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-red-800 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-red-800 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="italic text-sm text-stone-600">{statusText}</p>
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
        <div className="flex justify-start mb-4 animate-fade-in" aria-live="polite">
            <div className="roman-stone-panel text-stone-800 border-l-4 border-red-800 rounded-lg px-4 py-2 max-w-md">
                <p className="whitespace-pre-wrap">
                    {text}
                    <span
                        className="inline-block w-2 h-4 bg-red-800 ml-0.5 align-middle animate-pulse"
                        aria-hidden="true"
                    />
                </p>
            </div>
        </div>
    );
};

export const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
    const isGM = message.sender === 'gm';
    const isMonologue = message.sender === 'player_monologue';
    const isPlayer = message.sender === 'player';

    let messageClasses = '';
    let justification = 'justify-start';

    if (isGM) {
        messageClasses = 'roman-stone-panel text-stone-800 border-l-4 border-red-800';
        justification = 'justify-start';
    } else if (isPlayer) {
        messageClasses = 'bg-red-900 text-stone-100';
        justification = 'justify-end';
    } else if (isMonologue) {
        messageClasses = 'bg-transparent border-2 border-dashed border-stone-400 text-stone-600 italic';
        justification = 'justify-center w-full max-w-2xl mx-auto';
    }
    
    const textWithBold = message.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    return (
        <div className={`flex ${justification} mb-4 animate-fade-in`}>
            {isMonologue ? (
                <div className="text-center w-full">
                    <div className="text-stone-500 text-sm mb-1 font-decorative">Inner Thoughts</div>
                    <div className={`rounded-lg px-4 py-2 ${messageClasses}`}>
                        <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: textWithBold }} />
                    </div>
                </div>
            ) : (
                <div className={`rounded-lg px-4 py-2 max-w-md ${messageClasses}`}>
                    <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: textWithBold }} />
                </div>
            )}
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
        <form onSubmit={handleSubmit} className="p-4">
            <div className="flex items-end">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder={placeholderText}
                    className="flex-grow rounded-sm py-2 px-4 border border-[#c9c5b8] bg-white/30 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-800 resize-none max-h-40 shadow-inner"
                    aria-label="Chat input"
                    rows={1}
                />
                <button
                    type="submit"
                    disabled={disabled}
                    className="ml-4 bg-red-800 text-stone-100 rounded-sm px-6 py-2 self-stretch flex items-center justify-center hover:bg-red-700 disabled:bg-stone-400 transition-colors border border-red-900 btn-animate"
                    aria-label="Send message"
                >
                    SEND
                </button>
            </div>
        </form>
    );
};

export const ActionPills: React.FC<{ actions: string[]; onSelectAction: (action: string) => void }> = ({ actions, onSelectAction }) => {
    return (
        <div className="px-4 pt-2 pb-1 flex flex-wrap justify-center animate-fade-in">
            {actions.map((action, index) => (
                <button
                    key={index}
                    onClick={() => onSelectAction(action)}
                    className="bg-stone-300 hover:bg-red-800 hover:text-white transition-colors duration-200 text-stone-700 rounded-sm px-4 py-1.5 text-sm mr-2 mb-2 shadow-md border border-stone-400 btn-animate pill-animate"
                    style={{ animationDelay: `${index * 50}ms` }}
                >
                    {action}
                </button>
            ))}
        </div>
    );
};