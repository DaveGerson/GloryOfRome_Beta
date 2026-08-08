import React from 'react';
import { RawCallRecord } from '../../types';
import { well, lbl } from './shared';

/**
 * The Fates' loom returns as a latency strip (WP-1, WP-12): the kit already
 * records model, milliseconds and attempts per call, so a turn's cost is
 * legible without opening the raw tab. A call that needed a retry runs
 * crimson.
 */
export const LatencyStrip: React.FC<{ rawCalls?: RawCallRecord[] }> = ({ rawCalls }) => {
    if (!rawCalls || rawCalls.length === 0) return null;
    const slowest = Math.max(1, ...rawCalls.map(call => call.latencyMs));
    return (
        <div style={{ ...well, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={lbl}>Latency — {rawCalls.length} call{rawCalls.length === 1 ? '' : 's'}, {rawCalls.reduce((sum, call) => sum + call.latencyMs, 0)}ms total</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44 }}>
                {rawCalls.map((call, index) => (
                    <div key={index} title={`${call.callName} · ${call.model} · ${call.latencyMs}ms · ${call.attempts} attempt${call.attempts > 1 ? 's' : ''}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <span
                            aria-hidden="true"
                            style={{
                                display: 'block',
                                height: `${Math.max(6, (call.latencyMs / slowest) * 100)}%`,
                                background: call.attempts > 1 ? 'var(--metal-crimson)' : 'var(--metal-gold)',
                                boxShadow: call.attempts > 1 ? '0 0 9px rgba(192,68,52,.75)' : '0 0 7px rgba(232,201,89,.6)',
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
