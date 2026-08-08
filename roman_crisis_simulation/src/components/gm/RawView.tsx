import React, { useState } from 'react';
import { Adjudication, RawCallRecord } from '../../types';
import { MAX_CAPTURED_PROMPT_CHARS } from '../../ai/core/geminiService';
import { well, lbl, GmNote, tyrian, TYRIAN_KICKER, GOLD, DIM, PARCH, RED, GREEN, MONO } from './shared';

/** validated / attempt N / invalid json — the flag the rail sorts anomalies by. */
function callFlag(call: RawCallRecord): { word: string; color: string; bad: boolean } {
    if (!call.validated) return { word: 'invalid json', color: RED, bad: true };
    if (call.attempts > 1) return { word: `attempt ${call.attempts}`, color: '#E9B36A', bad: false };
    return { word: 'validated', color: GREEN, bad: false };
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => (
    <button
        type="button"
        onClick={() => { void navigator.clipboard?.writeText(text); }}
        style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: DIM }}
    >
        Copy
    </button>
);

const RawRegister: React.FC<{ title: string; meta: string; body: string; tyrian?: boolean }> = ({ title, meta, body, tyrian: isTyrian = false }) => (
    <details style={{ ...well, ...(isTyrian ? tyrian : {}) }}>
        <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span style={{ ...lbl, color: isTyrian ? TYRIAN_KICKER : GOLD }}>{title}</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{meta}</span>
        </summary>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><CopyButton text={body} /></div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 0', fontFamily: MONO, fontSize: 11.5, lineHeight: 1.55, color: PARCH }}>{body}</pre>
    </details>
);

/**
 * Which round-trips this turn took, and what was sent. A schema-repair retry
 * is pushed as its own record under the same `callName`; the rail is where
 * that pair finally sits next to itself.
 */
export const RawView: React.FC<{ adjudication: Adjudication; rawCalls?: RawCallRecord[] }> = ({ adjudication, rawCalls }) => {
    const calls = rawCalls ?? [];
    const [selected, setSelected] = useState(0);
    const call = calls[Math.min(selected, calls.length - 1)];
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {calls.length > 0 && (
                <nav aria-label="Raw calls" style={{ flex: 'none', width: 250, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {calls.map((record, index) => {
                        const flag = callFlag(record);
                        const active = record === call;
                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setSelected(index)}
                                aria-current={active ? 'true' : undefined}
                                style={{ all: 'unset', cursor: 'pointer', padding: '7px 9px', borderLeft: `3px solid ${flag.bad ? 'var(--metal-crimson)' : active ? 'var(--gold-500)' : 'transparent'}`, background: active ? 'rgba(201,162,39,.08)' : 'transparent' }}
                            >
                                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: MONO, fontSize: 11.5, color: PARCH }}>
                                    <span>{record.callName}</span>
                                    <span style={{ color: DIM }}>{record.latencyMs}ms</span>
                                </span>
                                <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: DIM }}>
                                    {record.model} · <span style={{ color: flag.color }}>{flag.word}</span>
                                </span>
                            </button>
                        );
                    })}
                </nav>
            )}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {call ? (
                    <>
                        <RawRegister
                            tyrian
                            title="System instruction"
                            meta={call.systemInstruction ? `${call.systemInstruction.length} chars` : 'not captured'}
                            body={call.systemInstruction ?? 'Not captured — this record was restored from a save, which never carries prompt text.'}
                        />
                        <RawRegister
                            title="Prompt as sent"
                            meta={`${call.promptChars} chars · captured to ${MAX_CAPTURED_PROMPT_CHARS.toLocaleString()}`}
                            body={call.promptText ?? 'Not captured — this record was restored from a save, which never carries prompt text.'}
                        />
                        <RawRegister
                            title="Response"
                            meta={`${call.validated ? 'validated' : 'NOT validated'} · ${call.rawResponse.length} chars`}
                            body={call.rawResponse}
                        />
                    </>
                ) : (
                    <GmNote>No raw calls captured for this turn.</GmNote>
                )}
                <details style={{ ...well, fontFamily: MONO, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', color: GOLD }}>Parsed adjudication</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0', color: PARCH }}>{JSON.stringify(adjudication, null, 2)}</pre>
                </details>
            </div>
        </div>
    );
};
