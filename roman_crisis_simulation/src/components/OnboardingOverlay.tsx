import React, { useEffect, useRef, useState } from 'react';
import { WaxSeal } from './ui/Brand';
import { createFocusTrap, FocusTrap } from './ui/focusTrap';

/**
 * components/OnboardingOverlay.tsx
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - a dismissable 3-step intro shown
 * the FIRST time a fresh campaign reaches GameState.AWAITING_PLAYER_INPUT
 * (both a preset-character start and a custom-created one - see App.tsx's
 * `startGameWithCharacter`). Never shown on "Continue your reign", and never
 * shown again after it's been dismissed once on this device - see
 * persistence/onboarding.ts's `hasSeenOnboarding`/`markOnboardingSeen`, which
 * App.tsx owns; this component only renders what it's told to via `isOpen`.
 *
 * Content is deliberately in-fiction and consistent with DESIGN_DECISIONS.md:
 * D5 (the player is never omniscient - the side panel is framed as what you
 * KNOW, not ground truth) and D8 (no quest-log framing - step 1 describes
 * free-form intentions, never "set your goals").
 */

export interface OnboardingOverlayProps {
  isOpen: boolean;
  /** Called when the overlay is dismissed, however that happens (X, Escape, or finishing the final step). */
  onClose: () => void;
}

interface OnboardingStep {
  title: string;
  body: string;
  seal: string;
  /** What the pillar is claiming, shown rather than described. */
  specimenCaption: string;
  specimen: React.ReactNode;
  /** An aside beneath the well — never a clause bolted onto the body. */
  note?: string;
}

/** The order you write, and the seal that closes it. */
const WRITTEN_ORDER = (
  <div className="gor-specimen-order">
    <span className="gor-specimen-order-text">
      Summon the Praetorian prefect at dusk. Ask him plainly who pays the guard this month.
    </span>
    <WaxSeal letter="S" size={30} tone="crimson" />
  </div>
);

/**
 * Two accounts of one night that cannot both be right. Item 28's Reports
 * vocabulary, at specimen scale: wax and a laurel clause for the agent you
 * pay, no wax at all and a bronze clause for what the city merely repeats.
 */
const TWO_ACCOUNTS = (
  <div className="gor-specimen-reports">
    <div className="gor-report" style={{ borderTop: 'none', paddingTop: 0 }}>
      <WaxSeal letter="A" size={26} tone="crimson" />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span className="gor-report-source">Your agent</span>
        <span style={{ fontSize: 14 }}>“The prefect dined alone.”</span>
        <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--laurel-500)' }}>Stands firmly behind it.</span>
      </div>
    </div>
    <div className="gor-report">
      <span className="gor-seal-unsealed" aria-hidden="true">?</span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span className="gor-report-source">The rumour mill</span>
        <span style={{ fontSize: 14 }}>
          “He dined with <span className="gor-redact-weave">a man nobody will name</span>.”
        </span>
        <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--bronze-500)' }}>Cannot say how they came by it.</span>
      </div>
    </div>
    <span className="gor-specimen-close">Both sit in your panel. It will never tell you which one is true.</span>
  </div>
);

/** The stone every reign arrives at, with the name not yet cut. */
const BLANK_STONE = (
  <div className="gor-stone-blank">
    <span className="gor-stone-dentil" aria-hidden="true" />
    <span className="gor-stone-kicker">Here lies</span>
    <span className="gor-stone-name">Your name here</span>
    <span className="gor-stone-span">Week I — Week ?</span>
    <span className="gor-stone-rule" aria-hidden="true" />
    <span className="gor-stone-line">What is cut here is cut by how you played.</span>
  </div>
);

const STEPS: readonly OnboardingStep[] = [
  {
    title: 'Rule Your Week',
    seal: 'I',
    body:
      'You act by writing intentions in your own words — orders, schemes, speeches, letters. ' +
      'Each turn is one week, and the world moves whether you see it or not.',
    specimenCaption: 'One week, written and sealed',
    specimen: WRITTEN_ORDER,
  },
  {
    title: 'Knowledge Is Survival',
    seal: 'II',
    body:
      'The side panel holds what you know — not what is true. People can be investigated and ' +
      'coin can be spent; even then, what comes back can be wrong.',
    specimenCaption: 'Two accounts of the same night',
    specimen: TWO_ACCOUNTS,
  },
  {
    title: 'Death Is Real',
    seal: 'III',
    body:
      'There is no winning — only how long you last, and what history writes of you afterward. ' +
      'The Fates keep their own ledger.',
    specimenCaption: 'Every reign ends here',
    specimen: BLANK_STONE,
    note: '❦ Your reign is saved automatically, every week.',
  },
];

/** The chat input's element id (see components/Chat.tsx's ChatInput) - focus returns here on close. */
const CHAT_INPUT_ELEMENT_ID = 'chat-input';

const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<FocusTrap | null>(null);

  // Focus the dialog on open (components/ui/focusTrap.ts's `activate` -
  // remembers whatever was focused beforehand and moves focus in); on close
  // (isOpen -> false, or unmount), return focus to the chat input
  // specifically, per spec - falling back to the trap's own remembered
  // element (`release`) if the input isn't on the page for some reason.
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const trap = createFocusTrap(dialogRef.current);
    trapRef.current = trap;
    trap.activate();

    return () => {
      const chatInput = document.getElementById(CHAT_INPUT_ELEMENT_ID) as HTMLElement | null;
      if (chatInput) {
        chatInput.focus();
      } else {
        trap.release();
      }
      trapRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const current = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const handleAdvance = () => {
    if (isLastStep) {
      onClose();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    // Tab/Shift+Tab containment is the focus trap's concern, not this
    // component's - Escape-to-close stays here (this dialog has a close
    // affordance; see EventModal.tsx for one that deliberately doesn't).
    trapRef.current?.handleKeyDown(event);
  };

  return (
    <div className="gor-dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="gor-dialog"
        style={{ maxWidth: 540, padding: '0 0 22px' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close introduction"
          style={{ all: 'unset', position: 'absolute', top: 12, right: 16, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, zIndex: 1 }}
        >
          ×
        </button>

        <p aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
          Step {step + 1} of {STEPS.length}
        </p>

        <div className="gor-dialog-head" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <WaxSeal letter={current.seal} size={50} tone={isLastStep ? 'crimson' : 'tyrian'} />
          </div>
          <h2 id="onboarding-title" style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 27, color: 'var(--tyrian-600)' }}>
            {current.title}
          </h2>
          <div className="gor-dialog-rule"></div>
        </div>

        <p id="onboarding-body" className="gor-dialog-body" style={{ textAlign: 'center', whiteSpace: 'pre-wrap', margin: 0 }}>
          {current.body}
        </p>

        {/* Each pillar shows its claim rather than asserting it. */}
        <p className="gor-specimen-caption">{current.specimenCaption}</p>
        <div className="gor-specimen">{current.specimen}</div>
        {current.note && <p className="gor-specimen-note">{current.note}</p>}

        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {/* Numerals, matching the seals — three dots said nothing about which rite you are in. */}
          <div className="gor-rite-steps" aria-hidden="true">
            {STEPS.map((entry, index) => (
              <span key={entry.seal} className={`gor-rite-step${index === step ? ' gor-rite-step-now' : ''}`}>
                {entry.seal}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* A dismissable rite should say it is dismissable. */}
            <button type="button" onClick={onClose} className="gor-btn gor-btn-md gor-btn-ghost">Skip the rite</button>
            <button type="button" onClick={handleAdvance} className="gor-btn gor-btn-md gor-btn-primary">
              {isLastStep ? 'Take your place' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingOverlay;
