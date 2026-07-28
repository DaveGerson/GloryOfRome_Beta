/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  npcResponseCount: 1, speechActs: [{ speaker: 'npc', kind: 'claim', text: 'I have heard nothing.', exchange: 1 }],
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

function render(view: PrivateScenePlayerView[] = [projectPrivateSceneForPlayer(rawScene)], canStartScene = true): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<PrivateScene
    scenes={view} currentMacroTurn={3} canStartScene={canStartScene}
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
      speechActs: rawScene.speechActs,
      closureReason: rawScene.closureReason, lastWord: rawScene.lastWord,
    });
    expect(playerView.speechActs).not.toBe(rawScene.speechActs);
    expect(playerView.speechActs[0]).not.toBe(rawScene.speechActs[0]);
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

  it('shows completed history while restoring invite controls only when this turn still has entitlement', () => {
    const closed = projectPrivateSceneForPlayer({ ...rawScene, status: 'closed', macroTurn: 2 });
    const container = render([closed], true);
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!.click());
    expect(container.textContent).toContain('Past private scenes');
    expect(container.querySelector('[aria-label="Private-scene opening"]')).not.toBeNull();
  });

  it('renders completed perceived history with closure and last word but no GM or mechanics partition', () => {
    const completedRaw: PrivateSceneRecord = {
      ...rawScene,
      status: 'closed',
      transcript: [
        ...rawScene.transcript,
        { sequence: 3, speaker: 'player', text: 'PLAYER_LAST_WORD_VISIBLE' },
      ],
      speechActs: [
        { speaker: 'player', kind: 'unclassified', text: 'PLAYER_EXACT_TERMS_VISIBLE', exchange: 1 },
        { speaker: 'npc', kind: 'agreement', text: 'NPC_AGREEMENT_VISIBLE', exchange: 1 },
      ],
      npcPrivate: {
        sincerity: 'GM_SINCERITY_POISON',
        hiddenIntent: 'GM_HIDDEN_INTENT_POISON',
        plannedFollowThrough: ['GM_PLAN_POISON', 'MECHANICS_SENTINEL_POISON'],
      },
      closureReason: 'player_ended',
      lastWord: 'PLAYER_LAST_WORD_VISIBLE',
      consequenceStatus: 'consumed',
      consumedByTurn: 77,
    };
    const container = render([projectPrivateSceneForPlayer(completedRaw)], false);
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!.click());

    const history = container.querySelector<HTMLElement>('[aria-label="Past private scenes"]')!;
    expect(history.textContent).toContain('Speak plainly.');
    expect(history.textContent).toContain('I have heard nothing.');
    expect(history.textContent).toContain('Closure');
    expect(history.textContent).toMatch(/you ended/i);
    expect(history.textContent).toContain('Last word');
    expect(history.textContent).toContain('PLAYER_LAST_WORD_VISIBLE');
    const speechActs = history.querySelector('[aria-label="Attributed speech acts with Maximinus"]');
    expect(speechActs?.textContent).toContain('PLAYER_EXACT_TERMS_VISIBLE');
    expect(speechActs?.textContent).toContain('NPC_AGREEMENT_VISIBLE');
    expect(speechActs?.textContent).toMatch(/you/i);
    expect(speechActs?.textContent).toMatch(/agreement/i);
    for (const forbidden of [
      'GM_SINCERITY_POISON', 'GM_HIDDEN_INTENT_POISON',
      'GM_PLAN_POISON', 'MECHANICS_SENTINEL_POISON', 'consumed', '77',
    ]) {
      expect(container.textContent).not.toContain(forbidden);
    }
  });

  it('does not offer another invitation after a scene has consumed the current turn entitlement', () => {
    const closed = projectPrivateSceneForPlayer({ ...rawScene, status: 'closed', macroTurn: 3 });
    const container = render([closed], false);
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!.click());
    expect(container.querySelector('[aria-label="Private-scene opening"]')).toBeNull();
    expect(container.textContent).toMatch(/already held.*this turn/i);
  });

  it('uses a modal dialog, moves focus inside, traps Tab, closes presentation on Escape, and restores opener focus', async () => {
    const container = render([], true);
    const opener = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Private scene')!;
    opener.focus();
    await act(async () => opener.click());
    const dialog = container.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await act(async () => dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await act(async () => dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('dialog[open]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('bounds every draft at 2,000 characters and preserves an over-limit last word with an accessible error', () => {
    const onLastWord = vi.fn();
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container); mounted.push({ root, container });
    act(() => root.render(<PrivateScene scenes={[projectPrivateSceneForPlayer(rawScene)]} currentMacroTurn={3} canStartScene={false}
      eligibleTargets={[]} openingDraft="" replyDraft="" lastWordDraft={'x'.repeat(2001)} loading={false} error={null}
      onOpeningDraftChange={() => {}} onReplyDraftChange={() => {}} onLastWordDraftChange={() => {}}
      onInvite={() => {}} onReply={() => {}} onEnd={() => {}} onLastWord={onLastWord} onSkipLastWord={() => {}} />));
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Private scene')!.click());
    const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene last word"]')!;
    expect(field.maxLength).toBe(2000);
    expect(field.value).toHaveLength(2001);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/2,000/);
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Leave last word')!.click());
    expect(onLastWord).not.toHaveBeenCalled();
    expect(field.value).toHaveLength(2001);
  });
});
