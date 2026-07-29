import React, { useState } from 'react';
import { EventHistoryEntry, TurnHistoryEntry } from '../../types';
import { toRoman } from '../ui/Brand';
import { SubRail } from '../ui/SubRail';
import { buildChronicleSpine, ChronicleRow } from './chronicleSpine';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';

const REGISTERS = ['reign', 'fates'] as const;
type ChronicleRegister = typeof REGISTERS[number];

const MARKER_CLASS: Record<ChronicleRow['marker'], string> = {
    week: 'gor-spine-mark',
    fate: 'gor-spine-mark gor-spine-mark-fate',
    end: 'gor-spine-mark gor-spine-mark-end',
    collapsed: 'gor-spine-mark gor-spine-mark-collapsed',
};

const SpineRow: React.FC<{ row: ChronicleRow }> = ({ row }) => {
    const [unrolled, setUnrolled] = useState(false);
    return (
        <>
            <div className="gor-spine-row">
                <span className={MARKER_CLASS[row.marker]} aria-hidden="true" />
                <span className="gor-label" style={{ color: 'var(--gold-700)' }}>
                    {row.weekLabel}
                    {row.badge && <span className={`gor-spine-badge${row.marker === 'end' ? ' gor-spine-badge-end' : ''}`}>{row.badge}</span>}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text-heading)' }}>{row.headline}</span>
                {row.order && <span style={{ fontSize: 14 }}>Your order: <em>“{row.order}”</em></span>}
                {row.collapsed && (
                    <button type="button" className="gor-glossary-toggle" aria-expanded={unrolled} onClick={() => setUnrolled(open => !open)}>
                        {unrolled ? 'Roll them up' : 'Unroll them'}
                    </button>
                )}
            </div>
            {unrolled && row.collapsed?.slice().reverse().map(inner => <SpineRow key={inner.key} row={inner} />)}
        </>
    );
};

/**
 * The chronicle (audit item 37). It used to be fed only by `eventHistory` —
 * the handful of AUTHORED fate events — so fourteen weeks of play yielded
 * three entries, and the gold rule repeated per entry instead of running as
 * one spine, so it read as unrelated blocks.
 *
 * **The Reign** is now the default register, built from `turnHistory` (which
 * the app already stores): every week, its headline, and the order you gave,
 * hung off one continuous spine. Quiet stretches collapse into a single
 * unrollable row so a forty-week reign stays scannable. **The Fates** keeps
 * the authored-event view exactly as it was.
 */
const ChronicleTab: React.FC<{
    eventHistory: EventHistoryEntry[];
    turnHistory: TurnHistoryEntry[];
    /** Marks the final week crimson — the caller knows the player has died; this tab does not guess it. */
    reignEnded?: boolean;
}> = ({ eventHistory, turnHistory, reignEnded = false }) => {
    const [register, setRegister] = useState<ChronicleRegister>(() => getTabRegister('chronicle', REGISTERS, 'reign'));
    const spine = buildChronicleSpine(turnHistory, eventHistory, reignEnded);

    const selectRegister = (next: ChronicleRegister) => {
        setRegister(next);
        setTabRegister('chronicle', next);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SubRail
                ariaLabel="Chronicle register"
                value={register}
                onChange={selectRegister}
                options={[
                    { value: 'reign', label: 'The Reign', count: turnHistory.length },
                    { value: 'fates', label: 'The Fates', count: eventHistory.length },
                ]}
            />
            {register === 'reign' ? (
                spine.length === 0
                    ? <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>Your chronicle is yet unwritten. Act, and the scribes will follow.</p>
                    : <div className="gor-spine">{spine.map(row => <SpineRow key={row.key} row={row} />)}</div>
            ) : (
                <>
                    <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Chronicle of Events</h3>
                    {eventHistory.length === 0 && (
                        <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>No fate has yet forced your hand.</p>
                    )}
                    {eventHistory.slice().reverse().map((entry, index) => (
                        <div key={`${entry.eventId}-${index}`} style={{ borderLeft: '2px solid var(--gold-500)', paddingLeft: 14, marginLeft: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="gor-label" style={{ color: 'var(--gold-700)' }}>Turn {toRoman(entry.turnNumber)}</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text-heading)' }}>{entry.eventTitle}</span>
                            <span style={{ fontSize: 14 }}>Your choice: <em>“{entry.choiceText}”</em></span>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

export default ChronicleTab;
