/**
 * hooks/useCampaignLifecycle.ts
 *
 * Every campaign boundary the character-selection screen and the
 * configuration menu can cross: a preset or custom-created character
 * (startGameWithCharacter), Continue, Start Anew, and importing a reign.
 * Moved verbatim out of App.tsx (2026-09-23), with the saved-game summary
 * the selection screen shows.
 *
 * Each boundary calls beginCampaignSession (hooks/useCampaignTransactions.ts)
 * BEFORE the new campaign's first AI call, and each durable write goes
 * through the shared commit kernel.
 */

import { useCallback, useState } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { GoogleGenAI } from '@google/genai';
import type { Entity, Message, PlayerCharacterOption, WorldState } from '../types';
import type { GameAction } from '../state/gameReducer';
import type { DomainMutationContext } from '../state/domainMutation';
import type { SavedGameSummary } from '../components/CharacterSelection';
import { deriveStarterActions } from '../components/starterActions';
import { ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { createCharacter } from '../ai/tools/characterCreator';
import { initiateWorld } from '../ai/core/initiator';
import { loadGame, clearSave, importSaveBlob } from '../persistence/saveGame';
import type { SaveGameState } from '../persistence/saveGame';
import { loadSavedGameSummary, type DomainCommit, type TransactionNote } from '../app/transactions';

export interface CampaignLifecycleDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    worldState: WorldState;
    metaNarrative: string;
    messages: Message[];
    dispatch: Dispatch<GameAction>;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    beginCampaignSession: () => void;
    campaignGenerationRef: MutableRefObject<number>;
    setTransactionNote: (note: TransactionNote | null) => void;
    /** hooks/useOnboarding.ts - shown once ever, for a brand-new campaign. */
    offerOnboarding: () => void;
}

export function useCampaignLifecycle(deps: CampaignLifecycleDeps) {
    const {
        ai, isMockMode, worldState, metaNarrative, messages,
        dispatch, buildSaveState, commitDomainMutation, beginCampaignSession, campaignGenerationRef,
        setTransactionNote, offerOnboarding,
    } = deps;

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedGameSummary | null>(loadSavedGameSummary);

    const startGameWithCharacter = (characterEntity: Entity, allInitialEntities: Entity[], initialWorldState?: WorldState, initialMetaNarrative?: string) => {
        const resolvedWorldState = initialWorldState ?? worldState;
        const resolvedMetaNarrative = initialMetaNarrative ?? metaNarrative;

        const introMessage: Message = {
            sender: 'gm',
            text: `You have chosen to be **${characterEntity.name}**.\n\n${characterEntity.current_state_narrative}\n\nThe world holds its breath. What is your first action?`
        };

        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - seed the suggested-action
        // pills from the chosen character's own goals (pure, no AI call - see
        // components/starterActions.ts) so turn 1 isn't a blank page.
        const starterActions = deriveStarterActions(characterEntity);

        const candidate = buildSaveState({ entities: allInitialEntities, worldState: resolvedWorldState, metaNarrative: resolvedMetaNarrative, playerCharacterId: characterEntity.entity_id, messages: [...messages, introMessage], suggestedActions: starterActions, voiceCast: null });
        if (!commitDomainMutation({
            candidate,
            action: {
                type: 'GAME_STARTED',
                entities: allInitialEntities,
                playerCharacterId: characterEntity.entity_id,
                introMessage,
                suggestedActions: starterActions,
                worldState: initialWorldState,
                metaNarrative: initialMetaNarrative,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your campaign could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        })) {
            return;
        }

        // Show the first-turn onboarding overlay exactly once ever -
        // covers both a preset character (handleSelectCharacter) and a
        // custom-created one (handleCustomCreation), since both call this
        // function. Never fires from handleContinue, which leaves
        // `showOnboarding` at its default of `false` (it isn't part of
        // SaveGameState).
        offerOnboarding();

    };

    const handleSelectCharacter = (option: PlayerCharacterOption) => {
        // The session call log (ai/core/geminiService.ts) is per-campaign-
        // session: reset it at every campaign boundary, BEFORE the new
        // campaign's first AI call, so calls from a previous campaign in the
        // same tab can't contaminate this campaign's eval-corpus export.
        // Same constraint in handleCustomCreation and handleContinue.
        beginCampaignSession();
        const playerEntity = ALL_INITIAL_ENTITIES.find(e => e.entity_id === option.entity_id);
        if(playerEntity) {
            startGameWithCharacter(playerEntity, JSON.parse(JSON.stringify(ALL_INITIAL_ENTITIES)));
        }
    };

    const handleCustomCreation = async (
        { description, metaNarrative: newMetaNarrative, useCustomGamestate }: { description: string, metaNarrative?: string, useCustomGamestate: boolean },
        transaction: DomainMutationContext,
    ) => {
        // Per-campaign-session log (see handleSelectCharacter). Reset here -
        // not in startGameWithCharacter - so the world/character-generation
        // calls made just below already belong to the NEW campaign's log.
        beginCampaignSession();
        if (useCustomGamestate && newMetaNarrative) {
            // New world generation logic
            const { worldState: newWorldState, entities: newEntities, playerCharacterId: newPlayerId } = await initiateWorld(ai, newMetaNarrative, description, isMockMode);
            if (!transaction.isCurrent()) return;
            const playerChar = newEntities.find(e => e.entity_id === newPlayerId);
            if (playerChar) {
                startGameWithCharacter(playerChar, newEntities, newWorldState, newMetaNarrative);
            } else {
                 dispatch({ type: 'MESSAGE_ADDED', message: { sender: 'gm', text: "Error: Failed to generate a valid player character in the new world."} });
            }
        } else {
            // Existing custom character in default world
            const newCharacter = await createCharacter(ai, description, isMockMode);
            if (!transaction.isCurrent()) return;
            const finalEntities = ALL_INITIAL_ENTITIES.find(e => e.entity_id === newCharacter.entity_id)
                ? ALL_INITIAL_ENTITIES.map(e => e.entity_id === newCharacter.entity_id ? newCharacter : e)
                : [...ALL_INITIAL_ENTITIES, newCharacter];
            startGameWithCharacter(newCharacter, JSON.parse(JSON.stringify(finalEntities)));
        }
    };

    const handleContinue = useCallback(() => {
        const save = loadGame();
        if (!save) {
            setSavedGameInfo(null);
            return;
        }
        // Per-campaign-session log (see handleSelectCharacter): the loaded
        // campaign starts a fresh session log, dropping any calls a prior
        // campaign made in this tab.
        beginCampaignSession();
        // GAME_LOADED (state/gameReducer.ts) restores the whole campaign in
        // one state transition: it normalizes the optional save fields
        // (inferredAmbition, pendingIntelligenceFallout - absent on older
        // saves) and re-derives the terminal state from the loaded player
        // entity's status (DESIGN_DECISIONS.md D1 - only death is terminal;
        // GAME_OVER itself is never persisted, only the underlying entities
        // are, and a save CAN legitimately be reloaded on an already-ended
        // run when the player closed the tab on the epilogue screen).
        dispatch({ type: 'GAME_LOADED', save: save.state });
        setTransactionNote(null);
    }, [beginCampaignSession, dispatch, setTransactionNote]);

    const handleStartAnew = useCallback(() => {
        if (!clearSave().ok) {
            setTransactionNote({ kind: 'plain', message: 'Your saved reign could not be removed. Please try again.' });
            return false;
        }
        beginCampaignSession();
        setTransactionNote(null);
        setSavedGameInfo(null);
        return true;
    }, [beginCampaignSession, setTransactionNote]);

    /**
     * B7a 1c (spec: 2026-08-05-b7a-hardening-and-tablist-design.md): a
     * successful import must invalidate any in-flight D8 ambition tail from
     * the PRIOR reign the same way turn-rollback invalidation works
     * (useExecuteTurn.ts's generation guard) - otherwise a stale inference
     * that resolves after the import patches its old ambition into the
     * freshly imported slot. Bumping the generation here is that guard's one
     * trigger; both import homes receive this wrapper, never the raw
     * `importSaveBlob`.
     */
    const handleImportReign = useCallback((text: string) => {
        const result = importSaveBlob(text);
        if (result.ok) campaignGenerationRef.current += 1;
        return result;
    }, [campaignGenerationRef]);

    return {
        savedGameInfo,
        handleSelectCharacter,
        handleCustomCreation,
        handleContinue,
        handleStartAnew,
        handleImportReign,
    };
}
