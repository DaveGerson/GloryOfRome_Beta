import React, { useEffect, useRef, useState } from 'react';
import type { PrivateScenePlayerView } from '../perception/visibility';
import { PRIVATE_SCENE_MAX_UTTERANCE_CHARS } from '../privateScene/model';

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
  eligibleTargets: readonly { entityId: string; displayName: string }[];
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
  const targetId = selectedTargetId !== null && eligibleTargets.some(target => target.entityId === selectedTargetId)
    ? selectedTargetId
    : (eligibleTargets[0]?.entityId ?? '');
  const disabled = loading;
  const openingOverLimit = openingDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;
  const replyOverLimit = replyDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;
  const lastWordOverLimit = lastWordDraft.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS;

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
  return <>
    <button ref={openerRef} type="button" className="gor-pill" onClick={() => setOpen(true)} disabled={disabled}>Private scene</button>
    {open && <dialog ref={dialogRef} className="gor-private-scene" aria-label="Private scene"
      onCancel={event => { event.preventDefault(); closePresentation(); }} onKeyDown={handleDialogKeyDown}>
      <header><h2>Private scene</h2><button type="button" aria-label="Close private scene" onClick={closePresentation} disabled={disabled}>Close</button></header>
      {error && <p role="alert">{error}</p>}
      {!active && <>
        {!canStartScene ? <p>You have already held a private scene this turn.</p> : eligibleTargets.length === 0 ? <p>No known contact is currently within reach.</p> : <>
          <label>Contact <select aria-label="Private-scene target" value={targetId} disabled={disabled} onChange={event => setSelectedTargetId(event.target.value)}>
            {eligibleTargets.map(target => <option key={target.entityId} value={target.entityId}>{target.displayName}</option>)}
          </select></label>
          <textarea aria-label="Private-scene opening" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={openingDraft} disabled={disabled}
            aria-invalid={openingOverLimit || undefined} onChange={event => onOpeningDraftChange(event.target.value)} />
          {openingOverLimit && <p role="alert">Private-scene messages may be at most 2,000 characters.</p>}
          <button type="button" disabled={disabled || openingOverLimit || !targetId || !openingDraft.trim()} onClick={() => onInvite(targetId)}>Send invitation</button>
        </>}
      </>}
      {active && <>
        <p><strong>{active.npcName}</strong> · {active.npcResponseCount}/6 replies</p>
        <div aria-label="Private-scene transcript">{active.transcript.map(line => <p key={line.sequence}><strong>{line.speaker === 'player' ? 'You' : active.npcName}:</strong> {line.text}</p>)}</div>
        {active.status === 'active' && <>
          <textarea aria-label="Private-scene reply" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={replyDraft} disabled={disabled}
            aria-invalid={replyOverLimit || undefined} onChange={event => onReplyDraftChange(event.target.value)} />
          {replyOverLimit && <p role="alert">Private-scene messages may be at most 2,000 characters.</p>}
          <button type="button" disabled={disabled || replyOverLimit || !replyDraft.trim()} onClick={() => onReply(active.sceneId)}>Send reply</button>
          <button type="button" disabled={disabled} onClick={() => onEnd(active.sceneId)}>End scene</button>
        </>}
        {active.status === 'awaiting_last_word' && <>
          <p>You may have the last word. {active.closureReason === 'refused' ? 'The refusal stands.' : ''}</p>
          <textarea aria-label="Private-scene last word" maxLength={PRIVATE_SCENE_MAX_UTTERANCE_CHARS} value={lastWordDraft} disabled={disabled}
            aria-invalid={lastWordOverLimit || undefined} onChange={event => onLastWordDraftChange(event.target.value)} />
          {lastWordOverLimit && <p role="alert">Private-scene messages may be at most 2,000 characters.</p>}
          <button type="button" disabled={disabled || lastWordOverLimit || !lastWordDraft.trim()} onClick={() => onLastWord(active.sceneId)}>Leave last word</button>
          <button type="button" disabled={disabled} onClick={() => onSkipLastWord(active.sceneId)}>Skip last word</button>
        </>}
      </>}
      {completed.length > 0 && <section aria-label="Past private scenes"><h3>Past private scenes</h3>{completed.map(scene => <details key={scene.sceneId}><summary>{scene.npcName}</summary>
        <div aria-label={`Transcript with ${scene.npcName}`}>{scene.transcript.map(line => <p key={line.sequence}><strong>{line.speaker === 'player' ? 'You' : scene.npcName}:</strong> {line.text}</p>)}</div>
        {scene.speechActs.length > 0 && <section aria-label={`Attributed speech acts with ${scene.npcName}`}><h4>Attributed speech acts</h4><ul>
          {scene.speechActs.map((act, index) => <li key={`${act.exchange}-${index}`}><strong>{act.speaker === 'player' ? 'You' : scene.npcName} — {act.kind === 'unclassified' ? 'statement' : act.kind}:</strong> {act.text}</li>)}
        </ul></section>}
        <p><strong>Closure:</strong> {describeClosure(scene)}</p>
        {scene.lastWord && <p><strong>Last word:</strong> {scene.lastWord}</p>}
      </details>)}</section>}
      <span className="gor-sr-only">Turn {currentMacroTurn}</span>
    </dialog>}
  </>;
};
