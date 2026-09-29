/**
 * @vitest-environment jsdom
 *
 * Regression tests for the perception cluster of the 2026-09 audit: what
 * the player perceives (perception/visibility.ts), what the knowledge store
 * keeps of it (knowledge/*), and the intelligence surfaces that render it
 * (Personae, Events, Reports, Chronicle). Each describe names the finding
 * it pins.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import { buildPlayerPerceivedDigest, buildPerceivedDigest, classifyDelta, tabsForDelta, type TabId } from '../perception/visibility';
import { applyAdjudication } from '../ai/core/engine';
import {
  deriveDossier, examinedOccurrences, ingestInvestigationReveal, ingestOccurrenceFinding, ingestPerceivedChanges,
  ingestReports, MAX_KNOWLEDGE_CLAIMS, SCHEME_CLUES_TO_REVEAL, type KnowledgeClaim,
} from '../knowledge/store';
import { computeDeepAnalysisKnowledge, computeInvestigationKnowledge, computeTurnKnowledge } from '../knowledge/commit';
import { corroboration } from '../knowledge/credibilityFraming';
import { isEntityKnownToPlayer, validateRelationshipObservationDrafts } from '../knowledge/relationships';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { tabChangeCountsFor, usePlayerPerception } from '../hooks/usePlayerPerception';
import { withOldSnapshotsDropped, KEEP_FULL_SNAPSHOTS } from '../state/gameReducer';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import { buildChronicleSpine } from '../components/tabs/chronicleSpine';
import { SchemeIntelSection } from '../components/tabs/dramatisPersonaeUi';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import CurrentEventsTab from '../components/tabs/CurrentEventsTab';
import ChronicleTab from '../components/tabs/ChronicleTab';
import ReportsTab from '../components/tabs/ReportsTab';
import EmpireTab from '../components/tabs/EmpireTab';
import ResourcesTab from '../components/tabs/ResourcesTab';
import RelationshipsTab from '../components/tabs/RelationshipsTab';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import { renderHook } from './renderHook';
import { makeEntity, makeQueuedTextAi, makeReport, makeTurnHistoryEntry, makeWorldState } from './factories';
import type { Adjudication, Entity, EventDelta, InvestigationResult, Report, TurnHistoryEntry, WorldState } from '../types';
import type { DomainCommit } from '../app/transactions';
import type { SaveGameState } from '../persistence/saveGame';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const region = (stability = 'Stable') => ({ stability, controlling_faction: null, current_events: [] });
const world: WorldState = makeWorldState({
  regions: { 'Palatine Hill': region(), 'The Curia': region(), 'The Suburra': region() },
});
const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill', resources: { denarii: 100, investigations: 3, deep_analyses: 2 } });
const marcus = makeEntity({ entity_id: 'marcus', name: 'Marcus Aquila', location: 'Palatine Hill', position: 'Tribune' });
const gaius = makeEntity({ entity_id: 'gaius', name: 'Gaius Pontius', location: 'The Suburra' });

const status = (key: string, extra: Partial<EventDelta> = {}): EventDelta => ({ type: 'status', key, delta: 0, reason: 'Narrative only.', ...extra });
const moved = (entity: Entity, location: string): Entity => ({ ...entity, location });
const adjudication = (deltas: EventDelta[]): Adjudication => ({ turn: 2, entityActions: [], deltas, headlines: [], gm_private: [] });

const noopMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });

let container: HTMLDivElement;
let root: Root;
let mounted = false;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  localStorage.clear();
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove();
});

async function mount(node: React.ReactNode): Promise<void> {
  await act(async () => root.render(node));
}

async function remount(node: React.ReactNode): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount(node);
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function button(scope: ParentNode, startsWith: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim().startsWith(startsWith));
  expect(found, `button starting "${startsWith}"`).toBeDefined();
  return found!;
}

function sectionTitled(title: string): HTMLElement {
  const label = Array.from(container.querySelectorAll('span')).find(span => span.textContent === title);
  expect(label, `section "${title}"`).toBeDefined();
  return label!.parentElement as HTMLElement;
}

// ---------------------------------------------------------------------------
// knowledge-departures-unwitnessed
// ---------------------------------------------------------------------------
describe('a departure from the viewer\'s room is witnessed, given the pre-turn roster', () => {
  const leaves = status('marcus', { new_location: 'The Curia' });
  const after = [player, moved(marcus, 'The Curia'), gaius];
  const before = [player, marcus, gaius];

  it('classifies the NPC walking out as witnessed, and says where he went', () => {
    expect(classifyDelta(leaves, player, after, world, before)).toEqual({ visible: true, source: 'witnessed' });
    expect(buildPlayerPerceivedDigest([leaves], player, after, world, before).map(change => change.text))
      .toEqual(['Marcus Aquila leaves for The Curia.']);
  });

  it('keeps the old post-turn-only rule for a caller with no pre-turn roster', () => {
    expect(classifyDelta(leaves, player, after, world)).toEqual({ visible: false, source: null });
  });

  it('limits the pre-turn rule to status deltas: a departed schemer is not seen plotting', () => {
    const scheme: EventDelta = { type: 'scheme', key: 'marcus', delta: 0, reason: '{}' };
    expect(classifyDelta(scheme, player, after, world, before).visible).toBe(false);
  });

  it('stamps the departure into a watching NPC\'s memory too (NPC perception uses the same rule)', () => {
    const watcher = makeEntity({ entity_id: 'watcher', name: 'Watcher', location: 'Palatine Hill' });
    const { updatedEntities } = applyAdjudication(adjudication([leaves]), [player, marcus, watcher], world, [], [], {
      playerEntityId: 'player', spotlightIds: ['watcher'], turnNumber: 2,
    });
    const memories = updatedEntities.find(entity => entity.entity_id === 'watcher')!.memories;
    expect(memories.map(memory => memory.event_description)).toContain('Marcus Aquila leaves for The Curia.');
  });
});

// ---------------------------------------------------------------------------
// knowledge-status-lines-misreport + rules-relocation-digest-is-now-changed
// ---------------------------------------------------------------------------
describe('status lines say what happened - never "is now changed", never a no-op', () => {
  it('renders an arrival as movement, and the player\'s own travel as theirs', () => {
    const arrives = status('gaius', { new_location: 'Palatine Hill' });
    const travels = status('player', { new_location: 'The Curia' });
    const after = [moved(player, 'The Curia'), marcus, moved(gaius, 'Palatine Hill')];
    const viewer = after[0];
    const networked = { ...viewer, visibility_network: ['gaius'] };
    const lines = buildPlayerPerceivedDigest([arrives, travels], networked, after, world, [player, marcus, gaius]).map(c => c.text);
    expect(lines).toEqual(['Gaius Pontius leaves for Palatine Hill.', 'You make your way to The Curia.']);
    const witness = buildPlayerPerceivedDigest([arrives], player, [player, marcus, moved(gaius, 'Palatine Hill')], world, [player, marcus, gaius]);
    expect(witness.map(c => c.text)).toEqual(['Gaius Pontius arrives at Palatine Hill.']);
    for (const text of [...lines, ...witness.map(c => c.text)]) expect(text).not.toContain('changed');
  });

  it('never claims a move to a region the engine did not apply', () => {
    const nowhere = status('marcus', { new_location: 'Ravenna' });
    const { updatedEntities } = applyAdjudication(adjudication([nowhere]), [player, marcus], world, []);
    expect(updatedEntities.find(e => e.entity_id === 'marcus')!.location).toBe('Palatine Hill');
    expect(classifyDelta(nowhere, player, updatedEntities, world, [player, marcus]).visible).toBe(false);
    expect(classifyDelta(nowhere, player, updatedEntities, world).visible).toBe(false);
  });

  it('drops a status delta that changed nothing - an overruled death, a survived death save', () => {
    const overruled = status('marcus', { new_status: 'alive' });
    const survived = status('player', { new_status: 'alive' });
    expect(buildPlayerPerceivedDigest([overruled, survived], player, [player, marcus], world, [player, marcus])).toEqual([]);
  });

  it('still announces a real change, carrying the believed status in structured form', () => {
    const dies = status('marcus', { new_status: 'dead' });
    const [line] = buildPlayerPerceivedDigest([dies], player, [player, { ...marcus, status: 'dead' }], world, [player, marcus]);
    expect(line.text).toBe('Marcus Aquila is now dead.');
    expect(line.perceivedStatus).toBe('dead');
  });

  it('ignores a key the engine would not look up whole', () => {
    expect(classifyDelta(status('marcus:status', { new_status: 'exiled' }), player, [player, marcus], world).visible).toBe(false);
  });

  it('never lets a relocation claim a death another delta dealt', () => {
    const deltas = [status('marcus', { new_location: 'The Curia' }), status('marcus', { new_status: 'dead' })];
    const { updatedEntities } = applyAdjudication(adjudication(deltas), [player, marcus], world, []);
    expect(updatedEntities.find(e => e.entity_id === 'marcus')!.status).toBe('dead');
    // Seen leaving (the pre-turn roster), or heard of through the network (none).
    const networked = { ...player, visibility_network: ['marcus'] };
    for (const [viewer, before] of [[player, [player, marcus]], [networked, undefined]] as const) {
      expect(buildPlayerPerceivedDigest(deltas, viewer, updatedEntities, world, before).map(c => c.text))
        .toEqual(['Marcus Aquila is now dead.']);
    }
    const own = [status('player', { new_location: 'The Curia' }), status('player', { new_status: 'dead' })];
    const fallen = applyAdjudication(adjudication(own), [player, marcus], world, []).updatedEntities;
    expect(buildPlayerPerceivedDigest(own, fallen[0], fallen, world, [player, marcus]).map(c => c.text))
      .toEqual(['Your own fate turns: you are now dead.']);
  });

  it('reads a legacy delta\'s status off its own reason, as the engine does', () => {
    const slain = status('marcus', { reason: 'Marcus Aquila was slain in the forum.' });
    const spared = status('marcus', { reason: 'He nearly died but survived the ambush.', new_location: 'The Curia' });
    const applied = applyAdjudication(adjudication([slain]), [player, marcus], world, []).updatedEntities;
    expect(applied.find(e => e.entity_id === 'marcus')!.status).toBe('dead');
    expect(buildPlayerPerceivedDigest([slain], player, applied, world, [player, marcus]).map(c => c.text))
      .toEqual(['Marcus Aquila is now dead.']);
    const walked = applyAdjudication(adjudication([spared]), [player, marcus], world, []).updatedEntities;
    expect(walked.find(e => e.entity_id === 'marcus')!.status).toBe('alive');
    expect(buildPlayerPerceivedDigest([spared], player, walked, world, [player, marcus]).map(c => c.text))
      .toEqual(['Marcus Aquila leaves for The Curia.']);
  });
});

// ---------------------------------------------------------------------------
// knowledge-status-lines-misreport: the Dispatches re-derivation
// ---------------------------------------------------------------------------
describe('the Dispatches digest is re-derived with the roster the commit used', () => {
  const deltas = [status('player', { new_status: 'alive' }), status('marcus', { new_location: 'The Curia' })];
  const after = [player, moved(marcus, 'The Curia'), gaius];
  const roster = [player, marcus, gaius].map(({ entity_id, location, status: life }) => ({ entity_id, location, status: life }));
  const derive = (turnHistory: TurnHistoryEntry[]) => {
    const hook = renderHook(
      (history: TurnHistoryEntry[]) => usePlayerPerception([], history, 'player', world, []),
      turnHistory,
    );
    const lines = hook.current.lastTurnPerceivedChanges.map(change => change.text);
    hook.unmount();
    return lines;
  };

  it('drops a survived death save and sees a departure on the very first turn', () => {
    const first = makeTurnHistoryEntry({ turnNumber: 1, adjudication: { ...adjudication(deltas), turn: 1 }, postTurnEntities: after, preTurnRoster: roster });
    expect(derive([first])).toEqual(['Marcus Aquila leaves for The Curia.']);
  });

  it('prefers the recorded roster, and falls back to the previous snapshot for an older entry', () => {
    const previous = makeTurnHistoryEntry({ turnNumber: 1, postTurnEntities: [player, marcus, gaius] });
    const legacy = makeTurnHistoryEntry({ turnNumber: 2, adjudication: adjudication(deltas), postTurnEntities: after });
    expect(derive([previous, legacy])).toEqual(['Marcus Aquila leaves for The Curia.']);
    // Between turns Marcus had already gone; the recorded roster says so.
    const recorded = { ...legacy, preTurnRoster: roster.map(entry => entry.entity_id === 'marcus' ? { ...entry, location: 'The Curia' } : entry) };
    expect(derive([previous, recorded])).toEqual([]);
  });

  it('trims the recorded roster with the snapshot', () => {
    const history = Array.from({ length: KEEP_FULL_SNAPSHOTS + 1 }, (_, i) =>
      makeTurnHistoryEntry({ turnNumber: i + 1, postTurnEntities: after, preTurnRoster: roster }));
    const trimmed = withOldSnapshotsDropped(history);
    expect('preTurnRoster' in trimmed[0]).toBe(false);
    expect(trimmed[1].preTurnRoster).toEqual(roster);
  });
});

// ---------------------------------------------------------------------------
// rules-dead-npc-still-plotting
// ---------------------------------------------------------------------------
describe('nobody perceives a dead man plotting', () => {
  it('leaves a scheme delta for a publicly dead (even secretly alive) entity invisible to every viewer', () => {
    const presumedDead: Entity = { ...marcus, status: 'dead', secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'Return.' } };
    const scheme: EventDelta = { type: 'scheme', key: 'marcus', delta: 0, reason: '{"name":"Return"}' };
    const deltas = [status('marcus', { new_status: 'dead' }), scheme];
    const digest = buildPlayerPerceivedDigest(deltas, player, [player, presumedDead], world, [player, marcus]);
    expect(digest.map(change => change.text)).toEqual(['Marcus Aquila is now dead.']);
    const knowledge = ingestPerceivedChanges([], digest, 2);
    expect(knowledge.some(claim => claim.claimKey === 'scheme:marcus')).toBe(false);
    const bystander = makeEntity({ entity_id: 'bystander', location: 'Palatine Hill' });
    expect(buildPerceivedDigest([scheme], bystander, [player, presumedDead, bystander], world)).toEqual([]);
  });

  it('still lets a living schemer be sensed', () => {
    const scheme: EventDelta = { type: 'scheme', key: 'marcus', delta: 0, reason: '{}' };
    expect(classifyDelta(scheme, player, [player, marcus], world).visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// knowledge-region-noop-announced (classifier half)
// ---------------------------------------------------------------------------
describe('a region delta is perceived only when the engine applies it', () => {
  it.each(['Palatine Hill', 'Palatine Hill:controlling_faction', 'Ravenna:stability'])('%s changes nothing, so nobody sees it', key => {
    const delta: EventDelta = { type: 'region', key, delta: 0, reason: 'Riots' };
    const { updatedWorldState } = applyAdjudication(adjudication([delta]), [player], world, []);
    expect(updatedWorldState.regions['Palatine Hill'].stability).toBe('Stable');
    expect(classifyDelta(delta, player, [player], updatedWorldState)).toEqual({ visible: false, source: null });
  });

  it('keeps the authored "<region>:stability" form witnessed', () => {
    const delta: EventDelta = { type: 'region', key: 'Palatine Hill:stability', delta: 0, reason: 'Restive' };
    expect(classifyDelta(delta, player, [player], world)).toEqual({ visible: true, source: 'witnessed' });
  });
});

// ---------------------------------------------------------------------------
// knowledge-tab-counts-disagree-with-tabs
// ---------------------------------------------------------------------------
describe('a tab coin points only at a tab that shows the change', () => {
  it('maps each delta type to the tab that renders its subject', () => {
    expect(tabsForDelta({ type: 'resource', key: 'player:denarii', delta: 5, reason: '' }, 'player')).toEqual(['resources']);
    expect(tabsForDelta({ type: 'resource', key: 'marcus:grain', delta: -5, reason: '' }, 'player')).toEqual([]);
    expect(tabsForDelta({ type: 'region', key: 'Palatine Hill:stability', delta: 0, reason: '' }, 'player')).toEqual(['locations']);
    expect(tabsForDelta({ type: 'add_region', key: 'Ostia', delta: 0, reason: '{}' }, 'player')).toEqual(['locations']);
    expect(tabsForDelta({ type: 'remove_region', key: 'Ostia', delta: 0, reason: '' }, 'player')).toEqual(['locations']);
    expect(tabsForDelta({ type: 'faction', key: 'marcus', delta: 0, reason: 'senate' }, 'player')).toEqual(['dramatis_personae']);
    // Kept deliberately: the Header's "Changed this week" mark is the world
    // delta's designated change mark, so no tab coin.
    expect(tabsForDelta({ type: 'world', key: 'political_climate', delta: 0, reason: 'Hostile' }, 'player')).toEqual([]);
  });

  it('puts no Assets coin on a co-located NPC\'s resources', () => {
    const digest = buildPlayerPerceivedDigest([{ type: 'resource', key: 'marcus:grain', delta: -5, reason: '' }], player, [player, marcus], world);
    expect(digest).toHaveLength(1);
    expect([...tabChangeCountsFor(digest, [], null).keys()]).toEqual([]);
  });

  it('every tab a perceived delta names actually renders that delta\'s subject', async () => {
    const senate = makeEntity({ entity_id: 'senate', name: 'The Senate', entity_type: 'faction' });
    const before = [player, marcus, gaius, senate];
    const deltas: EventDelta[] = [
      { type: 'resource', key: 'player:denarii', delta: 5, reason: 'A purse.' },
      { type: 'region', key: 'Palatine Hill:stability', delta: 0, reason: 'Restive' },
      { type: 'faction', key: 'marcus', delta: 0, reason: 'senate' },
      { type: 'scheme', key: 'marcus', delta: 0, reason: '{}' },
      status('gaius', { new_location: 'Palatine Hill' }),
      { type: 'rumor', key: 'marcus', delta: 0.6, reason: 'Marcus owes the bankers.', topic: 'debts', is_true: true },
    ];
    const applied = applyAdjudication(adjudication(deltas), before, world, []);
    const playerAfter = applied.updatedEntities.find(entity => entity.entity_id === 'player')!;
    const digest = buildPlayerPerceivedDigest(deltas, playerAfter, applied.updatedEntities, applied.updatedWorldState, before);
    expect(digest.map(change => change.deltaType).sort()).toEqual(['faction', 'region', 'resource', 'rumor', 'scheme', 'status']);
    const knowledge = computeTurnKnowledge({ prev: [], perceivedChanges: digest, reportsBefore: [], reportsAfter: applied.updatedReports, turnNumber: 2 });

    const renderTab = (tab: TabId): React.ReactNode => {
      switch (tab) {
        case 'resources': return <ResourcesTab playerEntity={playerAfter} />;
        case 'locations': return <EmpireTab worldState={applied.updatedWorldState} entities={applied.updatedEntities} playerEntity={playerAfter} knowledge={knowledge} />;
        case 'reports': return <ReportsTab reports={applied.updatedReports} knowledge={knowledge} />;
        case 'dramatis_personae': return (
          <DramatisPersonaeTab playerEntity={playerAfter} entities={applied.updatedEntities} knowledge={knowledge} turnNumber={2}
            onSpendDeepAnalysis={() => true} onInvestigationOutcome={() => true} runDomainMutation={noopMutation}
            ai={{} as GoogleGenAI} isMockMode={true} />
        );
        default: throw new Error(`No tab renders ${tab} any more`);
      }
    };
    const subjectShown = (deltaType: string, subject: string): string => {
      if (deltaType === 'resource') return 'Denarii';
      if (deltaType === 'region') return 'Restive';
      if (deltaType === 'rumor') return 'Marcus owes the bankers.';
      return applied.updatedEntities.find(entity => entity.entity_id === subject)!.name;
    };
    for (const change of digest) {
      for (const tab of change.tabs) {
        await mount(renderTab(tab));
        expect(container.textContent, `${change.deltaType} -> ${tab}`).toContain(subjectShown(change.deltaType, change.subject));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// knowledge-scheme-nature-leaks-via-observation + knowledge-paid-intel-evaporates
// ---------------------------------------------------------------------------
describe('paid intel commits', () => {
  const livia = makeEntity({ entity_id: 'livia', name: 'Senator Livia' });
  const plot = 'Your agent is fairly sure Marcus Aquila has been meeting Senator Livia by night to plan the poisoning of the Emperor.';
  const excerpt = 'Marcus Aquila has been meeting Senator Livia by night to plan the poisoning of the Emperor.';

  function deps(overrides: Partial<IntelCommitsDeps> = {}) {
    const commits: DomainCommit[] = [];
    const input: IntelCommitsDeps = {
      ai: {} as GoogleGenAI,
      isMockMode: true,
      entities: [player, marcus, livia],
      playerCharacterId: 'player',
      knowledge: [],
      pendingIntelligenceFallout: [],
      messages: [],
      turnNumber: 4,
      buildSaveState: overrides => ({ ...overrides } as SaveGameState),
      commitDomainMutation: commit => { commits.push(commit); return true; },
      setTransactionNote: () => {},
      ...overrides,
    };
    return { input, commits };
  }
  const live: DomainMutationContext = { isCurrent: () => true };

  it('never offers a scheme report to the relationship selector, so one clue cannot publish the plot', async () => {
    const leak = [{ evidenceId: 'any', participantIds: ['marcus', 'livia'], excerpt }];
    const { ai, generateContent } = makeQueuedTextAi(JSON.stringify(leak));
    const { input, commits } = deps({ ai: ai as GoogleGenAI, isMockMode: false, knowledge: [{
      id: 'k', subject: 'livia', claim: 'x', claimKey: 'report:livia:general:rumor', firstLearnedTurn: 1, updates: [{ turn: 1, source: 'rumor', text: 'x' }],
    }] });
    const hook = renderHook(useIntelCommits, input);
    const result: InvestigationResult = { target_id: 'marcus', report: plot, consequences: null };
    await act(async () => { await hook.current.handleInvestigationOutcome('scheme', 'marcus', [], 1, result, live); });
    hook.unmount();

    expect(generateContent).not.toHaveBeenCalled();
    const action = commits[0].action as { knowledge: KnowledgeClaim[] };
    expect(action.knowledge.some(claim => claim.relationshipObservation)).toBe(false);
    expect(deriveDossier(action.knowledge, 'marcus').entries[0].schemeDiscovery).toEqual({ clues: 1, revealed: false });
    expect(JSON.stringify(action.knowledge)).not.toContain('poisoning');
  });

  it('commits a deep analysis WITH its spend, in one commit, as a dossier aspect', () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    expect(hook.current.handleDeepAnalysis('marcus', 1, 'He is dangerous.', live)).toBe(true);
    hook.unmount();

    expect(commits).toHaveLength(1);
    const { action, candidate } = commits[0] as DomainCommit & { action: { type: string; entities: Entity[]; knowledge: KnowledgeClaim[] } };
    expect(action.type).toBe('INVESTIGATION_COMMITTED');
    expect(action.entities.find(entity => entity.entity_id === 'player')!.resources.deep_analyses).toBe(1);
    expect(candidate.knowledge).toBe(action.knowledge);
    const entry = deriveDossier(action.knowledge, 'marcus').entries.find(candidateEntry => candidateEntry.kind === 'deep_analysis');
    expect(entry).toMatchObject({ latestText: 'He is dangerous.', lastRefreshedTurn: 4, source: 'spy' });
  });

  it('keeps the itemised beliefs the player was shown on the investigation claim', async () => {
    const { input, commits } = deps();
    const hook = renderHook(useIntelCommits, input);
    const result: InvestigationResult = { target_id: 'marcus', report: 'His beliefs, in brief.', consequences: null };
    await act(async () => { await hook.current.handleInvestigationOutcome('beliefs', 'marcus', ['Trusts only the legions.', 42], 1, result, live); });
    hook.unmount();
    const action = commits[0].action as { knowledge: KnowledgeClaim[] };
    expect(deriveDossier(action.knowledge, 'marcus').entries[0]).toMatchObject({
      kind: 'beliefs', latestText: 'His beliefs, in brief.', latestItems: ['Trusts only the legions.'],
    });
  });
});

/** A Personae tab wired like App: commits land in the store, and the desk locks while a request is in flight. */
const PersonaeHarness: React.FC<{ initial: KnowledgeClaim[]; entities: Entity[]; onKnowledge?: (next: KnowledgeClaim[]) => void; gate?: Promise<void> }> = ({ initial, entities, onKnowledge, gate }) => {
  const [knowledge, setKnowledge] = useState(initial);
  const [locked, setLocked] = useState(false);
  const commit = (next: KnowledgeClaim[]) => { setKnowledge(next); onKnowledge?.(next); return true; };
  const run: RunDomainMutation = async work => {
    setLocked(true);
    try {
      return { acquired: true, value: await work({ isCurrent: () => true }) };
    } finally {
      setLocked(false);
    }
  };
  return (
    <DramatisPersonaeTab
      playerEntity={{ ...player, visibility_network: ['marcus'] }}
      entities={entities}
      knowledge={knowledge}
      turnNumber={4}
      interactionLocked={locked}
      runDomainMutation={run}
      ai={{} as GoogleGenAI}
      isMockMode={true}
      onSpendDeepAnalysis={(targetId, _cost, analysis) => commit(computeDeepAnalysisKnowledge({ prev: knowledge, targetId, analysis, turnNumber: 4 }))}
      onInvestigationOutcome={async (kind, targetId, reportData, _cost, result) => {
        await gate;
        return commit(computeInvestigationKnowledge({
          prev: knowledge, targetId, kind, reportText: result.report, turnNumber: 4,
          items: Array.isArray(reportData) ? reportData.filter((item): item is string => typeof item === 'string') : undefined,
        }));
      }}
    />
  );
};

describe('paid intel survives a tab switch (knowledge-paid-intel-evaporates)', () => {
  it('keeps the Spymaster\'s Assessment and the itemised beliefs after the card unmounts', async () => {
    let latest: KnowledgeClaim[] = [];
    await mount(<PersonaeHarness initial={[]} entities={[player, marcus]} onKnowledge={next => { latest = next; }} />);
    await act(async () => button(container, 'Intel').click());
    await act(async () => button(container, 'Commission').click());
    await settle();
    await act(async () => button(sectionTitled('Beliefs'), 'Reveal').click());
    await settle();
    expect(container.textContent).toContain('(Mock Analysis)');
    expect(container.textContent).toContain('Believes the army is the only true power in Rome.');

    // A tab switch unmounts the card; remount it over the committed store.
    await remount(<PersonaeHarness initial={latest} entities={[player, marcus]} />);
    await act(async () => button(container, 'Intel').click());
    expect(container.textContent).toContain('(Mock Analysis)');
    expect(container.textContent).not.toContain('No deep analysis commissioned');
    expect(container.textContent).toContain('Believes the army is the only true power in Rome.');
    expect(container.textContent).toContain('As of Turn IV');
  });
});

// ---------------------------------------------------------------------------
// focus-lost-to-body (part a)
// ---------------------------------------------------------------------------
describe('focus stays with the intel the player just bought', () => {
  it('keeps the pressed Reveal focusable while the desk is locked, then moves focus to the finding', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mount(<PersonaeHarness initial={[]} entities={[player, marcus]} gate={gate} />);
    await act(async () => button(container, 'Intel').click());
    const reveal = button(sectionTitled('Beliefs'), 'Reveal');
    reveal.focus();
    await act(async () => reveal.click());
    await settle();

    expect(reveal.disabled).toBe(false);
    expect(reveal.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(reveal);

    await act(async () => { release(); });
    await settle();
    expect(document.activeElement?.textContent).toContain('Believes the army is the only true power in Rome.');
  });

  it('moves focus to an occurrence finding once it comes back', async () => {
    const Harness: React.FC = () => {
      const [knowledge, setKnowledge] = useState<KnowledgeClaim[]>([]);
      return (
        <CurrentEventsTab events={['The Praetorians demand a donative.']} week={3} playerEntity={player} allEntities={[player]}
          knowledge={knowledge} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={noopMutation}
          onFinding={(occurrence, question, text) => { setKnowledge(prev => ingestOccurrenceFinding(prev, { occurrence, question, text, turn: 3 })); return true; }} />
      );
    };
    await mount(<Harness />);
    await act(async () => button(container, '❧').click());
    const ask = button(container, 'Who gains?');
    ask.focus();
    await act(async () => ask.click());
    await settle();
    expect(document.activeElement?.classList.contains('gor-finding')).toBe(true);
  });

  it('spends a dossier landing once: collapsing and reopening the briefing leaves focus on the toggle', async () => {
    await mount(<PersonaeHarness initial={[]} entities={[player, marcus]} />);
    const intel = button(container, 'Intel');
    await act(async () => intel.click());
    await act(async () => button(sectionTitled('Beliefs'), 'Reveal').click());
    await settle();
    expect(document.activeElement?.textContent).toContain('Believes the army is the only true power in Rome.');

    intel.focus();
    await act(async () => intel.click());
    expect(intel.textContent).toBe('Intel');
    await act(async () => intel.click());
    expect(container.textContent).toContain('Believes the army is the only true power in Rome.');
    expect(document.activeElement).toBe(intel);

    // The next purchase still moves focus to what it bought.
    await act(async () => button(container, 'Commission').click());
    await settle();
    expect(document.activeElement?.textContent).toContain('(Mock Analysis)');
  });

  it('drops a landing that came back while the briefing was shut', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mount(<PersonaeHarness initial={[]} entities={[player, marcus]} gate={gate} />);
    const intel = button(container, 'Intel');
    await act(async () => intel.click());
    await act(async () => button(sectionTitled('Beliefs'), 'Reveal').click());
    await settle();
    intel.focus();
    await act(async () => intel.click());
    await act(async () => { release(); });
    await settle();
    await act(async () => intel.click());
    expect(container.textContent).toContain('Believes the army is the only true power in Rome.');
    expect(document.activeElement).toBe(intel);
  });

  it('spends an occurrence landing once: closing and reopening the slip, or switching register, leaves focus put', async () => {
    const occurrence = 'The Praetorians demand a donative.';
    const Harness: React.FC = () => {
      const [knowledge, setKnowledge] = useState<KnowledgeClaim[]>([]);
      return (
        <CurrentEventsTab events={[occurrence]} week={3} playerEntity={player} allEntities={[player]}
          knowledge={knowledge} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={noopMutation}
          onFinding={(asked, question, text) => { setKnowledge(prev => ingestOccurrenceFinding(prev, { occurrence: asked, question, text, turn: 3 })); return true; }} />
      );
    };
    await mount(<Harness />);
    const toggle = button(container, '❧');
    await act(async () => toggle.click());
    await act(async () => button(container, 'Who gains?').click());
    await settle();
    expect(document.activeElement?.classList.contains('gor-finding')).toBe(true);

    toggle.focus();
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(container.querySelector('.gor-finding')).not.toBeNull();
    expect(document.activeElement).toBe(toggle);

    const examined = button(container, 'Examined');
    examined.focus();
    await act(async () => examined.click());
    expect(container.querySelector('.gor-finding')).not.toBeNull();
    expect(document.activeElement).toBe(examined);
  });
});

// ---------------------------------------------------------------------------
// gui-allunset-no-focus-ring (Events occurrence toggle)
// ---------------------------------------------------------------------------
describe('the occurrence toggle carries the shared bare-button class', () => {
  it('drops the inline all:unset for gor-bare-btn, keeping its layout', async () => {
    await mount(<CurrentEventsTab events={['Grain ships arrive late.']} week={3} playerEntity={player} allEntities={[player]}
      knowledge={[]} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={noopMutation} onFinding={() => true} />);
    const toggle = button(container, '❧');
    expect(toggle.classList.contains('gor-bare-btn')).toBe(true);
    expect(toggle.getAttribute('style')).not.toMatch(/all:/);
    expect(toggle.style.display).toBe('flex');
  });
});

// ---------------------------------------------------------------------------
// gui-examined-register-drops-past-findings
// ---------------------------------------------------------------------------
describe('Examined holds every occurrence asked about this reign', () => {
  const old = 'The Praetorians demand a donative.';
  const store = ingestOccurrenceFinding([], { occurrence: old, question: 'who_gains', text: 'The prefect Aquila gains most.', turn: 1 });

  it('lists a past occurrence from the store, newest asked first', () => {
    const later = ingestOccurrenceFinding(store, { occurrence: 'Grain ships arrive late.', question: 'what_follows', text: 'Bread riots.', turn: 3 });
    expect(examinedOccurrences(later, [])).toEqual(['Grain ships arrive late.', old]);
  });

  it('renders the finding after its occurrence has left the week\'s cry, dated by the turn it was asked', async () => {
    localStorage.setItem('gloryOfRome:tabRegister:events', 'examined');
    await mount(<CurrentEventsTab events={['Grain ships arrive late.']} week={9} playerEntity={player} allEntities={[player]}
      knowledge={store} ai={{} as GoogleGenAI} isMockMode={true} runDomainMutation={noopMutation} onFinding={() => true} />);
    expect(container.textContent).toContain(old);
    expect(container.textContent).toContain('Asked of your agents · Turn I');
    expect(container.textContent).not.toContain('Cried in the forum · Week IX');
    await act(async () => button(container, '❧').click());
    expect(container.textContent).toContain('The prefect Aquila gains most.');
  });
});

// ---------------------------------------------------------------------------
// knowledge-corroboration-verdict-false + sources-agree-counts-repeated-source
// ---------------------------------------------------------------------------
describe('corroboration counts distinct sources, per topic', () => {
  const rumor = (topic: string, credibility = 0.5, extra: Partial<Report> = {}): Report =>
    makeReport({ id: `r_${topic}_${credibility}_${extra.turn ?? 2}`, source: 'rumor', topic, credibility, ...extra });

  it('does not call three matters from one source agreement', () => {
    expect(corroboration([rumor('health'), rumor('legion-loyalty', 0.6), rumor('marriage')]))
      .toEqual({ verdict: 'uncorroborated', sources: 1 });
  });

  it('does not call one source repeating itself agreement', () => {
    const repeats = [1, 2, 3, 4].map(turn => rumor('tribute', 0.6, { turn }));
    expect(corroboration(repeats)).toEqual({ verdict: 'uncorroborated', sources: 1 });
  });

  it('calls one matter from two different sources agreement, counting the sources', () => {
    expect(corroboration([rumor('health'), makeReport({ id: 'spy', source: 'spy', topic: 'health', credibility: 0.8 })]))
      .toEqual({ verdict: 'agree', sources: 2 });
  });

  it('never reads an explicit corroboration as a conflict', () => {
    const group = [rumor('health', 0.9), rumor('health', 0.2, { stance: 'corroborates', turn: 3 })];
    expect(corroboration(group).verdict).not.toBe('conflict');
  });

  it('shows a count of accounts, never "sources agree", over one source heard four times', async () => {
    const repeats = [1, 2, 3, 4].map(turn => rumor('tribute', 0.6, { turn, claim: 'The Emperor weighs a tribute.' }));
    await mount(<ReportsTab reports={repeats} />);
    expect(container.textContent).toContain('4 accounts');
    expect(container.textContent).not.toContain('sources agree');
  });
});

// ---------------------------------------------------------------------------
// knowledge-contradicts-above-misplaced
// ---------------------------------------------------------------------------
describe('the contradiction note is true wherever it sits', () => {
  it('names a firmer account without pointing above or below', async () => {
    const reports = [
      makeReport({ id: 'a', turn: 2, topic: 'health', credibility: 0.9, claim: 'Thrax is gravely ill' }),
      makeReport({ id: 'b', turn: 3, topic: 'health', credibility: 0.5, stance: 'contradicts', claim: 'Thrax is hale' }),
    ];
    await mount(<ReportsTab reports={reports} />);
    expect(container.textContent).toContain('— and it contradicts a firmer account.');
    expect(container.textContent).not.toContain('accounts above');
  });
});

// ---------------------------------------------------------------------------
// knowledge-own-order-existence-oracle
// ---------------------------------------------------------------------------
describe('the player\'s own order never proves a hidden figure exists', () => {
  const directory = [
    { entity_id: 'player', name: 'Severus Alexander' },
    { entity_id: 'thrax', name: 'Maximinus Thrax' },
    { entity_id: 'timesitheus', name: 'Timesitheus' },
  ];
  const order = 'I send word to Timesitheus and Maximinus Thrax to meet me at the Curia.';
  const draft = { evidenceId: 'player-submission', participantIds: ['timesitheus', 'thrax'], excerpt: 'Timesitheus and Maximinus Thrax' };

  it('rejects an unknown participant named only in self evidence, but not in world-authored evidence', () => {
    const known = ['player', 'thrax'];
    expect(validateRelationshipObservationDrafts({ drafts: [draft], evidence: [{ id: 'player-submission', source: 'self', text: order }], entities: directory, knownEntityIds: known })).toEqual([]);
    expect(validateRelationshipObservationDrafts({ drafts: [draft], evidence: [{ id: 'player-submission', source: 'rumor', text: order }], entities: directory, knownEntityIds: known })).toHaveLength(1);
  });

  it('keeps the hidden figure\'s id out of the selector prompt', async () => {
    const { ai, generateContent } = makeQueuedTextAi('[]');
    await getRelationshipObservations(ai, [{ id: 'player-submission', source: 'self', text: order }], directory, ['player', 'thrax']);
    expect(JSON.stringify(generateContent.mock.calls[0][0])).not.toContain('timesitheus');
  });
});

// ---------------------------------------------------------------------------
// knowledge-cap-evicts-paid-dossiers
// ---------------------------------------------------------------------------
describe('the claim cap evicts word received before what was paid for', () => {
  const livia = makeEntity({ entity_id: 'livia', name: 'Senator Livia', location: 'Antioch' });
  const chatter = (count: number, from: number) => Array.from({ length: count }, (_, i) => makeReport({
    id: `chatter_${from + i}`, turn: from + i, about: 'world', topic: `matter-${from + i}`,
  }));

  it('keeps an old bought dossier, and the knownness it grants, past the cap', () => {
    let store = ingestInvestigationReveal([], { targetId: 'livia', kind: 'beliefs', text: 'She trusts no one.', turn: 1 });
    store = ingestReports(store, chatter(MAX_KNOWLEDGE_CLAIMS + 5, 2));
    expect(store).toHaveLength(MAX_KNOWLEDGE_CLAIMS);
    expect(deriveDossier(store, 'livia').entries).toHaveLength(1);
    expect(isEntityKnownToPlayer(player, livia, store)).toBe(true);
  });

  it('never evicts the last claim that makes a figure known while other word can go', () => {
    let store = ingestReports([], [makeReport({ id: 'only', turn: 1, about: 'livia', topic: 'rumor-1' })]);
    store = ingestReports(store, chatter(MAX_KNOWLEDGE_CLAIMS + 5, 2));
    expect(store).toHaveLength(MAX_KNOWLEDGE_CLAIMS);
    expect(isEntityKnownToPlayer(player, livia, store)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// knowledge-personae-hides-unseen-death
// ---------------------------------------------------------------------------
describe('the roster shows what the player believes, not live status; allegiance is public (D49)', () => {
  const livia = makeEntity({ entity_id: 'livia', name: 'Senator Livia', location: 'Antioch' });
  const heardOf: KnowledgeClaim = { id: 'r', subject: 'livia', claim: 'Livia hosts a dinner.', claimKey: 'report:livia:general:rumor', firstLearnedTurn: 1, updates: [{ turn: 1, source: 'rumor', text: 'Livia hosts a dinner.' }] };
  const render = (entities: Entity[], knowledge: KnowledgeClaim[]) => mount(
    <DramatisPersonaeTab playerEntity={player} entities={entities} knowledge={knowledge} turnNumber={4}
      onSpendDeepAnalysis={() => true} onInvestigationOutcome={() => true} runDomainMutation={noopMutation}
      ai={{} as GoogleGenAI} isMockMode={true} />,
  );

  it('keeps a figure whose death the player never perceived', async () => {
    await render([player, { ...livia, status: 'dead' }], [heardOf]);
    expect(container.textContent).toContain('Senator Livia');
  });

  it('drops a figure the player saw fall', async () => {
    const dead = { ...livia, status: 'dead' as const };
    const seen = buildPlayerPerceivedDigest([status('livia', { new_status: 'dead' })], { ...player, visibility_network: ['livia'] }, [player, dead], world, [player, livia]);
    await render([player, dead], ingestPerceivedChanges([heardOf], seen, 3));
    expect(container.textContent).not.toContain('Senator Livia');
  });

  it('keeps a figure the player just saw arrive, whatever befell them out of sight before', async () => {
    const vanished = { ...livia, status: 'missing' as const };
    const arrives = status('livia', { new_location: 'Palatine Hill' });
    const [line] = buildPlayerPerceivedDigest([arrives], player, [player, moved(vanished, 'Palatine Hill')], world, [player, vanished]);
    expect(line.text).toBe('Senator Livia arrives at Palatine Hill.');
    expect(line.perceivedStatus).toBe('alive');
    await render([player, moved(vanished, 'Palatine Hill')], ingestPerceivedChanges([heardOf], [line], 3));
    expect(container.textContent).toContain('Senator Livia');
  });

  it('reads a legacy save\'s status line from its template, never from the live status', async () => {
    const legacyLine = (text: string): KnowledgeClaim => ({
      id: 'd', subject: 'livia', claim: text, claimKey: 'digest:status:livia', firstLearnedTurn: 2,
      updates: [{ turn: 2, source: 'network', text }],
    });
    const dead = { ...livia, status: 'dead' as const };
    await render([player, dead], [heardOf, legacyLine('Senator Livia is now changed.')]);
    expect(container.textContent).toContain('Senator Livia');
    await render([player, dead], [heardOf, legacyLine('Senator Livia is now alive.')]);
    expect(container.textContent).toContain('Senator Livia');
    await render([player, dead], [heardOf, legacyLine('Senator Livia is now dead.')]);
    expect(container.textContent).not.toContain('Senator Livia');
    await render([player, livia], [heardOf, legacyLine('Senator Livia is now exiled.')]);
    expect(container.textContent).not.toContain('Senator Livia');
  });

  // D49 (owner ruling, 2026-09-29) reversed the earlier pin here: a figure's
  // openly professed faction is PUBLIC knowledge, so the roster groups by the
  // live faction_id rather than by the last line the player happened to see.
  // Status stays a belief (the cases above); allegiance does not.
  it('groups a figure by the faction they openly profess - public knowledge (D49), whatever was last seen', async () => {
    const senate = makeEntity({ entity_id: 'senate', name: 'The Senate', entity_type: 'faction' });
    const knowsSenate: KnowledgeClaim = { ...heardOf, id: 's', subject: 'senate', claimKey: 'report:senate:general:rumor' };
    const seenJoining = buildPlayerPerceivedDigest([{ type: 'faction', key: 'livia', delta: 0, reason: 'senate' }], { ...player, visibility_network: ['livia'] }, [player, livia, senate], world);
    // She has since openly moved to a faction the player does not know: the
    // roster follows her open allegiance, and names no unknown faction.
    await render([player, { ...livia, faction_id: 'hidden_cabal' }, senate], ingestPerceivedChanges([heardOf, knowsSenate], seenJoining, 3));
    let text = container.textContent ?? '';
    expect(text.indexOf('Senator Livia')).toBeGreaterThan(text.indexOf('Other known figures'));
    expect(text).not.toContain('hidden_cabal');
    // Never seen joining, her open allegiance still groups her.
    await render([player, { ...livia, faction_id: 'senate' }, senate], [heardOf, knowsSenate]);
    text = container.textContent ?? '';
    expect(text.indexOf('Senator Livia')).toBeGreaterThan(text.indexOf('The Senate'));
    expect(text).not.toContain('Other known figures');
  });
});

// ---------------------------------------------------------------------------
// knowledge-never-in-a-room-false + gui-intel-disclosure-no-state
// ---------------------------------------------------------------------------
describe('the Personae card is honest and operable', () => {
  const render = () => mount(
    <DramatisPersonaeTab playerEntity={{ ...player, visibility_network: ['marcus'] }} entities={[player, marcus]} knowledge={[]} turnNumber={4}
      onSpendDeepAnalysis={() => true} onInvestigationOutcome={() => true} runDomainMutation={noopMutation}
      ai={{} as GoogleGenAI} isMockMode={true} />,
  );

  it('names the zero state\'s real cause: no observation on record, not absence from a room', async () => {
    await render();
    expect(container.textContent).toContain('Nothing you have seen or been told yet shows Marcus Aquila dealing with anyone.');
    expect(container.textContent).not.toContain('never been in a room');
  });

  it('exposes the Intel disclosure\'s state, what it controls, and whose it is', async () => {
    await render();
    const intel = button(container, 'Intel');
    expect(intel.getAttribute('aria-expanded')).toBe('false');
    expect(intel.getAttribute('aria-label')).toBe('Intel (Marcus Aquila)');
    await act(async () => intel.click());
    expect(intel.getAttribute('aria-expanded')).toBe('true');
    const controlled = document.getElementById(intel.getAttribute('aria-controls') ?? '');
    expect(controlled?.textContent).toContain('Intelligence Briefing');
  });
});

// ---------------------------------------------------------------------------
// gui-stitched-thread-unnamed
// ---------------------------------------------------------------------------
describe('scheme-discovery progress has a readable name', () => {
  it('names the stitched thread as an image', async () => {
    await mount(<SchemeIntelSection discovery={{ clues: 1, revealed: false }} threshold={SCHEME_CLUES_TO_REVEAL} cost={1} resourceCount={3}
      onInvestigate={() => {}} isLoading={false} tooltip="" />);
    const thread = container.querySelector('.gor-stitch');
    expect(thread?.getAttribute('role')).toBe('img');
    expect(thread?.getAttribute('aria-label')).toBe(`1 of ${SCHEME_CLUES_TO_REVEAL} threads uncovered`);
  });
});

// ---------------------------------------------------------------------------
// knowledge-turn-labelled-week
// ---------------------------------------------------------------------------
describe('turn-counter stamps say Turn, not Week', () => {
  it('labels the Chronicle rows by turn', () => {
    const spine = buildChronicleSpine([makeTurnHistoryEntry({ turnNumber: 2, playerIntent: 'Hold court.', narration: 'Quiet.' })], []);
    expect(spine[0].weekLabel).toBe('Turn II');
  });

  it('labels the dossier and relationship-map stamps by turn', async () => {
    const held = ingestInvestigationReveal([], { targetId: 'marcus', kind: 'beliefs', text: 'He trusts the legions.', turn: 3 });
    await mount(
      <DramatisPersonaeTab playerEntity={player} entities={[player, marcus]} knowledge={held} turnNumber={5}
        onSpendDeepAnalysis={() => true} onInvestigationOutcome={() => true} runDomainMutation={noopMutation}
        ai={{} as GoogleGenAI} isMockMode={true} />,
    );
    await act(async () => button(container, 'Intel').click());
    expect(container.textContent).toContain('First learned Turn III · as of Turn III');
    expect(container.textContent).not.toContain('Week III');

    const observation: KnowledgeClaim = {
      id: 'o', subject: 'marcus', claim: 'Marcus met Gaius.', claimKey: 'relationship-observation:3:0', firstLearnedTurn: 3,
      updates: [{ turn: 3, source: 'rumor', text: 'Marcus met Gaius.' }], relationshipObservation: { evidenceId: 'e', participantIds: ['marcus', 'gaius'] },
    };
    await mount(<RelationshipsTab knowledge={[observation]} entities={[marcus, gaius]} currentTurn={5} />);
    expect(container.textContent).toContain('As of Turn V.');
  });

  it('labels the Reports chronology by turn', async () => {
    localStorage.setItem('gloryOfRome:tabRegister:reports', 'week');
    await mount(<ReportsTab reports={[makeReport({ turn: 2 })]} />);
    expect(container.textContent).toContain('By turn');
    expect(container.textContent).toContain('Turn II');
  });

  it('stamps a new Report and its ledger entry with the authoritative turn, not the model\'s echo', () => {
    const rumor: EventDelta = { type: 'rumor', key: 'marcus', delta: 0.5, reason: 'Marcus owes the bankers.', is_true: true };
    const misLabelled: Adjudication = { ...adjudication([rumor]), turn: 40 };
    const stamped = applyAdjudication(misLabelled, [player, marcus], world, [], [], { playerEntityId: 'player', turnNumber: 7 });
    expect(stamped.updatedReports.map(report => report.turn)).toEqual([7]);
    expect(stamped.updatedTruthLedger.map(entry => entry.turn)).toEqual([7]);
    // A caller with no counter keeps the old fallback.
    expect(applyAdjudication(misLabelled, [player, marcus], world, []).updatedReports.map(report => report.turn)).toEqual([40]);
  });

  it('opens the empty Chronicle on the first turn, not a calendar week', async () => {
    await mount(<ChronicleTab eventHistory={[]} turnHistory={[]} />);
    expect(container.textContent).toContain('Turn I · The reign begins');
    expect(container.textContent).not.toContain('Week I');
  });
});

// ---------------------------------------------------------------------------
// chronicle-tab-raw-submission-json
// ---------------------------------------------------------------------------
describe('the Chronicle quotes the order in the player\'s words', () => {
  const entry = (playerIntent: string) => makeTurnHistoryEntry({ turnNumber: 4, playerIntent, narration: 'The week turned.' });

  it('summarises a structured turn by display name, never the wire form or an entity id', () => {
    const wire = serializeTurnSubmission({
      version: 1, kind: 'structured', actions: ['I review the treasury accounts myself.'],
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'julia_mamaea', displayName: 'Julia Mamaea' }, command: 'Come to the Palatine.' }],
      privateIntent: 'I want to test her loyalty.',
    });
    const [row] = buildChronicleSpine([entry(wire)], []);
    expect(row.order).toBe('I review the treasury accounts myself. · To Julia Mamaea: Come to the Palatine.');
    expect(row.order).not.toContain('GOR_TURN_SUBMISSION');
    expect(row.order).not.toContain('julia_mamaea');
  });

  it('omits the order of a reserved artifact that fails to parse, and passes freeform text through', () => {
    const [broken] = buildChronicleSpine([entry('GOR_TURN_SUBMISSION/1\n{"broken":')], []);
    expect(broken.order).toBeUndefined();
    const [plain] = buildChronicleSpine([entry('I bribe the guard.')], []);
    expect(plain.order).toBe('I bribe the guard.');
  });
});
