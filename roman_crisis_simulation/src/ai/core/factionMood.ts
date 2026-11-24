/**
 * ai/core/factionMood.ts
 *
 * B6 / G3 Collective Faction Mood & Agenda summarization: derives per-viewer
 * collective posture lines for living `faction` and `group` entities so
 * spotlight NPC mind calls (ai/prompts/npcMind.ts) understand institutional
 * currents strictly within D10 epistemic isolation and D41 prompt boundaries.
 *
 * HARD GUARDS (D10 / D41):
 *   - Unknown blocs are omitted completely.
 *   - Other (non-own) blocs expose ONLY public world-state posture and the
 *     count of known active individual members — NEVER rival goals, rival
 *     state narratives, or internal member-to-member trust/cohesion.
 *   - Names and agenda text pass through `asPromptData` before interpolation.
 *   - Never use phrases restricted in actorsPromptContract tests.
 */
import type { Entity, WorldState } from '../../types';
import { asPromptData } from '../prompts/fragments';

type FactionCohesion = 'united' | 'factional' | 'fracturing';
type FactionPosture = 'assertive' | 'watchful' | 'defensive' | 'restless';

export interface FactionMoodSummary {
  factionId: string;
  factionName: string;
  memberCount?: number;
  cohesion?: FactionCohesion;
  posture: FactionPosture;
  agenda: string;
  isOwnFaction: boolean;
}

function summarizeCohesion(members: readonly Entity[]): FactionCohesion {
  let internalDisputes = 0;
  let internalBonds = 0;
  for (const m of members) {
    for (const other of members) {
      if (m.entity_id === other.entity_id) continue;
      const rel = m.relationships[other.entity_id];
      if (!rel) continue;
      if (rel.trust_level <= -2) internalDisputes++;
      else if (rel.trust_level >= 3) internalBonds++;
    }
  }
  if (internalDisputes > internalBonds && internalDisputes > 0) return 'fracturing';
  if (internalDisputes > 0) return 'factional';
  return 'united';
}

function summarizePublicPosture(worldState: WorldState): FactionPosture {
  const macro = `${worldState.economic_stability} ${worldState.political_climate}`.toLowerCase();
  if (/hostile|volatile|strained|failing|crisis|chaos|civil war/.test(macro)) return 'restless';
  return 'watchful';
}

function summarizeOwnPosture(bloc: Entity, worldState: WorldState): FactionPosture {
  const econ = worldState.economic_stability.toLowerCase();
  const climate = worldState.political_climate.toLowerCase();
  const narrative = `${bloc.current_state_narrative} ${bloc.short_term_goals.join(' ')}`.toLowerCase();

  if (/revolt|mutin|march|seize|strike|demand/.test(narrative)) return 'restless';
  if (/crisis|failing|hostile|collapse/.test(`${econ} ${climate}`) && /guard|defend|protect|conserve/.test(narrative)) {
    return 'defensive';
  }
  if (/expand|press|secure|rally|leverage|assert/.test(narrative)) return 'assertive';
  return summarizePublicPosture(worldState);
}

function viewerKnowsEntity(viewer: Entity, entityId: string): boolean {
  return viewer.visibility_network.includes(entityId) || Boolean(viewer.relationships[entityId]);
}

/**
 * Derives per-viewer collective faction/group summaries strictly respecting D10
 * epistemic boundaries. Unknown blocs are omitted; known other blocs expose
 * public world posture and known member count only (never rival goals,
 * narratives, or internal cohesion).
 */
export function deriveFactionMoodsForViewer(
  viewer: Entity,
  entities: readonly Entity[],
  worldState: WorldState,
): FactionMoodSummary[] {
  const livingBlocs = entities.filter(
    e => (e.entity_type === 'faction' || e.entity_type === 'group') && e.status === 'alive',
  );

  const summaries: FactionMoodSummary[] = [];
  for (const bloc of livingBlocs) {
    const isOwnFaction = Boolean(viewer.faction_id && viewer.faction_id === bloc.entity_id);
    const livingIndividualMembers = entities.filter(
      e => e.entity_type === 'individual' && e.status === 'alive' && e.faction_id === bloc.entity_id,
    );
    const knownMembers = livingIndividualMembers.filter(m => viewerKnowsEntity(viewer, m.entity_id));
    const knowsBlocDirectly = viewerKnowsEntity(viewer, bloc.entity_id);

    if (!isOwnFaction && !knowsBlocDirectly && knownMembers.length === 0) {
      continue;
    }

    if (isOwnFaction) {
      const firstGoal = bloc.short_term_goals.map(goal => goal.trim()).find(Boolean);
      const narrative = bloc.current_state_narrative.trim();
      const agenda = firstGoal || narrative || `${bloc.name} holds its present station.`;
      summaries.push({
        factionId: bloc.entity_id,
        factionName: bloc.name,
        memberCount: livingIndividualMembers.length,
        ...(livingIndividualMembers.length >= 2 ? { cohesion: summarizeCohesion(livingIndividualMembers) } : {}),
        posture: summarizeOwnPosture(bloc, worldState),
        agenda,
        isOwnFaction: true,
      });
    } else {
      summaries.push({
        factionId: bloc.entity_id,
        factionName: bloc.name,
        ...(knownMembers.length > 0 ? { memberCount: knownMembers.length } : {}),
        posture: summarizePublicPosture(worldState),
        agenda: 'Public standing observed from afar.',
        isOwnFaction: false,
      });
    }
  }

  return summaries;
}

/**
 * Formats collective faction mood context for an NPC mind prompt, listing the
 * character's own faction first when present. Returns '' when empty.
 * Delimits names and agenda values via `asPromptData` (D41).
 */
export function buildFactionMoodBlock(
  moods: readonly FactionMoodSummary[] | undefined,
  selfFactionId?: string,
): string {
  if (!moods || moods.length === 0) return '';
  const ordered = [...moods].sort((a, b) => {
    const aOwn = a.isOwnFaction || (Boolean(selfFactionId) && a.factionId === selfFactionId);
    const bOwn = b.isOwnFaction || (Boolean(selfFactionId) && b.factionId === selfFactionId);
    if (aOwn && !bOwn) return -1;
    if (bOwn && !aOwn) return 1;
    return a.factionName.localeCompare(b.factionName);
  });

  const lines = ordered.map(m => {
    const isOwn = m.isOwnFaction || (Boolean(selfFactionId) && m.factionId === selfFactionId);
    const tag = isOwn ? ' (your own faction)' : '';
    const traits = m.cohesion !== undefined ? `${m.posture}, ${m.cohesion}` : m.posture;
    const countPart = m.memberCount !== undefined
      ? ` (${m.memberCount} ${m.memberCount === 1 ? 'active figure' : 'active figures'})`
      : '';
    return `- ${asPromptData(m.factionName)}${tag}: ${traits}${countPart} - ${asPromptData(m.agenda)}`;
  });

  return `
COLLECTIVE FACTION CLIMATES (institutional currents shaping Rome this week):
${lines.join('\n')}
`;
}
