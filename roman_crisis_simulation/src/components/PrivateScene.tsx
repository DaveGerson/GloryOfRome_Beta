import React, { useState } from 'react';
import type { PrivateScenePlayerView } from '../perception/visibility';

export function replacePrivateSceneForCommit<T extends { sceneId: string }>(
  scenes: readonly T[], candidate: T,
): T[] {
  const index = scenes.findIndex(scene => scene.sceneId === candidate.sceneId);
  return index < 0 ? [...scenes, candidate] : scenes.map(scene => scene.sceneId === candidate.sceneId ? candidate : scene);
}

export interface PrivateSceneProps {
  scenes: readonly PrivateScenePlayerView[];
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

/** Player-only surface. Raw scene records and NPC private state never cross this prop boundary. */
export const PrivateScene: React.FC<PrivateSceneProps> = ({
  scenes, eligibleTargets, openingDraft, replyDraft, lastWordDraft, loading, error,
  onOpeningDraftChange, onReplyDraftChange, onLastWordDraftChange, onInvite, onReply, onEnd, onLastWord, onSkipLastWord,
}) => {
  const [open, setOpen] = useState(false);
  const active = scenes.find(scene => scene.status === 'active' || scene.status === 'awaiting_last_word');
  const current = active ?? scenes[scenes.length - 1];
  const [targetId, setTargetId] = useState(eligibleTargets[0]?.entityId ?? '');
  const disabled = loading;
  return <>
    <button type="button" className="gor-pill" onClick={() => setOpen(true)} disabled={disabled}>Private scene</button>
    {open && <section className="gor-private-scene" role="dialog" aria-modal="true" aria-label="Private scene">
      <header><h2>Private scene</h2><button type="button" aria-label="Close private scene" onClick={() => setOpen(false)} disabled={disabled}>Close</button></header>
      {error && <p role="alert">{error}</p>}
      {!active && !current && <>
        {eligibleTargets.length === 0 ? <p>No known contact is currently within reach.</p> : <>
          <label>Contact <select aria-label="Private-scene target" value={targetId} disabled={disabled} onChange={event => setTargetId(event.target.value)}>
            {eligibleTargets.map(target => <option key={target.entityId} value={target.entityId}>{target.displayName}</option>)}
          </select></label>
          <textarea aria-label="Private-scene opening" value={openingDraft} disabled={disabled} onChange={event => onOpeningDraftChange(event.target.value)} />
          <button type="button" disabled={disabled || !targetId || !openingDraft.trim()} onClick={() => onInvite(targetId)}>Send invitation</button>
        </>}
      </>}
      {current && <>
        <p><strong>{current.npcName}</strong> · {current.npcResponseCount}/6 replies</p>
        <div aria-label="Private-scene transcript">{current.transcript.map(line => <p key={line.sequence}><strong>{line.speaker === 'player' ? 'You' : current.npcName}:</strong> {line.text}</p>)}</div>
        {current.status === 'active' && <>
          <textarea aria-label="Private-scene reply" value={replyDraft} disabled={disabled} onChange={event => onReplyDraftChange(event.target.value)} />
          <button type="button" disabled={disabled || !replyDraft.trim()} onClick={() => onReply(current.sceneId)}>Send reply</button>
          <button type="button" disabled={disabled} onClick={() => onEnd(current.sceneId)}>End scene</button>
        </>}
        {current.status === 'awaiting_last_word' && <>
          <p>You may have the last word. {current.closureReason === 'refused' ? 'The refusal stands.' : ''}</p>
          <textarea aria-label="Private-scene last word" value={lastWordDraft} disabled={disabled} onChange={event => onLastWordDraftChange(event.target.value)} />
          <button type="button" disabled={disabled || !lastWordDraft.trim()} onClick={() => onLastWord(current.sceneId)}>Leave last word</button>
          <button type="button" disabled={disabled} onClick={() => onSkipLastWord(current.sceneId)}>Skip last word</button>
        </>}
      </>}
    </section>}
  </>;
};
