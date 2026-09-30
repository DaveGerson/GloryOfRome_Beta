/**
 * ai/core/groundTruth.ts
 *
 * DESIGN_DECISIONS.md D47 - "investigations reach for the truth; two hidden
 * rolls decide how right and how much". The investigation family used to
 * hand the model a name and a personality and ask it to invent plausible
 * secrets, so no roll could ever return the truth and the engine could not
 * tell its agents' true words from their false ones (D11). This module is
 * the code-side half of the fix, run BEFORE any prompt is built:
 *
 *  1. `groundTruthPool` - the candidate truths per kind, read off the
 *     target's real record (beliefs, secrets, active scheme, situation).
 *  2. `planInvestigation` (and `planFromPool`, its entry point for a pool
 *     with no target Entity) - fidelity picks how many of them, or how much of
 *     one, reaches the prompt; accuracy decides whether they are reported
 *     faithfully, with exactly one distortion, or not at all (a false
 *     account carries NO truth into the prompt). The plan records, per
 *     finding, whether it is true - the code knows, not the model.
 *  3. `investigationLedgerEntries` - one GM-private truth-ledger entry per
 *     finding the player received (D11), with the rolls behind it.
 *  4. The D28 scheme NATURE: `planSchemeNature` reads the accumulated clue
 *     records off the ledger and decides whether the nature the clues add up
 *     to is the true design, a garbled one, or a false one.
 *  5. `deriveLeverageTruth` - the truth behind each piece of blackmail the
 *     player filed from a bought secret, for the adjudicator's GM-private
 *     context.
 *  6. Occurrences - the Events tab's "Who is behind it?" and "Who gains?":
 *     `occurrenceGrounding` reads the truth off the turn's GM-private
 *     attribution record, and `planFromPool` (the same scoping and shaping,
 *     over a pool with no target Entity) plans what reaches the prompt.
 *
 * HARD INVARIANT: `secret_truth` is never an input - nothing here reads it
 * (tests/groundedIntel.test.tsx proves it cannot reach an intelligence prompt).
 * Everything this module returns is GM-private (D11) except the texts the
 * player already received; it must never be handed to a player-facing
 * surface. Pure: no AI calls, no React, no mutation of its inputs.
 */

import type {
    Entity,
    GroundedOccurrenceQuestion,
    HeadlineAttribution,
    IntelAccuracy,
    IntelDistortion,
    IntelFidelity,
    InvestigationRolls,
    InvestigationTruth,
    OccurrenceTruth,
    TruthLedgerEntry,
    TurnHistoryEntry,
} from '../../types';
import type { Rng } from './resolution';
import { secretAffiliationsOf } from './affiliations';
import { REDACTED_PLAYER_PROSE_PLACEHOLDER } from './playerBoundary';

/** The investigation-family aspects that reach for ground truth (D47). */
export type GroundTruthKind = 'beliefs' | 'secrets' | 'scheme' | 'deep_analysis';

/**
 * Where one candidate truth comes from on the target's record. A new source
 * joins by adding a member here and a line in `groundTruthPool` (the
 * orchestrator's D49 secret affiliations join the 'secrets' pool this way).
 */
export type GroundTruthSource =
    | 'belief'
    | 'secret'
    | 'secret_affiliation'
    | 'scheme_goal'
    | 'scheme_step'
    | 'situation'
    | 'aim'
    | 'ambition';

/** One candidate truth about the target. */
export interface GroundTruthItem {
    source: GroundTruthSource;
    text: string;
}

function nonBlank(values: readonly unknown[] | undefined): string[] {
    return (values ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

/**
 * The candidate truths an investigation of `kind` may reach on `target`,
 * read straight off its record. Deliberately never reads `secret_truth` (the
 * mortality pipeline's hidden-survivor record, D3) - no investigation can
 * reach it. The scheme's NAME is not a clue candidate: a clue is never the
 * scheme's title (D28); only the nature, earned across clues, may name it
 * (see `planSchemeNature`). A deep analysis reads the target's situation and
 * aims - never its scheme, whose nature only the clue trail may earn (D28).
 */
export function groundTruthPool(target: Entity, kind: GroundTruthKind): GroundTruthItem[] {
    switch (kind) {
        case 'beliefs':
            return nonBlank(target.beliefs).map(text => ({ source: 'belief', text }));
        case 'secrets':
            return [
                ...nonBlank(target.secrets).map(text => ({ source: 'secret' as const, text })),
                // A tie kept secret (D49) is a secret like any other: an
                // investigation may reach it, at its rolled fidelity and
                // accuracy (D47). Openly professed ties are public knowledge
                // and never a finding.
                ...secretAffiliationsOf(target).map(tie => ({
                    source: 'secret_affiliation' as const,
                    text: `Keeps a secret tie to ${tie.name}${tie.kind === 'other' ? '' : ` (a ${tie.kind})`}.`,
                })),
            ];
        case 'scheme': {
            const scheme = target.active_scheme;
            if (!scheme) return [];
            return [
                ...nonBlank([scheme.overall_goal]).map(text => ({ source: 'scheme_goal' as const, text })),
                ...nonBlank((scheme.steps ?? []).map(step => step?.objective)).map(text => ({ source: 'scheme_step' as const, text })),
            ];
        }
        case 'deep_analysis':
            return [
                ...nonBlank([target.current_state_narrative]).map(text => ({ source: 'situation' as const, text })),
                ...nonBlank(target.short_term_goals).map(text => ({ source: 'aim' as const, text })),
                ...nonBlank(target.long_term_ambitions).map(text => ({ source: 'ambition' as const, text })),
            ];
    }
}

// --- Scoping and shaping (D47) --------------------------------------------

/**
 * How many findings each fidelity band reaches for an itemised kind
 * (beliefs, secrets, the facts behind an assessment): a fragment reaches one
 * item and only part of its words; a partial reading two whole items; a
 * fuller one three. A scheme buy is scoped separately (see `scopeScheme`):
 * it never carries more than one step or a fragment of the goal (D28).
 */
export const FIDELITY_REACH: Record<IntelFidelity, number> = {
    fragment: 1,
    partial: 2,
    fuller: 3,
};

/**
 * The share of false readings (on a figure who does have something of the
 * kind on record) that come back as "nothing to find" rather than as
 * invented findings. An honest nothing is always true; this keeps an empty
 * report from being proof of a clean record, as matching counts keep a list
 * from betraying its accuracy (D26: the window never tells the player which
 * of their agents' words are false).
 */
export const FALSE_NOTHING_SHARE = 1 / 3;

/**
 * The truth a scheme clue carries when the target pursues no design at all:
 * an honest "nothing afoot" is a finding too, and the nature the clues add up
 * to must be able to follow from it.
 */
export const NO_DESIGN_TRUTH = 'There is no design: they are plotting nothing of note.';

/** One finding the prompt will ask for, with the truth the code knows about it. */
export interface PlannedFinding {
    /** The truth handed to the model for this finding - null on a false finding: no truth ever reaches the prompt of a false account. */
    truth: string | null;
    /** True when only part of the finding was reached (a word fragment of a truth, or a sketchy false one). */
    fragmentary: boolean;
    /** GM-PRIVATE: the whole ground-truth item behind the finding - absent on a false one. */
    groundTruth?: string;
    standing: IntelAccuracy;
    /** Garbled findings only: the one distortion the prompt asks for. */
    distortion?: IntelDistortion;
}

/**
 * The code-side plan a grounded prompt is built from, over any pool of truths
 * (GM-PRIVATE until the model's account comes back): what an investigation
 * plans for its target (`InvestigationPlan`), and what an occurrence question
 * plans from the turn's attribution record (`planFromPool`).
 */
export interface PoolPlan {
    /**
     * The accuracy the prompt is shaped by: the rolled band, except that an
     * empty record is reported honestly whatever the roll, and a false
     * "nothing to find" is shaped as the honest one it imitates.
     */
    accuracy: IntelAccuracy;
    fidelity: IntelFidelity;
    findings: PlannedFinding[];
    /**
     * GM-PRIVATE, set only on a false "nothing to find" (see
     * `FALSE_NOTHING_SHARE`): the truths the account came back without. The
     * prompt is shaped exactly as an honest nothing; the ledger records it as
     * false against these.
     */
    withheld?: string[];
}

/** The code-side plan an investigation prompt is built from (GM-PRIVATE until the model's account comes back). */
export interface InvestigationPlan extends PoolPlan {
    kind: GroundTruthKind;
    /** Scheme only: the name of the design standing now (never in any prompt - recorded so a later nature can spot a former design). */
    schemeName?: string;
}

/** A contiguous run of about half the words of `text` - "a fragment of it" (D47). A one-word text has no smaller fragment. */
export function fragmentOf(text: string, rng: Rng): string {
    const words = text.trim().split(/\s+/);
    const length = Math.max(1, Math.ceil(words.length / 2));
    const start = Math.floor(rng() * (words.length - length + 1));
    return words.slice(start, start + length).join(' ');
}

/** Fisher-Yates over a copy, drawing from the investigation's seeded generator. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function pick<T>(items: readonly T[], rng: Rng): T {
    return items[Math.floor(rng() * items.length)];
}

function truthful(text: string, fragmentary: boolean, rng: Rng): PlannedFinding {
    return { truth: fragmentary ? fragmentOf(text, rng) : text, fragmentary, groundTruth: text, standing: 'true' };
}

/**
 * The one truth a scheme buy may carry (D28 - "a single buy never carries
 * the whole plan"): a fragment reaches part of one step; a partial reading
 * one whole step; a fuller one a fragment of the goal itself - the WHY, the
 * closest a single buy comes to the nature, and still never the whole of it.
 * With no steps (or no goal) on record, the other half stands in.
 */
function scopeScheme(pool: GroundTruthItem[], fidelity: IntelFidelity, rng: Rng): PlannedFinding | null {
    const steps = pool.filter(item => item.source === 'scheme_step').map(item => item.text);
    const goal = pool.find(item => item.source === 'scheme_goal')?.text;
    const stepFinding = (whole: boolean) => steps.length > 0 ? truthful(pick(steps, rng), !whole, rng) : null;
    const goalFinding = () => goal ? truthful(goal, true, rng) : null;
    switch (fidelity) {
        case 'fragment': return stepFinding(false) ?? goalFinding();
        case 'partial': return stepFinding(true) ?? goalFinding();
        case 'fuller': return goalFinding() ?? stepFinding(true);
    }
}

/** Fidelity's half of an itemised plan: FIDELITY_REACH items drawn from the pool, a fragment reaching only part of its one item's words. */
function scopeItems(pool: readonly string[], fidelity: IntelFidelity, rng: Rng): PlannedFinding[] {
    return shuffled(pool, rng).slice(0, FIDELITY_REACH[fidelity]).map(text => truthful(text, fidelity === 'fragment', rng));
}

/** Both distortions a garbled finding may carry, in draw order (see `shapeByAccuracy`). */
const EVERY_DISTORTION: readonly IntelDistortion[] = ['element_changed', 'misattributed'];

/**
 * Accuracy's half of every plan (D47), over the truths fidelity reached:
 *  - true: the reached truths, reported as reached;
 *  - garbled: the reached truths, exactly one of them marked for one
 *    distortion drawn from `distortions` (which one, and how, recorded here -
 *    the code knows);
 *  - false: NO truth at all - as many findings as the truth would have
 *    yielded, as whole or as fragmentary (so the count never betrays the
 *    accuracy), each to be invented plausibly from what is publicly known;
 *    or, for FALSE_NOTHING_SHARE of false readings, a false "nothing to
 *    find", shaped exactly as the honest one.
 * Nothing reached yields the honest nothing whatever the roll: no findings,
 * or - when `nothingTruth` names what "nothing" is itself the truth of (a
 * scheme's "there is no design") - one finding carrying it.
 */
function shapeByAccuracy(
    reached: PlannedFinding[],
    rolled: { accuracy: IntelAccuracy; fidelity: IntelFidelity },
    rng: Rng,
    options: { nothingTruth?: string; distortions?: readonly IntelDistortion[] } = {},
): PoolPlan {
    const { fidelity } = rolled;
    const { nothingTruth, distortions = EVERY_DISTORTION } = options;

    if (reached.length === 0) {
        // Nothing of the kind is on record: reported honestly, whatever the
        // roll. "Nothing to find" must never depend on the accuracy roll, or a
        // list on a figure with nothing on record would mark itself false.
        const findings: PlannedFinding[] = nothingTruth
            ? [{ truth: nothingTruth, fragmentary: false, groundTruth: nothingTruth, standing: 'true' }]
            : [];
        return { accuracy: 'true', fidelity, findings };
    }

    if (rolled.accuracy === 'false') {
        const withheld = reached.map(finding => finding.groundTruth).filter((fact): fact is string => fact !== undefined);
        // Now and then the misled agent comes back with nothing at all, so an
        // empty report is not proof of a clean record either.
        if (rng() < FALSE_NOTHING_SHARE) {
            return nothingTruth
                ? { accuracy: 'true', fidelity, findings: [{ truth: nothingTruth, fragmentary: false, groundTruth: withheld.join(' | '), standing: 'false' }] }
                : { accuracy: 'true', fidelity, findings: [], withheld };
        }
        // Otherwise the falsehoods come back looking exactly like the truth
        // would have: as many findings as it would have yielded, as whole or
        // as fragmentary - the count never tells the player which they hold.
        const findings = reached.map((finding): PlannedFinding => ({
            truth: null,
            fragmentary: finding.fragmentary,
            standing: 'false',
        }));
        return { accuracy: 'false', fidelity, findings };
    }
    const accuracy = rolled.accuracy;

    if (accuracy === 'garbled') {
        const index = Math.floor(rng() * reached.length);
        const distortion = distortions[Math.floor(rng() * distortions.length)];
        reached = reached.map((finding, i) => i === index ? { ...finding, standing: 'garbled', distortion } : finding);
    }
    return { accuracy, fidelity, findings: reached };
}

/**
 * Scopes the target's ground truth for one investigation and shapes it by
 * the rolled accuracy (D47). Fidelity picks what reaches the prompt
 * (`scopeItems`, or `scopeScheme` for a scheme buy); accuracy then decides
 * whether it comes back true, garbled or false (`shapeByAccuracy`). An empty
 * pool yields no findings whatever the roll (there was nothing to find) -
 * except for a scheme, where "there is no design" is itself the truth a clue
 * reports. Every draw comes from `rng`, the investigation's own seeded
 * generator, after its three rolls.
 */
export function planInvestigation(
    target: Entity,
    kind: GroundTruthKind,
    rolled: { accuracy: IntelAccuracy; fidelity: IntelFidelity },
    rng: Rng,
): InvestigationPlan {
    const pool = groundTruthPool(target, kind);
    if (kind !== 'scheme') {
        return { kind, ...shapeByAccuracy(scopeItems(pool.map(item => item.text), rolled.fidelity, rng), rolled, rng) };
    }
    const finding = scopeScheme(pool, rolled.fidelity, rng);
    const plan: InvestigationPlan = { kind, ...shapeByAccuracy(finding ? [finding] : [], rolled, rng, { nothingTruth: NO_DESIGN_TRUTH }) };
    const schemeName = target.active_scheme?.name;
    return schemeName ? { ...plan, schemeName } : plan;
}

/**
 * The same plan over any pool of truths - the entry point for a question with
 * no single target Entity (an occurrence's hands and aims, read off the turn's
 * attribution record). Fidelity decides how many items reach the prompt, and
 * how much of one; accuracy whether they come back true, garbled or false -
 * with the same parity: an empty pool is an honest nothing whatever the roll,
 * and a false reading comes back as many and as whole as the truth would have,
 * or (FALSE_NOTHING_SHARE of them) as a false nothing. `distortions` narrows
 * what a garbled item may suffer (a bare name can only be pinned on someone
 * else, never have "one element" changed).
 */
export function planFromPool(
    pool: readonly string[],
    rolled: { accuracy: IntelAccuracy; fidelity: IntelFidelity },
    rng: Rng,
    distortions: readonly IntelDistortion[] = EVERY_DISTORTION,
): PoolPlan {
    return shapeByAccuracy(scopeItems(pool, rolled.fidelity, rng), rolled, rng, { distortions });
}

/** The ground truth an honest "nothing to find" is measured against. */
export const NOTHING_ON_RECORD = 'Nothing of the kind is on record.';

/**
 * Pairs the plan's findings with the texts the player actually received
 * (itemised findings, or a scheme's clue), in order. Texts beyond the plan
 * are never kept - the tool drops them before they reach the player - and a
 * planned finding the model left out has no text and so no entry. When no
 * itemised finding reached the player at all (an honest "nothing to find",
 * or a model that listed none), the report itself is the one finding, so
 * every investigation leaves its rolls and its truth on the ledger.
 */
export function investigationTruth(
    plan: InvestigationPlan,
    targetId: string,
    rolls: InvestigationRolls,
    texts: readonly string[],
    reportText: string,
): InvestigationTruth {
    const kind = plan.kind;
    const findings: InvestigationTruth['findings'] = plan.findings.slice(0, texts.length).map((finding, i) => ({
        text: texts[i],
        standing: finding.standing,
        ...(finding.groundTruth !== undefined ? { groundTruth: finding.groundTruth } : {}),
        ...(finding.distortion ? { distortion: finding.distortion } : {}),
        ...(plan.schemeName ? { schemeName: plan.schemeName } : {}),
    }));
    if (findings.length === 0) {
        const facts = plan.findings.map(finding => finding.groundTruth).filter((fact): fact is string => fact !== undefined);
        const groundTruth = plan.findings.length === 0
            ? (plan.withheld ? plan.withheld.join(' | ') : NOTHING_ON_RECORD)
            : facts.join(' | ');
        findings.push({
            text: reportText,
            standing: plan.findings.length === 0 ? (plan.withheld ? 'false' : 'true') : plan.accuracy,
            ...(groundTruth ? { groundTruth } : {}),
            ...(plan.schemeName ? { schemeName: plan.schemeName } : {}),
        });
    }
    return { kind, targetId, rolls, findings };
}

/**
 * The standing of a prose account (one finding for the whole of it, not an
 * itemised list): garbled when one of its truths was distorted, false when
 * no truth reached it - a false "nothing to find" included, which the plan
 * shapes as an honest nothing but records as withheld - and otherwise true.
 */
function accountStanding(plan: PoolPlan): IntelAccuracy {
    return plan.withheld ? 'false' : plan.accuracy;
}

/** The one distortion a prose account carries, when it was garbled. */
function accountDistortion(plan: PoolPlan): { distortion?: IntelDistortion } {
    const garbled = plan.findings.find(finding => finding.standing === 'garbled');
    return garbled?.distortion ? { distortion: garbled.distortion } : {};
}

/**
 * The truth of a commissioned assessment (prose, not itemised): ONE finding
 * - the assessment as delivered - whose standing is the account's own
 * (`accountStanding`) and whose ground truth is every fact that reached it,
 * or - on a false "nothing to find" - every fact it came back without.
 */
export function assessmentTruth(
    plan: InvestigationPlan,
    targetId: string,
    rolls: InvestigationRolls,
    text: string,
): InvestigationTruth {
    const facts = plan.withheld ?? plan.findings.map(finding => finding.groundTruth).filter((fact): fact is string => fact !== undefined);
    return {
        kind: 'deep_analysis',
        targetId,
        rolls,
        findings: [{
            text,
            standing: accountStanding(plan),
            ...(facts.length > 0 ? { groundTruth: facts.join(' | ') } : {}),
            ...accountDistortion(plan),
        }],
    };
}

/** The knowledge claim key of the dossier aspect an investigation's findings land on - the ledger's `reportId` for a finding. */
function dossierClaimKey(kind: InvestigationTruth['kind'] | 'scheme_nature', targetId: string): string {
    return kind === 'scheme' || kind === 'scheme_nature' ? `scheme:${targetId}` : `investigation:${targetId}:${kind}`;
}

/**
 * One GM-private truth-ledger entry per finding the player received (D11),
 * carrying its standing, the ground truth behind it, and the rolls. `stamp`
 * disambiguates entries written in the same turn (callers pass Date.now(),
 * as the rumor ledger does).
 */
export function investigationLedgerEntries(truth: InvestigationTruth, turn: number, stamp: number): TruthLedgerEntry[] {
    return truth.findings.map((finding, i) => ({
        id: `truth_${turn}_intel_${stamp}_${i}`,
        turn,
        claim: finding.text,
        aboutId: truth.targetId,
        isTrue: finding.standing === 'true',
        reportId: dossierClaimKey(truth.kind, truth.targetId),
        investigation: {
            kind: truth.kind,
            standing: finding.standing,
            ...(finding.groundTruth !== undefined ? { groundTruth: finding.groundTruth } : {}),
            ...(finding.distortion ? { distortion: finding.distortion } : {}),
            ...(finding.schemeName ? { schemeName: finding.schemeName } : {}),
            rolls: truth.rolls,
        },
    }));
}

// --- Occurrences: "Who is behind it?" and "Who gains?" ----------------------
//
// A public occurrence is a committed headline. Who acted in it is the
// adjudicator's own declaration, kept GM-side on the turn's attribution record
// (TurnHistoryEntry.headlineActors) after D42 strips it from the headline, and
// what each of them was after that turn is the same entry's entityActions. The
// Events tab's two grounded questions reach for that truth at the rolled
// fidelity and accuracy, through `planFromPool`, exactly as an investigation
// reaches for a target's record. "What follows?" is a forecast of the future,
// not a claim of fact: it has no truth to reach for and none is planned.

/**
 * What an occurrence with no single hand behind it is the truth of, per
 * question: an empty `actorIds` is itself the truth, reported honestly
 * whatever the roll (and imitated, for FALSE_NOTHING_SHARE of false readings,
 * by a false nothing).
 */
export const NO_HAND_TRUTH: Record<GroundedOccurrenceQuestion, string> = {
    who_is_behind_it: 'No single hand: it arose from circumstance.',
    who_gains: "No one's scheme is behind it: whoever profits, profits by chance.",
};

/**
 * The attribution record of `occurrence`, searched newest turn first, by the
 * headline's exact text (the one the Events tab cries and the knowledge store
 * froze when first asked). Null when no entry holds one - a save from before
 * the record existed, or a headline a later gate pass changed - which the
 * caller answers with the honest "no thread to follow". Reads defensively: a
 * hand-edited or damaged save may hold anything here.
 */
export function findHeadlineAttribution(
    turnHistory: readonly TurnHistoryEntry[],
    occurrence: string,
): { entry: TurnHistoryEntry; record: HeadlineAttribution } | null {
    for (let i = turnHistory.length - 1; i >= 0; i--) {
        const entry = turnHistory[i];
        const records: unknown[] = Array.isArray(entry?.headlineActors) ? entry.headlineActors : [];
        const record = records.find((candidate): candidate is HeadlineAttribution =>
            typeof candidate === 'object' && candidate !== null
            && (candidate as HeadlineAttribution).text === occurrence
            && Array.isArray((candidate as HeadlineAttribution).actorIds));
        if (record) return { entry, record };
    }
    return null;
}

/** The truth an occurrence question reaches for, read off its attribution record. GM-PRIVATE. */
export interface OccurrenceGrounding {
    /** The candidate truths `planFromPool` scopes: one per named hand - its name, or for "Who gains?" its name and its recorded aims that turn. Empty when no single hand was behind it. */
    pool: string[];
    /** The ids of the hands behind it that could be named, in declared order. */
    actorIds: string[];
    /** The whole truth the account is measured against, for the ledger. */
    groundTruth: string;
}

/** "appease_troops" -> "appease troops": an entityAction intent as a phrase. */
function intentPhrase(intent: string): string {
    return intent.replace(/_/g, ' ');
}

/**
 * The ground truth of one occurrence question (D47), in code:
 *  - who_is_behind_it: the display names of the headline's declared actors;
 *  - who_gains: the same actors, each with its recorded aims that turn - the
 *    intent and notes of each of its entityActions on the same history entry
 *    (the intent alone where the notes were redacted, or name its scheme).
 * An empty actor list is itself the truth (NO_HAND_TRUTH). An actor is named
 * from the live roster, else the newest snapshot that still holds it (a
 * figure since removed); one that can be named nowhere is left out, and when
 * none of the declared hands can be named there is nothing the engine could
 * stand behind: null, as when there is no record at all. The player's own id
 * is named like any other - an aide may have to tell their master that the
 * hand was their own.
 */
export function occurrenceGrounding(params: {
    turnHistory: readonly TurnHistoryEntry[];
    occurrence: string;
    question: GroundedOccurrenceQuestion;
    roster: readonly Entity[];
}): OccurrenceGrounding | null {
    const { turnHistory, occurrence, question, roster } = params;
    const found = findHeadlineAttribution(turnHistory, occurrence);
    if (!found) return null;
    const declared = [...new Set(found.record.actorIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (declared.length === 0) return { pool: [], actorIds: [], groundTruth: NO_HAND_TRUTH[question] };

    const nameOf = (id: string): string | null => {
        const live = roster.find(entity => entity.entity_id === id)?.name;
        if (live?.trim()) return live;
        for (let i = turnHistory.length - 1; i >= 0; i--) {
            const past = turnHistory[i]?.postTurnEntities?.find(entity => entity.entity_id === id)?.name;
            if (past?.trim()) return past;
        }
        return null;
    };
    const named = declared
        .map(id => ({ id, name: nameOf(id) }))
        .filter((actor): actor is { id: string; name: string } => actor.name !== null);
    if (named.length === 0) return null;

    // A scheme's title is never an aim a free question may carry: its nature
    // is earned across paid clues (D28), and no investigation pool offers it
    // either. Notes that name the hand's design - as it stands now, or in the
    // entry's own snapshot - fall back to the bare intent.
    const schemeNamesOf = (id: string): string[] => [
        roster.find(entity => entity.entity_id === id)?.active_scheme?.name,
        found.entry.postTurnEntities?.find(entity => entity.entity_id === id)?.active_scheme?.name,
    ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
    const actions = Array.isArray(found.entry.adjudication?.entityActions) ? found.entry.adjudication.entityActions : [];
    const aimsOf = (id: string): string[] => actions
        .filter(action => action?.id === id && typeof action.intent === 'string')
        .map(action => {
            const notes = typeof action.notes === 'string' ? action.notes.trim() : '';
            const namesDesign = schemeNamesOf(id).some(name => notes.toLowerCase().includes(name.toLowerCase()));
            const recorded = notes && notes !== REDACTED_PLAYER_PROSE_PLACEHOLDER && !namesDesign;
            return recorded ? `${intentPhrase(action.intent)}: ${notes}` : intentPhrase(action.intent);
        });
    const pool = named.map(({ id, name }) => {
        if (question === 'who_is_behind_it') return name;
        const aims = aimsOf(id);
        return aims.length > 0 ? `${name} - ${aims.join('; ')}` : name;
    });
    return { pool, actorIds: named.map(actor => actor.id), groundTruth: pool.join(' | ') };
}

/**
 * The truth of one grounded occurrence answer: ONE finding - the account as
 * delivered - standing as a prose account does (`accountStanding`), measured
 * against the whole truth on record, whatever part of it the agents reached.
 */
export function occurrenceTruth(
    plan: PoolPlan,
    grounding: OccurrenceGrounding,
    question: GroundedOccurrenceQuestion,
    occurrence: string,
    rolls: InvestigationRolls,
    text: string,
): OccurrenceTruth {
    return {
        question,
        occurrence,
        rolls,
        finding: {
            text,
            standing: accountStanding(plan),
            groundTruth: grounding.groundTruth,
            ...accountDistortion(plan),
        },
    };
}

/**
 * The GM-private ledger entry for one grounded occurrence answer (D11),
 * linked to the knowledge claim the finding landed on (`reportId`, the
 * store's occurrence claim key). About 'world': an occurrence is a public
 * event, as its knowledge claim's subject is.
 */
export function occurrenceLedgerEntry(truth: OccurrenceTruth, reportId: string, turn: number, stamp: number): TruthLedgerEntry {
    const { finding } = truth;
    return {
        id: `truth_${turn}_occurrence_${stamp}_${truth.question}`,
        turn,
        claim: finding.text,
        aboutId: 'world',
        isTrue: finding.standing === 'true',
        reportId,
        investigation: {
            kind: 'occurrence',
            standing: finding.standing,
            groundTruth: finding.groundTruth,
            ...(finding.distortion ? { distortion: finding.distortion } : {}),
            rolls: truth.rolls,
            question: truth.question,
            occurrence: truth.occurrence,
        },
    };
}

// --- The D28 scheme nature -------------------------------------------------

/** One paid clue toward a scheme's nature, as the ledger holds it. */
export interface SchemeClueRecord {
    text: string;
    standing: IntelAccuracy;
    schemeName?: string;
}

/** Every paid scheme clue on `targetId` the ledger still holds, oldest first (D28). */
/** A ledger entry's investigation record with a standing this module can read - a hand-edited or damaged save may hold one without. */
function hasKnownStanding(entry: TruthLedgerEntry): boolean {
    const standing = entry.investigation?.standing;
    return standing === 'true' || standing === 'garbled' || standing === 'false';
}

export function schemeClueRecords(ledger: readonly TruthLedgerEntry[], targetId: string): SchemeClueRecord[] {
    return ledger
        .filter(entry => entry.aboutId === targetId && entry.investigation?.kind === 'scheme' && hasKnownStanding(entry))
        .map(entry => ({
            text: entry.claim,
            standing: entry.investigation!.standing,
            ...(entry.investigation!.schemeName ? { schemeName: entry.investigation!.schemeName } : {}),
        }));
}

/**
 * How the accumulated clues add up to a nature (D28/D47). Each clue weighs
 * 1 when true, 0.5 when garbled, 0 when false - and 0 when it was drawn
 * against a design the target has since replaced (D30), since it no longer
 * speaks to the design standing now. The share of that weight over all the
 * clues decides the nature:
 *   share >= 2/3  -> the true nature (the accurate clues carried the reveal)
 *   share >= 1/3  -> a garbled nature (the design, one element misread)
 *   below         -> a false nature (the player was fed a false trail)
 * With the reveal at three clues: three true, two true and one garbled or
 * false, or one true and two garbled all read true; a true clue amid two
 * false ones, or three garbled, read garbled; anything thinner reads false.
 */
export const SCHEME_NATURE_SHARE = {
    TRUE_MIN: 2 / 3,
    GARBLED_MIN: 1 / 3,
} as const;

const CLUE_WEIGHT: Record<IntelAccuracy, number> = { true: 1, garbled: 0.5, false: 0 };

/** Resolves the nature's standing from the accumulated clues (see SCHEME_NATURE_SHARE). No clues on record reads false: nothing true was gathered. */
export function resolveSchemeNatureStanding(
    clues: readonly SchemeClueRecord[],
    currentSchemeName: string | undefined,
): IntelAccuracy {
    if (clues.length === 0) return 'false';
    const weight = clues.reduce((sum, clue) =>
        sum + (clue.schemeName === currentSchemeName ? CLUE_WEIGHT[clue.standing] : 0), 0);
    const share = weight / clues.length;
    if (share >= SCHEME_NATURE_SHARE.TRUE_MIN) return 'true';
    if (share >= SCHEME_NATURE_SHARE.GARBLED_MIN) return 'garbled';
    return 'false';
}

/** The code-side plan the nature reading is written from (GM-PRIVATE). */
export interface SchemeNaturePlan {
    standing: IntelAccuracy;
    /** The design as it truly stands, handed to the model on a true or garbled nature - null on a false one, and when there is no design. */
    design: { name: string; goal: string } | null;
    /** True when the target pursues no design, and the (true) nature is that nothing is afoot. */
    noDesign: boolean;
    /** Garbled only: the distortion the prompt asks for - one element of the design misread. */
    distortion?: IntelDistortion;
    /** What the agents brought back, clue by clue - the threads the nature is pieced together from. Player-safe texts only. */
    clueAccounts: string[];
    /** The standing design's name, recorded on the nature's ledger entry. */
    schemeName?: string;
    /** GM-PRIVATE: the whole truth the nature is measured against, for the ledger. */
    groundTruth: string;
}

/**
 * Plans the nature a scheme's accumulated clues add up to (D28): whether it
 * is the true design, a garbled one, or a false one follows from the clue
 * standings (`resolveSchemeNatureStanding`), and the reading is pieced
 * together from the clue accounts themselves. A false nature is handed no
 * truth at all; a garbled one the true design with one element to misread.
 */
export function planSchemeNature(target: Entity, clues: readonly SchemeClueRecord[]): SchemeNaturePlan {
    const scheme = target.active_scheme;
    const schemeName = scheme?.name;
    const noDesign = !scheme;
    let standing = resolveSchemeNatureStanding(clues, schemeName);
    // "No design" cannot be half-misread into a design: a garbled reading of
    // nothing is a false one.
    if (noDesign && standing === 'garbled') standing = 'false';
    const design = scheme && standing !== 'false' ? { name: scheme.name, goal: scheme.overall_goal } : null;
    return {
        standing,
        design,
        noDesign: noDesign && standing === 'true',
        ...(standing === 'garbled' ? { distortion: 'element_changed' as const } : {}),
        clueAccounts: clues.map(clue => clue.text),
        ...(schemeName ? { schemeName } : {}),
        groundTruth: scheme ? `${scheme.name}: ${scheme.overall_goal}` : NO_DESIGN_TRUTH,
    };
}

/** The GM-private ledger entry for a revealed (or re-read) nature: the reading the player holds, and whether it is the truth. */
export function schemeNatureLedgerEntry(
    targetId: string,
    plan: SchemeNaturePlan,
    nature: string,
    turn: number,
    stamp: number,
): TruthLedgerEntry {
    return {
        id: `truth_${turn}_intel_${stamp}_nature`,
        turn,
        claim: nature,
        aboutId: targetId,
        isTrue: plan.standing === 'true',
        reportId: dossierClaimKey('scheme_nature', targetId),
        investigation: {
            kind: 'scheme_nature',
            standing: plan.standing,
            groundTruth: plan.groundTruth,
            ...(plan.distortion ? { distortion: plan.distortion } : {}),
            ...(plan.schemeName ? { schemeName: plan.schemeName } : {}),
        },
    };
}

// --- Leverage (D47 item: blackmail filed from a bought secret) -------------

/** The resource key a bought secret is filed under (hooks/useIntelCommits.ts). */
export const BLACKMAIL_RESOURCE_PREFIX = 'blackmail_on_';

/** The truth behind one piece of leverage the player holds. */
export interface LeverageTruth {
    targetId: string;
    item: string;
    standing: IntelAccuracy;
    /** The ground truth the item was drawn from - absent when it rests on a false account. */
    groundTruth?: string;
}

/**
 * The truth behind each piece of blackmail the player filed from a bought
 * secret: every `blackmail_on_<id>` item matched to the newest ledger entry
 * that recorded it as a secrets finding on that target. Items with no such
 * entry - leverage filed before D47, leverage the adjudicator itself
 * created, or a finding whose entry has rolled off the bounded ledger - are
 * left out: the engine has no record of their truth, and says nothing.
 */
export function deriveLeverageTruth(player: Entity, ledger: readonly TruthLedgerEntry[]): LeverageTruth[] {
    const out: LeverageTruth[] = [];
    for (const [key, value] of Object.entries(player.resources ?? {})) {
        if (!key.startsWith(BLACKMAIL_RESOURCE_PREFIX)) continue;
        const targetId = key.slice(BLACKMAIL_RESOURCE_PREFIX.length);
        const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
        for (const item of items) {
            if (typeof item !== 'string') continue;
            const entry = [...ledger].reverse().find(candidate =>
                candidate.aboutId === targetId
                && candidate.investigation?.kind === 'secrets'
                && hasKnownStanding(candidate)
                && candidate.claim === item);
            if (!entry?.investigation) continue;
            out.push({
                targetId,
                item,
                standing: entry.investigation.standing,
                ...(entry.investigation.groundTruth !== undefined ? { groundTruth: entry.investigation.groundTruth } : {}),
            });
        }
    }
    return out;
}
