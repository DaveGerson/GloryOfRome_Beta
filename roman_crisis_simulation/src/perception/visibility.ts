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

import { AffiliationKind, ConditionSeverity, Entity, EventDelta, EventDeltaType, WorldState } from '../types';
import type { PrivateSceneRecord, PrivateSceneStatus, PrivateSceneClosureReason, PrivateSceneSpeaker, PrivateSceneSpeechAct } from '../privateScene/model';
import { legacyStatusFromReason } from '../ai/core/legacyStatus';
import { conditionDeltaEffect, conditionsOf, type ConditionEffect } from '../ai/core/conditions';
import { affiliationDeltaEffect, affiliationsOf, type AffiliationEffect } from '../ai/core/affiliations';

export interface PrivateScenePlayerView {
  sceneId: string;
  npcId: string;
  npcName: string;
  /**
   * The week the scene was held. The player was in the room; the week they
   * were in it is theirs to know. Carried so the doorway can say "Last alone ·
   * Week III" without the caller re-deriving it from GM records (WP-16).
   */
  macroTurn: number;
  status: PrivateSceneStatus;
  transcript: Array<{ sequence: number; speaker: PrivateSceneSpeaker; text: string }>;
  speechActs: PrivateSceneSpeechAct[];
  npcResponseCount: number;
  closureReason?: PrivateSceneClosureReason;
  lastWord?: string;
}

/** Explicit D5 boundary for player components: intentionally excludes every GM-private scene field. */
export function projectPrivateSceneForPlayer(scene: PrivateSceneRecord): PrivateScenePlayerView {
  return {
    sceneId: scene.sceneId,
    npcId: scene.npcId,
    npcName: scene.npcName,
    macroTurn: scene.macroTurn,
    status: scene.status,
    transcript: scene.transcript.map(line => ({ ...line })),
    speechActs: scene.speechActs.map(act => ({ ...act })),
    npcResponseCount: scene.npcResponseCount,
    ...(scene.closureReason ? { closureReason: scene.closureReason } : {}),
    ...(scene.lastWord ? { lastWord: scene.lastWord } : {}),
  };
}

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
  /**
   * 'status' changes only: the life/freedom status the line shows the
   * subject in - what the viewer now BELIEVES of them ('alive' for a seen
   * move: they were seen about). Structured so the roster can read a
   * believed status without parsing the line's prose.
   */
  perceivedStatus?: Entity['status'];
  /**
   * 'faction' changes only: the faction id the line shows the subject
   * joining, or null when it shows them breaking away.
   */
  perceivedFaction?: string | null;
  /**
   * 'condition' changes only (D48): the mark as the line shows it - what the
   * viewer now believes the subject bears (`gone` once seen healed or no
   * longer showing). Structured so a roster reads perceived marks without
   * parsing prose, and never from live state.
   */
  perceivedCondition?: PerceivedCondition;
  /**
   * 'affiliation' changes only (D49): the tie as the line shows it - whether
   * the subject is now of it (`member`) and whether it was openly professed
   * or seen in secret (`public`). A secret tie the viewer witnessed becomes
   * knowledge they hold; never read from live state.
   */
  perceivedAffiliation?: PerceivedAffiliation;
}

/** One tie as a viewer perceived it - see PerceivedChange.perceivedAffiliation. */
export interface PerceivedAffiliation {
  id: string;
  name: string;
  kind: AffiliationKind;
  /** True when the tie was openly professed (or went public) as seen; false when seen kept in secret. */
  public: boolean;
  /** True while the subject holds the tie as seen; false once seen to give it up. */
  member: boolean;
}

/** One mark as a viewer perceived it - see PerceivedChange.perceivedCondition. */
export interface PerceivedCondition {
  id: string;
  name: string;
  description: string;
  severity: ConditionSeverity;
  outward: boolean;
  /** True once the viewer saw the mark heal or leave their sight. */
  gone: boolean;
}

/** Shown in place of the digest when nothing beyond the player's own
 * directly-narrated consequences was perceptible this turn. */
export const QUIET_DIGEST_MESSAGE = 'Little reaches your ears this week.';

/**
 * Does the player have direct or networked sight into `regionName`? (D5's
 * locality/network rule — the same one `classifyDelta` applies to
 * region-type deltas.)
 *
 * Lives here rather than in a tab (WP-15): it used to be exported FROM
 * `components/tabs/WorldStateTab.tsx` so `EmpireTab.tsx` could import it,
 * which meant a sight rule was owned by a view that no longer renders
 * regions at all. One rule, in the module that owns perception.
 */
export function isRegionKnownToPlayer(regionName: string, player: Entity, entities: Entity[]): boolean {
  if (player.location === regionName) return true;
  return player.visibility_network.some(id => stationedContactLocation(id, entities) === regionName);
}

/**
 * Where a network contact can act as the viewer's EYES: their location,
 * but only while they are alive. A dead (or exiled/missing) contact stays in
 * `visibility_network` - nothing prunes it on death - yet can no longer
 * report on the region they were last placed in; counting them let a slain
 * spy keep feeding the viewer region news (D5 locality leak).
 */
function stationedContactLocation(id: string, entities: Entity[]): string | undefined {
  const contact = entities.find(e => e.entity_id === id);
  return contact && contact.status === 'alive' ? contact.location : undefined;
}

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

function entityLocation(id: string, entities: readonly Pick<Entity, 'entity_id' | 'location'>[]): string | undefined {
  return entities.find(e => e.entity_id === id)?.location;
}

/**
 * One entity as a turn BEGAN, reduced to the only fields perception reads
 * from it: who stood where, in what state - and, when it had any, the marks
 * it bore, the ties it held and the text or list holdings it held (D48/D49 -
 * so a mark healed, a tie given up or a holding lost this turn can be told
 * from one never there). A full Entity satisfies it, and so does the slim
 * copy a history entry keeps (TurnHistoryEntry.preTurnRoster, built by
 * toPreTurnRoster), whose `resources` carries ONLY those text and list
 * holdings - never a number.
 */
export type PreTurnRosterEntry = Pick<Entity, 'entity_id' | 'location' | 'status'> & Partial<Pick<Entity, 'conditions' | 'affiliations' | 'resources'>>;
export type PreTurnRoster = readonly PreTurnRosterEntry[];

/**
 * The slim pre-turn roster a history entry keeps: every entity's id,
 * location and status; its conditions and affiliations only when it holds
 * any; and its text and list holdings only when it holds any (numeric
 * resources never - a loss can name only a holding) - the save stays lean
 * for the majority.
 */
export function toPreTurnRoster(entities: readonly Entity[]): PreTurnRosterEntry[] {
  return entities.map(({ entity_id, location, status, conditions, affiliations, resources }) => {
    const holdings = Object.entries(resources ?? {}).filter(([, value]) => typeof value === 'string' || Array.isArray(value));
    return {
      entity_id,
      location,
      status,
      ...(Array.isArray(conditions) && conditions.length > 0 ? { conditions: structuredClone(conditions) } : {}),
      ...(Array.isArray(affiliations) && affiliations.length > 0 ? { affiliations: structuredClone(affiliations) } : {}),
      ...(holdings.length > 0 ? { resources: structuredClone(Object.fromEntries(holdings)) } : {}),
    };
  });
}

const ENTITY_STATUSES: readonly Entity['status'][] = ['alive', 'dead', 'exiled', 'missing'];

/**
 * What a 'status' delta visibly DID, mirroring ai/core/engine.ts's 'status'
 * case: nothing unless the key is exactly an entity's id (the engine looks
 * it up whole), then the structured new_status when valid, else the status
 * the engine's legacy reason-parse reads off THIS delta's reason - never the
 * post-turn status, which another delta may have set - and a move only to
 * a region that exists - the engine ignores any other new_location. With
 * the pre-turn roster a status the entity already had, or a move to where
 * it already stood, is no change at all. A dead entity
 * is never seen to move: a corpse does not walk, and a presumed-dead NPC's
 * movements are exactly the hint at survival D3 forbids. Returns null when
 * nothing perceptible happened, so the delta is never announced.
 */
function statusDeltaEffect(
  delta: EventDelta,
  entities: Entity[],
  worldState: WorldState,
  preTurnEntities?: PreTurnRoster
): { status?: Entity['status']; moveTo?: string } | null {
  const after = entities.find(e => e.entity_id === delta.key);
  if (!after) return null;
  const before = preTurnEntities?.find(e => e.entity_id === delta.key);
  // Mirrors applyDeltas: a delta carrying `new_location` without `new_status`
  // is a relocation whose reason is never parsed (see isDeathClaimDelta).
  const claimed = delta.new_status && ENTITY_STATUSES.includes(delta.new_status)
    ? delta.new_status
    : delta.new_location ? undefined : legacyStatusFromReason(delta.reason);
  const status = claimed && (!before || before.status !== claimed) ? claimed : undefined;
  const resulting = status ?? after.status;
  const moveTo = delta.new_location
    && worldState.regions[delta.new_location]
    && resulting !== 'dead'
    && (!before || before.location !== delta.new_location)
    ? delta.new_location
    : undefined;
  return status || moveTo ? { status, moveTo } : null;
}

/** The only region delta the engine applies: '<existing region>:stability'
 * (ai/core/engine.ts's 'region' case). Every other key changed nothing. */
function isAppliedRegionDelta(delta: EventDelta, worldState: WorldState): boolean {
  const [regionName, property] = delta.key.split(':');
  return !!worldState.regions[regionName] && property === 'stability';
}

/**
 * What a 'condition' delta visibly did from THIS viewer's vantage (D48),
 * read off the marks it left (ai/core/conditions.ts::conditionDeltaEffect):
 * the bearer sees every mark of their own, everyone else only the outward
 * ones - so an inward mark is no effect at all to another viewer, and never
 * announced. Null when nothing perceptible changed.
 */
function conditionEffectFor(delta: EventDelta, viewer: Entity, entities: Entity[], preTurnEntities?: PreTurnRoster): ConditionEffect | null {
  const [bearerId] = delta.key.split(':');
  const bearer = entities.find(e => e.entity_id === bearerId);
  if (!bearer) return null;
  const before = preTurnEntities ? conditionsOf(preTurnEntities.find(e => e.entity_id === bearerId)) : undefined;
  return conditionDeltaEffect(delta, conditionsOf(bearer), before, bearerId === viewer.entity_id);
}

/**
 * What an 'affiliation' delta did to its holder's ties (D49), read off the
 * ties it left (ai/core/affiliations.ts::affiliationDeltaEffect) - whether
 * it happened in the open or in secret is part of the effect, and decides
 * who could have seen it (see classifyDelta). Null when nothing changed.
 */
function affiliationEffectFor(delta: EventDelta, entities: Entity[], preTurnEntities?: PreTurnRoster): AffiliationEffect | null {
  const [holderId] = delta.key.split(':');
  const holder = entities.find(e => e.entity_id === holderId);
  if (!holder) return null;
  const before = preTurnEntities ? affiliationsOf(preTurnEntities.find(e => e.entity_id === holderId)) : undefined;
  return affiliationDeltaEffect(delta, affiliationsOf(holder), before);
}

/**
 * The item a 'resource' delta says was lost from a text or list holding
 * (D48), when the engine removed it - mirroring ai/core/engine.ts's
 * removeLostHolding against the holding as the turn began (the pre-turn
 * roster) and as it now stands: a text holding that was there and is gone,
 * or a list item that was held and is no longer. A numeric resource ignores
 * `lost_item`, and a loss the engine refused (an item never held) is no
 * loss, so neither is announced as one. Without a pre-turn record, only the
 * after-state can be checked.
 */
function lostHoldingOf(delta: EventDelta, entities: Entity[], preTurnEntities?: PreTurnRoster): string | undefined {
  const lostItem = typeof delta.lost_item === 'string' ? delta.lost_item.trim() : '';
  if (!lostItem) return undefined;
  const [entityId, resourceName = ''] = delta.key.split(':');
  const holds = (holding: unknown) => Array.isArray(holding)
    && holding.some(item => typeof item === 'string' && item.trim().toLowerCase() === lostItem.toLowerCase());
  const after = entities.find(e => e.entity_id === entityId)?.resources[resourceName];
  if (typeof after === 'number' || typeof after === 'string' || holds(after)) return undefined;
  if (!preTurnEntities) return lostItem;
  const before = preTurnEntities.find(e => e.entity_id === entityId)?.resources?.[resourceName];
  return typeof before === 'string' || holds(before) ? lostItem : undefined;
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
    case 'faction':
    case 'condition':
    case 'affiliation': {
      // key = 'entityId' (status/scheme/faction) or 'entityId:resourceName'
      // (resource) or 'entityId:conditionId' / 'entityId:affiliationId' -
      // only the first segment is an entity id.
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

/** Whether a viewer knows a figure at all: someone they hold a view of, or one of their contacts (npcPerception's figuresInViewOf reads the same). */
function knowsFigure(viewer: Entity, entityId: string): boolean {
  return Object.prototype.hasOwnProperty.call(viewer.relationships ?? {}, entityId)
    || (viewer.visibility_network ?? []).includes(entityId);
}

/**
 * Classifies a single EventDelta from the viewer's point of view. The
 * viewer may be ANY Entity - the player character or an NPC; the rules
 * read only the viewer's identity, location, and visibility_network (see
 * the module doc's viewer-agnostic contract).
 *
 * `preTurnEntities` is the roster as the turn BEGAN (optional: callers that
 * have no record of it keep the post-turn-only rules). It lets a status
 * delta that changed nothing stay unannounced, and lets a departure count
 * as witnessed (rule 3).
 *
 * First, a delta that changed nothing a witness could see is invisible to
 * every viewer: a 'status' delta with no perceptible effect (see
 * statusDeltaEffect), a 'region' delta the engine did not apply (only
 * '<existing region>:stability' is), and a 'scheme' delta about an entity
 * the world now holds dead - its mind may still plot as GM-side truth
 * (a presumed-dead NPC keeps its scheme), but nobody can see a dead man
 * plotting, and saying so would hint at his survival (D3). The same holds
 * for a 'condition' delta (D48) about the dead, for one that left no mark
 * THIS viewer can see - an inward mark is known to its bearer alone, so to
 * every other viewer it is no change at all - and for a lost holding the
 * engine did not remove.
 *
 * An 'affiliation' delta (D49) takes its own path before the rules below:
 * its holder always knows it ('self'); a change made in the open is public
 * knowledge ('public' - anyone who knows the figure knows it); a change made
 * in secret is seen only by a witness standing where the holder stands
 * ('witnessed' - present at the rite), never through a contact. A tie of the
 * dead is never seen, as with a scheme.
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
 *    region (new_location) also counts - you saw them arrive - and so,
 *    given the pre-turn roster, does a 'status' delta about someone who
 *    stood where the viewer stood when the turn began: you saw them go.
 *    That pre-turn rule is deliberately limited to status (and movement)
 *    deltas.
 *
 * 4. 'network' when an involved entity is one of the viewer's
 *    visibility_network contacts, or (for 'region' deltas) one of those
 *    contacts is currently located - and alive - in the targeted region -
 *    i.e. you have eyes there even if you aren't. A dead/exiled/missing
 *    contact is no one's eyes.
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
  worldState: WorldState,
  preTurnEntities?: PreTurnRoster
): Visibility {
  // --- Nothing perceptible happened ---
  if (delta.type === 'status' && !statusDeltaEffect(delta, entities, worldState, preTurnEntities)) {
    return { visible: false, source: null };
  }
  if (delta.type === 'region' && !isAppliedRegionDelta(delta, worldState)) {
    return { visible: false, source: null };
  }
  if (delta.type === 'scheme' || delta.type === 'condition' || delta.type === 'affiliation') {
    const [subjectId] = delta.key.split(':');
    if (entities.find(e => e.entity_id === subjectId)?.status === 'dead') return { visible: false, source: null };
  }
  if (delta.type === 'condition' && !conditionEffectFor(delta, viewer, entities, preTurnEntities)) {
    return { visible: false, source: null };
  }
  if (delta.type === 'affiliation') {
    // D49 has its own rules, ahead of the generic ones: its holder always
    // knows; a change made in the open (a tie openly professed, or one going
    // public or exposed) is public knowledge to anyone who KNOWS the figure
    // (their relationships or contacts - the same test the minds' "figures
    // around you" uses), never an introduction to a stranger; anything else
    // is seen only by a witness in the room - never through a contact.
    const effect = affiliationEffectFor(delta, entities, preTurnEntities);
    if (!effect) return { visible: false, source: null };
    const [holderId] = delta.key.split(':');
    if (holderId === viewer.entity_id) return { visible: true, source: 'self' };
    if (effect.public && knowsFigure(viewer, holderId)) return { visible: true, source: 'public' };
    return entityLocation(holderId, entities) === viewer.location
      ? { visible: true, source: 'witnessed' }
      : { visible: false, source: null };
  }
  if (delta.type === 'resource' && typeof delta.lost_item === 'string' && delta.lost_item.trim()) {
    const [entityId, resourceName] = delta.key.split(':');
    const holding = entities.find(e => e.entity_id === entityId)?.resources[resourceName ?? ''];
    if (typeof holding !== 'number' && !lostHoldingOf(delta, entities, preTurnEntities)) return { visible: false, source: null };
  }

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
    delta.type === 'faction' ||
    delta.type === 'condition'
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
    const viewerStartedAt = preTurnEntities ? entityLocation(viewer.entity_id, preTurnEntities) ?? viewer.location : undefined;
    const leavesViewerLocation = delta.type === 'status' && preTurnEntities !== undefined
      && others.some(id => entityLocation(id, preTurnEntities) === viewerStartedAt);
    if (atViewerLocation || arrivesAtViewerLocation || leavesViewerLocation) {
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
        id => stationedContactLocation(id, entities) === regionName
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
 * decide which tab buttons get a "something changed here" pulse. A tab is
 * named only when it actually renders the delta's subject (a coin that
 * points at a tab showing nothing new misdirects the player): Assets shows
 * only the viewer's OWN holdings, so another's resources pulse nothing;
 * Personae renders the other figures - who is about (status), who is
 * plotting (scheme), whom they stand with (faction), the marks seen on them
 * (condition), the ties they hold (affiliation) - never the viewer, whose
 * own marks and ties live on their status panel above the tabs (D44: one
 * owner per fact); regions render only on
 * Empire (D44: World no longer owns them). */
export function tabsForDelta(delta: EventDelta, viewerId?: string): TabId[] {
  const [subjectId] = delta.key.split(':');
  switch (delta.type) {
    case 'resource':
      return viewerId !== undefined && subjectId === viewerId ? ['resources'] : [];
    case 'relation':
      return ['dramatis_personae'];
    case 'status':
    case 'scheme':
    case 'faction':
    case 'condition':
    case 'affiliation':
      return subjectId === viewerId ? [] : ['dramatis_personae'];
    case 'region':
    case 'add_region':
    case 'remove_region':
      return ['locations'];
    case 'world':
      // The two macro WorldState fields a 'world' delta can change are
      // marked in the always-visible Header ('Changed this week'), which is
      // their designated change mark - so there is no tab to pulse. The
      // change still reaches the player as a public digest line via
      // classifyDelta/describeDelta.
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
 * is about A, whose stance shifted); 'resource'/'status'/'scheme'/'faction'/
 * 'condition' keys lead with the owning entity id; 'region'/'add_region'/
 * 'remove_region' keys are region names; 'rumor' keys are the entity/region
 * the rumor is about; 'world' deltas are empire-macro and have no narrower
 * subject.
 */
function subjectForDelta(delta: EventDelta): string {
  switch (delta.type) {
    case 'relation':
    case 'resource':
    case 'status':
    case 'scheme':
    case 'faction':
    case 'condition':
    case 'affiliation':
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
function describeDelta(delta: EventDelta, viewer: Entity, entities: Entity[], worldState: WorldState, preTurnEntities?: PreTurnRoster): string {
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
      // Only what the delta visibly did (statusDeltaEffect - classifyDelta
      // has already dropped one that did nothing): a changed status, else a
      // move to a region the engine actually applied. A move reads from the
      // viewer's side of the door - arriving where they stand, else leaving.
      const [entityId] = delta.key.split(':');
      const effect = statusDeltaEffect(delta, entities, worldState, preTurnEntities);
      const isViewer = entityId === viewer.entity_id;
      const name = displayName(entityId, entities);
      if (effect?.status) {
        return isViewer
          ? `Your own fate turns: you are now ${effect.status}.`
          : `${name} is now ${effect.status}.`;
      }
      if (effect?.moveTo) {
        if (isViewer) return `You make your way to ${effect.moveTo}.`;
        return effect.moveTo === viewer.location
          ? `${name} arrives at ${effect.moveTo}.`
          : `${name} leaves for ${effect.moveTo}.`;
      }
      // Unreachable through buildPerceivedDigest (classifyDelta drops a
      // delta with no effect); kept honest rather than claiming a change.
      return isViewer ? 'You are as you were.' : `${name} is as before.`;
    }
    case 'resource': {
      const [entityId, resourceName] = delta.key.split(':');
      // D48: a text or list holding the engine removed is named, not
      // counted - "You have lost the villa at Baiae."
      const lost = lostHoldingOf(delta, entities, preTurnEntities);
      if (lost) {
        return entityId === viewer.entity_id
          ? `You have lost ${lost}.`
          : `${displayName(entityId, entities)} has lost ${lost}.`;
      }
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
      // D28: a scheme is perceived only as 'something is afoot'. Proximity
      // reveals THAT a schemer is at work, never the scheme's name or nature
      // (which is earned by accreting clues - knowledge/store.ts). The
      // schemer's own name is fair game (you can see who is busy); the
      // `active_scheme` payload serialized in delta.reason is deliberately
      // NOT parsed here, so it can never leak through a witness's line - and,
      // because this same line is what stamps NPC memories/mind digests, the
      // cast no longer learns rivals' scheme names by mere proximity either.
      const [entityId] = delta.key.split(':');
      return `You sense ${displayName(entityId, entities)} is plotting something.`;
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
    case 'condition': {
      // D48: only what this viewer could see of the mark (conditionEffectFor
      // - classifyDelta has already dropped one they could not). Written to
      // read with a name that carries its own article ("a nasty scar").
      const [entityId] = delta.key.split(':');
      const effect = conditionEffectFor(delta, viewer, entities, preTurnEntities);
      if (!effect) return 'Something shifts, unremarked.';
      const mark = effect.condition.name;
      const name = displayName(entityId, entities);
      const lines: Record<ConditionEffect['kind'], string> = entityId === viewer.entity_id
        ? {
          gained: `You bear a new mark: ${mark}.`,
          deepened: `A mark you bear grows worse: ${mark}.`,
          eased: `A mark you bear eases: ${mark}.`,
          healed: `A mark you bore has left you: ${mark}.`,
        }
        : {
          gained: `${name} now bears a mark: ${mark}.`,
          deepened: `A mark on ${name} grows worse: ${mark}.`,
          eased: `A mark on ${name} eases: ${mark}.`,
          healed: `${name} no longer bears ${mark}.`,
        };
      return lines[effect.kind];
    }
    case 'affiliation': {
      // D49: what the viewer could know of the tie (classifyDelta has
      // already dropped a secret change they did not witness). A name reads
      // as a group, cause or faith ("the cult of Bacchus").
      const [entityId] = delta.key.split(':');
      const effect = affiliationEffectFor(delta, entities, preTurnEntities);
      if (!effect) return 'Something shifts, unremarked.';
      const tie = effect.affiliation.name;
      const name = displayName(entityId, entities);
      const lines: Record<AffiliationEffect['kind'], string> = entityId === viewer.entity_id
        ? {
          joined: effect.public ? `You are now openly of ${tie}.` : `You are now of ${tie}, in secret.`,
          left: effect.public ? `You break openly with ${tie}.` : `You quietly break with ${tie}.`,
          avowed: `You openly avow your tie to ${tie}.`,
          exposed: `Your hidden tie to ${tie} stands exposed.`,
        }
        : {
          joined: effect.public ? `${name} is now openly of ${tie}.` : `You glimpse ${name} among ${tie}, in secret.`,
          left: effect.public ? `${name} breaks openly with ${tie}.` : `You glimpse ${name} quietly break with ${tie}.`,
          avowed: `${name} openly avows a tie to ${tie}, long kept hidden.`,
          exposed: `${name} stands exposed: a hidden tie to ${tie}.`,
        };
      return lines[effect.kind];
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
  worldState: WorldState,
  preTurnEntities?: PreTurnRoster
): PerceivedChange[] {
  const changes: PerceivedChange[] = [];
  for (const delta of deltas) {
    const { visible, source } = classifyDelta(delta, viewer, entities, worldState, preTurnEntities);
    if (!visible || !source) continue;
    const change: PerceivedChange = {
      text: describeDelta(delta, viewer, entities, worldState, preTurnEntities),
      source,
      tabs: tabsForDelta(delta, viewer.entity_id),
      subject: subjectForDelta(delta),
      deltaType: delta.type,
      deltaKey: delta.key,
    };
    // The believed state the line itself conveys, in structured form (the
    // knowledge store keeps it so the roster never parses prose). A seen
    // move shows the subject about - never the live status, which may have
    // changed out of sight and would leak through the roster (D5).
    if (delta.type === 'status') {
      const effect = statusDeltaEffect(delta, entities, worldState, preTurnEntities);
      if (effect) change.perceivedStatus = effect.status ?? 'alive';
    } else if (delta.type === 'faction') {
      change.perceivedFaction = !delta.reason || delta.reason === 'null' ? null : delta.reason;
    } else if (delta.type === 'condition') {
      const effect = conditionEffectFor(delta, viewer, entities, preTurnEntities);
      if (effect) {
        const { id, name, description, severity, outward } = effect.condition;
        change.perceivedCondition = { id, name, description, severity, outward, gone: effect.kind === 'healed' };
      }
    } else if (delta.type === 'affiliation') {
      const effect = affiliationEffectFor(delta, entities, preTurnEntities);
      if (effect) {
        const { id, name, kind } = effect.affiliation;
        change.perceivedAffiliation = { id, name, kind, public: effect.public, member: effect.kind !== 'left' };
      }
    }
    changes.push(change);
  }
  return changes;
}

/** Player-only projection: keep NPC perception semantics intact while
 * withholding relationship-mechanic deltas from player intelligence. */
export function buildPlayerPerceivedDigest(
  deltas: EventDelta[],
  player: Entity,
  entities: Entity[],
  world: WorldState,
  preTurnEntities?: PreTurnRoster
): PerceivedChange[] {
  return buildPerceivedDigest(deltas, player, entities, world, preTurnEntities)
    .filter(change => change.deltaType !== 'relation');
}
