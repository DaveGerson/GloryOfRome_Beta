import React, { useId, useRef, useState } from 'react';
import { Button } from './ui/Core';
import { NARRATOR_VOICES, DEFAULT_NARRATOR_VOICE_ID } from '../persistence/uiPrefs';
import {
    CUSTOM_NARRATOR_LIMITS,
    MAX_CUSTOM_NARRATORS,
    type CustomNarrator,
    type CustomNarratorDraft,
    type CustomNarratorSaveResult,
} from '../narration/customNarrators';
import { voiceStyleLabel, type VoiceStyle } from '../narration/voiceStyle';
import { VOICE_CATALOG, catalogVoiceLabel } from '../narration/voiceCatalog';
import { VoiceStylePicker, VOICE_GROUP_COPY, narrationSelectStyle } from './VoiceStylePicker';

/** Player-visible copy for the custom-narrator editor (veto-queue: roadmaps/BACKLOG.md B13). */
export const CUSTOM_NARRATOR_COPY = {
    disclosure: 'Your narrators',
    intro: 'Write a narrator of your own. It is kept on this device, never in your save.',
    empty: 'None yet.',
    add: 'New narrator',
    edit: 'Edit',
    remove: 'Remove',
    confirmRemove: (name: string) => `Remove ${name}?`,
    keep: 'Keep',
    name: 'Name',
    description: 'Description',
    brief: 'Who narrates',
    briefHint: 'Who they are, whom they speak to, how they tell a week. The chronicle stays the chronicle: they may not add to it.',
    voice: 'Voice',
    voiceStyle: 'Voice style',
    save: 'Save narrator',
    cancel: 'Cancel',
    full: `You may keep ${MAX_CUSTOM_NARRATORS} narrators at most.`,
} as const;

type FormState = { id?: string; name: string; description: string; brief: string; voiceName: string; voiceStyle: VoiceStyle | null };

const BLANK: FormState = { name: '', description: '', brief: '', voiceName: DEFAULT_NARRATOR_VOICE_ID, voiceStyle: null };

const fieldStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '6px 10px' };
const fieldLabelStyle: React.CSSProperties = { display: 'block', margin: '8px 0 3px' };

/**
 * Settings' small editor for the player's own narrators
 * (narration/customNarrators.ts): create, edit, remove. It sits behind a
 * disclosure so it never floods the menu. It only reports; validation and
 * storage live in the hook (hooks/useNarrationVoice.ts).
 */
export const CustomNarratorEditor: React.FC<{
    narrators: readonly CustomNarrator[];
    onSave: (draft: CustomNarratorDraft) => CustomNarratorSaveResult;
    onDelete: (id: string) => void;
}> = ({ narrators, onSave, onDelete }) => {
    const ids = useId();
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState<FormState | null>(null);
    const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
    const [confirming, setConfirming] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);

    const startForm = (next: FormState) => {
        setForm(next);
        setIssues([]);
        setConfirming(null);
        queueMicrotask(() => nameRef.current?.focus());
    };
    const closeForm = () => {
        setForm(null);
        setIssues([]);
        queueMicrotask(() => toggleRef.current?.focus());
    };
    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!form) return;
        const result = onSave({ ...form, voiceName: form.voiceName as CustomNarratorDraft['voiceName'] });
        if (result.ok) closeForm();
        else setIssues(result.issues);
    };
    const issueFor = (field: string) => issues.find(issue => issue.field === field)?.message;
    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => (prev ? { ...prev, [key]: value } : prev));

    return (
        <div className="gor-narrator-editor">
            <button
                ref={toggleRef}
                type="button"
                className="gor-narrator-editor-toggle"
                aria-expanded={open}
                aria-controls={`${ids}-panel`}
                onClick={() => setOpen(o => !o)}
            >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span> {CUSTOM_NARRATOR_COPY.disclosure} ({narrators.length})
            </button>
            {open && (
                <div id={`${ids}-panel`} className="gor-narrator-editor-panel">
                    <p className="gor-config-note" style={{ marginTop: 0 }}>{CUSTOM_NARRATOR_COPY.intro}</p>
                    {narrators.length === 0 && !form && <p className="gor-config-note">{CUSTOM_NARRATOR_COPY.empty}</p>}
                    {narrators.length > 0 && (
                        <ul className="gor-narrator-editor-list" aria-label={CUSTOM_NARRATOR_COPY.disclosure}>
                            {narrators.map(n => (
                                <li key={n.id}>
                                    <span className="gor-narrator-editor-name">{n.name}</span>
                                    <span className="gor-narrator-editor-meta">{n.voiceName} · {voiceStyleLabel(n.voiceStyle)}</span>
                                    {confirming === n.id ? (
                                        <span className="gor-narrator-editor-actions" role="group" aria-label={CUSTOM_NARRATOR_COPY.confirmRemove(n.name)}>
                                            <span className="gor-narrator-editor-confirm">{CUSTOM_NARRATOR_COPY.confirmRemove(n.name)}</span>
                                            <Button type="button" size="sm" variant="danger" onClick={() => { onDelete(n.id); setConfirming(null); }}>{CUSTOM_NARRATOR_COPY.remove}</Button>
                                            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>{CUSTOM_NARRATOR_COPY.keep}</Button>
                                        </span>
                                    ) : (
                                        <span className="gor-narrator-editor-actions">
                                            <Button type="button" size="sm" variant="ghost" aria-label={`${CUSTOM_NARRATOR_COPY.edit} ${n.name}`}
                                                onClick={() => startForm({ id: n.id, name: n.name, description: n.description, brief: n.brief, voiceName: n.voiceName, voiceStyle: n.voiceStyle })}>
                                                {CUSTOM_NARRATOR_COPY.edit}
                                            </Button>
                                            <Button type="button" size="sm" variant="ghost" aria-label={`${CUSTOM_NARRATOR_COPY.remove} ${n.name}`} onClick={() => setConfirming(n.id)}>
                                                {CUSTOM_NARRATOR_COPY.remove}
                                            </Button>
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {form ? (
                        <form onSubmit={submit} aria-label={form.id ? `${CUSTOM_NARRATOR_COPY.edit} ${form.name}` : CUSTOM_NARRATOR_COPY.add} noValidate>
                            <label className="gor-label" style={fieldLabelStyle} htmlFor={`${ids}-name`}>{CUSTOM_NARRATOR_COPY.name}</label>
                            <input ref={nameRef} id={`${ids}-name`} className="gor-input" style={fieldStyle} maxLength={CUSTOM_NARRATOR_LIMITS.name}
                                value={form.name} onChange={e => set('name', e.target.value)} aria-invalid={Boolean(issueFor('name')) || undefined}
                                aria-describedby={issueFor('name') ? `${ids}-name-issue` : undefined} />
                            {issueFor('name') && <p className="gor-narrator-editor-issue" id={`${ids}-name-issue`}>{issueFor('name')}</p>}

                            <label className="gor-label" style={fieldLabelStyle} htmlFor={`${ids}-description`}>{CUSTOM_NARRATOR_COPY.description}</label>
                            <input id={`${ids}-description`} className="gor-input" style={fieldStyle} maxLength={CUSTOM_NARRATOR_LIMITS.description}
                                value={form.description} onChange={e => set('description', e.target.value)} />
                            {issueFor('description') && <p className="gor-narrator-editor-issue">{issueFor('description')}</p>}

                            <label className="gor-label" style={fieldLabelStyle} htmlFor={`${ids}-brief`}>{CUSTOM_NARRATOR_COPY.brief}</label>
                            <textarea id={`${ids}-brief`} className="gor-textarea" style={fieldStyle} rows={4} maxLength={CUSTOM_NARRATOR_LIMITS.brief}
                                value={form.brief} onChange={e => set('brief', e.target.value)} aria-invalid={Boolean(issueFor('brief')) || undefined}
                                aria-describedby={`${ids}-brief-hint${issueFor('brief') ? ` ${ids}-brief-issue` : ''}`} />
                            <p className="gor-config-note" id={`${ids}-brief-hint`}>{CUSTOM_NARRATOR_COPY.briefHint} ({form.brief.length}/{CUSTOM_NARRATOR_LIMITS.brief})</p>
                            {issueFor('brief') && <p className="gor-narrator-editor-issue" id={`${ids}-brief-issue`}>{issueFor('brief')}</p>}

                            <label className="gor-label" style={fieldLabelStyle} htmlFor={`${ids}-voice`}>{CUSTOM_NARRATOR_COPY.voice}</label>
                            <select id={`${ids}-voice`} value={form.voiceName} onChange={e => set('voiceName', e.target.value)} style={narrationSelectStyle}>
                                <optgroup label={VOICE_GROUP_COPY.curated}>
                                    {NARRATOR_VOICES.map(v => <option key={v.id} value={v.id}>{v.label} — {v.role}</option>)}
                                </optgroup>
                                <optgroup label={VOICE_GROUP_COPY.every}>
                                    {VOICE_CATALOG.filter(v => !NARRATOR_VOICES.some(c => c.id === v.id)).map(v => <option key={v.id} value={v.id}>{catalogVoiceLabel(v.id)}</option>)}
                                </optgroup>
                            </select>

                            <label className="gor-label" style={fieldLabelStyle} htmlFor={`${ids}-voice-style`}>{CUSTOM_NARRATOR_COPY.voiceStyle}</label>
                            <VoiceStylePicker id={`${ids}-voice-style`} ariaLabel={`${CUSTOM_NARRATOR_COPY.voiceStyle} of this narrator`} value={form.voiceStyle} onChange={style => set('voiceStyle', style)} />
                            {issues.some(issue => !['name', 'description', 'brief'].includes(issue.field)) && (
                                <p className="gor-narrator-editor-issue" role="alert">{issues.find(issue => !['name', 'description', 'brief'].includes(issue.field))?.message}</p>
                            )}

                            <div className="gor-narrator-editor-actions" style={{ marginTop: 10 }}>
                                <Button type="submit" size="sm">{CUSTOM_NARRATOR_COPY.save}</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={closeForm}>{CUSTOM_NARRATOR_COPY.cancel}</Button>
                            </div>
                        </form>
                    ) : narrators.length >= MAX_CUSTOM_NARRATORS ? (
                        <p className="gor-config-note">{CUSTOM_NARRATOR_COPY.full}</p>
                    ) : (
                        <Button type="button" size="sm" variant="ghost" onClick={() => startForm(BLANK)}>{CUSTOM_NARRATOR_COPY.add}</Button>
                    )}
                </div>
            )}
        </div>
    );
};
