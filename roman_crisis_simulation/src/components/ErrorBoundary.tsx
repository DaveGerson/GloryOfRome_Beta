import React from 'react';
import { hasSave } from '../persistence/saveGame';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

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

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the full error + component stack in the console for diagnosis -
    // the fallback UI below only shows the player a short summary.
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
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
          <p style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, color: 'var(--text-muted)', background: 'var(--surface-inset)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-sm)', padding: 12, margin: '0 0 22px', wordBreak: 'break-word' }}>
            {error.message}
          </p>
          <button onClick={this.handleReload} className="gor-btn gor-btn-lg gor-btn-primary">
            {canRestore ? 'Restore Last Save' : 'Reload'}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
