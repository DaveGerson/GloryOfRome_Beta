/**
 * hooks/usePrivateSceneController.ts
 *
 * The private-scene transaction: invite -> exchange(s) -> end -> last word,
 * each step one AI call (continuePrivateScene) and one durable commit
 * through the shared kernel (hooks/useCampaignTransactions.ts). Moved
 * verbatim out of App.tsx (2026-09-23) together with the three drafts and
 * the in-dialog error the PrivateScene component renders.
 *
 * Every handler runs under runDomainMutation with allowDuringPrivateScene,
 * and every commit is fingerprint-guarded: the scene list a handler read at
 * its start must be byte-identical at commit time, or the handler drops its
 * result rather than resurrect, discard, or append to an intervening
 * commit.
 */

import { useCallback, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { GoogleGenAI } from '@google/genai';
import type { Entity } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';
import type { SaveGameState } from '../persistence/saveGame';
import {
    PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
    eligiblePrivateSceneTargets,
    beginPrivateScene,
    appendPrivateSceneExchange,
    endPrivateScene,
    finalizePrivateScene,
    type PrivateSceneRecord,
} from '../privateScene/model';
import { continuePrivateScene } from '../ai/tools/privateScene';
import { replacePrivateSceneForCommit } from '../components/PrivateScene';
import { projectPrivateSceneForPlayer } from '../perception/visibility';
import {
    type DomainCommit,
    isPrivateSceneInteractionLocked,
    privateScenesFingerprint,
} from '../app/transactions';

export interface PrivateSceneControllerDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    privateScenes: PrivateSceneRecord[];
    playerEntity: Entity | null;
    entities: Entity[];
    /** The player's known contacts (knownRecipientOptionsForPlayer's ids). */
    privateSceneKnownIds: string[];
    turnNumber: number;
    privateSceneInteractionLocked: boolean;
    runDomainMutation: RunDomainMutation;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    privateSceneLockRef: MutableRefObject<boolean>;
    privateScenesRef: MutableRefObject<PrivateSceneRecord[]>;
}

/**
 * The per-NPC prompt payload for one private-scene call. Pure: the NPC's
 * own mind (bounded to its last eight goals/beliefs/secrets/memories), the
 * player's public face, and the transcript so far.
 */
export function buildPrivateScenePrompt(
    player: Entity,
    npc: Entity,
    transcript: PrivateSceneRecord['transcript'],
    exchange: number,
) {
    return {
        phase: exchange === 1 ? 'invitation' as const : 'exchange' as const,
        exchange,
        npc: {
            entityId: npc.entity_id, displayName: npc.name, position: npc.position, location: npc.location,
            voice: npc.voice, selfDescription: npc.current_state_narrative,
            goals: npc.short_term_goals.slice(0, 8), beliefs: (npc.beliefs ?? []).slice(0, 8),
            ownSecrets: (npc.secrets ?? []).slice(0, 8), memories: npc.memories.slice(-8).map(memory => memory.event_description),
            relationshipToPlayer: undefined,
        },
        player: { entityId: player.entity_id, displayName: player.name, position: player.position },
        transcript: transcript.map(line => ({ speaker: line.speaker, text: line.text })),
    };
}

export function usePrivateSceneController(deps: PrivateSceneControllerDeps) {
    const {
        ai, isMockMode, privateScenes, playerEntity, entities, privateSceneKnownIds, turnNumber,
        privateSceneInteractionLocked, runDomainMutation, commitDomainMutation, buildSaveState,
        privateSceneLockRef, privateScenesRef,
    } = deps;

    const [privateSceneOpeningDraft, setPrivateSceneOpeningDraft] = useState('');
    const [privateSceneReplyDraft, setPrivateSceneReplyDraft] = useState('');
    const [privateSceneLastWordDraft, setPrivateSceneLastWordDraft] = useState('');
    const [privateSceneError, setPrivateSceneError] = useState<string | null>(null);

    const privateSceneTargets = useMemo(
        () => playerEntity ? eligiblePrivateSceneTargets({ player: playerEntity, entities, knownEntityIds: privateSceneKnownIds }) : [],
        [playerEntity, entities, privateSceneKnownIds],
    );
    const privateSceneViews = useMemo(
        () => privateScenes.map(projectPrivateSceneForPlayer),
        [privateScenes],
    );
    // One scene per macro-turn, and never while one is still open.
    const canStartScene = !privateSceneInteractionLocked && !privateScenes.some(scene => scene.macroTurn === turnNumber);

    const privateScenePromptFor = useCallback((npc: Entity, transcript: PrivateSceneRecord['transcript'], exchange: number) => {
        if (!playerEntity) throw new Error('The player is unavailable for this private scene.');
        return buildPrivateScenePrompt(playerEntity, npc, transcript, exchange);
    }, [playerEntity]);

    const commitPrivateScene = useCallback((candidate: PrivateSceneRecord, expectedScenesFingerprint: string): boolean => {
        const latest = privateScenesRef.current;
        // Exact list/record identity prevents a retained callback from
        // resurrecting, discarding, or appending to any intervening commit.
        if (privateScenesFingerprint(latest) !== expectedScenesFingerprint) return false;
        const candidateScenes = replacePrivateSceneForCommit(latest, candidate);
        // Recheck immediately before persistence. JavaScript cannot interleave
        // another handler between this synchronous check and saveGame.
        if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenesFingerprint) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ privateScenes: candidateScenes }),
            action: { type: 'PRIVATE_SCENES_COMMITTED', privateScenes: candidateScenes },
            // Same voice as every other write that would not land (D45): the
            // device is named, and what is kept is named. No bare "try again".
            onSaveFailure: () => setPrivateSceneError('The scene could not be saved. This device would not take the writing down — your words are kept here, and the scene has not moved.'),
            beforeDispatch: () => {
                // The durable bytes exist before this point. Set the handler-level
                // guard before reducer dispatch so another event cannot enter an
                // ordinary mutation in React's commit/render interval.
                privateSceneLockRef.current = isPrivateSceneInteractionLocked(candidateScenes);
                privateScenesRef.current = candidateScenes;
            },
            onCommitted: () => setPrivateSceneError(null),
        });
    }, [buildSaveState, commitDomainMutation, privateSceneLockRef, privateScenesRef]);

    const handlePrivateSceneInvite = useCallback((targetId: string) => {
        void runDomainMutation(async transaction => {
            const opening = privateSceneOpeningDraft.trim();
            if (!transaction.isCurrent() || !playerEntity || !opening || opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const npc = entities.find(entity => entity.entity_id === targetId);
            const stillEligible = eligiblePrivateSceneTargets({ player: playerEntity, entities, knownEntityIds: privateSceneKnownIds })
                .some(target => target.entityId === targetId);
            if (!npc) {
                setPrivateSceneError('That contact can no longer be found. Choose another and try again.');
                return false;
            }
            if (!stillEligible) {
                setPrivateSceneError('That contact is no longer within reach. Choose another and try again.');
                return false;
            }
            if (privateScenesRef.current.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word' || scene.macroTurn === turnNumber)) {
                setPrivateSceneError('A private scene has already been held this turn.');
                return false;
            }
            try {
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [{ sequence: 1, speaker: 'player', text: privateSceneOpeningDraft.trim() }], 1), isMockMode);
                if (!transaction.isCurrent() || privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const transition = beginPrivateScene({ sceneId: `private-scene-${turnNumber}-${npc.entity_id}`, macroTurn: turnNumber, player: playerEntity, npc, knownEntityIds: privateSceneKnownIds, opening, response, existing: privateScenesRef.current });
                if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
                setPrivateSceneOpeningDraft('');
                return true;
            } catch {
                if (transaction.isCurrent()) setPrivateSceneError('The scene could not continue. Your words remain ready to retry.');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, isMockMode, playerEntity, privateSceneKnownIds, privateSceneOpeningDraft, privateScenePromptFor, privateScenesRef, runDomainMutation, turnNumber]);

    const handlePrivateSceneReply = useCallback((sceneId: string) => {
        void runDomainMutation(async transaction => {
            const reply = privateSceneReplyDraft.trim();
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!transaction.isCurrent() || !scene || scene.status !== 'active' || !reply || reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const npc = entities.find(entity => entity.entity_id === scene.npcId);
            if (!npc) return false;
            try {
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [...scene.transcript, { sequence: scene.transcript.length + 1, speaker: 'player', text: privateSceneReplyDraft.trim() }], scene.npcResponseCount + 1), isMockMode);
                if (!transaction.isCurrent()) return false;
                const current = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
                if (!current || current.status !== 'active' || current.macroTurn !== scene.macroTurn || current.npcResponseCount !== scene.npcResponseCount) return false;
                if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const transition = appendPrivateSceneExchange({ scene: current, expectedNpcResponseCount: scene.npcResponseCount, playerUtterance: reply, response });
                if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
                setPrivateSceneReplyDraft('');
                return true;
            } catch {
                if (transaction.isCurrent()) setPrivateSceneError('The scene could not continue. Your words remain ready to retry.');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, isMockMode, privateScenePromptFor, privateSceneReplyDraft, privateScenesRef, runDomainMutation]);

    const handlePrivateSceneEnd = useCallback((sceneId: string) => {
        void runDomainMutation(() => {
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = endPrivateScene(scene);
            return transition.ok && commitPrivateScene(transition.scene, expectedScenes);
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, privateScenesRef, runDomainMutation]);

    const handlePrivateSceneFinalize = useCallback((sceneId: string, lastWord: string | null) => {
        void runDomainMutation(() => {
            const text = lastWord?.trim() ?? null;
            if (text !== null && text.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = finalizePrivateScene(scene, text);
            if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
            setPrivateSceneLastWordDraft('');
            return true;
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, privateScenesRef, runDomainMutation]);

    // The PrivateScene component's last-word pair: the draft is read at
    // click time, exactly as App's inline lambdas did.
    const handlePrivateSceneLastWord = (sceneId: string) => handlePrivateSceneFinalize(sceneId, privateSceneLastWordDraft);
    const handlePrivateSceneSkipLastWord = (sceneId: string) => handlePrivateSceneFinalize(sceneId, null);

    return {
        privateSceneViews,
        privateSceneTargets,
        canStartScene,
        privateSceneOpeningDraft, setPrivateSceneOpeningDraft,
        privateSceneReplyDraft, setPrivateSceneReplyDraft,
        privateSceneLastWordDraft, setPrivateSceneLastWordDraft,
        privateSceneError,
        handlePrivateSceneInvite,
        handlePrivateSceneReply,
        handlePrivateSceneEnd,
        handlePrivateSceneLastWord,
        handlePrivateSceneSkipLastWord,
    };
}
