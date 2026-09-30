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
 *  2. `planInvestigation` (and `planOccurrence`, over an occurrence's hands)
 *     - fidelity picks how many of them, or how much of one, reaches the
 *     prompt; accuracy decides whether they are reported
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
 *     attribution record, and `planOccurrence` (the same shaping, with code
 *     picking every decoy) plans what reaches the prompt.
 *
 * HARD INVARIANT: `secret_truth` is never an input - nothing here reads it
 * (tests/groundedIntel.test.tsx proves it cannot reach an intelligence prompt).
 * Everything this module returns is GM-private (D11) except the texts the
 * player already received; it must never be handed to a player-facing
 * surface. Pure: no AI calls, no React, no mutation of its inputs.
 */

import type {
    Entity,
    EntityActionIntent,
    GroundedOccurrenceQuestion,
    HeadlineAttribution,
    IntelAccuracy,
    IntelDistortion,
    IntelFidelity,
    InvestigationRolls,
    InvestigationTruth,
    OccurrenceSiblingOutcome,
    OccurrenceTruth,
    TruthLedgerEntry,
    TurnHistoryEntry,
} from '../../types';
import { EntityActionIntentEnum } from '../../types';
import type { Rng } from './resolution';
import { secretAffiliationsOf } from './affiliations';

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

/**
 * One entry of an occurrence account as code planned it (D47): whose name it
 * carries and, for "Who gains?", what they were after. Code - never the model
 * - picks it on every reading: the truth reached, the one distortion of a
 * garbled reading, the decoys of a false one.
 */
export interface PlannedHand {
    /** The name to report: a true hand's, a real figure's in its place, or - only as a last resort - a stranger's name code generated (`strangerName`). */
    name: string;
    /** "Who gains?" only: the aims to report, as open (never covert) entityAction intents; [] for a hand whose aim was never learned. */
    aims: OpenIntent[];
}

/**
 * The entityAction intents that are moves made in the dark. An aim is never
 * one of them - not on a true entry, not on a decoy - so "Who gains?" cannot
 * put a secret move into words (D28), and a hand whose only moves were covert
 * is a bare name on every reading.
 */
export const COVERT_INTENTS: readonly EntityActionIntent[] = ['assassinate', 'intrigue'];

/** The intents an aim may be: every one but the covert. */
export type OpenIntent = Exclude<EntityActionIntent, 'assassinate' | 'intrigue'>;

/** One finding the prompt will ask for, with the truth the code knows about it. */
export interface PlannedFinding {
    /**
     * What the prompt carries for this finding: the truth as reached; on a
     * garbled one, the truth with its one distortion when code applied it; on
     * a false one, null - the model invents it, and no truth ever reaches the
     * prompt - or, where code picks the decoy (an occurrence entry), the decoy.
     */
    truth: string | null;
    /** True when only part of the finding was reached (a word fragment of a truth, or a sketchy false one). */
    fragmentary: boolean;
    /** GM-PRIVATE: the whole ground-truth item behind the finding - absent on a false one. */
    groundTruth?: string;
    standing: IntelAccuracy;
    /** Garbled findings only: the one distortion the prompt asks for (or code applied). */
    distortion?: IntelDistortion;
    /** Occurrence entries only: the planned content `truth` renders (see PlannedHand). */
    hand?: PlannedHand;
}

/**
 * The code-side plan a grounded prompt is built from, over a pool of truths
 * (GM-PRIVATE until the model's account comes back): what an investigation
 * plans for its target (`InvestigationPlan`), and what an occurrence question
 * plans from the turn's attribution record (`OccurrencePlan`).
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
     * GM-PRIVATE, set on every false reading: the truths the account came back
     * without, which the ledger records it as false against. On a false
     * "nothing to find" (see `FALSE_NOTHING_SHARE`) it is the only mark of the
     * lie: the prompt is shaped exactly as an honest nothing.
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

/** How `shapeByAccuracy` shapes one kind of plan beyond its defaults. */
interface AccuracyShaping {
    /** What "nothing" is itself the truth of (a scheme's "there is no design"), carried as a finding when nothing was reached. */
    nothingTruth?: string;
    /** The distortions the chosen garbled finding may carry (default: both). */
    distortionsFor?: (finding: PlannedFinding) => readonly IntelDistortion[];
    /** Whether a false reading may come back as a false nothing (default: yes). */
    falseNothing?: boolean;
    /**
     * Where CODE picks false and distorted content instead of the model: a
     * false finding of the exact shape of the true one it replaces, and the
     * garbled finding with its one distortion applied. Absent, a false finding
     * carries nothing (the model invents it) and a garbled one is only marked.
     */
    decoys?: {
        falsify: (finding: PlannedFinding, index: number, rng: Rng) => PlannedFinding;
        garble: (finding: PlannedFinding, index: number, distortion: IntelDistortion, rng: Rng) => PlannedFinding;
    };
}

/**
 * Accuracy's half of every plan (D47), over the truths fidelity reached:
 *  - true: the reached truths, reported as reached;
 *  - garbled: the reached truths, exactly one of them marked for one
 *    distortion (which one, and how, recorded here - the code knows);
 *  - false: NO truth at all - as many findings as the truth would have
 *    yielded, of the same shape (so neither count nor shape betrays the
 *    accuracy), each invented plausibly from what is publicly known; or, for
 *    FALSE_NOTHING_SHARE of false readings, a false "nothing to find", shaped
 *    exactly as the honest one. Every false reading records what it hid.
 * Nothing reached yields the honest nothing whatever the roll: no findings,
 * or - when `nothingTruth` names what "nothing" is itself the truth of (a
 * scheme's "there is no design") - one finding carrying it.
 */
function shapeByAccuracy(
    reached: PlannedFinding[],
    rolled: { accuracy: IntelAccuracy; fidelity: IntelFidelity },
    rng: Rng,
    shaping: AccuracyShaping = {},
): PoolPlan {
    const { fidelity } = rolled;
    const { nothingTruth, distortionsFor = () => EVERY_DISTORTION, falseNothing = true, decoys } = shaping;

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
        if (falseNothing && rng() < FALSE_NOTHING_SHARE) {
            return nothingTruth
                ? { accuracy: 'true', fidelity, findings: [{ truth: nothingTruth, fragmentary: false, groundTruth: withheld.join(' | '), standing: 'false' }] }
                : { accuracy: 'true', fidelity, findings: [], withheld };
        }
        // Otherwise the falsehoods come back looking exactly like the truth
        // would have: as many findings as it would have yielded, as whole or
        // as fragmentary - the count never tells the player which they hold.
        const findings = reached.map((finding, i): PlannedFinding => decoys
            ? decoys.falsify(finding, i, rng)
            : { truth: null, fragmentary: finding.fragmentary, standing: 'false' });
        return { accuracy: 'false', fidelity, findings, withheld };
    }
    const accuracy = rolled.accuracy;

    if (accuracy === 'garbled') {
        const index = Math.floor(rng() * reached.length);
        const distortions = distortionsFor(reached[index]);
        const distortion = distortions[Math.floor(rng() * distortions.length)];
        reached = reached.map((finding, i) => i !== index
            ? finding
            : decoys ? decoys.garble(finding, i, distortion, rng) : { ...finding, standing: 'garbled', distortion });
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
        const facts = plan.withheld ?? plan.findings.map(finding => finding.groundTruth).filter((fact): fact is string => fact !== undefined);
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
// adjudicator's own declaration, frozen with each hand's name on the turn's
// attribution record (TurnHistoryEntry.headlineActors) after D42 strips it
// from the headline, and what each hand was after that turn is the intents of
// its entityActions on the same entry. The Events tab's two grounded
// questions reach for that truth at the rolled fidelity and accuracy through
// the same shaping every investigation uses (`shapeByAccuracy`), with one
// difference: CODE picks every entry the account carries - a false or garbled
// reading's decoys included - so the model only ever phrases a plan whose
// count and shape never depend on the roll. "What follows?" is a forecast of
// the future, not a claim of fact: it has no truth to reach for.

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
 * Each open intent as an aim ("who sought to ..."). An aim is only ever one of
 * these phrases - never a covert intent (COVERT_INTENTS), an action's notes or
 * its target, any of which may carry a secret move or a scheme's goal (D28).
 */
export const AIM_PHRASE: Record<OpenIntent, string> = {
    appease_troops: 'to appease the troops',
    suppress_revolt: 'to put down a revolt',
    negotiate: 'to strike a bargain',
    fortify: 'to fortify a stronghold',
    raid: 'to raid',
    tax_raise: 'to raise taxes',
    pay_arrears: 'to pay arrears owed',
    propaganda: 'to spread propaganda',
    march: 'to march an army',
    siege: 'to lay siege',
    recruit: 'to recruit men',
};

const OPEN_INTENTS: readonly OpenIntent[] = EntityActionIntentEnum.filter((intent): intent is OpenIntent => !COVERT_INTENTS.includes(intent));

/**
 * The most aims one hand is ever reported with: the first this many distinct
 * open intents it pursued that turn, in declared order. A cap, so a decoy of
 * the same shape can always be drawn without repeating an aim.
 */
export const MAX_AIMS_PER_HAND = 3;

function isOpenIntent(intent: unknown): intent is OpenIntent {
    return typeof intent === 'string' && (OPEN_INTENTS as readonly string[]).includes(intent);
}

/**
 * The parts a stranger's name is built from (`strangerName`): praenomina,
 * nomina (masculine; a woman bears the feminine, -ia) and cognomina as
 * [masculine, feminine] pairs - Latin, Greek and provincial forms of the
 * third century. Tens of thousands of combinations, so no name recurs often
 * enough to be learned as the mark of a false reading.
 */
export const STRANGER_NAME_PARTS: {
    readonly praenomina: readonly string[];
    readonly nomina: readonly string[];
    readonly cognomina: readonly (readonly [string, string])[];
} = {
    praenomina: [
        'Gaius', 'Lucius', 'Marcus', 'Publius', 'Quintus', 'Titus', 'Gnaeus', 'Aulus',
        'Sextus', 'Decimus', 'Servius', 'Tiberius', 'Manius', 'Spurius', 'Numerius', 'Appius',
    ],
    nomina: [
        'Aelius', 'Aemilius', 'Afranius', 'Annius', 'Antonius', 'Appuleius', 'Arrius', 'Asinius',
        'Atilius', 'Aufidius', 'Aurelius', 'Caecilius', 'Calpurnius', 'Canuleius', 'Cassius', 'Claudius',
        'Cocceius', 'Cominius', 'Cornelius', 'Curtius', 'Domitius', 'Egnatius', 'Fabius', 'Flavius',
        'Fulvius', 'Furius', 'Gavius', 'Hortensius', 'Julius', 'Junius', 'Laelius', 'Licinius',
        'Livius', 'Lollius', 'Lucretius', 'Marcius', 'Minucius', 'Munatius', 'Nonius', 'Octavius',
        'Ovinius', 'Papirius', 'Petronius', 'Plautius', 'Pompeius', 'Pomponius', 'Popillius', 'Rutilius',
        'Sallustius', 'Sempronius', 'Sentius', 'Servilius', 'Statilius', 'Sulpicius', 'Terentius', 'Titinius',
        'Valerius', 'Vettius', 'Vibius', 'Volusius',
    ],
    cognomina: [
        ['Rufus', 'Rufa'], ['Maximus', 'Maxima'], ['Severus', 'Severa'], ['Priscus', 'Prisca'],
        ['Longinus', 'Longina'], ['Paulinus', 'Paulina'], ['Crispinus', 'Crispina'], ['Firmus', 'Firma'],
        ['Sabinus', 'Sabina'], ['Marcellus', 'Marcella'], ['Albinus', 'Albina'], ['Balbus', 'Balbina'],
        ['Celsus', 'Celsa'], ['Clemens', 'Clementina'], ['Felix', 'Felicitas'], ['Fortunatus', 'Fortunata'],
        ['Gallus', 'Galla'], ['Justus', 'Justa'], ['Lepidus', 'Lepida'], ['Macer', 'Macrina'],
        ['Martialis', 'Martina'], ['Modestus', 'Modesta'], ['Nepos', 'Nepotilla'], ['Pollio', 'Polla'],
        ['Proculus', 'Procula'], ['Pudens', 'Pudentilla'], ['Quietus', 'Quieta'], ['Restitutus', 'Restituta'],
        ['Saturninus', 'Saturnina'], ['Secundus', 'Secunda'], ['Tertullus', 'Tertulla'], ['Urbanus', 'Urbana'],
        ['Vitalis', 'Vitalina'], ['Verus', 'Vera'], ['Victorinus', 'Victorina'], ['Honoratus', 'Honorata'],
        ['Candidus', 'Candida'], ['Castus', 'Casta'], ['Faustinus', 'Faustina'], ['Ingenuus', 'Ingenua'],
        ['Primus', 'Prima'], ['Rusticus', 'Rustica'], ['Silvanus', 'Silvana'], ['Donatus', 'Donata'],
        ['Optatus', 'Optata'],
        // Greek and provincial.
        ['Hermogenes', 'Hermione'], ['Eutyches', 'Eutychia'], ['Philetus', 'Philete'], ['Theodotus', 'Theodote'],
        ['Zosimus', 'Zosime'], ['Onesimus', 'Onesime'], ['Callistus', 'Calliste'], ['Heliodorus', 'Heliodora'],
        ['Syrus', 'Syra'], ['Afer', 'Afra'], ['Maurus', 'Maura'], ['Antiochus', 'Antiochis'],
    ],
};

/**
 * A stranger's name, when no real figure of the right familiarity is left to
 * stand in for a true hand (planOccurrence), built from STRANGER_NAME_PARTS
 * by the planner's own generator: a man's praenomen and nomen, or praenomen,
 * nomen and cognomen; a woman's nomen and cognomen. It reaches the prompt as
 * ordinary quoted data, like any name - to the player, as unheard-of as a
 * real figure they have never met. Never a name `isTaken` refuses (every name
 * a roster figure wears, then or now, and every hand's frozen name).
 */
export function strangerName(rng: Rng, isTaken: (name: string) => boolean): string {
    const { praenomina, nomina, cognomina } = STRANGER_NAME_PARTS;
    let name = '';
    for (let attempt = 0; attempt < 64; attempt++) {
        const form = rng();
        const nomen = pick(nomina, rng);
        const [cognomen, feminine] = pick(cognomina, rng);
        name = form < 0.3
            ? `${nomen.replace(/ius$/, 'ia')} ${feminine}`
            : form < 0.55
                ? `${pick(praenomina, rng)} ${nomen}`
                : `${pick(praenomina, rng)} ${nomen} ${cognomen}`;
        if (!isTaken(name)) return name;
    }
    // Sixty-four refusals in a row cannot happen short of a roster of tens of
    // thousands; even then, walk the three-part names in order for a free one.
    for (const praenomen of praenomina) {
        for (const nomen of nomina) {
            for (const [cognomen] of cognomina) {
                const candidate = `${praenomen} ${nomen} ${cognomen}`;
                if (!isTaken(candidate)) return candidate;
            }
        }
    }
    return name;
}

/** One hand behind an occurrence, as the record holds it. GM-PRIVATE. */
export interface OccurrenceHand {
    id: string;
    name: string;
    /** "Who gains?" only: the first MAX_AIMS_PER_HAND distinct open intents of its entityActions that turn, in order ([] for "Who is behind it?", or a hand whose moves were all covert or none). */
    aims: OpenIntent[];
}

/** One entry as the ledger reads it (GM-only wording). */
export function describeHand(hand: PlannedHand & { stranger?: boolean }, question: GroundedOccurrenceQuestion): string {
    const name = hand.stranger ? `${hand.name} (a stranger, no roster figure)` : hand.name;
    if (question === 'who_is_behind_it') return name;
    return `${name}: ${hand.aims.length > 0 ? hand.aims.map(aim => AIM_PHRASE[aim]).join('; ') : 'no aim learned'}`;
}

function isRecordOf(candidate: unknown, occurrence: string): candidate is HeadlineAttribution {
    return typeof candidate === 'object' && candidate !== null
        && (candidate as HeadlineAttribution).text === occurrence
        && Array.isArray((candidate as HeadlineAttribution).actorIds);
}

/**
 * The hands behind `occurrence`, off the newest turn whose attribution record
 * holds its exact text (the one the Events tab cries and the knowledge store
 * froze when first asked). Every record of that text on that turn counts: a
 * headline cried twice pools its hands, in declared order, once each (an
 * older turn's record of the same text gives way to the newest). Names are
 * the ones frozen at commit; only a record written before names were frozen
 * is named from the roster, else the newest snapshot, dropping a hand named
 * nowhere. `unresolved` carries the declared labels that named no roster
 * figure, for the GM. Null only when no turn holds a record of the text - a
 * save from before the record existed, or a headline a later gate pass
 * changed - which the caller answers with the honest "no thread to follow".
 * Reads defensively: a hand-edited or damaged save may hold anything here.
 */
export function findHeadlineHands(
    turnHistory: readonly TurnHistoryEntry[],
    occurrence: string,
    roster: readonly Entity[],
): { entry: TurnHistoryEntry; hands: Array<{ id: string; name: string }>; unresolved: string[] } | null {
    const nameFromRoster = namer(turnHistory, roster);
    for (let i = turnHistory.length - 1; i >= 0; i--) {
        const entry = turnHistory[i];
        const held: unknown[] = Array.isArray(entry?.headlineActors) ? entry.headlineActors : [];
        const records = held.filter((candidate): candidate is HeadlineAttribution => isRecordOf(candidate, occurrence));
        if (records.length === 0) continue;
        const hands = new Map<string, string>();
        const unresolved: string[] = [];
        for (const record of records) {
            record.actorIds.forEach((id, index) => {
                if (typeof id !== 'string' || id.length === 0 || hands.has(id)) return;
                const frozen = Array.isArray(record.actorNames) ? record.actorNames[index] : undefined;
                const name = typeof frozen === 'string' && frozen.trim() ? frozen.trim() : nameFromRoster(id);
                if (name) hands.set(id, name);
            });
            for (const label of Array.isArray(record.unresolvedActors) ? record.unresolvedActors : []) {
                if (typeof label === 'string' && label.trim() && !unresolved.includes(label)) unresolved.push(label);
            }
        }
        return { entry, hands: [...hands].map(([id, name]) => ({ id, name })), unresolved };
    }
    return null;
}

/** A figure's name: off the live roster, else the newest snapshot that holds them; undefined when named nowhere. */
function namer(turnHistory: readonly TurnHistoryEntry[], roster: readonly Entity[]): (id: string) => string | undefined {
    return id => {
        const live = roster.find(entity => entity.entity_id === id)?.name?.trim();
        if (live) return live;
        for (let i = turnHistory.length - 1; i >= 0; i--) {
            const past = turnHistory[i]?.postTurnEntities?.find(entity => entity?.entity_id === id)?.name?.trim();
            if (past) return past;
        }
        return undefined;
    };
}

/**
 * The figures alive and on the roster at an occurrence's OWN turn - the only
 * real figures a decoy may be. Read off the ids frozen at commit
 * (TurnHistoryEntry.livingAtCommit, kept past the snapshot trim), else the
 * entry's post-turn snapshot, else its pre-turn roster; only an entry with
 * none of these - a save from before the freeze - falls back to the live
 * roster. Never "alive now" where the entry says otherwise, which would tell
 * an old occurrence's decoy by who has arrived or died since. Each is named
 * off the live roster, else any snapshot; one named nowhere is left out.
 */
function figuresAliveAt(entry: TurnHistoryEntry, turnHistory: readonly TurnHistoryEntry[], roster: readonly Entity[]): Array<{ id: string; name: string }> {
    const ids: unknown[] = Array.isArray(entry.livingAtCommit)
        ? entry.livingAtCommit
        : Array.isArray(entry.postTurnEntities)
            ? entry.postTurnEntities.filter(entity => entity?.status === 'alive').map(entity => entity.entity_id)
            : Array.isArray(entry.preTurnRoster)
                ? entry.preTurnRoster.filter(entity => entity?.status === 'alive').map(entity => entity.entity_id)
                : roster.filter(entity => entity.status === 'alive').map(entity => entity.entity_id);
    const nameOf = namer(turnHistory, roster);
    const figures: Array<{ id: string; name: string }> = [];
    for (const id of new Set(ids)) {
        if (typeof id !== 'string' || id.length === 0) continue;
        const name = nameOf(id);
        if (name) figures.push({ id, name });
    }
    return figures;
}

/** The truth an occurrence question reaches for, read off its attribution record. GM-PRIVATE. */
export interface OccurrenceGrounding {
    /** The hands behind it, in declared order - empty when no single hand was. */
    hands: OccurrenceHand[];
    /** The whole truth the account is measured against, for the ledger. */
    groundTruth: string;
    /** The figures alive and on the roster at the occurrence's own turn: every real figure a decoy may be (the planner leaves out the true hands and the player). */
    aliveThen: Array<{ id: string; name: string }>;
    /** Every open intent pursued on the occurrence's turn, by whom: what a decoy's or a changed aim is drawn from. */
    turnAims: Array<{ id: string; aim: OpenIntent }>;
}

/**
 * The ground truth of one occurrence question (D47), in code:
 *  - who_is_behind_it: the headline's hands, by the names frozen at commit;
 *  - who_gains: the same hands, each with its aims that turn - the first
 *    MAX_AIMS_PER_HAND distinct OPEN intents of its entityActions on the
 *    same history entry. Never a covert intent, an action's notes or its
 *    target (D28); a hand with no open action is a bare name.
 * An empty record is itself the truth (NO_HAND_TRUTH) - save that labels the
 * adjudicator declared but no roster figure answered are named for the GM.
 * Null only when there is no record at all. The player's own id is a hand
 * like any other - an aide may have to tell their master the hand was theirs.
 */
export function occurrenceGrounding(params: {
    turnHistory: readonly TurnHistoryEntry[];
    occurrence: string;
    question: GroundedOccurrenceQuestion;
    roster: readonly Entity[];
}): OccurrenceGrounding | null {
    const { turnHistory, occurrence, question, roster } = params;
    const found = findHeadlineHands(turnHistory, occurrence, roster);
    if (!found) return null;
    const actions = Array.isArray(found.entry.adjudication?.entityActions) ? found.entry.adjudication.entityActions : [];
    const turnAims = actions
        .filter(action => typeof action?.id === 'string' && isOpenIntent(action.intent))
        .map(action => ({ id: action.id, aim: action.intent as OpenIntent }));
    const aimsOf = (id: string): OpenIntent[] => [...new Set(turnAims.filter(entry => entry.id === id).map(entry => entry.aim))].slice(0, MAX_AIMS_PER_HAND);
    const hands = found.hands.map(({ id, name }): OccurrenceHand => ({ id, name, aims: question === 'who_gains' ? aimsOf(id) : [] }));
    const unresolvedNote = found.unresolved.length > 0 ? found.unresolved.join(', ') : '';
    const groundTruth = hands.length > 0
        ? `${hands.map(hand => describeHand(hand, question)).join(' | ')}${unresolvedNote ? ` | declared, but no roster figure: ${unresolvedNote}` : ''}`
        : unresolvedNote ? `No roster figure; declared: ${unresolvedNote}` : NO_HAND_TRUTH[question];
    return { hands, groundTruth, aliveThen: figuresAliveAt(found.entry, turnHistory, roster), turnAims };
}

/** What code needs to pick an occurrence account's decoys, and to keep it consistent with its sibling question. */
export interface OccurrencePlanContext {
    /** The player's own id: a hand like any other, never a decoy. */
    playerId: string;
    /** Whether the player knows a figure - the Dramatis Personae's own test (knowledge/relationships.ts::isEntityKnownToPlayer), handed in by the caller. */
    isKnown: (id: string) => boolean;
    /** Every name a figure on the roster wears, then or now, and every hand's frozen name, lower-cased: a stranger never borrows one. */
    takenNames: ReadonlySet<string>;
    /** What the other grounded question on the occurrence came back with, when the player asked it. */
    sibling: OccurrenceSiblingOutcome | null;
}

/** The code-side plan an occurrence prompt is built from (GM-PRIVATE until the model's account comes back). */
export interface OccurrencePlan extends PoolPlan {
    question: GroundedOccurrenceQuestion;
    /** Set when the account came back with nothing because its sibling question did, whatever its own roll. */
    heldToSibling?: boolean;
}

/**
 * Plans an occurrence account (D47). Fidelity reaches FIDELITY_REACH hands (a
 * fragment only part of one hand's name); accuracy then shapes them through
 * `shapeByAccuracy`, with CODE picking all false content, so that:
 *  - every entry keeps its SHAPE on every reading - a name alone, or a name
 *    and k aims; a false reading's decoy has exactly the shape of the true
 *    entry it replaces, and a garbled reading changes one thing in one entry;
 *  - a decoy is a real figure alive and on the roster at the occurrence's own
 *    turn, of the true hand's familiarity: a figure the player knows for a
 *    hand they know, one they do not for a hand they do not - never a true
 *    hand, never the player, and never one of the other familiarity (a known
 *    decoy for an unknown hand would be a tell). Only when that pool runs dry
 *    does a stranger's name, built by `strangerName` from the planner's own
 *    generator, stand in. Every name is plain quoted data, so a decoy reads
 *    exactly as a true hand would;
 *  - a false or changed aim is an open intent some OTHER figure pursued that
 *    same turn and this entry never had; when those run short, any other
 *    open intent - never one the entry already carries. A garbled entry has
 *    its name pinned on a decoy or - only if it has aims - one aim changed.
 * "Came back empty" is decided once per occurrence, by `context.sibling`: when
 * the other question came back with nothing, so does this one (recorded false
 * when hands were behind it, whatever the roll); when it named hands, a false
 * reading here invents rather than coming back empty. An empty truth is an
 * honest nothing either way. Every draw comes from `rng`, after the rolls.
 */
export function planOccurrence(
    grounding: OccurrenceGrounding,
    question: GroundedOccurrenceQuestion,
    rolled: { accuracy: IntelAccuracy; fidelity: IntelFidelity },
    rng: Rng,
    context: OccurrencePlanContext,
): OccurrencePlan {
    const { hands } = grounding;
    const { fidelity } = rolled;
    if (context.sibling === 'empty' && hands.length > 0) {
        return { question, accuracy: 'true', fidelity, findings: [], withheld: hands.map(hand => describeHand(hand, question)), heldToSibling: true };
    }

    const entry = (content: PlannedHand & { stranger?: boolean }, fragmentary: boolean, standing: IntelAccuracy, groundTruth?: string): PlannedFinding => ({
        truth: describeHand(content, question),
        fragmentary,
        standing,
        hand: { name: content.name, aims: content.aims },
        ...(groundTruth !== undefined ? { groundTruth } : {}),
    });
    const fragmentary = fidelity === 'fragment';
    const reached = shuffled(hands, rng).slice(0, FIDELITY_REACH[fidelity]);
    const findings = reached.map(hand => entry(
        { name: fragmentary ? fragmentOf(hand.name, rng) : hand.name, aims: hand.aims },
        fragmentary,
        'true',
        describeHand(hand, question),
    ));

    const trueIds = new Set(hands.map(hand => hand.id));
    const candidates = grounding.aliveThen.filter(figure => figure.id !== context.playerId && !trueIds.has(figure.id));
    const pools = {
        known: candidates.filter(figure => context.isKnown(figure.id)),
        unknown: candidates.filter(figure => !context.isKnown(figure.id)),
    };
    // Names already in this account, so no two entries share one.
    const usedNames = new Set(hands.map(hand => hand.name.toLocaleLowerCase()));
    const isTaken = (name: string) => context.takenNames.has(name.toLocaleLowerCase()) || usedNames.has(name.toLocaleLowerCase());
    const decoy = (hand: OccurrenceHand, asFragment: boolean, draw: Rng): { name: string; stranger?: boolean } => {
        const pool = context.isKnown(hand.id) ? pools.known : pools.unknown;
        const stranger = pool.length === 0;
        const name = stranger ? strangerName(draw, isTaken) : pool.splice(Math.floor(draw() * pool.length), 1)[0].name;
        usedNames.add(name.toLocaleLowerCase());
        return { name: asFragment ? fragmentOf(name, draw) : name, ...(stranger ? { stranger } : {}) };
    };
    /**
     * One false or changed aim for `hand`: an open intent another figure
     * pursued that turn, none of `excluded` (its true aims and those already
     * told); when those run short, any open intent not excluded; and at the
     * very least one the entry does not already carry (`entryAims`) - never
     * undefined, since an entry holds at most MAX_AIMS_PER_HAND of eleven.
     */
    const otherAim = (hand: OccurrenceHand, excluded: readonly OpenIntent[], entryAims: readonly OpenIntent[], draw: Rng): OpenIntent => {
        const others = [...new Set(grounding.turnAims.filter(pursued => pursued.id !== hand.id).map(pursued => pursued.aim))]
            .filter(aim => !excluded.includes(aim));
        const rest = OPEN_INTENTS.filter(aim => !excluded.includes(aim));
        const open = others.length > 0 ? others : rest.length > 0 ? rest : OPEN_INTENTS.filter(aim => !entryAims.includes(aim));
        return open[Math.floor(draw() * open.length)];
    };

    const plan = shapeByAccuracy(findings, rolled, rng, {
        falseNothing: context.sibling !== 'named',
        // A bare name can only be pinned on the wrong party; an entry with an aim may instead have one aim changed.
        distortionsFor: finding => (finding.hand?.aims.length ?? 0) > 0 ? EVERY_DISTORTION : ['misattributed'],
        decoys: {
            falsify: (finding, i, draw) => {
                const hand = reached[i];
                const aims: OpenIntent[] = [];
                while (aims.length < hand.aims.length) aims.push(otherAim(hand, [...hand.aims, ...aims], aims, draw));
                return entry({ ...decoy(hand, finding.fragmentary, draw), aims }, finding.fragmentary, 'false');
            },
            garble: (finding, i, distortion, draw) => {
                const hand = reached[i];
                const told = finding.hand!;
                let content: PlannedHand & { stranger?: boolean };
                if (distortion === 'misattributed') {
                    content = { ...decoy(hand, finding.fragmentary, draw), aims: told.aims };
                } else {
                    const changed = Math.floor(draw() * told.aims.length);
                    const kept = told.aims.filter((_, a) => a !== changed);
                    content = { name: told.name, aims: told.aims.map((aim, a) => a === changed ? otherAim(hand, [...hand.aims, ...told.aims], kept, draw) : aim) };
                }
                return { ...entry(content, finding.fragmentary, 'garbled', finding.groundTruth), distortion };
            },
        },
    });
    return { question, ...plan };
}

/**
 * The truth of one grounded occurrence answer: ONE finding - the account as
 * delivered - standing as a prose account does (`accountStanding`), measured
 * against the whole truth on record, whatever part of it the agents reached,
 * with exactly what code planned it to carry.
 */
export function occurrenceTruth(
    plan: OccurrencePlan,
    grounding: OccurrenceGrounding,
    occurrence: string,
    rolls: InvestigationRolls,
    text: string,
): OccurrenceTruth {
    return {
        question: plan.question,
        occurrence,
        rolls,
        finding: {
            text,
            standing: accountStanding(plan),
            groundTruth: grounding.groundTruth,
            ...accountDistortion(plan),
            planned: plan.findings.map(finding => finding.truth ?? '').join(' | '),
            cameBackEmpty: plan.findings.length === 0,
            ...(plan.heldToSibling ? { heldToSibling: true } : {}),
        },
    };
}

/**
 * What the OTHER grounded question on `occurrence` came back with, off the
 * newest ledger entry recording it: no hand at all, or hands named. Null when
 * it was never asked, its entry has left the bounded ledger, or it was
 * recorded before the ledger said - the answer then rolls on its own.
 */
export function siblingOccurrenceOutcome(
    ledger: readonly TruthLedgerEntry[],
    occurrence: string,
    question: GroundedOccurrenceQuestion,
): OccurrenceSiblingOutcome | null {
    const sibling: GroundedOccurrenceQuestion = question === 'who_gains' ? 'who_is_behind_it' : 'who_gains';
    for (let i = ledger.length - 1; i >= 0; i--) {
        const finding = ledger[i]?.investigation;
        if (finding?.kind === 'occurrence' && finding.occurrence === occurrence && finding.question === sibling
            && typeof finding.cameBackEmpty === 'boolean') {
            return finding.cameBackEmpty ? 'empty' : 'named';
        }
    }
    return null;
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
            planned: finding.planned,
            cameBackEmpty: finding.cameBackEmpty,
            ...(finding.heldToSibling ? { heldToSibling: true } : {}),
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
