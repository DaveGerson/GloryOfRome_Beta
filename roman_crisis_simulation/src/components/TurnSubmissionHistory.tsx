import React from 'react';
import type { MessageRecipient, TurnSubmission } from '../types';
import { deserializeTurnSubmission, isReservedTurnSubmissionArtifact } from '../playerInput/turnSubmission';

export type HistorySubmission = TurnSubmission | { kind: 'invalid_artifact' };

export type SubmissionHistoryAudience = 'player' | 'gm';

export function structuredSubmissionForHistory(text: string): HistorySubmission | null {
  const submission = deserializeTurnSubmission(text);
  if (submission) return submission;
  return isReservedTurnSubmissionArtifact(text) ? { kind: 'invalid_artifact' } : null;
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle: React.CSSProperties = { fontWeight: 700, fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase' };
const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18 };

function recipientLabel(
  recipient: MessageRecipient,
  audience: SubmissionHistoryAudience,
): string {
  if (recipient.kind === 'free_text') return recipient.text;
  return audience === 'gm'
    ? `${recipient.displayName} [${recipient.entityId}]`
    : recipient.displayName;
}

export const TurnSubmissionHistory: React.FC<{
  submission: HistorySubmission;
  audience: SubmissionHistoryAudience;
}> = ({ submission, audience }) => submission.kind === 'invalid_artifact' ? (
  <div data-submission-history={audience} role="note">Invalid turn submission artifact.</div>
) : submission.kind === 'freeform' ? (
  <div data-submission-history={audience}>{submission.text}</div>
) : (
  <div data-submission-history={audience} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {submission.actions?.length ? (
      <section style={fieldStyle}>
        <span style={labelStyle}>Actions</span>
        <ul style={listStyle}>{submission.actions.map((action, index) => <li key={`${index}-${action}`}>{action}</li>)}</ul>
      </section>
    ) : null}
    {submission.messagesOrOrders?.length ? (
      <section style={fieldStyle}>
        <span style={labelStyle}>Messages / Orders</span>
        <ul style={listStyle}>
          {submission.messagesOrOrders.map(({ recipient, command }, index) => (
            <li key={`${index}-${command}`}><strong>{recipientLabel(recipient, audience)}:</strong> {command}</li>
          ))}
        </ul>
      </section>
    ) : null}
    {submission.privateIntent ? (
      audience === 'player' ? (
        <details>
          <summary style={labelStyle}>Private Intent</summary>
          <div style={{ marginTop: 6 }}>{submission.privateIntent}</div>
        </details>
      ) : (
        <section style={fieldStyle}>
          <span style={labelStyle}>Private Intent</span>
          <span>{submission.privateIntent}</span>
        </section>
      )
    ) : null}
    {submission.questionOrContext ? (
      <section style={fieldStyle}>
        <span style={labelStyle}>Question / Context</span>
        <span>{submission.questionOrContext}</span>
      </section>
    ) : null}
  </div>
);
