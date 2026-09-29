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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { GoogleGenAI } from '@google/genai';
import type { Entity, Message, PlayerCharacterOption, WorldState } from '../types';
import type { GameAction } from '../state/gameReducer';
import type { DomainMutationContext } from '../state/domainMutation';
import type { SavedReign } from '../components/CharacterSelection';
import { deriveStarterActions } from '../components/starterActions';
import { ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { createCharacter } from '../ai/tools/characterCreator';
import { initiateWorld } from '../ai/core/initiator';
import { loadGame, clearSave, importSaveBlob } from '../persistence/saveGame';
import type { SaveGameState } from '../persistence/saveGame';
import { loadSavedGameSummary, type DomainCommit, type TransactionNote } from '../app/transactions';
import { focusComposer } from '../app/domCommands';

export interface CampaignLifecycleDeps {
    ai: GoogleGenAI;
    isMockMode: boolean;
    /** D34 - a custom destiny is never forged keyless (see handleCustomCreation). */
    resolvedApiKey: string | null;
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
        ai, isMockMode, resolvedApiKey, worldState, metaNarrative, messages,
        dispatch, buildSaveState, commitDomainMutation, beginCampaignSession, campaignGenerationRef,
        setTransactionNote, offerOnboarding,
    } = deps;

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    // A readable reign's summary, or the reason the slot's reign cannot be
    // read - either way a reign is at stake, and the destiny screen gates
    // its overwrite behind the Abandon confirm.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedReign | null>(loadSavedGameSummary);

    // Continue and a chosen destiny both unmount the very button that was
    // pressed, dropping focus to <body>. Once the game screen's tablet is
    // mounted and writable (the composer stays held until the campaign's
    // lease is released - a later commit), it takes the focus: the next
    // act is to write the week. Unless something else has claimed focus
    // first - the onboarding letter, or a fate's dialog - which keeps it.
    // Dependency-free, like components/ui/useFocusRequest.ts: it must run
    // after whichever commit renders the writable tablet.
    const tabletFocusPendingRef = useRef(false);
    useEffect(() => {
        if (!tabletFocusPendingRef.current) return;
        const active = document.activeElement;
        if ((active && active !== document.body) || focusComposer()) tabletFocusPendingRef.current = false;
    });

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
        tabletFocusPendingRef.current = true;

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
        // D34 - the same keyless backstop as a turn's (useExecuteTurn.ts):
        // with no key and no canned responses, nothing is sent. The destiny
        // screen already holds the forge and shows the no-key notice; this
        // guard only stops a request that got past it, keeping the draft.
        if (!isMockMode && !resolvedApiKey) return;
        // Per-campaign-session log (see handleSelectCharacter). Reset here -
        // not in startGameWithCharacter - so the world/character-generation
        // calls made just below already belong to the NEW campaign's log.
        beginCampaignSession();
        if (useCustomGamestate && newMetaNarrative) {
            // New world generation logic
            const { worldState: newWorldState, entities: newEntities, playerCharacterId: newPlayerId } = await initiateWorld(ai, newMetaNarrative, description, isMockMode);
            if (!transaction.isCurrent()) return;
            const playerChar = newEntities.find(e => e.entity_id === newPlayerId);
            // A world that names no player cannot begin. Thrown, never
            // written into the chat log: at this screen nothing renders the
            // log, and the line would open the NEXT campaign's chronicle.
            // CharacterSelection's refusal says what happened and keeps the
            // words for another attempt - generation is not deterministic.
            if (!playerChar) throw new Error('WORLD_GENERATION_NAMED_NO_PLAYER');
            startGameWithCharacter(playerChar, newEntities, newWorldState, newMetaNarrative);
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
            // Re-read, never assume "no reign": another tab may have written
            // a newer build's save (or damaged the slot) since this screen
            // mounted. A refused reign keeps its card, its copy and the
            // Abandon gate; only an emptied slot drops the card.
            setSavedGameInfo(loadSavedGameSummary());
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
        tabletFocusPendingRef.current = true;
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
