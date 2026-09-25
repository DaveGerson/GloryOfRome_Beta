import React from 'react';
import type { PrivateScenePlayerView } from '../perception/visibility';
import { WaxSeal } from './ui/Brand';
import { EmptyRegister, FoldedLetterSilhouette } from './tabs/EmptyRegister';
import { NarrationVoiceControl } from './Chat';
import type { PrivateSceneNpcVoice } from '../hooks/usePrivateSceneVoice';

/**
 * The shelf of closed private scenes (WP-16), split out of PrivateScene.tsx:
 * one sealed letter per scene, the seal telling how it ended, and the open
 * letter's transcript, attributed speech acts, closure and last word.
 * Player-only - it reads the PrivateScenePlayerView projection and nothing
 * else. Which letter is open is the parent's state, because the week's guard
 * ("Read what was said") also opens one.
 */

const transcriptLineStyle: React.CSSProperties = { margin: '6px 0', paddingLeft: 10, borderLeft: '2px solid var(--border-subtle)' };
const sectionHeadingStyle: React.CSSProperties = { margin: '14px 0 4px' };

/** Player-visible copy for an NPC's spoken line (veto-queue: roadmaps/BACKLOG.md B13). */
export const SCENE_VOICE_COPY = {
  toggle: 'Hear them speak',
  toggleNote: 'Each of their lines gets a play control, in a voice of their own. Every line is a paid call on your key.',
  line: 'Hear them say it',
} as const;

/**
 * One line of a scene's transcript, attributed "You" or by the NPC's name.
 * With the scene voice on (hooks/usePrivateSceneVoice.ts), an NPC's
 * committed line carries a play control that speaks it in their own voice.
 */
export const TranscriptLine: React.FC<{
  line: PrivateScenePlayerView['transcript'][number];
  npcName: string;
  voice?: { scene: PrivateScenePlayerView; npcVoice: PrivateSceneNpcVoice };
}> = ({ line, npcName, voice }) => {
  const state = voice?.npcVoice.stateFor(voice.scene, line);
  return (
    <div style={transcriptLineStyle}>
      <p style={{ margin: 0 }}><strong>{line.speaker === 'player' ? 'You' : npcName}:</strong> {line.text}</p>
      {voice && state !== undefined && (
        <NarrationVoiceControl state={state} label={SCENE_VOICE_COPY.line} onToggle={() => voice.npcVoice.onToggle(voice.scene, line)} />
      )}
    </div>
  );
};

function describeClosure(scene: PrivateScenePlayerView): string {
  switch (scene.closureReason) {
    case 'refused': return `${scene.npcName} refused the invitation.`;
    case 'player_ended': return 'You ended the scene.';
    case 'npc_ended': return `${scene.npcName} ended the scene.`;
    case 'response_limit': return 'The exchange reached its natural limit.';
    default: return 'The scene ended.';
  }
}

/**
 * How a closed scene ended, carried by the seal so the shelf is legible
 * without opening a letter (WP-16). Intact Tyrian: you ended it. Broken
 * Tyrian: they did. Broken crimson: the six replies ran out. Dashed and
 * unsealed: they never came at all.
 */
type ClosureSeal = { className: string; tone: 'crimson' | 'tyrian'; refused: boolean };

function closureSeal(scene: PrivateScenePlayerView): ClosureSeal {
  switch (scene.closureReason) {
    case 'player_ended': return { className: 'gor-scene-seal', tone: 'tyrian', refused: false };
    case 'npc_ended': return { className: 'gor-scene-seal gor-scene-seal-broken', tone: 'tyrian', refused: false };
    case 'response_limit': return { className: 'gor-scene-seal gor-scene-seal-broken', tone: 'crimson', refused: false };
    case 'refused': return { className: 'gor-scene-seal gor-scene-seal-unsealed', tone: 'tyrian', refused: true };
    default: return { className: 'gor-scene-seal', tone: 'tyrian', refused: false };
  }
}

/** `unclassified` is a statement like any other; it just wasn't worth a name. */
function describeSpeechActKind(kind: string): string {
  return kind === 'unclassified' ? 'Statement' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Two kinds carry a colour, and they are a pair: crimson where something was
 * PRESSED FOR (`request`, `threat` — the ask and the ask with menace), Tyrian
 * where it was DECLINED (`refusal`). Scanning the column tells you who asked
 * and who closed the door; everything else is an inset well.
 *
 * These are drawn from the closed `PrivateSceneSpeechActKind` set in
 * `privateScene/model.ts`. It shipped branching on `'demand'` and `'evasion'`,
 * neither of which is in that set, so the hard style fired only for `threat`
 * and `gor-said-kind-evasive` was unreachable.
 */
function speechActClass(kind: string): string {
  if (kind === 'request' || kind === 'threat') return 'gor-said-kind gor-said-kind-hard';
  if (kind === 'refusal') return 'gor-said-kind gor-said-kind-refusal';
  return 'gor-said-kind';
}

export const PrivateSceneShelf: React.FC<{
  completed: readonly PrivateScenePlayerView[];
  reading: PrivateScenePlayerView | undefined;
  onRead: (sceneId: string) => void;
  npcVoice?: PrivateSceneNpcVoice;
}> = ({ completed, reading, onRead, npcVoice }) => (
  <section aria-label="Past private scenes">
    <h3 className="gor-label" style={sectionHeadingStyle}>Past private scenes</h3>
    {completed.length === 0 ? (
      <EmptyRegister
        silhouette={<FoldedLetterSilhouette />}
        line="No door has closed behind you yet."
        hint="What is said in private is kept here once the scene ends."
      />
    ) : <div className="gor-shelf">
      <div className="gor-shelf-rail">
        {completed.map(scene => {
          const seal = closureSeal(scene);
          return (
            <button
              key={scene.sceneId}
              type="button"
              className={`gor-shelf-letter${scene.sceneId === reading?.sceneId ? ' gor-shelf-letter-open' : ''}`}
              aria-current={scene.sceneId === reading?.sceneId}
              onClick={() => onRead(scene.sceneId)}
            >
              <span className={seal.className} aria-hidden="true"><WaxSeal letter={scene.npcName.charAt(0).toUpperCase()} size={30} tone={seal.tone} /></span>
              <span className="gor-shelf-letter-body">
                <span className="gor-shelf-name">{scene.npcName}</span>
                <span className={`gor-shelf-closure${seal.refused ? ' gor-shelf-closure-refused' : ''}`}>{describeClosure(scene)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {reading && (
        <div className="gor-shelf-pane">
          <div role="region" aria-label={`Transcript with ${reading.npcName}`}>
            {reading.transcript.map(line => (
              <TranscriptLine key={line.sequence} line={line} npcName={reading.npcName} voice={npcVoice ? { scene: reading, npcVoice } : undefined} />
            ))}
          </div>
          {reading.speechActs.length > 0 && (
            <section aria-label={`Attributed speech acts with ${reading.npcName}`}>
              <h4 className="gor-label" style={{ margin: '10px 0 4px' }}>What was said, in kind</h4>
              <div className="gor-said">
                {reading.speechActs.map((act, index) => (
                  <React.Fragment key={`${act.exchange}-${index}`}>
                    <span className={speechActClass(act.kind)}>
                      {act.speaker === 'player' ? 'You' : reading.npcName} — {describeSpeechActKind(act.kind)}
                    </span>
                    <span className="gor-said-quote">{act.text}</span>
                  </React.Fragment>
                ))}
              </div>
            </section>
          )}
          <p style={{ margin: '10px 0 0' }}><strong>Closure:</strong> {describeClosure(reading)}</p>
          {/* Absence is a line, not a missing element — silence was a choice too. */}
          <div className="gor-lastword">
            <span className="gor-lastword-title">Your last word</span>
            <span className="gor-lastword-body">{reading.lastWord ?? 'You let it stand.'}</span>
          </div>
        </div>
      )}
    </div>}
  </section>
);
