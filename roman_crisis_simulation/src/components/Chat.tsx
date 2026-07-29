import React from 'react';
import { Message } from '../types';
import { TurnStage } from '../ai/core/turn';
import { structuredSubmissionForHistory, TurnSubmissionHistory } from './TurnSubmissionHistory';
import { deserializeTurnSubmission } from '../playerInput/turnSubmission';
import { TurnRibbon } from './ui/Brand';
import { toSegments } from './textFormat';

// Themed status copy for the "thinking" theater (ROADMAP_0_MASTER_PLAN.md
// Phase 3 item 1) - one line per real `runNewTurn` pipeline step (see
// ai/core/turn.ts's `TurnStage`), shown live as the ACTUAL stage the
// pipeline just entered, replacing the old timer-based random rotation.
export const TURN_STAGE_STATUS_COPY: Record<TurnStage, string> = {
    story_relevance: 'The chronicler surveys the week…',
    npc_minds: 'Behind shuttered doors, minds settle on their designs…',
    adjudication: 'Your rivals move in the dark…',
    mortality: 'The Fates weigh a life…',
    simulation_state: 'Couriers ride from the frontier…',
    monologue: 'Your own thoughts gather…',
    narration: 'The chronicler sets down the day…',
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
 * The pipeline order `runNewTurn` reports its stages in — the loom's thread
 * order, left to right. Kept as an explicit list rather than derived from
 * TURN_STAGE_STATUS_COPY's key order so the visual order is a stated fact
 * and adding a stage to the copy map cannot silently reshuffle the threads.
 * `npc_minds` and `mortality` can be skipped on a given turn (see
 * `TurnStage`'s doc comment); a skipped stage's thread simply lights as the
 * pipeline passes it.
 */
const TURN_STAGE_ORDER: readonly TurnStage[] = [
    'story_relevance',
    'npc_minds',
    'adjudication',
    'mortality',
    'simulation_state',
    'monologue',
    'narration',
];

/** The one thread the Fates cut — drawn in crimson, not gold. */
const MORTALITY_STAGE: TurnStage = 'mortality';

/**
 * The Fates' loom: the seven live pipeline stages `runNewTurn` already
 * reports, drawn as seven threads on a dark ground while the Game Master
 * works. Threads to the left of the current stage are woven (dimmed), the
 * current one is weaving, and the mortality thread is crimson so a life
 * being weighed is visible without reading a word.
 *
 * Bound to the same `stage` prop the old three-dot indicator took — no new
 * API and no new state. Reduced motion renders every woven thread at its
 * final height with no movement (see components.css).
 */
export const TypingIndicator: React.FC<{ stage?: TurnStage | null }> = ({ stage = null }) => {
    const statusText = getStageStatusText(stage);
    // An unreported stage (Mock Mode, or the instant before the first
    // onStage lands) reads as the first thread, matching DEFAULT_PROCESSING_STATUS.
    const reportedIndex = stage ? TURN_STAGE_ORDER.indexOf(stage) : -1;
    const activeIndex = reportedIndex < 0 ? 0 : reportedIndex;

    return (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 14 }}>
            <div className="gor-loom" role="status" aria-live="polite">
                <div className="gor-loom-threads" aria-hidden="true">
                    {TURN_STAGE_ORDER.map((name, index) => (
                        <div
                            key={name}
                            className={`gor-loom-thread${name === MORTALITY_STAGE ? ' gor-loom-thread-fated' : ''}`}
                        >
                            {index <= activeIndex && (
                                <span className={`gor-loom-fill${index < activeIndex ? ' gor-loom-fill-woven' : ''}`} />
                            )}
                        </div>
                    ))}
                </div>
                <div className="gor-loom-status">
                    <span className="gor-loom-text">{statusText}</span>
                    <span className="gor-loom-count" aria-hidden="true">{activeIndex + 1} of {TURN_STAGE_ORDER.length}</span>
                </div>
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
    const historySubmission = isPlayer ? structuredSubmissionForHistory(message.text) : null;
    const parsedPlayerSubmission = isPlayer ? deserializeTurnSubmission(message.text) : null;
    const playerText = parsedPlayerSubmission?.kind === 'freeform' ? parsedPlayerSubmission.text : message.text;
    return (
        <div style={{ display: 'flex', justifyContent: isPlayer ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
            <div className={`gor-msg ${isPlayer ? 'gor-msg-player' : 'gor-msg-gm'}`}>
                {historySubmission && historySubmission.kind !== 'freeform'
                    ? <TurnSubmissionHistory submission={historySubmission} audience="player" />
                    : <FormattedText text={playerText} />}
            </div>
        </div>
    );
};

// The old ChatInput / ActionPills components lived here until the
// TurnComposer took over the input surface — their styling (auto-grow
// textarea, themed placeholders, ActionPill row) now lives in
// components/TurnComposer.tsx.
