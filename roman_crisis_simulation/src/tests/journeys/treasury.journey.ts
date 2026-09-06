// @vitest-environment jsdom
/**
 * tests/journeys/treasury.journey.ts
 *
 * The treasury journey (DESIGN_DECISIONS.md D46): four weeks of the REAL
 * pipeline in which the Emperor pays a donative he cannot afford, is
 * bankrupted by a bribe, is handed a windfall the books refuse to believe,
 * and buys his way back to solvency at the exchequer - proving the economy
 * is a system with memory rather than improvised prose.
 *
 * Story-specific guards (the catalog invariants - INV-LEAK above all - run
 * every turn for free; every `[Ledger]` and `[Economy]` GM note is a
 * forbidden token on every player surface):
 *  - the weekly ledger is its own engine step AFTER the adjudication: the
 *    estates pay, the household guard is paid, investigations regenerate,
 *    legion support drifts under a Divided army - and every line rides the
 *    committed history entry, never `adjudication.deltas`;
 *  - an overdraft becomes debt (D6), debt compounds when the treasury cannot
 *    service it, unpaid wages become back pay that erodes standing;
 *  - an UNSOURCED windfall is clamped by the conservation guard (T1's
 *    guardrail) with a GM-only note, and the smaller gain still commits;
 *  - the exchequer (B1) commits a distress sale and two pay-downs through
 *    the same pure function App.tsx's handleExchange applies;
 *  - the ledger persists through the real save seam, and the Assets tab's
 *    derivations read the reloaded thread to the denarius.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { JourneyRunner, clearSave, loadThreadState, saveThread, threadFromSave } from './harness';
import { resourceDelta, scriptAdjudication } from './fixtures';
import { applyExchange } from '../../ai/core/exchequer';
import { holdingsInventory, projectTreasury, weekLedgerView } from '../../components/tabs/ledgerView';
import { runwayLine } from '../../components/tabs/ResourcesTab';
import type { Entity, LedgerLine } from '../../types';

const PLAYER = 'severus_alexander';

const kinds = (lines: LedgerLine[] | undefined) => (lines ?? []).map(line => line.kind);
const bag = (entity: Entity) => entity.resources as Record<string, number>;

describe('journey: the treasury (four weeks of an Emperor living beyond his means)', () => {
  afterEach(() => {
    clearSave();
  });

  it('pays wages, converts overdraft to debt, refuses unsourced coin, and lets the exchequer restore solvency - all of it persisted', async () => {
    const runner = new JourneyRunner({ name: 'treasury' });

    // Baseline: the real seed. Two estates nearly carry a 150-man household guard and three agents.
    expect(bag(runner.player())).toMatchObject({ denarii: 50000, estates: 2, guards: 150, agents: 3, investigations: 1, legion_support: 35 });
    const seed = projectTreasury(runner.player().resources);
    expect(seed.flow.net).toBe(1200 - 1845);

    // --- Turn 1: a donative the treasury cannot really afford --------------
    const t1 = await runner.runTurn({
      intent: 'Pay the Praetorian cohorts a donative of forty-seven thousand denarii.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(1, {
          deltas: [
            resourceDelta(PLAYER, 'denarii', -47000, 'A donative of 47,000 denarii is paid out to the Praetorian cohorts.'),
            resourceDelta(PLAYER, 'legion_support', 10, 'The cohorts cheer the donative.'),
          ],
          headlines: ['The Emperor showers the Praetorians with silver.'],
        }),
      },
    });

    // The books closed AFTER the donative: yields in, wages out, an inquiry back, the Divided army's drift.
    expect(kinds(t1.entry.ledger)).toEqual(['income', 'upkeep', 'regen', 'drift']);
    expect(t1.entry.adjudication.deltas.some(delta => delta.reason.includes('wages'))).toBe(false);
    expect(bag(runner.player())).toMatchObject({ denarii: 50000 - 47000 + 1200 - 1845, investigations: 2, legion_support: 35 + 10 - 1 });
    expect(runner.player().resources.pay_arrears).toBeUndefined();
    // Only the engine's own low-treasury notice this week - the ledger raises no report on a paid week.
    expect(runner.thread.reports).toHaveLength(1);
    expect(runner.thread.reports[0].claim).toContain('fallen below 5000 denarii');
    expect(t1.entry.adjudication.gm_private.some(note => note.startsWith('[Ledger] Week closed: net -645 denarii'))).toBe(true);
    expect(t1.entry.adjudication.gm_private.some(note => note.startsWith('[Economy]'))).toBe(false);
    // The runway the Assets tab would state: floor(2,355 / 645) = 3 weeks.
    expect(projectTreasury(runner.player().resources).runway).toBe(3);

    // --- Turn 2: a bribe overdraws the treasury ----------------------------
    const reportsBeforeT2 = runner.thread.reports.length;
    const t2 = await runner.runTurn({
      intent: 'Buy the urban prefect with five thousand denarii.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(2, {
          deltas: [resourceDelta(PLAYER, 'denarii', -5000, 'A bribe of 5,000 denarii to the urban prefect.')],
          headlines: ['The urban prefect is seen leaving the palace with a heavy purse.'],
        }),
      },
    });

    // The adjudicator saw last week's books before pricing this one (the ledger prompt block).
    const t2Prompt = t2.client.promptsFor('adjudication')[0];
    expect(t2Prompt).toContain('PLAYER HOLDINGS & LEDGER');
    expect(t2Prompt).toContain('Your 2 estates return 1,200 denarii.');

    // Overdraft -> debt (D6); the week then books income, a partial wage, back pay, capitalised interest,
    // the erosion the back pay costs, the regenerated inquiry, and the drift.
    expect(kinds(t2.entry.ledger)).toEqual(['income', 'upkeep', 'arrears', 'interest', 'drift', 'regen', 'drift']);
    expect(t2.entry.ledger?.find(line => line.kind === 'interest')).toMatchObject({ key: 'debt_denarii', amount: 132 });
    expect(bag(runner.player())).toMatchObject({
      denarii: 0,
      debt_denarii: 2645 + 132,
      pay_arrears: 1845 - 1200,
      investigations: 3,
      legion_support: 44 - 4 - 1,
    });
    const t2Reports = runner.thread.reports.slice(reportsBeforeT2);
    expect(t2Reports.map(report => report.source)).toEqual(['merchant', 'messenger']);
    expect(t2Reports[0].claim).toContain('shortfall of 2645 denarii is owed to your creditors');
    expect(t2Reports[1].claim).toContain('645 denarii of wages unpaid this week');

    // --- Turn 3: a windfall the books refuse to believe --------------------
    const reportsBeforeT3 = runner.thread.reports.length;
    const t3 = await runner.runTurn({
      intent: 'Receive the tribute of the grateful provinces.',
      rolls: [],
      script: {
        adjudication: scriptAdjudication(3, {
          deltas: [resourceDelta(PLAYER, 'denarii', 30000, 'A grateful province sends tribute.')],
          headlines: ['Wagons from the provinces roll into the treasury yards.'],
        }),
      },
    });

    // The adjudicator was told the men are owed (BACK PAY OWED) and the debt stands.
    const t3Prompt = t3.client.promptsFor('adjudication')[0];
    expect(t3Prompt).toContain('BACK PAY OWED');
    expect(t3Prompt).toContain('Debt stands at 2,777 denarii');

    // No payer lost it, no creditor lent it, no standing was spent: the guard clamps 30,000 to the
    // free allowance (the treasury is empty, so half of it is nothing) and records why GM-side.
    const tribute = t3.entry.adjudication.deltas.find(delta => delta.key === `${PLAYER}:denarii`);
    expect(tribute?.delta).toBe(2000);
    expect(t3.entry.adjudication.gm_private).toContainEqual(
      expect.stringMatching(/^\[Economy\] Clamped an unsourced treasury gain of 30,000 denarii to 2,000 /),
    );
    // The smaller gain still commits, the interest is serviced this week, the back pay keeps biting.
    expect(kinds(t3.entry.ledger)).toEqual(['income', 'upkeep', 'interest', 'drift', 'drift']);
    expect(bag(runner.player())).toMatchObject({
      denarii: 2000 + 1200 - 1845 - 139,
      debt_denarii: 2777,
      pay_arrears: 645,
      legion_support: 39 - 4 - 1,
    });
    expect(runner.thread.reports.slice(reportsBeforeT3)).toEqual([]);

    // --- Between turns: the exchequer (B1), as App.tsx's handleExchange applies it -----
    const sale = applyExchange(runner.player().resources, 'sell_estates', 1);
    if (!sale.ok) throw new Error(`sale refused: ${sale.reason}`);
    const settled = applyExchange(sale.resources, 'pay_arrears', 645);
    if (!settled.ok) throw new Error(`settlement refused: ${settled.reason}`);
    const repaid = applyExchange(settled.resources, 'repay_debt', 2777);
    if (!repaid.ok) throw new Error(`repayment refused: ${repaid.reason}`);
    expect(applyExchange(settled.resources, 'repay_debt', 50)).toEqual({ ok: false, reason: 'lots_below_minimum' });
    runner.thread.entities = runner.thread.entities.map(entity =>
      entity.entity_id === PLAYER ? { ...entity, resources: repaid.resources } : entity,
    );
    expect(bag(runner.player())).toMatchObject({ denarii: 1216 + 9000 - 645 - 2777, estates: 1 });
    expect(runner.player().resources.debt_denarii).toBeUndefined();
    expect(runner.player().resources.pay_arrears).toBeUndefined();

    // --- Turn 4: a quiet week on one estate ---------------------------------
    const reportsBeforeT4 = runner.thread.reports.length;
    const t4 = await runner.runTurn({ intent: 'Hold court and let the week pass.', rolls: [] });

    expect(kinds(t4.entry.ledger)).toEqual(['income', 'upkeep', 'drift']);
    expect(bag(runner.player())).toMatchObject({ denarii: 6794 + 600 - 1845, estates: 1, investigations: 3, legion_support: 33 });
    expect(runner.thread.reports.slice(reportsBeforeT4)).toEqual([]);
    expect(t4.entry.adjudication.gm_private.some(note => note.startsWith('[Economy]'))).toBe(false);

    // The steward's lines reach the narrator as the player's own knowledge, not the GM notes.
    for (const outcome of runner.outcomes) {
      const narrationPrompt = outcome.client.promptsFor('narration')[0];
      for (const line of outcome.entry.ledger ?? []) expect(narrationPrompt).toContain(line.text);
    }

    // --- The reign persists, ledger and all, through the real save seam ------
    saveThread(runner.thread);
    const loaded = loadThreadState();
    expect(loaded.turnHistory.map(entry => entry.ledger?.length)).toEqual([4, 7, 5, 3]);
    expect(loaded.turnHistory[1].ledger).toEqual(t2.entry.ledger);
    const resumed = threadFromSave(loaded);
    const reloadedPlayer = resumed.entities.find(entity => entity.entity_id === PLAYER)!;
    expect(reloadedPlayer.resources).toEqual(runner.player().resources);

    // ...and the Assets tab's derivations read the reloaded thread to the denarius.
    const week = weekLedgerView(loaded.turnHistory[loaded.turnHistory.length - 1], PLAYER)!;
    expect(week.lines).toHaveLength(3);
    expect(week.dealings).toEqual([]);
    expect(week.netDenarii).toBe(600 - 1845);
    const projection = projectTreasury(reloadedPlayer.resources);
    expect(projection.flow.net).toBe(600 - 1845);
    expect(projection.runway).toBe(4);
    expect(runwayLine(projection.runway, projection.flow.net, projection.treasury)).toBe('At this rate your treasury lasts IV weeks.');
    const inventory = holdingsInventory(reloadedPlayer, loaded.turnHistory);
    expect(inventory.map(row => [row.key, row.count, row.sinceTurn])).toEqual([
      ['guards', 150, undefined],
      ['agents', 3, undefined],
      ['estates', 1, undefined],
    ]);
  });
});
