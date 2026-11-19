/**
 * @vitest-environment jsdom
 *
 * Regression pins for the adversarial review of rulings D46-D49 (merged
 * 2026-09-29): the defects the reviewers verified that no cluster's own
 * tests covered. Each case names the rule it holds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { applyDeltas } from '../ai/core/engine';
import { deriveLeverageTruth, schemeClueRecords } from '../ai/core/groundTruth';
import { ingestPerceivedChanges, perceivedConditionsOf } from '../knowledge/store';
import { buildPlayerPerceivedDigest, toPreTurnRoster } from '../perception/visibility';
import { normalizeLoadedEntities } from '../persistence/saveGame';
import { Tooltip } from '../components/ui/Feedback';
import { GroundTruthView } from '../components/gm/GroundTruthView';
import { NpcPerceptionView } from '../components/gm/NpcPerceptionView';
import { buildActionAssessmentPrompt } from '../ai/prompts/assessment';
import { buildDeepAnalysisPrompt, buildInvestigationPrompt, buildStoryRelevancePrompt } from '../ai/prompts/intelligence';
import { buildEntityBatchPrompt } from '../ai/prompts/worldGen';
import { buildCharacterCreationPrompt } from '../ai/prompts/characterCreation';
import { buildEvalJudgePrompt } from '../ai/prompts/evalJudge';
import { getClarificationOnEvent, getDeepAnalysis, getPlayerMonologue, getSchemeNatureReading } from '../ai/tools/intelligence';
import { selectNoAttemptEvidence } from '../ai/tools/noAttemptResponse';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { judgeTurn } from '../eval/judge';
import { makeEntity, makeQueuedTextAi, makeRelationship, makeTurnHistoryEntry, makeWorldState } from './factories';
import type { Condition, Entity, EventDelta, TruthLedgerEntry } from '../types';
import type { GoogleGenAI } from '@google/genai';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const world = makeWorldState({ regions: { 'Palatine Hill': { stability: 'Stable', controlling_faction: null, current_events: [] } } });
const player = makeEntity({ entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill' });

describe('D49: a tie once openly professed is never secret again', () => {
  it('left and taken up again in one turn, it comes back public', () => {
    const convert = makeEntity({
      entity_id: 'livia', name: 'Livia', location: 'Palatine Hill',
      affiliations: [{ id: 'christians', name: 'the Christians', kind: 'religion', public: true }],
    });
    const deltas: EventDelta[] = [
      { type: 'affiliation', key: 'livia:christians', delta: 0, reason: 'She walks away.', affiliation: { change: 'leave' } },
      { type: 'affiliation', key: 'livia:christians', delta: 0, reason: 'She returns, quietly.', affiliation: { change: 'join', name: 'the Christians', kind: 'religion', public: false } },
    ];
    const { updatedEntities } = applyDeltas(deltas, [player, convert], world, 5, 'player');
    expect(updatedEntities[1].affiliations).toEqual([{ id: 'christians', name: 'the Christians', kind: 'religion', public: true }]);
  });

  it('openly joining a faction makes a secret tie to that same faction public', () => {
    const plotter = makeEntity({
      entity_id: 'rufus', name: 'Rufus', location: 'Palatine Hill',
      affiliations: [{ id: 'optimates_circle', name: 'the Optimates', kind: 'faction', public: false, faction_id: 'optimates' }],
    });
    const { updatedEntities } = applyDeltas(
      [{ type: 'faction', key: 'rufus', delta: 0, reason: 'optimates' }], [player, plotter], world, 5, 'player',
    );
    expect(updatedEntities[1].faction_id).toBe('optimates');
    expect(updatedEntities[1].affiliations?.[0].public).toBe(true);
  });
});

describe('D48: a perceived mark is known by its engine id, and by how it shows', () => {
  const seer = { ...player, relationships: { courtier: makeRelationship() } };
  const courtier = makeEntity({ entity_id: 'courtier', name: 'Local Courtier', location: 'Palatine Hill' });
  const mark = (key: string, condition: EventDelta['condition']): EventDelta =>
    ({ type: 'condition', key, delta: 0, reason: 'What happened.', condition });

  it('a heal seen under another key still clears the mark, and a name-only mark is kept', () => {
    const gain = [mark('courtier:Nasty Scar', { change: 'add', name: 'a nasty scar', description: 'It still aches at night.', outward: true, severity: 'serious' })];
    const first = applyDeltas(gain, [seer, courtier], world, 5, 'player').updatedEntities;
    let store = ingestPerceivedChanges([], buildPlayerPerceivedDigest(gain, first[0], first, world, toPreTurnRoster([seer, courtier])), 5);
    expect(perceivedConditionsOf(store, 'courtier').map(m => m.name)).toEqual(['a nasty scar']);
    // Another's mark is known by how it shows, never by how it weighs on them.
    expect(perceivedConditionsOf(store, 'courtier')[0].description).toBe('');

    const markId = first[1].conditions![0].id;
    const heal = [mark(`courtier:${markId}`, { change: 'heal' })];
    const second = applyDeltas(heal, first, world, 6, 'player').updatedEntities;
    const digest = buildPlayerPerceivedDigest(heal, second[0], second, world, toPreTurnRoster(first));
    expect(digest.map(change => change.text)).toEqual(['Local Courtier no longer shows a nasty scar.']);
    store = ingestPerceivedChanges(store, digest, 6);
    expect(perceivedConditionsOf(store, 'courtier')).toEqual([]);

    const bare = [mark('courtier', { change: 'add', name: 'a limp', description: '', outward: true, severity: 'light' })];
    const third = applyDeltas(bare, second, world, 7, 'player').updatedEntities;
    store = ingestPerceivedChanges(store, buildPlayerPerceivedDigest(bare, third[0], third, world, toPreTurnRoster(second)), 7);
    expect(perceivedConditionsOf(store, 'courtier').map(m => m.name)).toEqual(['a limp']);
  });
});

describe('saves hold marks and ties to their bounds', () => {
  it('a list over the cap, or with an id twice, is normalized on load', () => {
    const scar: Condition = { id: 'scar', name: 'a scar', description: '', outward: true, severity: 'light', since_turn: 1 };
    const marks: Condition[] = [scar, { ...scar }, ...Array.from({ length: 18 }, (_, i) => ({ ...scar, id: `mark_${i}`, name: `mark ${i}` }))];
    const [loaded] = normalizeLoadedEntities([{ ...player, conditions: marks }]);
    expect(loaded.conditions!.length).toBeLessThanOrEqual(12);
    expect(new Set(loaded.conditions!.map(c => c.id)).size).toBe(loaded.conditions!.length);
    // A sound roster still loads as the very same array.
    const sound: Entity[] = [{ ...player, conditions: [scar] }];
    expect(normalizeLoadedEntities(sound)).toBe(sound);
  });
});

describe('D47: a damaged ledger entry never stops a turn', () => {
  it('an investigation entry without a readable standing is skipped, not read', () => {
    const damaged = {
      id: 'x', turn: 3, claim: 'Owes money.', aboutId: 'rufus', isTrue: true, reportId: 'investigation:rufus:secrets',
      investigation: { kind: 'secrets' },
    } as unknown as TruthLedgerEntry;
    const holder = { ...player, resources: { blackmail_on_rufus: ['Owes money.'] } };
    expect(deriveLeverageTruth(holder, [damaged])).toEqual([]);
    expect(schemeClueRecords([{ ...damaged, investigation: { kind: 'scheme' } } as unknown as TruthLedgerEntry], 'rufus')).toEqual([]);
  });
});

describe('a tooltip opened by a tap stays open while its trigger holds focus', () => {
  let root: Root | undefined;
  let host: HTMLElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  it('survives the mouseleave a tap fires after the click; blur closes it', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Tooltip label="Serious - a long pale seam."><span tabIndex={0}>A scar</span></Tooltip>));
    const trigger = host.querySelector<HTMLElement>('span[tabindex="0"]')!;
    const wrap = host.querySelector<HTMLElement>('.gor-tooltip-wrap')!;
    act(() => trigger.focus());
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => { wrap.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => trigger.blur());
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('GroundTruthView and NpcPerceptionView classify a departure location delta with preTurnRoster and render headlineActors attribution', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    const worldWithFrontier = makeWorldState({
      regions: {
        'Palatine Hill': { stability: 'Stable', controlling_faction: null, current_events: [] },
        'The Rhine Frontier': { stability: 'Stable', controlling_faction: null, current_events: [] },
      },
    });
    const viewer = makeEntity({ entity_id: 'player', name: 'Severus Alexander', location: 'Palatine Hill' });
    const npcWatcher = makeEntity({ entity_id: 'julia', name: 'Julia Mamaea', location: 'Palatine Hill' });
    const travelerBefore = makeEntity({ entity_id: 'thrax', name: 'Maximinus Thrax', location: 'Palatine Hill' });
    const travelerAfter = { ...travelerBefore, location: 'The Rhine Frontier' };

    const entry = makeTurnHistoryEntry({
      turnNumber: 4,
      preTurnRoster: toPreTurnRoster([viewer, npcWatcher, travelerBefore]),
      postTurnEntities: [viewer, npcWatcher, travelerAfter],
      perceivingNpcIds: ['julia'],
      adjudication: {
        turn: 4,
        entityActions: [],
        deltas: [
          { type: 'status', key: 'thrax', delta: 0, new_location: 'The Rhine Frontier', reason: 'Moved north.' },
        ],
        headlines: [
          'Maximinus Thrax rides north toward the Rhine.',
          'Fog settles over the Tiber.',
        ],
        gm_private: [],
      },
      headlineActors: [
        {
          text: 'Maximinus Thrax rides north toward the Rhine.',
          actorIds: ['thrax'],
          actorNames: ['Maximinus Thrax'],
          unresolvedActors: ['Ghostly Scout'],
        },
        {
          text: 'Fog settles over the Tiber.',
          actorIds: [],
        },
      ],
    });

    act(() => {
      root!.render(
        <div>
          <GroundTruthView entry={entry} playerCharacterId="player" worldState={worldWithFrontier} />
          <NpcPerceptionView entry={entry} worldState={worldWithFrontier} />
        </div>,
      );
    });

    // Without preTurnRoster, a departure from Palatine Hill to The Rhine Frontier
    // would be FILTERED because postTurnEntities places thrax at The Rhine Frontier.
    // With preTurnRoster passed through, both GroundTruthView and NpcPerceptionView
    // classify the departure as witnessed!
    expect(host.textContent).toContain('VISIBLE — witnessed');
    expect(host.textContent).toContain('Maximinus Thrax leaves for The Rhine Frontier.');
    // Headline attribution (D42/D47) section renders attributed hands, circumstance, and unresolvedActors:
    expect(host.textContent).toContain('Headline attribution (D42/D47)');
    expect(host.textContent).toContain('Hands: Maximinus Thrax · unresolved: Ghostly Scout');
    expect(host.textContent).toContain('Hands: circumstance');
  });
});

describe('D47-D50 prompt and thinkingConfig completeness', () => {
  it('enriches Action Assessor, Director, Intel, WorldGen/CharacterCreation, and EvalJudge prompts with D47-D50 context', () => {
    const target = makeEntity({
      entity_id: 'thrax',
      name: 'Maximinus Thrax',
      position: 'General',
      epithet: 'the Thracian',
      location: 'The Rhine Frontier',
      resources: { denarii: 400, military_strength: 1200, influence: 30 },
      conditions: [
        { id: 'scar', name: 'a battle scar', description: 'Cut at the Danube.', outward: true, severity: 'serious', since_turn: 1 },
        { id: 'terror', name: 'INWARD_TERROR_SENTINEL', description: 'Private dread.', outward: false, severity: 'grave', since_turn: 1 },
      ],
      affiliations: [
        { id: 'mars', name: 'the Soldiers of Mars', kind: 'cause', public: true },
        { id: 'mithras', name: 'SECRET_MITHRAS_SENTINEL', kind: 'religion', public: false },
      ],
    });

    // 1. Action Assessor prompt
    const assessmentBuilt = buildActionAssessmentPrompt({
      playerIntent: 'Press blackmail against Maximinus Thrax.',
      playerBrief: 'Severus Alexander (Emperor)',
      worldSummary: 'Year 235, Week 1.',
      npcEntities: [target],
      leverageTruth: [{ targetId: 'thrax', item: 'Forged letter', standing: 'false' }],
    });
    expect(assessmentBuilt.prompt).toContain('[Location: The Rhine Frontier]');
    expect(assessmentBuilt.prompt).toContain('Resources: denarii:400, military_strength:1200, influence:30');
    expect(assessmentBuilt.prompt).toContain("Conditions: a battle scar (handle 'scar'; serious; outward - others can see it)");
    expect(assessmentBuilt.prompt).toContain("GM-SECRET: THE PLAYER'S LEVERAGE");
    expect(assessmentBuilt.prompt).toContain('Forged letter');
    expect(assessmentBuilt.systemInstruction).toContain('Conditions');
    expect(assessmentBuilt.systemInstruction).toContain("GM-SECRET: THE PLAYER'S LEVERAGE");

    // 2. Director (storyRelevance) prompt
    const directorBuilt = buildStoryRelevancePrompt(2, ['The Rhine legions stir.'], world, [target], []);
    expect(directorBuilt.prompt).toContain('Location: The Rhine Frontier.');
    expect(directorBuilt.prompt).toContain("Conditions: a battle scar (handle 'scar'; serious; outward - others can see it)");
    expect(directorBuilt.prompt).toContain("Affiliations: the Soldiers of Mars (handle 'mars'; cause; openly professed)");
    expect(directorBuilt.systemInstruction).toContain('CONDITION FEASIBILITY');
    expect(directorBuilt.systemInstruction).toContain('inward condition (outward: false)');

    // 3. Deep Analysis & Investigation prompts (public/outward only)
    const emptyPlan = { kind: 'deep_analysis' as const, accuracy: 'true' as const, fidelity: 'fuller' as const, findings: [], poolEmpty: true };
    const deepBuilt = buildDeepAnalysisPrompt(target, player, true, emptyPlan);
    expect(deepBuilt.prompt).toContain('Location: The Rhine Frontier.');
    expect(deepBuilt.prompt).toContain('Known as: the Thracian.');
    expect(deepBuilt.prompt).toContain('Openly professes: the Soldiers of Mars.');
    expect(deepBuilt.prompt).toContain('Outward marks: a battle scar (serious).');
    expect(deepBuilt.prompt).not.toContain('INWARD_TERROR_SENTINEL');
    expect(deepBuilt.prompt).not.toContain('SECRET_MITHRAS_SENTINEL');

    const invBuilt = buildInvestigationPrompt(target, player, 'secrets', 'success', { ...emptyPlan, kind: 'secrets' });
    expect(invBuilt.prompt).toContain('- Location: The Rhine Frontier');
    expect(invBuilt.prompt).toContain('- Outward marks: a battle scar (serious)');
    expect(invBuilt.prompt).not.toContain('INWARD_TERROR_SENTINEL');
    expect(invBuilt.prompt).not.toContain('SECRET_MITHRAS_SENTINEL');

    // 4. WorldGen & CharacterCreation prompts
    const batchBuilt = buildEntityBatchPrompt(
      [{ entity_id: 'thrax', name: 'Maximinus Thrax', entity_type: 'individual', position: 'General', brief_description: 'A frontier commander.' }],
      [{ entity_id: 'thrax', name: 'Maximinus Thrax', entity_type: 'individual', position: 'General', brief_description: 'A frontier commander.' }],
      'Crisis of the Third Century',
      world,
    );
    expect(batchBuilt.systemInstruction).toContain('respect_level');
    expect(batchBuilt.systemInstruction).toContain("0-2 'conditions'");

    const charBuilt = buildCharacterCreationPrompt('An aged veteran with a limp.', [target]);
    expect(charBuilt.systemInstruction).toContain("0-2 'conditions'");

    // 5. EvalJudge prompt
    const judgeBuilt = buildEvalJudgePrompt({
      turnNumber: 1,
      playerIntent: 'Hold court.',
      adjudication: { turn: 1, entityActions: [], deltas: [], headlines: [], gm_private: [] },
      narration: 'The court is quiet.',
    });
    expect(judgeBuilt.systemInstruction).toContain('lost_item');
    expect(judgeBuilt.systemInstruction).toContain('outward: false, D48');
    expect(judgeBuilt.systemInstruction).toContain('public: false, D49');
    expect(judgeBuilt.systemInstruction).toContain('holds, D50');
  });

  it('passes explicit thinkingConfig budgets to flash intelligence, selector, and judge calls', async () => {
    const target = makeEntity({ entity_id: 'thrax', name: 'Maximinus Thrax', position: 'General' });

    // 1. getClarificationOnEvent (forecast)
    {
      const { ai, generateContent } = makeQueuedTextAi('The Senate willhesitate.');
      await getClarificationOnEvent(ai as unknown as GoogleGenAI, 'A headline.', 'what_follows', player, { allEntities: [player, target], turnHistory: [], knowledge: [] }, false);
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 2. getDeepAnalysis
    {
      const { ai, generateContent } = makeQueuedTextAi('He is dangerous.');
      await getDeepAnalysis(ai as unknown as GoogleGenAI, target, player, false);
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 3. getSchemeNatureReading
    {
      const { ai, generateContent } = makeQueuedTextAi('He plots a march on Rome.');
      await getSchemeNatureReading(ai as unknown as GoogleGenAI, target, player, { standing: 'true', clueAccounts: ['Clue 1'], design: { name: 'March', goal: 'Take Rome' }, groundTruth: 'March: Take Rome', noDesign: false }, false);
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 4. getPlayerMonologue
    {
      const { ai, generateContent } = makeQueuedTextAi(JSON.stringify({ text: 'I wait.', actors: [] }));
      await getPlayerMonologue(ai as unknown as GoogleGenAI, player, ['Quiet week.'], ['Wait.'], true, false);
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 5. selectNoAttemptEvidence
    {
      const { ai, generateContent } = makeQueuedTextAi(JSON.stringify({ decision: 'answer', evidenceIds: ['ev-1'], actors: [] }));
      await selectNoAttemptEvidence(ai, 'What happened?', [{ id: 'ev-1', source: 'self', text: 'Nothing.' }], false);
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 6. getRelationshipObservations
    {
      const { ai, generateContent } = makeQueuedTextAi(JSON.stringify([]));
      await getRelationshipObservations(
        ai,
        [{ id: 'ev-1', source: 'witnessed', text: 'Maximinus Thrax spoke.' }],
        [{ entity_id: 'thrax', name: 'Maximinus Thrax' }],
        ['thrax'],
        false,
      );
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 256 });
    }

    // 7. judgeTurn
    {
      const axis = { score: 5, rationale: 'Good.' };
      const { ai, generateContent } = makeQueuedTextAi(JSON.stringify({
        consequence_density: axis,
        sim_state_consistency: axis,
        schema_validity: axis,
        information_asymmetry: axis,
        character_richness: axis,
      }));
      await judgeTurn(ai, {
        turnNumber: 1,
        playerIntent: 'Hold court.',
        adjudication: { turn: 1, entityActions: [], deltas: [], headlines: [], gm_private: [] },
        narration: 'Quiet.',
        rawCalls: [],
        turnSeed: null,
        resolutionTrace: null,
        mortalityTrace: null,
        npcIntents: null,
        npcMindResults: null,
      });
      expect(generateContent.mock.calls[0][0].config?.thinkingConfig).toEqual({ thinkingBudget: 512 });
    }
  });
});
