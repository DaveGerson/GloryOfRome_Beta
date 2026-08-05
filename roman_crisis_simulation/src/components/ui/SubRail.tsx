import React from 'react';

/**
 * The panel's sub-rail (audit items 34–37). Five tabs mix two kinds of thing —
 * Assets (coin / standing / leverage), Reports (corroboration / chronology),
 * Empire (streets / the world), Chronicle (every week / authored events),
 * Events (this week / examined) — and all five want the same device: one small
 * register switch. World and Personae stay single-register.
 *
 * It must read QUIETER than the Tyrian pennant tab bar above it or the
 * hierarchy collapses: no metal, no pennant, just a gold wash and a 2px
 * underline on the active register.
 *
 * **A group of toggle buttons, deliberately NOT a tablist.** This shipped as
 * `role="tablist"` / `role="tab"` / `aria-selected` and honoured none of it:
 * no roving tabindex, no arrow keys, and no `aria-controls` to any
 * `role="tabpanel"`. The tab roles are gone rather than completed, for three
 * reasons, in order of weight:
 *
 *  1. **The panel is not ours to name.** SubRail renders the rail; the region
 *     below it belongs to five different callers. `aria-controls` needs an id
 *     on a `role="tabpanel"` those callers own, so the tab contract cannot be
 *     completed from inside this file — and a tablist that will never point at
 *     a tabpanel is the same unkept promise, one keyboard handler richer.
 *  2. **They do not behave like tabs.** Assets puts its ❧ Glossary toggle
 *     BETWEEN the rail and the register, and Events' registers filter one list
 *     that also carries a standing instruction — in neither case is the thing
 *     below the rail a single discrete panel.
 *  3. **The tablist above is real.** `SidePanel` already declares one for the
 *     seven dashboard tabs; a second tablist nested inside one of its tabs
 *     made every `button[role="tab"]` sweep ambiguous for no gain.
 *
 * `aria-pressed` claims exactly what a pressed button delivers, and needs no
 * roving tabindex to be honest: a group of toggle buttons is SUPPOSED to put
 * each button in the tab order. That is why this does not reuse
 * `ui/rovingRadio.ts` — the radiogroups it serves genuinely are one control
 * with one tab stop, and these are not.
 */

export interface SubRailOption<T extends string> {
  value: T;
  label: string;
  /** Sits inline after the label. */
  count?: number;
  /** True when the count is leverage — it reads crimson rather than parchment. */
  countIsLeverage?: boolean;
}

export function SubRail<T extends string>({ options, value, onChange, ariaLabel }: {
  options: readonly SubRailOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="gor-subrail" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={`gor-subrail-btn${option.value === value ? ' gor-subrail-btn-on' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === 'number' && (
            <span className={`gor-subrail-count${option.countIsLeverage ? ' gor-subrail-count-leverage' : ''}`}>{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
