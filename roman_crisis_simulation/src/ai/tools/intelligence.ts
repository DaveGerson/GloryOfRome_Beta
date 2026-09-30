import { GoogleGenAI } from "@google/genai";
import { Entity, WorldState, StoryRelevance, Adjudication, SimulationState, ActionResolutionEvent, NpcIntent, InvestigationRolls, InvestigationTruth, TruthLedgerEntry, GroundedOccurrenceQuestion, OccurrenceSiblingOutcome, OccurrenceTruth, TurnHistoryEntry } from '../../types';
import type { KnowledgeClaim, OccurrenceQuestion } from '../../knowledge/store';
import { isEntityKnownToPlayer } from '../../knowledge/relationships';
import { mockGetClarificationOnEvent, mockGetDeepAnalysis, mockGetInvestigationResult, mockGetPlayerMonologue, mockGetSchemeNatureReading, mockGetStoryRelevance, mockIntelSeed } from '../mocks';
import { StoryRelevanceSchema, SimulationStateSchema, PlayerMonologuePayloadSchema, buildInvestigationResultSchema } from '../core/schemas';
import { generateStructured, generateText, GEMINI_PRO, GEMINI_FLASH } from '../core/geminiService';
import { zStoryRelevance, zSimulationState, zPlayerMonologuePayload, zInvestigationResult } from '../core/zodSchemas';
import type { PlayerMonologuePayloadInterchange, SimulationStateInterchange } from '../core/actorsBoundary';
import {
    rollD20,
    resolveAction,
    derivePersonalityModifier,
    deriveOppositionModifier,
    deriveInvestigationDifficulty,
    resolveInvestigationAccuracy,
    resolveInvestigationFidelity,
    OCCURRENCE_DIFFICULTY,
    ActionResolutionTier,
    createSeededRng,
    generateSeed,
    type Rng,
} from '../core/resolution';
import {
    assessmentTruth,
    investigationLedgerEntries,
    investigationTruth,
    occurrenceGrounding,
    occurrenceTruth,
    planInvestigation,
    planOccurrence,
    planSchemeNature,
    schemeClueRecords,
    schemeNatureLedgerEntry,
    type GroundTruthKind,
    type InvestigationPlan,
    type SchemeNaturePlan,
} from '../core/groundTruth';
import {
    buildClarificationPrompt,
    buildDeepAnalysisPrompt,
    buildInvestigationPrompt,
    buildOccurrenceForecastPrompt,
    buildSchemeNaturePrompt,
    buildStoryRelevancePrompt,
    buildSimulationStateUpdatePrompt,
} from '../prompts/intelligence';
import { buildPlayerMonologuePrompt } from '../prompts/narration';
import { assertPlayerVisibleTextSafe, assertPlayerVisibleValueSafe } from '../core/playerBoundary';

/**
 * What your agents bring back about a public occurrence: the account the
 * player receives, and - for a grounded question with a record to ground it
 * in - its GM-PRIVATE truth (D11/D47), forwarded untouched and unrendered to
 * the commit that writes it to the truth ledger (hooks/useIntelCommits.ts).
 */
export interface OccurrenceAnswer {
    text: string;
    truth?: OccurrenceTruth;
}

/**
 * The honest answer to a grounded question about an occurrence with no
 * attribution on record - a save from before the record existed, or a
 * headline it could not be paired with (ai/core/groundTruth.ts::
 * occurrenceGrounding). Not rolled and not recorded as a falsehood: it claims
 * nothing about the occurrence, only that the agents found nothing to follow.
 * Player-visible, in the agents' voice.
 */
export const NO_THREAD_TO_FOLLOW: Record<GroundedOccurrenceQuestion, string> = {
    who_is_behind_it: 'Your agents found no thread to follow. Whose hand was in this, no one they asked could say.',
    who_gains: 'Your agents found no thread to follow. Who profits by this, no one they asked could say.',
};

/**
 * The figures in the player's network, by name - what a "What follows?"
 * forecast reasons from, as it always has. Names only reach a prompt: an id
 * never does. (A grounded answer's decoys are drawn otherwise: see
 * groundTruth.ts::planOccurrence.)
 */
function figuresKnownTo(player: Entity, allEntities: readonly Entity[]): string[] {
    return player.visibility_network
        .map(id => allEntities.find(entity => entity.entity_id === id)?.name ?? '')
        .filter(name => name.trim().length > 0);
}

/**
 * Whether the figures the HEADLINE names are all the player's own or inside
 * their network - the old clarification's isVisible, read off public text
 * only, so the rolls never tell anything of who the hidden hands are. A
 * headline that names no one reads as inside.
 */
function headlineStanding(occurrence: string, player: Entity, allEntities: readonly Entity[]): 'inNetwork' | 'outsideNetwork' {
    const text = occurrence.toLowerCase();
    const named = allEntities.filter(entity => entity.name.trim().length > 0 && text.includes(entity.name.toLowerCase()));
    return named.every(entity => entity.entity_id === player.entity_id || player.visibility_network.includes(entity.entity_id))
        ? 'inNetwork'
        : 'outsideNetwork';
}

/** What a question put to an occurrence reads, besides the question itself. */
export interface OccurrenceAsking {
    /** The live roster. */
    allEntities: Entity[];
    /** The reign's history: the attribution record the truth is read off. */
    turnHistory: readonly TurnHistoryEntry[];
    /** The player's own knowledge store: who they know, by the Dramatis Personae's own test - a decoy keeps a true hand's familiarity. */
    knowledge: KnowledgeClaim[];
    /** What the other grounded question on this occurrence already came back with (hooks/useIntelCommits.ts). */
    sibling?: OccurrenceSiblingOutcome | null;
}

/**
 * A question put to a public occurrence (the Events tab). "Who is behind
 * it?" and "Who gains?" are GROUNDED (D47) in the turn's GM-private
 * attribution record (TurnHistoryEntry.headlineActors): the hands the
 * adjudicator declared - and, for "Who gains?", the open aims each pursued
 * that turn - reach the prompt at the rolled fidelity and accuracy, code
 * picking every entry the account carries, decoys included
 * (groundTruth.ts::planOccurrence), and the truth of the account comes back
 * beside it. "What follows?" is a forecast: ungrounded, unrolled, with no
 * truth. An occurrence with no record takes the honest NO_THREAD_TO_FOLLOW,
 * unrolled and with no truth either.
 *
 * WHAT THE ROLLS READ. An investigation rolls against its target's paranoia
 * and the player's intrigue; an occurrence has no single target, and asking
 * after a public event sends no agent into anyone's house - so, like a
 * commissioned assessment, it makes no operational roll and carries no
 * consequence, and only the D47 accuracy and fidelity rolls are made:
 *  - the investigator term (both rolls) is the player's intrigue, as for
 *    every investigation;
 *  - the old clarification's isVisible flag, read off the PUBLIC headline
 *    (`headlineStanding`): are the figures it names the player's own, or
 *    inside their network? It sets the standing the rolls read at
 *    (DEEP_ANALYSIS_STANDING - the agents ask their own contacts, or
 *    strangers) and the fidelity roll's difficulty
 *    (resolution.ts::OCCURRENCE_DIFFICULTY). Never the hidden hands: how
 *    much comes back is visible, and must not tell who they are;
 *  - accuracy's target term reads as average: no one figure lays the false
 *    trail about a public event.
 * For an average investigator (the band tables in resolution.ts):
 *                      false / garbled / true    fragment / partial / fuller
 *   inside the network  15%     30%      55%       25%        30%      45%
 *   outside it          30%     30%      40%       50%        30%      20%
 * `asking.sibling` is what the other grounded question on this occurrence
 * already came back with, so the two decide "came back empty" once between
 * them. In Mock Mode the generator is seeded from the occurrence and the
 * question (ai/mocks.ts::mockIntelSeed), so the same question lands the same
 * way.
 */
export const getClarificationOnEvent = async (
    ai: GoogleGenAI,
    occurrence: string,
    question: OccurrenceQuestion,
    player: Entity,
    asking: OccurrenceAsking,
    isMockMode: boolean,
): Promise<OccurrenceAnswer> => {
    const { allEntities, turnHistory, knowledge, sibling = null } = asking;
    if (question === 'what_follows') {
        let forecast: string;
        if (isMockMode) {
            if(!mockGetClarificationOnEvent) throw new Error("Mock function 'mockGetClarificationOnEvent' is not implemented.");
            forecast = await mockGetClarificationOnEvent(occurrence, question, null);
        } else {
            const { systemInstruction, prompt } = buildOccurrenceForecastPrompt(occurrence, player, figuresKnownTo(player, allEntities));
            forecast = (await generateText(ai, { callName: 'clarification', model: GEMINI_FLASH, systemInstruction, prompt })) || "No response generated.";
        }
        assertPlayerVisibleTextSafe(forecast);
        return { text: forecast };
    }

    const grounding = occurrenceGrounding({ turnHistory, occurrence, question, roster: allEntities });
    if (!grounding) return { text: NO_THREAD_TO_FOLLOW[question] };

    const standing = headlineStanding(occurrence, player, allEntities);
    const { seed, rng } = intelGenerator(isMockMode, occurrence, question);
    const rolls = rollAccuracyAndFidelity(seed, rng, DEEP_ANALYSIS_STANDING[standing], {
        investigatorIntrigue: player.skills?.intrigue ?? null,
        targetParanoia: undefined,
        difficulty: OCCURRENCE_DIFFICULTY[standing],
    });
    // Every name a figure wears, now or in any snapshot: a stranger never borrows one.
    const takenNames = new Set([
        ...allEntities.map(entity => entity.name),
        ...turnHistory.flatMap(entry => entry.postTurnEntities ?? []).map(entity => entity.name),
        ...grounding.aliveThen.map(figure => figure.name),
    ].filter((name): name is string => typeof name === 'string').map(name => name.trim().toLocaleLowerCase()));
    const plan = planOccurrence(grounding, question, rolls, rng, {
        playerId: player.entity_id,
        isKnown: id => isEntityKnownToPlayer(player, allEntities.find(entity => entity.entity_id === id) ?? ({ entity_id: id } as Entity), knowledge),
        takenNames,
        sibling,
    });

    let text: string;
    if (isMockMode) {
        if(!mockGetClarificationOnEvent) throw new Error("Mock function 'mockGetClarificationOnEvent' is not implemented.");
        text = await mockGetClarificationOnEvent(occurrence, question, plan);
    } else {
        const { systemInstruction, prompt } = buildClarificationPrompt(occurrence, question, player, plan);
        text = (await generateText(ai, { callName: 'clarification', model: GEMINI_FLASH, systemInstruction, prompt })) || "No response generated.";
    }
    assertPlayerVisibleTextSafe(text);
    return { text, truth: occurrenceTruth(plan, grounding, occurrence, rolls, text) };
};
/**
 * The generator every D47 draw of one investigation-family call comes from:
 * a fresh recorded seed, or - offline - the target's (or occurrence's) and
 * aspect's fixed mock seed (ai/mocks.ts::mockIntelSeed), so a provider-free
 * run exercises the same grounded path deterministically and never touches
 * Math.random.
 */
function intelGenerator(isMockMode: boolean, targetId: string, kind: GroundTruthKind | GroundedOccurrenceQuestion): { seed: number; rng: Rng } {
    const seed = isMockMode ? mockIntelSeed(targetId, kind) : generateSeed();
    return { seed, rng: createSeededRng(seed) };
}

/**
 * The D47 accuracy and fidelity rolls (ai/core/resolution.ts) for one
 * investigation-family call, drawn in that order from `rng` at the given
 * tier (or fixed standing), and recorded with the seed behind them.
 */
function rollAccuracyAndFidelity(
    seed: number,
    rng: Rng,
    tier: ActionResolutionTier,
    inputs: { investigatorIntrigue: number | null; targetParanoia: number | undefined; difficulty: number },
): InvestigationRolls {
    const accuracy = resolveInvestigationAccuracy({
        roll: rollD20(rng),
        tier,
        investigatorIntrigue: inputs.investigatorIntrigue,
        targetParanoia: inputs.targetParanoia,
    });
    const fidelity = resolveInvestigationFidelity({
        roll: rollD20(rng),
        tier,
        investigatorIntrigue: inputs.investigatorIntrigue,
        difficulty: inputs.difficulty,
    });
    return {
        seed,
        tier,
        accuracyRoll: accuracy.roll,
        accuracy: accuracy.accuracy,
        fidelityRoll: fidelity.roll,
        fidelity: fidelity.fidelity,
    };
}

/**
 * The D47 rolls for one investigation-family call on a target, and the plan
 * (ai/core/groundTruth.ts) they shape: which of the target's real truths
 * reach the prompt, and whether they come back true, garbled or false.
 */
function rollAndPlan(
    target: Entity,
    player: Entity,
    kind: GroundTruthKind,
    tier: ActionResolutionTier,
    seed: number,
    rng: Rng,
): { rolls: InvestigationRolls; plan: InvestigationPlan } {
    const rolls = rollAccuracyAndFidelity(seed, rng, tier, {
        investigatorIntrigue: player.skills?.intrigue ?? null,
        targetParanoia: target.personality?.paranoia,
        difficulty: deriveInvestigationDifficulty(target),
    });
    return { rolls, plan: planInvestigation(target, kind, { accuracy: rolls.accuracy, fidelity: rolls.fidelity }, rng) };
}

/**
 * The standing a commissioned Spymaster's Assessment reads at in place of an
 * operational tier roll (it makes none - no agent risks being seen, so it
 * carries no consequences): a figure inside the player's network is read as a
 * clean operation would be; one outside it as a middling one - less reached,
 * more easily misled. Only the D47 accuracy and fidelity rolls are made. A
 * question put to an occurrence reads at the same standing, by whether the
 * hands behind it are inside the network (getClarificationOnEvent).
 */
const DEEP_ANALYSIS_STANDING: Record<'inNetwork' | 'outsideNetwork', ActionResolutionTier> = {
    inNetwork: 'success',
    outsideNetwork: 'partial_success',
};

/**
 * A commissioned Spymaster's Assessment, grounded (D47) in the target's real
 * situation and aims at the rolled fidelity and accuracy. Returns the
 * assessment the player receives and its GM-PRIVATE truth (one finding: the
 * assessment as delivered), which the commit writes to the truth ledger and
 * nothing renders.
 */
export const getDeepAnalysis = async (ai: GoogleGenAI, target: Entity, player: Entity, isMockMode: boolean): Promise<{ analysis: string; truth: InvestigationTruth }> => {
    const isVisible = player.visibility_network.includes(target.entity_id);
    const { seed, rng } = intelGenerator(isMockMode, target.entity_id, 'deep_analysis');
    const tier = DEEP_ANALYSIS_STANDING[isVisible ? 'inNetwork' : 'outsideNetwork'];
    const { rolls, plan } = rollAndPlan(target, player, 'deep_analysis', tier, seed, rng);

    let playerVisibleText: string;
    if (isMockMode) {
        if(!mockGetDeepAnalysis) throw new Error("Mock function 'mockGetDeepAnalysis' is not implemented.");
        playerVisibleText = await mockGetDeepAnalysis(target, plan);
    } else {
        const { systemInstruction, prompt } = buildDeepAnalysisPrompt(target, player, isVisible, plan);
        const text = await generateText(ai, { callName: 'deepAnalysis', model: GEMINI_FLASH, systemInstruction, prompt });
        playerVisibleText = text || "Intelligence unavailable.";
    }
    assertPlayerVisibleTextSafe(playerVisibleText);
    return { analysis: playerVisibleText, truth: assessmentTruth(plan, target.entity_id, rolls, playerVisibleText) };
};

/** `isRisky` nudges the roll's difficulty up slightly - kept as a signature-compatible parameter (components/DramatisPersonaeTab.tsx always passes `true` today) rather than removed outright now that a real roll (not a prose "40% chance" line) decides the outcome. */
const RISKY_INVESTIGATION_DIFFICULTY_BONUS = 2;

/** Fallback consequence text used ONLY if the model ignores the tier guidance and returns `null` on a failure tier - the field's non-null-ness on a failure tier is enforced in code, not just prompt hope. */
const DEFAULT_INVESTIGATION_CONSEQUENCE: Record<'critical_failure' | 'failure', string> = {
    critical_failure: 'Your agent was caught red-handed - the target now knows exactly who came looking, and why.',
    failure: 'Your agent was spotted and is now being watched, reducing their effectiveness.',
};

function isFailureTier(tier: ActionResolutionTier): tier is 'critical_failure' | 'failure' {
    return tier === 'critical_failure' || tier === 'failure';
}

/** What an investigation hands back: the player-facing account, the GM-only roll trace, and the GM-PRIVATE truth of every finding (D47). */
export interface InvestigationToolResult {
    report: string;
    consequences: string | null;
    reportData: string[];
    resolutionTrace?: ActionResolutionEvent;
    /**
     * GM-PRIVATE (D11/D47): one entry per itemised finding in `reportData`,
     * in order, with whether it is true and the ground truth behind it. The
     * caller forwards it, untouched and unrendered, to the commit that writes
     * the truth ledger - never to any player-facing surface.
     */
    truth?: InvestigationTruth;
}

export const getInvestigationResult = async (ai: GoogleGenAI, target: Entity, player: Entity, isRisky: boolean, isMockMode: boolean, subject: 'secrets' | 'beliefs' | 'scheme' = 'secrets'): Promise<InvestigationToolResult> => {
    // Resolution layer (ROADMAP_0_MASTER_PLAN.md Phase 3 item 5): resolve a
    // HIDDEN dice roll BEFORE the model call, exactly like the mortality
    // pipeline and the main turn's action-resolution layer - the model
    // never decides whether the investigation succeeds, only narrates the
    // pre-decided tier. No assessment call is needed here (unlike the main
    // turn's player action): an investigation is always a real, consequential
    // 'intrigue' check, so it always rolls.
    //
    // Investigations run OUTSIDE the turn pipeline (player-triggered from
    // the UI), so each gets its OWN 32-bit seed rather than drawing from a
    // turn's generator; the seed is recorded on the returned
    // `resolutionTrace` so the roll is replayable
    // (ai/core/resolution.ts::createSeededRng). The trace - seed, roll,
    // tier, all of it - is GM-console-only data (DESIGN_DECISIONS.md D4):
    // callers must never render it, or anything derived from it, on a
    // player-facing surface.
    //
    // D47: the same generator then draws the accuracy and fidelity rolls and
    // picks which of the target's real truths are reached (rollAndPlan) - in
    // Mock Mode too, from the fixed mock seed, so offline play runs the same
    // grounded path.
    const { seed, rng } = intelGenerator(isMockMode, target.entity_id, subject);
    const relevantSkillValue = player.skills?.intrigue ?? null;
    const personalityModifier = derivePersonalityModifier({
        personality: player.personality,
        relevantSkill: 'intrigue',
        actionCategory: `${subject} investigation`,
    });
    const oppositionModifier = deriveOppositionModifier({
        relationshipTowardActor: target.relationships[player.entity_id],
    });
    const baseDifficulty = deriveInvestigationDifficulty(target);
    const difficulty = isRisky ? baseDifficulty + RISKY_INVESTIGATION_DIFFICULTY_BONUS : baseDifficulty;

    const resolution = resolveAction({
        roll: rollD20(rng),
        relevantSkillValue,
        personalityModifier,
        oppositionModifier,
        difficulty,
    });

    // The `assessment` block mirrors what the main turn's assessment call
    // would have said about this fixed check (see ActionResolutionEvent in
    // types.ts) - investigations make no assessment call, since they are
    // always a consequential 'intrigue' roll.
    const resolutionTrace: ActionResolutionEvent = {
        assessment: {
            is_consequential: true,
            action_category: `${subject} investigation`,
            relevant_skill: 'intrigue',
            difficulty,
            opposing_entity_id: target.entity_id,
            rationale: "Investigations always roll: a fixed intrigue check against the target's derived difficulty.",
        },
        roll: resolution.roll,
        total: resolution.total,
        margin: resolution.margin,
        tier: resolution.tier,
        seed,
    };

    const { rolls, plan } = rollAndPlan(target, player, subject, resolution.tier, seed, rng);

    if (isMockMode) {
        if(!mockGetInvestigationResult) throw new Error("Mock function 'mockGetInvestigationResult' is not implemented.");
        const mockResult = await mockGetInvestigationResult(target, isRisky, subject, plan);
        assertPlayerVisibleValueSafe(mockResult);
        const reportData = mockResult.reportData.slice(0, plan.findings.length);
        return { report: mockResult.report, consequences: mockResult.consequences, reportData, resolutionTrace, truth: investigationTruth(plan, target.entity_id, rolls, reportData, mockResult.report) };
    }

    const { systemInstruction, prompt } = buildInvestigationPrompt(target, player, subject, resolution.tier, plan);
    const result = await generateStructured<{ report: string, consequences: string | null, reportData: string[] }>(ai, {
        callName: 'investigation',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: buildInvestigationResultSchema(subject),
        zodSchema: zInvestigationResult,
        thinkingConfig: { thinkingBudget: 512 },
    });

    // Enforce the tier's consequences contract POST-HOC, in code - not just
    // prompt hope: success tiers are ALWAYS null (even if the model
    // hallucinated a consequence anyway), failure tiers are ALWAYS non-null
    // (falling back to a generic consequence if the model ignored the
    // directive and returned null).
    const consequences = isFailureTier(resolution.tier)
        ? (result.consequences ?? DEFAULT_INVESTIGATION_CONSEQUENCE[resolution.tier])
        : (resolution.tier === 'partial_success' ? result.consequences : null);

    // The mechanics boundary judges everything the model returned, dropped
    // findings included: a reply that leaks a roll anywhere is refused whole.
    assertPlayerVisibleValueSafe({ report: result.report, consequences, reportData: result.reportData });

    // D47, enforced the same way: the player receives one itemised finding
    // per PLANNED finding and no more, so every finding shown (and every
    // secret filed as leverage) carries a truth the engine knows. A finding
    // the model invented beyond the plan is dropped here, never shown.
    const reportData = result.reportData.slice(0, plan.findings.length);

    return { report: result.report, consequences, reportData, resolutionTrace, truth: investigationTruth(plan, target.entity_id, rolls, reportData, result.report) };
};

/**
 * The D28 reveal's reading: the design the accumulated scheme clues add up
 * to, in the agents' voice. `plan` (ai/core/groundTruth.ts::planSchemeNature)
 * has already decided - from the clue standings on the truth ledger - whether
 * that design is the true one, a garbled one or a false one. Returns null
 * when the model returns nothing (the caller then shows the honest
 * "particulars pending" line and records no nature).
 */
export const getSchemeNatureReading = async (ai: GoogleGenAI, target: Entity, player: Entity, plan: SchemeNaturePlan, isMockMode: boolean): Promise<string | null> => {
    let text: string;
    if (isMockMode) {
        if(!mockGetSchemeNatureReading) throw new Error("Mock function 'mockGetSchemeNatureReading' is not implemented.");
        text = await mockGetSchemeNatureReading(target, plan);
    } else {
        const { systemInstruction, prompt } = buildSchemeNaturePrompt(target, player, plan);
        text = (await generateText(ai, { callName: 'schemeNature', model: GEMINI_FLASH, systemInstruction, prompt })) ?? '';
    }
    const nature = text.trim();
    if (nature.length === 0) return null;
    assertPlayerVisibleTextSafe(nature);
    return nature;
};

/** What settling one investigation's truth commits: its ledger entries and, at the D28 reveal, the nature reading the dossier will quote. */
export interface SettledInvestigationTruth {
    ledgerEntries: TruthLedgerEntry[];
    /**
     * Present only when this scheme buy reached (or stood past) the reveal:
     * the reading, or null when none came back - then no nature is recorded
     * and the store keeps the nature already earned (knowledge/store.ts
     * ::ingestInvestigationReveal). Handed to the knowledge commit as is.
     */
    natureReading?: string | null;
}

/**
 * The commit-side half of D47/D11 for one bought investigation, shared by
 * hooks/useIntelCommits.ts and the journey harness so the two cannot drift:
 * one ledger entry per finding the player received, and - when this is a
 * scheme buy that reaches the D28 reveal (`natureDue`) - the nature reading,
 * planned from EVERY clue on the ledger plus this buy's, and its own ledger
 * entry recording whether the nature the player now holds is the truth.
 * `ledger` is read, never written; the caller appends the entries.
 */
export async function settleInvestigationTruth(params: {
    ai: GoogleGenAI;
    isMockMode: boolean;
    target: Entity;
    player: Entity;
    truth: InvestigationTruth;
    ledger: readonly TruthLedgerEntry[];
    natureDue: boolean;
    turn: number;
    stamp: number;
}): Promise<SettledInvestigationTruth> {
    const { ai, isMockMode, target, player, truth, ledger, natureDue, turn, stamp } = params;
    const ledgerEntries = investigationLedgerEntries(truth, turn, stamp);
    if (truth.kind !== 'scheme' || !natureDue) return { ledgerEntries };

    const clues = schemeClueRecords([...ledger, ...ledgerEntries], target.entity_id);
    const naturePlan = planSchemeNature(target, clues);
    const natureReading = await getSchemeNatureReading(ai, target, player, naturePlan, isMockMode);
    if (natureReading === null) return { ledgerEntries, natureReading: null };
    return {
        ledgerEntries: [...ledgerEntries, schemeNatureLedgerEntry(target.entity_id, naturePlan, natureReading, turn, stamp)],
        natureReading,
    };
}

/**
 * Task 4 of the actors-attribution refactor (task-4-design.md section 2):
 * switches from plain `generateText` to structured output
 * (`PlayerMonologuePayloadSchema`/`zPlayerMonologuePayload`, still
 * GEMINI_FLASH), returning the parsed `{ text, actors }` payload rather than
 * a bare string. The STRIP for this surface IS `.text` - there is no
 * `stripActorsFromX` companion (see actorsBoundary.ts) - ai/core/turn.ts
 * commits `payload.text` (post-gate) as the player-visible monologue. The
 * declared `actors` feed the no-attempt declaration gate at the call site
 * (defense-in-depth per the design doc's REACHABILITY FINDING - this call is
 * never reached on a validated no-attempt submission).
 */
export const getPlayerMonologue = async (
    ai: GoogleGenAI,
    player: Entity,
    turnHeadlines: string[],
    recentPlayerIntents: string[],
    hasObservableAttempt: boolean,
    isMockMode: boolean,
    // D49: the figures the headlines name - only their OPENLY professed ties
    // reach the prompt (buildPlayerMonologuePrompt). Optional, [] = none.
    figuresAtHand: readonly Entity[] = [],
): Promise<PlayerMonologuePayloadInterchange> => {
    if (isMockMode) {
        if(!mockGetPlayerMonologue) throw new Error("Mock function 'mockGetPlayerMonologue' is not implemented.");
        const payload = await mockGetPlayerMonologue(player, turnHeadlines, recentPlayerIntents);
        assertPlayerVisibleTextSafe(payload.text);
        return payload;
    }

    const { systemInstruction, prompt } = buildPlayerMonologuePrompt(player, turnHeadlines, recentPlayerIntents, hasObservableAttempt, figuresAtHand);
    const payload = await generateStructured<PlayerMonologuePayloadInterchange>(ai, {
        callName: 'playerMonologue',
        model: GEMINI_FLASH,
        systemInstruction,
        prompt,
        responseSchema: PlayerMonologuePayloadSchema,
        zodSchema: zPlayerMonologuePayload,
    });
    const playerVisibleText = payload.text || "I am contemplative.";
    assertPlayerVisibleTextSafe(playerVisibleText);
    return { ...payload, text: playerVisibleText };
};

export const getStoryRelevance = async (ai: GoogleGenAI, turnNumber: number, prevTurnHeadlines: string[], worldState: WorldState, npcEntities: Entity[], previousIntents: NpcIntent[], isMockMode: boolean): Promise<StoryRelevance> => {
    if (isMockMode) {
        if (!mockGetStoryRelevance) throw new Error("Mock function 'mockGetStoryRelevance' is not implemented.");
        return mockGetStoryRelevance(turnNumber, previousIntents);
    }

    const { systemInstruction, prompt } = buildStoryRelevancePrompt(turnNumber, prevTurnHeadlines, worldState, npcEntities, previousIntents);
    return generateStructured<StoryRelevance>(ai, {
        callName: 'storyRelevance',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: StoryRelevanceSchema,
        zodSchema: zStoryRelevance,
        thinkingConfig: { thinkingBudget: 512 },
    });
};

/**
 * D42 (roadmaps/DESIGN_DECISIONS.md; task-4-design.md section 2/3): the
 * STRIP moves out of this helper to ai/core/turn.ts's commit boundary,
 * so this now returns the raw `SimulationStateInterchange` (still carrying
 * `actors`) rather than the committed `SimulationState` - the caller must
 * gate `major_ongoing_crisis` against its declaration before stripping.
 * Mock branch mirrors the same shape: `{ ...oldState, actors: [] }` (no
 * provider, so no declaration - the mock pipeline keeps its own tripwire-only
 * crisis gate, see ai/mocks.ts).
 */
export const getUpdatedSimulationState = async (ai: GoogleGenAI, adjudication: Adjudication, oldState: SimulationState, hasObservableAttempt: boolean, isMockMode: boolean): Promise<SimulationStateInterchange> => {
    if (isMockMode) {
        assertPlayerVisibleValueSafe(oldState);
        return { ...oldState, actors: [] };
    }

    const { systemInstruction, prompt } = buildSimulationStateUpdatePrompt(adjudication, oldState, hasObservableAttempt);
    const rawUpdatedState = await generateStructured<SimulationStateInterchange>(ai, {
        callName: 'updatedSimulationState',
        model: GEMINI_PRO,
        systemInstruction,
        prompt,
        responseSchema: SimulationStateSchema,
        zodSchema: zSimulationState,
        thinkingConfig: { thinkingBudget: 512 },
    });
    assertPlayerVisibleValueSafe(rawUpdatedState);
    return rawUpdatedState;
};
