/**
 * ai/core/factionMood.ts
 *
 * B6 / G3 Collective Faction Mood & Agenda summarization: derives compact,
 * bounded collective posture lines for living `faction` entities so spotlight
 * NPC mind calls (ai/prompts/npcMind.ts) understand institutional momentum
 * without extra LLM calls or leaking private member secrets.
 *
 * HARD GUARD: never include member `secrets` or `active_scheme` here, and
 * never use phrases restricted in npcMind/assessment tests.
 */
import type { Entity, WorldState } from '../../types';

export type FactionCohesion = 'united' | 'factional' | 'fracturing';
export type FactionPosture = 'assertive' | 'watchful' | 'defensive' | 'restless';

export interface FactionMoodSummary {
  factionId: string;
  factionName: string;
  memberCount: number;
  cohesion: FactionCohesion;
  posture: FactionPosture;
  agenda: string;
}

function summarizeCohesion(members: readonly Entity[], worldState: WorldState): FactionCohesion {
  if (members.length <= 1) {
    const climate = worldState.political_climate.toLowerCase();
    return /chaos|hostile|crisis|civil war/.test(climate) ? 'fracturing' : 'united';
  }
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

function summarizePosture(faction: Entity, worldState: WorldState): FactionPosture {
  const econ = worldState.economic_stability.toLowerCase();
  const climate = worldState.political_climate.toLowerCase();
  const narrative = `${faction.current_state_narrative} ${faction.short_term_goals.join(' ')}`.toLowerCase();

  if (/revolt|mutin|march|seize|strike|demand/.test(narrative)) return 'restless';
  if (/crisis|failing|hostile|collapse/.test(`${econ} ${climate}`) && /guard|defend|protect|conserve/.test(narrative)) {
    return 'defensive';
  }
  if (/expand|press|secure|rally|leverage|assert/.test(narrative)) return 'assertive';
  if (/hostile|volatile|strained|failing|crisis/.test(`${econ} ${climate}`)) return 'restless';
  return 'watchful';
}

/**
 * Builds public-and-structural faction mood summaries from living faction
 * records and publicly professed member rosters. Never copies member secrets
 * or member schemes.
 */
export function deriveFactionMoods(
  entities: readonly Entity[],
  worldState: WorldState,
  _turnNumber: number,
): FactionMoodSummary[] {
  const livingFactions = entities.filter(e => e.entity_type === 'faction' && e.status === 'alive');
  return livingFactions.map(faction => {
    const members = entities.filter(
      e => e.entity_id !== faction.entity_id && e.status === 'alive' && e.faction_id === faction.entity_id,
    );
    const cohesion = summarizeCohesion(members, worldState);
    const posture = summarizePosture(faction, worldState);
    const agenda = faction.short_term_goals[0]?.trim()
      || faction.current_state_narrative.trim()
      || `${faction.name} holds its present station.`;

    return {
      factionId: faction.entity_id,
      factionName: faction.name,
      memberCount: members.length,
      cohesion,
      posture,
      agenda,
    };
  });
}

/**
 * Formats collective faction mood context for an NPC mind prompt, listing the
 * character's own faction first when present. Returns '' when empty.
 */
export function buildFactionMoodBlock(
  moods: readonly FactionMoodSummary[] | undefined,
  selfFactionId?: string,
): string {
  if (!moods || moods.length === 0) return '';
  const ordered = [...moods].sort((a, b) => {
    if (selfFactionId && a.factionId === selfFactionId && b.factionId !== selfFactionId) return -1;
    if (selfFactionId && b.factionId === selfFactionId && a.factionId !== selfFactionId) return 1;
    return a.factionName.localeCompare(b.factionName);
  });

  const lines = ordered.map(m => {
    const tag = selfFactionId && m.factionId === selfFactionId ? ' (your own faction)' : '';
    return `- ${m.factionName}${tag}: ${m.posture}, ${m.cohesion} (${m.memberCount} active figures) - ${m.agenda}`;
  });

  return `
COLLECTIVE FACTION CLIMATES (institutional currents shaping Rome this week):
${lines.join('\n')}
`;
}
