import React, { useId, useState } from 'react';
import { Button } from './ui/Core';
import { narrationSelectStyle } from './VoiceStylePicker';
import { VOICE_CATALOG, catalogVoiceLabel } from '../narration/voiceCatalog';
import { MAX_CAST_STYLE_CHARS, effectiveMember, sanitizeCastStyle, type CastOverride, type CastingCandidate, type VoiceCast } from '../narration/voiceCast';
import { filterVoiceStyleInput } from '../narration/voiceStyle';
import type { RecastStatus } from '../hooks/useVoiceCast';

/** Player-visible copy for the cast list (veto-queue: roadmaps/BACKLOG.md B13). */
export const VOICE_CAST_COPY = {
  disclosure: 'The cast',
  intro: 'Who speaks in which voice, and in what manner. The manner shapes their words when they narrate; in a private scene, their voice alone carries them. Kept with this campaign.',
  narratorRow: (reader: string) => `The narrator — ${reader}`,
  voiceFor: (name: string) => `Voice for ${name}`,
  styleFor: (name: string) => `How ${name} speaks`,
  stylePlaceholder: 'As written',
  reset: 'Reset to casting',
  resetFor: (name: string) => `Reset ${name} to casting`,
  yourChoice: 'Your choice',
  recast: 'Recast everyone',
  recastNote: 'One paid call on your key: the casting director hears everyone again. Your own changes stay.',
  recastUnavailable: 'The casting director needs your key and a campaign in play.',
  status: {
    idle: '',
    casting: 'The casting director is at work…',
    done: 'Recast.',
    fell_back: 'The casting director could not be reached; cast by rule instead.',
  } as Record<RecastStatus, string>,
} as const;

/** The narrator's row edits the Settings voice and voice style, so it takes its own handlers. */
export interface NarratorCastRow {
  readerName: string;
  voiceName: string;
  style: string;
  rationale: string;
  overridden: boolean;
  onVoice: (voiceName: string) => void;
  onStyle: (style: string) => void;
  onReset: () => void;
}

export interface VoiceCastListProps {
  cast: VoiceCast;
  /** The individuals the player knows, in the order the list shows them. */
  characters: readonly CastingCandidate[];
  narrator: NarratorCastRow;
  onOverride: (entityId: string, change: CastOverride) => void;
  onReset: (entityId: string) => void;
  canRecast: boolean;
  recastStatus: RecastStatus;
  onRecast: () => void;
}

/** A style field that commits on blur or Enter, so a keystroke is never a save. */
const StyleField: React.FC<{ label: string; value: string; onCommit: (style: string) => void }> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const clean = sanitizeCastStyle(draft);
    setDraft(clean);
    if (clean !== value) onCommit(clean);
  };
  return (
    <input
      type="text"
      className="gor-input gor-cast-style"
      aria-label={label}
      maxLength={MAX_CAST_STYLE_CHARS}
      placeholder={VOICE_CAST_COPY.stylePlaceholder}
      value={draft}
      onChange={e => setDraft(filterVoiceStyleInput(e.target.value))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
};

const VoiceSelect: React.FC<{ label: string; value: string; onChange: (voice: string) => void }> = ({ label, value, onChange }) => (
  <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} style={narrationSelectStyle} className="gor-cast-voice">
    {VOICE_CATALOG.map(v => <option key={v.id} value={v.id}>{catalogVoiceLabel(v.id)}</option>)}
  </select>
);

interface RowProps {
  name: string;
  standing?: string;
  voiceName: string;
  style: string;
  rationale: string;
  overridden: boolean;
  onVoice: (voice: string) => void;
  onStyle: (style: string) => void;
  onReset: () => void;
}

const CastRow: React.FC<RowProps> = ({ name, standing, voiceName, style, rationale, overridden, onVoice, onStyle, onReset }) => (
  <li className="gor-cast-row">
    <div className="gor-cast-head">
      <span className="gor-narrator-editor-name">{name}</span>
      {standing && <span className="gor-narrator-editor-meta">{standing}</span>}
      {overridden && <span className="gor-cast-badge">{VOICE_CAST_COPY.yourChoice}</span>}
    </div>
    <div className="gor-cast-controls">
      <VoiceSelect label={VOICE_CAST_COPY.voiceFor(name)} value={voiceName} onChange={onVoice} />
      {/* Keyed on the committed value, so a reset or a recast refreshes the draft. */}
      <StyleField key={style} label={VOICE_CAST_COPY.styleFor(name)} value={style} onCommit={onStyle} />
    </div>
    <p className="gor-cast-rationale">
      {rationale}
      {overridden && (
        <> <Button type="button" size="sm" variant="ghost" aria-label={VOICE_CAST_COPY.resetFor(name)} onClick={onReset}>{VOICE_CAST_COPY.reset}</Button></>
      )}
    </p>
  </li>
);

/**
 * Settings → the narration voice → "The cast": the narrator and every
 * individual the player knows, each with their voice, delivery note and
 * the casting's one-line rationale. Each row can take the player's own
 * voice (the full catalog) and note, or go back to the casting. A
 * disclosure, like "Your narrators", so it never floods the menu. It only
 * reports; the cast lives in hooks/useVoiceCast.ts.
 */
export const VoiceCastList: React.FC<VoiceCastListProps> = ({
  cast, characters, narrator, onOverride, onReset, canRecast, recastStatus, onRecast,
}) => {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const known = characters.filter(c => cast.members[c.entityId]);
  const status = VOICE_CAST_COPY.status[recastStatus];
  return (
    <div className="gor-narrator-editor">
      <button
        type="button"
        className="gor-narrator-editor-toggle"
        aria-expanded={open}
        aria-controls={`${ids}-panel`}
        onClick={() => setOpen(o => !o)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {VOICE_CAST_COPY.disclosure} ({known.length + 1})
      </button>
      {open && (
        <div id={`${ids}-panel`} className="gor-narrator-editor-panel">
          <p className="gor-config-note" style={{ marginTop: 0 }}>{VOICE_CAST_COPY.intro}</p>
          <ul className="gor-cast-list" aria-label={VOICE_CAST_COPY.disclosure}>
            <CastRow
              name={VOICE_CAST_COPY.narratorRow(narrator.readerName)}
              voiceName={narrator.voiceName}
              style={narrator.style}
              rationale={narrator.rationale}
              overridden={narrator.overridden}
              onVoice={narrator.onVoice}
              onStyle={narrator.onStyle}
              onReset={narrator.onReset}
            />
            {known.map(c => {
              const m = cast.members[c.entityId];
              const { voiceName, style } = effectiveMember(m);
              return (
                <CastRow
                  key={c.entityId}
                  name={c.name}
                  standing={c.position ?? c.epithet}
                  voiceName={voiceName}
                  style={style}
                  rationale={m.rationale}
                  overridden={Boolean(m.override)}
                  onVoice={voice => onOverride(c.entityId, { voiceName: voice })}
                  onStyle={text => onOverride(c.entityId, { style: text })}
                  onReset={() => onReset(c.entityId)}
                />
              );
            })}
          </ul>
          <div className="gor-narrator-editor-actions" style={{ marginLeft: 0 }}>
            <Button type="button" size="sm" variant="ghost" disabled={!canRecast || recastStatus === 'casting'} aria-describedby={`${ids}-recast-note`} onClick={onRecast}>
              {VOICE_CAST_COPY.recast}
            </Button>
          </div>
          <p className="gor-config-note" id={`${ids}-recast-note`}>{canRecast ? VOICE_CAST_COPY.recastNote : VOICE_CAST_COPY.recastUnavailable}</p>
          <p className="gor-config-note" role="status" aria-live="polite" style={{ minHeight: status ? undefined : 0, margin: status ? undefined : 0 }}>{status}</p>
        </div>
      )}
    </div>
  );
};
