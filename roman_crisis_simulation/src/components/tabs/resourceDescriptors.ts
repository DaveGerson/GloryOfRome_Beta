/**
 * components/tabs/resourceDescriptors.ts — what each resource IS (audit item 34).
 *
 * `ResourcesTab` used to derive all three of these facts from the key string:
 * the label came from `key.replace(/_/g,' ')` (so the panel read "blackmail on
 * maximinus thrax"), the bucket came from `directAssetKeys.some(k => key.includes(k))`
 * (substring matching on resource keys), and — the live bug — the unit came
 * from the VALUE: a percent suffix gated on `!Number.isInteger(value)`, so 62.5
 * rendered "62.5%" and 80 rendered "80", the same quantity in two units.
 *
 * A unit is a property of the resource, never of the number that happens to be
 * in it. All three facts now live here, declared once per resource.
 */

/** Which register of the Assets tab a resource belongs to. */
export type ResourceRegister = 'coin' | 'standing' | 'leverage';

/** How a value is written, and how it is drawn. */
export type ResourceUnit =
  /** A whole countable thing — coins, investigations. Arabic, tabular. */
  | 'count'
  /** Denarii and the like — Arabic with thousands separators. */
  | 'money'
  /** A 0-100 proportion. The ONLY unit that takes a percent sign. */
  | 'percent'
  /** A 0-100 standing with no natural unit — drawn as a meter, written bare. */
  | 'scale'
  /** Free prose the model wrote. */
  | 'words';

export interface ResourceDescriptor {
  label: string;
  unit: ResourceUnit;
  register: ResourceRegister;
  gloss: string;
  /** Countable resources small enough to draw as coin pips rather than a numeral. */
  pips?: boolean;
}

const DESCRIPTORS: Record<string, ResourceDescriptor> = {
  denarii: {
    label: 'Denarii', unit: 'money', register: 'coin',
    gloss: 'Your personal liquid currency, used for bribes, payments, and general expenses.',
  },
  personal_fortune: {
    label: 'Personal fortune', unit: 'money', register: 'coin',
    gloss: 'Your total estimated wealth, including property and assets. Not easily spent.',
  },
  investigations: {
    label: 'Investigations', unit: 'count', register: 'coin', pips: true,
    gloss: 'Your capacity to conduct espionage. Spend these to uncover secrets, schemes, or beliefs of other characters.',
  },
  deep_analyses: {
    label: 'Deep analyses', unit: 'count', register: 'coin', pips: true,
    gloss: 'Opportunities to gain in-depth, strategic understanding of a situation or character. A rare and valuable resource for making critical decisions.',
  },
  legion_support: {
    label: 'Legion support', unit: 'scale', register: 'standing',
    gloss: 'The level of loyalty and support you command from the legions. A critical resource for military actions.',
  },
  senatorial_support: {
    label: 'Senatorial support', unit: 'scale', register: 'standing',
    gloss: 'Your influence within the Senate. Higher support makes it easier to pass legislation and persuade senators.',
  },
  political_influence: {
    label: 'Political influence', unit: 'scale', register: 'standing',
    gloss: 'A measure of your general sway and power within the political landscape of Rome.',
  },
  legitimacy: {
    label: 'Legitimacy', unit: 'scale', register: 'standing',
    gloss: 'The degree to which your authority is seen as rightful and just by the people and institutions of Rome.',
  },
  military_might: {
    label: 'Military might', unit: 'scale', register: 'standing',
    gloss: 'The raw power and readiness of military forces aligned with this faction.',
  },
  collective_wealth: {
    label: 'Collective wealth', unit: 'money', register: 'coin',
    gloss: 'The combined financial power of a faction or group.',
  },
};

/** Blackmail keys are `blackmail_on_<entity_id>` — one per person held. */
const BLACKMAIL_PREFIX = 'blackmail_on_';

const titleCase = (words: string): string =>
  words.split(' ').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/**
 * The descriptor for a resource key. Unknown keys — the model may mint one —
 * fall back to a titled label and the standing register, but NEVER to an
 * inferred unit: an undeclared resource is written exactly as it is stored.
 */
export function describeResource(key: string): ResourceDescriptor {
  const declared = DESCRIPTORS[key];
  if (declared) return declared;

  if (key.startsWith(BLACKMAIL_PREFIX)) {
    const target = titleCase(key.slice(BLACKMAIL_PREFIX.length).replace(/_/g, ' '));
    return {
      label: target,
      unit: 'words',
      register: 'leverage',
      gloss: `Leverage gained over ${target} through their secrets. Can be used for coercion.`,
    };
  }

  return {
    label: titleCase(key.replace(/_/g, ' ')),
    unit: 'count',
    register: 'standing',
    gloss: 'A measure of your influence or assets.',
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
