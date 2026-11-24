import { describe, expect, it } from 'vitest';
import { buildFactionMoodBlock, deriveFactionMoods } from '../ai/core/factionMood';
import { buildNpcMindPrompt } from '../ai/prompts/npcMind';
import { turnedContactsOf, spyNetworkReachIds, evaluateCounterIntelRisk } from '../perception/spyNetwork';
import { buildPlayerPerceivedDigest } from '../perception/visibility';
import { makeEntity, makeRelationship, makeWorldState } from './factories';

describe('3C: Faction Collective Moods + Turned Spy Contacts', () => {
  it('derives collective faction mood without leaking member secrets and injects safely into npcMind prompt', () => {
    const senate = makeEntity({
      entity_id: 'roman_senate',
      name: 'Roman Senate',
      entity_type: 'faction',
      short_term_goals: ['Defend patrician tax exemptions'],
      current_state_narrative: 'Pressing the palace for fiscal restraint.',
    });
    const senatorA = makeEntity({
      entity_id: 'sen_a',
      name: 'Senator Cassius',
      faction_id: 'roman_senate',
      secrets: ['MEMBER_SECRET_SENTINEL'],
      relationships: {
        sen_b: makeRelationship({ entity_id: 'sen_b', trust_level: -4 }),
      },
    });
    const senatorB = makeEntity({
      entity_id: 'sen_b',
      name: 'Senator Gaius',
      faction_id: 'roman_senate',
      active_scheme: { name: 'MEMBER_SCHEME_SENTINEL', overall_goal: 'Seize grain', steps: [] },
      relationships: {
        sen_a: makeRelationship({ entity_id: 'sen_a', trust_level: -3 }),
      },
    });
    const world = makeWorldState({ political_climate: 'Volatile', economic_stability: 'Strained' });

    const moods = deriveFactionMoods([senate, senatorA, senatorB], world, 4);
    expect(moods).toHaveLength(1);
    expect(moods[0]).toMatchObject({
      factionId: 'roman_senate',
      memberCount: 2,
      cohesion: 'fracturing',
      agenda: 'Defend patrician tax exemptions',
    });

    const block = buildFactionMoodBlock(moods, 'roman_senate');
    expect(block).toContain('(your own faction)');
    expect(block).not.toContain('MEMBER_SECRET_SENTINEL');
    expect(block).not.toContain('MEMBER_SCHEME_SENTINEL');

    const { prompt, systemInstruction } = buildNpcMindPrompt({
      self: senatorA,
      perceivedChanges: [],
      publicHeadlines: [],
      worldSummary: 'Turn 4, Volatile',
      turnNumber: 4,
      factionMoods: moods,
    });
    expect(prompt).toContain('COLLECTIVE FACTION CLIMATES');
    // Guard pinned phrases never enter npcMind prompts.
    expect(`${systemInstruction}\n${prompt}`.toLowerCase()).not.toContain('whose actions');
    expect(`${systemInstruction}\n${prompt}`.toLowerCase()).not.toContain('merely mention');
  });

  it('identifies turned contacts by blackmail, devotion, or dependency, assesses counter-intel risk, and expands opt-in digest reach', () => {
    const player = makeEntity({
      entity_id: 'player_1',
      name: 'Severus',
      location: 'Palatine Hill',
      resources: { blackmail_on_clerk: ['Bribed the grain customs ledger.'] },
      visibility_network: [],
    });
    const clerk = makeEntity({
      entity_id: 'clerk',
      name: 'Sabinus',
      location: 'The Suburra',
      visibility_network: ['thrax'],
      personality: { ambition: 5, paranoia: 7, loyalty: 3, cunning: 8, honor: 4 },
    });
    const devotee = makeEntity({
      entity_id: 'tribune_ally',
      name: 'Rufus',
      location: 'Praetorian Camp',
      visibility_network: ['prefect'],
      relationships: {
        player_1: makeRelationship({ entity_id: 'player_1', trust_level: 8 }),
      },
      personality: { ambition: 3, paranoia: 3, loyalty: 9, cunning: 4, honor: 8 },
    });
    const target = makeEntity({
      entity_id: 'thrax',
      name: 'Maximinus Thrax',
      location: 'Germania',
      personality: { ambition: 9, paranoia: 8, loyalty: 3, cunning: 7, honor: 5 },
    });

    const turned = turnedContactsOf([player, clerk, devotee, target], player);
    expect(turned.map(t => [t.entityId, t.reason])).toEqual([
      ['clerk', 'blackmail'],
      ['tribune_ally', 'devotion'],
    ]);

    const blackmailed = turned.find(t => t.entityId === 'clerk')!;
    const faithful = turned.find(t => t.entityId === 'tribune_ally')!;
    expect(blackmailed.doubleAgentRisk).toBeGreaterThan(faithful.doubleAgentRisk);

    const risk = evaluateCounterIntelRisk(blackmailed, target);
    expect(risk.riskLevel).toBe('high');

    const reach = spyNetworkReachIds([player, clerk, devotee, target], player);
    expect(reach).toContain('thrax');

    const world = makeWorldState({ regions: { Germania: { stability: 'Unrest', controlling_faction: null, current_events: [] } } });
    const deltas = [{ type: 'resource' as const, key: 'thrax:denarii', delta: 500, reason: 'Military pay arrived.' }];

    // Default visibility without extraNetworkIds hides distant non-network entity.
    expect(buildPlayerPerceivedDigest(deltas, player, [player, clerk, devotee, target], world)).toEqual([]);

    // Opt-in spyNetworkReachIds surfaces it via 'network'.
    const expanded = buildPlayerPerceivedDigest(deltas, player, [player, clerk, devotee, target], world, undefined, { extraNetworkIds: reach });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].source).toBe('network');
  });
});
