/**
 * ai/core/resourceRegistry.ts
 *
 * The CANONICAL RESOURCE REGISTRY (DESIGN_DECISIONS.md D46, growing D6's
 * "small systemic registry" into a typed catalogue).
 *
 * D6 keeps the dynamic bag: the model may still mint a resource nobody
 * declared. What this module adds is that the same QUANTITY can no longer
 * live under two names. Every 'resource' delta key is folded through
 * `canonicalResourceKey` before the engine applies it (ai/core/engine.ts,
 * ai/core/economyGuard.ts), so `gold`, `money` and `coin` all land on
 * `denarii`, `soldiers` and `legionaries` on `troops`, `spies` and
 * `informants` on `agents` - and the weekly ledger (ai/core/ledger.ts), the
 * exchequer (ai/core/exchequer.ts) and the Assets tab all count one thing.
 *
 * Each canonical kind declares, once: what it is called, which CATEGORY it
 * belongs to (the Assets tab's registers and the adjudicator's brief group
 * by it), its UNIT (D44: a unit belongs to the resource, never to the
 * value), any engine-enforced floor/cap, whether the engine's arithmetic
 * touches it (`systemic`), who may know it (D5/D6: a player's own treasury
 * is objectively knowable; other entities' coin is not), any weekly
 * income/upkeep rule, and a gloss. Unknown minted keys stay allowed but are
 * CLASSIFIED into a sensible category by their name alone
 * (`classifyResourceKey`) and written exactly as stored.
 *
 * Pure and dependency-free (no I/O, no React, no AI imports) so every
 * consumer - engine, ledger, prompts, UI - can read it without forming a
 * cycle.
 *
 * TUNING (the owner tunes from these comments): the weekly figures are
 * game-scale, not antiquarian. A legionary's stipend under Severus was ~450
 * denarii a year, ~8.7 a week - 8 keeps the arithmetic honest against the
 * setting; guards and agents earn more because they are bought loyalty. A
 * great estate's yield is set so that TWO estates roughly carry a 150-man
 * household guard: the owner who tends holdings runs level, the one who
 * only raises men bleeds. See ai/core/ledger.ts for the runway rationale.
 */

// --- Categories, units, kinds ------------------------------------------------

/**
 * Where a resource lives. `coin` is spendable money and its illiquid
 * cousins; `debt` is what is owed (to creditors, or to your own men); `intel`
 * is the two gating currencies the Personae tab spends; `forces` are counted
 * men who draw wages; `holdings` are things that yield or that you simply
 * own; `standing` is a 0-100 reputation scale; `leverage` is what you hold
 * over other people.
 */
export type ResourceCategory = 'coin' | 'debt' | 'intel' | 'forces' | 'holdings' | 'standing' | 'leverage';

export const RESOURCE_CATEGORIES: readonly ResourceCategory[] = [
  'coin', 'debt', 'intel', 'forces', 'holdings', 'standing', 'leverage',
];

/** How a value is written, and how it is drawn (D44). */
export type ResourceUnit =
  /** A whole countable thing - men, ships, investigations. Arabic, tabular. */
  | 'count'
  /** Denarii and the like - Arabic with thousands separators. */
  | 'money'
  /** A 0-100 proportion. The ONLY unit that takes a percent sign. */
  | 'percent'
  /** A 0-100 standing with no natural unit - drawn as a meter, written bare. */
  | 'scale'
  /** Free prose the model wrote (a sealed letter, a secret held). */
  | 'words';

/**
 * Whether a resource is objectively knowable to anyone but its owner (D5/D6).
 * `owner`: only the holder's own Assets tab may ever state it (coin, debt,
 * intel, forces, holdings, leverage). `public`: a standing is how the world
 * sees you, so the world may remark on it.
 */
export type ResourceKnowability = 'owner' | 'public';

export interface WeeklyRule {
  /** Denarii credited per unit held, each week (holdings). */
  income?: number;
  /** Denarii debited per unit held, each week (forces). */
  upkeep?: number;
}

export interface ResourceKind {
  /** The canonical snake_case key as stored on `Entity.resources`. */
  id: string;
  /** How the player reads it. */
  label: string;
  category: ResourceCategory;
  unit: ResourceUnit;
  /** True when engine arithmetic (floor/cap, the weekly ledger, the guard) touches it. */
  systemic: boolean;
  knowable: ResourceKnowability;
  floor?: number;
  cap?: number;
  weekly?: WeeklyRule;
  /** Countable resources small enough to draw as coin pips rather than a numeral. */
  pips?: boolean;
  gloss: string;
  /** Model-minted spellings that fold into this key (canonicalResourceKey). */
  aliases?: readonly string[];
  /** True for a kind synthesised for an undeclared key - never in the catalogue. */
  inferred?: boolean;
}

// --- The catalogue --------------------------------------------------------------

/** Wages per head per week (see the module doc for the rationale). */
export const TROOP_PAY_PER_WEEK = 8;
export const GUARD_PAY_PER_WEEK = 12;
export const AGENT_PAY_PER_WEEK = 15;
/**
 * A whole legion (~5,000 men) is an imperial-scale liability: 25,000 a week
 * is a rounded 5,000 x 5, deliberately far past any preset's treasury so
 * that "raising a legion" is an act the state pays for, never a purse.
 */
export const LEGION_PAY_PER_WEEK = 25_000;
/** Yields per holding per week (see the module doc for the rationale). */
export const ESTATE_YIELD_PER_WEEK = 600;
export const SHIP_YIELD_PER_WEEK = 250;
export const WORKSHOP_YIELD_PER_WEEK = 150;

const CATALOGUE: readonly ResourceKind[] = [
  // --- coin ---
  {
    id: 'denarii', label: 'Denarii', category: 'coin', unit: 'money', systemic: true, knowable: 'owner',
    floor: 0,
    gloss: 'Your liquid coin - what bribes, donatives, wages and purchases are paid from. The engine floors it at zero; an overdraft becomes debt.',
    aliases: ['denarius', 'denari', 'gold', 'money', 'coin', 'coins', 'silver', 'cash', 'funds', 'purse', 'treasury', 'coffers', 'war_chest', 'gold_coins', 'liquid_funds', 'personal_treasury', 'personal_wealth', 'wealth'],
  },
  {
    id: 'personal_fortune', label: 'Personal fortune', category: 'coin', unit: 'money', systemic: false, knowable: 'owner',
    gloss: 'Your total estimated wealth, including property and plate. Illiquid - not spendable as coin.',
    aliases: ['fortune', 'family_fortune', 'estate_value', 'net_worth'],
  },
  {
    id: 'collective_wealth', label: 'Collective wealth', category: 'coin', unit: 'money', systemic: false, knowable: 'owner',
    gloss: 'The combined financial power of a faction or group.',
    aliases: ['faction_wealth', 'faction_treasury', 'group_wealth'],
  },
  // --- debt ---
  {
    id: 'debt_denarii', label: 'Debt', category: 'debt', unit: 'money', systemic: true, knowable: 'owner',
    floor: 0,
    gloss: 'What you owe your creditors. The engine writes it when the treasury overdraws; interest accrues weekly, and creditors press once it grows.',
    aliases: ['debt', 'debts', 'loans', 'loan', 'money_owed', 'owed_denarii', 'debts_owed'],
  },
  {
    id: 'pay_arrears', label: 'Wages owed', category: 'debt', unit: 'money', systemic: true, knowable: 'owner',
    floor: 0,
    gloss: 'Back pay owed to your own men. Unpaid soldiers grumble, then desert.',
    aliases: ['arrears', 'wages_owed', 'unpaid_wages', 'back_pay'],
  },
  // --- intel ---
  {
    id: 'investigations', label: 'Investigations', category: 'intel', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, pips: true,
    gloss: 'Your capacity to conduct espionage. Spend these on the Personae tab to uncover beliefs, schemes or secrets; they regenerate slowly, faster with agents in your pay.',
    aliases: ['investigation', 'investigation_points', 'espionage_capacity'],
  },
  {
    id: 'deep_analyses', label: 'Deep analyses', category: 'intel', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, pips: true,
    gloss: "A spymaster's synthesised assessment - the premium tier. Rare; the exchequer can commission one from three investigations.",
    aliases: ['deep_analysis', 'deep_analysis_points'],
  },
  // --- forces ---
  {
    id: 'troops', label: 'Troops', category: 'forces', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { upkeep: TROOP_PAY_PER_WEEK },
    gloss: `Soldiers under your personal command. Each draws ${TROOP_PAY_PER_WEEK} denarii a week from your treasury; unpaid men desert.`,
    aliases: ['soldiers', 'legionaries', 'legionnaires', 'men_at_arms', 'armed_men', 'fighters', 'warriors', 'veterans', 'loyal_soldiers', 'personal_troops', 'personal_army', 'army', 'militia', 'mercenaries', 'loyal_troops', 'retainers'],
  },
  {
    id: 'guards', label: 'Guards', category: 'forces', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { upkeep: GUARD_PAY_PER_WEEK },
    gloss: `Your household guard - the men between you and the knife. Each draws ${GUARD_PAY_PER_WEEK} denarii a week.`,
    aliases: ['guard', 'bodyguards', 'bodyguard', 'household_guard', 'guardsmen', 'personal_guard', 'palace_guard'],
  },
  {
    id: 'agents', label: 'Agents', category: 'forces', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { upkeep: AGENT_PAY_PER_WEEK },
    gloss: `Informants and spies on your payroll. Each draws ${AGENT_PAY_PER_WEEK} denarii a week; three of them keep an investigation regenerating every week and every three raise your ceiling by one.`,
    aliases: ['agent', 'spies', 'spy', 'informants', 'informant', 'spy_network', 'informant_network', 'agents_network', 'network_of_spies', 'operatives', 'intelligence_network', 'informers'],
  },
  {
    id: 'legions', label: 'Legions', category: 'forces', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { upkeep: LEGION_PAY_PER_WEEK },
    gloss: `Whole legions sworn to you personally - an imperial liability of ${LEGION_PAY_PER_WEEK.toLocaleString('en-US')} denarii a week each. The state pays legions; a purse cannot.`,
    aliases: ['legion', 'personal_legions', 'legions_sworn'],
  },
  {
    id: 'levy_pending', label: 'Levies mustering', category: 'forces', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0,
    gloss: 'Recruits raised at the exchequer this week. They arrive - and join your troops - at the next turn of the week.',
    aliases: ['pending_levy', 'levies_pending', 'recruits_pending'],
  },
  // --- holdings ---
  {
    id: 'estates', label: 'Estates', category: 'holdings', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { income: ESTATE_YIELD_PER_WEEK },
    gloss: `Landed estates. Each returns ${ESTATE_YIELD_PER_WEEK} denarii a week to your treasury.`,
    aliases: ['estate', 'villas', 'villa', 'lands', 'land', 'latifundia', 'farms', 'farm', 'landed_estates', 'country_estates'],
  },
  {
    id: 'ships', label: 'Ships', category: 'holdings', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { income: SHIP_YIELD_PER_WEEK },
    gloss: `Merchant hulls in your name. Each returns ${SHIP_YIELD_PER_WEEK} denarii a week - when the sea allows.`,
    aliases: ['ship', 'fleet', 'vessels', 'vessel', 'galleys', 'merchant_ships', 'trading_ships', 'merchant_fleet'],
  },
  {
    id: 'workshops', label: 'Workshops', category: 'holdings', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0, weekly: { income: WORKSHOP_YIELD_PER_WEEK },
    gloss: `Workshops, shops and warehouses. Each returns ${WORKSHOP_YIELD_PER_WEEK} denarii a week.`,
    aliases: ['workshop', 'shops', 'shop', 'warehouses', 'warehouse', 'businesses', 'business', 'tenements', 'insulae'],
  },
  // --- standing (0-100 scales; public by nature) ---
  {
    id: 'legion_support', label: 'Legion support', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'The loyalty and support you command from the legions. A critical resource for military actions; it slips while the army is divided and while your own men go unpaid.',
    aliases: ['legionary_support', 'legion_loyalty', 'legions_loyalty', 'legions_support', 'army_support', 'army_loyalty', 'military_support', 'military_loyalty', 'soldiers_loyalty', 'troop_loyalty', 'support_of_the_legions'],
  },
  {
    id: 'senatorial_support', label: 'Senatorial support', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'Your influence within the Senate. Higher support makes it easier to pass legislation and persuade senators.',
    aliases: ['senate_support', 'senate_favor', 'senate_favour', 'senatorial_favor', 'senatorial_favour', 'senate_backing', 'senatorial_backing', 'senatorial_influence'],
  },
  {
    id: 'popular_support', label: 'Popular support', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'The favour of the crowd - the plebs, the mob, the streets. It bleeds while Rome riots.',
    aliases: ['popularity', 'plebeian_support', 'plebs_support', 'public_support', 'popular_favor', 'popular_favour', 'mob_support', 'support_of_the_people', 'plebeian_favor', 'plebeian_favour'],
  },
  {
    id: 'political_influence', label: 'Political influence', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'A measure of your general sway and power within the political landscape of Rome.',
    aliases: ['influence', 'political_capital', 'political_power', 'political_sway', 'court_influence'],
  },
  {
    id: 'legitimacy', label: 'Legitimacy', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'The degree to which your authority is seen as rightful and just by the people and institutions of Rome. It erodes while the throne is contested.',
    aliases: ['imperial_legitimacy', 'claim_legitimacy', 'legitimacy_score', 'perceived_legitimacy'],
  },
  {
    id: 'military_might', label: 'Military might', category: 'standing', unit: 'scale', systemic: true, knowable: 'public',
    floor: 0, cap: 100,
    gloss: 'The raw power and readiness of the military forces aligned with you or your faction.',
    aliases: ['military_power', 'military_strength', 'martial_strength'],
  },
  // --- leverage ---
  {
    id: 'favors', label: 'Favours owed', category: 'leverage', unit: 'count', systemic: true, knowable: 'owner',
    floor: 0,
    gloss: 'Favours others owe you - a debt of gratitude you may call in. The exchequer turns one into an investigation.',
    aliases: ['favours', 'favor', 'favour', 'favors_owed', 'favours_owed', 'owed_favors', 'owed_favours', 'favors_owed_to_you', 'favours_owed_to_you', 'political_favors', 'political_favours'],
  },
];

const BY_ID: ReadonlyMap<string, ResourceKind> = new Map(CATALOGUE.map(kind => [kind.id, kind]));

const ALIAS_TO_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const kind of CATALOGUE) {
    for (const alias of kind.aliases ?? []) map.set(alias, kind.id);
  }
  return map;
})();

/** Every canonical kind, in catalogue order. */
export function listResourceKinds(): readonly ResourceKind[] {
  return CATALOGUE;
}

/** The catalogue entry for a CANONICAL key, or undefined for an undeclared one. */
export function getResourceKind(canonicalKey: string): ResourceKind | undefined {
  return BY_ID.get(canonicalKey);
}

// --- Families (pattern-keyed kinds) -----------------------------------------------

/** Leverage keys are `blackmail_on_<entity_id>` - one per person held. */
export const BLACKMAIL_PREFIX = 'blackmail_on_';
/**
 * Discrete, model-minted holdings are `holding_<slug>` (D46 convention): a
 * specific villa, a hostage, a sealed letter, an artefact, an office. Minted
 * as a 'resource' delta of +1 whose `reason` describes the thing; carries
 * no automatic yield or upkeep (the canonical productive kinds do).
 */
export const HOLDING_PREFIX = 'holding_';

/** Model spellings of the blackmail family, folded to `blackmail_on_<id>`. */
const BLACKMAIL_ALIAS_PATTERN = /^(?:blackmail_material_on|blackmail_material_against|blackmail_against|dirt_on|leverage_on|leverage_over|secrets_of|secrets_on|kompromat_on|compromising_material_on)_(.+)$/;

/** Spellings of the holding family, folded to `holding_<slug>`. */
const HOLDING_ALIAS_PATTERN = /^(?:holdings|asset|item|possession|property)_(.+)$/;

// --- Canonicalisation ----------------------------------------------------------------

/**
 * Slug-normalises a raw key the model wrote: lower-cased, spaces and dashes
 * to underscores, anything outside [a-z0-9_] dropped, runs of underscores
 * collapsed. An empty/whitespace key normalises to '' (callers treat that as
 * malformed).
 */
export function slugifyResourceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * The canonical key for any resource name the model (or a legacy save)
 * might carry: alias-folded, family-folded, slug-normalised. Idempotent -
 * `canonicalResourceKey(canonicalResourceKey(k)) === canonicalResourceKey(k)`.
 * An undeclared key comes back slug-normalised but otherwise as written (D6:
 * unknown minted keys stay allowed).
 */
export function canonicalResourceKey(raw: string): string {
  const key = slugifyResourceKey(raw);
  if (!key) return key;
  if (BY_ID.has(key)) return key;
  const alias = ALIAS_TO_ID.get(key);
  if (alias) return alias;
  if (key.startsWith(BLACKMAIL_PREFIX) || key.startsWith(HOLDING_PREFIX)) return key;
  const blackmail = BLACKMAIL_ALIAS_PATTERN.exec(key);
  if (blackmail) return `${BLACKMAIL_PREFIX}${blackmail[1]}`;
  const holding = HOLDING_ALIAS_PATTERN.exec(key);
  if (holding) return `${HOLDING_PREFIX}${holding[1]}`;
  return key;
}

// --- Classification of undeclared keys -------------------------------------------------

const titleCase = (words: string): string =>
  words.split(' ').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

const humanise = (key: string): string => titleCase(key.replace(/_/g, ' '));

/**
 * Name-shaped hints for classifying an UNDECLARED key. Ordered: the first
 * matching family wins, and leverage words are checked before standing words
 * because 'favor' reads as leverage here, not as a reputation. Deliberately
 * keyed on the NAME alone - never on the value - per D44 (a unit is a
 * property of the resource).
 */
const CLASSIFICATION_HINTS: readonly { category: ResourceCategory; unit: ResourceUnit; pattern: RegExp }[] = [
  { category: 'debt', unit: 'money', pattern: /(^|_)(debt|debts|owed|arrears|loan|loans|obligation|obligations)(_|$)/ },
  { category: 'leverage', unit: 'count', pattern: /(^|_)(blackmail|secret|secrets|letter|letters|hostage|hostages|leverage|favor|favors|favour|favours|dirt|evidence|kompromat|marker|markers|iou)(_|$)/ },
  { category: 'intel', unit: 'count', pattern: /(^|_)(investigation|investigations|analysis|analyses|intel|dossier|dossiers)(_|$)/ },
  { category: 'coin', unit: 'money', pattern: /(^|_)(denarii|sesterces|sestertii|aurei|talents|gold|silver|coin|coins|money|wealth|treasury|fortune|funds|purse|cash|bullion|savings|income|revenue|revenues|bribe_fund)(_|$)/ },
  { category: 'forces', unit: 'count', pattern: /(^|_)(troops|soldiers|men|legion|legions|cohort|cohorts|guards|guard|mercenaries|mercenary|gladiators|gladiator|warriors|followers|members|agents|spies|informants|assassins|thugs|gang|cultists|riders|horsemen|archers|marines|sailors|crew|recruits|levies|militia|retainers|clients)(_|$)/ },
  { category: 'holdings', unit: 'count', pattern: /(^|_)(estate|estates|villa|villas|ship|ships|land|lands|farm|farms|mine|mines|warehouse|warehouses|granary|granaries|workshop|workshops|property|properties|vineyard|vineyards|house|houses|holding|holdings|grain|horses|slaves|cargo|stores|supplies|weapons|arms|artefact|artefacts|artifact|artifacts|relic|relics|office|offices)(_|$)/ },
  { category: 'standing', unit: 'scale', pattern: /(^|_)(support|influence|legitimacy|loyalty|reputation|standing|prestige|morale|popularity|goodwill|authority|favor_with|respect|honor|honour|fear|renown|credibility|cohesion|discipline|piety|dignitas|auctoritas|gravitas)(_|$)/ },
];

/**
 * The kind of ANY resource key - the catalogue entry for a canonical key, or
 * a synthesised (`inferred: true`) kind for an undeclared one: a titled
 * label, a category guessed from the NAME, a count unit (never inferred
 * from the value), no engine rules. Family keys (`blackmail_on_<id>`,
 * `holding_<slug>`) get their family's label treatment.
 */
export function classifyResourceKey(rawKey: string): ResourceKind {
  const key = canonicalResourceKey(rawKey);
  const declared = BY_ID.get(key);
  if (declared) return declared;

  if (key.startsWith(BLACKMAIL_PREFIX)) {
    const target = humanise(key.slice(BLACKMAIL_PREFIX.length));
    return {
      id: key, label: target, category: 'leverage', unit: 'words', systemic: false, knowable: 'owner', inferred: true,
      gloss: `Leverage gained over ${target} through their secrets. Can be used for coercion.`,
    };
  }
  if (key.startsWith(HOLDING_PREFIX)) {
    const name = humanise(key.slice(HOLDING_PREFIX.length));
    return {
      id: key, label: name, category: 'holdings', unit: 'count', systemic: false, knowable: 'owner', inferred: true,
      gloss: 'A thing you hold in your own name. It carries no wages and no yield of its own; what it is worth is what the story makes of it.',
    };
  }

  const hint = CLASSIFICATION_HINTS.find(candidate => candidate.pattern.test(key));
  const category: ResourceCategory = hint?.category ?? 'holdings';
  const unit: ResourceUnit = hint?.unit ?? 'count';
  const gloss = category === 'standing'
    ? 'A measure of your influence, written exactly as the story recorded it.'
    : category === 'coin'
      ? 'Coin or wealth the story recorded under its own name. Only denarii are spent by the engine.'
      : category === 'forces'
        ? 'Men the story recorded under their own name. Only the canonical forces draw wages from the engine.'
        : category === 'leverage'
          ? 'Something you hold over someone, recorded as the story named it.'
          : category === 'debt'
            ? 'An obligation the story recorded under its own name.'
            : category === 'intel'
              ? 'Intelligence capacity the story recorded under its own name.'
              : 'An asset the story recorded under its own name. It carries no engine yield or upkeep.';
  return {
    id: key || rawKey, label: humanise(key || rawKey), category, unit, systemic: false, knowable: 'owner', inferred: true, gloss,
  };
}

/** A resource kind's floor/cap applied to a numeric value (no-op for kinds that declare neither). */
export function clampToKind(kind: ResourceKind, value: number): number {
  let clamped = value;
  if (kind.floor !== undefined && clamped < kind.floor) clamped = kind.floor;
  if (kind.cap !== undefined && clamped > kind.cap) clamped = kind.cap;
  return clamped;
}

/** True for a kind whose scale is the 0-100 standing meter. */
export function isStandingKind(kind: ResourceKind): boolean {
  return kind.category === 'standing' && kind.unit === 'scale';
}

// --- Normalisation of a whole bag --------------------------------------------------------

export type ResourceValue = number | string | string[];
export type ResourceBag = Record<string, ResourceValue>;

/**
 * Folds every alias in a bag onto its canonical key, merging collisions:
 * numbers add, string lists union, a string keeps the canonical key's value
 * when one already exists. Returns a NEW object (the input is never
 * mutated) whose keys follow the input's first-seen order. Idempotent.
 *
 * Applied lazily (D46 save-compat): the player's bag is folded on each
 * committed turn's ledger pass (ai/core/ledger.ts) and a roster addition's
 * bag when the engine adds it (ai/core/engine.ts) - never on load, so a
 * legacy save is read exactly as written until the game next writes it.
 */
export function normalizeResources(resources: ResourceBag): { resources: ResourceBag; folded: Array<{ from: string; to: string }> } {
  const out: ResourceBag = {};
  const folded: Array<{ from: string; to: string }> = [];
  for (const [rawKey, value] of Object.entries(resources)) {
    const key = canonicalResourceKey(rawKey) || rawKey;
    if (key !== rawKey) folded.push({ from: rawKey, to: key });
    if (!(key in out)) {
      out[key] = Array.isArray(value) ? [...value] : value;
      continue;
    }
    const existing = out[key];
    if (typeof existing === 'number' && typeof value === 'number') {
      out[key] = existing + value;
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      out[key] = Array.from(new Set([...existing, ...value]));
    } else if (Array.isArray(existing) && typeof value === 'string') {
      out[key] = Array.from(new Set([...existing, value]));
    } else if (typeof existing === 'string' && Array.isArray(value)) {
      out[key] = Array.from(new Set([existing, ...value]));
    }
    // number-vs-string collisions keep the first-seen (canonical-or-earlier) value.
  }
  return { resources: out, folded };
}

/** A numeric resource read with a zero default - the engine's one idiom for "how many". */
export function numericResource(resources: ResourceBag, key: string): number {
  const value = resources[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// --- Prompt rendering --------------------------------------------------------------------

/**
 * The compact `key:value, key:value` line the adjudicator briefs carry for an
 * entity's holdings (ai/prompts/fragments.ts). Keys are the stored keys (the
 * model must echo them on deltas); string lists render as their count so a
 * blackmail file's contents never bloat every brief.
 */
export function formatResourcesCompact(resources: ResourceBag): string {
  return Object.entries(resources)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:${value.length} item${value.length === 1 ? '' : 's'}`;
      return `${key}:${typeof value === 'number' ? value : JSON.stringify(value)}`;
    })
    .join(', ');
}

/** Arabic, tabular, with thousands separators (D44). */
export function formatArabic(value: number): string {
  return value.toLocaleString('en-US');
}
