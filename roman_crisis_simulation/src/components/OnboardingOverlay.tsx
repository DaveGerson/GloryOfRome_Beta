import React, { useEffect, useRef, useState } from 'react';
import { WaxSeal } from './ui/Brand';

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
}

const STEPS: readonly OnboardingStep[] = [
  {
    title: 'Rule Your Week',
    seal: 'I',
    body:
      'You act by writing intentions in your own words — orders, schemes, speeches, letters. ' +
      'Each turn is one week, and the world moves whether you see it or not.',
  },
  {
    title: 'Knowledge Is Survival',
    seal: 'II',
    body:
      'The side panel holds what you know — not what is true. Dispatches report only what ' +
      'reaches your ears. People can be investigated, coin can be spent, and even then, reports ' +
      'can be wrong or incomplete.',
  },
  {
    title: 'Death Is Real',
    seal: 'III',
    body:
      'There is no winning — only how long you last, and what history writes of you afterward. ' +
      'The Fates keep their own ledger: your reign is saved automatically, every turn.',
  },
];

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The chat input's element id (see components/Chat.tsx's ChatInput) - focus returns here on close. */
const CHAT_INPUT_ELEMENT_ID = 'chat-input';

const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Never resume mid-sequence - every time the overlay opens it starts at step 1.
  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen]);

  // Focus the dialog on open; on close (isOpen -> false, or unmount), return
  // focus to the chat input specifically, per spec - falling back to
  // whatever previously had focus if the input isn't on the page for some
  // reason.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    return () => {
      const chatInput = document.getElementById(CHAT_INPUT_ELEMENT_ID) as HTMLElement | null;
      (chatInput ?? previouslyFocused)?.focus();
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

    if (event.key !== 'Tab' || !dialogRef.current) return;

    // Simple focus trap: keep Tab/Shift+Tab cycling within the dialog.
    const focusable: HTMLElement[] = [];
    dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach(el => {
      if (!el.hasAttribute('disabled')) focusable.push(el);
    });
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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

        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }} aria-hidden="true">
            {STEPS.map((_, index) => (
              <span
                key={index}
                style={{ width: 9, height: 9, borderRadius: '50%', transition: 'background var(--duration-slow) var(--ease-standard)', background: index === step ? 'var(--gold-500)' : 'var(--parchment-300)', boxShadow: index === step ? '0 0 4px rgba(201,162,39,.6)' : undefined }}
              />
            ))}
          </div>
          <button type="button" onClick={handleAdvance} className="gor-btn gor-btn-md gor-btn-primary">
            {isLastStep ? 'Begin' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingOverlay;
