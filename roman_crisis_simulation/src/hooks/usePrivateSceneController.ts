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
import type { ComposureRoll, Entity } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';
import type { SaveGameState } from '../persistence/saveGame';
import {
    PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
    eligiblePrivateSceneTargets,
    beginPrivateScene,
    appendPrivateSceneExchange,
    endPrivateScene,
    finalizePrivateScene,
    type PrivateSceneComposure,
    type PrivateScenePlayerComposureRoll,
    type PrivateSceneRecord,
} from '../privateScene/model';
import { continuePrivateScene } from '../ai/tools/privateScene';
import { conditionClause, conditionsOf, outwardConditionsOf } from '../ai/core/conditions';
import { affiliationClause, affiliationsOf, publicAffiliationsOf } from '../ai/core/affiliations';
import { playerComposureTell, rollComposure, screenNpcTells, tellWorldOf } from '../ai/core/composure';
import { createSeededRng, generateSeed } from '../ai/core/resolution';
import { ingestSignsSeen, type KnowledgeClaim } from '../knowledge/store';
import { PRIVATE_SCENE_MAX_COMPOSURE_ITEMS, PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS, PrivateSceneInputError } from '../ai/prompts/privateScene';
import { replacePrivateSceneForCommit } from '../components/PrivateScene';
import type { PrivateSceneFailure } from '../components/ui/FailureNotices';
import { projectPrivateSceneForPlayer } from '../perception/visibility';
import {
    type DomainCommit,
    isPrivateSceneInteractionLocked,
    privateScenesFingerprint,
} from '../app/transactions';

export interface PrivateSceneControllerDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    /**
     * Whether the roads are open (components/ui/FailureNotices.tsx's
     * useOnline). Shut, an invitation or a reply is held before any call, as
     * the composer holds a turn, and the words stay where they were written.
     */
    online: boolean;
    privateScenes: PrivateSceneRecord[];
    playerEntity: Entity | null;
    entities: Entity[];
    /** The player's known contacts (knownRecipientOptionsForPlayer's ids). */
    privateSceneKnownIds: string[];
    /** The player's knowledge store: a tell they catch in the scene is recorded there as a sign seen (D50). */
    knowledge: KnowledgeClaim[];
    turnNumber: number;
    privateSceneInteractionLocked: boolean;
    runDomainMutation: RunDomainMutation;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    privateSceneLockRef: MutableRefObject<boolean>;
    privateScenesRef: MutableRefObject<PrivateSceneRecord[]>;
}

/**
 * An optional prompt field as the scene's input bound accepts it: a model
 * may leave `null` in a nullable entity field, or a blank string, and either
 * is left out; a text longer than one line of the scene is cut to it.
 */
function optionalSceneText(value: string | null | undefined): string | undefined {
    const text = typeof value === 'string' ? value.trim().slice(0, PRIVATE_SCENE_MAX_UTTERANCE_CHARS).trim() : '';
    return text || undefined;
}

/** A context list without its blank items, each cut to one line's bound, at most `limit` long. */
function sceneContextList(values: readonly (string | null | undefined)[], limit: number, fromEnd = false): string[] {
    const texts = values.map(optionalSceneText).filter((text): text is string => text !== undefined);
    return fromEnd ? texts.slice(-limit) : texts.slice(0, limit);
}

/** How much of an older line a long scene keeps once it outgrows the prompt's budget: its opening words. */
const TRIMMED_SCENE_LINE_CHARS = 280;

function clipSceneText(text: string): string {
    return text.length > TRIMMED_SCENE_LINE_CHARS ? `${text.slice(0, TRIMMED_SCENE_LINE_CHARS).trimEnd()}…` : text;
}

/**
 * Fits the payload to the prompt's aggregate budget (`PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS`,
 * measured as the input bound measures it). A scene written at the per-line
 * limit outgrows it by the sixth exchange; left alone it failed there, on
 * every retry. So, only as far as needed: the older lines keep their opening
 * words (the newest line - the one being answered - stays whole), then the
 * context items do (the NPC's, then what it sees of the player), then
 * context items go, oldest memories first, and last the NPC's own
 * description keeps its opening words.
 */
function fitSceneBudget<T extends ReturnType<typeof unfittedScenePrompt>>(input: T): T {
    const fits = () => JSON.stringify(input).length <= PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS;
    const { transcript, npc } = input;
    for (let i = 0; i < transcript.length - 1 && !fits(); i++) transcript[i] = { ...transcript[i], text: clipSceneText(transcript[i].text) };
    const lists = [npc.memories, npc.beliefs, npc.goals, npc.ownSecrets, npc.marks, npc.ties, input.player.outwardMarks, input.player.openTies];
    for (const list of lists) {
        for (let i = 0; i < list.length && !fits(); i++) list[i] = clipSceneText(list[i]);
    }
    for (const list of lists) {
        while (list.length > 0 && !fits()) list.shift();
    }
    for (const field of ['selfDescription', 'voice', 'location', 'position'] as const) {
        const text = npc[field];
        if (text !== undefined && !fits()) npc[field] = clipSceneText(text);
    }
    return input;
}

/** A scene's composure as its prompt reads it: the NPC's rolls, and the player's with what the NPC was told. */
export type ScenePromptComposure = Pick<PrivateSceneComposure, 'npc' | 'player'>;

/** A scene record's persisted composure, as its later exchanges' prompts read it. */
export function sceneComposureOf(scene: PrivateSceneRecord): ScenePromptComposure {
    return { npc: scene.npcComposure ?? [], player: scene.playerComposure ?? [] };
}

/**
 * Rolls both parties' composure as a scene opens (D50): the NPC's rolls,
 * then the player's, from one seeded generator whose seed is kept with the
 * scene - so the rolls replay, and a reload never rolls again. What the NPC
 * is told of each of the player's subjects is written by code here
 * (ai/core/composure.ts::playerComposureTell), never by a model.
 */
export function rollSceneComposure(player: Entity, npc: Entity, seed: number = generateSeed()): PrivateSceneComposure {
    const rng = createSeededRng(seed);
    const npcRolls = rollComposure(npc, rng);
    const playerRolls: PrivateScenePlayerComposureRoll[] = rollComposure(player, rng)
        .map(roll => ({ ...roll, told: playerComposureTell(roll, player) }));
    return { seed, npc: npcRolls, player: playerRolls };
}

/** The NPC's composure as the prompt carries it: each subject's handle, name, kind and tier - never the roll. */
function npcComposureForPrompt(rolls: readonly ComposureRoll[]) {
    return rolls.slice(0, PRIVATE_SCENE_MAX_COMPOSURE_ITEMS).map(roll => ({
        subject: roll.handle, of: roll.subjectName, kind: roll.subjectKind, tier: roll.tier,
    }));
}

/** The code-written lines of what the NPC saw of the player this scene. */
function playerTellsForPrompt(rolls: readonly PrivateScenePlayerComposureRoll[]): string[] {
    return rolls
        .map(roll => roll.told)
        .filter((told): told is string => typeof told === 'string' && told.trim().length > 0)
        .slice(0, PRIVATE_SCENE_MAX_COMPOSURE_ITEMS);
}

function unfittedScenePrompt(
    player: Entity,
    npc: Entity,
    transcript: PrivateSceneRecord['transcript'],
    exchange: number,
    composure?: ScenePromptComposure,
) {
    const npcComposure = composure ? npcComposureForPrompt(composure.npc) : [];
    const tells = composure ? playerTellsForPrompt(composure.player) : [];
    return {
        phase: exchange === 1 ? 'invitation' as const : 'exchange' as const,
        exchange,
        npc: {
            entityId: npc.entity_id, displayName: npc.name, position: optionalSceneText(npc.position),
            location: optionalSceneText(npc.location), voice: optionalSceneText(npc.voice),
            selfDescription: optionalSceneText(npc.current_state_narrative),
            goals: sceneContextList(npc.short_term_goals, 8), beliefs: sceneContextList(npc.beliefs ?? [], 8),
            ownSecrets: sceneContextList(npc.secrets ?? [], 8),
            memories: sceneContextList(npc.memories.map(memory => memory.event_description), 8, true),
            // D48/D49: the NPC speaks from its own marks and ties - an
            // inward mark or a secret tie is its own private burden, as
            // ownSecrets is (the scene's rules say so).
            marks: sceneContextList(conditionsOf(npc).map(mark => conditionClause(mark)), 8),
            ties: sceneContextList(affiliationsOf(npc).map(tie => affiliationClause(tie, { voice: 'own' })), 8),
            // D50: how far it can keep each inward mark and secret tie hidden this scene.
            ...(npcComposure.length > 0 ? { composure: npcComposure } : {}),
            relationshipToPlayer: undefined,
        },
        player: {
            entityId: player.entity_id, displayName: player.name, position: optionalSceneText(player.position),
            // Only what the NPC can see or knows publicly of the player: a
            // mark that shows, by name and weight - never its account, which
            // is how it weighs on the player - and the ties they openly
            // profess. A secret tie the NPC witnessed is in its own memories.
            outwardMarks: sceneContextList(outwardConditionsOf(player).map(mark => conditionClause({ ...mark, description: '' }, { visibility: false })), 8),
            openTies: sceneContextList(publicAffiliationsOf(player).map(tie => affiliationClause(tie)), 8),
            // D50: what the player's own composure let show - code's lines,
            // exactly as the player is shown them, and nothing else of their
            // inward marks or secret ties.
            ...(tells.length > 0 ? { tells } : {}),
        },
        transcript: transcript.map(line => ({ speaker: line.speaker, text: line.text })),
    };
}

/**
 * The per-NPC prompt payload for one private-scene call. Pure: the NPC's
 * own mind (bounded to its first eight goals/beliefs/secrets/marks/ties and
 * last eight memories), the player's public face (their outward marks and
 * openly professed ties among it), and the transcript so far - every
 * optional field that is null or blank left out, and the whole fitted to
 * the prompt's budget (`fitSceneBudget`), so a known, reachable individual
 * is never refused by the input bound itself. With `composure` (D50), the
 * NPC is also told each of its hidden subjects' tier, and what it noticed
 * of the player - both short and never trimmed by the budget.
 */
export function buildPrivateScenePrompt(
    player: Entity,
    npc: Entity,
    transcript: PrivateSceneRecord['transcript'],
    exchange: number,
    composure?: ScenePromptComposure,
) {
    return fitSceneBudget(unfittedScenePrompt(player, npc, transcript, exchange, composure));
}

/** The signs a transition added, as the player's knowledge store takes them: the figure and the sentence only (D50). */
function newSignsSeen(scene: PrivateSceneRecord, fromExchange: number): Array<{ entityId: string; sign: string }> {
    return (scene.composureSigns ?? [])
        .filter(sign => sign.exchange >= fromExchange)
        .map(sign => ({ entityId: scene.npcId, sign: sign.sign }));
}

export function usePrivateSceneController(deps: PrivateSceneControllerDeps) {
    const {
        ai, isMockMode, online, privateScenes, playerEntity, entities, privateSceneKnownIds, knowledge, turnNumber,
        privateSceneInteractionLocked, runDomainMutation, commitDomainMutation, buildSaveState,
        privateSceneLockRef, privateScenesRef,
    } = deps;

    const [privateSceneOpeningDraft, setPrivateSceneOpeningDraft] = useState('');
    const [privateSceneReplyDraft, setPrivateSceneReplyDraft] = useState('');
    const [privateSceneLastWordDraft, setPrivateSceneLastWordDraft] = useState('');
    // A failure belongs to the turn it happened in: the next turn's door is
    // fresh, and an old "The door did not open" must not greet it. Only what
    // failed is named here; the words live in components/ui/FailureNotices.tsx (D45).
    const [failure, setFailure] = useState<{ failure: PrivateSceneFailure; turn: number } | null>(null);
    const privateSceneError: PrivateSceneFailure | null = failure && failure.turn === turnNumber ? failure.failure : null;
    const fail = useCallback((what: PrivateSceneFailure) => {
        setFailure({ failure: what, turn: turnNumber });
    }, [turnNumber]);

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

    const privateScenePromptFor = useCallback((npc: Entity, transcript: PrivateSceneRecord['transcript'], exchange: number, composure?: ScenePromptComposure) => {
        if (!playerEntity) throw new Error('The player is unavailable for this private scene.');
        return buildPrivateScenePrompt(playerEntity, npc, transcript, exchange, composure);
    }, [playerEntity]);

    // A scene commit may carry the knowledge store too: the signs the player
    // caught in the reply it commits (D50), landing in the same write.
    const commitPrivateScene = useCallback((candidate: PrivateSceneRecord, expectedScenesFingerprint: string, nextKnowledge?: KnowledgeClaim[]): boolean => {
        const latest = privateScenesRef.current;
        // Exact list/record identity prevents a retained callback from
        // resurrecting, discarding, or appending to any intervening commit.
        if (privateScenesFingerprint(latest) !== expectedScenesFingerprint) return false;
        const candidateScenes = replacePrivateSceneForCommit(latest, candidate);
        // Recheck immediately before persistence. JavaScript cannot interleave
        // another handler between this synchronous check and saveGame.
        if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenesFingerprint) return false;
        const knowledgeOverride = nextKnowledge ? { knowledge: nextKnowledge } : {};
        return commitDomainMutation({
            candidate: buildSaveState({ privateScenes: candidateScenes, ...knowledgeOverride }),
            action: { type: 'PRIVATE_SCENES_COMMITTED', privateScenes: candidateScenes, ...knowledgeOverride },
            // Same voice as every other write that would not land (D45): the
            // device is named, and what is kept is named. No bare "try again".
            onSaveFailure: () => fail('save'),
            beforeDispatch: () => {
                // The durable bytes exist before this point. Set the handler-level
                // guard before reducer dispatch so another event cannot enter an
                // ordinary mutation in React's commit/render interval.
                privateSceneLockRef.current = isPrivateSceneInteractionLocked(candidateScenes);
                privateScenesRef.current = candidateScenes;
            },
            onCommitted: () => setFailure(null),
        });
    }, [buildSaveState, commitDomainMutation, fail, privateSceneLockRef, privateScenesRef]);

    const handlePrivateSceneInvite = useCallback((targetId: string) => {
        void runDomainMutation(async transaction => {
            if (!transaction.isCurrent()) return false;
            // The roads are shut: held before any call, the opening kept as written.
            if (!online) {
                fail('offline');
                return false;
            }
            const opening = privateSceneOpeningDraft.trim();
            if (!playerEntity || !opening || opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) fail('too_long');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const npc = entities.find(entity => entity.entity_id === targetId);
            const stillEligible = eligiblePrivateSceneTargets({ player: playerEntity, entities, knownEntityIds: privateSceneKnownIds })
                .some(target => target.entityId === targetId);
            if (!npc) {
                fail('contact_missing');
                return false;
            }
            if (!stillEligible) {
                fail('contact_out_of_reach');
                return false;
            }
            if (privateScenesRef.current.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word' || scene.macroTurn === turnNumber)) {
                fail('already_held');
                return false;
            }
            // D50: both parties' composure is rolled ONCE, as the scene opens,
            // and kept with it - the prompt carries the tiers, never the dice.
            const rolled = rollSceneComposure(playerEntity, npc);
            const composure = rolled.npc.length > 0 || rolled.player.length > 0 ? rolled : undefined;
            try {
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [{ sequence: 1, speaker: 'player', text: privateSceneOpeningDraft.trim() }], 1, composure), isMockMode);
                if (!transaction.isCurrent() || privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const tells = screenNpcTells(response, npc, composure?.npc ?? [], tellWorldOf(entities));
                const transition = beginPrivateScene({ sceneId: `private-scene-${turnNumber}-${npc.entity_id}`, macroTurn: turnNumber, player: playerEntity, npc, knownEntityIds: privateSceneKnownIds, opening, response, existing: privateScenesRef.current, composure, tells });
                if (!transition.ok) return false;
                const signs = newSignsSeen(transition.scene, 1);
                const nextKnowledge = signs.length > 0 ? ingestSignsSeen(knowledge, signs, transition.scene.macroTurn) : undefined;
                if (!commitPrivateScene(transition.scene, expectedScenes, nextKnowledge)) return false;
                setPrivateSceneOpeningDraft('');
                // A new scene, a new person: nothing written for the last one carries over.
                setPrivateSceneReplyDraft('');
                setPrivateSceneLastWordDraft('');
                return true;
            } catch (error) {
                if (!transaction.isCurrent()) return false;
                // The input bound refused this contact: the same request would fail again, so no retry is offered.
                fail(error instanceof PrivateSceneInputError ? 'invite_refused' : 'invite_unanswered');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, fail, isMockMode, knowledge, online, playerEntity, privateSceneKnownIds, privateSceneOpeningDraft, privateScenePromptFor, privateScenesRef, runDomainMutation, turnNumber]);

    const handlePrivateSceneReply = useCallback((sceneId: string) => {
        void runDomainMutation(async transaction => {
            if (!transaction.isCurrent()) return false;
            // As for the invitation: held before any call, the reply kept as written.
            if (!online) {
                fail('offline');
                return false;
            }
            const reply = privateSceneReplyDraft.trim();
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!transaction.isCurrent() || !scene || scene.status !== 'active' || !reply || reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) fail('too_long');
                return false;
            }
            const npc = entities.find(entity => entity.entity_id === scene.npcId);
            if (!npc) return false;
            try {
                // The composure rolled as the scene opened, read back from its
                // record - a later exchange (or a reload) never rolls again.
                const composure = sceneComposureOf(scene);
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [...scene.transcript, { sequence: scene.transcript.length + 1, speaker: 'player', text: privateSceneReplyDraft.trim() }], scene.npcResponseCount + 1, composure), isMockMode);
                if (!transaction.isCurrent()) return false;
                const current = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
                if (!current || current.status !== 'active' || current.macroTurn !== scene.macroTurn || current.npcResponseCount !== scene.npcResponseCount) return false;
                if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const tells = screenNpcTells(response, npc, current.npcComposure ?? [], tellWorldOf(entities));
                const transition = appendPrivateSceneExchange({ scene: current, expectedNpcResponseCount: scene.npcResponseCount, playerUtterance: reply, response, tells });
                if (!transition.ok) return false;
                const signs = newSignsSeen(transition.scene, transition.scene.npcResponseCount);
                const nextKnowledge = signs.length > 0 ? ingestSignsSeen(knowledge, signs, transition.scene.macroTurn) : undefined;
                if (!commitPrivateScene(transition.scene, expectedScenes, nextKnowledge)) return false;
                setPrivateSceneReplyDraft('');
                return true;
            } catch (error) {
                if (!transaction.isCurrent()) return false;
                // As for the invitation: a refusal by the input bound is not offered as a retry.
                fail(error instanceof PrivateSceneInputError ? 'reply_refused' : 'reply_unanswered');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, fail, isMockMode, knowledge, online, privateScenePromptFor, privateSceneReplyDraft, privateScenesRef, runDomainMutation]);

    const handlePrivateSceneEnd = useCallback((sceneId: string) => {
        void runDomainMutation(() => {
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = endPrivateScene(scene);
            if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
            // The exchange is over: an unsent reply is not carried to the last word, or to anyone else.
            setPrivateSceneReplyDraft('');
            return true;
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, privateScenesRef, runDomainMutation]);

    const handlePrivateSceneFinalize = useCallback((sceneId: string, lastWord: string | null) => {
        void runDomainMutation(() => {
            const text = lastWord?.trim() ?? null;
            if (text !== null && text.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                fail('too_long');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = finalizePrivateScene(scene, text);
            if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
            // The scene is closed: nothing written in it waits for the next one.
            setPrivateSceneLastWordDraft('');
            setPrivateSceneReplyDraft('');
            return true;
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, fail, privateScenesRef, runDomainMutation]);

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
