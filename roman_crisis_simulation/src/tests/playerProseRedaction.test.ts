/**
 * tests/playerProseRedaction.test.ts
 *
 * SHIPPING BLOCKER (adversarial review): on a no-attempt turn the PROSE
 * classifier in ai/core/playerBoundary.ts rejected almost any sentence that
 * merely NAMED the player, and a rejection threw - killing the whole turn
 * after 4-8 provider calls, with a retry re-rolling the same nondeterministic
 * model against the same prompt. The canonical DEBT HAS TEETH prose the
 * adjudication prompt itself solicits ("Mounting arrears leave <player>
 * increasingly beholden to <creditor>") was among the rejects.
 *
 * The design this file pins:
 *  - A prose leak is a NARRATIVE BLEMISH: it is REDACTED from every
 *    player-visible surface and recorded GM-side; the turn still commits.
 *  - A delta/entityAction-id/remove_entities leak is a MECHANICAL VIOLATION:
 *    the structural gates keep throwing (tests/playerBoundary.test.ts).
 *  - The allowed no-attempt predicate set is wide enough that legitimate
 *    receptive/stative prose about the player redacts NOTHING.
 */
import { describe, expect, it } from 'vitest';
import {
  containsInventedPlayerProse,
  playerProseRedactionNotes,
  redactInventedPlayerProse,
  redactInventedPlayerProseFromValue,
} from '../ai/core/playerBoundary';
import type { Adjudication, Entity } from '../types';

const player: Pick<Entity, 'entity_id' | 'name' | 'position'> = {
  entity_id: 'gaius_valerius',
  name: 'Gaius Valerius Maximus',
  position: 'Emperor',
};

/**
 * The orchestrator's reproduced 10-row probe (rows 1-10) followed by 30 more
 * strings in the register ai/prompts/adjudication.ts actually solicits on a
 * no-attempt turn - headlines, delta `reason` text, and NPC entityAction
 * `notes`. Every row is legitimate no-attempt prose: purely receptive,
 * stative, or third-party, with the player named only as a circumstance,
 * possessor, or object. NONE may be redacted.
 */
const LEGITIMATE_NO_ATTEMPT_PROSE = [
  // --- the reproduced probe -------------------------------------------
  'You wait.',
  'You do nothing this week.',
  'You take no action.',
  'You stay silent.',
  'You receive a letter from Titus.',
  'Your creditors grow restless.',
  'Mounting arrears leave Gaius Valerius Maximus increasingly beholden to Titus Vinius.',
  'A rumor spreads that Gaius Valerius Maximus is ill and unable to attend.',
  'Titus Vinius dispatches a collector to the villa owned by Gaius Valerius Maximus.',
  'The Senate debates the grain dole without you.',
  // --- further realistic no-attempt adjudication prose ------------------
  'Creditors circle the Palatine.',
  'Mounting arrears leave you beholden to Titus Vinius.',
  'Your debts to Titus Vinius grow heavier.',
  'Titus Vinius grows impatient with Gaius Valerius Maximus.',
  'The collector waits at your gate.',
  'Word reaches the Curia that the Emperor is short of coin.',
  'You remain in the villa, unvisited.',
  'Nothing is asked of you this week.',
  'Your name is spoken with less warmth in the Curia.',
  'The legions grow uneasy while you keep to the palace.',
  'Titus Vinius sends a collector to the house of Gaius Valerius Maximus.',
  'The Praetorians are said to distrust the Emperor.',
  'Rome hears nothing from the palace.',
  'The debt to Titus Vinius stands unpaid.',
  'You are uneasy about the silence from the Praetorian camp.',
  'You have grown poorer this season.',
  'Your position remains precarious.',
  'The Emperor is owed nothing this week.',
  'Titus Vinius grows bolder now that the Emperor is silent.',
  'Your grip on the Senate weakens.',
  'The city talks of you.',
  'You feel the weight of the debt.',
  'You know the collector will return.',
  'Your household lacks the coin to pay.',
  'A collector appointed by Titus Vinius arrives at the villa of Gaius Valerius Maximus.',
  'The Senate meets and Gaius Valerius Maximus is not summoned.',
  'Debt collectors are seen near the villa owned by Gaius Valerius Maximus.',
  'Word of the arrears reaches you before the market closes.',
  'The Praetorians remain loyal to the Emperor for now.',
  'You are still without an answer from Titus Vinius.',
];

/** Genuine invented player conduct - every row MUST be redacted. */
const INVENTED_PLAYER_PROSE = [
  'You seize the treasury and execute the tribune.',
  'Gaius Valerius Maximus dispatches agents to count tomorrow\'s votes.',
  'You summon the Senate at dawn.',
  // RETIRED (Task 2, disposition map row 3/mechanism row "possessedPhrasePredicate"):
  // 'Your guards arrest the envoy.' tested possessive-phrase classification,
  // deleted by the declaration-primary rewrite - it never opens on a
  // sentence-initial player subject, so the flat tripwire is silent on it by
  // design; see tests/playerBoundaryContract.test.ts's "declaration-territory
  // prose" cases and the B7 gap discussion in ai/core/playerBoundary.ts.
  'The Emperor orders the granary burned.',
  'You pay Titus Vinius in full.',
];

function neutralAdjudication(overrides: Partial<Adjudication> = {}): Adjudication {
  return {
    turn: 7,
    entityActions: [],
    deltas: [],
    headlines: [],
    gm_private: [],
    ...overrides,
  };
}

describe('no-attempt prose classifier - false-positive corpus', () => {
  it.each(LEGITIMATE_NO_ATTEMPT_PROSE)(
    'treats legitimate no-attempt prose as clean: %s',
    prose => {
      expect(containsInventedPlayerProse(prose, player)).toBe(false);
    },
  );

  it.each(INVENTED_PLAYER_PROSE)('still classifies invented player conduct: %s', prose => {
    expect(containsInventedPlayerProse(prose, player)).toBe(true);
  });

  it('redacts nothing from an adjudication built entirely from legitimate prose', () => {
    const adjudication = neutralAdjudication({
      headlines: [...LEGITIMATE_NO_ATTEMPT_PROSE],
      deltas: LEGITIMATE_NO_ATTEMPT_PROSE.map((reason, index) => ({
        type: 'resource' as const, key: `npc_${index}:denarii`, delta: 1, reason,
      })),
      entityActions: LEGITIMATE_NO_ATTEMPT_PROSE.map((notes, index) => ({
        id: `npc_${index}`, intent: 'intrigue' as const, target: null, notes,
      })),
    });
    const before = structuredClone(adjudication);

    const redactions = redactInventedPlayerProse(adjudication, player, false);

    expect(redactions).toEqual([]);
    expect(adjudication).toEqual(before);
  });
});

describe('prose redaction replaces the player-visible surface instead of failing the turn', () => {
  const invented = 'You seize the treasury and execute the tribune.';

  it('drops an offending headline and records the original GM-side', () => {
    const adjudication = neutralAdjudication({
      headlines: ['The week advances.', invented],
    });

    const redactions = redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.headlines).toEqual(['The week advances.']);
    expect(redactions).toEqual([
      expect.objectContaining({ surface: 'headlines[1]', original: invented }),
    ]);
  });

  it('keeps the clean sentences of a mixed headline and drops only the offending one', () => {
    const adjudication = neutralAdjudication({
      headlines: [`Creditors circle the Palatine. ${invented}`],
    });

    redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.headlines).toEqual(['Creditors circle the Palatine.']);
    expect(adjudication.headlines[0]).not.toContain('seize');
  });

  it('replaces an offending delta reason with a neutral placeholder, keeping the delta itself', () => {
    const adjudication = neutralAdjudication({
      deltas: [{ type: 'relation', key: 'npc_a:npc_b:trust_level', delta: -1, reason: invented }],
    });

    const redactions = redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.deltas).toHaveLength(1);
    expect(adjudication.deltas[0].key).toBe('npc_a:npc_b:trust_level');
    expect(adjudication.deltas[0].delta).toBe(-1);
    expect(adjudication.deltas[0].reason).not.toContain('seize');
    expect(adjudication.deltas[0].reason.length).toBeGreaterThan(0);
    expect(redactions).toEqual([
      expect.objectContaining({ surface: 'deltas[0].reason', original: invented }),
    ]);
  });

  it('replaces offending entityAction notes with a neutral placeholder', () => {
    const adjudication = neutralAdjudication({
      entityActions: [{ id: 'npc_a', intent: 'intrigue', target: null, notes: invented }],
    });

    redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.entityActions[0].id).toBe('npc_a');
    expect(adjudication.entityActions[0].notes).not.toContain('seize');
    expect(adjudication.entityActions[0].notes.length).toBeGreaterThan(0);
  });

  it('never rewrites a scheme reason - it is private JSON the engine parses', () => {
    const schemeJson = JSON.stringify({ name: 'A hidden design', overall_goal: 'Gain leverage', steps: [] });
    const adjudication = neutralAdjudication({
      deltas: [{ type: 'scheme', key: 'npc_a', delta: 0, reason: schemeJson }],
    });

    redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.deltas[0].reason).toBe(schemeJson);
  });

  it('never rewrites a faction reason - it is an entity id, an identity slot the structural gates own', () => {
    const adjudication = neutralAdjudication({
      deltas: [{ type: 'faction', key: 'npc_a', delta: 0, reason: 'gaius_valerius' }],
    });

    const redactions = redactInventedPlayerProse(adjudication, player, false);

    expect(adjudication.deltas[0].reason).toBe('gaius_valerius');
    expect(redactions).toEqual([]);
  });

  it('keeps an add_region payload parseable while redacting the prose inside it', () => {
    const adjudication = neutralAdjudication({
      deltas: [{
        type: 'add_region',
        key: 'Imperial Enclave',
        delta: 0,
        reason: JSON.stringify({
          stability: 'Stable',
          controlling_faction: null,
          current_events: [invented, 'Masons finish the outer wall.'],
        }),
      }],
    });

    redactInventedPlayerProse(adjudication, player, false);

    const payload = JSON.parse(adjudication.deltas[0].reason) as {
      stability: string; controlling_faction: string | null; current_events: string[];
    };
    expect(payload.stability).toBe('Stable');
    expect(payload.current_events).toEqual(['Masons finish the outer wall.']);
  });

  it('leaves everything untouched when an observable attempt exists', () => {
    const adjudication = neutralAdjudication({ headlines: [invented] });

    const redactions = redactInventedPlayerProse(adjudication, player, true);

    expect(redactions).toEqual([]);
    expect(adjudication.headlines).toEqual([invented]);
  });

  it('redacts a player-visible value surface without mutating the input', () => {
    const state = { imperial_status: 'Stable', major_ongoing_crisis: invented };

    const { value, redactions } = redactInventedPlayerProseFromValue(state, player, false, 'simulationState');

    expect(state.major_ongoing_crisis).toBe(invented);
    expect(value.major_ongoing_crisis).toBe('');
    expect(redactions).toEqual([
      expect.objectContaining({ surface: 'simulationState.major_ongoing_crisis', original: invented }),
    ]);
  });

  it('builds a tagged GM note carrying the removed text - gm_private is GM-console-only', () => {
    const notes = playerProseRedactionNotes([{ surface: 'headlines[0]', original: invented }]);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('[Boundary]');
    expect(notes[0]).toContain('headlines[0]');
    expect(notes[0]).toContain(invented);
  });
});
