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
export const Alert: React.FC<{
  /** In-fiction, in the player's world. Never "Error". */
  title: string;
  /** Set on dark grounds — the epilogue's stele, not the marble. */
  onDarkGround?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, onDarkGround = false, style, children }) => (
  <div className={`gor-alert${onDarkGround ? ' gor-alert-dark' : ''}`} role="alert" style={style}>
    <span className="gor-alert-bar" aria-hidden="true" />
    <span className="gor-alert-body">
      <span className="gor-alert-title">{title}</span>
      <span className="gor-alert-msg">{children}</span>
    </span>
  </div>
);

/**
 * The name a failed write goes by everywhere in the app. Three call sites
 * share it deliberately — one failure, one name.
 */
export const RECORD_REFUSES = 'The record refuses';
