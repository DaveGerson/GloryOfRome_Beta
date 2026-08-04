/**
 * @vitest-environment jsdom
 *
 * Task 6 player-safety contract for the real Personae component. The entity
 * graph is intentionally poisoned with hidden names, engine relationships,
 * live goals/state, an active scheme, and secret survivor truth. Only the
 * public identity fields and validated knowledge claims may reach the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import type { KnowledgeClaim, KnowledgeSource } from '../knowledge/store';
import type { Entity } from '../types';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runDomainMutation: RunDomainMutation = async work => ({
  acquired: true,
  value: await work({ isCurrent: () => true }),
});

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

const forbiddenRelationshipVisualClasses = [
  'gor-meter-row',
  'gor-meter-val',
  'gor-trust',
  'gor-trust-fill',
  'gor-trust-zero',
];

function cardFor(container: HTMLElement, name: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('section.gor-card'))
    .find(card => card.querySelector('.gor-card-title')?.textContent === name) ?? null;
}

describe('components/tabs/DramatisPersonaeTab - player-safe Personae', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rootMounted: boolean;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    rootMounted = true;
  });

  afterEach(async () => {
    if (rootMounted) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
  });

  async function render(
    knowledge: KnowledgeClaim[],
    onInvestigationOutcome: (
      kind: 'beliefs' | 'scheme' | 'secrets',
      targetId: string,
      reportData: unknown,
      cost: number,
      result: import('../types').InvestigationResult,
      request: DomainMutationContext,
    ) => boolean | void | Promise<boolean | void> = () => {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <DramatisPersonaeTab
          playerEntity={player}
          entities={entities}
          knowledge={knowledge}
          turnNumber={10}
          onSpendDeepAnalysis={() => {}}
          onInvestigationOutcome={onInvestigationOutcome}
          runDomainMutation={runDomainMutation}
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
    // WP-20: the zero state names the cause, not the absence — and names
    // the person, so it never has to guess a pronoun.
    expect(text).toContain(`You have never been in a room with ${knownActor.name}.`);
    // This fixture carries extreme hidden scores. The old TrustBar expressed
    // them through a meter, signed number, and laurel/crimson heat color;
    // none of those interpretations may return under a different label.
    expect(card?.querySelectorAll('[role="meter"], [aria-valuenow], progress')).toHaveLength(0);
    for (const className of forbiddenRelationshipVisualClasses) {
      expect(card?.querySelector(`.${className}`)).toBeNull();
    }
    const relationshipHeatOrTier = Array.from(card?.querySelectorAll<HTMLElement>('[class], [data-relationship-heat], [data-relationship-color], [aria-label]') ?? [])
      .filter(element => /(?:heat|tier|relationship|sentiment|affinity)/i.test([
        element.className,
        element.dataset.relationshipHeat,
        element.dataset.relationshipColor,
        element.getAttribute('aria-label'),
      ].filter(Boolean).join(' ')));
    expect(relationshipHeatOrTier).toHaveLength(0);
    const inlineRelationshipHeatColors = Array.from(card?.querySelectorAll<HTMLElement>('[style]') ?? [])
      .filter(element => /var\(--(?:laurel|crimson|ink)-500\)/.test(element.getAttribute('style') ?? ''));
    expect(inlineRelationshipHeatColors).toHaveLength(0);
    expect(text).not.toMatch(/\bTrust\b/);
    expect(text).not.toMatch(/\bRespect\b/);
    expect(text).not.toMatch(/\bThreat\b/);
    expect(text).not.toMatch(/\bAlignment\b/);
    expect(text).not.toMatch(/\bDependency\b/);
    for (const numericSentinel of ['9101', '9202', '9303', '9404', '9505']) {
      expect(text).not.toContain(numericSentinel);
    }
    expect(text).not.toContain('ENGINE_RELATIONSHIP_TYPE_SENTINEL');
    expect(text).not.toContain('ENGINE_RECENT_INTERACTION_SENTINEL');
    expect(text).not.toMatch(/[←→↔↕]/);
    expect(text).not.toMatch(/\b(?:Trusted Ally|Wary Acquaintance|Hostile Rival|Friendly|Hostile|Relationship Tier)\b/i);
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

  it('provides a collapsed accessible timeline whose expansion preserves every distinct observation', async () => {
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
    const timelineRows = Array.from(details?.querySelectorAll<HTMLLIElement>('ul > li') ?? []);
    expect(timelineRows).toHaveLength(observations.length);
    expect(timelineRows.map(row => row.querySelector('span')?.textContent)).toEqual([
      'Senator Livia quietly supported Severus before the first vote.',
      'Senator Livia said, "I will stand beside Severus."',
      'Senator Livia denounced Severus before the Senate.',
      'Senator Livia defended Severus when the guard challenged him.',
    ]);
    expect(timelineRows.map(row => row.querySelector('small')?.textContent)).toEqual([
      'spy · Turn 2 · 8 turns ago',
      'rumor · Turn 5 · 5 turns ago',
      'witnessed · Turn 7 · 3 turns ago',
      'network · Turn 9 · 1 turn ago',
    ]);
  });

  it('renders a trusted exact quote as quoted evidence without synthesizing a verdict', async () => {
    await render(observations);
    const card = cardFor(container, observedActor.name);
    const text = card?.textContent ?? '';
    const trustedObservation = observations[1];
    const trustedQuote = trustedObservation.relationshipObservation?.quote;
    const quoteElements = Array.from(card?.querySelectorAll('q') ?? []);

    // The claim itself also contains the quote's words. Querying the semantic
    // q element proves the quote is marked up, rather than accidentally
    // passing because ordinary claim text happened to include the phrase.
    expect(trustedQuote).toBeDefined();
    expect(trustedObservation.claim).not.toBe(trustedQuote?.text);
    expect(quoteElements).toHaveLength(2); // compact list plus expanded timeline
    expect(quoteElements.map(quote => quote.textContent)).toEqual([
      trustedQuote?.text,
      trustedQuote?.text,
    ]);
    expect(text).not.toMatch(/loyal|hostile|trustworthy|untrustworthy|relationship tier/i);
  });

  it('renders adversarial multi-speaker evidence as the exact sourced excerpt without attribution', async () => {
    const excerpt = 'Senator Livia said, "I support Severus," while Marcus replied, "I do not."';
    const ambiguous = observation({
      evidenceId: 'multi_speaker_10',
      turn: 10,
      source: 'witnessed',
      text: excerpt,
    });

    await render([ambiguous]);
    const card = cardFor(container, observedActor.name);
    expect(card?.textContent).toContain(excerpt);
    expect(card?.querySelector('q')).toBeNull();
    expect(card?.textContent).not.toMatch(/speaker|attributed to/i);
  });

  it('keeps async investigation display pending and invalidates the callback lease on unmount', async () => {
    let release!: (committed: boolean) => void;
    const commitGate = new Promise<boolean>(resolve => { release = resolve; });
    let capturedRequest: DomainMutationContext | undefined;
    const onInvestigationOutcome = vi.fn((
      _kind: 'beliefs' | 'scheme' | 'secrets',
      _targetId: string,
      _reportData: unknown,
      _cost: number,
      _result: import('../types').InvestigationResult,
      request: DomainMutationContext,
    ) => {
      capturedRequest = request;
      return commitGate;
    });
    await render(observations, onInvestigationOutcome);
    const card = cardFor(container, knownActor.name)!;
    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
    const reveal = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(button =>
      button.textContent?.startsWith('Reveal') && button.parentElement?.parentElement?.textContent?.includes('Secrets'))!;
    await act(async () => {
      reveal.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(onInvestigationOutcome).toHaveBeenCalledTimes(1);
    expect(card.textContent).not.toContain('(Mock) Is secretly illiterate.');
    expect(capturedRequest?.isCurrent()).toBe(true);

    await act(async () => root.unmount());
    rootMounted = false;
    expect(capturedRequest?.isCurrent()).toBe(false);
    release(true);
    await act(async () => Promise.resolve());
    expect(container.textContent).toBe('');
  });
});
