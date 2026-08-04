import React, { useState } from 'react';
import { Entity } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getClarificationOnEvent } from '../../ai/tools/intelligence';
import { WaxSeal, toRoman } from '../ui/Brand';
import { Button } from '../ui/Core';
import { SubRail } from '../ui/SubRail';
import {
    KnowledgeClaim, OCCURRENCE_QUESTIONS, OccurrenceQuestion, occurrenceFindings,
} from '../../knowledge/store';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';
import { EmptyRegister, QuietWeekSilhouette } from './EmptyRegister';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';

/**
 * Recent occurrences — press a headline and your agents seek its causes
 * (a live AI clarification call, expanded inline).
 *
 * WP-15 / audit item 40. The interaction was genuinely good; the state
 * handling threw away player work:
 *
 *  - the clarification lived in component-local `useState`, so an AI call the
 *    player WAITED ON was discarded the moment they switched tabs. Findings
 *    now go to the knowledge store in a durable commit, so they survive a tab
 *    switch and a reload;
 *  - only one occurrence could be open at once (a single `selectedEvent`;
 *    pressing another collapsed the first). Several may be open now;
 *  - the question was hardcoded `"What were the motives?"`. Three are offered,
 *    each askable once, and the one you asked becomes the finding's kicker;
 *  - the finding was typographically identical to the public headline above
 *    it. **What you paid to learn must never look like what the criers
 *    shouted**, so it now sits in its own register behind a dentil rule.
 */

const REGISTERS = ['week', 'examined'] as const;
type EventRegister = typeof REGISTERS[number];

/** Each question, as the player asks it and as the finding is kickered. */
const QUESTIONS: Record<OccurrenceQuestion, { ask: string; kicker: string; prompt: string }> = {
    who_gains: { ask: 'Who gains?', kicker: 'who gains', prompt: 'Who stands to gain from this?' },
    who_is_behind_it: { ask: 'Who is behind it?', kicker: 'who is behind it', prompt: 'Who is behind this?' },
    what_follows: { ask: 'What follows?', kicker: 'what follows', prompt: 'What is likely to follow from this?' },
};

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

/**
 * What your agents brought back, in a register of its own — a Tyrian seal, a
 * kicker naming the question, and the body in italic behind a Tyrian rule.
 */
const Finding: React.FC<{ kicker: string; text: string }> = ({ kicker, text }) => (
    <div className="gor-finding">
        <WaxSeal letter="A" size={20} tone="tyrian" />
        <div style={{ minWidth: 0 }}>
            <span className="gor-finding-kicker">Your agents · {kicker}</span>
            <p className="gor-finding-body">{text}</p>
        </div>
    </div>
);

const CurrentEventsTab: React.FC<{
    events: string[];
    /** The week the current occurrences were cried — every one of them was written in the same commit. */
    week: number;
    playerEntity: Entity | null;
    allEntities: Entity[];
    knowledge: KnowledgeClaim[];
    ai: GoogleGenAI;
    isMockMode: boolean;
    /** Commits one finding to the knowledge store, durably, before it is shown. */
    onFinding: (occurrence: string, question: OccurrenceQuestion, text: string, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
    runDomainMutation: RunDomainMutation;
    interactionLocked?: boolean;
}> = ({ events, week, playerEntity, allEntities, knowledge, ai, isMockMode, onFinding, runDomainMutation, interactionLocked = false }) => {
    const [register, setRegister] = useState<EventRegister>(() => getTabRegister('events', REGISTERS, 'week'));
    // Several occurrences may be open at once now.
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
    const [seeking, setSeeking] = useState<string | null>(null);

    const selectRegister = (next: EventRegister) => {
        setRegister(next);
        setTabRegister('events', next);
    };

    const toggle = (occurrence: string) => setOpen(previous => {
        const next = new Set(previous);
        if (next.has(occurrence)) next.delete(occurrence);
        else next.add(occurrence);
        return next;
    });

    const ask = async (occurrence: string, question: OccurrenceQuestion) => {
        if (interactionLocked || !playerEntity || seeking) return;
        setSeeking(`${occurrence}:${question}`);
        try {
            await runDomainMutation(async transaction => {
                const request: DomainMutationContext = { isCurrent: () => transaction.isCurrent() };
                const text = await getClarificationOnEvent(
                    ai, occurrence, QUESTIONS[question].prompt, playerEntity, allEntities, isMockMode,
                );
                if (!request.isCurrent()) return;
                await onFinding(occurrence, question, text, request);
            });
        } finally {
            setSeeking(null);
        }
    };

    // "Examined" is the register that accumulates: every occurrence this reign
    // that the player has asked anything about, whether or not it is still in
    // this week's cry.
    const examinedThisWeek = events.filter(occurrence => occurrenceFindings(knowledge, occurrence).length > 0);
    const shown = register === 'examined' ? examinedThisWeek : events;

    const slip = (occurrence: string, index: number) => {
        const findings = occurrenceFindings(knowledge, occurrence);
        const asked = new Set(findings.map(finding => finding.question));
        const isOpen = open.has(occurrence);
        const inFlight = seeking?.startsWith(`${occurrence}:`) ?? false;
        return (
            <div key={`${occurrence}-${index}`} className="gor-card" style={{ padding: '10px 12px' }}>
                <button type="button" onClick={() => toggle(occurrence)} aria-expanded={isOpen} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', width: '100%' }}>
                    <span aria-hidden="true" style={{ color: 'var(--gold-600)', flex: 'none' }}>❧</span>
                    <span style={{ fontSize: 15 }}>{occurrence}</span>
                </button>
                <span className="gor-slip-date">Cried in the forum · Week {toRoman(week)}</span>
                {inFlight && <span className="gor-slip-progress" aria-hidden="true" />}
                {isOpen && (
                    <div className="gor-slip-open">
                        {findings.map(finding => (
                            <Finding key={finding.question} kicker={QUESTIONS[finding.question].kicker} text={finding.text} />
                        ))}
                        {inFlight && <span role="status" style={quiet}>Seeking…</span>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {OCCURRENCE_QUESTIONS.filter(question => !asked.has(question)).map(question => (
                                <Button
                                    key={question}
                                    size="sm"
                                    variant="ghost"
                                    disabled={interactionLocked || seeking !== null || !playerEntity}
                                    onClick={() => void ask(occurrence, question)}
                                >{QUESTIONS[question].ask}</Button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SubRail
                ariaLabel="Events register"
                value={register}
                onChange={selectRegister}
                options={[
                    { value: 'week', label: 'This week', count: events.length },
                    { value: 'examined', label: 'Examined', count: examinedThisWeek.length },
                ]}
            />
            {/* A standing instruction renders only when there is something to press. */}
            {shown.length > 0 && <span style={quiet}>Press an occurrence and your agents will seek its causes.</span>}
            {shown.length === 0 && (
                <EmptyRegister
                    silhouette={<QuietWeekSilhouette />}
                    line={register === 'examined'
                        ? 'You have put no questions to this week’s occurrences.'
                        : 'Nothing was cried in the forum this week.'}
                    hint={register === 'examined'
                        ? 'Press an occurrence and your agents will seek its causes.'
                        : 'A quiet week is not an empty one.'}
                />
            )}
            {shown.map(slip)}
        </div>
    );
};

export default CurrentEventsTab;
