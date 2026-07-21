import React, { useEffect, useState } from 'react';
import { Entity, TurnHistoryEntry, EventHistoryEntry } from '../types';
import { generateText, GEMINI_PRO, GeminiClient } from '../ai/core/geminiService';
import { buildEpiloguePrompt, EpilogueTurnHeadlines, EpilogueEventChoice } from '../ai/prompts/epilogue';
import { clearSave } from '../persistence/saveGame';

// Epilogue prose is the single most "reward the player" text in the app -
// same temperature reasoning as ai/core/turn.ts's NARRATION_TEMPERATURE.
const EPILOGUE_TEMPERATURE = 1.0;

// Caps how many of the most recent turnHistory entries' headlines are
// serialized into the prompt, so a long (100+ turn) campaign doesn't blow
// past a sane prompt size (ai/prompts/README.md's per-call size discipline
// - see ai/prompts/epilogue.ts's doc comment). The omitted count is still
// surfaced to the model so it can gesture at "the early years" instead of
// inventing specifics for turns it never saw.
const MAX_TURNS_IN_EPILOGUE_PROMPT = 25;

// How many of the most recent headlines to show in the "Notable Headlines"
// run-stats box below the obituary - a display concern, independent of the
// prompt-sizing cap above.
const NOTABLE_HEADLINES_SHOWN = 5;

/** The GM-console-only ambition snapshot (App.tsx / ai/tools/ambition.ts), as displayed here and passed into the epilogue prompt. Never a player-facing goal UI (D8) - this is its ONE sanctioned appearance in front of the player, framed as retrospective flavor rather than a quest readout. */
export interface EpilogueInferredAmbition {
  apparent_ambition: string;
  confidence: 'low' | 'medium' | 'high';
  asOfTurn: number;
}

/**
 * A dignified, purely static epitaph used both in Mock Mode (no real model
 * to write prose with) and as the `AiServiceError` fallback (a dead run
 * gets no retry loop - see the design brief). Deliberately plain rather
 * than trying to fake Tacitus - a placeholder should read as a placeholder,
 * not as a worse version of the real thing.
 */
function buildStaticFallbackEpitaph(player: Entity, causeNarration: string): string {
  const cause = causeNarration.trim() || 'The circumstances went unrecorded.';
  return [
    `${player.name}'s story ends here. ${cause}`,
    `The full chronicle of this reign is preserved in the record even where the chroniclers' own words are not; ${player.name} is remembered as ${player.position || player.entity_type} of ${player.location}, whatever else may be said of them.`,
    `"Here the record closes - the rest is left to those who come after."`,
  ].join('\n\n');
}

const EpilogueScreen: React.FC<{
  player: Entity;
  /** Persisted GM narration for the final events, independent of *why* the run ended (a committed turn's death vs. a fatal event-choice) - see App.tsx's derivation from `messages`. */
  causeNarration: string;
  /** ai/core/mortality.ts's pre-decided narrative directive for this death, when the mortality pipeline (rather than an authored event choice) ended the run. */
  mortalityOutcomeSummary?: string;
  turnHistory: TurnHistoryEntry[];
  eventHistory: EventHistoryEntry[];
  metaNarrative: string;
  inferredAmbition: EpilogueInferredAmbition | null;
  ai: GeminiClient;
  isMockMode: boolean;
}> = ({ player, causeNarration, mortalityOutcomeSummary, turnHistory, eventHistory, metaNarrative, inferredAmbition, ai, isMockMode }) => {
  const [epitaph, setEpitaph] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Mock Mode has no real model to write prose with - same reasoning as
      // every other ai/tools/*.ts call site's isMockMode branch, just
      // inlined here since there is no ai/tools/epilogue.ts (see
      // ai/prompts/epilogue.ts's doc comment on why this call is
      // orchestrated directly in the component).
      if (isMockMode) {
        if (!cancelled) {
          setEpitaph(buildStaticFallbackEpitaph(player, causeNarration));
          setIsLoading(false);
        }
        return;
      }

      const cappedHistory = turnHistory.slice(-MAX_TURNS_IN_EPILOGUE_PROMPT);
      const turnHeadlines: EpilogueTurnHeadlines[] = cappedHistory.map(entry => ({
        turnNumber: entry.turnNumber,
        headlines: entry.adjudication.headlines,
      }));
      const omittedTurnCount = Math.max(0, turnHistory.length - cappedHistory.length);

      const eventChoices: EpilogueEventChoice[] = eventHistory.map(e => ({
        turnNumber: e.turnNumber,
        eventTitle: e.eventTitle,
        choiceText: e.choiceText,
      }));

      const { systemInstruction, prompt } = buildEpiloguePrompt({
        player,
        metaNarrative,
        turnCount: turnHistory.length,
        causeNarration,
        mortalityOutcomeSummary,
        turnHeadlines,
        omittedTurnCount,
        eventChoices,
        inferredAmbition: inferredAmbition
          ? { apparent_ambition: inferredAmbition.apparent_ambition, confidence: inferredAmbition.confidence }
          : null,
      });

      try {
        const text = await generateText(ai, {
          callName: 'epilogue',
          model: GEMINI_PRO,
          systemInstruction,
          prompt,
          temperature: EPILOGUE_TEMPERATURE,
        });
        if (!cancelled) {
          setEpitaph(text && text.trim() ? text.trim() : buildStaticFallbackEpitaph(player, causeNarration));
          setIsLoading(false);
        }
      } catch (error) {
        // No retry loop on a dead run (per the design brief) - a failed
        // epilogue call falls straight through to the static fallback.
        console.error('EpilogueScreen: epilogue generation failed, falling back to a static epitaph', error);
        if (!cancelled) {
          setUsedFallback(true);
          setEpitaph(buildStaticFallbackEpitaph(player, causeNarration));
          setIsLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // Runs exactly once per mount - a terminal GAME_OVER screen never
    // re-triggers regeneration (there's no "next turn" that would justify
    // re-running it, and App.tsx never re-mounts this component for the
    // same ended run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notableHeadlines = turnHistory
    .flatMap(entry => entry.adjudication.headlines)
    .slice(-NOTABLE_HEADLINES_SHOWN);

  /**
   * "Begin a New Chronicle": clears the autosave and reloads the page. A
   * full reload (rather than resetting App.tsx's dozen-plus useState hooks
   * by hand) is the simplest correct way to guarantee every piece of
   * per-run state - including transient UI state never in the save bundle -
   * goes back to its true initial value, and this screen is only ever
   * reached at a terminal, nothing-left-to-lose point in the run. The same
   * trade-off is already made by ErrorBoundary.tsx's recovery button.
   */
  const handleNewChronicle = () => {
    clearSave();
    window.location.reload();
  };

  return (
    <div className="w-full flex-grow overflow-y-auto bg-stone-950 text-stone-200 animate-fade-in">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-center font-decorative uppercase tracking-[0.3em] text-xs text-stone-500 mb-2">
          The Story Has Ended
        </p>
        <h1 className="text-4xl font-decorative text-center text-stone-100 mb-1">{player.name}</h1>
        <p className="text-center text-stone-500 italic mb-10">
          {player.position || player.entity_type} &mdash; {player.location}
        </p>

        <div role="region" aria-label="Epilogue" className="border-y-4 border-double border-stone-700 py-8 px-2 sm:px-6 min-h-[10rem]">
          {isLoading ? (
            <p className="text-center italic text-stone-400 animate-pulse" aria-live="polite">
              The chroniclers take up their pens&hellip;
            </p>
          ) : (
            <div className="space-y-4 text-stone-300 leading-relaxed whitespace-pre-line">{epitaph}</div>
          )}
        </div>

        {usedFallback && !isLoading && (
          <p className="text-center text-stone-600 text-xs mt-4 italic">
            (The chroniclers could not be reached &mdash; this record was set down by a steadier, quieter hand.)
          </p>
        )}

        {!isLoading && (
          <div className="mt-10 grid sm:grid-cols-2 gap-6 text-sm">
            <div className="bg-stone-900/60 border border-stone-700 rounded-sm p-4">
              <h2 className="font-bold text-stone-300 uppercase tracking-wide text-xs mb-2">Run Stats</h2>
              <ul className="space-y-1 text-stone-400">
                <li>
                  Turns survived: <span className="text-stone-200">{turnHistory.length}</span>
                </li>
                <li>
                  Apparent ambition:{' '}
                  <span className="text-stone-200 italic">
                    {inferredAmbition ? inferredAmbition.apparent_ambition : 'Never became clear, even in hindsight.'}
                  </span>
                </li>
              </ul>
            </div>
            <div className="bg-stone-900/60 border border-stone-700 rounded-sm p-4">
              <h2 className="font-bold text-stone-300 uppercase tracking-wide text-xs mb-2">Notable Headlines</h2>
              {notableHeadlines.length > 0 ? (
                <ul className="list-disc list-inside space-y-1 text-stone-400">
                  {notableHeadlines.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-stone-500 italic">The record is thin.</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-12 flex justify-center">
          <button
            onClick={handleNewChronicle}
            className="bg-red-800 text-stone-100 rounded-sm px-8 py-3 hover:bg-red-700 transition-colors border border-red-900 btn-animate text-lg font-bold"
          >
            Begin a New Chronicle
          </button>
        </div>
      </div>
    </div>
  );
};

export default EpilogueScreen;
