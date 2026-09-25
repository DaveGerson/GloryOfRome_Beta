/**
 * hooks/useVoiceCast.ts
 *
 * The campaign's voice cast (narration/voiceCast.ts) as the App sees it:
 * who casts it, when, where it is kept, and the Settings actions on it.
 *
 * WHEN THE CASTING DIRECTOR RUNS (`castVoices`, ai/tools/voiceCasting.ts -
 * one structured call on the prep model at LOW thinking, a paid call on the
 * player's key):
 *  - once per campaign, the first time the narration voice is on (not
 *    SILENT) while a campaign is in play and the voice can be reached (a key,
 *    or Mock Mode): at setup when the voice is already on, else the first
 *    time the player turns it on - an old save with no cast included;
 *  - then, while the voice is on, whenever someone new has become known and
 *    is not yet cast: ONE small 'newcomers' call for everyone uncast at that
 *    moment (a turn that reveals three people is one call, not three);
 *  - on "Recast everyone" in Settings (explicit, paid; the player's overrides
 *    are kept).
 * Nothing runs while the voice is SILENT, without a key, or on the character
 * selection screen. A failure never retries by itself: the members it was
 * asked about are cast by rule and kept, and play goes on.
 *
 * Mock Mode: `castVoices` makes no call and casts by rule, offline.
 *
 * WHERE IT IS KEPT: in the game state (`voiceCast`, VOICE_CAST_SET) and the
 * save's optional `voiceCast` field, patched into the stored autosave as soon
 * as it changes (`updateSavedVoiceCast`), so it survives a reload and travels
 * with an exported reign. A result from a campaign that has since been left
 * (a new game, Continue, an import) is dropped.
 *
 * WHAT THE VOICES USE: `effectiveCast` - the stored cast with anyone known but
 * not yet cast filled in by rule (not stored), so every character always has
 * a voice, even before the casting has run.
 *
 * PRIVACY (D4/D5): the casting sees only `castingCandidatesFor` - name,
 * position, epithet and entity type of the individuals the player knows -
 * plus the player's own name and position and the theme.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import { GameState, type Entity } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import type { GameAction } from '../state/gameReducer';
import type { GeminiClient } from '../ai/core/geminiService';
import { castVoices } from '../ai/tools/voiceCasting';
import type { CastingNarratorOption } from '../ai/prompts/voiceCasting';
import {
  castingCandidatesFor, completeCast, withMemberOverride, withoutMemberOverride,
  type CastOverride, type DefaultNarrator, type VoiceCast,
} from '../narration/voiceCast';
import { updateSavedVoiceCast } from '../persistence/saveGame';
import { DRAMATIC_READER_NARRATOR, NARRATORS } from '../narration/narrators';
import { getBespokeVoicesEnabled, setBespokeVoicesEnabled, type NarrationVoiceMode } from '../persistence/uiPrefs';

/** The cast's fallback narrator: the built-in Dramatic Reader in its own voice. */
export const DEFAULT_CAST_NARRATOR: DefaultNarrator = {
  narratorId: DRAMATIC_READER_NARRATOR.id,
  voiceName: DRAMATIC_READER_NARRATOR.voice.voiceName,
};

/** The deployed readers, as the casting director sees them. */
export const CASTING_NARRATOR_OPTIONS: readonly CastingNarratorOption[] = NARRATORS.map(n => ({ id: n.id, name: n.name, description: n.description }));

export interface CastBasisArgs {
  voiceCast: VoiceCast | null;
  playerEntity: Entity | null;
  entities: Entity[];
  knowledge: KnowledgeClaim[];
  defaultNarrator?: DefaultNarrator;
}

/**
 * What every voice reads, before any casting call: the candidates (the
 * player-visible projection), the effective cast, and the "Bespoke
 * character voices" switch. Split from `useVoiceCast` so the narration hook
 * can take the cast while the casting itself follows the narration mode.
 */
export function useCastBasis({ voiceCast, playerEntity, entities, knowledge, defaultNarrator = DEFAULT_CAST_NARRATOR }: CastBasisArgs) {
  const [bespokeVoices, setBespokeState] = useState(() => getBespokeVoicesEnabled());
  const handleSetBespokeVoices = useCallback((next: boolean) => {
    setBespokeState(next);
    setBespokeVoicesEnabled(next);
  }, []);
  const candidates = useMemo(() => castingCandidatesFor(playerEntity, entities, knowledge), [playerEntity, entities, knowledge]);
  const effectiveCast = useMemo(() => completeCast(voiceCast, candidates, defaultNarrator), [voiceCast, candidates, defaultNarrator]);
  return { candidates, effectiveCast, bespokeVoices, handleSetBespokeVoices };
}

export type CastBasis = ReturnType<typeof useCastBasis>;

export interface UseVoiceCastArgs {
  ai: GeminiClient;
  isMockMode: boolean;
  resolvedApiKey: string | null | undefined;
  narrationVoiceMode: NarrationVoiceMode;
  gameState: GameState;
  /** The stored cast (game state). */
  voiceCast: VoiceCast | null;
  dispatch: Dispatch<GameAction>;
  playerEntity: Entity | null;
  /** From `useCastBasis`: the candidates and the effective cast. */
  basis: Pick<CastBasis, 'candidates' | 'effectiveCast'>;
  /** The scenario theme, embedded in the casting prompt as data. */
  metaNarrative: string;
  /** The deployed readers the casting may choose among. */
  narrators?: readonly CastingNarratorOption[];
  /** The reader and voice the cast falls back to. */
  defaultNarrator?: DefaultNarrator;
  /** Bumped at every campaign boundary (hooks/useCampaignTransactions.ts). */
  campaignGenerationRef: MutableRefObject<number>;
}

export type RecastStatus = 'idle' | 'casting' | 'done' | 'fell_back';

export function useVoiceCast({
  ai, isMockMode, resolvedApiKey, narrationVoiceMode, gameState, voiceCast, dispatch,
  playerEntity, basis, metaNarrative, narrators = CASTING_NARRATOR_OPTIONS, defaultNarrator = DEFAULT_CAST_NARRATOR, campaignGenerationRef,
}: UseVoiceCastArgs) {
  const { candidates, effectiveCast } = basis;
  const [recastStatus, setRecastStatus] = useState<RecastStatus>('idle');

  const playerCharacterId = playerEntity?.entity_id ?? null;
  const castRef = useRef(voiceCast);
  const inFlightRef = useRef(false);
  useEffect(() => {
    castRef.current = voiceCast;
  }, [voiceCast]);

  /** Keeps a new cast: in the game state, and patched into the stored save. */
  const keep = useCallback((next: VoiceCast) => {
    castRef.current = next;
    dispatch({ type: 'VOICE_CAST_SET', voiceCast: next });
    updateSavedVoiceCast(next, playerCharacterId);
  }, [dispatch, playerCharacterId]);

  const player = useMemo(
    () => (playerEntity ? { name: playerEntity.name, ...(playerEntity.position ? { position: playerEntity.position } : {}) } : null),
    [playerEntity],
  );

  // Bumped when a result is dropped for belonging to a campaign since left,
  // so the automatic casting looks again for the campaign now in play.
  const [retryTick, setRetryTick] = useState(0);

  const runCasting = useCallback(async (mode: 'full' | 'newcomers'): Promise<boolean | null> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    const generation = campaignGenerationRef.current;
    let dropped = false;
    try {
      const existing = castRef.current;
      const effectiveMode = existing ? mode : 'full';
      const result = await castVoices(ai, {
        mode: effectiveMode,
        theme: metaNarrative,
        player,
        candidates: effectiveMode === 'full' ? candidates : candidates.filter(c => !existing?.members[c.entityId]),
        narrators,
        defaultNarrator,
        existing,
      }, isMockMode);
      // Another campaign since the call began: its cast is not this one's.
      if (campaignGenerationRef.current !== generation) {
        dropped = true;
        return null;
      }
      const latest = castRef.current;
      if (latest && latest !== existing) {
        // The cast changed while the call was out (an override): keep that
        // change, and add only what the call was for.
        const revision = Math.max(latest.revision, result.cast.revision) + 1;
        if (effectiveMode === 'newcomers') {
          const additions = Object.entries(result.cast.members).filter(([id]) => !latest.members[id]);
          if (additions.length > 0) keep({ ...latest, revision, members: { ...latest.members, ...Object.fromEntries(additions) } });
        } else {
          const members = Object.fromEntries(Object.entries(result.cast.members).map(([id, m]) => {
            const override = latest.members[id]?.override;
            return [id, override ? { ...m, override } : m];
          }));
          keep({ ...result.cast, revision, members });
        }
      } else {
        keep(result.cast);
      }
      return !result.usedFallback;
    } finally {
      inFlightRef.current = false;
      if (dropped) setRetryTick(tick => tick + 1);
    }
  }, [ai, isMockMode, candidates, metaNarrative, player, narrators, defaultNarrator, campaignGenerationRef, keep]);

  // The automatic casting: see the module header for exactly when.
  const canReach = isMockMode || Boolean(resolvedApiKey);
  const inPlay = gameState !== GameState.SETUP && gameState !== GameState.GAME_OVER && playerEntity !== null;
  const active = narrationVoiceMode !== 'off' && canReach && inPlay;
  const uncastKey = candidates.filter(c => !voiceCast?.members[c.entityId]).map(c => c.entityId).join(',');
  const needsCasting = active && (!voiceCast || uncastKey !== '');
  useEffect(() => {
    if (!needsCasting) return;
    void runCasting(voiceCast ? 'newcomers' : 'full');
  }, [needsCasting, uncastKey, voiceCast, runCasting, retryTick]);

  /** "Recast everyone": a paid call; the player's overrides are kept. */
  const handleRecast = useCallback(async () => {
    if (!canReach || !inPlay) return;
    setRecastStatus('casting');
    const outcome = await runCasting('full');
    // Mock Mode always casts by rule: that is its success, not a fallback.
    setRecastStatus(outcome === null ? 'idle' : outcome || isMockMode ? 'done' : 'fell_back');
  }, [canReach, inPlay, isMockMode, runCasting]);

  /** The base an override edits: the stored cast, or - before any casting - the cast by rule, which is then kept. */
  const baseCast = useCallback(() => castRef.current && candidates.every(c => castRef.current?.members[c.entityId])
    ? castRef.current
    : { ...effectiveCast, revision: Math.max(effectiveCast.revision, castRef.current?.revision ?? 0) }, [candidates, effectiveCast]);

  const handleOverrideMember = useCallback((entityId: string, change: CastOverride) => {
    if (!inPlay) return;
    const base = baseCast();
    const next = withMemberOverride(base, entityId, change);
    if (next !== base) keep(next);
  }, [baseCast, inPlay, keep]);

  const handleResetMember = useCallback((entityId: string) => {
    if (!inPlay) return;
    const base = baseCast();
    const next = withoutMemberOverride(base, entityId);
    if (next !== base) keep(next);
  }, [baseCast, inPlay, keep]);

  return {
    /** The cast every voice uses now (stored, with the uncast filled in by rule). */
    effectiveCast,
    /** Whether a casting (the director's or the rule's) has been kept for this campaign. */
    castStored: voiceCast !== null,
    recastStatus,
    canRecast: canReach && inPlay,
    handleRecast,
    handleOverrideMember,
    handleResetMember,
  };
}
