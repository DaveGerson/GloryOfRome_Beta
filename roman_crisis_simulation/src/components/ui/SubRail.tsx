import React from 'react';

/**
 * The panel's sub-rail (audit items 34–37). Four tabs mix two kinds of thing —
 * Assets (spendable / hedged / secrets), Reports (corroboration / chronology),
 * Empire (streets / the world), Chronicle (every week / authored events) — and
 * all four want the same device: one small register switch.
 *
 * Only those four get one. World, Events and Personae stay single-register.
 *
 * It must read QUIETER than the Tyrian pennant tab bar above it or the
 * hierarchy collapses: no metal, no pennant, just a gold wash and a 2px
 * underline on the active register.
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
    <div className="gor-subrail" role="tablist" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
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
