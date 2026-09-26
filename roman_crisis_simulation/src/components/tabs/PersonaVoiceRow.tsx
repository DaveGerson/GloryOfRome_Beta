import React, { useId, useState } from 'react';
import { NARRATION_VOICE_COPY } from '../Chat';
import type { PersonaeVoice } from '../../hooks/usePersonaeVoice';

/** Player-visible copy for the Personae voice row (veto-queue: roadmaps/BACKLOG.md B13). */
export const PERSONA_VOICE_COPY = {
  voice: (voiceName: string, manner: string) => (manner ? `Voice: ${voiceName} — ${manner}` : `Voice: ${voiceName}`),
  narrateAs: 'Narrate as them',
  narrates: (name: string) => `${name} now narrates.`,
  hear: 'Hear their voice',
  /** Once, above the figures: what "Hear their voice" costs. */
  paidNote: 'Hearing a voice is one paid call on your key: they say their name, nothing more.',
  preparing: 'They draw breath…',
} as const;

/**
 * One known character's voice on their Personae card
 * (hooks/usePersonaeVoice.ts): their cast voice and manner, "Narrate as
 * them" (the "In character…" narration style, set as Settings sets it) and
 * "Hear their voice" (one paid TTS call: their name, in their voice). While
 * SILENT, or with no key, both buttons are shown disabled and the hint says
 * why. Compact: one line of text and two quiet buttons.
 */
export const PersonaVoiceRow: React.FC<{
  entityId: string;
  name: string;
  voice: PersonaeVoice;
  /** The id of the tab's one "paid call" note, which also describes each Hear button. */
  paidNoteId?: string;
}> = ({ entityId, name, voice, paidNoteId }) => {
  const ids = useId();
  const [confirmed, setConfirmed] = useState(false);
  const cast = voice.voiceFor(entityId);
  if (!cast) return null;
  const state = voice.sampleStateFor(entityId);
  const engaged = state === 'preparing' || state === 'playing';
  const hint = voice.blocked === 'silent' ? NARRATION_VOICE_COPY.silent : voice.blocked === 'unavailable' ? NARRATION_VOICE_COPY.unavailable : null;
  const narrating = voice.narratingId === entityId;
  const status = hint
    ?? (state === 'preparing' ? PERSONA_VOICE_COPY.preparing
      : state === 'error' ? NARRATION_VOICE_COPY.error
        : confirmed && narrating ? PERSONA_VOICE_COPY.narrates(name) : '');
  const hintId = `${ids}-hint`;
  const hearDescribedBy = [hint ? hintId : null, paidNoteId ?? null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="gor-persona-voice">
      <p className="gor-persona-voice-line">{PERSONA_VOICE_COPY.voice(cast.voiceName, cast.style)}</p>
      <div className="gor-voice gor-persona-voice-actions">
        <button
          type="button"
          className="gor-voice-btn"
          aria-pressed={narrating}
          aria-describedby={hint ? hintId : undefined}
          disabled={voice.blocked !== null}
          onClick={() => { voice.onNarrateAs(entityId); setConfirmed(true); }}
        >
          <span className="gor-voice-glyph" aria-hidden="true">❧</span>
          {PERSONA_VOICE_COPY.narrateAs}<span className="gor-sr-only"> ({name})</span>
        </button>
        <button
          type="button"
          className="gor-voice-btn"
          aria-pressed={engaged}
          aria-busy={state === 'preparing' || undefined}
          aria-describedby={hearDescribedBy}
          disabled={voice.blocked !== null}
          title={engaged ? NARRATION_VOICE_COPY.stop : undefined}
          onClick={() => voice.onHear(entityId, name)}
        >
          <span className="gor-voice-glyph" aria-hidden="true">
            {state === 'preparing' ? <span className="gor-voice-spinner" /> : state === 'playing' ? '■' : '▶'}
          </span>
          {PERSONA_VOICE_COPY.hear}<span className="gor-sr-only"> ({name})</span>
        </button>
        <span className="gor-voice-status" id={hintId} role="status" aria-live="polite">{status}</span>
      </div>
    </div>
  );
};
