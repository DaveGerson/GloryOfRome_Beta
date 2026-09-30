/**
 * D48/D49 in the private scene: the NPC speaks from its own lasting marks
 * and ties, and sees of the player only what shows - an outward mark by
 * name and weight (never its account, which is how it weighs on the
 * player) and the ties the player openly professes.
 */
import { describe, expect, it } from 'vitest';
import { buildPrivateScenePrompt as buildScenePromptInput } from '../hooks/usePrivateSceneController';
import { buildPrivateScenePrompt, PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS } from '../ai/prompts/privateScene';
import { makeEntity } from './factories';
import { playerComposureTell } from '../ai/core/composure';
import type { Condition } from '../types';

const mark = (overrides: Partial<Condition> & Pick<Condition, 'id' | 'name'>): Condition =>
  ({ description: '', outward: true, severity: 'serious', since_turn: 2, ...overrides });

const player = makeEntity({
  entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill',
  conditions: [
    mark({ id: 'scar', name: 'a scar across the jaw', description: 'PLAYER_MARK_ACCOUNT_SENTINEL' }),
    mark({ id: 'dread', name: 'PLAYER_INWARD_MARK_SENTINEL', outward: false }),
  ],
  affiliations: [
    { id: 'state', name: 'the gods of the Roman state', kind: 'religion', public: true },
    { id: 'lararium', name: 'PLAYER_SECRET_TIE_SENTINEL', kind: 'religion', public: false },
  ],
});
const julia = makeEntity({
  entity_id: 'julia', name: 'Julia Mamaea', location: 'Palatine Hill',
  conditions: [mark({ id: 'nightmares', name: 'nightmares of the Guard', outward: false, description: 'She wakes before dawn.' })],
  affiliations: [{ id: 'origen', name: 'the circle of Origen', kind: 'religion', public: false }],
});
const opening = [{ sequence: 1, speaker: 'player' as const, text: 'Mother, a word.' }];

describe('D48/D49: a private scene speaks from the NPC\'s own marks and ties', () => {
  it('gives the NPC its own marks - inward too - and its own ties, secret marked as hers', () => {
    const { systemInstruction, prompt } = buildPrivateScenePrompt(buildScenePromptInput(player, julia, opening, 1));
    expect(prompt).toContain('nightmares of the Guard (serious; inward - known only to its bearer): She wakes before dawn.');
    expect(prompt).toContain('the circle of Origen (religion; KEPT SECRET - known only to you');
    expect(systemInstruction).toContain('npc.marks are the lasting marks the NPC bears');
  });

  it('SENTINEL: shows the NPC the player\'s outward mark by name and weight and their open ties - nothing inward, no account, no secret', () => {
    const { systemInstruction, prompt } = buildPrivateScenePrompt(buildScenePromptInput(player, julia, opening, 1));
    expect(prompt).toContain('a scar across the jaw (serious)');
    expect(prompt).toContain('the gods of the Roman state (religion; openly professed)');
    const all = `${systemInstruction}\n${prompt}`;
    expect(all).not.toContain('PLAYER_MARK_ACCOUNT_SENTINEL');
    expect(all).not.toContain('PLAYER_INWARD_MARK_SENTINEL');
    expect(all).not.toContain('PLAYER_SECRET_TIE_SENTINEL');
  });

  it('SENTINEL (D50): of the player\'s inward marks and secret ties, only code\'s composure lines reach the NPC - a mark\'s name when it breaks, a tie\'s kind, never its name or any account', () => {
    const rolled = (tier: 'frays' | 'breaks') => [
      { subjectKind: 'mark' as const, subjectId: 'dread', handle: 'mark:dread', subjectName: 'PLAYER_INWARD_MARK_SENTINEL', severity: 'serious' as const, roll: 1, modifier: 0, difficulty: 10, tier },
      { subjectKind: 'tie' as const, subjectId: 'lararium', handle: 'tie:lararium', subjectName: 'PLAYER_SECRET_TIE_SENTINEL', tieKind: 'religion' as const, roll: 1, modifier: 0, difficulty: 9, tier },
    ].map(roll => ({ ...roll, told: playerComposureTell(roll, player) }));
    for (const tier of ['frays', 'breaks'] as const) {
      const { systemInstruction, prompt } = buildPrivateScenePrompt(buildScenePromptInput(player, julia, opening, 1, { npc: [], player: rolled(tier) }));
      const all = `${systemInstruction}\n${prompt}`;
      const tells = rolled(tier).map(roll => roll.told!);
      // This mark's name shares words with the secret tie ("PLAYER", "SENTINEL"):
      // told by name it would betray the tie, so when it breaks it is told unnamed (S2).
      if (tier === 'breaks') expect(tells[0]).toBe('Something weighs plainly on Severus Alexander, though it goes unnamed.');
      for (const tell of tells) expect(prompt).toContain(JSON.stringify(tell));
      // Strip the code-written lines: nothing of the player's hidden marks or ties is left.
      const rest = tells.reduce((text, tell) => text.split(JSON.stringify(tell)).join(''), all);
      for (const sentinel of ['PLAYER_INWARD_MARK_SENTINEL', 'PLAYER_MARK_ACCOUNT_SENTINEL', 'PLAYER_SECRET_TIE_SENTINEL']) {
        expect(rest, `${tier}: ${sentinel}`).not.toContain(sentinel);
      }
      expect(all).not.toContain('PLAYER_SECRET_TIE_SENTINEL');
      expect(all).not.toContain('PLAYER_MARK_ACCOUNT_SENTINEL');
    }
  });

  it('a figure with no marks or ties reads as before - no empty lists', () => {
    const plain = makeEntity({ entity_id: 'plain', name: 'A Clerk', location: 'Palatine Hill' });
    const { prompt } = buildPrivateScenePrompt(buildScenePromptInput(makeEntity({ entity_id: 'player', name: 'Severus Alexander' }), plain, opening, 1));
    expect(prompt).not.toContain('"marks"');
    expect(prompt).not.toContain('"ties"');
    expect(prompt).not.toContain('"outwardMarks"');
    expect(prompt).not.toContain('"openTies"');
  });

  it('still fits a scene at every line\'s limit into the budget with marks and ties aboard', () => {
    const long = 'x'.repeat(2000);
    const transcript = Array.from({ length: 11 }, (_, i) => ({ sequence: i + 1, speaker: (i % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc', text: long }));
    const heavy = {
      ...julia,
      conditions: Array.from({ length: 8 }, (_, i) => mark({ id: `m${i}`, name: `mark ${i}`, description: long.slice(0, 900) })),
      affiliations: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `tie ${i} ${long.slice(0, 300)}`, kind: 'cult' as const, public: false })),
    };
    const input = buildScenePromptInput(player, heavy, transcript, 6);
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS);
    expect(() => buildPrivateScenePrompt(input)).not.toThrow();
  });
});
