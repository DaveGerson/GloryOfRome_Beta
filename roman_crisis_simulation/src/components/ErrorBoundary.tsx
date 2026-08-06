import React from 'react';
import { hasSave, clearSave, SAVE_KEY } from '../persistence/saveGame';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** B7a 1b: the Abandon-grammar inline confirm staged over the fallback -
   * see the class doc comment below. Independent of `error` so it survives
   * whatever partial state `getDerivedStateFromError` merges in. */
  confirmAbandon: boolean;
  /**
   * The danger button mounts disabled and arms DANGER_ARM_MS later. The
   * keyed remount + safe-default focus below kill the keyboard walkthrough,
   * but a rapid double-CLICK hits whatever pixels the confirm row puts under
   * the pointer - only card layout stood between the ghost's former position
   * and the danger button. (This is not the arming D45 ratified against:
   * that guarded a RETRY beside a live Send and protected nothing; this
   * guards an irreversible destruction against pointer double-activation,
   * which focus and keys cannot structurally prevent.)
   */
  dangerArmed: boolean;
}

const DANGER_ARM_MS = 300;

/**
 * A last line of defense against a render-crash (e.g. a malformed
 * AI-generated entity missing a required field - see
 * ROADMAP_5_TECH_PERFORMANCE.md P0.4). Without this, any such crash takes
 * the whole app down to a blank white screen with no recovery path.
 *
 * The fallback deliberately does NOT try to recover in-place (React error
 * boundaries can't safely resume the subtree that threw). Instead it offers
 * a full reload: since turns/events/resource-spends now autosave (see
 * `persistence/saveGame.ts`), a reload drops the player back at
 * `CharacterSelection`'s "Continue your reign" card, which restores
 * everything up to the last successful commit.
 *
 * B7a 1b (spec: 2026-08-05-b7a-hardening-and-tablist-design.md): that
 * restore path assumed the slot itself was healthy. A save whose SHAPE
 * passes `loadGame`'s shallow validator but whose INTERIOR crashes render
 * (a malformed entity, say) had no in-app escape at all before this - reload
 * lands right back on the same crash, forever. The fix is a SECONDARY,
 * confirm-gated action beside "Restore Last Save": this boundary catches ANY
 * render crash, so the escape must never fire on a single accidental press.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // `react` ships no bundled type declarations in this project (no
  // @types/react either - see package.json), so `React.Component` resolves
  // as an untyped/`any` base class here. TS therefore doesn't know about
  // the `props`/`state` members the real base class provides at runtime;
  // declare them explicitly so the rest of this class type-checks.
  // `declare` (no emitted code) for `props`, since the real React.Component
  // constructor is what actually assigns `this.props` via `super(props)`.
  declare props: ErrorBoundaryProps;
  state: ErrorBoundaryState;

  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private escapeRef = React.createRef<HTMLButtonElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, confirmAbandon: false, dangerArmed: false };
  }

  static getDerivedStateFromError(error: unknown): Pick<ErrorBoundaryState, 'error'> {
    // A component can throw anything - `throw null` included. A falsy value
    // here would leave `state.error` null, re-render the children, and
    // re-enter the crash forever. Normalize, so the boundary holds on ANY
    // throw and `error.message` below is always readable.
    return {
      error: error instanceof Error ? error : new Error(String(error ?? 'An unnamed fracture')),
    };
  }

  componentWillUnmount(): void {
    if (this.armTimer !== null) clearTimeout(this.armTimer);
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the full error + component stack in the console for diagnosis -
    // the fallback UI below only shows the player a short summary.
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleAbandonRequest = (): void => {
    this.setState({ confirmAbandon: true, dangerArmed: false });
    this.armTimer = setTimeout(() => this.setState({ dangerArmed: true }), DANGER_ARM_MS);
  };

  private handleAbandonCancel = (): void => {
    if (this.armTimer !== null) clearTimeout(this.armTimer);
    // Backing out returns the keyboard user exactly where they were - on
    // the escape - instead of dropping focus to body. The callback runs
    // after the keyed resting row has remounted, so the ref is live.
    this.setState({ confirmAbandon: false }, () => this.escapeRef.current?.focus());
  };

  /**
   * `clearSave()` already never throws (every localStorage call in
   * persistence/saveGame.ts is guarded) - but this boundary is the last
   * line of defense in the app, so the call is wrapped again here anyway,
   * with a direct guarded `removeItem` fallback. Reload fires regardless of
   * whether the clear itself succeeded: a poisoned slot that fails to clear
   * must not trap the player behind this screen forever either.
   */
  private handleAbandonConfirm = (): void => {
    try {
      clearSave();
    } catch {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        // Nothing more this boundary can do - fall through to the reload.
      }
    }
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error, confirmAbandon } = this.state;
    if (!error) {
      return this.props.children;
    }

    const canRestore = hasSave();

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div className="gor-card gor-card-gilt" style={{ maxWidth: 520, width: '100%', padding: '32px 28px', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-epic)', fontWeight: 700, fontSize: 30, color: 'var(--tyrian-600)', marginBottom: 10 }}>
            The Republic Endures
          </h1>
          <p style={{ margin: '0 0 14px' }}>
            A fracture appeared in the chronicle and the scene could not be rendered. Your
            progress is not lost — the Republic's records survive even this.
          </p>
          {/* WP-21: a stack-shaped sentence is not information to a player,
              it is alarm. It stays one press away for whoever wants it. */}
          <details style={{ margin: '0 0 22px', textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Show the fracture
            </summary>
            <p style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, color: 'var(--text-muted)', background: 'var(--surface-inset)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-sm)', padding: 12, margin: '10px 0 0', wordBreak: 'break-word' }}>
              {error.message}
            </p>
          </details>
          {/* The two rows are KEYED and the safe action takes focus on
              entry, both load-bearing: unkeyed, React reused the button node
              at the same child index, so the focused ghost escape morphed in
              place into the danger confirm and a held/double-tapped Enter
              (which fires click on keydown and auto-repeats) walked straight
              through the gate — destroying a healthy reign after a merely
              transient crash. The keys force a fresh node; autoFocus lands
              the repeat press on "Keep my reign". */}
          {confirmAbandon ? (
            <div key="abandon-confirm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--crimson-500)', fontStyle: 'italic', fontSize: 15 }}>
                Abandon your saved reign? It cannot be undone.
              </span>
              <button onClick={this.handleAbandonConfirm} className="gor-btn gor-btn-danger" disabled={!this.state.dangerArmed}>Abandon</button>
              <button onClick={this.handleAbandonCancel} className="gor-btn gor-btn-ghost" autoFocus>Keep my reign</button>
            </div>
          ) : (
            <div key="resting" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={this.handleReload} className="gor-btn gor-btn-lg gor-btn-primary">
                {canRestore ? 'Restore Last Save' : 'Reload'}
              </button>
              <button ref={this.escapeRef} onClick={this.handleAbandonRequest} className="gor-btn gor-btn-ghost">
                Abandon the reign and begin anew
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
