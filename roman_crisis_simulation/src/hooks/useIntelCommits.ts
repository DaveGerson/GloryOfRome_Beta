/**
 * hooks/useIntelCommits.ts
 *
 * The three durable commits SidePanel's intelligence surfaces hand back to
 * the composition root - a commissioned deep analysis, an occurrence
 * finding, and a bought investigation reveal - plus the GM console's
 * directive, the one other side-surface write. Moved verbatim out of
 * App.tsx (2026-09-23).
 *
 * Each handler receives the DomainMutationContext of the runDomainMutation
 * lease its caller acquired, and re-checks `request.isCurrent()` adjacent
 * to every await and immediately before its durable write, so a surface
 * that unmounted mid-request never charges or commits a result.
 */

import type { GoogleGenAI } from '@google/genai';
import type { Entity, InvestigationResult, InvestigationTruth, Message, OccurrenceSiblingOutcome, OccurrenceTruth, Report, TruthLedgerEntry } from '../types';
import type { DomainMutationContext } from '../state/domainMutation';
import type { SaveGameState } from '../persistence/saveGame';
import { computeDeepAnalysisKnowledge, computeInvestigationKnowledge } from '../knowledge/commit';
import { deriveDossier, ingestOccurrenceFinding, occurrenceClaimKey, occurrenceSiblingInStore, SCHEME_CLUES_TO_REVEAL, type KnowledgeClaim, type OccurrenceQuestion } from '../knowledge/store';
import { convertResourceToInvestigations, type ConvertibleResource } from '../knowledge/pricing';
import {
    buildInvestigationRelationshipEvidence,
    knownRecipientOptionsForPlayer,
} from '../knowledge/relationships';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { settleInvestigationTruth, type SettledInvestigationTruth } from '../ai/tools/intelligence';
import { investigationLedgerEntries, occurrenceLedgerEntry, siblingOccurrenceOutcome } from '../ai/core/groundTruth';
import { appendTruthLedgerEntries } from '../ai/core/engine';
import { applySystemicResourceRule, SYSTEMIC_RESOURCES } from '../ai/core/resources';
import { appendFallout, hasFallout } from '../components/investigationLoop';
import { relationshipDraftsUnlessOffline, type DomainCommit, type TransactionNote } from '../app/transactions';

export interface IntelCommitsDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    entities: Entity[];
    playerCharacterId: string | null;
    knowledge: KnowledgeClaim[];
    reports?: Report[];
    /**
     * GM-PRIVATE (D11): the truth ledger, read here only to settle a bought
     * finding's truth (D47) - the clue standings a scheme's nature follows
     * from - and appended to in the same commit as the finding itself.
     */
    truthLedger: TruthLedgerEntry[];
    pendingIntelligenceFallout: string[];
    messages: Message[];
    turnNumber: number;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    setTransactionNote: (note: TransactionNote | null) => void;
}

const TREASURY_REFUSAL_TITLE = 'The treasury cannot meet it';
const INSUFFICIENT_FUNDS_NOTE = 'Not enough funds in the treasury to complete this order.';

function numericBalance(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function deductDenariiWithSystemicRule(
    player: Entity,
    denariiCost: number,
    turnNumber: number,
    existingReportCount: number,
): { ok: boolean; finalDenarii: number; reports: Report[] } {
    const currentDenarii = numericBalance(player.resources.denarii);
    if (!Number.isFinite(denariiCost) || denariiCost < 0) {
        return { ok: false, finalDenarii: currentDenarii, reports: [] };
    }
    if (denariiCost === 0) {
        return { ok: true, finalDenarii: currentDenarii, reports: [] };
    }
    if (currentDenarii < denariiCost) {
        return { ok: false, finalDenarii: currentDenarii, reports: [] };
    }
    const clonedPlayer: Entity = { ...player, resources: { ...player.resources } };
    const { finalValue, reports } = applySystemicResourceRule(
        SYSTEMIC_RESOURCES.denarii,
        clonedPlayer,
        'denarii',
        currentDenarii,
        currentDenarii - denariiCost,
        turnNumber,
        { emitReports: true, sequence: existingReportCount },
    );
    return { ok: true, finalDenarii: finalValue, reports };
}

export function useIntelCommits(deps: IntelCommitsDeps) {
    const {
        ai, isMockMode, entities, playerCharacterId, knowledge, reports = [], truthLedger, pendingIntelligenceFallout, messages, turnNumber,
        buildSaveState, commitDomainMutation, setTransactionNote,
    } = deps;

    /**
     * A commissioned Spymaster's Assessment: the deep_analyses (or D27 coin)
     * spend AND the assessment itself, in one atomic commit (D14). Its
     * GM-private truth (D47) lands on the truth ledger in the same commit.
     */
    const handleDeepAnalysis = (
        targetId: string,
        cost: number,
        analysis: string,
        request: DomainMutationContext,
        truth?: InvestigationTruth,
        denariiCost = 0,
    ): boolean => {
        if (!request.isCurrent()) return false;
        if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(denariiCost) || denariiCost < 0) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const player = entities.find(e => e.entity_id === playerCharacterId);
        if (!player) return false;

        const currentUnits = numericBalance(player.resources.deep_analyses);
        if (cost > 0 && currentUnits < cost) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const denariiStep = deductDenariiWithSystemicRule(player, denariiCost, turnNumber, reports.length);
        if (!denariiStep.ok) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }

        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = { ...e.resources };
                if (cost > 0) {
                    newResources.deep_analyses = Math.max(0, currentUnits - cost);
                }
                if (denariiCost > 0) {
                    newResources.denarii = denariiStep.finalDenarii;
                }
                return { ...e, resources: newResources };
            }
            return e;
        });
        const nextKnowledge = computeDeepAnalysisKnowledge({ prev: knowledge, targetId, analysis, turnNumber });
        const nextTruthLedger = truth
            ? appendTruthLedgerEntries(truthLedger, investigationLedgerEntries(truth, turnNumber, Date.now()))
            : truthLedger;
        const nextReports = denariiStep.reports.length > 0 ? [...reports, ...denariiStep.reports] : reports;
        const reportUpdate = denariiStep.reports.length > 0 ? { reports: nextReports } : {};
        if (!request.isCurrent()) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities, knowledge: nextKnowledge, truthLedger: nextTruthLedger, ...reportUpdate }),
            action: {
                type: 'INVESTIGATION_COMMITTED',
                entities: newEntities,
                pendingIntelligenceFallout,
                knowledge: nextKnowledge,
                truthLedger: nextTruthLedger,
                ...reportUpdate,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your change could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };

    /**
     * WP-15 / audit item 40 — what your agents came back with about a public
     * occurrence. It used to live in CurrentEventsTab's component-local
     * `useState` and was discarded the moment the player switched tabs, even
     * though they had waited on the AI call for it. It now lands in the
     * knowledge store in a durable commit, exactly like a bought investigation
     * reveal, so it survives a tab switch and a reload.
     *
     * Free: asking costs no investigation. What it costs is the wait.
     *
     * D47/D11: a grounded answer ("Who is behind it?", "Who gains?") carries
     * its GM-private truth, which lands on the truth ledger in the SAME commit
     * as the finding, linked to it by the finding's claim key. A forecast
     * ("What follows?") and the honest "no thread to follow" carry none, and
     * leave the ledger as it stands.
     */
    const handleOccurrenceFinding = (
        occurrence: string,
        question: OccurrenceQuestion,
        text: string,
        request: DomainMutationContext,
        truth?: OccurrenceTruth,
    ): boolean => {
        if (!request.isCurrent()) return false;
        // Whether the account named anyone rides on the player's own finding
        // too: what they read, and the durable home the sibling question reads.
        const newKnowledge = ingestOccurrenceFinding(knowledge, {
            occurrence, question, text, turn: turnNumber,
            ...(truth ? { cameBackEmpty: truth.finding.cameBackEmpty } : {}),
        });
        const ledgerMove = truth
            ? { truthLedger: appendTruthLedgerEntries(truthLedger, [occurrenceLedgerEntry(truth, occurrenceClaimKey(occurrence, question), turnNumber, Date.now())]) }
            : {};
        return commitDomainMutation({
            candidate: buildSaveState({ knowledge: newKnowledge, ...ledgerMove }),
            // The same commit shape a bought reveal uses — entities and the
            // fallout queue are handed back unchanged, because asking a
            // question about a public occurrence spends nothing and queues
            // nothing. Only the knowledge slice, and the truth behind it,
            // move.
            action: {
                type: 'INVESTIGATION_COMMITTED',
                entities,
                pendingIntelligenceFallout,
                knowledge: newKnowledge,
                ...ledgerMove,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'What your agents found could not be recorded.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };

    // One reveal = one atomic commit. The investigation spend, any blackmail
    // filing (secrets), and the fallout-queue append MUST all land in a
    // single state+save pass: the previous per-concern handlers (spend /
    // blackmail / fallout) each rebuilt the whole save bundle from stale
    // closures, so whichever ran last silently reverted the others' fields -
    // the spend vanished from the save on any secrets reveal, and on ANY
    // reveal that carried consequences.
    //
    // The fallout half keeps ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 /
    // DESIGN_DECISIONS.md D5 semantics verbatim: queue the consequence for
    // the next turn (components/investigationLoop.ts), surface only a
    // subtle in-fiction hint now - the raw text is GM-console-only
    // (GameMasterScreen's "Pending Intelligence Fallout" line) until next
    // turn's narration reinterprets it.
    //
    // D47/D11 rides in the same pass: every finding's GM-private truth lands
    // on the truth ledger, and a scheme buy that reaches the D28 reveal has
    // its nature read from EVERY clue on the ledger, not from this one buy's
    // report (settleInvestigationTruth) - the ledger records whether that
    // nature is the truth. Only the reading's text reaches the player store.
    const handleInvestigationOutcome = async (
        kind: 'beliefs' | 'scheme' | 'secrets',
        targetId: string,
        reportData: unknown,
        cost: number,
        result: InvestigationResult,
        request: DomainMutationContext,
        truth?: InvestigationTruth,
        denariiCost = 0,
    ): Promise<boolean> => {
        if (!request.isCurrent()) return false;
        if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(denariiCost) || denariiCost < 0) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const playerBeforeAsync = entities.find(e => e.entity_id === playerCharacterId);
        if (!playerBeforeAsync) return false;
        const unitsBeforeAsync = numericBalance(playerBeforeAsync.resources.investigations);
        const denariiBeforeAsync = numericBalance(playerBeforeAsync.resources.denarii);
        if ((cost > 0 && unitsBeforeAsync < cost) || (denariiCost > 0 && denariiBeforeAsync < denariiCost)) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const entityDirectory = entities.map(entity => ({
            entity_id: entity.entity_id,
            name: entity.name,
        }));
        const target = entities.find(entity => entity.entity_id === targetId);
        const investigator = entities.find(entity => entity.entity_id === playerCharacterId);
        // The reveal is due when this paid clue brings the count the player
        // holds (a read of their own store) to the threshold, or past it.
        const cluesHeld = deriveDossier(knowledge, targetId).entries.find(entry => entry.kind === 'scheme')?.schemeDiscovery?.clues ?? 0;
        const settled: SettledInvestigationTruth = truth && target && investigator
            ? await settleInvestigationTruth({
                ai,
                isMockMode,
                target,
                player: investigator,
                truth,
                ledger: truthLedger,
                natureDue: kind === 'scheme' && cluesHeld + 1 >= SCHEME_CLUES_TO_REVEAL,
                turn: turnNumber,
                stamp: Date.now(),
            })
            : { ledgerEntries: truth ? investigationLedgerEntries(truth, turnNumber, Date.now()) : [] };
        if (!request.isCurrent()) return false;
        const nextTruthLedger = appendTruthLedgerEntries(truthLedger, settled.ledgerEntries);
        // D28: a 'scheme' buy is ONE clue - its report is held back as a
        // nature hint until enough clues cross the reveal (ingestSchemeClue).
        // Offering that same report to the relationship selector would let a
        // single buy publish the plot on both conspirators' cards, so a
        // scheme report is never relationship evidence.
        const relationshipEvidence = kind === 'scheme' ? [] : [buildInvestigationRelationshipEvidence({
            reportText: result.report,
            targetId,
            kind,
            turnNumber,
            entities: entityDirectory,
        })];
        const currentPlayer = entities.find(entity => entity.entity_id === playerCharacterId) ?? null;
        const knownEntityIds = currentPlayer
            ? [
                currentPlayer.entity_id,
                ...knownRecipientOptionsForPlayer(currentPlayer, entities, knowledge)
                    .map(option => option.entityId),
            ]
            : [];
        // With the roads shut (before or during this call) the reveal the
        // player paid for commits without its observation markers.
        const relationshipDrafts = relationshipEvidence.length === 0 ? [] : await relationshipDraftsUnlessOffline(() => getRelationshipObservations(
            ai,
            relationshipEvidence,
            entityDirectory,
            knownEntityIds,
            isMockMode,
        ));
        if (!request.isCurrent()) return false;
        const livePlayer = entities.find(e => e.entity_id === playerCharacterId);
        if (!livePlayer) return false;
        const currentInv = numericBalance(livePlayer.resources.investigations);
        if (cost > 0 && currentInv < cost) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const denariiStep = deductDenariiWithSystemicRule(livePlayer, denariiCost, turnNumber, reports.length);
        if (!denariiStep.ok) {
            setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: INSUFFICIENT_FUNDS_NOTE });
            return false;
        }
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = { ...e.resources };
                if (cost > 0) {
                    newResources.investigations = Math.max(0, currentInv - cost);
                }
                if (denariiCost > 0) {
                    newResources.denarii = denariiStep.finalDenarii;
                }
                if (kind === 'secrets' && Array.isArray(reportData)) {
                    const resourceKey = `blackmail_on_${targetId}`;
                    const existingSecrets = (newResources[resourceKey] as string[]) || [];
                    newResources[resourceKey] = Array.from(new Set([...existingSecrets, ...(reportData as string[])]));
                }
                return { ...e, resources: newResources };
            }
            return e;
        });
        const nextFallout = appendFallout(pendingIntelligenceFallout, result);
        // D14/D21 - the bought reveal is ingested into the knowledge store
        // (knowledge/commit.ts) in the SAME atomic commit as the spend, so
        // the intel finally persists (in state and in the save) instead of
        // evaporating with DramatisPersonaeTab's component-local display
        // state. Only the player-facing report text is ingested - never the
        // resolution trace or anything GM-private - with, for beliefs and
        // secrets, the itemised findings the player was shown alongside it
        // (player-facing too), so the held dossier keeps the whole reading.
        const nextKnowledge = computeInvestigationKnowledge({
            prev: knowledge,
            targetId,
            kind,
            reportText: result.report,
            items: kind !== 'scheme' && Array.isArray(reportData)
                ? reportData.filter((item): item is string => typeof item === 'string')
                : undefined,
            ...(settled.natureReading !== undefined ? { natureReading: settled.natureReading } : {}),
            turnNumber,
            relationshipObservations: {
                evidence: relationshipEvidence,
                drafts: relationshipDrafts,
                entities: entityDirectory,
                knownEntityIds,
            },
        });

        const falloutMessage: Message | undefined = hasFallout(result.consequences)
            ? { sender: 'gm', text: 'Your agent returns — but something in their manner suggests the visit did not go unnoticed.' }
            : undefined;
        const nextReports = denariiStep.reports.length > 0 ? [...reports, ...denariiStep.reports] : reports;
        const reportUpdate = denariiStep.reports.length > 0 ? { reports: nextReports } : {};
        // This is intentionally adjacent to the durable write. A future
        // async-extraction phase may add work above; an EntityDetails unmount
        // during that work must cancel before charging or committing any result.
        if (!request.isCurrent()) return false;
        if (!commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, truthLedger: nextTruthLedger, ...reportUpdate, messages: falloutMessage ? [...messages, falloutMessage] : messages }),
            action: { type: 'INVESTIGATION_COMMITTED', entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, truthLedger: nextTruthLedger, ...reportUpdate, falloutMessage },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your investigation could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        })) {
            return false;
        }

        return true;
    };

    const handleConvertResourceToInvestigations = (
        source: ConvertibleResource,
        request: DomainMutationContext,
    ): boolean => {
        if (!request.isCurrent()) return false;
        const player = entities.find(e => e.entity_id === playerCharacterId);
        if (!player) return false;
        const conversion = convertResourceToInvestigations(player.resources, source, 1);
        if (!conversion.ok) {
            if (conversion.reason) {
                setTransactionNote({ kind: 'plain', title: TREASURY_REFUSAL_TITLE, message: conversion.reason });
            }
            return false;
        }
        let updatedResources = conversion.updatedResources;
        let emittedReports: Report[] = [];
        if (source === 'denarii') {
            const prevDenarii = typeof player.resources.denarii === 'number' && Number.isFinite(player.resources.denarii)
                ? player.resources.denarii
                : 0;
            const rawDenarii = typeof updatedResources.denarii === 'number' && Number.isFinite(updatedResources.denarii)
                ? updatedResources.denarii
                : 0;
            const clonedPlayer: Entity = { ...player, resources: { ...updatedResources } };
            const sys = applySystemicResourceRule(
                SYSTEMIC_RESOURCES.denarii,
                clonedPlayer,
                'denarii',
                prevDenarii,
                rawDenarii,
                turnNumber,
                { emitReports: true, sequence: reports.length },
            );
            updatedResources = { ...clonedPlayer.resources, denarii: sys.finalValue };
            emittedReports = sys.reports;
        }
        const nextEntities = entities.map(e => (
            e.entity_id === playerCharacterId ? { ...e, resources: updatedResources } : e
        ));
        const reportUpdate = emittedReports.length > 0 ? { reports: [...reports, ...emittedReports] } : {};
        if (!request.isCurrent()) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ entities: nextEntities, ...reportUpdate }),
            action: {
                type: 'INVESTIGATION_COMMITTED',
                entities: nextEntities,
                pendingIntelligenceFallout,
                knowledge,
                ...reportUpdate,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your funding order could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };

    /**
     * D47: what the OTHER grounded question on an occurrence already came
     * back with - no hand at all, or hands named - for the Events tab's next
     * question, so the two answers decide "came back empty" once between
     * them. Read off the player's own finding first (it says no more than
     * they already read there, and the store keeps it), then the GM-private
     * ledger, whose cap may have evicted the entry.
     */
    const occurrenceSibling = (occurrence: string, question: OccurrenceQuestion): OccurrenceSiblingOutcome | null =>
        question === 'what_follows'
            ? null
            : occurrenceSiblingInStore(knowledge, occurrence, question) ?? siblingOccurrenceOutcome(truthLedger, occurrence, question);

    // D32 - the GM console's free-text directive, persisted so it survives
    // a reload and is read by the next turn's adjudication.
    const handleSetIntervention = (text: string): boolean => {
        return commitDomainMutation({
            candidate: buildSaveState({ gmInterventionText: text }),
            action: { type: 'GM_INTERVENTION_SET', text },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'The directive could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };

    return {
        handleDeepAnalysis,
        handleOccurrenceFinding,
        handleInvestigationOutcome,
        handleConvertResourceToInvestigations,
        handleSetIntervention,
        occurrenceSibling,
    };
}
