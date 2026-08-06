/**
 * @vitest-environment jsdom
 *
 * B2 — the three intelligence surfaces (spec:
 * docs/superpowers/specs/2026-08-06-b2-intelligence-surfaces-design.md).
 *
 * The substrate (knowledge store D21/D29, credibility framing D25/D26,
 * deriveDossier D14/D27, relationship observations D13/D42) has been built
 * for two phases; these tests pin the VIEWS that were the stated payoff:
 *
 *  - the RUMOR FEED, a third register on the Reports tab: claim timelines,
 *    chronological, source-tagged, never a credibility figure;
 *  - the RELATIONSHIP MAP filling the 0-byte RelationshipsTab, mounted as a
 *    second register on Personae: pair-grouped observation edges with
 *    provenance and age, wrong exactly when a source lied (D13);
 *  - the durable DOSSIER reading inside each Personae card: deriveDossier's
 *    frozen snapshot + stamps + source, surviving where the session-local
 *    reveal did not.
 *
 * House style: React 19 act() + react-dom, no testing-library.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import ReportsTab from '../components/tabs/ReportsTab';
import RelationshipsTab from '../components/tabs/RelationshipsTab';
import DramatisPersonaeTab from '../components/tabs/DramatisPersonaeTab';
import type { KnowledgeClaim } from '../knowledge/store';
import { ingestRelationshipObservations } from '../knowledge/relationships';
import type { Entity, Report } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim().startsWith(name));
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  localStorage.clear();
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

const aulus = makeEntity({ entity_id: 'aulus', name: 'Aulus Fulvius', position: 'Praetor' });
const livia = makeEntity({ entity_id: 'livia', name: 'Senator Livia', position: 'Senator' });
const player = makeEntity({
  entity_id: 'player',
  name: 'Severus Alexander',
  visibility_network: ['aulus', 'livia'],
  resources: { investigations: 2, deep_analyses: 1 },
});

/** A report-channel claim with a source-tagged, credibility-bearing timeline. */
function reportClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: 'claim_r1',
    subject: 'aulus',
    claim: 'Aulus courts the grain merchants.',
    topic: 'grain',
    claimKey: 'report:aulus:grain:merchant',
    firstLearnedTurn: 2,
    updates: [
      { turn: 2, source: 'merchant', text: 'Aulus courts the grain merchants.', credibility: 0.8 },
      { turn: 4, source: 'rumor', text: 'The courtship has soured, they now say.', credibility: 0.3 },
    ],
    ...overrides,
  };
}

/** A digest-channel claim — witnessed, binary-fidelity (no credibility, D5 v1). */
function digestClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: 'claim_d1',
    subject: 'livia',
    claim: 'Livia spoke against the donative in the Curia.',
    topic: 'senate',
    claimKey: 'digest:livia:senate',
    firstLearnedTurn: 5,
    updates: [{ turn: 5, source: 'witnessed', text: 'Livia spoke against the donative in the Curia.' }],
    ...overrides,
  };
}

/** An investigation claim — dossier material, NOT feed material (D14). */
function beliefsClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: 'claim_i1',
    subject: 'aulus',
    claim: 'Aulus believes the Senate is beyond saving.',
    topic: 'beliefs',
    claimKey: 'investigation:aulus:beliefs',
    firstLearnedTurn: 3,
    updates: [{ turn: 3, source: 'spy', text: 'Aulus believes the Senate is beyond saving.' }],
    ...overrides,
  };
}

/** A relationship-observation claim — one edge of the D13 map. */
function observationClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: 'claim_o1',
    subject: 'aulus',
    claim: 'Aulus deferred to Livia before the assembled Senate.',
    topic: 'relationship',
    claimKey: 'report:aulus:relationship:obs1',
    firstLearnedTurn: 4,
    updates: [{ turn: 4, source: 'witnessed', text: 'Aulus deferred to Livia before the assembled Senate.' }],
    relationshipObservation: { evidenceId: 'ev1', participantIds: ['aulus', 'livia'] },
    ...overrides,
  };
}

/**
 * A PRODUCTION-shaped observation claim, built through the real ingest path
 * (adversarial fix 2): claimKey grammar `relationship-observation:{turn}:{n}`
 * and the exact marker shape ingestRelationshipObservations emits — not the
 * hand-rolled report-channel shape the other fixtures use, which production
 * never writes.
 */
function productionObservationClaim(): KnowledgeClaim {
  const text = 'Aulus Fulvius and Senator Livia met at the docks after dark.';
  const store = ingestRelationshipObservations([], {
    evidence: [{ id: 'ev-prod', source: 'rumor', text }],
    drafts: [{ evidenceId: 'ev-prod', participantIds: ['aulus', 'livia'], excerpt: text }],
    entities: [aulus, livia],
    knownEntityIds: ['aulus', 'livia'],
    turn: 6,
  });
  expect(store).toHaveLength(1);
  expect(store[0].claimKey).toBe('relationship-observation:6:0');
  return store[0];
}

const noopMutation: RunDomainMutation = async work => ({
  acquired: true,
  value: await work({ isCurrent: () => true }),
});

const personaeWiring = {
  knowledge: [] as KnowledgeClaim[],
  turnNumber: 6,
  onSpendDeepAnalysis: () => {},
  onInvestigationOutcome: () => {},
  runDomainMutation: noopMutation,
  ai: {} as GoogleGenAI,
  isMockMode: true,
};

describe('the rumor feed — a third register on Reports (D21)', () => {
  const someReport: Report = { id: 'r1', about: 'aulus', claim: 'A report.', source: 'scout', credibility: 0.9, turn: 3 } as Report;

  it('offers the Rumors register and lists claim timelines, newest word first', async () => {
    const container = await mount(
      <ReportsTab reports={[someReport]} knowledge={[reportClaim(), digestClaim()]} />,
    );
    await click(buttonNamed(container, 'Rumors'));

    const cards = container.querySelectorAll('.gor-rumor-claim');
    expect(cards.length).toBe(2);
    // The digest claim's latest word is Week V, the report claim's Week IV —
    // newest latest-update first.
    expect(cards[0].textContent).toContain('Livia spoke against the donative');
    expect(cards[1].textContent).toContain('Aulus courts the grain merchants.');
  });

  it('shows a claim evolving: every update row, in turn order, source-tagged', async () => {
    const container = await mount(
      <ReportsTab reports={[]} knowledge={[reportClaim()]} />,
    );
    await click(buttonNamed(container, 'Rumors'));

    const rows = container.querySelectorAll('.gor-rumor-update');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('A merchant');
    expect(rows[0].textContent).toContain('II');
    expect(rows[1].textContent).toContain('The rumor mill');
    expect(rows[1].textContent).toContain('IV');
    expect(rows[1].textContent).toContain('The courtship has soured');
  });

  it('never shows a credibility figure — the number is consumed, not rendered (D25)', async () => {
    const container = await mount(
      <ReportsTab reports={[]} knowledge={[reportClaim(), digestClaim()]} />,
    );
    await click(buttonNamed(container, 'Rumors'));
    expect(container.textContent).not.toMatch(/0\.\d|\d{1,3}\s?%/);
  });

  it('keeps investigation and scheme claims out of the feed — those are the dossier (D14)', async () => {
    const container = await mount(
      <ReportsTab reports={[]} knowledge={[digestClaim(), beliefsClaim()]} />,
    );
    await click(buttonNamed(container, 'Rumors'));
    // The digest word renders; the paid dossier material does not.
    expect(container.textContent).toContain('Livia spoke against the donative');
    expect(container.textContent).not.toContain('beyond saving');
  });

  it('keeps observation-marked claims out of the feed in BOTH shapes — their home is the map', async () => {
    // Two exclusion mechanisms, each pinned by the shape that needs it: the
    // production claimKey grammar (`relationship-observation:{turn}:{n}`)
    // falls to the channel-prefix check, and the synthetic report-channel
    // marker claim — which production never writes, but a hand-edited save
    // could — falls only to the explicit `!relationshipObservation` clause.
    // Deleting either mechanism turns exactly one of these red.
    const production = productionObservationClaim();
    const container = await mount(
      <ReportsTab reports={[]} knowledge={[digestClaim(), production, observationClaim()]} />,
    );
    await click(buttonNamed(container, 'Rumors'));

    expect(container.textContent).toContain('Livia spoke against the donative');
    expect(container.textContent).not.toContain('met at the docks after dark');
    expect(container.textContent).not.toContain('deferred to Livia before the assembled Senate');

    // …and the same production-shaped claim IS the map's material.
    const map = await mount(
      <RelationshipsTab knowledge={[production]} entities={[aulus, livia]} currentTurn={7} />,
    );
    expect(map.querySelectorAll('.gor-relationship-pair')).toHaveLength(1);
    expect(map.textContent).toContain('met at the docks after dark');
  });

  it('names the cause when no word has arrived (D45)', async () => {
    const container = await mount(<ReportsTab reports={[someReport]} knowledge={[]} />);
    await click(buttonNamed(container, 'Rumors'));
    expect(container.textContent).toContain('No word has reached you yet.');
  });
});

describe('the relationship map — RelationshipsTab filled (D13)', () => {
  it('groups observation edges by pair, with provenance and age on every edge', async () => {
    const second = observationClaim({
      id: 'claim_o2',
      claimKey: 'report:aulus:relationship:obs2',
      firstLearnedTurn: 6,
      claim: 'A courier watched them dine privately.',
      updates: [{ turn: 6, source: 'messenger', text: 'A courier watched them dine privately.' }],
    });
    const container = await mount(
      <RelationshipsTab knowledge={[observationClaim(), second]} entities={[aulus, livia, player]} currentTurn={7} />,
    );

    const pairs = container.querySelectorAll('.gor-relationship-pair');
    expect(pairs.length).toBe(1);
    expect(pairs[0].textContent).toContain('Aulus Fulvius');
    expect(pairs[0].textContent).toContain('Senator Livia');

    const edges = pairs[0].querySelectorAll('.gor-relationship-edge');
    expect(edges.length).toBe(2);
    // Newest edge first; each carries its week and its source's own voice.
    expect(edges[0].textContent).toContain('VI');
    expect(edges[0].textContent).toContain('A courier');
    expect(edges[1].textContent).toContain('IV');
    expect(edges[1].textContent).toContain('Your own eyes');
  });

  it('renders a hearsay edge in the voice of its source — the lie keeps its provenance (D13/D11)', async () => {
    const hearsay = observationClaim({
      id: 'claim_o3',
      claimKey: 'report:aulus:relationship:obs3',
      updates: [{ turn: 5, source: 'rumor', text: 'They say Aulus and Livia quarrelled at the baths.', credibility: 0.2 }],
      claim: 'They say Aulus and Livia quarrelled at the baths.',
    });
    const container = await mount(
      <RelationshipsTab knowledge={[hearsay]} entities={[aulus, livia, player]} currentTurn={7} />,
    );
    expect(container.textContent).toContain('The rumor mill');
    expect(container.textContent).not.toMatch(/0\.\d/);
  });

  it('renders the trusted quote when the marker carries one', async () => {
    const withQuote = observationClaim({
      relationshipObservation: {
        evidenceId: 'ev1',
        participantIds: ['aulus', 'livia'],
        quote: { speakerId: 'aulus', text: 'The Senate hears you before it hears me.' },
      },
    });
    const container = await mount(
      <RelationshipsTab knowledge={[withQuote]} entities={[aulus, livia, player]} currentTurn={7} />,
    );
    expect(container.querySelector('q')?.textContent).toContain('The Senate hears you before it hears me.');
  });

  it('names the cause when nothing has been observed (D45)', async () => {
    const container = await mount(<RelationshipsTab knowledge={[]} entities={[aulus, livia]} currentTurn={3} />);
    expect(container.textContent).toContain('You have seen no one together, and no one has told you of any bond.');
  });

  it('never renders a meter, valuenow, or progress element — no scores here (D25/B8)', async () => {
    const container = await mount(
      <RelationshipsTab knowledge={[observationClaim()]} entities={[aulus, livia]} currentTurn={7} />,
    );
    expect(container.querySelectorAll('[role="meter"], [aria-valuenow], progress')).toHaveLength(0);
  });

  it('leaks nothing from sentinel-loaded ground truth — not as text, not in any attribute (D13/D11)', async () => {
    // The adversarial merge review proved the decimal-regex and meter-role
    // guards alone cannot catch an INTEGER ground-truth score rendered as
    // plain text. These entities carry unmistakable sentinels in exactly the
    // fields the map must never read; if any reaches the DOM, the map has
    // started rendering truth instead of testimony.
    const loadedAulus: Entity = {
      ...aulus,
      relationships: {
        livia: {
          entity_id: 'livia',
          relationship_type: 'GROUND_TRUTH_TYPE_LEAK',
          trust_level: 94417,
          respect_level: 94418,
          perceived_threat: 94419,
          ideological_alignment: 94420,
          dependency_level: 94421,
          recent_interactions: ['GROUND_TRUTH_INTERACTION_LEAK'],
        },
      },
      secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'LEAK_SECRET_MOTIVE' },
    } as Entity;
    const container = await mount(
      <RelationshipsTab knowledge={[observationClaim(), productionObservationClaim()]} entities={[loadedAulus, livia, player]} currentTurn={7} />,
    );

    const rendered = container.textContent ?? '';
    for (const sentinel of ['94417', '94418', '94419', '94420', '94421', 'GROUND_TRUTH', 'LEAK_SECRET_MOTIVE']) {
      expect(rendered).not.toContain(sentinel);
    }
    // Attributes too — a leak through a title/aria-label is still a leak.
    expect(container.innerHTML).not.toContain('94417');
    expect(container.innerHTML).not.toContain('LEAK_SECRET_MOTIVE');
  });
});

describe('the Personae register rail — Figures and Relationships', () => {
  it('defaults to Figures (the existing cards) and swaps to the map on demand', async () => {
    const container = await mount(
      <DramatisPersonaeTab
        playerEntity={player}
        entities={[player, aulus, livia]}
        {...personaeWiring}
        knowledge={[observationClaim()]}
      />,
    );
    // The resting register is today's content, so nothing regresses.
    expect(container.textContent).toContain('What is known — and what can be bought.');

    await click(buttonNamed(container, 'Relationships'));
    expect(container.querySelectorAll('.gor-relationship-pair').length).toBe(1);
    // The choice persists through the tabRegister allowlist mechanism.
    expect(localStorage.getItem('gloryOfRome:tabRegister:personae')).toBe('relationships');
  });
});

describe('the durable dossier reading (D14/D27)', () => {
  it('renders a held aspect from deriveDossier — text, stamps, and source — with no purchase this session', async () => {
    const container = await mount(
      <DramatisPersonaeTab
        playerEntity={player}
        entities={[player, aulus]}
        {...personaeWiring}
        knowledge={[beliefsClaim()]}
        turnNumber={5}
      />,
    );
    await click(buttonNamed(container, 'Intel'));

    expect(container.textContent).toContain('Aulus believes the Senate is beyond saving.');
    expect(container.textContent).toContain('First learned Week III');
    expect(container.textContent).toContain('as of Week III');
    expect(container.textContent).toContain('Your agent');
  });

  it('says when the file has aged — past the D27 cold threshold, in words, never a number', async () => {
    const container = await mount(
      <DramatisPersonaeTab
        playerEntity={player}
        entities={[player, aulus]}
        {...personaeWiring}
        knowledge={[beliefsClaim()]}
        turnNumber={10}
      />,
    );
    await click(buttonNamed(container, 'Intel'));
    expect(container.textContent).toContain('The file has aged; Rome has not stood still.');
  });
});
