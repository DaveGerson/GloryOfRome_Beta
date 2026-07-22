/**
 * knowledge/dossierCost.ts - the pure DOSSIER REFRESH pricing curve
 * (DESIGN_DECISIONS.md D27, refining D14). Re-investigating a target you
 * already hold a dossier on costs LESS than the first acquisition, scaled by
 * how stale the file is: a just-refreshed dossier is cheap to top up, a
 * long-cold one approaches full price again. Paid in the SAME resource the
 * first investigation used (D27) - this module never picks a currency, it
 * only scales whatever `firstAcquisitionCost` the caller passes.
 *
 * Intentionally pure (no React, no AI, no store imports), same discipline as
 * the rest of knowledge/: numbers in, a cost out, nothing mutated. The
 * staleness clock ("turns since the last refresh of that target") is derived
 * from the knowledge store by knowledge/store.ts::deriveDossier; this module
 * only turns that turn-count into a price.
 *
 * DORMANT (as of the current build): investigations are flat/unit-priced, so
 * this decay curve is NOT on the active cost path (the tab charges full
 * first-acquisition price for every buy). It reactivates once investigations
 * gain a graded (non-unit) price via the currency converter (BACKLOG.md B1) -
 * at unit price the curve can only collapse to free-or-full, which read as
 * exploitable free reveals; kept here, tested, and ready for that day.
 *
 * -------------------------------------------------------------------------
 * THE DECAY CURVE (and why - written here per D27 for the owner to veto):
 *
 *   cost(t) = floor + (full - floor) * clamp(t / coldThreshold, 0..1)
 *   where floor = full * DOSSIER_REFRESH_FLOOR_FRACTION
 *         t     = turns (weeks) since this dossier was last refreshed
 *
 * A LINEAR ramp from a floor price at t=0 up to full price at t=coldThreshold,
 * held flat at full price once cold. Three deliberate choices:
 *
 *  - LINEAR, not exponential/stepped: the discount decays one predictable
 *    notch per week. It is legible to the player (each week you wait, the
 *    top-up costs a little more) and trivial for the owner to reason about
 *    and re-tune - an exponential curve hides where the money goes.
 *
 *  - FLOOR = 20% of full price (DOSSIER_REFRESH_FLOOR_FRACTION). A file you
 *    looked at this same week is nearly free to keep current - you are paying
 *    the courier, not re-running the whole investigation. This is the point
 *    of D14/D27: keeping a warm file warm should be a cheap ongoing habit,
 *    NOT repeated full price, so the player is rewarded for steady upkeep
 *    over letting everything rot and re-buying from scratch.
 *
 *  - COLD THRESHOLD = 6 weeks (DOSSIER_COLD_THRESHOLD). Past this the world
 *    has moved on - sources have turned over, the situation has changed - so
 *    the "update" is really a fresh acquisition and pays full freight, no
 *    discount. Six weeks (~a month and a half of in-fiction time) is long
 *    enough that the intel is plausibly stale, short enough that neglect has
 *    a real cost. This rewards regular contact with a target and punishes
 *    hoarding a file you never revisit.
 *
 * INTEGER CURRENCIES (the live game today): the sole investigation currency
 * is a whole `investigations` count whose first-acquisition price is 1, so
 * callers Math.round this curve to a whole unit (see the tab wiring). At
 * full=1 the curve necessarily collapses to a two-state realization: a
 * dossier refreshed within the last ~2 weeks tops up for FREE (rounds to 0 -
 * "costs less" for a unit-priced resource can only mean 0), and from ~3 weeks
 * stale onward it costs the full 1 again. That warm-window-free / cold-full
 * behavior is the honest instance of the general curve at unit price; the
 * gradation only becomes visible once first-acquisition costs more than one
 * unit (e.g. a future denarii-priced investigation), which this helper
 * already supports. If the owner wants a non-free warm refresh, raise the
 * base investigation price so the curve has room to grade - do not special-
 * case the floor here.
 * -------------------------------------------------------------------------
 */

/**
 * Turns (weeks) after which a held dossier has gone fully cold: a refresh at
 * or beyond this staleness pays full first-acquisition price, no discount.
 * See the rationale block above. Tune here.
 */
export const DOSSIER_COLD_THRESHOLD = 6;

/**
 * The floor price of a just-refreshed dossier, as a fraction of full
 * first-acquisition price (the t=0 end of the curve). See the rationale
 * block above. Tune here.
 */
export const DOSSIER_REFRESH_FLOOR_FRACTION = 0.2;

/**
 * The refresh price of a HELD dossier, scaled by staleness (D27). Pure and
 * total.
 *
 * @param firstAcquisitionCost the full price the first acquisition paid, in
 *   whatever resource that investigation used (D27 - same currency). The
 *   returned cost is in that same unit and never exceeds it.
 * @param turnsSinceLastRefresh whole turns (weeks) since this dossier was
 *   last refreshed. Negative inputs clamp to 0 (a same-turn refresh).
 * @param coldThreshold turns of staleness at which the discount is exhausted
 *   and full price resumes; defaults to DOSSIER_COLD_THRESHOLD. A
 *   non-positive threshold means "no discount window" and returns full price.
 * @returns a cost in [floor, firstAcquisitionCost]; floor at t=0, rising
 *   linearly to full at t=coldThreshold and flat at full beyond. Monotonic
 *   non-decreasing in staleness. NOT rounded - integer-currency callers round
 *   at the spend boundary (see this module's INTEGER CURRENCIES note).
 *
 * NOTE: this prices a REFRESH only. First acquisition (the player holds no
 * dossier on this target+aspect yet) is full price and is decided by the
 * caller - it simply does not call this. See deriveDossier for the "do I hold
 * a dossier, and as of when" query that gates which branch a caller takes.
 */
export function computeRefreshCost(
  firstAcquisitionCost: number,
  turnsSinceLastRefresh: number,
  coldThreshold: number = DOSSIER_COLD_THRESHOLD
): number {
  const full = firstAcquisitionCost;
  // A missing/degenerate discount window (<= 0) means every refresh is a
  // fresh acquisition - full price, no floor.
  if (coldThreshold <= 0) return full;

  const t = Math.max(0, turnsSinceLastRefresh);
  // Cold: at or past the threshold the file is a fresh acquisition again.
  if (t >= coldThreshold) return full;

  const floor = full * DOSSIER_REFRESH_FLOOR_FRACTION;
  const staleness = t / coldThreshold; // 0 (just refreshed) .. <1 (nearly cold)
  return floor + (full - floor) * staleness;
}
