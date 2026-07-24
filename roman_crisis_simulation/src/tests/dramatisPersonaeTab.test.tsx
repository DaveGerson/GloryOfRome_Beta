/**
 * @vitest-environment jsdom
 *
 * Task 6 player-safety contract for the real Personae component. The entity
 * graph is intentionally poisoned with hidden names, engine relationships,
 * live goals/state, an active scheme, and secret survivor truth. Only the
 * public identity fields and validated knowledge claims may reach the DOM.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import type { KnowledgeClaim, KnowledgeSource } from '../knowledge/store';
import type { Entity } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'entity_id' | 'name'>): Entity {
  return {
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

const player = makeEntity({
  entity_id: 'player',
  name: 'Severus Alexander',
  faction_id: 'imperial_household',
  visibility_network: ['known_actor', 'known_hidden_faction_member', 'dead_secret_actor'],
  resources: { investigations: 2, deep_analyses: 1 },
  relationships: {
    known_actor: {
      entity_id: 'known_actor',
      relationship_type: 'ENGINE_RELATIONSHIP_TYPE_SENTINEL',
      trust_level: 9101,
      respect_level: 9202,
      perceived_threat: 9303,
      ideological_alignment: 9404,
      dependency_level: 9505,
      recent_interactions: ['ENGINE_RECENT_INTERACTION_SENTINEL'],
    },
  },
});

const knownActor = makeEntity({
  entity_id: 'known_actor',
  name: 'Marcus the Known',
  position: 'Tribune of the Grain',
  faction_id: 'imperial_household',
  current_state_narrative: 'LIVE_STATE_NARRATIVE_SENTINEL',
  short_term_goals: ['LIVE_SHORT_TERM_GOAL_SENTINEL'],
  long_term_ambitions: ['LIVE_LONG_TERM_AMBITION_SENTINEL'],
  active_scheme: {
    name: 'ACTIVE_SCHEME_NAME_SENTINEL',
    overall_goal: 'ACTIVE_SCHEME_GOAL_SENTINEL',
    steps: [{ objective: 'ACTIVE_SCHEME_STEP_SENTINEL', status: 'in_progress' }],
  },
});

const observedActor = makeEntity({
  entity_id: 'observed_actor',
  name: 'Senator Livia',
  position: 'Senator',
  current_state_narrative: 'OBSERVED_LIVE_STATE_SENTINEL',
  short_term_goals: ['OBSERVED_LIVE_GOAL_SENTINEL'],
});

const offNetworkActor = makeEntity({
  entity_id: 'off_network_actor',
  name: 'OFF_NETWORK_ALIVE_NAME_SENTINEL',
  position: 'Hidden courtier',
});

const deadSecretActor = makeEntity({
  entity_id: 'dead_secret_actor',
  name: 'DEAD_SECRET_ACTOR_NAME_SENTINEL',
  status: 'dead',
  secret_truth: {
    actually_alive: true,
    hidden_since_turn: 3,
    motive: 'SECRET_TRUTH_MOTIVE_SENTINEL',
  },
});

const knownFaction = makeEntity({
  entity_id: 'imperial_household',
  name: 'Imperial Household',
  entity_type: 'faction',
  current_state_narrative: 'KNOWN_FACTION_LIVE_STATE_SENTINEL',
});

const hiddenFaction = makeEntity({
  entity_id: 'hidden_faction',
  name: 'UNKNOWN_FACTION_NAME_SENTINEL',
  entity_type: 'faction',
  current_state_narrative: 'UNKNOWN_FACTION_STATE_SENTINEL',
});

const knownHiddenFactionMember = makeEntity({
  entity_id: 'known_hidden_faction_member',
  name: 'Decimus the Visible',
  position: 'Merchant',
  faction_id: hiddenFaction.entity_id,
});

const entities = [
  player,
  knownFaction,
  hiddenFaction,
  knownActor,
  knownHiddenFactionMember,
  observedActor,
  offNetworkActor,
  deadSecretActor,
];

function observation(input: {
  evidenceId: string;
  turn: number;
  text: string;
  source: KnowledgeSource;
  quote?: { speakerId: string; text: string };
}): KnowledgeClaim {
  return {
    id: `claim_${input.evidenceId}`,
    subject: observedActor.entity_id,
    claim: input.text,
    topic: 'relationship-observation',
    claimKey: `relationship-observation:${input.turn}:0`,
    firstLearnedTurn: input.turn,
    updates: [{ turn: input.turn, source: input.source, text: input.text }],
    relationshipObservation: {
      evidenceId: input.evidenceId,
      participantIds: [player.entity_id, observedActor.entity_id],
      ...(input.quote ? { quote: input.quote } : {}),
    },
  };
}

const observations: KnowledgeClaim[] = [
  observation({
    evidenceId: 'spy_2',
    turn: 2,
    source: 'spy',
    text: 'Senator Livia quietly supported Severus before the first vote.',
  }),
  observation({
    evidenceId: 'report_5',
    turn: 5,
    source: 'rumor',
    text: 'Senator Livia said, "I will stand beside Severus."',
    quote: { speakerId: observedActor.entity_id, text: 'I will stand beside Severus.' },
  }),
  observation({
    evidenceId: 'witness_7',
    turn: 7,
    source: 'witnessed',
    text: 'Senator Livia denounced Severus before the Senate.',
  }),
  observation({
    evidenceId: 'network_9',
    turn: 9,
    source: 'network',
    text: 'Senator Livia defended Severus when the guard challenged him.',
  }),
];

function cardFor(container: HTMLElement, name: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('section.gor-card'))
    .find(card => card.querySelector('.gor-card-title')?.textContent === name) ?? null;
}

describe('components/tabs/DramatisPersonaeTab - player-safe Personae', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(knowledge: KnowledgeClaim[]): Promise<void> {
    await act(async () => {
      root.render(
        <DramatisPersonaeTab
          playerEntity={player}
          entities={entities}
          knowledge={knowledge}
          turnNumber={10}
          onSpendDeepAnalysis={() => {}}
          onInvestigationOutcome={() => {}}
          ai={{} as GoogleGenAI}
          isMockMode={true}
        />
      );
    });
  }

  it('filters the poisoned roster before grouping and masks an unknown faction heading', async () => {
    await render(observations);
    const text = container.textContent ?? '';

    expect(text).toContain('Marcus the Known');
    expect(text).toContain('Tribune of the Grain');
    expect(text).toContain('Senator Livia');
    expect(text).toContain('Decimus the Visible');
    expect(text).toContain('Other known figures');
    expect(text).toContain('Imperial Household');

    expect(text).not.toContain('OFF_NETWORK_ALIVE_NAME_SENTINEL');
    expect(text).not.toContain('DEAD_SECRET_ACTOR_NAME_SENTINEL');
    expect(text).not.toContain('SECRET_TRUTH_MOTIVE_SENTINEL');
    expect(text).not.toContain('UNKNOWN_FACTION_NAME_SENTINEL');
    expect(text).not.toContain('UNKNOWN_FACTION_STATE_SENTINEL');
    expect(text).not.toContain('KNOWN_FACTION_LIVE_STATE_SENTINEL');
  });

  it('discovers an off-network actor only after a validated cited observation names them', async () => {
    await render([]);
    expect(container.textContent).not.toContain('Senator Livia');

    await render(observations);
    expect(container.textContent).toContain('Senator Livia');
    expect(container.textContent).toContain('Senator');
  });

  it('shows a known actor with public fields and a no-observations state, never relationship mechanics', async () => {
    await render(observations);
    const card = cardFor(container, knownActor.name);
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';

    expect(text).toContain(knownActor.position);
    expect(text).toContain('No observations yet');
    expect(card?.querySelector('[role="meter"]')).toBeNull();
    expect(text).not.toMatch(/\bTrust\b/);
    expect(text).not.toMatch(/\bRespect\b/);
    expect(text).not.toMatch(/\bThreat\b/);
    expect(text).not.toMatch(/\bAlignment\b/);
    expect(text).not.toMatch(/\bDependency\b/);
    for (const numericSentinel of ['9101', '9202', '9303', '9404', '9505']) {
      expect(text).not.toContain(numericSentinel);
    }
  });

  it('never renders live state, goals, schemes, secret truth, free Raw Thoughts, or player notes while retaining paid intel controls', async () => {
    await render(observations);
    const card = cardFor(container, knownActor.name);
    expect(card).not.toBeNull();
    const intelButton = Array.from(card?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === 'Intel');
    expect(intelButton).toBeDefined();

    await act(async () => {
      intelButton!.click();
    });

    const text = card?.textContent ?? '';
    for (const forbidden of [
      'LIVE_STATE_NARRATIVE_SENTINEL',
      'LIVE_SHORT_TERM_GOAL_SENTINEL',
      'LIVE_LONG_TERM_AMBITION_SENTINEL',
      'ACTIVE_SCHEME_NAME_SENTINEL',
      'ACTIVE_SCHEME_GOAL_SENTINEL',
      'ACTIVE_SCHEME_STEP_SENTINEL',
      'secret_truth',
      'Raw Thoughts',
      'Player notes',
      'Add note',
    ]) {
      expect(text).not.toContain(forbidden);
    }

    // Existing paid/sourced intelligence remains reachable; Task 6 removes
    // only the free AI-authored self-read.
    expect(text).toContain('Beliefs');
    expect(text).toContain('Active Scheme');
    expect(text).toContain('Secrets');
    expect(text).toContain("Spymaster's Assessment");
    expect(Array.from(card?.querySelectorAll('button') ?? []).some(button => /Reveal|Investigate|Commission/.test(button.textContent ?? ''))).toBe(true);
  });

  it('renders the latest three sourced observations compactly with turn or age provenance', async () => {
    await render(observations);
    const card = cardFor(container, observedActor.name);
    expect(card).not.toBeNull();
    const compact = card!.cloneNode(true) as HTMLElement;
    compact.querySelectorAll('details').forEach(details => details.remove());
    const text = compact.textContent ?? '';

    expect(text).toContain('Senator Livia defended Severus when the guard challenged him.');
    expect(text).toContain('Senator Livia denounced Severus before the Senate.');
    expect(text).toContain('I will stand beside Severus.');
    expect(text).not.toContain('quietly supported Severus before the first vote');
    expect(text.toLowerCase()).toContain('network');
    expect(text.toLowerCase()).toContain('witnessed');
    expect(text.toLowerCase()).toContain('rumor');
    expect(text).toMatch(/Turn\s+9|1\s+turn\s+ago/i);
  });

  it('provides a collapsed accessible timeline whose expansion preserves contradictory evidence', async () => {
    await render(observations);
    const card = cardFor(container, observedActor.name);
    const details = card?.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    const summary = details?.querySelector('summary');
    expect(summary?.textContent).toMatch(/timeline/i);

    await act(async () => {
      summary!.click();
    });

    expect(details?.open).toBe(true);
    const timelineText = details?.textContent ?? '';
    expect(timelineText).toContain('quietly supported Severus before the first vote');
    expect(timelineText).toContain('denounced Severus before the Senate');
    expect(timelineText).toContain('defended Severus when the guard challenged him');
    expect(timelineText.toLowerCase()).toContain('spy');
    expect(timelineText).toMatch(/Turn\s+2|8\s+turns\s+ago/i);
  });

  it('renders a trusted exact quote as quoted evidence without synthesizing a verdict', async () => {
    await render(observations);
    const card = cardFor(container, observedActor.name);
    const text = card?.textContent ?? '';

    expect(text).toMatch(/[\u201c"]I will stand beside Severus\.[\u201d"]/);
    expect(text).not.toMatch(/loyal|hostile|trustworthy|untrustworthy|relationship tier/i);
  });
});
