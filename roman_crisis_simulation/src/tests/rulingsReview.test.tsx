/**
 * @vitest-environment jsdom
 *
 * Regression pins for the adversarial review of rulings D46-D49 (merged
 * 2026-09-29): the defects the reviewers verified that no cluster's own
 * tests covered. Each case names the rule it holds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { applyDeltas } from '../ai/core/engine';
import { deriveLeverageTruth, schemeClueRecords } from '../ai/core/groundTruth';
import { ingestPerceivedChanges, perceivedConditionsOf } from '../knowledge/store';
import { buildPlayerPerceivedDigest, toPreTurnRoster } from '../perception/visibility';
import { normalizeLoadedEntities } from '../persistence/saveGame';
import { Tooltip } from '../components/ui/Feedback';
import { makeEntity, makeRelationship, makeWorldState } from './factories';
import type { Condition, Entity, EventDelta, TruthLedgerEntry } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const world = makeWorldState({ regions: { 'Palatine Hill': { stability: 'Stable', controlling_faction: null, current_events: [] } } });
const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill' });

describe('D49: a tie once openly professed is never secret again', () => {
  it('left and taken up again in one turn, it comes back public', () => {
    const convert = makeEntity({
      entity_id: 'livia', name: 'Livia', location: 'Palatine Hill',
      affiliations: [{ id: 'christians', name: 'the Christians', kind: 'religion', public: true }],
    });
    const deltas: EventDelta[] = [
      { type: 'affiliation', key: 'livia:christians', delta: 0, reason: 'She walks away.', affiliation: { change: 'leave' } },
      { type: 'affiliation', key: 'livia:christians', delta: 0, reason: 'She returns, quietly.', affiliation: { change: 'join', name: 'the Christians', kind: 'religion', public: false } },
    ];
    const { updatedEntities } = applyDeltas(deltas, [player, convert], world, 5, 'player');
    expect(updatedEntities[1].affiliations).toEqual([{ id: 'christians', name: 'the Christians', kind: 'religion', public: true }]);
  });

  it('openly joining a faction makes a secret tie to that same faction public', () => {
    const plotter = makeEntity({
      entity_id: 'rufus', name: 'Rufus', location: 'Palatine Hill',
      affiliations: [{ id: 'optimates_circle', name: 'the Optimates', kind: 'faction', public: false, faction_id: 'optimates' }],
    });
    const { updatedEntities } = applyDeltas(
      [{ type: 'faction', key: 'rufus', delta: 0, reason: 'optimates' }], [player, plotter], world, 5, 'player',
    );
    expect(updatedEntities[1].faction_id).toBe('optimates');
    expect(updatedEntities[1].affiliations?.[0].public).toBe(true);
  });
});

describe('D48: a perceived mark is known by its engine id, and by how it shows', () => {
  const seer = { ...player, relationships: { courtier: makeRelationship() } };
  const courtier = makeEntity({ entity_id: 'courtier', name: 'Local Courtier', location: 'Palatine Hill' });
  const mark = (key: string, condition: EventDelta['condition']): EventDelta =>
    ({ type: 'condition', key, delta: 0, reason: 'What happened.', condition });

  it('a heal seen under another key still clears the mark, and a name-only mark is kept', () => {
    const gain = [mark('courtier:Nasty Scar', { change: 'add', name: 'a nasty scar', description: 'It still aches at night.', outward: true, severity: 'serious' })];
    const first = applyDeltas(gain, [seer, courtier], world, 5, 'player').updatedEntities;
    let store = ingestPerceivedChanges([], buildPlayerPerceivedDigest(gain, first[0], first, world, toPreTurnRoster([seer, courtier])), 5);
    expect(perceivedConditionsOf(store, 'courtier').map(m => m.name)).toEqual(['a nasty scar']);
    // Another's mark is known by how it shows, never by how it weighs on them.
    expect(perceivedConditionsOf(store, 'courtier')[0].description).toBe('');

    const markId = first[1].conditions![0].id;
    const heal = [mark(`courtier:${markId}`, { change: 'heal' })];
    const second = applyDeltas(heal, first, world, 6, 'player').updatedEntities;
    const digest = buildPlayerPerceivedDigest(heal, second[0], second, world, toPreTurnRoster(first));
    expect(digest.map(change => change.text)).toEqual(['Local Courtier no longer shows a nasty scar.']);
    store = ingestPerceivedChanges(store, digest, 6);
    expect(perceivedConditionsOf(store, 'courtier')).toEqual([]);

    const bare = [mark('courtier', { change: 'add', name: 'a limp', description: '', outward: true, severity: 'light' })];
    const third = applyDeltas(bare, second, world, 7, 'player').updatedEntities;
    store = ingestPerceivedChanges(store, buildPlayerPerceivedDigest(bare, third[0], third, world, toPreTurnRoster(second)), 7);
    expect(perceivedConditionsOf(store, 'courtier').map(m => m.name)).toEqual(['a limp']);
  });
});

describe('saves hold marks and ties to their bounds', () => {
  it('a list over the cap, or with an id twice, is normalized on load', () => {
    const scar: Condition = { id: 'scar', name: 'a scar', description: '', outward: true, severity: 'light', since_turn: 1 };
    const marks: Condition[] = [scar, { ...scar }, ...Array.from({ length: 18 }, (_, i) => ({ ...scar, id: `mark_${i}`, name: `mark ${i}` }))];
    const [loaded] = normalizeLoadedEntities([{ ...player, conditions: marks }]);
    expect(loaded.conditions!.length).toBeLessThanOrEqual(12);
    expect(new Set(loaded.conditions!.map(c => c.id)).size).toBe(loaded.conditions!.length);
    // A sound roster still loads as the very same array.
    const sound: Entity[] = [{ ...player, conditions: [scar] }];
    expect(normalizeLoadedEntities(sound)).toBe(sound);
  });
});

describe('D47: a damaged ledger entry never stops a turn', () => {
  it('an investigation entry without a readable standing is skipped, not read', () => {
    const damaged = {
      id: 'x', turn: 3, claim: 'Owes money.', aboutId: 'rufus', isTrue: true, reportId: 'investigation:rufus:secrets',
      investigation: { kind: 'secrets' },
    } as unknown as TruthLedgerEntry;
    const holder = { ...player, resources: { blackmail_on_rufus: ['Owes money.'] } };
    expect(deriveLeverageTruth(holder, [damaged])).toEqual([]);
    expect(schemeClueRecords([{ ...damaged, investigation: { kind: 'scheme' } } as unknown as TruthLedgerEntry], 'rufus')).toEqual([]);
  });
});

describe('a tooltip opened by a tap stays open while its trigger holds focus', () => {
  let root: Root | undefined;
  let host: HTMLElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  it('survives the mouseleave a tap fires after the click; blur closes it', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Tooltip label="Serious - a long pale seam."><span tabIndex={0}>A scar</span></Tooltip>));
    const trigger = host.querySelector<HTMLElement>('span[tabindex="0"]')!;
    const wrap = host.querySelector<HTMLElement>('.gor-tooltip-wrap')!;
    act(() => trigger.focus());
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => { wrap.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => trigger.blur());
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
});
