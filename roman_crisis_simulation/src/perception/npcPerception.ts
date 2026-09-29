/**
 * NPC-side perception (D10 in roadmaps/DESIGN_DECISIONS.md): each NPC's
 * bounded knowledge of a turn comes from the SAME viewer-agnostic rules
 * that bound the player's (perception/visibility.ts) - what that character
 * actually witnessed at their location, heard through their own
 * visibility_network, or picked up as public news. Nothing here grants an
 * NPC information their vantage point would not admit.
 *
 * Per-NPC digests are GM-side simulation data (D4/D5): what an NPC knows
 * is not player knowledge. They may surface only in the GM console and
 * ai/**; no player-facing surface may render them. The digests themselves
 * are derived each turn and DISCARDED - never persisted. What persists is
 * (a) the memory entries stamped from them (Entity.memories, bounded by
 * MAX_ENTITY_MEMORIES in ai/core/engine.ts) and (b) the selected viewer
 * ids on the turn's history entry (bounded by MAX_PERCEIVING_NPCS), from
 * which the GM console re-derives the digests for display.
 *
 * Same discipline as visibility.ts: pure - no React, no AI imports.
 */

import { Affiliation, Condition, Entity, EventDelta, WorldState } from '../types';
import { buildPerceivedDigest, PerceivedChange, PerceptionSource, type PreTurnRoster } from './visibility';
import { outwardConditionsOf } from '../ai/core/conditions';
import { publicAffiliationsOf } from '../ai/core/affiliations';

/**
 * Upper bound on how many NPCs run the perception pass in a single turn.
 * The full roster can grow without limit over a campaign, and each viewer
 * costs a classify-every-delta sweep plus up to
 * MAX_NPC_MEMORY_LINES_PER_TURN persisted memory writes - so the set must
 * be bounded, prioritized (spotlight cast first, then entities the turn's
 * deltas touch) rather than truncated arbitrarily.
 */
export const MAX_PERCEIVING_NPCS = 25;

/**
 * Upper bound on memory entries one viewer gains from one turn. Memories
 * persist in the save under MAX_ENTITY_MEMORIES (ai/core/engine.ts); an
 * unbounded per-turn write would let a single busy turn flush an entity's
 * whole remembered past out of that window.
 */
export const MAX_NPC_MEMORY_LINES_PER_TURN = 6;

/**
 * When one turn perceives more than MAX_NPC_MEMORY_LINES_PER_TURN changes,
 * what the viewer RETAINS is ranked by how directly the information reached
 * them: events witnessed in person are the viewer's only record of others'
 * doings and rank first; their own shifts ('self') are partially
 * recoverable from the entity's current state, so they rank second;
 * secondhand channels (network reports, public news) rank last. Ties keep
 * delta order.
 */
const MEMORY_SOURCE_PRIORITY: Record<PerceptionSource, number> = {
  witnessed: 0,
  self: 1,
  network: 2,
  public: 3,
};

/** One NPC viewer's perceived digest of a turn's deltas. */
export interface NpcPerception {
  entityId: string;
  name: string;
  changes: PerceivedChange[];
}

/**
 * Entity ids a turn's deltas involve, in delta order (duplicates included -
 * callers dedupe). Mirrors the key conventions classifyDelta relies on:
 * 'relation' keys are 'A:B:attr' (both involved); 'resource'/'status'/
 * 'scheme'/'faction'/'condition'/'affiliation' keys lead with the owning
 * entity id; 'rumor' keys are the entity (or region) the rumor is about.
 * 'region'/'add_region'/'remove_region'/'world' keys carry no entity ids.
 */
function entityIdsInDeltas(deltas: EventDelta[]): string[] {
  const ids: string[] = [];
  for (const delta of deltas) {
    switch (delta.type) {
      case 'relation': {
        const [a, b] = delta.key.split(':');
        if (a) ids.push(a);
        if (b) ids.push(b);
        break;
      }
      case 'resource':
      case 'status':
      case 'scheme':
      case 'faction':
      case 'condition':
      case 'affiliation': {
        const [entityId] = delta.key.split(':');
        if (entityId) ids.push(entityId);
        break;
      }
      case 'rumor': {
        if (delta.key) ids.push(delta.key);
        break;
      }
      default:
        break;
    }
  }
  return ids;
}

/**
 * Picks the turn's perceiving-NPC set: ALIVE entities only, the player's
 * own entity always excluded (player-side knowledge lives in the D21
 * knowledge store, never in this loop), bounded at MAX_PERCEIVING_NPCS.
 * Priority when the roster exceeds the cap: spotlight entities first (in
 * spotlight order), then entities the turn's deltas involve (in delta
 * order), then the rest in roster order. Ids that match no living
 * non-player roster entity are skipped, never padded around.
 */
export function selectPerceivingNpcs(
  entities: Entity[],
  playerEntityId: string | undefined,
  spotlightIds: string[],
  deltas: EventDelta[]
): Entity[] {
  const byId = new Map(entities.map(e => [e.entity_id, e]));
  const picked: Entity[] = [];
  const pickedIds = new Set<string>();
  const tryPick = (id: string) => {
    if (picked.length >= MAX_PERCEIVING_NPCS || pickedIds.has(id)) return;
    const entity = byId.get(id);
    if (!entity || entity.status !== 'alive' || entity.entity_id === playerEntityId) return;
    pickedIds.add(id);
    picked.push(entity);
  };
  spotlightIds.forEach(tryPick);
  entityIdsInDeltas(deltas).forEach(tryPick);
  entities.forEach(e => tryPick(e.entity_id));
  return picked;
}

/**
 * Runs the viewer-agnostic digest (perception/visibility.ts) once per
 * viewer over the same ground-truth deltas. Each viewer's `changes` is
 * exactly what THEY could perceive - the same delta may appear in one
 * viewer's digest and not another's. `preTurnEntities` (the roster as the
 * turn began) is forwarded so each viewer, like the player, sees who left
 * their room and is never told of a status that did not change.
 */
export function buildNpcPerceptions(
  deltas: EventDelta[],
  viewers: Entity[],
  entities: Entity[],
  worldState: WorldState,
  preTurnEntities?: PreTurnRoster
): NpcPerception[] {
  return viewers.map(viewer => ({
    entityId: viewer.entity_id,
    name: viewer.name,
    changes: buildPerceivedDigest(deltas, viewer, entities, worldState, preTurnEntities),
  }));
}

/**
 * Upper bound on the other figures one mind prompt describes (D48/D49): a
 * mind needs the people around it, not the whole roster, and every mind
 * input is bounded.
 */
export const MAX_FIGURES_IN_VIEW = 8;

/**
 * One other figure as an NPC knows them - a typed projection, rebuilt field
 * by field, so no other entity's record ever crosses into a mind prompt
 * (ai/prompts/npcMind.ts's asymmetry contract). Carries only what anyone
 * could know of them: the OUTWARD marks of someone standing in the room
 * (D48) and the ties they openly profess (D49 - public knowledge). Never an
 * inward mark, a secret tie, a secret, a scheme.
 */
export interface FigureInView {
  entity_id: string;
  name: string;
  /** True when they stand where the viewer stands - the only way their marks can be seen. */
  present: boolean;
  outwardConditions: Array<Pick<Condition, 'name' | 'description' | 'severity'>>;
  publicAffiliations: Array<Pick<Affiliation, 'name' | 'kind'>>;
}

/**
 * The figures `viewer` knows of this turn and what anyone could know of
 * them: every living other the viewer knows (its own relationships and
 * visibility_network) or stands beside, with the outward marks of those in
 * the room (the witness rule classifyDelta applies to a status change) and
 * the ties each openly professes. A figure with nothing to show is left out;
 * those in the room come first, then roster order, capped at
 * MAX_FIGURES_IN_VIEW. The player is a figure like any other here - their
 * outward marks and open ties show, their inward marks and secret ties never
 * do (the player's secret ties reach an NPC only through what it witnessed,
 * in its own memories).
 */
export function figuresInViewOf(viewer: Entity, entities: readonly Entity[]): FigureInView[] {
  const known = new Set([...Object.keys(viewer.relationships ?? {}), ...(viewer.visibility_network ?? [])]);
  const figures: FigureInView[] = [];
  for (const other of entities) {
    if (other.entity_id === viewer.entity_id || other.status !== 'alive') continue;
    const present = other.location === viewer.location;
    if (!present && !known.has(other.entity_id)) continue;
    const outwardConditions = present
      ? outwardConditionsOf(other).map(({ name, description, severity }) => ({ name, description, severity }))
      : [];
    const publicAffiliations = publicAffiliationsOf(other).map(({ name, kind }) => ({ name, kind }));
    if (outwardConditions.length === 0 && publicAffiliations.length === 0) continue;
    figures.push({ entity_id: other.entity_id, name: other.name, present, outwardConditions, publicAffiliations });
  }
  return figures
    .map((figure, index) => ({ figure, index }))
    .sort((a, b) => Number(b.figure.present) - Number(a.figure.present) || a.index - b.index)
    .slice(0, MAX_FIGURES_IN_VIEW)
    .map(({ figure }) => figure);
}

/**
 * The subset of one viewer's perceived changes that become memory entries:
 * ranked by MEMORY_SOURCE_PRIORITY (witnessed > self > network > public,
 * ties keeping delta order), capped at MAX_NPC_MEMORY_LINES_PER_TURN.
 */
export function selectMemoryChanges(changes: PerceivedChange[]): PerceivedChange[] {
  return changes
    .map((change, index) => ({ change, index }))
    .sort(
      (a, b) =>
        MEMORY_SOURCE_PRIORITY[a.change.source] - MEMORY_SOURCE_PRIORITY[b.change.source] ||
        a.index - b.index
    )
    .slice(0, MAX_NPC_MEMORY_LINES_PER_TURN)
    .map(({ change }) => change);
}
