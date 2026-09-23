/**
 * hooks/useIntelCommits.ts
 *
 * The three durable commits SidePanel's intelligence surfaces hand back to
 * the composition root - a deep-analysis spend, an occurrence finding, and
 * a bought investigation reveal - plus the GM console's directive, the one
 * other side-surface write. Moved verbatim out of App.tsx (2026-09-23).
 *
 * Each handler receives the DomainMutationContext of the runDomainMutation
 * lease its caller acquired, and re-checks `request.isCurrent()` adjacent
 * to every await and immediately before its durable write, so a surface
 * that unmounted mid-request never charges or commits a result.
 */

import type { GoogleGenAI } from '@google/genai';
import type { Entity, InvestigationResult, Message } from '../types';
import type { DomainMutationContext } from '../state/domainMutation';
import type { SaveGameState } from '../persistence/saveGame';
import { computeInvestigationKnowledge } from '../knowledge/commit';
import { ingestOccurrenceFinding, type KnowledgeClaim, type OccurrenceQuestion } from '../knowledge/store';
import {
    buildInvestigationRelationshipEvidence,
    knownRecipientOptionsForPlayer,
} from '../knowledge/relationships';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { appendFallout, hasFallout } from '../components/investigationLoop';
import type { DomainCommit, TransactionNote } from '../app/transactions';

export interface IntelCommitsDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    entities: Entity[];
    playerCharacterId: string | null;
    knowledge: KnowledgeClaim[];
    pendingIntelligenceFallout: string[];
    messages: Message[];
    turnNumber: number;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    setTransactionNote: (note: TransactionNote | null) => void;
}

export function useIntelCommits(deps: IntelCommitsDeps) {
    const {
        ai, isMockMode, entities, playerCharacterId, knowledge, pendingIntelligenceFallout, messages, turnNumber,
        buildSaveState, commitDomainMutation, setTransactionNote,
    } = deps;

    const handleSpendResource = (
        resourceName: 'deep_analyses' | 'investigations',
        cost: number,
        request: DomainMutationContext,
    ): boolean => {
        if (!request.isCurrent()) return false;
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentAmount = (newResources[resourceName] as number) || 0;
                newResources[resourceName] = Math.max(0, currentAmount - cost);
                return {...e, resources: newResources};
            }
            return e;
        });
        if (!request.isCurrent()) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities }),
            action: { type: 'RESOURCE_SPENT', entities: newEntities },
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
     */
    const handleOccurrenceFinding = (
        occurrence: string,
        question: OccurrenceQuestion,
        text: string,
        request: DomainMutationContext,
    ): boolean => {
        if (!request.isCurrent()) return false;
        const newKnowledge = ingestOccurrenceFinding(knowledge, { occurrence, question, text, turn: turnNumber });
        return commitDomainMutation({
            candidate: buildSaveState({ knowledge: newKnowledge }),
            // The same commit shape a bought reveal uses — entities and the
            // fallout queue are handed back unchanged, because asking a
            // question about a public occurrence spends nothing and queues
            // nothing. Only the knowledge slice moves.
            action: {
                type: 'INVESTIGATION_COMMITTED',
                entities,
                pendingIntelligenceFallout,
                knowledge: newKnowledge,
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
    const handleInvestigationOutcome = async (
        kind: 'beliefs' | 'scheme' | 'secrets',
        targetId: string,
        reportData: unknown,
        cost: number,
        result: InvestigationResult,
        request: DomainMutationContext,
    ): Promise<boolean> => {
        if (!request.isCurrent()) return false;
        const entityDirectory = entities.map(entity => ({
            entity_id: entity.entity_id,
            name: entity.name,
        }));
        const relationshipEvidence = [buildInvestigationRelationshipEvidence({
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
        const relationshipDrafts = await getRelationshipObservations(
            ai,
            relationshipEvidence,
            entityDirectory,
            knownEntityIds,
            isMockMode,
        );
        if (!request.isCurrent()) return false;
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentInv = (newResources.investigations as number) || 0;
                newResources.investigations = Math.max(0, currentInv - cost);
                if (kind === 'secrets' && Array.isArray(reportData)) {
                    const resourceKey = `blackmail_on_${targetId}`;
                    const existingSecrets = (newResources[resourceKey] as string[]) || [];
                    newResources[resourceKey] = Array.from(new Set([...existingSecrets, ...(reportData as string[])]));
                }
                return {...e, resources: newResources};
            }
            return e;
        });
        const nextFallout = appendFallout(pendingIntelligenceFallout, result);
        // D14/D21 - the bought reveal is ingested into the knowledge store
        // (knowledge/commit.ts) in the SAME atomic commit as the spend, so
        // the intel finally persists (in state and in the save) instead of
        // evaporating with DramatisPersonaeTab's component-local display
        // state. Only the player-facing report text is ingested - never the
        // resolution trace or anything GM-private.
        const nextKnowledge = computeInvestigationKnowledge({
            prev: knowledge,
            targetId,
            kind,
            reportText: result.report,
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
        // This is intentionally adjacent to the durable write. A future
        // async-extraction phase may add work above; an EntityDetails unmount
        // during that work must cancel before charging or committing any result.
        if (!request.isCurrent()) return false;
        if (!commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, messages: falloutMessage ? [...messages, falloutMessage] : messages }),
            action: { type: 'INVESTIGATION_COMMITTED', entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, falloutMessage },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your investigation could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        })) {
            return false;
        }

        return true;
    };

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

    return { handleSpendResource, handleOccurrenceFinding, handleInvestigationOutcome, handleSetIntervention };
}
