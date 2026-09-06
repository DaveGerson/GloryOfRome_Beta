/**
 * @vitest-environment jsdom
 *
 * GM console split, group 1 — per-turn state & perception views. STRICT
 * characterization of the components currently living inside
 * components/GameMasterScreen.tsx, imported from their FUTURE module paths
 * under components/gm/. This file is written RED-first: it must fail on the
 * unresolved `../components/gm/...` imports until the split lands, then pass
 * with no edits.
 *
 * Every expectation below is derived from the current monolith source (the
 * exact strings, separators, quote glyphs, and empty states it renders
 * today) — not from what the views "should" do.
 *
 * Same house style as tests/gmNarrationPane.test.tsx / gmScreenSmoke.test.ts:
 * React 19 act() + react-dom/client only, no testing-library. Fixture
 * vocabulary from tests/factories.ts.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

// FUTURE paths — these modules do not exist yet; that is the point.
import { PlayerIntentView } from '../components/gm/PlayerIntentView';
import { SummaryView } from '../components/gm/SummaryView';
import { ActionsView } from '../components/gm/ActionsView';
import { WhatChangedView } from '../components/gm/WhatChangedView';
import { EntityStatesView } from '../components/gm/EntityStatesView';
import { SchemeLine } from '../components/gm/SchemeLine';
import { LatencyStrip } from '../components/gm/LatencyStrip';
import { PrivateView } from '../components/gm/PrivateView';
import { GroundTruthView } from '../components/gm/GroundTruthView';
import { NpcPerceptionView } from '../components/gm/NpcPerceptionView';

import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { Entity, Relationship, Scheme, TurnSubmission } from '../types';
import {
  makeAdjudication,
  makeEntity,
  makeMortalityEvent,
  makeNpcIntent,
  makePersonality,
  makeRawCall,
  makeRelationship,
  makeTurnHistoryEntry,
  makeWorldState,
} from './factories';

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

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

/** Occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// PlayerIntentView
// ---------------------------------------------------------------------------
describe('PlayerIntentView', () => {
  it('renders plain non-empty text as a GM-audience freeform submission (trimmed, no curly quotes)', async () => {
    const container = await mount(
      <PlayerIntentView entry={makeTurnHistoryEntry({ playerIntent: '  Hold court in the Curia  ' })} />);
    const history = container.querySelector('[data-submission-history="gm"]');
    expect(history).not.toBeNull();
    // normalizeFreeform trims before rendering — the padded original never shows.
    expect(history!.textContent).toBe('Hold court in the Curia');
    expect(container.textContent).not.toContain('“');
  });

  it('falls back to curly-quoting the raw intent only when normalization fails (whitespace-only text)', async () => {
    const container = await mount(
      <PlayerIntentView entry={makeTurnHistoryEntry({ playerIntent: '   ' })} />);
    expect(container.querySelector('[data-submission-history="gm"]')).toBeNull();
    expect(container.textContent).toBe('“   ”');
  });

  it('renders a serialized structured submission through the GM projection: entity ids shown, private intent inline', async () => {
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
        command: 'Meet me at dusk',
      }],
      privateIntent: 'Preserve room to bargain',
      questionOrContext: 'Which benches are empty?',
    };
    const container = await mount(
      <PlayerIntentView entry={makeTurnHistoryEntry({ playerIntent: serializeTurnSubmission(submission) })} />);

    expect(container.querySelector('[data-submission-history="gm"]')).not.toBeNull();
    expect(container.textContent).not.toContain('GOR_TURN_SUBMISSION/1');
    expect(container.textContent).toContain('Actions');
    expect(container.textContent).toContain('Address the Senate');
    expect(container.textContent).toContain('Messages / Orders');
    // GM audience appends the entity id to the display name.
    expect(container.textContent).toContain('Lucius [lucius]: Meet me at dusk');
    expect(container.textContent).toContain('Private Intent');
    expect(container.textContent).toContain('Preserve room to bargain');
    // GM audience renders private intent as an open section, not a <details>.
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('Question / Context');
    expect(container.textContent).toContain('Which benches are empty?');
  });

  it('renders a corrupt reserved artifact as the invalid-artifact note', async () => {
    const container = await mount(
      <PlayerIntentView entry={makeTurnHistoryEntry({ playerIntent: 'GOR_TURN_SUBMISSION/1\n{broken' })} />);
    const note = container.querySelector('[role="note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe('Invalid turn submission artifact.');
  });
});

// ---------------------------------------------------------------------------
// SummaryView
// ---------------------------------------------------------------------------
describe('SummaryView', () => {
  it('renders the Player Intent well (via PlayerIntentView) and the narration', async () => {
    const container = await mount(
      <SummaryView entry={makeTurnHistoryEntry({ playerIntent: 'Hold court', narration: 'A tense week in the Curia.' })} />);
    expect(container.textContent).toContain('Player Intent');
    expect(container.querySelector('[data-submission-history="gm"]')!.textContent).toBe('Hold court');
    expect(container.textContent).toContain('Generated Narration');
    expect(container.textContent).toContain('A tense week in the Curia.');
  });

  it('names the empty narration state', async () => {
    const container = await mount(
      <SummaryView entry={makeTurnHistoryEntry({ playerIntent: 'Hold court' })} />);
    expect(container.textContent).toContain('No narration generated.');
  });
});

// ---------------------------------------------------------------------------
// ActionsView
// ---------------------------------------------------------------------------
describe('ActionsView', () => {
  it('surfaces only [Director]/[Mind] gm_private notes and renders entity actions with conditional targets', async () => {
    const entry = makeTurnHistoryEntry({
      playerIntent: 'Hold court',
      adjudication: makeAdjudication({
        gm_private: [
          '[Director] the axis holds',
          '[Mind] the docks come first',
          '[Boundary] a sentence was cut',
          'unprefixed adjudicator aside',
        ],
        entityActions: [
          { id: 'npc_full', intent: 'intrigue', target: 'player_1', notes: 'Moves quietly.' },
          { id: 'npc_plain', intent: 'fortify', notes: 'Digs in.' },
        ],
      }),
    });
    const container = await mount(<ActionsView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Director & Mind Notes');
    expect(text).toContain('“[Director] the axis holds”');
    expect(text).toContain('“[Mind] the docks come first”');
    expect(text).not.toContain('[Boundary] a sentence was cut');
    expect(text).not.toContain('unprefixed adjudicator aside');

    expect(text).toContain('npc_full');
    expect(text).toContain('Intent: intrigue · Target: player_1');
    expect(text).toContain('“Moves quietly.”');
    expect(text).toContain('Intent: fortify');
    expect(text).toContain('“Digs in.”');
    // The target clause is conditional — only the action that has one renders it.
    expect(count(text, 'Target:')).toBe(1);
  });

  it('renders the empty-actions note and omits every optional block when nothing was recorded', async () => {
    const container = await mount(
      <ActionsView entry={makeTurnHistoryEntry({ playerIntent: 'Hold court' })} />);
    const text = container.textContent ?? '';
    expect(text).toContain('No specific entity actions were recorded.');
    expect(text).not.toContain('Director Intents (durable, this turn)');
    expect(text).not.toContain('Mind Decisions');
    expect(text).not.toContain('Director & Mind Notes');
  });

  it('renders Director intents and mind decisions, with the scheme_adjustment line only where one exists', async () => {
    const entry = makeTurnHistoryEntry({
      playerIntent: 'Hold court',
      npcIntents: [makeNpcIntent({ entity_id: 'npc_full', intent: 'Corner the grain supply', continuity: 'continue' })],
      npcMindResults: [
        {
          entity_id: 'npc_full',
          chosen_action: 'Buy the docks',
          method: 'Through a proxy',
          private_reasoning: 'Mine alone.',
          scheme_adjustment: 'The docks come first now.',
        },
        { entity_id: 'npc_plain', chosen_action: 'Wait', method: 'Silence', private_reasoning: 'Patience.' },
      ],
    });
    const container = await mount(<ActionsView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Director Intents (durable, this turn)');
    expect(text).toContain('npc_full');
    expect(text).toContain('continue');
    expect(text).toContain('“Corner the grain supply”');

    expect(text).toContain("Mind Decisions (each character's own move, this turn)");
    expect(text).toContain('Chose: Buy the docks');
    expect(text).toContain('Method: Through a proxy');
    expect(text).toContain('Private reasoning: “Mine alone.”');
    expect(text).toContain('Scheme shift (applied as their own scheme): The docks come first now.');
    expect(count(text, 'Scheme shift')).toBe(1);
    expect(text).toContain('Chose: Wait');
  });
});

// ---------------------------------------------------------------------------
// WhatChangedView
// ---------------------------------------------------------------------------
describe('WhatChangedView', () => {
  it('renders the ledger rows: signed delta formatting, the status arrow line, and the quoted reason', async () => {
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [
          { type: 'resource', key: 'npc_full:denarii', delta: 5, reason: 'A purse arrives.' },
          { type: 'relation', key: 'npc_full:npc:trust_level', delta: -2, reason: 'A slight.' },
          { type: 'status', key: 'npc_full:status', delta: 0, reason: 'Exiled by decree.', new_status: 'exiled', new_location: 'Ravenna' },
        ],
      }),
      // No postTurnEntities: the right column names the trimmed snapshot.
    });
    const container = await mount(<WhatChangedView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain('The ledger');
    expect(text).toContain('+5');
    expect(text).toContain('-2');
    expect(text).toContain('npc_full:denarii');
    expect(text).toContain('→ exiled · Ravenna');
    expect(text).toContain('“A slight.”');

    expect(text).toContain('Who moved');
    expect(text).toContain('Entity snapshot trimmed for this older turn - only the most recent turns retain one.');
    expect(text).not.toContain('Full roster after this turn');
  });

  it("renders the steward's ledger under the deltas: kind, signed amount, key with its itemisation, and the quoted line (D46)", async () => {
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [{ type: 'resource', key: 'npc_full:denarii', delta: 5, reason: 'A purse arrives.' }],
      }),
      ledger: [
        { kind: 'upkeep', key: 'denarii', amount: -1845, text: "Your treasury pays out 1,845 denarii - the week's wages for 150 guards and 3 agents.", detail: 'guards 150 x 12, agents 3 x 15' },
        { kind: 'regen', key: 'investigations', amount: 1, text: 'Your agents open a fresh line of inquiry; you may pursue one more investigation.' },
      ],
    });
    const container = await mount(<WhatChangedView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain("The steward's ledger");
    expect(text).toContain('upkeep');
    expect(text).toContain('-1845');
    expect(text).toContain('denarii · guards 150 x 12, agents 3 x 15');
    expect(text).toContain("“Your treasury pays out 1,845 denarii - the week's wages for 150 guards and 3 agents.”");
    expect(text).toContain('regen');
    expect(text).toContain('+1');
    expect(text).not.toContain('No weekly ledger lines were booked for this turn.');
  });

  it('names the absence of ledger lines on a legacy or quiet turn rather than hiding the section', async () => {
    const container = await mount(<WhatChangedView entry={makeTurnHistoryEntry()} />);
    const text = container.textContent ?? '';

    expect(text).toContain("The steward's ledger");
    expect(text).toContain('No weekly ledger lines were booked for this turn.');
  });

  it('resolves moved entities by colon segments, not substrings', async () => {
    // 'npc' is a proper substring of the segment 'npc_full' — segment
    // matching must move only npc_full.
    const fullRoman = makeEntity({ entity_id: 'npc_full', name: 'Full Roman' });
    const trapRoman = makeEntity({ entity_id: 'npc', name: 'Trap Roman' });
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [{ type: 'resource', key: 'npc_full:denarii', delta: 5, reason: 'A purse arrives.' }],
      }),
      postTurnEntities: [fullRoman, trapRoman],
    });
    const container = await mount(<WhatChangedView entry={entry} />);
    const text = container.textContent ?? '';

    // Moved card + full-roster card vs. full-roster card only.
    expect(count(text, 'Full Roman')).toBe(2);
    expect(count(text, 'Trap Roman')).toBe(1);
    expect(text).toContain('Full roster after this turn');
  });

  it('counts entityActions ids as movers and names the no-movement state when deltas touch nobody', async () => {
    const fullRoman = makeEntity({ entity_id: 'npc_full', name: 'Full Roman' });
    const trapRoman = makeEntity({ entity_id: 'npc', name: 'Trap Roman' });
    const moved = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        entityActions: [{ id: 'npc', intent: 'intrigue', notes: 'Moves quietly.' }],
      }),
      postTurnEntities: [fullRoman, trapRoman],
    });
    const movedContainer = await mount(<WhatChangedView entry={moved} />);
    const movedText = movedContainer.textContent ?? '';
    expect(movedText).toContain('No state deltas were recorded.');
    expect(count(movedText, 'Trap Roman')).toBe(2);
    expect(count(movedText, 'Full Roman')).toBe(1);

    const idle = makeTurnHistoryEntry({ postTurnEntities: [fullRoman] });
    const idleContainer = await mount(<WhatChangedView entry={idle} />);
    expect(idleContainer.textContent).toContain("No entity was touched by this turn's deltas.");
    // The full roster stays one click away even when nobody moved.
    expect(idleContainer.textContent).toContain('Full roster after this turn');
  });

  it('renders the four relationship axes with resolved target names on a moved entity', async () => {
    const target = makeEntity({ entity_id: 'npc', name: 'Trap Roman' });
    const mover = makeEntity({
      entity_id: 'npc_full',
      name: 'Full Roman',
      relationships: {
        npc: makeRelationship({ entity_id: 'npc', trust_level: 7, perceived_threat: 3, respect_level: -4, dependency_level: 2 }),
      },
    });
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [{ type: 'resource', key: 'npc_full:denarii', delta: 1, reason: 'Coins move.' }],
      }),
      postTurnEntities: [mover, target],
    });
    const container = await mount(<WhatChangedView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Trust');
    expect(text).toContain('Threat');
    expect(text).toContain('Respect');
    expect(text).toContain('Depend.');
    expect(text).toContain('7');
    expect(text).toContain('3');
    expect(text).toContain('-4');
    // The moved card shows the entity's status · location line.
    expect(text).toContain('Full Roman — alive · Rome');
  });
});

// ---------------------------------------------------------------------------
// EntityStatesView
// ---------------------------------------------------------------------------
describe('EntityStatesView', () => {
  const scheme: Scheme = {
    name: 'The Quiet Purchase',
    overall_goal: 'Own the docks by winter',
    steps: [
      { objective: 'Buy the warehouses', status: 'completed' },
      { objective: 'Bribe the harbormaster', status: 'in_progress' },
    ],
  };
  const rich = makeEntity({
    entity_id: 'npc_full',
    name: 'Full Roman',
    position: 'Praetorian Prefect',
    location: 'Palatine Hill',
    resources: { denarii: 12, grain_stores: ['north', 'south'] },
    personality: makePersonality({ ambition: 8 }),
    skills: { oratory: 4, command: 2 },
    active_scheme: scheme,
    beliefs: ['The east is weak'],
    secrets: ['Owes the Aventine guild'],
    memories: [
      { turn: 1, event_description: 'First blood.', emotional_impact: 'x', involved_entities: [] },
      { turn: 2, event_description: 'Second omen.', emotional_impact: 'x', involved_entities: [] },
      { turn: 3, event_description: 'Third bribe.', emotional_impact: 'x', involved_entities: [] },
      { turn: 4, event_description: 'Fourth oath.', emotional_impact: 'x', involved_entities: [] },
    ],
    relationships: {
      npc_plain: makeRelationship({ entity_id: 'npc_plain', trust_level: 7, perceived_threat: 3, ideological_alignment: -2, dependency_level: 4 }),
      stranger_id: makeRelationship({ entity_id: 'stranger_id' }),
      void_id: undefined as unknown as Relationship,
    },
  });
  const plain = makeEntity({ entity_id: 'npc_plain', name: 'Plain Roman' });

  it('renders headline, status, resources (underscores spaced, arrays counted), personality, skills, beliefs and secrets', async () => {
    const container = await mount(<EntityStatesView entities={[rich, plain]} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Full Roman — Praetorian Prefect');
    // No position falls back to the entity type.
    expect(text).toContain('Plain Roman — individual');
    expect(text).toContain('Status: alive · Palatine Hill');
    expect(text).toContain('Resources: denarii: 12 · grain stores: 2 item(s)');
    // Empty resources render the em-dash placeholder.
    expect(text).toContain('Resources: —');
    expect(text).toContain('Personality: ambition 8 · paranoia 5 · loyalty 5 · cunning 5 · honor 5');
    expect(text).toContain('Skills: oratory 4 · command 2');
    expect(text).toContain('Beliefs: The east is weak');
    expect(text).toContain('Secrets: Owes the Aventine guild');
    expect(text).toContain('Scheme: “The Quiet Purchase” — Own the docks by winter');
  });

  it('windows memories to the last three, newest first', async () => {
    const container = await mount(<EntityStatesView entities={[rich, plain]} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Recent memories:');
    expect(text).toContain('T4: Fourth oath.');
    expect(text).toContain('T3: Third bribe.');
    expect(text).toContain('T2: Second omen.');
    expect(text).not.toContain('First blood.');
    expect(text.indexOf('T4: Fourth oath.')).toBeLessThan(text.indexOf('T3: Third bribe.'));
    expect(text.indexOf('T3: Third bribe.')).toBeLessThan(text.indexOf('T2: Second omen.'));
  });

  it('renders the Rel line with resolved names, zero-defaulted optional axes, and drops falsy relationship values', async () => {
    const container = await mount(<EntityStatesView entities={[rich, plain]} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Rel:');
    expect(text).toContain('Plain Roman T:7 Th:3 A:-2 D:4');
    // Unresolvable target id falls back to the raw id; optional axes default to 0.
    expect(text).toContain('stranger_id T:0 Th:0 A:0 D:0');
    expect(text).not.toContain('void_id');
  });
});

// ---------------------------------------------------------------------------
// SchemeLine
// ---------------------------------------------------------------------------
describe('SchemeLine', () => {
  it('renders the quoted name, the goal, and middot-joined status: objective steps', async () => {
    const scheme: Scheme = {
      name: 'The Quiet Purchase',
      overall_goal: 'Own the docks by winter',
      steps: [
        { objective: 'Buy the warehouses', status: 'completed' },
        { objective: 'Bribe the harbormaster', status: 'in_progress' },
      ],
    };
    const container = await mount(<SchemeLine scheme={scheme} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Scheme: “The Quiet Purchase” — Own the docks by winter');
    expect(text).toContain('completed: Buy the warehouses · in_progress: Bribe the harbormaster');
  });
});

// ---------------------------------------------------------------------------
// LatencyStrip
// ---------------------------------------------------------------------------
describe('LatencyStrip', () => {
  it('renders nothing at all for absent or empty rawCalls', async () => {
    const absent = await mount(<LatencyStrip />);
    expect(absent.childElementCount).toBe(0);
    expect(absent.textContent).toBe('');

    const empty = await mount(<LatencyStrip rawCalls={[]} />);
    expect(empty.childElementCount).toBe(0);
  });

  it('renders the call count, total milliseconds, and one titled bar per call with pluralized attempts', async () => {
    const container = await mount(<LatencyStrip rawCalls={[
      makeRawCall({ callName: 'adjudication', latencyMs: 120, attempts: 1 }),
      makeRawCall({ callName: 'narration', model: 'gemini-3-flash', latencyMs: 180, attempts: 2 }),
    ]} />);

    expect(container.textContent).toContain('Latency — 2 calls, 300ms total');
    const bars = Array.from(container.querySelectorAll('[title]'));
    expect(bars).toHaveLength(2);
    expect(bars.map(bar => bar.getAttribute('title'))).toEqual([
      'adjudication · gemini-3.8-flash · 120ms · 1 attempt',
      'narration · gemini-3-flash · 180ms · 2 attempts',
    ]);
  });

  it('singularizes a lone call', async () => {
    const container = await mount(<LatencyStrip rawCalls={[makeRawCall({ latencyMs: 120 })]} />);
    expect(container.textContent).toContain('Latency — 1 call, 120ms total');
  });
});

// ---------------------------------------------------------------------------
// PrivateView
// ---------------------------------------------------------------------------
describe('PrivateView', () => {
  it('renders every gm_private note in curly quotes', async () => {
    const container = await mount(
      <PrivateView adjudication={makeAdjudication({ gm_private: ['The senator lies.', 'The purse was marked.'] })} />);
    expect(container.textContent).toContain('“The senator lies.”');
    expect(container.textContent).toContain('“The purse was marked.”');
  });

  it('names the empty state', async () => {
    const container = await mount(<PrivateView adjudication={makeAdjudication()} />);
    expect(container.textContent).toContain('No private GM notes for this turn.');
  });
});

// ---------------------------------------------------------------------------
// GroundTruthView
// ---------------------------------------------------------------------------
describe('GroundTruthView', () => {
  const worldState = makeWorldState();

  it('names the trimmed-snapshot state', async () => {
    const container = await mount(
      <GroundTruthView entry={makeTurnHistoryEntry()} playerCharacterId="player_1" worldState={worldState} />);
    expect(container.textContent).toContain(
      "Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the perception classification needs the turn's own roster.");
  });

  it('names the missing-player state when the roster holds no player character', async () => {
    const entry = makeTurnHistoryEntry({
      postTurnEntities: [makeEntity({ entity_id: 'npc_distant', name: 'Distant Roman', location: 'Ravenna' })],
    });
    const container = await mount(
      <GroundTruthView entry={entry} playerCharacterId={null} worldState={worldState} />);
    expect(container.textContent).toContain('No player character to classify against for this turn.');
  });

  it('names the no-deltas state', async () => {
    const entry = makeTurnHistoryEntry({ postTurnEntities: [makeEntity()] });
    const container = await mount(
      <GroundTruthView entry={entry} playerCharacterId="player_1" worldState={worldState} />);
    expect(container.textContent).toContain('No deltas were recorded this turn.');
  });

  it('classifies each delta against the player: public and self VISIBLE, out-of-sight FILTERED', async () => {
    const player = makeEntity(); // player_1, Gaius Testus, Rome, empty network
    const distant = makeEntity({ entity_id: 'npc_distant', name: 'Distant Roman', location: 'Ravenna' });
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [
          { type: 'rumor', key: 'forum_whisper', delta: 1, reason: 'A rumor spreads.' },
          { type: 'resource', key: 'player_1:denarii', delta: -3, reason: 'The purse thins.' },
          { type: 'resource', key: 'npc_distant:denarii', delta: 4, reason: 'A distant purse fattens.' },
        ],
      }),
      postTurnEntities: [player, distant],
    });
    const container = await mount(
      <GroundTruthView entry={entry} playerCharacterId="player_1" worldState={worldState} />);
    const text = container.textContent ?? '';

    // The header names the player the classification runs against.
    expect(text).toContain('classifyDelta lets');
    expect(text).toContain('Gaius Testus');
    expect(text).toContain('VISIBLE — public');
    expect(text).toContain('VISIBLE — self');
    expect(count(text, 'FILTERED (invisible to player)')).toBe(1);
    expect(text).toContain('“A distant purse fattens.”');
  });

  it('renders the turn seed replay clause for a numeric seed and the absence line otherwise', async () => {
    const seeded = await mount(
      <GroundTruthView
        entry={makeTurnHistoryEntry({ postTurnEntities: [makeEntity()], turnSeed: 123 })}
        playerCharacterId="player_1"
        worldState={worldState}
      />);
    expect(seeded.textContent).toContain(
      "123 — replays this turn's hidden rolls in draw order (action roll, then mortality rolls).");

    const unseeded = await mount(
      <GroundTruthView
        entry={makeTurnHistoryEntry({ postTurnEntities: [makeEntity()] })}
        playerCharacterId="player_1"
        worldState={worldState}
      />);
    expect(unseeded.textContent).toContain('None recorded for this turn.');
  });

  it('renders the mortality trace as pretty JSON in a pre, or the Fates-scales absence line', async () => {
    const traced = await mount(
      <GroundTruthView
        entry={makeTurnHistoryEntry({ postTurnEntities: [makeEntity()], mortalityTrace: [makeMortalityEvent()] })}
        playerCharacterId="player_1"
        worldState={worldState}
      />);
    const pre = traced.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('"claim": "Poisoned at a banquet."');

    const untraced = await mount(
      <GroundTruthView
        entry={makeTurnHistoryEntry({ postTurnEntities: [makeEntity()] })}
        playerCharacterId="player_1"
        worldState={worldState}
      />);
    expect(untraced.textContent).toContain(
      "No mortality trace recorded for this turn — nothing triggered the Fates' scales.");
  });
});

// ---------------------------------------------------------------------------
// NpcPerceptionView
// ---------------------------------------------------------------------------
describe('NpcPerceptionView', () => {
  const worldState = makeWorldState();

  it('names the trimmed-snapshot state', async () => {
    const container = await mount(
      <NpcPerceptionView entry={makeTurnHistoryEntry()} worldState={worldState} />);
    expect(container.textContent).toContain(
      "Entity snapshot trimmed for this older turn - only the most recent turns retain one, and the per-NPC perception derivation needs the turn's own roster.");
  });

  it('names the pre-record state when perceivingNpcIds is absent', async () => {
    const entry = makeTurnHistoryEntry({ postTurnEntities: [makeEntity()] });
    const container = await mount(<NpcPerceptionView entry={entry} worldState={worldState} />);
    expect(container.textContent).toContain('No perceiving-NPC set recorded for this turn.');
  });

  it('names the empty-selection state when perceivingNpcIds is []', async () => {
    const entry = makeTurnHistoryEntry({ postTurnEntities: [makeEntity()], perceivingNpcIds: [] });
    const container = await mount(<NpcPerceptionView entry={entry} worldState={worldState} />);
    expect(container.textContent).toContain('No NPCs were selected to perceive this turn.');
  });

  it('defaults a legacy visibility_network, renders each digest, and skips ids missing from the snapshot', async () => {
    const watcher = makeEntity({
      entity_id: 'npc_watcher', name: 'Watcher Roman', location: 'Rome',
      visibility_network: ['npc_distant_a'], resources: { denarii: 5 },
    });
    // Legacy shape: a snapshot entity written before visibility_network
    // existed. The network-rule delta below reads it unconditionally — the
    // view's `?? []` default is what keeps this render alive.
    const legacyClone = { ...makeEntity({ entity_id: 'npc_legacy', name: 'Legacy Roman', location: 'Praetorian Camp' }) } as Record<string, unknown>;
    delete legacyClone.visibility_network;
    const legacy = legacyClone as unknown as Entity;
    const distantA = makeEntity({ entity_id: 'npc_distant_a', name: 'Distant A', location: 'Ravenna' });
    const distantB = makeEntity({ entity_id: 'npc_distant_b', name: 'Distant B', location: 'Ravenna' });

    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({
        deltas: [
          // At neither viewer's location — forces the network rule.
          { type: 'relation', key: 'npc_distant_a:npc_distant_b:trust_level', delta: 1, reason: 'A quiet accord.' },
          { type: 'resource', key: 'npc_watcher:denarii', delta: 5, reason: 'A purse arrives.' },
        ],
      }),
      postTurnEntities: [watcher, legacy, distantA, distantB],
      perceivingNpcIds: ['npc_watcher', 'npc_legacy', 'ghost_npc'],
    });
    const container = await mount(<NpcPerceptionView entry={entry} worldState={worldState} />);
    const text = container.textContent ?? '';

    // The approximation caveat paragraph renders above the cast.
    expect(text).toContain('APPROXIMATES');
    expect(text).toContain('Watcher Roman — Rome · network: npc_distant_a');
    expect(text).toContain('Legacy Roman — Praetorian Camp · network: none');
    // The watcher perceived (self + network); only the legacy npc saw nothing.
    expect(text).toContain('self');
    expect(count(text, 'Perceived nothing this turn.')).toBe(1);
    // An id absent from the snapshot is skipped entirely.
    expect(text).not.toContain('ghost');
  });
});
