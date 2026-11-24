/**
 * events/stabilityVocabulary.ts
 *
 * Canonical vocabulary for `WorldState.economic_stability` (BACKLOG B7).
 *
 * The field is a free string: the adjudicator writes it via a 'world' delta
 * whose `reason` IS the new value (ai/core/engine.ts), so the model may say
 * "Collapsing" where an authored trigger checks for "Failing" - and an
 * exact-match trigger then goes silently dormant. This module is the single
 * read-side seam: every authored trigger (constants/events.ts) asks about the
 * economy through `economicStabilityGrade` / `isEconomyAtOrWorseThan`, never
 * by comparing the raw string, so synonyms, case, whitespace, and light
 * decoration ("In Crisis", "severely strained") all land on one canonical
 * grade. The raw string itself is never rewritten here - the Header and the
 * Empire tab still show exactly what the fiction said.
 *
 * Pure; no state. Unknown values normalize to `null`, and every predicate
 * treats `null` as "not at that grade" (an unrecognized value fires
 * nothing rather than guessing).
 */

/** Canonical grades, best to worst. Order is load-bearing (severity rank). */
export const ECONOMIC_STABILITY_GRADES = ['Prosperous', 'Stable', 'Strained', 'Failing', 'Crisis'] as const;
export type EconomicStabilityGrade = typeof ECONOMIC_STABILITY_GRADES[number];

/**
 * Synonym table (lowercase). Each canonical grade maps to itself implicitly.
 * Multi-word phrases are matched against the whole normalized value first;
 * otherwise the value is cut at its first clause break ("from", "but",
 * "despite", ...) and the LAST recognized word of the head clause wins -
 * English puts the head after its modifiers, so "Severe crisis" reads as
 * Crisis and "Recovering from crisis" reads as the recovery, not the crisis.
 */
const SYNONYMS: Record<EconomicStabilityGrade, readonly string[]> = {
    Prosperous: [
        'prosperous', 'prosperity', 'booming', 'boom', 'flourishing', 'thriving', 'robust',
        'strong', 'abundant', 'abundance', 'golden', 'wealthy', 'rich', 'excellent',
    ],
    Stable: [
        'stable', 'steady', 'sound', 'secure', 'balanced', 'healthy', 'calm', 'solid',
        'moderate', 'adequate', 'normal', 'fair', 'good', 'recovered',
    ],
    Strained: [
        'strained', 'strain', 'uncertain', 'shaky', 'fragile', 'weak', 'weakened', 'wavering',
        'declining', 'decline', 'troubled', 'stagnant', 'stagnating', 'tense', 'precarious',
        'unstable', 'volatile', 'faltering', 'struggling', 'recovering', 'sluggish', 'pressured',
        'tight', 'inflationary', 'inflation', 'slipping', 'poor',
        'under strain', 'under pressure', 'in decline',
    ],
    Failing: [
        'failing', 'failed', 'dire', 'severe', 'crumbling', 'deteriorating', 'depressed',
        'depression', 'desperate', 'critical', 'plummeting', 'dismal', 'grim', 'starving',
        'near collapse', 'nearing collapse', 'on the brink', 'on the verge of collapse',
        'brink of collapse', 'verge of collapse', 'in freefall', 'free fall',
    ],
    Crisis: [
        'crisis', 'collapse', 'collapsed', 'collapsing', 'ruined', 'ruin', 'ruinous', 'ruins',
        'catastrophic', 'catastrophe', 'chaos', 'chaotic', 'bankrupt', 'bankruptcy', 'insolvent',
        'broken', 'shattered', 'famine', 'destitute', 'devastated', 'disastrous', 'disaster',
        'meltdown', 'in ruins', 'total collapse', 'in crisis',
    ],
};

const PHRASE_TO_GRADE = new Map<string, EconomicStabilityGrade>();
const WORD_TO_GRADE = new Map<string, EconomicStabilityGrade>();
for (const grade of ECONOMIC_STABILITY_GRADES) {
    for (const term of [grade.toLowerCase(), ...SYNONYMS[grade]]) {
        const prior = PHRASE_TO_GRADE.get(term);
        if (prior !== undefined && prior !== grade) {
            throw new Error(`stabilityVocabulary: "${term}" is mapped to two grades`);
        }
        PHRASE_TO_GRADE.set(term, grade);
        if (!term.includes(' ')) WORD_TO_GRADE.set(term, grade);
    }
}
/** Multi-word phrases, longest first so "on the verge of collapse" beats "collapse". */
const PHRASES = [...PHRASE_TO_GRADE.keys()].filter(t => t.includes(' ')).sort((a, b) => b.length - a.length);

/** Words that end the head clause: what follows is context, not the grade. */
const CLAUSE_BREAKS = new Set(['from', 'after', 'following', 'despite', 'but', 'though', 'although', 'yet', 'since', 'amid', 'amidst']);

/** Lowercase, strip punctuation to spaces, collapse whitespace, trim. */
function normalizeText(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/**
 * Maps a free-string economic_stability value onto its canonical grade, or
 * `null` when no term is recognized. Tolerant of case, whitespace,
 * punctuation, and surrounding modifiers ("Severely Strained", "- in crisis -",
 * "Recovering from famine").
 */
export function economicStabilityGrade(raw: string | null | undefined): EconomicStabilityGrade | null {
    if (typeof raw !== 'string') return null;
    const text = normalizeText(raw);
    if (!text) return null;
    const exact = PHRASE_TO_GRADE.get(text);
    if (exact) return exact;
    const words = text.split(' ');
    const breakAt = words.findIndex((w, i) => i > 0 && CLAUSE_BREAKS.has(w));
    const head = breakAt === -1 ? words : words.slice(0, breakAt);
    const padded = ` ${head.join(' ')} `;
    for (const phrase of PHRASES) {
        if (padded.includes(` ${phrase} `)) return PHRASE_TO_GRADE.get(phrase)!;
    }
    for (let i = head.length - 1; i >= 0; i--) {
        const grade = WORD_TO_GRADE.get(head[i]);
        if (grade) return grade;
    }
    return null;
}

/** Severity rank: 0 = Prosperous ... 4 = Crisis. */
export function economicSeverity(grade: EconomicStabilityGrade): number {
    return ECONOMIC_STABILITY_GRADES.indexOf(grade);
}

/**
 * Whether the raw economic_stability value is at `threshold` or worse
 * (e.g. `isEconomyAtOrWorseThan(ws.economic_stability, 'Failing')` is true for
 * Failing AND Crisis and every synonym of either). Unrecognized -> false.
 */
export function isEconomyAtOrWorseThan(raw: string | null | undefined, threshold: EconomicStabilityGrade): boolean {
    const grade = economicStabilityGrade(raw);
    return grade !== null && economicSeverity(grade) >= economicSeverity(threshold);
}

/** Every recognized term (canonical + synonyms) - exported for tests. */
export function recognizedEconomicTerms(): ReadonlyMap<string, EconomicStabilityGrade> {
    return PHRASE_TO_GRADE;
}

/**
 * Clamps a macro `economic_stability` transition to at most one canonical grade
 * step per turn along `ECONOMIC_STABILITY_GRADES` (`Prosperous` <-> `Stable`
 * <-> `Strained` <-> `Failing` <-> `Crisis`). When the shift is already within
 * one grade (or either side is unrecognized free prose), the proposed string
 * passes through unchanged; otherwise the return steps by ±1 toward `proposed`.
 */
export function stepEconomicStability(
    current: string | null | undefined,
    proposed: string,
): {
    next: string;
    clamped: boolean;
    fromGrade: EconomicStabilityGrade | null;
    toGrade: EconomicStabilityGrade | null;
} {
    const fromGrade = economicStabilityGrade(current);
    const toGrade = economicStabilityGrade(proposed);
    if (!fromGrade || !toGrade) {
        return { next: proposed, clamped: false, fromGrade, toGrade };
    }
    const fromIdx = economicSeverity(fromGrade);
    const toIdx = economicSeverity(toGrade);
    const delta = toIdx - fromIdx;
    if (Math.abs(delta) <= 1) {
        return { next: proposed, clamped: false, fromGrade, toGrade };
    }
    const steppedGrade = ECONOMIC_STABILITY_GRADES[fromIdx + Math.sign(delta)];
    return { next: steppedGrade, clamped: true, fromGrade, toGrade };
}

export type RomanSeason = 'winter' | 'harvest' | 'ordinary';

/**
 * Deterministic seasonal economic rhythm tied to calendar week (1..52).
 * Late winter / year-end solstice (`week === 52`) applies mild unmitigated
 * lean-season pressure when the adjudicator emitted no economic change this
 * turn, nudging `Prosperous -> Stable` or `Stable -> Strained` (never worse
 * than `Strained` on seasonal cadence alone).
 */
export function seasonalEconomicPressure(
    week: number,
    current: string | null | undefined,
): { driftTo: EconomicStabilityGrade | null; season: RomanSeason; reason: string | null } {
    const normalizedWeek = Number.isFinite(week) ? ((((Math.trunc(week) - 1) % 52) + 52) % 52) + 1 : 1;
    const season: RomanSeason = (normalizedWeek >= 48 || normalizedWeek <= 4)
        ? 'winter'
        : (normalizedWeek >= 32 && normalizedWeek <= 38 ? 'harvest' : 'ordinary');

    if (normalizedWeek !== 52) {
        return { driftTo: null, season, reason: null };
    }
    const grade = economicStabilityGrade(current);
    if (grade === 'Prosperous') {
        return {
            driftTo: 'Stable',
            season,
            reason: 'Midwinter shipping halts and grain stores thin toward ordinary supply.',
        };
    }
    if (grade === 'Stable') {
        return {
            driftTo: 'Strained',
            season,
            reason: 'Midwinter shipping halts and granary drawdowns strain the treasury.',
        };
    }
    return { driftTo: null, season, reason: null };
}
