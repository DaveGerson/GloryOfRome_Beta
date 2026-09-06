/**
 * components/tabs/resourceDescriptors.ts — what each resource IS on the
 * Assets tab (audit item 34; D46).
 *
 * `ResourcesTab` used to derive all three of these facts from the key string:
 * the label came from `key.replace(/_/g,' ')` (so the panel read "blackmail on
 * maximinus thrax"), the bucket came from `directAssetKeys.some(k => key.includes(k))`
 * (substring matching on resource keys), and — the live bug — the unit came
 * from the VALUE: a percent suffix gated on `!Number.isInteger(value)`, so 62.5
 * rendered "62.5%" and 80 rendered "80", the same quantity in two units.
 *
 * A unit is a property of the resource, never of the number that happens to be
 * in it. Since D46 the three facts are declared ONCE, in the canonical
 * registry (ai/core/resourceRegistry.ts) that the engine, the ledger, the
 * exchequer and the adjudicator's briefs all read - one owner per fact (D44).
 * This module is the view's thin adapter over it: it maps a registry CATEGORY
 * onto the tab's REGISTER and keeps the two rendering helpers the tab and its
 * tests already use.
 */

import { classifyResourceKey, ResourceCategory, ResourceUnit } from '../../ai/core/resourceRegistry';

export type { ResourceUnit } from '../../ai/core/resourceRegistry';

/**
 * Which register of the Assets tab a resource belongs to. `ledger` is the
 * treasury and everything spent from or owed against it (coin, intel, debt);
 * `holdings` is the inventory of men and property; `standing` the 0-100
 * meters; `leverage` the shelf of sealed letters. The fifth register,
 * `exchequer`, holds no resources of its own - it is the converter's home.
 */
export type ResourceRegister = 'ledger' | 'holdings' | 'standing' | 'leverage' | 'exchequer';

const REGISTER_FOR_CATEGORY: Record<ResourceCategory, ResourceRegister> = {
  coin: 'ledger',
  debt: 'ledger',
  intel: 'ledger',
  forces: 'holdings',
  holdings: 'holdings',
  standing: 'standing',
  leverage: 'leverage',
};

export interface ResourceDescriptor {
  label: string;
  unit: ResourceUnit;
  register: ResourceRegister;
  category: ResourceCategory;
  gloss: string;
  /** Countable resources small enough to draw as coin pips rather than a numeral. */
  pips?: boolean;
  /** True when the registry declares no such kind and the label/register were inferred from the key alone. */
  inferred?: boolean;
}

/**
 * The descriptor for a resource key. Unknown keys — the model may mint one —
 * fall back to a titled label and a register inferred from the KEY, but NEVER
 * to an inferred unit: an undeclared resource is written exactly as it is
 * stored (D44).
 */
export function describeResource(key: string): ResourceDescriptor {
  const kind = classifyResourceKey(key);
  return {
    label: kind.label,
    unit: kind.unit,
    register: REGISTER_FOR_CATEGORY[kind.category],
    category: kind.category,
    gloss: kind.gloss,
    ...(kind.pips ? { pips: true } : {}),
    ...(kind.inferred ? { inferred: true } : {}),
  };
}

/** How a value is written, given its declared unit. Never inferred from the value. */
export function formatResourceValue(value: string | number | string[], unit: ResourceUnit): string {
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value !== 'number') return String(value);
  switch (unit) {
    case 'money':
      return value.toLocaleString('en-US');
    case 'percent':
      return `${value.toLocaleString('en-US')}%`;
    case 'count':
    case 'scale':
    case 'words':
      return value.toLocaleString('en-US');
  }
}
