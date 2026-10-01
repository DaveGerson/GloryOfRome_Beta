// @vitest-environment jsdom
/**
 * tests/journeys/occurrenceQuestions.journey.ts
 *
 * DESIGN_DECISIONS.md D47's grounded questions, end to end through the REAL
 * App in Mock Mode, as a keyless player meets them: choose the Young
 * Emperor, "Play against canned responses", send one week, open Events, and
 * put "Who is behind it?" and then "Who gains?" to what the forum cried.
 *
 * Nothing is scripted. Mock Mode's pipeline writes the week's attribution
 * record (TurnHistoryEntry.headlineActors) as the real one does, and its
 * occurrence answers roll from a seed fixed by the occurrence and the
 * question (ai/mocks.ts::mockIntelSeed), so the run lands the same way
 * every time. The canned week cries one occurrence with a named hand and
 * one that arose from circumstance; both are asked, so both answers - hands
 * named, and no one at all - are crossed.
 *
 * Pinned, for each occurrence:
 *  - each finding lands in the tab, under its question, and in the store;
 *  - each has its own GM-private truth-ledger entry, linked to its finding
 *    by the finding's claim key (D11);
 *  - the two answers agree on whether anyone acted at all (D47);
 * and nothing on the harness's INV-LEAK list (harness.ts::gmPrivateLeakList)
 * reaches the DOM - its text or its markup.
 */

import { describe, expect, it } from 'vitest';
import {
  appButton,
  appClick,
  appControl,
  appSetValue,
  gmPrivateLeakList,
  leakViolations,
  loadThreadState,
  mountJourneyAppInMockMode,
  waitForApp,
  type MountedJourneyApp,
} from './harness';
import { occurrenceClaimKey, occurrenceFindings, type OccurrenceQuestion } from '../../knowledge/store';
import type { SaveGameState } from '../../persistence/saveGame';

const ASKED: Array<{ question: OccurrenceQuestion; ask: string; kicker: string }> = [
  { question: 'who_is_behind_it', ask: 'Who is behind it?', kicker: 'Your agents · who is behind it' },
  { question: 'who_gains', ask: 'Who gains?', kicker: 'Your agents · who gains' },
];

/** Nothing GM-private on the page: neither in what it says nor in what it carries for a reader. */
function expectNoGmPrivateInTheDom(state: SaveGameState, label: string): void {
  const entry = state.turnHistory.at(-1)!;
  const forbidden = gmPrivateLeakList(entry, entry.postTurnEntities ?? state.entities, state.knowledge ?? [], state.playerCharacterId!);
  const violations = leakViolations([
    { surface: 'DOM text', text: document.body.textContent ?? '' },
    { surface: 'DOM markup', text: document.body.innerHTML },
  ], forbidden);
  expect(violations, `[${label}] GM-private data on the page:\n${violations.join('\n')}`).toEqual([]);
  for (const field of ['"standing"', '"groundTruth"', 'heldToSibling', 'cameBackEmpty', 'headlineActors', 'actorIds', 'livingAtCommit']) {
    expect(document.body.innerHTML, `[${label}] ${field} on the page`).not.toContain(field);
  }
}

/** Opens `occurrence`'s slip on the Events tab and asks both grounded questions, waiting for each to land. */
async function askBoth(app: MountedJourneyApp, occurrence: string): Promise<void> {
  const slip = () => Array.from(app.container.querySelectorAll<HTMLElement>('.gor-card'))
    .find(card => card.querySelector('button[aria-expanded]')?.textContent?.includes(occurrence))!;
  expect(slip(), `the slip for "${occurrence}"`).toBeDefined();
  await appClick(slip().querySelector<HTMLButtonElement>('button[aria-expanded]')!);
  for (const [index, { ask, question }] of ASKED.entries()) {
    await appClick(appButton(slip(), ask));
    await waitForApp(() => expect(occurrenceFindings(loadThreadState().knowledge ?? [], occurrence).map(found => found.question)).toContain(question));
    await waitForApp(() => expect(slip().querySelectorAll('.gor-finding')).toHaveLength(index + 1));
  }
}

describe('journey: putting "Who is behind it?" and "Who gains?" to an occurrence (D47)', () => {
  it('lands both findings in the tab, each with its own ledger entry, agreeing on whether anyone acted, and leaks nothing GM-side', async () => {
    const app = await mountJourneyAppInMockMode();
    try {
      // --- One canned week -------------------------------------------------
      await appSetValue(appControl<HTMLTextAreaElement>(app.container, 'Chat input'), 'I hold court at dawn and hear the petitioners.');
      await appClick(appButton(app.container, 'Speak'));
      await waitForApp(() => expect(loadThreadState().turnNumber).toBe(2));
      const week = loadThreadState();
      const entry = week.turnHistory.at(-1)!;
      // What the forum cried, each with the week's record of who acted in it.
      const occurrences = week.currentEvents.filter(headline => (entry.headlineActors ?? []).some(record => record.text === headline));
      expect(occurrences.length, `cried headlines with a record among ${JSON.stringify(week.currentEvents)}`).toBeGreaterThanOrEqual(2);
      expect((week.truthLedger ?? []).filter(record => record.investigation?.kind === 'occurrence')).toEqual([]);
      expectNoGmPrivateInTheDom(week, 'after the week');

      // --- Events: both questions, of each occurrence ------------------------
      await appClick(app.container.querySelector<HTMLElement>('#sidepanel-tab-events')!);
      for (const occurrence of occurrences) await askBoth(app, occurrence);

      const asked = loadThreadState();
      const knowledge = asked.knowledge ?? [];
      const ledgered = (asked.truthLedger ?? []).filter(record => record.investigation?.kind === 'occurrence');
      expect(ledgered).toHaveLength(2 * occurrences.length);
      const cameBackEmpty = new Set<boolean>();
      for (const occurrence of occurrences) {
        const slip = Array.from(app.container.querySelectorAll('.gor-card'))
          .find(card => card.querySelector('button[aria-expanded]')?.textContent?.includes(occurrence))!;

        // 1. The findings land in the tab, each under its own question, as the store holds them.
        const findings = occurrenceFindings(knowledge, occurrence);
        expect(findings.map(found => found.question).sort()).toEqual(['who_gains', 'who_is_behind_it']);
        const shown = Array.from(slip.querySelectorAll('.gor-finding')).map(finding => ({
          kicker: finding.querySelector('.gor-finding-kicker')?.textContent,
          body: finding.querySelector('.gor-finding-body')?.textContent,
        }));
        for (const { question, kicker, ask } of ASKED) {
          const held = findings.find(found => found.question === question)!;
          expect(held.text.trim().length).toBeGreaterThan(0);
          expect(shown).toContainEqual({ kicker, body: held.text });
          // Asked once: the question is not offered again.
          expect(Array.from(slip.querySelectorAll('button')).some(button => button.textContent?.trim() === ask)).toBe(false);
        }

        // 2. A truth-ledger entry for each, linked to its finding by the finding's claim key.
        const records = ASKED.map(({ question }) => {
          const record = ledgered.find(candidate => candidate.investigation!.occurrence === occurrence && candidate.investigation!.question === question);
          expect(record, `the ledger entry for ${question} of "${occurrence}"`).toBeDefined();
          expect(record!.aboutId).toBe('world');
          expect(record!.reportId).toBe(occurrenceClaimKey(occurrence, question));
          const claim = knowledge.find(candidate => candidate.claimKey === record!.reportId);
          expect(claim, `the finding ${record!.reportId} names`).toBeDefined();
          expect(record!.claim).toBe(claim!.updates.at(-1)!.text);
          return { record: record!, claim: claim! };
        });

        // 3. The two answers agree on whether anyone acted - on the ledger, and in the player's own findings.
        const [behind, gains] = records.map(({ record }) => record.investigation!.cameBackEmpty);
        expect(typeof behind).toBe('boolean');
        expect(gains).toBe(behind);
        expect(records.map(({ claim }) => claim.cameBackEmpty)).toEqual([behind, gains]);
        cameBackEmpty.add(behind!);
      }
      // Both outcomes were crossed: a hand named, and no one at all.
      expect([...cameBackEmpty].sort()).toEqual([false, true]);

      // 4. Nothing GM-private on the page, with every finding open on it.
      expectNoGmPrivateInTheDom(asked, 'after the questions');
    } finally {
      await app.unmount();
    }
  });
});
