/**
 * hooks/useImperialDispatch.ts
 *
 * Dedicated audio control and state manager for the "Imperial Dispatch":
 * a fact-based situation report summarizing the current state of all tabs
 * (Treasury, Legions, Stability, Crises, Events, Reports, Senate/Rivals)
 * in crisp High English or Mid-Atlantic broadcast style.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeminiClient } from '../ai/core/geminiService';
import type { WorldState, Entity, Report, SimulationState } from '../types';
import { performImperialDispatch } from '../ai/tools/narrationVoice';
import { NarrationPlayer, type NarrationVoiceStatus } from '../narration/narrationPlayer';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';
import { toRoman } from '../components/ui/Brand';
import { narrationLog, type NarrationLogStore } from '../narration/narrationLog';

export type ImperialDispatchStatus = NarrationVoiceStatus | 'unavailable' | 'silenced';

export interface UseImperialDispatchArgs {
  ai: GeminiClient;
  isMockMode: boolean;
  resolvedApiKey?: string | null;
  /**
   * The narration voice's mode. SILENT ('off') silences the Dispatch like
   * every other voice: the control stays shown but makes no call, and a
   * reading already playing stops.
   */
  narrationVoiceMode?: NarrationVoiceMode;
  worldState: WorldState;
  simulationState?: SimulationState;
  entities: Entity[];
  reports: Report[];
  knowledge?: unknown;
  currentEvents: readonly unknown[];
  playerEntity?: Entity | null;
  turnNumber: number;
  /** The narration log (narration/narrationLog.ts); tests inject their own. */
  log?: NarrationLogStore;
}

/** The Dispatch's voice and its name in the narration log (veto-queue copy). */
export const IMPERIAL_DISPATCH_VOICE = 'Sadaltager';
export const IMPERIAL_DISPATCH_SPEAKER = 'The Imperial Chancellery';

/** "Imperial Dispatch, Week XI" - the log's label for a dispatch. */
export function dispatchSourceLabel(week: number): string {
  return `Imperial Dispatch, Week ${toRoman(week)}`;
}

/**
 * Summarizes the facts across all intelligence tabs into a structured briefing prompt.
 */
export function compileTabsFactSummary(args: {
  worldState: WorldState;
  simulationState?: SimulationState;
  entities: Entity[];
  reports: Report[];
  knowledge?: unknown;
  currentEvents: readonly unknown[];
  playerEntity?: Entity | null;
  turnNumber: number;
}): string {
  const { worldState, simulationState, entities, reports, currentEvents, playerEntity, turnNumber } = args;

  const weekStr = `Week ${toRoman(worldState.week || turnNumber)}, Year ${worldState.year || 235} CE`;
  const econ = worldState.economic_stability || 'fragile';
  const climate = worldState.political_climate || 'strained';
  const imperialStatus = simulationState?.imperial_status || 'Contested';
  const militaryStatus = simulationState?.military_status || 'Divided';
  const plebeianMood = simulationState?.plebeian_mood || 'Uneasy';
  const crisis = simulationState?.major_ongoing_crisis ? simulationState.major_ongoing_crisis.trim() : 'No acute systemic collapse reported';

  const eventsSummary = currentEvents.length > 0
    ? currentEvents
        .slice(0, 3)
        .map(e => (typeof e === 'string' ? e : (e as Record<string, unknown>)?.headline || (e as Record<string, unknown>)?.text || (e as Record<string, unknown>)?.eventId || String(e)))
        .join('. ')
    : 'No major provincial outbreaks this week.';

  const reportsSummary = reports.length > 0
    ? reports.slice(-3).map(r => `${r.about}: ${r.claim}`).join('; ')
    : 'All frontier dispatches remain within ordinary tolerances.';

  const keyPersonae = entities
    .filter(e => e.entity_type === 'individual' && e.entity_id !== playerEntity?.entity_id)
    .slice(0, 4)
    .map(e => `${e.name} (${e.position || e.epithet || 'senator'}, status: ${e.status})`)
    .join('; ');

  const resourcesSummary = playerEntity?.resources
    ? Object.entries(playerEntity.resources).map(([k, v]) => `${k}: ${v}`).join(', ')
    : 'standard reserves';

  return `${weekStr}.
MACRO STATE: Economic stability: ${econ}; Political climate: ${climate}; Imperial throne: ${imperialStatus}; Legions: ${militaryStatus}; Plebeian mood: ${plebeianMood}.
CRISIS: ${crisis}.
PLAYER ASSETS: ${resourcesSummary}.
PROVINCIAL EVENTS: ${eventsSummary}.
INTELLIGENCE REPORTS: ${reportsSummary}.
SENATE & RIVAL PERSONAE: ${keyPersonae || 'Senate in recess'}.`;
}

export function useImperialDispatch(args: UseImperialDispatchArgs) {
  const {
    ai,
    isMockMode,
    resolvedApiKey,
    narrationVoiceMode,
    worldState,
    simulationState,
    entities,
    reports,
    knowledge,
    currentEvents,
    playerEntity,
    turnNumber,
    log = narrationLog,
  } = args;

  const [player] = useState(() => new NarrationPlayer());
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

  const canReachVoice = isMockMode || Boolean(resolvedApiKey);
  const silenced = narrationVoiceMode === 'off';

  const weekRef = useRef(worldState.week || turnNumber);
  const turnRef = useRef(turnNumber);
  useEffect(() => {
    weekRef.current = worldState.week || turnNumber;
    turnRef.current = turnNumber;
  }, [worldState.week, turnNumber]);

  useEffect(() => {
    player.setRenderer(
      async (factsText) => {
        const performed = await performImperialDispatch(ai, factsText, isMockMode, IMPERIAL_DISPATCH_VOICE);
        // The dispatch the player is about to hear, kept as text in the log.
        const week = weekRef.current;
        log.record({
          kind: 'dispatch',
          sourceLabel: dispatchSourceLabel(week),
          sourceText: factsText,
          narratorKey: 'imperial-dispatch',
          narratorName: IMPERIAL_DISPATCH_SPEAKER,
          voice: IMPERIAL_DISPATCH_VOICE,
          voiceStyle: null,
          transcript: performed.transcript,
          patchedOut: performed.patchedOut,
          usedFallback: performed.usedFallback,
          week,
          turn: turnRef.current,
        });
        return new Blob([performed.wav], { type: 'audio/wav' });
      },
      isMockMode ? 'mock-dispatch' : 'live-dispatch',
    );
  }, [player, ai, isMockMode, log]);


  useEffect(() => () => player.dispose(), [player]);

  // Turned SILENT: a reading in progress stops.
  useEffect(() => {
    if (silenced) player.stop();
  }, [player, silenced]);

  const factsText = compileTabsFactSummary({
    worldState,
    simulationState,
    entities,
    reports,
    knowledge,
    currentEvents,
    playerEntity,
    turnNumber,
  });

  const factsRef = useRef(factsText);
  useEffect(() => {
    factsRef.current = factsText;
  }, [factsText]);

  const toggleDispatch = useCallback(() => {
    if (!canReachVoice || silenced) return;
    player.toggle(turnNumber, factsRef.current);
  }, [canReachVoice, silenced, player, turnNumber]);

  const status: ImperialDispatchStatus = silenced
    ? 'silenced'
    : !canReachVoice
    ? 'unavailable'
    : playback.index === turnNumber
      ? playback.status
      : 'idle';

  return {
    dispatchStatus: status,
    toggleDispatch,
    stopDispatch: () => player.stop(),
  };
}
