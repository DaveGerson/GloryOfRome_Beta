/**
 * tests/exchequer.test.ts
 *
 * The exchequer (BACKLOG.md B1 landed; DESIGN_DECISIONS.md D46,
 * ai/core/exchequer.ts): the code-side exchange table that trades one
 * holding for another at a stated rate, in lots, with friction. Pins the
 * table's integrity, the quotes, the affordability ceiling, every refusal,
 * the pay-down and delayed-levy paths, and purity.
 */
import { describe, it, expect } from 'vitest';
import {
  EXCHANGE_IDS,
  EXCHANGE_TABLE,
  INVESTIGATION_PRICE_DENARII,
  applyExchange,
  getExchangeEntry,
  isExchangeId,
  maxAffordableLots,
  quoteExchange,
  type ExchangeId,
} from '../ai/core/exchequer';
import { investigationCap } from '../ai/core/ledger';

describe('exchequer - the table', () => {
  it('lists exactly the ids it offers, each once, every one gated by isExchangeId', () => {
    expect(EXCHANGE_TABLE.map(entry => entry.id)).toEqual([...EXCHANGE_IDS]);
    expect(new Set(EXCHANGE_IDS).size).toBe(EXCHANGE_IDS.length);
    for (const id of EXCHANGE_IDS) expect(isExchangeId(id)).toBe(true);
    expect(isExchangeId('mint_denarii')).toBe(false);
    expect(isExchangeId(42)).toBe(false);
  });

  it('prices an investigation at the figure the D27 refresh curve grades from', () => {
    expect(INVESTIGATION_PRICE_DENARII).toBe(1500);
    expect(getExchangeEntry('hire_informants').spend).toEqual({ key: 'denarii', perLot: INVESTIGATION_PRICE_DENARII });
  });

  it('throws for an id outside the table rather than quoting nothing', () => {
    expect(() => getExchangeEntry('mint_denarii' as ExchangeId)).toThrow("exchequer: unknown exchange 'mint_denarii'");
  });
});

describe('exchequer - quotes and ceilings', () => {
  it('quotes lots against the rate, naming the mustering key for a delayed levy', () => {
    expect(quoteExchange(getExchangeEntry('hire_informants'), 2)).toEqual({
      spendKey: 'denarii', spendAmount: 3000, gainKey: 'investigations', gainAmount: 2, delayed: false,
    });
    expect(quoteExchange(getExchangeEntry('recruit_troops'), 10)).toEqual({
      spendKey: 'denarii', spendAmount: 600, gainKey: 'levy_pending', gainAmount: 10, delayed: true,
    });
    expect(quoteExchange(getExchangeEntry('repay_debt'), 250)).toMatchObject({ gainKey: 'debt_denarii', gainAmount: 250 });
  });

  it('bounds informants by the investigations ceiling the agents support, not by coin alone', () => {
    const informants = getExchangeEntry('hire_informants');
    expect(maxAffordableLots(informants, { denarii: 30000, investigations: 0 })).toBe(investigationCap({}));
    expect(maxAffordableLots(informants, { denarii: 30000, investigations: 0, agents: 6 })).toBe(investigationCap({ agents: 6 }));
    expect(maxAffordableLots(informants, { denarii: 30000, investigations: 2 })).toBe(0);
    expect(maxAffordableLots(informants, { denarii: 1499, investigations: 0 })).toBe(0);
  });

  it('returns zero when even the minimum lot is out of reach', () => {
    expect(maxAffordableLots(getExchangeEntry('recruit_troops'), { denarii: 500 })).toBe(0); // 8 heads < a lot of ten
    expect(maxAffordableLots(getExchangeEntry('recruit_troops'), { denarii: 600 })).toBe(10);
    expect(maxAffordableLots(getExchangeEntry('repay_debt'), { denarii: 10000, debt_denarii: 250 })).toBe(250);
    expect(maxAffordableLots(getExchangeEntry('repay_debt'), { denarii: 10000, debt_denarii: 50 })).toBe(0); // under the 100 minimum
    expect(maxAffordableLots(getExchangeEntry('sell_estates'), { estates: 0 })).toBe(0);
  });
});

describe('exchequer - applyExchange', () => {
  it('strikes a bargain on a new bag and leaves the input untouched', () => {
    const bag = { denarii: 5000, investigations: 0 };
    const snapshot = { ...bag };
    const result = applyExchange(bag, 'hire_informants', 2);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a struck bargain');
    expect(result.resources).toEqual({ denarii: 2000, investigations: 2 });
    expect(result.receipt).toBe('3,000 denarii for 2 investigations.');
    expect(bag).toEqual(snapshot);
  });

  it('refuses a fractional lot, a lot under the minimum, an unaffordable lot, and a lot over the ceiling', () => {
    expect(applyExchange({ denarii: 5000 }, 'hire_informants', 1.5)).toEqual({ ok: false, reason: 'lots_not_whole' });
    expect(applyExchange({ denarii: 5000 }, 'recruit_troops', 5)).toEqual({ ok: false, reason: 'lots_below_minimum' });
    expect(applyExchange({ denarii: 1000 }, 'hire_informants', 1)).toEqual({ ok: false, reason: 'cannot_afford' });
    expect(applyExchange({ denarii: 30000, investigations: 2 }, 'hire_informants', 1)).toEqual({ ok: false, reason: 'over_ceiling' });
    expect(applyExchange({ denarii: 30000, debt_denarii: 500 }, 'repay_debt', 600)).toEqual({ ok: false, reason: 'over_ceiling' });
  });

  it('pays a debt or back pay down at par and retires the key once nothing is owed', () => {
    const repaid = applyExchange({ denarii: 4000, debt_denarii: 2777 }, 'repay_debt', 2777);
    if (!repaid.ok) throw new Error('expected repayment');
    expect(repaid.resources).toEqual({ denarii: 1223 });
    expect(repaid.receipt).toBe('2,777 denarii paid against debt_denarii.');

    const partial = applyExchange({ denarii: 4000, pay_arrears: 900 }, 'pay_arrears', 400);
    if (!partial.ok) throw new Error('expected a partial settlement');
    expect(partial.resources).toEqual({ denarii: 3600, pay_arrears: 500 });
  });

  it('credits a levy to the mustering key for the ledger to land next week', () => {
    const levy = applyExchange({ denarii: 1000, troops: 5 }, 'recruit_troops', 10);
    if (!levy.ok) throw new Error('expected a levy');
    expect(levy.resources).toEqual({ denarii: 400, troops: 5, levy_pending: 10 });
    expect(levy.quote.delayed).toBe(true);
    expect(levy.receipt).toBe('600 denarii for 10 troops, mustering until next week.');
  });

  it('turns a favour into an inquiry, three inquiries into an assessment, and an estate into a distress sale', () => {
    const favour = applyExchange({ favors: 1, investigations: 0 }, 'call_in_favors', 1);
    if (!favour.ok) throw new Error('expected a favour called in');
    expect(favour.resources).toEqual({ favors: 0, investigations: 1 });

    const deep = applyExchange({ investigations: 3 }, 'commission_deep_analysis', 1);
    if (!deep.ok) throw new Error('expected a commission');
    expect(deep.resources).toEqual({ investigations: 0, deep_analyses: 1 });

    const sale = applyExchange({ estates: 2, denarii: 0 }, 'sell_estates', 1);
    if (!sale.ok) throw new Error('expected a sale');
    expect(sale.resources).toEqual({ estates: 1, denarii: 9000 });
  });
});
