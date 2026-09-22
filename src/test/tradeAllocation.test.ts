/**
 * Trade-level settlement allocation tests
 *
 * Verifies the FIFO netting-offset and FIFO payment-allocation logic that
 * drives per-trade settlement status, including the guided demo scenario.
 */

import { describe, it, expect } from 'vitest';
import { computePerTradeExternals, deriveTradeStatuses } from '../modules/tradeAllocation';
import { computeNetObligations } from '../modules/netting';
import type { Trade, SettlementBatch, Asset, Obligation } from '../store/types';

// ── Helpers ───────────────────────────────────────────────────────

/** Trades get strictly increasing timestamps so FIFO order is deterministic. */
function makeTrade(
  id: string,
  pair: Trade['pair'],
  side: Trade['side'],
  qty: number,
  price: number,
  minuteOffset: number,
): Trade {
  const base = pair.split('/')[0];
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 8, 21, 9, minuteOffset, 0)).toISOString(),
    pair,
    side,
    baseQuantity: qty,
    executedPrice: price,
    notionalUsdc: qty * price,
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    baseNetwork: base === 'BTC' ? 'Bitcoin' : 'Ethereum',
    quoteNetwork: 'Ethereum',
    batchId: 'B1',
    settlementStatus: 'unsettled',
    settlementNote: null,
    reconciliationReserved: false,
  };
}

/**
 * Build a batch whose obligations come from the real netting module, then
 * apply the given verified amounts so allocation runs against real numbers.
 */
function makeBatch(
  trades: Trade[],
  verified: Partial<Record<string, number>> = {},
): SettlementBatch {
  const obligations: Obligation[] = computeNetObligations(trades, 'B1', 1).map((o) => {
    const key            = `${o.asset}:${o.direction}`;
    const verifiedAmount = verified[key] ?? 0;
    return {
      ...o,
      verifiedAmount,
      remainingAmount: Math.max(0, o.netAmount - verifiedAmount),
      status:
        verifiedAmount >= o.netAmount - 1e-9 ? 'complete'
        : verifiedAmount > 0                 ? 'partial'
        :                                      'outstanding',
    };
  });

  return {
    id: 'B1',
    name: null,
    revision: 1,
    status: 'awaiting-payment',
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    dueTime: new Date().toISOString(),
    nettingArrangement: 'Bilateral netting',
    tradeIds: trades.map((t) => t.id),
    sealedTradeIds: null,
    obligations,
    submittedBy: null, submittedAt: null,
    approvedBy: null, approvedAt: null, approvedRevision: null,
    disputeInfo: null,
    reconciledAt: null,
    creditUpdatePending: false,
    settlementCycle: 1,
    revisionHistory: [],
    activityTimeline: [],
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    isMissingTradeScenario: false,
    missingTradeId: null,
  };
}

function extOf(externals: ReturnType<typeof computePerTradeExternals>, tradeId: string, asset: Asset) {
  return externals.find((e) => e.tradeId === tradeId && e.asset === asset);
}

// The guided demo scenario, used across several tests.
function demoTrades() {
  return [
    makeTrade('T1', 'BTC/USDC', 'buy',   10, 80_000, 0),  // pay 800k, receive 10 BTC
    makeTrade('T2', 'ETH/USDC', 'buy',  100,  3_000, 1),  // pay 300k, receive 100 ETH
    makeTrade('T3', 'BTC/USDC', 'sell',   2, 80_000, 2),  // receive 160k, pay 2 BTC
  ];
}

// ── Netting-offset computation ─────────────────────────────────────

describe('computePerTradeExternals', () => {
  it('absorbs the sell offset into the earliest paying trade (FIFO)', () => {
    const externals = computePerTradeExternals(demoTrades());

    // USDC is net PAY (1,100,000 out vs 160,000 in → 940,000 net).
    // The 160,000 receive offset is absorbed by T1 first.
    expect(extOf(externals, 'T1', 'USDC')!.externalAmount).toBe(640_000); // 800k − 160k
    expect(extOf(externals, 'T2', 'USDC')!.externalAmount).toBe(300_000); // untouched
    expect(extOf(externals, 'T3', 'USDC')!.isFullyNetted).toBe(true);

    // BTC is net RECEIVE (10 in vs 2 out → 8 net). T3's 2 BTC pay is netted
    // into T1's receive leg.
    expect(extOf(externals, 'T1', 'BTC')!.externalAmount).toBe(8);
    expect(extOf(externals, 'T3', 'BTC')!.isFullyNetted).toBe(true);

    // ETH has no offsetting leg.
    expect(extOf(externals, 'T2', 'ETH')!.externalAmount).toBe(100);
  });

  it('per-trade externals sum to the batch net obligations', () => {
    const trades    = demoTrades();
    const externals = computePerTradeExternals(trades);
    const obls      = computeNetObligations(trades, 'B1', 1);

    for (const obl of obls) {
      const summed = externals
        .filter((e) => e.asset === obl.asset && e.direction === obl.direction)
        .reduce((s, e) => s + e.externalAmount, 0);
      expect(summed).toBeCloseTo(obl.netAmount, 8);
    }
  });

  it('marks every leg fully netted when an asset nets to exactly zero', () => {
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy',  5, 80_000, 0),
      makeTrade('T2', 'BTC/USDC', 'sell', 5, 80_000, 1),
    ];
    const externals = computePerTradeExternals(trades);
    expect(externals.every((e) => e.isFullyNetted)).toBe(true);
    expect(externals.every((e) => e.externalAmount === 0)).toBe(true);
  });

  it('spills the offset into the second payer when the first cannot absorb it all', () => {
    // Two small buys and one large sell: the sell's 400k receive exceeds
    // T1's 80k pay, so the remainder must spill into T2.
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy',   1, 80_000, 0),  // pay 80k
      makeTrade('T2', 'BTC/USDC', 'buy',  10, 80_000, 1),  // pay 800k
      makeTrade('T3', 'BTC/USDC', 'sell',  5, 80_000, 2),  // receive 400k
    ];
    const externals = computePerTradeExternals(trades);

    // T1 fully absorbed (80k of the 400k offset), T2 absorbs the remaining 320k.
    expect(extOf(externals, 'T1', 'USDC')!.externalAmount).toBe(0);
    expect(extOf(externals, 'T1', 'USDC')!.isFullyNetted).toBe(true);
    expect(extOf(externals, 'T2', 'USDC')!.externalAmount).toBe(480_000); // 800k − 320k
  });

  it('handles a sell-only batch (USDC receive, base pay)', () => {
    const trades    = [makeTrade('T1', 'ETH/USDC', 'sell', 10, 3_000, 0)];
    const externals = computePerTradeExternals(trades);

    expect(extOf(externals, 'T1', 'USDC')!.direction).toBe('receive');
    expect(extOf(externals, 'T1', 'USDC')!.externalAmount).toBe(30_000);
    expect(extOf(externals, 'T1', 'ETH')!.direction).toBe('pay');
    expect(extOf(externals, 'T1', 'ETH')!.externalAmount).toBe(10);
  });

  it('returns nothing for an empty trade list', () => {
    expect(computePerTradeExternals([])).toEqual([]);
  });
});

// ── Status derivation across the demo payment sequence ─────────────

describe('deriveTradeStatuses — guided demo sequence', () => {
  it('all unsettled before any payment is verified', () => {
    const trades   = demoTrades();
    const statuses = deriveTradeStatuses(trades, makeBatch(trades));

    expect(statuses.get('T1')!.status).toBe('unsettled');
    expect(statuses.get('T2')!.status).toBe('unsettled');
    expect(statuses.get('T3')!.status).toBe('unsettled');
    // T3 is fully netted, so it carries an explanatory note.
    expect(statuses.get('T3')!.note).toMatch(/netted/i);
  });

  it('first 470,000 USDC partially settles only T1 (FIFO)', () => {
    const trades   = demoTrades();
    const statuses = deriveTradeStatuses(trades, makeBatch(trades, { 'USDC:pay': 470_000 }));

    // T1's external USDC leg is 640k, so 470k covers part of it.
    expect(statuses.get('T1')!.status).toBe('partially-settled');
    // T2 sits behind T1 in the FIFO queue and receives nothing.
    expect(statuses.get('T2')!.status).toBe('unsettled');
    expect(statuses.get('T3')!.status).toBe('unsettled');
  });

  it('full 940,000 USDC leaves both buys partial — asset legs still outstanding', () => {
    const trades   = demoTrades();
    const statuses = deriveTradeStatuses(trades, makeBatch(trades, { 'USDC:pay': 940_000 }));

    // T1 got 640k (its whole USDC leg) but still awaits 8 BTC.
    expect(statuses.get('T1')!.status).toBe('partially-settled');
    // T2 got 300k but still awaits 100 ETH.
    expect(statuses.get('T2')!.status).toBe('partially-settled');
  });

  it('settles T1 once USDC and BTC are both covered', () => {
    const trades   = demoTrades();
    const statuses = deriveTradeStatuses(
      trades,
      makeBatch(trades, { 'USDC:pay': 940_000, 'BTC:receive': 8 }),
    );

    expect(statuses.get('T1')!.status).toBe('settled');
    expect(statuses.get('T2')!.status).toBe('partially-settled'); // ETH outstanding
  });

  it('settles every trade once all obligations are covered and the batch completes', () => {
    const trades = demoTrades();
    const batch  = makeBatch(trades, {
      'USDC:pay': 940_000, 'BTC:receive': 8, 'ETH:receive': 100,
    });

    // Before completion the fully-netted trade is still pending.
    const pending = deriveTradeStatuses(trades, batch, false);
    expect(pending.get('T1')!.status).toBe('settled');
    expect(pending.get('T2')!.status).toBe('settled');
    expect(pending.get('T3')!.status).toBe('unsettled');

    // batchComplete promotes the fully-netted trade.
    const complete = deriveTradeStatuses(trades, batch, true);
    expect(complete.get('T3')!.status).toBe('settled');
    expect(complete.get('T3')!.note).toBe('Settled via netting.');
  });
});

// ── Edge cases ────────────────────────────────────────────────────

describe('deriveTradeStatuses — edge cases', () => {
  it('ignores trades that are not members of the batch', () => {
    const trades  = demoTrades();
    const outside = makeTrade('T9', 'SOL/USDC', 'buy', 50, 200, 5);
    const batch   = makeBatch(trades); // tradeIds covers T1–T3 only

    const statuses = deriveTradeStatuses([...trades, outside], batch);
    expect(statuses.has('T9')).toBe(false);
    expect(statuses.size).toBe(3);
  });

  it('partial coverage of an asset leg keeps the trade partial, not settled', () => {
    const trades   = demoTrades();
    // 7 of the 8 BTC received — T1 must not be reported as settled.
    const statuses = deriveTradeStatuses(
      trades,
      makeBatch(trades, { 'USDC:pay': 940_000, 'BTC:receive': 7 }),
    );
    expect(statuses.get('T1')!.status).toBe('partially-settled');
  });

  it('does not over-allocate when verified exceeds the amount due', () => {
    const trades = demoTrades();
    // Deliberately over-verify: no trade should be double-counted or error.
    const statuses = deriveTradeStatuses(
      trades,
      makeBatch(trades, { 'USDC:pay': 5_000_000, 'BTC:receive': 99, 'ETH:receive': 999 }),
    );
    expect(statuses.get('T1')!.status).toBe('settled');
    expect(statuses.get('T2')!.status).toBe('settled');
  });

  it('a fully-netted batch settles all trades only on completion', () => {
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy',  5, 80_000, 0),
      makeTrade('T2', 'BTC/USDC', 'sell', 5, 80_000, 1),
    ];
    const batch = makeBatch(trades); // nets to zero → no obligations
    expect(batch.obligations.length).toBe(0);

    const pending = deriveTradeStatuses(trades, batch, false);
    expect(pending.get('T1')!.status).toBe('unsettled');
    expect(pending.get('T2')!.status).toBe('unsettled');

    const complete = deriveTradeStatuses(trades, batch, true);
    expect(complete.get('T1')!.status).toBe('settled');
    expect(complete.get('T2')!.status).toBe('settled');
  });

  it('handles an empty batch without throwing', () => {
    const batch = makeBatch([]);
    expect(deriveTradeStatuses([], batch).size).toBe(0);
  });

  it('allocates strictly FIFO across three same-direction payers', () => {
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy', 1, 100_000, 0),
      makeTrade('T2', 'BTC/USDC', 'buy', 1, 100_000, 1),
      makeTrade('T3', 'BTC/USDC', 'buy', 1, 100_000, 2),
    ];
    // 250k of the 300k USDC due, and all 3 BTC received.
    const statuses = deriveTradeStatuses(
      trades,
      makeBatch(trades, { 'USDC:pay': 250_000, 'BTC:receive': 3 }),
    );

    // T1 and T2 fully covered on USDC; T3 gets the remaining 50k.
    expect(statuses.get('T1')!.status).toBe('settled');
    expect(statuses.get('T2')!.status).toBe('settled');
    expect(statuses.get('T3')!.status).toBe('partially-settled');
  });
});
