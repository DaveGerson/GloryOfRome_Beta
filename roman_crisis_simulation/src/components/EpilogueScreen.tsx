import React, { useEffect, useState } from 'react';
import { Entity, TurnHistoryEntry, EventHistoryEntry } from '../types';
import { generateText, GEMINI_PRO, THINKING_STANDARD, GeminiClient } from '../ai/core/geminiService';
import { buildEpiloguePrompt, EpilogueTurnHeadlines, EpilogueEventChoice } from '../ai/prompts/epilogue';
import { clearSave } from '../persistence/saveGame';
import { GildedAquila, toRoman } from './ui/Brand';
import { Alert, RECORD_REFUSES } from './ui/Alert';
import { assertPlayerVisibleTextSafe } from '../ai/core/playerBoundary';

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

// The stele's palette lives in design/tokens/effects.css (WP-10) so
// nocturne.css can re-cut it; these stay as named constants because every
// use below is an inline style.
const STELE_TEXT = 'var(--stele-text)', STELE_DIM = 'var(--stele-dim)', STELE_BRIGHT = 'var(--stele-bright)';
const steleLabel: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: STELE_DIM };

const EpilogueScreen: React.FC<{
  player: Entity;
  /** Persisted GM narration for the final events, independent of *why* the run ended (a committed turn's death vs. a fatal event-choice) - see App.tsx's derivation from `messages`. */
  causeNarration: string;
  turnHistory: TurnHistoryEntry[];
  eventHistory: EventHistoryEntry[];
  metaNarrative: string;
  ai: GeminiClient;
  isMockMode: boolean;
}> = ({ player, causeNarration, turnHistory, eventHistory, metaNarrative, ai, isMockMode }) => {
  const [epitaph, setEpitaph] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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
        turnHeadlines,
        omittedTurnCount,
        eventChoices,
      });

      try {
        const text = await generateText(ai, {
          callName: 'epilogue',
          model: GEMINI_PRO,
          systemInstruction,
          prompt,
          thinkingConfig: THINKING_STANDARD,
          temperature: EPILOGUE_TEMPERATURE,
        });
        const safeText = text && text.trim() ? text.trim() : buildStaticFallbackEpitaph(player, causeNarration);
        assertPlayerVisibleTextSafe(safeText);
        if (!cancelled) {
          setEpitaph(safeText);
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
    if (!clearSave().ok) {
      setResetError('Your finished reign could not be removed. Please try again.');
      return;
    }
    setResetError(null);
    window.location.reload();
  };

  return (
    // Item 19: the stele is STRUCK. Six hundred milliseconds of held silence,
    // then the gilt aquila strikes in with a gold bloom, the stone rises from
    // below, the name cuts in, and the chroniclers' verdicts arrive last —
    // about four seconds in all, every step reduced-motion guarded (the
    // reduced path shows the finished stone with no movement).
    <div className="gor-stele" style={{ width: '100%', flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--stele-grad)', color: STELE_TEXT }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 64px' }}>
        <div className="gor-stele-aquila" style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <GildedAquila size={64} />
        </div>
        <p className="gor-stele-rise" style={{ ...steleLabel, textAlign: 'center', letterSpacing: '.3em', marginBottom: 8 }}>
          The Story Has Ended
        </p>
        <h1 className="gor-stele-cut" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 38, textAlign: 'center', color: STELE_BRIGHT, textShadow: '0 2px 4px rgba(0,0,0,.7)', margin: '0 0 4px' }}>{player.name}</h1>
        <p className="gor-stele-cut" style={{ textAlign: 'center', color: STELE_DIM, fontStyle: 'italic', margin: '0 0 40px' }}>
          {player.position || player.entity_type} — {player.location}
        </p>

        <div role="region" aria-label="Epilogue" className="gor-stele-verdict" style={{ position: 'relative', borderTop: '1px solid rgba(227,199,102,.4)', borderBottom: '1px solid rgba(227,199,102,.4)', padding: '32px 12px', minHeight: 160, boxShadow: 'inset 0 3px 0 -2px rgba(227,199,102,.15), inset 0 -3px 0 -2px rgba(227,199,102,.15)' }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', color: 'var(--gold-400)', fontSize: 11, background: '#161109', padding: '0 12px' }}>◆</span>
          {isLoading ? (
            <p style={{ textAlign: 'center', fontStyle: 'italic', color: STELE_DIM, animation: 'gorEmber 2.4s ease-in-out infinite' }} aria-live="polite">
              The chroniclers take up their pens…
            </p>
          ) : (
            <div className="gor-dropcap" style={{ fontSize: 17, lineHeight: 1.65, whiteSpace: 'pre-line', color: STELE_TEXT }}>{epitaph}</div>
          )}
          <span aria-hidden="true" style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', color: 'var(--gold-400)', fontSize: 11, background: '#161109', padding: '0 12px' }}>◆</span>
        </div>

        {usedFallback && !isLoading && (
          <p style={{ textAlign: 'center', color: 'rgba(161,138,92,.7)', fontSize: 13, marginTop: 16, fontStyle: 'italic' }}>
            (The chroniclers could not be reached — this record was set down by a steadier, quieter hand.)
          </p>
        )}

        {!isLoading && (
          <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, fontSize: 14 }}>
            <div style={{ background: 'rgba(0,0,0,.32)', border: '1px solid rgba(227,199,102,.25)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
              <h2 style={{ ...steleLabel, margin: '0 0 8px' }}>The Reckoning</h2>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5, color: STELE_DIM }}>
                <li>
                  Turns survived: <span style={{ color: STELE_BRIGHT, fontVariantNumeric: 'tabular-nums' }}>{toRoman(Math.max(1, turnHistory.length))} ({turnHistory.length})</span>
                </li>
              </ul>
            </div>
            <div style={{ background: 'rgba(0,0,0,.32)', border: '1px solid rgba(227,199,102,.25)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
              <h2 style={{ ...steleLabel, margin: '0 0 8px' }}>Notable Headlines</h2>
              {notableHeadlines.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5, color: STELE_DIM }}>
                  {notableHeadlines.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, color: STELE_DIM, fontStyle: 'italic' }}>The record is thin.</p>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {resetError && <Alert title={RECORD_REFUSES} onDarkGround>{resetError}</Alert>}
          <button onClick={handleNewChronicle} className="gor-btn gor-btn-lg gor-btn-primary">
            Begin a New Chronicle
          </button>
        </div>
      </div>
    </div>
  );
};

export default EpilogueScreen;
