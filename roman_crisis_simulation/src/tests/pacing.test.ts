/**
 * @vitest-environment jsdom
 *
 * tests/pacing.test.ts
 *
 * Adjudicator-judged pacing (ROADMAP_PHASE_4.md 4D item 1, DESIGN_DECISIONS.md
 * D23): pacing is the ADJUDICATOR's intentional per-turn judgment - default
 * posture non-intervention, light directing when it acts, judgment recorded
 * as a "[Pacing]" gm_private note (GM console only, D4/D7) - tuned by a
 * device-level posture preference (persistence/settings.ts). D23's hard
 * bound - no code-side tension scalar, accumulator, or threshold - is a
 * structural property: the ONLY code this feature adds is one stored enum
 * and one prompt line, both pinned here.
 *
 * Pipeline-level threading (runNewTurn options -> adjudication system
 * instruction) is pinned in tests/turnPipeline.test.ts's scripted fake
 * client, alongside the other option-threading pins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { getPacingPosture, setPacingPosture, DEFAULT_PACING_POSTURE } from '../persistence/settings';
import { mockRunNewTurn } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { PacingPosture, PacingPostureEnum, SimulationState } from '../types';

const SIM_STATE: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
};

/** The adjudication system instruction for a given posture (absent = default). */
function buildSystem(pacingPosture?: PacingPosture): string {
  const { entities, worldState } = getMockInitialState();
  const { systemInstruction } = buildAdjudicationPrompt({
    worldState,
    simulationState: SIM_STATE,
    playerEntity: entities[0],
    npcEntities: entities.slice(1),
    history: [],
    playerIntent: 'Hold court',
    gmInterventionText: '',
    storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
    metaNarrative: 'A succession crisis.',
    pacingPosture,
  });
  return systemInstruction;
}

// --- the PACING JUDGMENT principle (prompt pins) ---------------------------

describe('buildAdjudicationPrompt: the PACING JUDGMENT principle (4D.1, D23)', () => {
  it('states pacing as the adjudicator\'s OWN intentional judgment with non-intervention as the default posture (pin)', () => {
    const systemInstruction = buildSystem();
    expect(systemInstruction).toContain('PACING JUDGMENT');
    // The judgment is the model's, not a mechanism's...
    expect(systemInstruction).toContain('pacing is YOUR intentional judgment - no meter or score decides it for you');
    // ...weighed against the rhythm inputs it already sees...
    expect(systemInstruction).toContain('RECENT HISTORY, the spotlight intents and mind decisions');
    // ...with letting the story breathe as the explicit default.
    expect(systemInstruction).toContain('LET IT BREATHE (your default)');
    expect(systemInstruction).toContain('quiet weeks are legitimate');
    // The pacing principle explicitly scopes NARRATIVE DRIVE so the two
    // never read as contradictory demands.
    expect(systemInstruction).toContain('it does not oblige you to inject new pressure uninvited');
  });

  it('bounds intervention to LIGHT direction rooted in the standing fiction, gated on the story requiring it (pin)', () => {
    const systemInstruction = buildSystem();
    expect(systemInstruction).toContain('TIGHTEN, with LIGHT direction, only when you judge the story requires it');
    expect(systemInstruction).toContain('stakes gone slack for several consecutive turns, threads left dangling unresolved');
    // Light directing is defined by example, and the arbitrary-injection
    // failure mode is named and forbidden.
    expect(systemInstruction).toContain('a scheme already in play ripens, latent pressure surfaces, a consequence already seeded arrives');
    expect(systemInstruction).toContain('Never an arbitrary bolt from the blue');
  });

  it('demands a per-turn "[Pacing]" gm_private note and keeps the reasoning off every player surface (D4/D5/D7 pin)', () => {
    const systemInstruction = buildSystem();
    expect(systemInstruction).toContain('Record your pacing judgment EVERY turn as a \'gm_private\' note prefixed "[Pacing]"');
    expect(systemInstruction).toContain('[Pacing] letting the week breathe');
    expect(systemInstruction).toContain('the player only ever FEELS the pacing');
  });

  it('renders the balanced posture line when the input is absent - byte-identical to an explicit \'balanced\'', () => {
    const absent = buildSystem(undefined);
    expect(absent).toContain('PACING POSTURE - MEASURED (the default)');
    expect(absent).toBe(buildSystem('balanced'));
  });

  it('renders exactly one posture line per posture, never a neighbor\'s', () => {
    const restrained = buildSystem('restrained');
    expect(restrained).toContain('PACING POSTURE - PATIENT');
    expect(restrained).toContain('let even long quiet stretches stand');
    expect(restrained).not.toContain('PACING POSTURE - MEASURED');
    expect(restrained).not.toContain('PACING POSTURE - EAGER');

    const dramatic = buildSystem('dramatic');
    expect(dramatic).toContain('PACING POSTURE - EAGER');
    expect(dramatic).toContain('Tolerate fewer slack turns and tighten sooner');
    // The eager posture still binds itself to LIGHT direction - more eager,
    // never arbitrary.
    expect(dramatic).toContain('even eager direction stays LIGHT');
    expect(dramatic).not.toContain('PACING POSTURE - MEASURED');
    expect(dramatic).not.toContain('PACING POSTURE - PATIENT');

    const balanced = buildSystem('balanced');
    expect(balanced).not.toContain('PACING POSTURE - PATIENT');
    expect(balanced).not.toContain('PACING POSTURE - EAGER');
  });

  it('every posture keeps the full default contract - the posture line is additive, never a replacement (additive pin)', () => {
    for (const posture of PacingPostureEnum) {
      const systemInstruction = buildSystem(posture);
      expect(systemInstruction).toContain('PACING JUDGMENT');
      expect(systemInstruction).toContain('LET IT BREATHE (your default)');
      expect(systemInstruction).toContain('Never an arbitrary bolt from the blue');
      expect(systemInstruction).toContain('prefixed "[Pacing]"');
      // Pre-4D principles stand untouched around it.
      expect(systemInstruction).toContain('NARRATIVE DRIVE');
      expect(systemInstruction).toContain('DIRECTION PRECEDENCE');
    }
  });
});

// --- persistence/settings.ts (device preference, onboarding.ts pattern) ----

describe('persistence/settings: pacing posture localStorage round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to \'balanced\' before anything has been stored', () => {
    expect(DEFAULT_PACING_POSTURE).toBe('balanced');
    expect(getPacingPosture()).toBe('balanced');
  });

  it('round-trips every posture in the enum', () => {
    for (const posture of PacingPostureEnum) {
      setPacingPosture(posture);
      expect(getPacingPosture()).toBe(posture);
    }
  });

  it('lives beside the theme/onboarding keys, NOT inside the save bundle key (user preference, not save state)', () => {
    setPacingPosture('dramatic');
    expect(localStorage.getItem('gloryOfRome:pacingPosture')).toBe('dramatic');
    // The save bundle's own key is untouched by the setting.
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
  });

  it('falls back to \'balanced\' when the stored value is outside the enum (corrupted or future-version key)', () => {
    localStorage.setItem('gloryOfRome:pacingPosture', 'frenzied');
    expect(getPacingPosture()).toBe('balanced');
  });

  it('never throws and reads as \'balanced\' when localStorage.getItem throws (e.g. private mode SecurityError)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });

    expect(() => getPacingPosture()).not.toThrow();
    expect(getPacingPosture()).toBe('balanced');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => setPacingPosture('restrained')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// --- mock mode: the [Pacing] note lands offline ----------------------------

describe('mockRunNewTurn: the pacing judgment loop runs offline (4D.1)', () => {
  it('records exactly one "[Pacing]" gm_private note on the committed adjudication', async () => {
    const { entities, worldState } = getMockInitialState();
    const result = await mockRunNewTurn('Hold court', entities[0], 1, entities, worldState, [], '', 'A crisis.', SIM_STATE, [], []);
    const pacingNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Pacing]'));
    expect(pacingNotes).toHaveLength(1);
    // GM-private discipline (D4/D5): the judgment never reaches the
    // player-facing channels of the same turn.
    expect(result.headlines.some(h => h.includes('[Pacing]'))).toBe(false);
    expect(result.narration).not.toContain('[Pacing]');
  });

  it('emits ONE note per turn, never accumulating onto the shared mock constant across turns', async () => {
    const { entities, worldState } = getMockInitialState();
    const first = await mockRunNewTurn('Hold court', entities[0], 1, entities, worldState, [], '', 'A crisis.', SIM_STATE, [], []);
    const second = await mockRunNewTurn('Hold court again', entities[0], 2, entities, worldState, [], '', 'A crisis.', SIM_STATE, [], []);
    for (const result of [first, second]) {
      expect(result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Pacing]'))).toHaveLength(1);
      // The private-conversation push must not accumulate either - each
      // turn's adjudication owns a fresh gm_private array.
      expect(result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Secret Meeting]')).length).toBeLessThanOrEqual(1);
    }
  });
});
