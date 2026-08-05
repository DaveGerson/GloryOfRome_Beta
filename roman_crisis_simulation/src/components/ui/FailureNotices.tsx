import React, { useEffect, useState } from 'react';
import { Alert, RECORD_REFUSES } from './Alert';
import { Button } from './Core';
import { toRoman } from './Brand';

/**
 * Every failure the player can meet (WP-21, audit items 46–49), in one
 * voice. Seven distinct failures used to reach them as two sentences.
 *
 * **The grammar.** Every notice states three things:
 *
 *  1. *what happened*, in the world's voice and specific to this failure;
 *  2. *what is kept* — the draft, the week, the reign. Name the last safe
 *     thing, always;
 *  3. *what to press* — one primary that can plausibly work. Never a bare
 *     "try again", which is what the single sentence offered.
 *
 * **Nothing is modal.** A failure never takes the room: the player's own
 * unsent words are the most valuable thing on the screen, and they stay
 * visible and editable in every one of these states, offline included.
 *
 * **Nothing GM-side leaks.** `debugSnippet`, `gm_private`, prompts, seeds
 * and mortality rolls stay GM-console-side (D4/D5). Nothing in this module
 * accepts them.
 */

/** How a turn failed. The copy lives here, not at the call site. */
export type TurnFailure =
  | { kind: 'transient'; attempts?: number }
  | { kind: 'fatal' }
  | { kind: 'no_key' }
  | { kind: 'offline' };

/** `retryTransient` spends three attempts at 1s/2s/4s before it gives up. */
export const TRANSIENT_ATTEMPT_BUDGET = 3;

const Pips: React.FC<{ spent: number }> = ({ spent }) => (
  <span className="gor-pips" aria-hidden="true">
    {Array.from({ length: TRANSIENT_ATTEMPT_BUDGET }, (_, index) => (
      <span key={index} className={`gor-pip${index < spent ? ' gor-pip-spent' : ''}`} />
    ))}
  </span>
);

/**
 * The retry itself is the existing "↻ Retry the last action" control below
 * this notice — the one affordance that also serves a failed private scene
 * and a failed observation commit. This notice carries the EVIDENCE the
 * player never had: that the attempt was made three times, on a schedule,
 * before anyone was told.
 *
 * `attempts` defaults to the full budget because it is correct by
 * construction: `retryTransient` only throws transient once every attempt
 * is spent.
 */
const TransientNotice: React.FC<{ attempts: number }> = ({ attempts }) => (
  <Alert
    tone="bronze"
    title="The couriers were turned back"
    actions={
      <>
        <Pips spent={Math.min(attempts, TRANSIENT_ATTEMPT_BUDGET)} />
        <span className="gor-evidence">{attempts} attempts, 1s · 2s · 4s apart</span>
      </>
    }
  >
    The roads to the Fates would not carry your week. Your draft is kept exactly as you wrote it,
    and the week has not turned — send it again when you are ready.
  </Alert>
);

const FatalNotice: React.FC<{ onEditTheWeek: () => void; onOpenLedger?: () => void }> = ({ onEditTheWeek, onOpenLedger }) => (
  <Alert
    tone="crimson"
    title="The Fates could not read the omens"
    actions={
      <>
        <Button size="sm" onClick={onEditTheWeek}>Edit the week</Button>
        {/* Only where the console is already enabled — never an invitation
            to GM material for a player who has not opened that door (D7). */}
        {onOpenLedger && <Button size="sm" variant="ghost" onClick={onOpenLedger}>Open the Fates' ledger</Button>}
      </>
    }
  >
    They will not read these same words differently. Your draft is kept and the week has not turned —
    change what you asked for, and send it again.
  </Alert>
);

const NoKeyNotice: React.FC<{ onOpenSettings: () => void; onEnableMockMode: () => void }> = ({ onOpenSettings, onEnableMockMode }) => (
  <Alert
    tone="bronze"
    title="No token on this device"
    actions={
      <>
        <Button size="sm" onClick={onOpenSettings}>Enter your key</Button>
        <Button size="sm" variant="ghost" onClick={onEnableMockMode}>Play against canned responses</Button>
      </>
    }
  >
    Nothing can be sent to the Fates until this device carries a key. Your reign, your draft and
    everything you have written are untouched.
  </Alert>
);

const OfflineNotice: React.FC = () => (
  <Alert tone="bronze" title="No word can leave the city">
    The roads are shut. Keep writing the week — it is kept here, and it will send when they reopen.
  </Alert>
);

/** The one turn-failure surface. Which notice it is, is `failure.kind`. */
export const TurnFailureNotice: React.FC<{
  failure: TurnFailure;
  onEditTheWeek: () => void;
  onOpenSettings: () => void;
  onEnableMockMode: () => void;
  onOpenLedger?: () => void;
}> = ({ failure, onEditTheWeek, onOpenSettings, onEnableMockMode, onOpenLedger }) => {
  switch (failure.kind) {
    case 'transient':
      return <TransientNotice attempts={failure.attempts ?? TRANSIENT_ATTEMPT_BUDGET} />;
    case 'fatal':
      return <FatalNotice onEditTheWeek={onEditTheWeek} onOpenLedger={onOpenLedger} />;
    case 'no_key':
      return <NoKeyNotice onOpenSettings={onOpenSettings} onEnableMockMode={onEnableMockMode} />;
    case 'offline':
      return <OfflineNotice />;
  }
};

/**
 * A write that would not land. All five save sites pass their own lead
 * sentence and share the rest — one failure, one name (`RECORD_REFUSES`).
 *
 * This notice deliberately offers NO "take a copy" escape hatch. One was
 * built and removed: it handed the player the raw save blob, which carries
 * `gm_private`, the truth ledger, NPC intents and hidden rolls — and the app
 * has no import path, so the file could not be loaded back either. A leak
 * that also does not work is not a feature. Restoring the capability means
 * building a player-safe projection AND an import route; until then the
 * honest thing is to say what is safe and what is not.
 */
export const SaveFailureNotice: React.FC<{
  /** The site's own sentence: "Your investigation could not be saved." */
  lead: string;
  /** The last week that is safely on disk. */
  lastSafeTurn: number;
  onRetry?: () => void;
  style?: React.CSSProperties;
}> = ({ lead, lastSafeTurn, onRetry, style }) => (
  <Alert
    tone="crimson"
    title={RECORD_REFUSES}
    style={style}
    actions={onRetry && <Button size="sm" onClick={onRetry}>Write it down again</Button>}
  >
    {lead} This device would not take the writing down. Your reign is safe up to
    Week {toRoman(lastSafeTurn)} — everything since is only on this screen.
  </Alert>
);

/** Nothing failed. The turn is on disk; only the work after it stumbled. */
export const HalfCommitNotice: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <Alert tone="laurel" title="The week is written" style={style}>
    The turn was saved, but a follow-up step failed. Play continues from the saved turn.
  </Alert>
);

/** The bronze strip under the crisis banner. No network call, no polling. */
export const OfflineStrip: React.FC = () => (
  <div className="gor-offline" role="status">
    <span className="gor-offline-tick" aria-hidden="true" />
    <span className="gor-offline-body">
      <span className="gor-offline-title">No word can leave the city</span>{' '}
      The roads are shut. Keep writing the week — it is kept here, and it will send when they reopen.
    </span>
    <span className="gor-offline-watch">Watching the gates</span>
  </div>
);

/** `navigator.onLine` plus its two events. Nothing is fetched to find out. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}
