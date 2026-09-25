import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/Core';
import { createFocusTrap, type FocusTrap } from './ui/focusTrap';
import type { NarrationLogEntry } from '../narration/narrationLog';
import { voiceStyleLabel } from '../narration/voiceStyle';
import type { NarrationLogControlState } from '../hooks/useNarrationLog';

/** Player-visible copy for the narration log (veto-queue: roadmaps/BACKLOG.md B13). */
export const NARRATION_LOG_COPY = {
    open: 'Narration log',
    title: 'Narration log',
    close: 'Close the narration log',
    intro: 'Every performance, kept as text on this device. Never part of your save.',
    empty: 'Nothing has been performed yet.',
    from: 'From',
    omitted: (n: number) => `Omitted: ${n} ${n === 1 ? 'line' : 'lines'} the chronicle did not support`,
    plain: 'The chronicle’s own words were voiced.',
    play: 'Hear it again',
    stop: 'Stop',
    preparing: 'The voice draws breath…',
    error: 'The voice faltered — press again.',
    unavailable: 'No token on this device',
    copy: 'Copy text',
    /** Read to screen readers before each performance cue in a script. */
    cue: 'Performance cue',
    copied: 'Copied.',
    copyFailed: 'Could not copy.',
    clear: 'Clear log',
    confirmClear: 'Clear every entry? This cannot be undone.',
    confirm: 'Clear',
    keep: 'Keep',
} as const;

/**
 * A logged transcript as the player reads it: the spoken words as plain
 * text, each `<cue>` of an acted script (narration/performanceScript.ts) set
 * apart - italic, muted, its angle brackets shown but hidden from screen
 * readers, which hear "Performance cue:" instead. A transcript with no cues
 * (the Imperial Dispatch, a private-scene line, an entry logged before
 * scripts carried cues) renders exactly as its text.
 */
export const ScriptText: React.FC<{ transcript: string }> = ({ transcript }) => {
    const parts = transcript.split(/<([^<>\n]+)>/g);
    if (parts.length === 1) return <>{transcript}</>;
    return (
        <>
            {parts.map((part, i) => (i % 2 === 0
                ? (part ? <React.Fragment key={i}>{part}</React.Fragment> : null)
                : (
                    <em key={i} className="gor-narration-log-cue">
                        <span className="gor-sr-only">{NARRATION_LOG_COPY.cue}: </span>
                        <span aria-hidden="true">‹</span>{part.trim()}<span aria-hidden="true">›</span>
                    </em>
                )))}
        </>
    );
};

const EntryView: React.FC<{
    entry: NarrationLogEntry;
    state: NarrationLogControlState;
    onToggle: () => void;
}> = ({ entry, state, onToggle }) => {
    const [copyStatus, setCopyStatus] = useState<string | null>(null);
    const headingId = `narration-log-${entry.id}`;
    const engaged = state === 'preparing' || state === 'playing';
    const status = state === 'preparing' ? NARRATION_LOG_COPY.preparing
        : state === 'error' ? NARRATION_LOG_COPY.error
            : state === 'unavailable' ? NARRATION_LOG_COPY.unavailable
                : null;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(entry.transcript);
            setCopyStatus(NARRATION_LOG_COPY.copied);
        } catch {
            setCopyStatus(NARRATION_LOG_COPY.copyFailed);
        }
    };
    return (
        <li className="gor-narration-log-entry">
            <article aria-labelledby={headingId}>
                <h3 id={headingId} className="gor-narration-log-source">{entry.sourceLabel}</h3>
                <p className="gor-narration-log-meta">
                    {entry.narratorName} · {entry.voice} · {voiceStyleLabel(entry.voiceStyle)}
                </p>
                {entry.sourceExcerpt && (
                    <p className="gor-narration-log-excerpt"><span className="gor-sr-only">{NARRATION_LOG_COPY.from}: </span>“{entry.sourceExcerpt}”</p>
                )}
                <p className="gor-narration-log-transcript"><ScriptText transcript={entry.transcript} /></p>
                {entry.patchedOut.length > 0 && (
                    <details className="gor-narration-log-omitted">
                        <summary>{NARRATION_LOG_COPY.omitted(entry.patchedOut.length)}</summary>
                        <ul>{entry.patchedOut.map((line, i) => <li key={i}><ScriptText transcript={line} /></li>)}</ul>
                    </details>
                )}
                {entry.usedFallback && entry.kind === 'chronicle' && (
                    <p className="gor-narration-log-note">{NARRATION_LOG_COPY.plain}</p>
                )}
                <div className="gor-voice gor-narration-log-actions">
                    <button
                        type="button"
                        className="gor-voice-btn"
                        aria-pressed={engaged}
                        aria-busy={state === 'preparing' || undefined}
                        disabled={state === 'unavailable'}
                        title={engaged ? NARRATION_LOG_COPY.stop : undefined}
                        onClick={onToggle}
                    >
                        <span className="gor-voice-glyph" aria-hidden="true">
                            {state === 'preparing' ? <span className="gor-voice-spinner" /> : state === 'playing' ? '■' : '▶'}
                        </span>
                        {NARRATION_LOG_COPY.play}
                    </button>
                    <button type="button" className="gor-voice-btn" onClick={() => void copy()}>{NARRATION_LOG_COPY.copy}</button>
                    <span className="gor-voice-status" aria-live="polite">{status ?? copyStatus ?? ''}</span>
                </div>
            </article>
        </li>
    );
};

/**
 * The narration log (narration/narrationLog.ts, hooks/useNarrationLog.ts):
 * an affordance at the foot of the game screen that opens a gor-dialog
 * listing every performance, newest first - source, narrator and voice, the
 * acted script with its cues set apart (`ScriptText`), what the fidelity
 * patch left out, replay and copy (the script, cues included) - with a
 * two-step "Clear log". Same dialog contract as Settings: focus moves in on
 * open, Tab is trapped (components/ui/focusTrap.ts), Escape closes, focus
 * returns to the opener.
 */
export const NarrationLog: React.FC<{
    entries: readonly NarrationLogEntry[];
    stateFor: (entry: NarrationLogEntry) => NarrationLogControlState;
    onToggle: (entry: NarrationLogEntry) => void;
    onClear: () => void;
    /** Called as the panel closes, so a replay stops with it. */
    onClose?: () => void;
}> = ({ entries, stateFor, onToggle, onClear, onClose }) => {
    const [open, setOpen] = useState(false);
    const [confirmingClear, setConfirmingClear] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const trapRef = useRef<FocusTrap | null>(null);

    useEffect(() => {
        if (!open || !dialogRef.current) return;
        const trap = createFocusTrap(dialogRef.current);
        trapRef.current = trap;
        trap.activate();
        return () => {
            trap.release();
            trapRef.current = null;
        };
    }, [open]);

    const close = () => {
        setOpen(false);
        setConfirmingClear(false);
        onClose?.();
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        trapRef.current?.handleKeyDown(event);
    };

    return (
        <>
            <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">{NARRATION_LOG_COPY.open}</Button>
            {/* Portalled to <body>: rendered inside the composer, the backdrop sat
                under the side panel's tab rail in the stacking order. */}
            {open && createPortal(
                <div className="gor-dialog-backdrop">
                    <div
                        ref={dialogRef}
                        className="gor-dialog gor-narration-log"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="narration-log-title"
                        tabIndex={-1}
                        onKeyDown={handleKeyDown}
                        style={{ maxWidth: 640 }}
                    >
                        <div className="gor-dialog-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                            <h2 id="narration-log-title" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>{NARRATION_LOG_COPY.title}</h2>
                            <button
                                type="button"
                                onClick={close}
                                aria-label={NARRATION_LOG_COPY.close}
                                style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, padding: '2px 6px' }}
                            >×</button>
                        </div>
                        <div className="gor-dialog-rule"></div>
                        <div className="gor-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>
                            <p className="gor-config-note" style={{ margin: 0 }}>{NARRATION_LOG_COPY.intro}</p>
                            {entries.length === 0 ? (
                                <p className="gor-narration-log-empty">{NARRATION_LOG_COPY.empty}</p>
                            ) : (
                                <ol className="gor-narration-log-list" aria-label={NARRATION_LOG_COPY.title}>
                                    {entries.map(entry => (
                                        <EntryView key={entry.id} entry={entry} state={stateFor(entry)} onToggle={() => onToggle(entry)} />
                                    ))}
                                </ol>
                            )}
                            {entries.length > 0 && (
                                <div className="gor-narration-log-footer">
                                    {confirmingClear ? (
                                        <span role="group" aria-label={NARRATION_LOG_COPY.confirmClear} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                            <span className="gor-narration-log-note">{NARRATION_LOG_COPY.confirmClear}</span>
                                            <Button type="button" size="sm" variant="danger" onClick={() => { onClear(); setConfirmingClear(false); }}>{NARRATION_LOG_COPY.confirm}</Button>
                                            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingClear(false)}>{NARRATION_LOG_COPY.keep}</Button>
                                        </span>
                                    ) : (
                                        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingClear(true)}>{NARRATION_LOG_COPY.clear}</Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};
