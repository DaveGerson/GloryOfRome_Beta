import React, { useEffect, useRef, useState } from 'react';
import type { PrivateScenePlayerView } from '../perception/visibility';
import type { PrivateSceneTarget } from '../privateScene/model';
import { PRIVATE_SCENE_MAX_UTTERANCE_CHARS } from '../privateScene/model';
import { Button, DraftGauge } from './ui/Core';
import { Alert } from './ui/Alert';
import { WaxSeal, toRoman } from './ui/Brand';
import { radioGroupKeyDown, radioTabIndex } from './ui/rovingRadio';
import { createFocusTrap } from './ui/focusTrap';
import { PrivateSceneShelf, SCENE_VOICE_COPY, TranscriptLine } from './PrivateSceneShelf';
import { Switch } from './ui/Forms';
import type { PrivateSceneNpcVoice } from '../hooks/usePrivateSceneVoice';

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
  /**
   * "Hear them speak" (hooks/usePrivateSceneVoice.ts): present only while the
   * narration voice is not SILENT. Speaks committed NPC lines only.
   */
  npcVoice?: PrivateSceneNpcVoice;
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
  npcVoice,
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

  /**
   * The last week you were alone with this contact — "Never" reads as an
   * invitation. A REFUSED scene is not one of those weeks: the invitation was
   * turned down, so the hour was spent but the room never held two people. It
   * used to count, which told the player "Last alone · Week N" about a door
   * that never opened — and, through `gor-contact-meta-met`, coloured the card
   * Tyrian as though they had met. Both read off this one value, so both are
   * fixed here.
   */
  const lastAloneWith = (entityId: string): number | null => {
    const weeks = scenes
      .filter(scene => scene.npcId === entityId && scene.closureReason !== 'refused')
      .map(scene => scene.macroTurn);
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

  // Every exchange disables the whole dialog while the other party answers,
  // which drops focus off the control that sent it. When the room is quiet
  // again, hand focus to the next thing to write (reply, last word, or a new
  // opening) - or failing that the first live control - instead of leaving a
  // keyboard player on <body> behind the modal.
  const activeStatus = active?.status;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || loading || !dialog) return;
    // Only reclaim focus that fell: anything a player (or another surface) put
    // focus on stays put.
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== dialog) return;
    const next = dialog.querySelector<HTMLElement>('textarea:not(:disabled)')
      ?? dialog.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled)');
    next?.focus();
  }, [open, loading, activeStatus]);

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
    // The shared trap (components/ui/focusTrap.ts), not a local copy: it also
    // skips the target cards' roving tabindex="-1" radios, which Tab never
    // visits, and pulls a forward Tab from outside back to the first control.
    createFocusTrap(event.currentTarget).handleKeyDown(event);
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
      {npcVoice && (
        <div className="gor-scene-voice">
          <Switch
            id="private-scene-voices"
            checked={npcVoice.enabled}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => npcVoice.onSetEnabled(e.target.checked)}
            aria-describedby="private-scene-voices-note"
            label={SCENE_VOICE_COPY.toggle}
          />
          <p className="gor-config-note" id="private-scene-voices-note" style={{ margin: '2px 0 0' }}>{SCENE_VOICE_COPY.toggleNote}</p>
        </div>
      )}
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
        {/* role="log": each reply is announced as it lands, and the label is
            valid on a landmark-less div only once it has a role. */}
        <div role="log" aria-label="Private-scene transcript" className={active.status === 'awaiting_last_word' ? 'gor-scene-transcript-spent' : undefined}>
          {active.transcript.map(line => (
            <TranscriptLine key={line.sequence} line={line} npcName={active.npcName} voice={npcVoice ? { scene: active, npcVoice } : undefined} />
          ))}
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
      <PrivateSceneShelf completed={completed} reading={reading} onRead={setReadingSceneId} npcVoice={npcVoice} />
      <span className="gor-sr-only">Turn {currentMacroTurn}</span>
    </dialog>}
  </>;
};
