import React, { useEffect, useRef, useState } from 'react';
import type { PrivateScenePlayerView } from '../perception/visibility';
import type { PrivateSceneTarget } from '../privateScene/model';
import { PRIVATE_SCENE_MAX_UTTERANCE_CHARS } from '../privateScene/model';
import { Button, DraftGauge } from './ui/Core';
import { Alert } from './ui/Alert';
import { WaxSeal, toRoman } from './ui/Brand';
import { radioGroupKeyDown, radioTabIndex } from './ui/rovingRadio';
import { EmptyRegister, FoldedLetterSilhouette } from './tabs/EmptyRegister';

const transcriptLineStyle: React.CSSProperties = { margin: '6px 0', paddingLeft: 10, borderLeft: '2px solid var(--border-subtle)' };
const sectionHeadingStyle: React.CSSProperties = { margin: '14px 0 4px' };

export function replacePrivateSceneForCommit<T extends { sceneId: string }>(
  scenes: readonly T[], candidate: T,
): T[] {
  const index = scenes.findIndex(scene => scene.sceneId === candidate.sceneId);
  return index < 0 ? [...scenes, candidate] : scenes.map(scene => scene.sceneId === candidate.sceneId ? candidate : scene);
}

export interface PrivateSceneProps {
  scenes: readonly PrivateScenePlayerView[];
  currentMacroTurn: number;
  canStartScene: boolean;
  eligibleTargets: readonly PrivateSceneTarget[];
  openingDraft: string;
  replyDraft: string;
  lastWordDraft: string;
  loading: boolean;
  error: string | null;
  onOpeningDraftChange(value: string): void;
  onReplyDraftChange(value: string): void;
  onLastWordDraftChange(value: string): void;
  onInvite(targetId: string): void;
  onReply(sceneId: string): void;
  onEnd(sceneId: string): void;
  onLastWord(sceneId: string): void;
  onSkipLastWord(sceneId: string): void;
}

function describeClosure(scene: PrivateScenePlayerView): string {
  switch (scene.closureReason) {
    case 'refused': return `${scene.npcName} refused the invitation.`;
    case 'player_ended': return 'You ended the scene.';
    case 'npc_ended': return `${scene.npcName} ended the scene.`;
    case 'response_limit': return 'The exchange reached its natural limit.';
    default: return 'The scene ended.';
  }
}

/**
 * How a closed scene ended, carried by the seal so the shelf is legible
 * without opening a letter (WP-16). Intact Tyrian: you ended it. Broken
 * Tyrian: they did. Broken crimson: the six replies ran out. Dashed and
 * unsealed: they never came at all.
 */
type ClosureSeal = { className: string; tone: 'crimson' | 'tyrian'; refused: boolean };

function closureSeal(scene: PrivateScenePlayerView): ClosureSeal {
  switch (scene.closureReason) {
    case 'player_ended': return { className: 'gor-scene-seal', tone: 'tyrian', refused: false };
    case 'npc_ended': return { className: 'gor-scene-seal gor-scene-seal-broken', tone: 'tyrian', refused: false };
    case 'response_limit': return { className: 'gor-scene-seal gor-scene-seal-broken', tone: 'crimson', refused: false };
    case 'refused': return { className: 'gor-scene-seal gor-scene-seal-unsealed', tone: 'tyrian', refused: true };
    default: return { className: 'gor-scene-seal', tone: 'tyrian', refused: false };
  }
}

/** `unclassified` is a statement like any other; it just wasn't worth a name. */
function describeSpeechActKind(kind: string): string {
  return kind === 'unclassified' ? 'Statement' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Grounded crimson for a demand or a threat, Tyrian for evasion, an inset well for the rest. */
function speechActClass(kind: string): string {
  if (kind === 'demand' || kind === 'threat') return 'gor-said-kind gor-said-kind-hard';
  if (kind === 'evasion') return 'gor-said-kind gor-said-kind-evasive';
  return 'gor-said-kind';
}

/** The one over-limit notice. Four sites wrote this sentence; only one composer ever mounts. */
const OverLimitNotice: React.FC<{ length: number; onTrim: () => void; disabled: boolean }> = ({ length, onTrim, disabled }) => (
  <>
    <Alert title="More than a private word" style={{ margin: '6px 0 0' }}>
      A private word runs to 2,000 characters at most. Yours runs {length - PRIVATE_SCENE_MAX_UTTERANCE_CHARS} over.
      It is kept exactly as you wrote it.
    </Alert>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onTrim}>Trim the last sentence</Button>
  </>
);

/** Drops the trailing sentence — the cheapest honest way back under the limit. */
function trimLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  const lastBreak = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('? '), trimmed.lastIndexOf('! '));
  if (lastBreak <= 0) return trimmed.slice(0, PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
  return trimmed.slice(0, lastBreak + 1);
}

/** Player-only surface. Raw scene records and NPC private state never cross this prop boundary. */
export const PrivateScene: React.FC<PrivateSceneProps> = ({
  scenes, currentMacroTurn, canStartScene, eligibleTargets, openingDraft, replyDraft, lastWordDraft, loading, error,
  onOpeningDraftChange, onReplyDraftChange, onLastWordDraftChange, onInvite, onReply, onEnd, onLastWord, onSkipLastWord,
}) => {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const active = scenes.find(scene => scene.status === 'active' || scene.status === 'awaiting_last_word');
  const completed = scenes.filter(scene => scene.status === 'closed');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [readingSceneId, setReadingSceneId] = useState<string | null>(null);
  const targetId = selectedTargetId !== null && eligibleTargets.some(target => target.entityId === selectedTargetId)
    ? selectedTargetId
    : (eligibleTargets[0]?.entityId ?? '');
  const disabled = loading;
  const openingOverLimit = openingDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;
  const replyOverLimit = replyDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;
  const lastWordOverLimit = lastWordDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;

  // The shelf opens on the most recent letter; an explicit choice survives
  // until that scene leaves the list.
  const reading = completed.find(scene => scene.sceneId === readingSceneId) ?? completed[completed.length - 1];

  /** The last week you were alone with this contact — "Never" reads as an invitation. */
  const lastAloneWith = (entityId: string): number | null => {
    const weeks = scenes.filter(scene => scene.npcId === entityId).map(scene => scene.macroTurn);
    return weeks.length ? Math.max(...weeks) : null;
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    try {
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    const first = dialog.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
    first?.focus();
  }, [open]);

  const closePresentation = () => {
    setOpen(false);
    queueMicrotask(() => openerRef.current?.focus());
  };
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePresentation();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled)'));
    if (controls.length === 0) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  const heldThisWeek = scenes.find(scene => scene.macroTurn === currentMacroTurn);

  return <>
    <button ref={openerRef} type="button" className="gor-pill" onClick={() => setOpen(true)} disabled={disabled}>Private scene</button>
    {open && <dialog ref={dialogRef} className="gor-private-scene" aria-label="Private scene"
      onCancel={event => { event.preventDefault(); closePresentation(); }} onKeyDown={handleDialogKeyDown}>
      <header>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 24, color: 'var(--tyrian-600)' }}>Private scene</h2>
        {/* The week's one hour, worn on the header: an unbroken seal while it is yours to spend. */}
        <span className="gor-scene-hour">
          <span className={canStartScene ? 'gor-scene-seal' : 'gor-scene-seal gor-scene-seal-broken'}>
            <WaxSeal letter="I" size={26} tone="tyrian" />
          </span>
          <span className="gor-scene-hour-label">{canStartScene ? 'Unspent' : 'Spent'}</span>
        </span>
        <Button type="button" variant="secondary" size="sm" aria-label="Close private scene" onClick={closePresentation} disabled={disabled}>Close</Button>
      </header>
      {/* A failed continuation: the hour is charged on invitation, not on failure. Say so, or nobody risks a retry. */}
      {error && <Alert title="The door did not open" style={{ margin: '6px 0 0' }}>{error}</Alert>}
      {!active && <>
        {!canStartScene ? (
          <div className="gor-scene-guard">
            <span className="gor-scene-seal gor-scene-seal-broken" aria-hidden="true"><WaxSeal letter="I" size={40} tone="tyrian" /></span>
            <p className="gor-scene-guard-line">The door opens again on Week {toRoman(currentMacroTurn + 1)}.</p>
            {heldThisWeek && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setReadingSceneId(heldThisWeek.sceneId)}>
                Read what was said
              </Button>
            )}
          </div>
        ) : eligibleTargets.length === 0 ? (
          <div className="gor-scene-guard">
            <span className="gor-silhouette-vellum" aria-hidden="true" style={{ width: 64, height: 78, borderRadius: 'var(--radius-sm)' }} />
            <p className="gor-scene-guard-line">No one you know is within reach.</p>
          </div>
        ) : <>
          <div className="gor-register-head" style={{ marginTop: 10 }}>
            <span className="gor-register-numeral" aria-hidden="true">I</span>
            <h3 className="gor-label gor-register-title">Who comes</h3>
            <span className="gor-register-rule" aria-hidden="true" />
          </div>
          <div
            className="gor-contact-grid"
            role="radiogroup"
            aria-label="Private-scene target"
            onKeyDown={radioGroupKeyDown(eligibleTargets.map(target => target.entityId), targetId, setSelectedTargetId)}
          >
            {eligibleTargets.map(target => {
              const lastAlone = lastAloneWith(target.entityId);
              const chosen = target.entityId === targetId;
              return (
                <button
                  key={target.entityId}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  tabIndex={radioTabIndex(chosen, target.entityId === eligibleTargets[0]?.entityId, Boolean(targetId))}
                  data-entity-id={target.entityId}
                  disabled={disabled}
                  className={`gor-contact${chosen ? ' gor-contact-chosen' : ''}`}
                  onClick={() => setSelectedTargetId(target.entityId)}
                >
                  <WaxSeal letter={target.displayName.charAt(0).toUpperCase()} size={38} tone="tyrian" />
                  <span className="gor-contact-body">
                    <span className="gor-contact-name">{target.displayName}</span>
                    {target.position && <span className="gor-contact-position">{target.position}</span>}
                    <span className={`gor-contact-meta${lastAlone !== null ? ' gor-contact-meta-met' : ''}`}>
                      {target.location ? `${target.location} · ` : ''}
                      {lastAlone !== null ? `Last alone · Week ${toRoman(lastAlone)}` : 'Never'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="gor-register-head" style={{ marginTop: 14 }}>
            <span className="gor-register-numeral" aria-hidden="true">II</span>
            <h3 className="gor-label gor-register-title">What word you send</h3>
            <span className="gor-register-rule" aria-hidden="true" />
          </div>
          <textarea className="gor-textarea" rows={3} aria-label="Private-scene opening" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={openingDraft} disabled={disabled}
            aria-invalid={openingOverLimit || undefined} onChange={event => onOpeningDraftChange(event.target.value)} />
          <DraftGauge length={openingDraft.length} limit={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} />
          {openingOverLimit && <OverLimitNotice length={openingDraft.length} disabled={disabled} onTrim={() => onOpeningDraftChange(trimLastSentence(openingDraft))} />}
          <Button type="button" disabled={disabled || openingOverLimit || !targetId || !openingDraft.trim()} onClick={() => onInvite(targetId)}>Send invitation</Button>
        </>}
      </>}
      {active && <>
        <p className="gor-label" style={{ margin: '10px 0 4px' }}><strong style={{ color: 'var(--text-heading)' }}>{active.npcName}</strong> · {active.npcResponseCount}/6 replies</p>
        {/* Awaiting the last word: the exchange is over, so it recedes. */}
        <div aria-label="Private-scene transcript" className={active.status === 'awaiting_last_word' ? 'gor-scene-transcript-spent' : undefined}>
          {active.transcript.map(line => <p key={line.sequence} style={transcriptLineStyle}><strong>{line.speaker === 'player' ? 'You' : active.npcName}:</strong> {line.text}</p>)}
        </div>
        {active.status === 'active' && <>
          <textarea className="gor-textarea" rows={3} aria-label="Private-scene reply" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={replyDraft} disabled={disabled}
            aria-invalid={replyOverLimit || undefined} onChange={event => onReplyDraftChange(event.target.value)} />
          <DraftGauge length={replyDraft.length} limit={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} />
          {replyOverLimit && <OverLimitNotice length={replyDraft.length} disabled={disabled} onTrim={() => onReplyDraftChange(trimLastSentence(replyDraft))} />}
          <Button type="button" disabled={disabled || replyOverLimit || !replyDraft.trim()} onClick={() => onReply(active.sceneId)}>Send reply</Button>
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => onEnd(active.sceneId)}>End scene</Button>
        </>}
        {active.status === 'awaiting_last_word' && <>
          <div className="gor-scene-leaving">
            <span className="gor-scene-leaving-title">{active.npcName} is leaving.</span>
            <span className="gor-scene-leaving-body">
              {active.closureReason === 'refused'
                ? 'The refusal stands. You may still send a word after it.'
                : 'You may answer, or let it stand.'}
            </span>
          </div>
          <textarea className="gor-textarea" rows={3} aria-label="Private-scene last word" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={lastWordDraft} disabled={disabled}
            aria-invalid={lastWordOverLimit || undefined} onChange={event => onLastWordDraftChange(event.target.value)} />
          <DraftGauge length={lastWordDraft.length} limit={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} />
          {lastWordOverLimit && <OverLimitNotice length={lastWordDraft.length} disabled={disabled} onTrim={() => onLastWordDraftChange(trimLastSentence(lastWordDraft))} />}
          <Button type="button" disabled={disabled || lastWordOverLimit || !lastWordDraft.trim()} onClick={() => onLastWord(active.sceneId)}>Leave the last word</Button>
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => onSkipLastWord(active.sceneId)}>Let it stand</Button>
        </>}
      </>}
      <section aria-label="Past private scenes">
        <h3 className="gor-label" style={sectionHeadingStyle}>Past private scenes</h3>
        {completed.length === 0 ? (
          <EmptyRegister
            silhouette={<FoldedLetterSilhouette />}
            line="No door has closed behind you yet."
            hint="What is said in private is kept here once the scene ends."
          />
        ) : <div className="gor-shelf">
          <div className="gor-shelf-rail">
            {completed.map(scene => {
              const seal = closureSeal(scene);
              return (
                <button
                  key={scene.sceneId}
                  type="button"
                  className={`gor-shelf-letter${scene.sceneId === reading?.sceneId ? ' gor-shelf-letter-open' : ''}`}
                  aria-current={scene.sceneId === reading?.sceneId}
                  onClick={() => setReadingSceneId(scene.sceneId)}
                >
                  <span className={seal.className} aria-hidden="true"><WaxSeal letter={scene.npcName.charAt(0).toUpperCase()} size={30} tone={seal.tone} /></span>
                  <span className="gor-shelf-letter-body">
                    <span className="gor-shelf-name">{scene.npcName}</span>
                    <span className={`gor-shelf-closure${seal.refused ? ' gor-shelf-closure-refused' : ''}`}>{describeClosure(scene)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {reading && (
            <div className="gor-shelf-pane">
              <div aria-label={`Transcript with ${reading.npcName}`}>
                {reading.transcript.map(line => <p key={line.sequence} style={transcriptLineStyle}><strong>{line.speaker === 'player' ? 'You' : reading.npcName}:</strong> {line.text}</p>)}
              </div>
              {reading.speechActs.length > 0 && (
                <section aria-label={`Attributed speech acts with ${reading.npcName}`}>
                  <h4 className="gor-label" style={{ margin: '10px 0 4px' }}>What was said, in kind</h4>
                  <div className="gor-said">
                    {reading.speechActs.map((act, index) => (
                      <React.Fragment key={`${act.exchange}-${index}`}>
                        <span className={speechActClass(act.kind)}>
                          {act.speaker === 'player' ? 'You' : reading.npcName} — {describeSpeechActKind(act.kind)}
                        </span>
                        <span className="gor-said-quote">{act.text}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              )}
              <p style={{ margin: '10px 0 0' }}><strong>Closure:</strong> {describeClosure(reading)}</p>
              {/* Absence is a line, not a missing element — silence was a choice too. */}
              <div className="gor-lastword">
                <span className="gor-lastword-title">Your last word</span>
                <span className="gor-lastword-body">{reading.lastWord ?? 'You let it stand.'}</span>
              </div>
            </div>
          )}
        </div>}
      </section>
      <span className="gor-sr-only">Turn {currentMacroTurn}</span>
    </dialog>}
  </>;
};
