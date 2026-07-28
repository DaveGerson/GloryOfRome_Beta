/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrivateScene } from '../components/PrivateScene';
import { projectPrivateSceneForPlayer, type PrivateScenePlayerView } from '../perception/visibility';
import type { PrivateSceneRecord } from '../privateScene/model';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rawScene: PrivateSceneRecord = {
  sceneId: 'scene-2-maximinus', macroTurn: 2, playerId: 'player', npcId: 'maximinus',
  playerName: 'Severus', npcName: 'Maximinus', status: 'awaiting_last_word',
  transcript: [{ sequence: 1, speaker: 'player', text: 'Speak plainly.' }, { sequence: 2, speaker: 'npc', text: 'I have heard nothing.' }],
  npcResponseCount: 1, speechActs: [],
  npcPrivate: { sincerity: 'HIDDEN_INTENT_POISON', hiddenIntent: 'HIDDEN_INTENT_POISON', plannedFollowThrough: ['HIDDEN_INTENT_POISON'] },
  closureReason: 'refused', consequenceStatus: 'pending',
};

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
afterEach(async () => {
  while (mounted.length) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
});

function render(view: PrivateScenePlayerView[] = [projectPrivateSceneForPlayer(rawScene)]): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<PrivateScene
    scenes={view}
    eligibleTargets={[{ entityId: 'maximinus', displayName: 'Maximinus Thrax' }]}
    openingDraft="" replyDraft="" lastWordDraft="" loading={false} error={null}
    onOpeningDraftChange={() => {}} onReplyDraftChange={() => {}} onLastWordDraftChange={() => {}}
    onInvite={() => {}} onReply={() => {}} onEnd={() => {}} onLastWord={() => {}} onSkipLastWord={() => {}}
  />));
  return container;
}

describe('private scene player UI', () => {
  it('projects only player-observable scene fields and never serializes NPC hidden intent', () => {
    const playerView = projectPrivateSceneForPlayer(rawScene);
    expect(playerView).toEqual({
      sceneId: rawScene.sceneId, npcId: rawScene.npcId, npcName: rawScene.npcName,
      status: rawScene.status, transcript: rawScene.transcript, npcResponseCount: rawScene.npcResponseCount,
      closureReason: rawScene.closureReason, lastWord: rawScene.lastWord,
    });
    expect(JSON.stringify(playerView)).not.toContain('HIDDEN_INTENT_POISON');
    expect(Object.keys(playerView)).not.toContain('npcPrivate');
  });

  it('renders only eligible contacts and a refusal with one-way last-word controls', () => {
    const container = render();
    const opener = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!;
    act(() => opener.click());
    expect(container.textContent).toContain('Private scene');
    expect(container.textContent).toContain('Maximinus');
    expect(container.textContent).toContain('I have heard nothing.');
    expect(container.querySelector('[aria-label="Private-scene last word"]')).not.toBeNull();
    expect(container.textContent).not.toContain('HIDDEN_INTENT_POISON');
  });
});
