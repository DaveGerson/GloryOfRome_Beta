/**
 * ai/core/ledger.ts
 *
 * The WEEKLY LEDGER (DESIGN_DECISIONS.md D46): the one place the engine
 * does arithmetic on the player's holdings between turns. Applied ONCE per
 * committed turn, as its own engine step AFTER the adjudication has been
 * applied and after every no-attempt boundary has run (ai/core/turn.ts,
 * ai/mocks.ts) - so its writes are engine-authored state, never a delta the
 * player-action gate (ai/core/playerBoundary.ts::playerOwnsDelta) could
 * mistake for an invented act.
 *
 * PLAYER ONLY, by design: D6 makes the player's treasury the systemic
 * resource and keeps other entities' bags narrative; running wages and
 * interest against every NPC purse would bankrupt characters whose economy
 * the model never finished writing, and produce ground truth the player
 * could never see anyway (D5). The adjudicator still prices NPC acts in
 * prose; the engine counts only what the player holds. Extending the ledger
 * to NPCs is an owner call (see D46's open questions).
 *
 * Pure and deterministic: no I/O, no randomness, no Date except the report
 * id suffix the rest of the engine already uses (ai/core/resources.ts). The
 * input roster is never mutated; a NEW array with a NEW player object comes
 * back.
 *
 * ORDER OF THE WEEK (each step may write lines):
 *   1. fold aliases in the player's bag (silent; GM note if anything folded)
 *   2. levies raised at the exchequer last week arrive as troops
 *   3. holdings yield (estates, ships, workshops)
 *   4. wages fall due (troops, guards, agents, legions); what the treasury
 *      cannot pay becomes back pay (`pay_arrears`)
 *   5. interest on debt is serviced from the treasury, or capitalised
 *   6. back pay bites: standing erodes; men desert once it is deep
 *   7. investigations regenerate toward the agents-driven cap
 *   8. standing drifts under the crisis as it stood this week
 * Income lands before wages on purpose: the estates pay the guards. Interest
 * comes after wages because a Roman paid his men before his banker.
 *
 * TUNING RATIONALE (the owner tunes from here):
 *   Runway. The presets (constants/baseScenario.ts) are seeded so that a
 *   careful player runs level or bleeds slowly - the Emperor's two estates
 *   nearly carry his household guard; the general's 15,000 lasts ~11 weeks
 *   against 150 mouths - and a careless one who buys loyalty by the
 *   ten-thousand feels the squeeze within a handful of weeks: an overdraft
 *   becomes debt (ai/core/resources.ts), debt compounds at DEBT_INTEREST_RATE
 *   a week, and creditors press past CREDITORS_PRESS_THRESHOLD. A ledger
 *   that bankrupts every destiny by Week III is a bug, not a feature.
 *   Teeth. Unpaid wages are not debt to a banker - soldiers do not lend.
 *   They become `pay_arrears`, erode `legion_support` every week they stand,
 *   and once they reach two weeks' pay a twentieth of the men slip away each
 *   week. An unpaid army melts; that is the historical fact this models.
 */

import { Entity, LedgerLine, Report, SimulationState } from '../../types';
import {
  clampToKind,
  classifyResourceKey,
  formatArabic,
  getResourceKind,
  listResourceKinds,
  normalizeResources,
  numericResource,
  ResourceBag,
} from './resourceRegistry';

// --- Tunables --------------------------------------------------------------------

/**
 * Weekly interest on `debt_denarii`. 5% a week is usurious against the
 * historical centesima usura (1% a MONTH) - deliberately: a debt that took
 * fourteen weeks to double would never be felt inside a reign. Tune down
 * if creditors bite too early in owner play.
 */
export const DEBT_INTEREST_RATE = 0.05;
/** Interest never rounds to nothing: a small debt still ticks. */
export const DEBT_INTEREST_MINIMUM = 50;
/**
 * Debt at or above this makes the creditors PRESS: a Report on crossing it,
 * and a standing flag in the adjudicator's ledger block so DEBT HAS TEETH
 * (ai/prompts/adjudication.ts) has something concrete to bite with. Two
 * weeks of an unpaid household guard, roughly - past that, someone owns you.
 */
export const CREDITORS_PRESS_THRESHOLD = 10_000;

/** `legion_support` lost per week while any back pay stands. */
export const ARREARS_SUPPORT_EROSION = 4;
/** ...and per week once the back pay exceeds a full week's wages. */
export const ARREARS_SUPPORT_EROSION_DEEP = 8;
/** Back pay at or beyond this many weeks' wages starts desertions. */
export const DESERTION_ARREARS_WEEKS = 2;
/** The share of unpaid troops and guards who desert per week of deep arrears. */
export const DESERTION_FRACTION = 0.05;

/** Every player may run this many investigations at once with no agents at all. */
export const INVESTIGATION_CAP_BASE = 2;
/** Each full set of this many agents raises the ceiling by one... */
export const AGENTS_PER_EXTRA_INVESTIGATION = 3;
/** ...up to this hard ceiling (the pips row stays legible at eight). */
export const INVESTIGATION_CAP_MAX = 8;
/** With at least this many agents an investigation regenerates every week; with fewer, only on the trickle. */
export const AGENTS_FOR_WEEKLY_REGEN = 3;
/** The agentless trickle: one investigation every this-many weeks (turn numbers divisible by it). */
export const INVESTIGATION_TRICKLE_WEEKS = 3;

/**
 * Standing drift under the crisis as it stood at the start of the week
 * (SimulationState is empire-macro and public, D5). Only standings the
 * player ALREADY holds drift - the ledger never creates a reputation out of
 * nothing. One or two points a week: felt over a month, never a cliff.
 */
export const STANDING_DRIFT: readonly { when: (sim: SimulationState) => boolean; key: string; delta: number; text: string }[] = [
  { when: sim => sim.military_status === 'Divided', key: 'legion_support', delta: -1, text: 'With the legions divided among themselves, your standing with them slips.' },
  { when: sim => sim.military_status === 'Rebellious', key: 'legion_support', delta: -2, text: 'With the legions in open rebellion, your standing with them bleeds.' },
  { when: sim => sim.plebeian_mood === 'Rioting', key: 'popular_support', delta: -2, text: 'With Rome rioting, the crowd forgets whom it cheered.' },
  { when: sim => sim.plebeian_mood === 'Rioting', key: 'legitimacy', delta: -1, text: 'Riots in the streets make every authority look thinner.' },
  { when: sim => sim.imperial_status === 'Contested', key: 'legitimacy', delta: -1, text: 'With the throne contested, your claim to rightful authority frays.' },
  { when: sim => sim.imperial_status === 'Vacant', key: 'legitimacy', delta: -2, text: 'With the throne vacant, no authority looks rightful for long.' },
  { when: sim => sim.senate_status === 'Deposed', key: 'senatorial_support', delta: -2, text: 'With the Senate deposed, its goodwill counts for less each week.' },
];

// --- Derived figures shared with the exchequer and the Assets tab -------------------------

/** The investigations ceiling the agents in the player's pay support. */
export function investigationCap(resources: ResourceBag): number {
  const agents = numericResource(resources, 'agents');
  return Math.min(INVESTIGATION_CAP_MAX, INVESTIGATION_CAP_BASE + Math.floor(agents / AGENTS_PER_EXTRA_INVESTIGATION));
}

export interface FlowItem {
  key: string;
  label: string;
  count: number;
  perUnit: number;
  total: number;
}

export interface WeeklyCoinFlow {
  income: FlowItem[];
  upkeep: FlowItem[];
  /** Interest the week will charge on the standing debt (0 with no debt). */
  interest: number;
  incomeTotal: number;
  upkeepTotal: number;
  /** income - upkeep - interest. */
  net: number;
}

/**
 * The coin flows the NEXT week will book against a bag as it stands: yields,
 * wages, interest. Pure; the Assets tab's projection and the adjudicator's
 * ledger block read this so both agree with the ledger to the denarius.
 */
export function projectWeeklyCoinFlow(resources: ResourceBag): WeeklyCoinFlow {
  const income: FlowItem[] = [];
  const upkeep: FlowItem[] = [];
  for (const kind of listResourceKinds()) {
    const count = numericResource(resources, kind.id);
    if (count <= 0) continue;
    if (kind.weekly?.income) {
      income.push({ key: kind.id, label: kind.label, count, perUnit: kind.weekly.income, total: count * kind.weekly.income });
    }
    if (kind.weekly?.upkeep) {
      upkeep.push({ key: kind.id, label: kind.label, count, perUnit: kind.weekly.upkeep, total: count * kind.weekly.upkeep });
    }
  }
  const interest = weeklyInterest(numericResource(resources, 'debt_denarii'));
  const incomeTotal = income.reduce((sum, item) => sum + item.total, 0);
  const upkeepTotal = upkeep.reduce((sum, item) => sum + item.total, 0);
  return { income, upkeep, interest, incomeTotal, upkeepTotal, net: incomeTotal - upkeepTotal - interest };
}

/** Interest one week charges on a debt; 0 for no debt. */
export function weeklyInterest(debt: number): number {
  if (debt <= 0) return 0;
  return Math.max(DEBT_INTEREST_MINIMUM, Math.round(debt * DEBT_INTEREST_RATE));
}

/**
 * How many whole weeks the treasury lasts at a given net flow: Infinity when
 * the flow is level or positive, 0 when already empty against a drain.
 */
export function runwayWeeks(denarii: number, net: number): number {
  if (net >= 0) return Infinity;
  return Math.max(0, Math.floor(denarii / -net));
}

/** True once the debt is large enough that creditors press (a standing pressure the adjudicator is told about). */
export function creditorsPress(resources: ResourceBag): boolean {
  return numericResource(resources, 'debt_denarii') >= CREDITORS_PRESS_THRESHOLD;
}

// --- The weekly pass --------------------------------------------------------------------

export interface WeeklyLedgerInput {
  entities: Entity[];
  playerId: string;
  /** The App's authoritative turn counter for the week being closed. */
  turnNumber: number;
  /** The crisis as it stood at the start of the week (standing drift reads it). */
  simulationState: SimulationState;
}

export interface WeeklyLedgerResult {
  /** A new roster: every non-player entity by reference, the player replaced. */
  entities: Entity[];
  lines: LedgerLine[];
  /** Player-facing notices for the events a line alone undersells (arrears, desertion, creditors pressing). */
  reports: Report[];
  /** GM-console notes ([Ledger] ...): the week's net, and anything folded or clamped. */
  gmNotes: string[];
}

function makeReportId(turnNumber: number, suffix: string): string {
  return `report_${turnNumber}_${Date.now()}_ledger_${suffix}`;
}

/** Wages an item in the flow reads as prose: "150 guards and 3 agents". */
function describeForces(items: FlowItem[]): string {
  const parts = items.map(item => `${formatArabic(item.count)} ${item.label.toLowerCase()}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function itemise(items: FlowItem[]): string {
  return items.map(item => `${item.key} ${item.count} x ${item.perUnit}`).join(', ');
}

/**
 * Closes the week's books for the player (see the module doc for the order
 * and the rationale). Returns the roster with the player replaced by a fresh
 * object; every line and report describes only the player's own holdings.
 */
export function applyWeeklyLedger(input: WeeklyLedgerInput): WeeklyLedgerResult {
  const { entities, playerId, turnNumber, simulationState } = input;
  const index = entities.findIndex(entity => entity.entity_id === playerId);
  if (index === -1) return { entities, lines: [], reports: [], gmNotes: [] };

  const player = entities[index];
  const lines: LedgerLine[] = [];
  const reports: Report[] = [];
  const gmNotes: string[] = [];

  // 1. Fold aliases (lazy legacy normalisation, D46 save-compat).
  const normalized = normalizeResources(player.resources);
  const bag: ResourceBag = normalized.resources;
  if (normalized.folded.length > 0) {
    gmNotes.push(`[Ledger] Folded ${normalized.folded.map(f => `'${f.from}' -> '${f.to}'`).join(', ')} in the player's holdings.`);
  }
  const get = (key: string) => numericResource(bag, key);
  const set = (key: string, value: number) => {
    const kind = getResourceKind(key) ?? classifyResourceKey(key);
    bag[key] = clampToKind(kind, Math.round(value));
  };

  // 2. Levies arrive.
  const levies = get('levy_pending');
  if (levies > 0) {
    set('troops', get('troops') + levies);
    delete bag.levy_pending;
    lines.push({
      kind: 'levy', key: 'troops', amount: levies,
      text: `The levies muster: ${formatArabic(levies)} recruits join your troops.`,
      detail: `levy_pending ${levies} -> troops`,
    });
  }

  // 3. Yields.
  const flow = projectWeeklyCoinFlow(bag);
  if (flow.incomeTotal > 0) {
    set('denarii', get('denarii') + flow.incomeTotal);
    const holdings = flow.income.map(item => `${formatArabic(item.count)} ${item.label.toLowerCase()}`).join(' and ');
    lines.push({
      kind: 'income', key: 'denarii', amount: flow.incomeTotal,
      text: `Your ${holdings} return ${formatArabic(flow.incomeTotal)} denarii.`,
      detail: itemise(flow.income),
    });
  }

  // 4. Wages.
  if (flow.upkeepTotal > 0) {
    const treasury = get('denarii');
    const paid = Math.min(treasury, flow.upkeepTotal);
    const short = flow.upkeepTotal - paid;
    if (paid > 0) {
      set('denarii', treasury - paid);
      lines.push({
        kind: 'upkeep', key: 'denarii', amount: -paid,
        text: `Your treasury pays out ${formatArabic(paid)} denarii - the week's wages for ${describeForces(flow.upkeep)}.`,
        detail: itemise(flow.upkeep),
      });
    }
    if (short > 0) {
      set('pay_arrears', get('pay_arrears') + short);
      lines.push({
        kind: 'arrears', key: 'pay_arrears', amount: short,
        text: `The treasury could not meet ${formatArabic(short)} denarii of wages; your men are owed it.`,
        detail: `wages due ${flow.upkeepTotal}, paid ${paid}`,
      });
      reports.push({
        id: makeReportId(turnNumber, 'arrears'),
        turn: turnNumber,
        source: 'messenger',
        about: playerId,
        claim: `Your paymaster reports ${formatArabic(short)} denarii of wages unpaid this week; the men are owed ${formatArabic(get('pay_arrears'))} in all, and they count.`,
        credibility: 1.0, // the player's own paymaster (D6/D5)
      });
    }
  }

  // 5. Interest.
  const debtBefore = get('debt_denarii');
  if (debtBefore > 0) {
    const interest = weeklyInterest(debtBefore);
    const treasury = get('denarii');
    if (treasury >= interest) {
      set('denarii', treasury - interest);
      lines.push({
        kind: 'interest', key: 'denarii', amount: -interest,
        text: `Your creditors take ${formatArabic(interest)} denarii in interest on the ${formatArabic(debtBefore)} you owe.`,
        detail: `${Math.round(DEBT_INTEREST_RATE * 100)}% of ${debtBefore}, minimum ${DEBT_INTEREST_MINIMUM}`,
      });
    } else {
      set('debt_denarii', debtBefore + interest);
      lines.push({
        kind: 'interest', key: 'debt_denarii', amount: interest,
        text: `Interest of ${formatArabic(interest)} denarii goes unpaid and is added to what you owe; your debt stands at ${formatArabic(get('debt_denarii'))}.`,
        detail: `${Math.round(DEBT_INTEREST_RATE * 100)}% of ${debtBefore} capitalised`,
      });
    }
    if (debtBefore < CREDITORS_PRESS_THRESHOLD && get('debt_denarii') >= CREDITORS_PRESS_THRESHOLD) {
      reports.push({
        id: makeReportId(turnNumber, 'creditors'),
        turn: turnNumber,
        source: 'merchant',
        about: playerId,
        claim: `Your debt has passed ${formatArabic(CREDITORS_PRESS_THRESHOLD)} denarii. Your creditors are no longer patient; expect them at your door.`,
        credibility: 1.0,
      });
    }
  }

  // 6. Back pay bites.
  const arrears = get('pay_arrears');
  if (arrears > 0 && flow.upkeepTotal > 0) {
    const deep = arrears >= flow.upkeepTotal;
    if (typeof bag.legion_support === 'number') {
      const erosion = deep ? ARREARS_SUPPORT_EROSION_DEEP : ARREARS_SUPPORT_EROSION;
      const before = get('legion_support');
      set('legion_support', before - erosion);
      const applied = get('legion_support') - before;
      if (applied !== 0) {
        lines.push({
          kind: 'drift', key: 'legion_support', amount: applied,
          text: deep
            ? 'Weeks of unpaid wages poison the camps; the legions hear of it and think less of you.'
            : 'Unpaid wages sour your own men, and word of it travels to the legions.',
          detail: `arrears ${arrears} vs weekly wages ${flow.upkeepTotal}`,
        });
      }
    }
    if (arrears >= flow.upkeepTotal * DESERTION_ARREARS_WEEKS) {
      for (const key of ['troops', 'guards'] as const) {
        const count = get(key);
        if (count <= 0) continue;
        const deserters = Math.max(1, Math.ceil(count * DESERTION_FRACTION));
        set(key, count - deserters);
        lines.push({
          kind: 'desertion', key, amount: -deserters,
          text: `Unpaid, ${formatArabic(deserters)} of your ${key} slip away in the night.`,
          detail: `${Math.round(DESERTION_FRACTION * 100)}% of ${count}`,
        });
      }
      reports.push({
        id: makeReportId(turnNumber, 'desertion'),
        turn: turnNumber,
        source: 'messenger',
        about: playerId,
        claim: 'Your centurions report men missing at the morning count. The ones who stayed ask, openly, when they will be paid.',
        credibility: 1.0,
      });
    }
  }

  // 7. Investigations regenerate.
  const agents = get('agents');
  if ('investigations' in bag || agents > 0) {
    const cap = investigationCap(bag);
    const held = get('investigations');
    const weekly = agents >= AGENTS_FOR_WEEKLY_REGEN;
    const trickle = turnNumber > 0 && turnNumber % INVESTIGATION_TRICKLE_WEEKS === 0;
    if (held < cap && (weekly || trickle)) {
      set('investigations', held + 1);
      lines.push({
        kind: 'regen', key: 'investigations', amount: 1,
        text: weekly
          ? 'Your agents open a fresh line of inquiry; you may pursue one more investigation.'
          : 'A quiet contact resurfaces; you may pursue one more investigation.',
        detail: `cap ${cap} (agents ${agents}), held ${held}`,
      });
    }
  }

  // 8. Standing drifts under the crisis.
  for (const rule of STANDING_DRIFT) {
    if (!rule.when(simulationState)) continue;
    if (!(rule.key in bag) || typeof bag[rule.key] !== 'number') continue;
    const before = get(rule.key);
    set(rule.key, before + rule.delta);
    const applied = get(rule.key) - before;
    if (applied === 0) continue;
    lines.push({ kind: 'drift', key: rule.key, amount: applied, text: rule.text, detail: `${rule.key} ${before} -> ${get(rule.key)}` });
  }

  if (lines.length > 0) {
    const net = lines.filter(line => line.key === 'denarii').reduce((sum, line) => sum + line.amount, 0);
    gmNotes.push(`[Ledger] Week closed: net ${net >= 0 ? '+' : ''}${formatArabic(net)} denarii across ${lines.length} line${lines.length === 1 ? '' : 's'}; treasury ${formatArabic(get('denarii'))}, debt ${formatArabic(get('debt_denarii'))}, wages owed ${formatArabic(get('pay_arrears'))}.`);
  }

  const updatedPlayer: Entity = { ...player, resources: bag };
  const updatedEntities = entities.map((entity, i) => (i === index ? updatedPlayer : entity));
  return { entities: updatedEntities, lines, reports, gmNotes };
}
