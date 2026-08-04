import React from 'react';

/**
 * The one alert (audit item 04). Nine unstyled `role="alert"` paragraphs used
 * to sit in the middle of a fully-dressed system; the composer and the private
 * scene were fixed first, and this sweeps the five that remained.
 *
 * A crimson metal edge, a title in the app's voice, and the message. The
 * title is always **in fiction** — a failed autosave is "The record refuses",
 * never "Error".
 *
 * `role="alert"` stays on the OUTER element, so the number of alerts a screen
 * reader (or a test) sees is exactly what it was before this component
 * existed.
 */
/**
 * Three volumes (WP-21). Crimson: something failed and you must act.
 * Bronze: something is in the way, and waiting may clear it. Laurel: nothing
 * failed at all — which is why laurel takes `role="status"` rather than
 * `role="alert"`. A screen reader must not announce a successful save as an
 * error.
 */
export type AlertTone = 'crimson' | 'bronze' | 'laurel';

export const Alert: React.FC<{
  /** In-fiction, in the player's world. Never "Error". */
  title: string;
  tone?: AlertTone;
  /** Set on dark grounds — the epilogue's stele, not the marble. */
  onDarkGround?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** One primary that can plausibly work, and at most one secondary beside it. */
  actions?: React.ReactNode;
}> = ({ title, tone = 'crimson', onDarkGround = false, style, children, actions }) => (
  <div
    className={`gor-alert gor-alert-${tone}${onDarkGround ? ' gor-alert-dark' : ''}`}
    role={tone === 'laurel' ? 'status' : 'alert'}
    style={style}
  >
    <span className="gor-alert-bar" aria-hidden="true" />
    <span className="gor-alert-body">
      <span className="gor-alert-title">{title}</span>
      <span className="gor-alert-msg">{children}</span>
      {actions && <span className="gor-alert-actions">{actions}</span>}
    </span>
  </div>
);

/**
 * The name a failed write goes by everywhere in the app. Three call sites
 * share it deliberately — one failure, one name.
 */
export const RECORD_REFUSES = 'The record refuses';
