/**
 * ai/core/actionFeasibility.ts
 *
 * Ensures suggested actions offered to the player are feasible with respect
 * to their current resources (e.g. denarii, legion support).
 */

import { Entity } from '../../types';

export const FINANCIAL_ACTION_REGEX = /\b(?:brib\w*|bribery|pay\s*off\w*|donative\w*|(?:buy|purchase)\s+(?:the\s+)?(?:loyalty|support)|hire\s+(?:mercenar\w*|informant\w*|assassin\w*|sp\w+|guard\w*)|pay\s+(?:(?:off|out|to|the)\s+)*(?:senat\w*|guard\w*|praetorian\w*|legion\w*|soldier\w*|mob|cohort\w*|troops?|informant\w*|sp\w+))\b/i;

/**
 * Ensures suggestions presented to the player are feasible given their available resources.
 * If a player has 0 or negative denarii, any action suggesting financial payouts, bribes,
 * or hiring paid forces is replaced with an action leveraging their actual strengths
 * (e.g. military authority, political maneuvering, or personal influence).
 */
export function filterFeasibleSuggestedActions(suggestedActions: string[], player: Entity): string[] {
  const denarii = typeof player.resources?.denarii === 'number' ? player.resources.denarii : 0;
  if (denarii > 0) {
    return suggestedActions;
  }

  const legionSupport = typeof player.resources?.legion_support === 'number' ? player.resources.legion_support : 0;
  const investigations = typeof player.resources?.investigations === 'number' ? player.resources.investigations : 0;

  const militaryFallbacks = [
    'Rally the frontier legions to demand concessions',
    'Intimidate the opposition through a show of military force',
    'Assert martial authority over the barracks',
  ];
  const intrigueFallbacks = [
    'Deploy informants to expose your rivals\' secrets',
    'Use whispered blackmail to force cooperation',
    'Spread destabilizing rumors through the Suburra',
  ];
  const generalFallbacks = [
    'Demand concessions through personal authority',
    'Rally loyal followers to your banner',
    'Consolidate your influence among trusted allies',
  ];

  const fallbackPool = legionSupport > 0
    ? militaryFallbacks
    : investigations > 0
      ? intrigueFallbacks
      : generalFallbacks;

  let fallbackIndex = 0;
  const result: string[] = [];
  const seen = new Set<string>();

  for (const action of suggestedActions) {
    if (FINANCIAL_ACTION_REGEX.test(action)) {
      while (fallbackIndex < fallbackPool.length && seen.has(fallbackPool[fallbackIndex])) {
        fallbackIndex++;
      }
      const replacement = fallbackPool[fallbackIndex % fallbackPool.length];
      fallbackIndex++;
      if (!seen.has(replacement)) {
        seen.add(replacement);
        result.push(replacement);
      }
    } else {
      if (!seen.has(action)) {
        seen.add(action);
        result.push(action);
      }
    }
  }

  return result;
}
