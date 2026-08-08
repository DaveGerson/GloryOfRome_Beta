/**
 * @vitest-environment jsdom
 *
 * GM console split, group 2 — registers & campaign-wide records
 * (NarrationView, RawView, FixturesView, PrivateSceneGmView,
 * TruthLedgerView, PlayerKnowledgeView).
 *
 * STRICT characterization of the current components/GameMasterScreen.tsx
 * monolith: every expectation below was derived by reading that source, not
 * from intent. Each view is imported from its FUTURE module path under
 * components/gm/ — these modules do not exist yet, so this file is RED until
 * the split lands, and must then go green with no edits here.
 *
 * NarrationView/FixturesView already have deep coverage in
 * tests/gmNarrationPane.test.tsx (monologue three-way, chunk clause, strike
 * verdict wording); this file pins the states that file does not — the
 * headline strike-through and boundary column, the raw-call rail's selection
 * state and save-restored fallback, the turn-switch verdict reset, and the
 * three record views the monolith never exported.
 *
 * House style: React 19 act() + react-dom/client only, no testing-library
 * (same harness as tests/gmNarrationPane.test.tsx / gmScreenSmoke.test.ts).
 * Fixture vocabulary from tests/factories.ts.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

// FUTURE paths — the deliverable is that these do not resolve yet.
import { NarrationView } from '../components/gm/NarrationView';
import { RawView } from '../components/gm/RawView';
import { FixturesView } from '../components/gm/FixturesView';
import { PrivateSceneGmView } from '../components/gm/PrivateSceneGmView';
import { TruthLedgerView } from '../components/gm/TruthLedgerView';
import { PlayerKnowledgeView } from '../components/gm/PlayerKnowledgeView';

import { MAX_CAPTURED_PROMPT_CHARS } from '../ai/core/geminiService';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import type { TruthLedgerEntry } from '../types';
import {
  makeAdjudication,
  makeKnowledgeClaim,
  makeMortalityEvent,
  makePrivateScene,
  makeRawCall,
  makeReport,
  makeResolutionTrace,
  makeTurnHistoryEntry,
} from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<{
  container: HTMLElement;
  rerender: (next: React.ReactElement) => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return {
    container,
    rerender: async next => {
      await act(async () => root.render(next));
    },
  };
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(node => node.textContent === name);
}

// ---------------------------------------------------------------------------
// NarrationView
// ---------------------------------------------------------------------------
describe('gm/NarrationView — headlines and the boundary column', () => {
  it('renders kept headlines with the fleuron and cut headlines struck through in the same list', async () => {
    const entry = makeTurnHistoryEntry({
      narration: 'A tense week passes.',
      adjudication: makeAdjudication({ headlines: ['The Senate convenes.'] }),
      proseRedactions: [
        { surface: 'headlines[1]', original: 'CUT_HEADLINE_SENTINEL' },
        { surface: 'narration', original: 'CUT_PROSE_SENTINEL' },
      ],
    });
    const { container } = await mount(<NarrationView entry={entry} />);

    expect(container.textContent).toContain('❧ The Senate convenes.');
    const struck = container.querySelector('.gor-gm-struck');
    expect(struck).not.toBeNull();
    expect(struck!.textContent).toContain('× CUT_HEADLINE_SENTINEL');
    // Only the headline-surface cut is struck into the headline list; the
    // prose cut appears in the boundary column only.
    expect(container.querySelectorAll('.gor-gm-struck')).toHaveLength(1);
    expect(container.textContent).not.toContain('No headlines this turn.');
  });

  it('renders one boundary card per redaction, with the headline/prose replacement fork', async () => {
    const entry = makeTurnHistoryEntry({
      narration: 'A tense week passes.',
      adjudication: makeAdjudication({ headlines: [] }),
      proseRedactions: [
        { surface: 'headlines[0]', original: 'CUT_HEADLINE_SENTINEL' },
        { surface: 'narration', original: 'CUT_PROSE_SENTINEL' },
      ],
    });
    const { container } = await mount(<NarrationView entry={entry} />);
    const text = container.textContent ?? '';

    // Each card names its surface, carries the removed text verbatim on the
    // weave, and states the player-side reading.
    expect(text).toContain('headlines[0]');
    expect(text).toContain('CUT_PROSE_SENTINEL');
    const weaves = container.querySelectorAll('.gor-gm-weave');
    expect(weaves).toHaveLength(2);
    expect(text).toContain('Read as the player acting, with no attempt on record.');
    // The fork: a dropped headline vs. the substituted hedge line.
    expect(text).toContain('dropped entirely');
    expect(text).toContain('Something shifts, unremarked.');
    // A turn with redactions never shows the laurel.
    expect(container.querySelector('.gor-gm-laurel')).toBeNull();
    expect(text).not.toContain('Nothing was withheld this turn.');
  });

  it('shows the laurel empty-boundary state, the headline zero state, and the narration fallback together', async () => {
    const entry = makeTurnHistoryEntry({
      adjudication: makeAdjudication({ headlines: [] }),
      // no narration, no proseRedactions
    });
    const { container } = await mount(<NarrationView entry={entry} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Narration — 0 chars');
    expect(container.querySelector('.gor-gm-tablet')!.textContent).toContain('No narration generated.');
    expect(text).toContain('No headlines this turn.');
    const laurel = container.querySelector('.gor-gm-laurel');
    expect(laurel).not.toBeNull();
    expect(laurel!.textContent).toContain('Nothing was withheld this turn.');
    expect(laurel!.textContent).toContain('An empty boundary is a result, not an absence.');
    // The blindfold plaque is unconditional.
    expect(text).toContain("The narrator's blindfold");
    expect(text).toContain('A character quietly advanced a private design this turn; its nature is not observable.');
  });
});

// ---------------------------------------------------------------------------
// RawView
// ---------------------------------------------------------------------------
describe('gm/RawView — the call rail and its registers', () => {
  it('renders no rail and the empty note when no calls were captured, with the parsed adjudication always present', async () => {
    const adjudication = makeAdjudication({ headlines: ['RAW_ADJ_SENTINEL'] });
    const { container } = await mount(<RawView adjudication={adjudication} />);

    expect(container.querySelector('nav[aria-label="Raw calls"]')).toBeNull();
    expect(container.textContent).toContain('No raw calls captured for this turn.');
    // The parsed-adjudication register renders the exact JSON.
    expect(container.textContent).toContain('Parsed adjudication');
    expect(container.textContent).toContain('"RAW_ADJ_SENTINEL"');
  });

  it('selects the first call by default and renders its three registers with captured prompt text', async () => {
    const first = makeRawCall({
      callName: 'adjudication',
      latencyMs: 140,
      promptChars: 12,
      promptText: 'FIRST_PROMPT_SENTINEL',
      systemInstruction: 'FIRST_SYSTEM_SENTINEL',
      rawResponse: '{"first":true}',
    });
    const second = makeRawCall({
      callName: 'narration',
      latencyMs: 900,
      attempts: 2,
      promptChars: 34,
      rawResponse: '{"second":true}',
    });
    const { container } = await mount(
      <RawView adjudication={makeAdjudication()} rawCalls={[first, second]} />);

    const rail = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Raw calls"] button'));
    expect(rail).toHaveLength(2);
    expect(rail[0].getAttribute('aria-current')).toBe('true');
    expect(rail[1].getAttribute('aria-current')).toBeNull();
    expect(rail[0].textContent).toContain('adjudication');
    expect(rail[0].textContent).toContain('140ms');
    expect(rail[0].textContent).toContain('validated');
    // attempts > 1 flags the rail entry, not as invalid.
    expect(rail[1].textContent).toContain('attempt 2');

    const text = container.textContent ?? '';
    expect(text).toContain('System instruction');
    expect(text).toContain(`${'FIRST_SYSTEM_SENTINEL'.length} chars`);
    expect(text).toContain('FIRST_SYSTEM_SENTINEL');
    expect(text).toContain(`12 chars · captured to ${MAX_CAPTURED_PROMPT_CHARS.toLocaleString()}`);
    expect(text).toContain('FIRST_PROMPT_SENTINEL');
    expect(text).toContain('validated · 14 chars');
    expect(text).toContain('{"first":true}');
    expect(text).not.toContain('{"second":true}');
    expect(text).not.toContain('Not captured');
  });

  it('moves selection on rail click and falls back to the save-restored wording for uncaptured prompts', async () => {
    const first = makeRawCall({
      callName: 'adjudication',
      promptText: 'FIRST_PROMPT_SENTINEL',
      systemInstruction: 'FIRST_SYSTEM_SENTINEL',
      rawResponse: '{"first":true}',
    });
    const second = makeRawCall({
      callName: 'narration',
      promptChars: 34,
      rawResponse: '{"second":true}',
      // promptText/systemInstruction absent — the save-restored shape.
    });
    const { container } = await mount(
      <RawView adjudication={makeAdjudication()} rawCalls={[first, second]} />);

    const rail = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Raw calls"] button'));
    await click(rail[1]);

    expect(rail[1].getAttribute('aria-current')).toBe('true');
    expect(rail[0].getAttribute('aria-current')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('{"second":true}');
    expect(text).not.toContain('{"first":true}');
    // The system-instruction meta says 'not captured'; both uncaptured
    // bodies carry the same restored-from-save sentence.
    expect(text).toContain('not captured');
    const fallbacks = text.match(
      /Not captured — this record was restored from a save, which never carries prompt text\./g) ?? [];
    expect(fallbacks).toHaveLength(2);
    expect(text).not.toContain('FIRST_PROMPT_SENTINEL');
  });

  it('flags an unvalidated call as invalid json on the rail and NOT validated on the response register', async () => {
    const bad = makeRawCall({ callName: 'adjudication', validated: false, rawResponse: 'not json' });
    const { container } = await mount(
      <RawView adjudication={makeAdjudication()} rawCalls={[bad]} />);

    const rail = container.querySelector('nav[aria-label="Raw calls"]')!;
    expect(rail.textContent).toContain('invalid json');
    expect(container.textContent).toContain('NOT validated · 8 chars');
  });
});

// ---------------------------------------------------------------------------
// FixturesView
// ---------------------------------------------------------------------------
describe('gm/FixturesView — draws, verdict ownership, and the corpus manifest', () => {
  const SEED = 0x5eedf00d;
  const fixtureProps = {
    history: [],
    sessionCalls: 0,
    hasTruthLedger: false,
    hasKnowledge: false,
    onExport: () => {},
  };

  it('lists the action roll first, then only VALID mortality rolls — an invalidated claim consumes no draw', async () => {
    const entry = makeTurnHistoryEntry({
      turnNumber: 6,
      turnSeed: 99,
      resolutionTrace: makeResolutionTrace({ roll: 11 }),
      mortalityTrace: [
        makeMortalityEvent({ entity_name: 'Gaius Pontius Magnus', roll: 4 }),
        makeMortalityEvent({
          entity_name: 'INVALID_CLAIM_SENTINEL',
          valid: false,
          roll: undefined,
          band: undefined,
          outcomeSummary: 'Ruled a hallucination.',
        }),
      ],
    });
    const { container } = await mount(<FixturesView entry={entry} {...fixtureProps} />);
    const text = container.textContent ?? '';

    expect(text).toContain('1. Action · political maneuvering');
    expect(text).toContain('2. Mortality · Gaius Pontius Magnus');
    expect(text).not.toContain('INVALID_CLAIM_SENTINEL');
    expect(text).not.toContain('3.');
  });

  it('keeps a struck verdict with the turn it was struck FROM: hidden on another turn, standing again on return', async () => {
    const recorded = rollD20(createSeededRng(SEED));
    const entryA = makeTurnHistoryEntry({
      turnNumber: 4,
      turnSeed: SEED,
      resolutionTrace: makeResolutionTrace({ roll: recorded }),
    });
    const entryB = makeTurnHistoryEntry({
      turnNumber: 5,
      turnSeed: SEED ^ 0xff,
      resolutionTrace: makeResolutionTrace({ roll: 7 }),
    });
    const { container, rerender } = await mount(<FixturesView entry={entryA} {...fixtureProps} />);

    await click(buttonNamed(container, 'Strike the mould again')!);
    expect(container.textContent)
      .toContain('The mould holds — every roll re-drawn from the seed matches the record.');

    // Switching the rail to another turn may not leave A's verdict standing.
    await rerender(<FixturesView entry={entryB} {...fixtureProps} />);
    expect(container.textContent).not.toMatch(/The mould holds|The mould does not hold/);
    expect(buttonNamed(container, 'Strike the mould again')).toBeTruthy();

    // The strike was stored with entry A, so returning to it restores the
    // verdict without pressing again.
    await rerender(<FixturesView entry={entryA} {...fixtureProps} />);
    expect(container.textContent)
      .toContain('The mould holds — every roll re-drawn from the seed matches the record.');
  });

  it('renders the manifest counts, optional-slice presence, filename, and fires onExport from "Take the impression"', async () => {
    const onExport = vi.fn();
    const withPrompts = makeTurnHistoryEntry({
      turnNumber: 2,
      turnSeed: 11,
      rawCalls: [makeRawCall({ promptText: 'captured one' }), makeRawCall()],
    });
    const withoutPrompts = makeTurnHistoryEntry({ turnNumber: 3 });
    const entry = makeTurnHistoryEntry({ turnNumber: 3 }); // no seed, no traces
    const { container } = await mount(
      <FixturesView
        entry={entry}
        history={[withPrompts, withoutPrompts]}
        sessionCalls={7}
        hasTruthLedger={true}
        hasKnowledge={false}
        onExport={onExport}
      />);

    // The plaque shows the dash for a seedless turn, and the drew-no-dice
    // zero state ends with a plain period (no seed to strike from).
    expect(container.querySelector('.gor-gm-plaque-seed')!.textContent).toBe('—');
    expect(container.textContent).toContain('This turn drew no dice.');
    expect(container.textContent).not.toContain('nothing to strike from the mould');
    expect(buttonNamed(container, 'Strike the mould again')).toBeUndefined();

    function manifestRow(label: string): string {
      const cell = Array.from(container.querySelectorAll('span'))
        .find(node => node.textContent === label);
      expect(cell, `manifest cell "${label}"`).toBeTruthy();
      return cell!.parentElement!.textContent ?? '';
    }
    expect(manifestRow('turns[]')).toBe('turns[]2');
    expect(manifestRow('rawCalls[].promptText')).toBe('rawCalls[].promptText1 captured');
    expect(manifestRow('turnSeed · traces')).toBe('turnSeed · traces1 seeded');
    expect(manifestRow('npcIntents · npcMindResults'))
      .toBe('npcIntents · npcMindResultsprivate reasoning included');
    expect(manifestRow('sessionCallLog')).toBe('sessionCallLog7');
    expect(manifestRow('◆ truthLedger')).toBe('◆ truthLedgerattached');
    expect(manifestRow('◆ knowledge')).toBe('◆ knowledgeabsent');

    expect(container.textContent).toContain('gor-eval-corpus-turn3.json');
    expect(container.textContent).toContain('Never written into the save.');

    await click(buttonNamed(container, 'Take the impression')!);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PrivateSceneGmView
// ---------------------------------------------------------------------------
describe('gm/PrivateSceneGmView — the private scene ledger', () => {
  it('renders the labelled section with its kicker and the empty-ledger note when no scenes exist', async () => {
    const { container } = await mount(<PrivateSceneGmView scenes={[]} />);

    const section = container.querySelector('section[aria-label="Private scene GM ledger"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Private Scene Ledger');
    expect(section!.textContent).toContain('No private scenes have been recorded.');
  });

  it('renders scenes newest first with transcript, speech acts, consequence, and the GM-only intent block', async () => {
    const older = makePrivateScene({
      sceneId: 'scene_2_1',
      macroTurn: 2,
      consequenceStatus: 'consumed',
      consumedByTurn: 3,
      lastWord: 'OLDER_LAST_WORD',
    });
    const newer = makePrivateScene({
      sceneId: 'scene_5_1',
      macroTurn: 5,
      npcId: 'gaius_pontius_magnus',
      npcName: 'Gaius Pontius Magnus',
      speechActs: [],
      npcPrivate: { sincerity: 'Open.', hiddenIntent: 'None.', plannedFollowThrough: [] },
    });
    const { container } = await mount(<PrivateSceneGmView scenes={[older, newer]} />);

    // slice().reverse(): the newest scene renders first.
    const summaries = Array.from(container.querySelectorAll('summary'));
    expect(summaries).toHaveLength(2);
    expect(summaries[0].textContent).toContain('Turn 5 · Severus Alexander / Gaius Pontius Magnus · closed');
    expect(summaries[1].textContent).toContain('Turn 2 · Severus Alexander / Maximinus Thrax · closed');

    const text = container.textContent ?? '';
    expect(text).toContain('Scene ID: scene_2_1');
    expect(text).toContain('Closure: player_ended');
    expect(text).toContain('Last word: OLDER_LAST_WORD');
    expect(text).toContain('Consequence: consumed · Consumed by turn 3');
    // The pending scene shows no consumed-by clause.
    expect(text).toContain('Consequence: pending');

    // Transcript lines resolve speaker to the scene's names.
    expect(text).toContain('Severus Alexander: Speak plainly.');
    expect(text).toContain('Maximinus Thrax: I have heard you.');
    expect(text).toContain('Gaius Pontius Magnus: I have heard you.');

    // Speech acts: one recorded, one empty.
    expect(text).toContain('Exchange 1 · npc · claim: I have heard you.');
    expect(text).toContain('None recorded.');

    // The crimson-bordered GM-only block.
    expect(text).toContain('NPC private intent — GM only');
    expect(text).toContain('Sincerity: Guarded.');
    expect(text).toContain('Hidden intent: Measure the emperor before choosing a side.');
    expect(text).toContain('Planned follow-through: Question the camp prefect.');
    // Empty follow-through falls back to the note.
    expect(text).toContain('Planned follow-through: None recorded.');
  });
});

// ---------------------------------------------------------------------------
// TruthLedgerView
// ---------------------------------------------------------------------------
describe('gm/TruthLedgerView — true vs. believed', () => {
  it('renders the empty-ledger note', async () => {
    const { container } = await mount(<TruthLedgerView ledger={[]} reports={[]} />);
    expect(container.textContent).toContain('No rumors have been recorded in the truth ledger yet.');
  });

  it('renders newest first with roman turn, disposition, ASSUMED flag, and matching-report credibility', async () => {
    const ledger: TruthLedgerEntry[] = [
      {
        id: 'tl_1',
        turn: 2,
        claim: 'Thrax courts the Rhine legions',
        aboutId: 'maximinus_thrax',
        originId: 'maximinus_thrax',
        isTrue: true,
        reportId: 'report_2_1',
      },
      {
        id: 'tl_2',
        turn: 4,
        claim: 'The grain fleet was lost at sea',
        aboutId: 'world',
        isTrue: false,
        reportId: 'report_4_9',
        assumed: true,
      },
    ];
    const { container } = await mount(
      <TruthLedgerView ledger={ledger} reports={[makeReport()]} />);
    const text = container.textContent ?? '';

    // slice().reverse(): turn IV renders before turn II.
    expect(text.indexOf('Turn IV')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Turn IV')).toBeLessThan(text.indexOf('Turn II'));

    expect(text).toContain('TRUE');
    expect(text).toContain('FALSE');
    // The ASSUMED flag renders exactly once — only on the flagged entry.
    const assumed = text.match(/ASSUMED — model omitted the disposition/g) ?? [];
    expect(assumed).toHaveLength(1);

    // reportId 'report_2_1' matches makeReport (credibility 0.6); the other
    // entry has no matching report.
    expect(text).toContain('player saw: 60% credible');
    expect(text).toContain('player saw: no matching report');

    expect(text).toContain('Thrax courts the Rhine legions');
    expect(text).toContain('about: maximinus_thrax · origin: maximinus_thrax');
    // Absent originId reads as organic.
    expect(text).toContain('about: world · origin: organic (unattributed)');
  });
});

// ---------------------------------------------------------------------------
// PlayerKnowledgeView
// ---------------------------------------------------------------------------
describe('gm/PlayerKnowledgeView — the believed side', () => {
  it('renders the empty-store note', async () => {
    const { container } = await mount(<PlayerKnowledgeView knowledge={[]} />);
    expect(container.textContent).toContain('The player holds no recorded knowledge claims yet.');
  });

  it('renders claims newest first with timeline, per-update credibility, and edge labels resolved or falling back to the raw id', async () => {
    const anchor = makeKnowledgeClaim({
      id: 'claim_anchor',
      subject: 'maximinus_thrax',
      topic: 'legions',
      firstLearnedTurn: 2,
    });
    const linked = makeKnowledgeClaim({
      id: 'claim_linked',
      subject: 'grain_fleet',
      claim: 'The grain fleet was lost',
      claimKey: 'report:grain_fleet:supply:rumor',
      firstLearnedTurn: 4,
      updates: [
        { turn: 4, source: 'rumor', text: 'First heard at the docks', credibility: 0.25 },
        { turn: 6, source: 'witnessed', text: 'Saw the empty berths' },
      ],
      edges: [
        { to: 'claim_anchor', type: 'corroborates' },
        { to: 'claim_evicted', type: 'about' },
      ],
    });
    const { container } = await mount(<PlayerKnowledgeView knowledge={[anchor, linked]} />);
    const text = container.textContent ?? '';

    // slice().reverse(): the later claim renders first.
    expect(text.indexOf('First learned turn IV')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('First learned turn IV')).toBeLessThan(text.indexOf('First learned turn II'));

    expect(text).toContain('subject: grain_fleet');
    expect(text).toContain('topic: legions');
    expect(text).toContain('key: report:grain_fleet:supply:rumor');
    expect(text).toContain('The grain fleet was lost');

    // The update timeline renders reversed (newest arrival first), with the
    // credibility clause only where the update carries one.
    expect(text).toContain('Updates (2)');
    expect(text.indexOf('T6 · witnessed')).toBeLessThan(text.indexOf('T4 · rumor'));
    expect(text).toContain('25% credible');
    const witnessedItem = Array.from(container.querySelectorAll('li'))
      .find(node => node.textContent?.includes('T6 · witnessed'));
    expect(witnessedItem).toBeTruthy();
    expect(witnessedItem!.textContent).not.toContain('credible');

    // labelFor: a live target reads as subject · topic; an evicted target
    // falls back to the raw id.
    expect(text).toContain('Links (2)');
    expect(text).toContain('corroborates → maximinus_thrax · legions');
    expect(text).toContain('about → claim_evicted');
  });

  it('renders the D28 scheme-discovery line: clue count with hidden nature, then the revealed nature verbatim', async () => {
    const hidden = makeKnowledgeClaim({
      id: 'claim_scheme_hidden',
      subject: 'maximinus_thrax',
      topic: 'scheme',
      claimKey: 'scheme:maximinus_thrax',
      firstLearnedTurn: 3,
      schemeDiscovery: { clues: 1, revealed: false },
    });
    const revealed = makeKnowledgeClaim({
      id: 'claim_scheme_revealed',
      subject: 'gaius_pontius_magnus',
      topic: 'scheme',
      claimKey: 'scheme:gaius_pontius_magnus',
      firstLearnedTurn: 5,
      schemeDiscovery: { clues: 3, revealed: true, nature: 'REVEALED_NATURE_SENTINEL' },
    });
    const { container } = await mount(<PlayerKnowledgeView knowledge={[hidden, revealed]} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Scheme clues:');
    expect(text).toContain('1 · nature hidden');
    expect(text).toContain('3 · nature revealed');
    expect(text).toContain('REVEALED_NATURE_SENTINEL');
  });
});
