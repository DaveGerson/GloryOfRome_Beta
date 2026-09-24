/**
 * ai/core/actionFeasibility.ts
 *
 * General resource feasibility processing for activities across the simulation:
 * - Evaluates whether an activity requires resources (financial, military, espionage, senatorial)
 * - Checks whether an agent (player or NPC) possesses the required resources
 * - Excludes activities requiring resources the agent lacks
 * - Includes feasible activities and non-resource-dependent activities
 */

import { Entity } from '../../types';

export type ResourceRequirementCategory = 'financial' | 'military' | 'espionage' | 'senatorial';

export interface ResourceRequirementRule {
  category: ResourceRequirementCategory;
  requiredResourceKeys: string[];
  pattern: RegExp;
}

export const FINANCIAL_ACTION_REGEX = /\b(?:brib\w*|bribery|pay\s*off\w*|donative\w*|(?:buy|purchase)\s+(?:the\s+)?(?:loyalty|support)|hire\s+(?:mercenar\w*|informant\w*|assassin\w*|sp\w+|guard\w*)|pay\s+(?:(?:off|out|to|the)\s+)*(?:senat\w*|guard\w*|praetorian\w*|legion\w*|soldier\w*|mob|cohort\w*|troops?|informant\w*|sp\w+))\b/i;

export const MILITARY_ACTION_REGEX = /\b(?:march\s+(?:the\s+)?legions?|order\s+(?:the\s+)?(?:legions?|cohorts?)\s+to\s+(?:attack|seize|advance|march)|deploy\s+(?:the\s+)?legions?|enforce\s+martial\s+law|command\s+(?:the\s+)?cohorts?\s+to\s+seize|besiege\s+(?:the\s+)?(?:palace|curia|camp|city))\b/i;

export const ESPIONAGE_ACTION_REGEX = /\b(?:deploy\s+(?:an?\s+)?(?:informant|spy)\s+network|commission\s+(?:a\s+)?deep\s+(?:investigation|analysis)|infiltrate\s+undercover\s+agents?|intercept\s+(?:secret|coded)\s+dispatches)\b/i;

export const SENATORIAL_ACTION_REGEX = /\b(?:convene\s+(?:the\s+)?senate\s+to\s+pass|pass\s+(?:a\s+)?senatorial\s+decree|enact\s+(?:a\s+)?senatorial\s+bill|call\s+(?:a\s+)?senatorial\s+vote\s+to\s+strip|declare\s+(?:someone\s+)?(?:a\s+)?hostis\s+publicus)\b/i;

export const RESOURCE_REQUIREMENT_RULES: readonly ResourceRequirementRule[] = [
  {
    category: 'financial',
    requiredResourceKeys: ['denarii', 'personal_fortune'],
    pattern: FINANCIAL_ACTION_REGEX,
  },
  {
    category: 'military',
    requiredResourceKeys: ['legion_support', 'military_might'],
    pattern: MILITARY_ACTION_REGEX,
  },
  {
    category: 'espionage',
    requiredResourceKeys: ['investigations', 'deep_analyses'],
    pattern: ESPIONAGE_ACTION_REGEX,
  },
  {
    category: 'senatorial',
    requiredResourceKeys: ['senatorial_support', 'legitimacy'],
    pattern: SENATORIAL_ACTION_REGEX,
  },
] as const;

/**
 * Checks whether an activity requires specific resources.
 * Returns the matching rule or null if the activity requires no systemic resources.
 */
export function getActivityResourceRequirement(activity: string): ResourceRequirementRule | null {
  for (const rule of RESOURCE_REQUIREMENT_RULES) {
    if (rule.pattern.test(activity)) {
      return rule;
    }
  }
  return null;
}

/**
 * Checks if an entity possesses sufficient resources to perform an activity.
 * Returns true if:
 * 1. The activity requires no resources (e.g. personal speech, negotiation, meeting).
 * 2. The activity requires resources AND the entity has at least one of the required resources (> 0).
 */
export function isActivityFeasible(activity: string, entity: Entity): boolean {
  const requirement = getActivityResourceRequirement(activity);
  if (!requirement) {
    return true; // Resource-free activity
  }

  return requirement.requiredResourceKeys.some(key => {
    const val = entity.resources?.[key];
    return typeof val === 'number' && val > 0;
  });
}

/**
 * Filters a list of suggested actions, excluding any activity that requires resources
 * the player lacks, and replacing it with feasible actions tailored to their assets
 * or resource-free actions.
 */
export function filterFeasibleSuggestedActions(suggestedActions: string[], player: Entity): string[] {
  const militaryFallbacks = [
    'Rally the frontier legions to demand concessions',
    'Intimidate the opposition through a show of military force',
    'Assert martial authority over the barracks',
  ];
  const intrigueFallbacks = [
    "Deploy informants to expose your rivals' secrets",
    'Use whispered blackmail to force cooperation',
    'Spread destabilizing rumors through the Suburra',
  ];
  const senatorialFallbacks = [
    'Rally senatorial allies to form a voting bloc',
    'Deliver an oration to the Conscript Fathers',
    'Privately lobby senior senators in the Curia',
  ];
  const financialFallbacks = [
    'Offer financial incentives to wavering allies',
    'Fund public distribution to earn favor',
    'Purchase supplies to consolidate loyalty',
  ];
  const generalFallbacks = [
    'Demand concessions through personal authority',
    'Rally loyal followers to your banner',
    'Consolidate your influence among trusted allies',
    'Address the people assembled in the Forum',
    'Send a private envoy to test allegiances',
  ];

  const hasMilitary = (typeof player.resources?.legion_support === 'number' && player.resources.legion_support > 0)
    || (typeof player.resources?.military_might === 'number' && player.resources.military_might > 0);
  const hasIntrigue = (typeof player.resources?.investigations === 'number' && player.resources.investigations > 0)
    || (typeof player.resources?.deep_analyses === 'number' && player.resources.deep_analyses > 0);
  const hasSenatorial = (typeof player.resources?.senatorial_support === 'number' && player.resources.senatorial_support > 0)
    || (typeof player.resources?.legitimacy === 'number' && player.resources.legitimacy > 0);
  const hasFinancial = (typeof player.resources?.denarii === 'number' && player.resources.denarii > 0)
    || (typeof player.resources?.personal_fortune === 'number' && player.resources.personal_fortune > 0);

  const fallbackPool: string[] = [];
  if (hasMilitary) fallbackPool.push(...militaryFallbacks);
  if (hasIntrigue) fallbackPool.push(...intrigueFallbacks);
  if (hasSenatorial) fallbackPool.push(...senatorialFallbacks);
  if (hasFinancial) fallbackPool.push(...financialFallbacks);
  fallbackPool.push(...generalFallbacks);

  let fallbackIndex = 0;
  const result: string[] = [];
  const seen = new Set<string>();

  for (const action of suggestedActions) {
    if (isActivityFeasible(action, player)) {
      if (!seen.has(action)) {
        seen.add(action);
        result.push(action);
      }
    } else {
      // Activity requires resources the player lacks: exclude and replace with a feasible alternative
      while (fallbackIndex < fallbackPool.length && seen.has(fallbackPool[fallbackIndex])) {
        fallbackIndex++;
      }
      const replacement = fallbackPool[fallbackIndex % fallbackPool.length];
      fallbackIndex++;
      if (!seen.has(replacement)) {
        seen.add(replacement);
        result.push(replacement);
      }
    }
  }

  return result;
}
