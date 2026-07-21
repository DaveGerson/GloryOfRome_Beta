/**
 * Phase 2 perception layer (D5 in roadmaps/DESIGN_DECISIONS.md).
 *
 * No viewer is omniscient. Every EventDelta produced by the adjudicator is
 * GROUND TRUTH - it describes what really happened in the simulation,
 * including things no living character in the story could possibly know
 * about yet (a rival's private scheme, a senator's shifting loyalties three
 * regions away). This module is the code-side filter that decides which of
 * those deltas a given VIEWER would plausibly know about, from their own
 * vantage point, and turns the visible subset into plain-language lines.
 * When the viewer is the player, this feeds the "Dispatches & Observations"
 * digest and the `WorldStateTab` intelligence picture; the same rules,
 * applied per NPC viewer, bound what each NPC knows (D10 - see
 * perception/npcPerception.ts).
 *
 * VIEWER-AGNOSTIC CONTRACT: every rule below reads ONLY the viewer's own
 * identity, current location, and visibility_network, plus the
 * unconditionally-public delta classes - nothing player-specific. Passing
 * any Entity as the viewer yields that entity's honest vantage; the same
 * delta may classify differently for two different viewers, and that
 * asymmetry is the point.
 *
 * Per D5, fidelity is binary in this crude v1: a thing is either visible or
 * it isn't. There is no partial/unreliable information yet (that's a later
 * phase, once the GM console has tuning tools for it). Raw, unfiltered
 * ground truth must never reach a player-facing surface - it stays in the
 * GM console (D7), which is the one place allowed to import this module for
 * comparison ("what the player would see" vs "what really happened").
 *
 * This module is intentionally pure (no React, no AI imports) and defines
 * its own local types rather than touching the shared `types.ts` - see the
 * task brief for why.
 */

import { Entity, EventDelta, EventDeltaType, WorldState } from '../types';

/** How a visible change reached the viewer. `null` only ever pairs with
 * `visible: false` - there is no source for something nobody perceived. */
export type PerceptionSource = 'self' | 'witnessed' | 'network' | 'public';

export interface Visibility {
  visible: boolean;
  source: PerceptionSource | null;
}

/** SidePanel tab ids this module knows how to "pulse" when a visible change
 * touches that tab's data. Kept local (not imported from SidePanel) so this
 * module has zero React/component coupling; SidePanel.tsx uses the same
 * string ids for its own tab list. */
export type TabId =
  | 'events'
  | 'reports'
  | 'chronicle'
  | 'dramatis_personae'
  | 'locations'
  | 'resources'
  | 'world_state';

/**
 * One perceived-and-labeled change, ready for display.
 *
 * `subject`/`deltaType`/`deltaKey` are provenance metadata for the D21
 * knowledge store (knowledge/store.ts), which builds its claim entities
 * from this already-D5-filtered output. They describe only what the
 * `text` line itself already conveys to the viewer (who the visible
 * change was about, and what kind of change it was) - never anything the
 * filter withheld, so carrying them here adds no leak surface.
 */
export interface PerceivedChange {
  text: string;
  source: PerceptionSource;
  tabs: TabId[];
  /** The entity id, region id, or 'world' this change is about - see subjectForDelta. */
  subject: string;
  /** The underlying delta's type - lets the knowledge store treat channels differently (e.g. rumors are ingested from Reports, not from their digest line). */
  deltaType: EventDeltaType;
  /** The underlying delta's raw key (e.g. 'A:B:trust_level') - the knowledge store's deterministic claim-matching granularity. */
  deltaKey: string;
}

/** Shown in place of the digest when nothing beyond the player's own
 * directly-narrated consequences was perceptible this turn. */
export const QUIET_DIGEST_MESSAGE = 'Little reaches your ears this week.';

const RELATION_ATTR_LABELS: Record<string, string> = {
  trust_level: 'trust',
  respect_level: 'respect',
  perceived_threat: 'sense of threat',
  ideological_alignment: 'ideological alignment',
  dependency_level: 'reliance',
};

function displayName(id: string | undefined, entities: Entity[]): string {
  if (!id) return 'someone';
  const entity = entities.find(e => e.entity_id === id);
  if (entity) return entity.name;
  // Fall back to a humanized id for regions/factions/entities the caller
  // doesn't have full records for (e.g. a region name, which isn't in the
  // entities array at all).
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function entityLocation(id: string, entities: Entity[]): string | undefined {
  return entities.find(e => e.entity_id === id)?.location;
}

/**
 * Entity ids "involved" in a delta, OTHER than the viewer. Used only for the
 * witnessed/network checks below. The viewer's own id is always excluded
 * here deliberately: checking whether the viewer is standing in their own
 * current location, or is in their own visibility_network, is tautological
 * and would make every delta that merely references the viewer (e.g. an
 * NPC's relation delta targeting them) trivially "witnessed" - which is
 * exactly the leak D5 forbids (another mind's opinion of you shifting is
 * not something you can introspect directly; see the 'self' rule below).
 */
function involvedOtherEntityIds(delta: EventDelta, viewer: Entity): string[] {
  let ids: string[] = [];
  switch (delta.type) {
    case 'relation': {
      // key = 'A:B:attribute' - both A and B are "involved".
      const [a, b] = delta.key.split(':');
      ids = [a, b];
      break;
    }
    case 'resource':
    case 'status':
    case 'scheme':
    case 'faction': {
      // key = 'entityId' (status/scheme/faction) or 'entityId:resourceName'
      // (resource) - only the first segment is an entity id.
      const [entityId] = delta.key.split(':');
      ids = [entityId];
      break;
    }
    default:
      // 'region'/'add_region'/'remove_region'/'rumor' carry no entity ids -
      // handled separately (region targeting) or are unconditionally public
      // (rumor/add_region/remove_region).
      break;
  }
  return ids.filter((id): id is string => !!id && id !== viewer.entity_id);
}

/**
 * Classifies a single EventDelta from the viewer's point of view. The
 * viewer may be ANY Entity - the player character or an NPC; the rules
 * read only the viewer's identity, location, and visibility_network (see
 * the module doc's viewer-agnostic contract).
 *
 * Rules (checked in this order - the first that matches wins):
 *
 * 1. 'public' for rumor deltas (they exist specifically to arrive as
 *    reports - see ai/core/engine.ts's 'rumor' case, which converts them
 *    into Report objects), for add_region/remove_region (the empire
 *    gaining or losing a whole region is empire-macro news, not a secret),
 *    and for 'world' deltas with a valid macro key (ai/core/engine.ts's
 *    'world' case - changes to WorldState.economic_stability/
 *    political_climate, the two macro fields the Header displays
 *    unconditionally). A 'world' delta with any OTHER key is a no-op in
 *    the engine - nothing changed, so it must never be announced; it
 *    stays invisible. Empire-level macro status is public per D5 crude v1
 *    regardless of which of these forms it takes. Empire-level macro
 *    status more broadly (imperial_status, senate/military status,
 *    plebeian mood) is ALSO public per D5, but those live on
 *    SimulationState, not as EventDeltas - WorldStateTab surfaces them
 *    directly rather than through this function.
 *
 * 2. 'self' when the delta directly involves the viewer as its acting/
 *    owning entity. For 'relation' deltas this is DIRECTIONAL: key
 *    'A:B:attr' represents A's perception of B, so it's 'self' only when
 *    the VIEWER is A (their own feelings shifting) - an NPC viewer's own
 *    relation deltas are 'self' from their vantage exactly like the
 *    player's. Another mind's changed opinion OF the viewer (B === viewer)
 *    is explicitly NOT 'self' - no one has a direct line into another
 *    mind's private ledger; it only becomes knowable if witnessed or
 *    reported via the network (below).
 *
 * 3. 'witnessed' when an involved entity (excluding the viewer themself -
 *    see involvedOtherEntityIds) shares the viewer's current location, or
 *    (for 'region' deltas) the delta's region IS the viewer's current
 *    location. A 'status' delta that moves an entity INTO the viewer's
 *    region (new_location) also counts - you saw them arrive.
 *
 * 4. 'network' when an involved entity is one of the viewer's
 *    visibility_network contacts, or (for 'region' deltas) one of those
 *    contacts is currently located in the targeted region - i.e. you have
 *    eyes there even if you aren't.
 *
 * Otherwise the delta is invisible to the viewer.
 */
/** The only WorldState macro fields a 'world' delta can legally change -
 * mirrors ai/core/engine.ts's applyDeltas 'world' case, which no-ops any
 * other key. Kept in lockstep with that case: a key outside this list
 * changed nothing, so classifyDelta must leave it invisible. */
const WORLD_MACRO_KEYS = ['economic_stability', 'political_climate'];

export function classifyDelta(
  delta: EventDelta,
  viewer: Entity,
  entities: Entity[],
  worldState: WorldState
): Visibility {
  // --- Rule 1: public ---
  if (
    delta.type === 'rumor' ||
    delta.type === 'add_region' ||
    delta.type === 'remove_region' ||
    (delta.type === 'world' && WORLD_MACRO_KEYS.includes(delta.key))
  ) {
    return { visible: true, source: 'public' };
  }

  // --- Rule 2: self ---
  if (delta.type === 'relation') {
    const [a] = delta.key.split(':');
    if (a === viewer.entity_id) return { visible: true, source: 'self' };
  } else if (
    delta.type === 'resource' ||
    delta.type === 'status' ||
    delta.type === 'scheme' ||
    delta.type === 'faction'
  ) {
    const [entityId] = delta.key.split(':');
    if (entityId === viewer.entity_id) return { visible: true, source: 'self' };
  }
  // 'region' deltas have no owning entity id, so 'self' never applies -
  // falls through to witnessed/network below.

  // --- Rule 3: witnessed ---
  if (delta.type === 'region') {
    const [regionName] = delta.key.split(':');
    if (regionName === viewer.location) return { visible: true, source: 'witnessed' };
  } else {
    const others = involvedOtherEntityIds(delta, viewer);
    const atViewerLocation = others.some(id => entityLocation(id, entities) === viewer.location);
    const arrivesAtViewerLocation = delta.type === 'status' && delta.new_location === viewer.location;
    if (atViewerLocation || arrivesAtViewerLocation) {
      return { visible: true, source: 'witnessed' };
    }
  }

  // --- Rule 4: network ---
  if (delta.type === 'region') {
    const [regionName] = delta.key.split(':');
    // Guard against a malformed/unknown region key - only real regions can
    // have a network contact "in" them.
    if (worldState.regions[regionName]) {
      const networkPresent = viewer.visibility_network.some(
        id => entityLocation(id, entities) === regionName
      );
      if (networkPresent) return { visible: true, source: 'network' };
    }
  } else {
    const others = involvedOtherEntityIds(delta, viewer);
    if (others.some(id => viewer.visibility_network.includes(id))) {
      return { visible: true, source: 'network' };
    }
  }

  return { visible: false, source: null };
}

/** Which SidePanel tabs display data touched by this delta type - used to
 * decide which tab buttons get a "something changed here" pulse. */
export function tabsForDelta(delta: EventDelta): TabId[] {
  switch (delta.type) {
    case 'resource':
      return ['resources'];
    case 'relation':
    case 'status':
    case 'scheme':
      return ['dramatis_personae'];
    case 'faction':
      return ['dramatis_personae', 'locations'];
    case 'region':
    case 'add_region':
    case 'remove_region':
      return ['locations', 'world_state'];
    case 'world':
      // The two macro WorldState fields a 'world' delta can change render
      // in the always-visible Header, not in any SidePanel tab (WorldStateTab
      // surfaces SimulationState macro fields and region detail, not these) -
      // so there is no tab to pulse. The change still reaches the player as a
      // public digest line via classifyDelta/describeDelta.
      return [];
    case 'rumor':
      return ['reports'];
    default:
      return [];
  }
}

/**
 * The entity id, region id, or 'world' a delta is ABOUT, for the knowledge
 * store's claim subjects. Mirrors the key conventions classifyDelta/
 * describeDelta already rely on: 'relation' keys are 'A:B:attr' (the claim
 * is about A, whose stance shifted); 'resource'/'status'/'scheme'/'faction'
 * keys lead with the owning entity id; 'region'/'add_region'/'remove_region'
 * keys are region names; 'rumor' keys are the entity/region the rumor is
 * about; 'world' deltas are empire-macro and have no narrower subject.
 */
function subjectForDelta(delta: EventDelta): string {
  switch (delta.type) {
    case 'relation':
    case 'resource':
    case 'status':
    case 'scheme':
    case 'faction':
    case 'region': {
      const [first] = delta.key.split(':');
      return first || 'world';
    }
    case 'rumor':
    case 'add_region':
    case 'remove_region':
      return delta.key || 'world';
    case 'world':
    default:
      return 'world';
  }
}

/** Renders a delta as a plain-language line from the viewer's vantage -
 * second-person phrasing ("you"/"your") always addresses the viewer, so the
 * same delta reads correctly whether the viewer is the player or an NPC. */
function describeDelta(delta: EventDelta, viewer: Entity, entities: Entity[]): string {
  switch (delta.type) {
    case 'relation': {
      const [aId, bId, attr = 'trust_level'] = delta.key.split(':');
      const attrLabel = RELATION_ATTR_LABELS[attr] ?? attr.replace(/_/g, ' ');
      if (aId === viewer.entity_id) {
        return `Your ${attrLabel} toward ${displayName(bId, entities)} shifts.`;
      }
      if (bId === viewer.entity_id) {
        return `You sense ${displayName(aId, entities)}'s ${attrLabel} toward you shifting.`;
      }
      return `You notice ${displayName(aId, entities)}'s ${attrLabel} toward ${displayName(bId, entities)} shifting.`;
    }
    case 'status': {
      const [entityId] = delta.key.split(':');
      const statusLabel = delta.new_status ?? 'changed';
      if (entityId === viewer.entity_id) {
        return `Your own fate turns: you are now ${statusLabel}.`;
      }
      return `${displayName(entityId, entities)} is now ${statusLabel}.`;
    }
    case 'resource': {
      const [entityId, resourceName] = delta.key.split(':');
      const direction = delta.delta > 0 ? 'grows' : delta.delta < 0 ? 'dwindles' : 'shifts';
      const resourceLabel = (resourceName ?? 'holdings').replace(/_/g, ' ');
      if (entityId === viewer.entity_id) {
        return `Your ${resourceLabel} ${direction}.`;
      }
      return `${displayName(entityId, entities)}'s ${resourceLabel} ${direction}.`;
    }
    case 'region': {
      const [regionName] = delta.key.split(':');
      return `${regionName}: ${delta.reason || 'the situation shifts'}.`;
    }
    case 'world': {
      // 'key' is 'economic_stability' or 'political_climate' (the only two
      // keys the engine applies - see WORLD_MACRO_KEYS); 'reason' is the new
      // value, not narrative prose, for this delta type. Public per D5
      // (Rule 1 above), so the phrasing states the new value outright rather
      // than hedging the way witnessed/network lines do. An empty 'reason'
      // falls back to hedged prose rather than printing "is now ." - and the
      // final fallback (unknown key, unreachable via classifyDelta because
      // the engine no-ops those) deliberately claims no specific change.
      if (delta.key === 'economic_stability') {
        return delta.reason
          ? `Word spreads through every market: the empire's economy is now ${delta.reason}.`
          : `Word spreads through every market: the empire's economic fortunes shift.`;
      }
      if (delta.key === 'political_climate') {
        return delta.reason
          ? `Word spreads through every forum: the political climate is now ${delta.reason}.`
          : `Word spreads through every forum: the political winds shift.`;
      }
      return 'Talk of shifting fortunes crosses the empire.';
    }
    case 'rumor': {
      return `Rumor reaches you: "${delta.reason}"`;
    }
    case 'scheme': {
      const [entityId] = delta.key.split(':');
      const name = displayName(entityId, entities);
      try {
        const scheme = JSON.parse(delta.reason);
        return `You catch wind of ${name}'s scheme: "${scheme.name}".`;
      } catch {
        return `You sense ${name} is plotting something.`;
      }
    }
    case 'add_region': {
      return `A new place enters your world: ${delta.key}.`;
    }
    case 'remove_region': {
      return `${delta.key} is gone, wiped from the map.`;
    }
    case 'faction': {
      const [entityId] = delta.key.split(':');
      const name = displayName(entityId, entities);
      if (!delta.reason || delta.reason === 'null') {
        return `${name} breaks from their faction.`;
      }
      return `${name} aligns with ${displayName(delta.reason, entities)}.`;
    }
    default:
      return delta.reason || 'Something shifts, unremarked.';
  }
}

/**
 * Maps a turn's raw (ground-truth) deltas to the subset the given viewer
 * would perceive, with friendly labels and a source tag - never raw global
 * truth, per D5. With the player as viewer this feeds the "Dispatches &
 * Observations" chat digest and (indirectly, via the same classifyDelta
 * rules) WorldStateTab's region detail; with an NPC as viewer it is that
 * NPC's bounded knowledge of the turn (perception/npcPerception.ts).
 */
export function buildPerceivedDigest(
  deltas: EventDelta[],
  viewer: Entity,
  entities: Entity[],
  worldState: WorldState
): PerceivedChange[] {
  const changes: PerceivedChange[] = [];
  for (const delta of deltas) {
    const { visible, source } = classifyDelta(delta, viewer, entities, worldState);
    if (!visible || !source) continue;
    changes.push({
      text: describeDelta(delta, viewer, entities),
      source,
      tabs: tabsForDelta(delta),
      subject: subjectForDelta(delta),
      deltaType: delta.type,
      deltaKey: delta.key,
    });
  }
  return changes;
}
