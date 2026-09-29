/**
 * Seams between the 2026-09-29 audit fixes that no single cluster owned.
 *
 * The rules fix made a relocation (`new_location`, no `new_status`) immune to
 * the legacy reason-parse in the engine; the perception fix mirrors the
 * engine's status reading in `perception/visibility.ts`. The two must agree,
 * or the Dispatches announce a death the engine never applied.
 */
import { describe, expect, it } from 'vitest';
import { applyAdjudication, isDeathClaimDelta } from '../ai/core/engine';
import { buildPlayerPerceivedDigest } from '../perception/visibility';
import { makeEntity, makeWorldState } from './factories';
import type { Adjudication, EventDelta, WorldState } from '../types';

const region = () => ({ stability: 'Stable', controlling_faction: null, current_events: [] });
const world: WorldState = makeWorldState({
  regions: { 'Palatine Hill': region(), 'Ostia': region() },
});
const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill' });
const marcus = makeEntity({ entity_id: 'marcus', name: 'Marcus Aquila', location: 'Palatine Hill' });
const adjudication = (deltas: EventDelta[]): Adjudication => ({ turn: 2, entityActions: [], deltas, headlines: [], gm_private: [] });

describe('a relocation whose reason names a death', () => {
  const flees: EventDelta = {
    type: 'status', key: 'marcus', delta: 0,
    new_location: 'Ostia', reason: 'Flees Rome for Ostia after the Emperor was slain.',
  };

  it('moves the entity in the engine, and the Dispatches say so rather than announce a death', () => {
    expect(isDeathClaimDelta(flees)).toBe(false);
    const before = [player, marcus];
    const { updatedEntities } = applyAdjudication(adjudication([flees]), before, world, []);
    const after = updatedEntities.find(e => e.entity_id === 'marcus')!;
    expect(after.status).toBe('alive');
    expect(after.location).toBe('Ostia');

    const lines = buildPlayerPerceivedDigest([flees], player, updatedEntities, world, before).map(change => change.text);
    expect(lines).toEqual(['Marcus Aquila leaves for Ostia.']);
    expect(lines.join(' ')).not.toMatch(/dead/);
  });

  it('still reads a legacy delta with neither structured field off its reason', () => {
    const legacy: EventDelta = { type: 'status', key: 'marcus', delta: 0, reason: 'Marcus Aquila was slain in the forum.' };
    expect(isDeathClaimDelta(legacy)).toBe(true);
  });
});
