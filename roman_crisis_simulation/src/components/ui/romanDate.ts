import { toRoman } from './Brand';

/**
 * The Roman date a game week falls on (audit item 14). The week ribbon says
 * "Week VI"; it should also say *when* that is, the way a Roman would have
 * said it — "III Kalends of April · 988 AUC".
 *
 * Ceremony only. Roman numerals here are the reckoning ("III Kalends"), never
 * a quantity the player does arithmetic on — money and counts stay Arabic
 * (see WP-9, which removes `toRoman` from prices).
 */

/** Rome was founded in 753 BC, so an AUC year is the Julian year plus 753. */
export const AUC_EPOCH_OFFSET = 753;

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Julian lengths — the simulation never runs a leap day, so February is 28. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * March, May, July and October keep the older reckoning: Nones on the 7th and
 * Ides on the 15th rather than the 5th and 13th.
 */
const LONG_RECKONING_MONTHS = new Set([2, 4, 6, 9]); // zero-based March, May, July, October

const nonesOf = (monthIndex: number): number => (LONG_RECKONING_MONTHS.has(monthIndex) ? 7 : 5);
const idesOf = (monthIndex: number): number => (LONG_RECKONING_MONTHS.has(monthIndex) ? 15 : 13);

/** The playable year is 52 seven-day weeks; anything past that wraps. */
const DAYS_IN_PLAYABLE_YEAR = 364;

/** Week 1 opens on the Kalends of January; each week advances seven days. */
function dayOfYearForWeek(week: number): number {
    const zeroBased = Math.max(1, Math.round(week)) - 1;
    return ((zeroBased * 7) % DAYS_IN_PLAYABLE_YEAR) + 1;
}

function toMonthAndDay(dayOfYear: number): { monthIndex: number; day: number } {
    let remaining = dayOfYear;
    for (let monthIndex = 0; monthIndex < MONTH_LENGTHS.length; monthIndex++) {
        if (remaining <= MONTH_LENGTHS[monthIndex]) return { monthIndex, day: remaining };
        remaining -= MONTH_LENGTHS[monthIndex];
    }
    // Unreachable for a day inside the 364-day playable year, but a December
    // date is the right answer for any overflow rather than a throw.
    return { monthIndex: 11, day: MONTH_LENGTHS[11] };
}

/**
 * Roman dates count backwards, inclusively, toward the next Kalends, Nones or
 * Ides: the day before a feast is `Pridie`, two days before is `III`, and the
 * feast itself carries no numeral.
 */
function countedTowards(count: number, feast: string, month: string): string {
    if (count === 1) return `${feast} of ${month}`;
    if (count === 2) return `Pridie ${feast} of ${month}`;
    return `${toRoman(count)} ${feast} of ${month}`;
}

export interface RomanDate {
    /** "III Kalends of April · 988 AUC" — the ribbon's second line. */
    roman: string;
    /** "30 March, Year 235" — the `title`, for anyone who wants the plain fact. */
    plain: string;
    /** The Julian year rendered ab urbe condita. */
    auc: number;
}

/**
 * Renders `worldState.week` / `worldState.year` as a Roman date. Pure: the
 * same week and year always produce the same string, so a ribbon written in
 * week VI still reads as week VI a reign later.
 */
export function romanDate(week: number, year: number): RomanDate {
    const { monthIndex, day } = toMonthAndDay(dayOfYearForWeek(week));
    const month = MONTHS[monthIndex];
    const nones = nonesOf(monthIndex);
    const ides = idesOf(monthIndex);
    const auc = Math.round(year) + AUC_EPOCH_OFFSET;

    let reckoning: string;
    if (day === 1) {
        reckoning = `Kalends of ${month}`;
    } else if (day <= nones) {
        reckoning = countedTowards(nones - day + 1, 'Nones', month);
    } else if (day <= ides) {
        reckoning = countedTowards(ides - day + 1, 'Ides', month);
    } else {
        // Counted toward the Kalends of the FOLLOWING month, so the count
        // spans the rest of this month plus the Kalends itself.
        const nextMonth = MONTHS[(monthIndex + 1) % MONTHS.length];
        reckoning = countedTowards(MONTH_LENGTHS[monthIndex] - day + 2, 'Kalends', nextMonth);
    }

    return {
        roman: `${reckoning} · ${auc} AUC`,
        plain: `${day} ${month}, Year ${Math.round(year)}`,
        auc,
    };
}
