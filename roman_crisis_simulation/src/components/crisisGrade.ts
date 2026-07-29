import type { SimulationState } from '../types';

/**
 * How loudly the crisis banner speaks (audit item 15). A grain shortage and
 * the Praetorians at the door used to share one banner, so by week three the
 * player stopped reading it.
 *
 *  - `murmur`      — something is wrong, but the state of Rome is not
 *  - `crisis`      — the banner as shipped
 *  - `at_the_door` — the crisis IS the state of Rome
 */
export type CrisisGrade = 'murmur' | 'crisis' | 'at_the_door';

const GRADE_RANK: Record<CrisisGrade, number> = { murmur: 0, crisis: 1, at_the_door: 2 };

/**
 * The macro state each closed enum implies on its own. Deliberately derived
 * from the four modelled enums rather than read out of `major_ongoing_crisis`
 * — that field is free prose and grading it by keyword would mean the banner
 * changed volume because the model chose a different noun.
 */
const IMPERIAL_GRADE: Record<SimulationState['imperial_status'], CrisisGrade> = {
    Stable: 'murmur',
    Contested: 'crisis',
    Vacant: 'at_the_door',
};
const SENATE_GRADE: Record<SimulationState['senate_status'], CrisisGrade> = {
    Ascendant: 'murmur',
    Functional: 'murmur',
    Deposed: 'crisis',
    Irrelevant: 'crisis',
};
const MILITARY_GRADE: Record<SimulationState['military_status'], CrisisGrade> = {
    Loyal: 'murmur',
    Divided: 'crisis',
    Rebellious: 'at_the_door',
};
const PLEBEIAN_GRADE: Record<SimulationState['plebeian_mood'], CrisisGrade> = {
    Content: 'murmur',
    Uneasy: 'murmur',
    Rioting: 'crisis',
};

const louder = (a: CrisisGrade, b: CrisisGrade): CrisisGrade => (GRADE_RANK[a] >= GRADE_RANK[b] ? a : b);

/**
 * The grade the four macro enums imply. Exported for tests and for anything
 * that wants the fallback without the model's own opinion.
 */
export function deriveCrisisGrade(state: SimulationState): CrisisGrade {
    return [
        IMPERIAL_GRADE[state.imperial_status],
        SENATE_GRADE[state.senate_status],
        MILITARY_GRADE[state.military_status],
        PLEBEIAN_GRADE[state.plebeian_mood],
    ].reduce(louder, 'murmur');
}

/**
 * The banner's grade, or `null` when there is no crisis to announce.
 *
 * `crisis_severity` is optional on the interchange (the model may omit it,
 * and every save written before this pass lacks it), so the derived grade is
 * the floor rather than the exception: whichever of the two is LOUDER wins.
 * A model that calls a rebellion a murmur cannot quiet the banner, and a
 * model that hears the Praetorians before the enums move can still raise it.
 */
export function crisisGrade(state: SimulationState): CrisisGrade | null {
    if (!state.major_ongoing_crisis) return null;
    const derived = deriveCrisisGrade(state);
    return state.crisis_severity ? louder(state.crisis_severity, derived) : derived;
}
