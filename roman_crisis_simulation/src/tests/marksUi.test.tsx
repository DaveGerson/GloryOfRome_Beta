/**
 * @vitest-environment jsdom
 *
 * The D48 marks and D49 ties on the player's surfaces and the GM console:
 *  - the player's own status panel lists every mark they bear, flagging the
 *    inward ones, and every tie they hold, flagging the secret ones - and
 *    draws neither register until there is something to show;
 *  - a Personae card shows only the marks the player has SEEN (read from the
 *    knowledge store), never the live entity's - an inward mark, or an
 *    outward one taken out of sight, never renders - and a figure's openly
 *    professed ties plus any secret tie the player has LEARNED, never live
 *    secret state;
 *  - the GM console's entity view shows every mark and tie (ground truth).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import PlayerStatus from '../components/PlayerStatus';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import { EntityStatesView } from '../components/gm/EntityStatesView';
import { MARKS_COPY } from '../components/ui/Marks';
import type { KnowledgeClaim } from '../knowledge/store';
import type { Affiliation, Condition, Entity } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';
import { makeEntity } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => localStorage.clear());

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(node));
  return container;
}

const scar: Condition = { id: 'scarred_cheek', name: 'a nasty scar', description: 'A jagged line from brow to jaw.', outward: true, severity: 'serious', since_turn: 2 };
const nightmares: Condition = { id: 'nightmares', name: 'nightmares', description: 'He wakes screaming of the Rhine.', outward: false, severity: 'grave', since_turn: 3 };
const openTie: Affiliation = { id: 'college_of_pontiffs', name: 'the college of pontiffs', kind: 'religion', public: true };
const secretTie: Affiliation = { id: 'cult_of_bacchus', name: 'the cult of Bacchus', kind: 'cult', public: false };

describe('PlayerStatus: the marks you bear', () => {
  it('draws no register until the story leaves a mark', async () => {
    const container = await mount(<PlayerStatus playerEntity={makeEntity({ current_state_narrative: 'Watchful.', short_term_goals: ['Hold the throne'] })} />);
    expect(container.querySelector('.gor-marks')).toBeNull();
    expect(container.textContent).not.toContain(MARKS_COPY.ownLabel);
  });

  it('lists every mark, flags the inward ones, and opens each one\'s weight and account on focus (one running line)', async () => {
    const container = await mount(<PlayerStatus playerEntity={makeEntity({ current_state_narrative: 'Watchful.', conditions: [scar, nightmares] })} />);
    expect(container.textContent).toContain(MARKS_COPY.ownLabel);
    expect(container.querySelector('.gor-marks')?.classList.contains('gor-marks-compact')).toBe(true);
    const items = Array.from(container.querySelectorAll('.gor-mark'));
    expect(items.map(item => item.querySelector('.gor-mark-name')?.textContent)).toEqual(['A nasty scar', 'Nightmares']);
    expect(items[0].querySelector('.gor-mark-flag')).toBeNull();
    expect(items[1].querySelector('.gor-mark-flag')?.textContent).toBe(MARKS_COPY.inward);
    // Compact: neither the weight nor the account takes room in the panel...
    expect(items[1].querySelector('.gor-mark-weight')).toBeNull();
    expect(items[1].querySelector('.gor-mark-desc')).toBeNull();
    // ...they open on focus, and describe the mark to assistive tech.
    const name = items[1].querySelector<HTMLElement>('.gor-mark-name')!;
    await act(async () => name.focus());
    const tip = container.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toBe(`Grave — ${nightmares.description}`);
    expect(name.getAttribute('aria-describedby')).toBe(tip?.id);
  });

  it('a damaged mark on a hand-edited reign is skipped rather than breaking the panel', async () => {
    const container = await mount(<PlayerStatus playerEntity={makeEntity({ conditions: [scar, { name: { nested: true } }] as unknown as Condition[] })} />);
    expect(container.querySelectorAll('.gor-mark')).toHaveLength(1);
  });
});

describe('Personae: the marks the player has seen', () => {
  const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
  const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', visibility_network: ['courtier'] });
  const courtier = makeEntity({
    entity_id: 'courtier',
    name: 'Marcus the Courtier',
    position: 'Chamberlain',
    conditions: [
      { ...scar, description: 'SEEN_SCAR_DESCRIPTION' },
      { ...nightmares, description: 'LIVE_INWARD_MARK_SENTINEL' },
      { id: 'limp', name: 'UNSEEN_OUTWARD_MARK_SENTINEL', description: 'Taken out of sight.', outward: true, severity: 'light', since_turn: 4 },
    ],
  });
  const seenScar: KnowledgeClaim = {
    id: 'claim_2_digest:condition:courtier:scarred_cheek',
    subject: 'courtier',
    claim: 'Marcus the Courtier now bears a mark: a nasty scar.',
    topic: 'condition',
    claimKey: 'digest:condition:courtier:scarred_cheek',
    firstLearnedTurn: 2,
    updates: [{
      turn: 2, source: 'network', text: 'Marcus the Courtier now bears a mark: a nasty scar.',
      condition: { id: 'scarred_cheek', name: 'a nasty scar', description: 'A jagged line, as your contact saw it.', severity: 'serious', outward: true, gone: false },
    }],
  };

  async function render(knowledge: KnowledgeClaim[]) {
    return mount(
      <DramatisPersonaeTab
        playerEntity={player}
        entities={[player, courtier]}
        knowledge={knowledge}
        turnNumber={5}
        onSpendDeepAnalysis={() => {}}
        onInvestigationOutcome={() => {}}
        runDomainMutation={runDomainMutation}
        ai={{} as GoogleGenAI}
        isMockMode
      />,
    );
  }

  it('shows the marks perceived through the dispatches - never the live entity\'s', async () => {
    const container = await render([seenScar]);
    expect(container.textContent).toContain(MARKS_COPY.seenLabel);
    expect(container.textContent).toContain('A nasty scar');
    expect(container.textContent).toContain('A jagged line, as your contact saw it.');
    expect(container.textContent).not.toContain('SEEN_SCAR_DESCRIPTION');
    expect(container.textContent).not.toContain('LIVE_INWARD_MARK_SENTINEL');
    expect(container.textContent).not.toContain('UNSEEN_OUTWARD_MARK_SENTINEL');
    expect(container.querySelector('.gor-mark-flag')).toBeNull();
  });

  it('a figure the player has seen no mark on carries no register', async () => {
    const container = await render([]);
    expect(container.textContent).not.toContain(MARKS_COPY.seenLabel);
  });
});

describe('GM console: every mark and every tie, ground truth', () => {
  it('shows inward marks too, with how they show, their weight and the turn they were taken', async () => {
    const npc: Entity = makeEntity({ entity_id: 'courtier', name: 'Marcus', conditions: [scar, nightmares] });
    const container = await mount(<EntityStatesView entities={[npc]} />);
    expect(container.textContent).toContain('Conditions:');
    expect(container.textContent).toContain('a nasty scar [outward, serious, since T2]');
    expect(container.textContent).toContain('nightmares [INWARD, grave, since T3]');
  });

  it('shows secret ties too, marked, with their kind and faction link', async () => {
    const npc: Entity = makeEntity({ entity_id: 'courtier', name: 'Marcus', affiliations: [openTie, { ...secretTie, faction_id: 'military_cabal' }] });
    const container = await mount(<EntityStatesView entities={[npc]} />);
    expect(container.textContent).toContain('Affiliations:');
    expect(container.textContent).toContain('the college of pontiffs [public, religion]');
    expect(container.textContent).toContain('the cult of Bacchus [SECRET, cult, military_cabal]');
  });
});

describe('PlayerStatus: your ties', () => {
  it('draws no register without a tie', async () => {
    const container = await mount(<PlayerStatus playerEntity={makeEntity({})} />);
    expect(container.textContent).not.toContain(MARKS_COPY.ownTiesLabel);
  });

  it('lists every tie of the player\'s own, the secret ones marked as kept secret', async () => {
    const container = await mount(<PlayerStatus playerEntity={makeEntity({ affiliations: [openTie, secretTie, { id: 'x', name: 'the old families', kind: 'other', public: true }] })} />);
    expect(container.textContent).toContain(MARKS_COPY.ownTiesLabel);
    const items = Array.from(container.querySelectorAll('.gor-mark'));
    // One running line on the panel: the name speaks for the kind.
    expect(items.map(item => item.textContent)).toEqual([
      'The college of pontiffs',
      `The cult of Bacchus${MARKS_COPY.keptSecret}`,
      'The old families',
    ]);
  });
});

describe('Personae: ties openly professed, and secret ones the player has learned', () => {
  const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
  const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', visibility_network: ['courtier'] });
  const courtier = makeEntity({
    entity_id: 'courtier', name: 'Marcus the Courtier', position: 'Chamberlain',
    affiliations: [openTie, secretTie, { id: 'unlearned', name: 'LIVE_SECRET_TIE_SENTINEL', kind: 'cult', public: false }],
  });
  const witnessed: KnowledgeClaim = {
    id: 'claim_3_digest:affiliation:courtier:cult_of_bacchus', subject: 'courtier', claim: 'You glimpse Marcus the Courtier among the cult of Bacchus, in secret.',
    topic: 'affiliation', claimKey: 'digest:affiliation:courtier:cult_of_bacchus', firstLearnedTurn: 3,
    updates: [{ turn: 3, source: 'witnessed', text: 'You glimpse Marcus the Courtier among the cult of Bacchus, in secret.', affiliation: { id: 'cult_of_bacchus', name: 'the cult of Bacchus', kind: 'cult', public: false, member: true } }],
  };

  async function render(knowledge: KnowledgeClaim[]) {
    return mount(
      <DramatisPersonaeTab playerEntity={player} entities={[player, courtier]} knowledge={knowledge} turnNumber={5}
        onSpendDeepAnalysis={() => {}} onInvestigationOutcome={() => {}} runDomainMutation={runDomainMutation}
        ai={{} as GoogleGenAI} isMockMode />,
    );
  }

  it('shows the open tie always, a secret one only once learned - marked as known to the player - and never live secret state', async () => {
    const before = await render([]);
    expect(before.textContent).toContain('The college of pontiffs');
    expect(before.textContent).not.toContain('The cult of Bacchus');
    expect(before.textContent).not.toContain('LIVE_SECRET_TIE_SENTINEL');

    const after = await render([witnessed]);
    const items = Array.from(after.querySelectorAll('.gor-persona-marks .gor-mark')).map(item => item.textContent);
    expect(items).toContain('The college of pontiffs · religion');
    expect(items).toContain(`The cult of Bacchus · cult${MARKS_COPY.knownToYou}`);
    expect(after.textContent).not.toContain('LIVE_SECRET_TIE_SENTINEL');
  });
});
