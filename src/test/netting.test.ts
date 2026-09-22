import { describe, it, expect } from 'vitest';
import { computeNetObligations } from '../modules/netting';
import type { Trade } from '../store/types';

function makeTrade(
  id: string,
  pair: Trade['pair'],
  side: Trade['side'],
  qty: number,
  price: number,
): Trade {
  const base = pair.split('/')[0] as 'BTC' | 'ETH' | 'SOL';
  const baseNetwork = base === 'BTC' ? 'Bitcoin' : 'Ethereum';
  return {
    id,
    timestamp: new Date().toISOString(),
    pair,
    side,
    baseQuantity: qty,
    executedPrice: price,
    notionalUsdc: qty * price,
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    baseNetwork,
    quoteNetwork: 'Ethereum',
    batchId: 'B1',
    settlementStatus: 'unsettled',
    settlementNote: null,
    reconciliationReserved: false,
  };
}

describe('netting', () => {
  it('guided fixture nets to 940k USDC pay, 8 BTC receive, 100 ETH receive', () => {
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy',  10,  80_000),  // pay 800k, receive 10 BTC
      makeTrade('T2', 'ETH/USDC', 'buy', 100,   3_000),  // pay 300k, receive 100 ETH
      makeTrade('T3', 'BTC/USDC', 'sell',  2,  80_000),  // receive 160k, pay 2 BTC
    ];

    const obls = computeNetObligations(trades);

    const usdcPay = obls.find((o) => o.asset === 'USDC' && o.direction === 'pay');
    const btcReceive = obls.find((o) => o.asset === 'BTC' && o.direction === 'receive');
    const ethReceive = obls.find((o) => o.asset === 'ETH' && o.direction === 'receive');

    expect(usdcPay).toBeDefined();
    expect(usdcPay!.netAmount).toBe(940_000);  // 1,100,000 - 160,000

    expect(btcReceive).toBeDefined();
    expect(btcReceive!.netAmount).toBe(8);      // 10 - 2

    expect(ethReceive).toBeDefined();
    expect(ethReceive!.netAmount).toBe(100);    // 100 - 0
  });

  it('nets two buys of same asset correctly', () => {
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy', 5, 80_000),
      makeTrade('T2', 'BTC/USDC', 'buy', 3, 80_000),
    ];
    const obls = computeNetObligations(trades);
    const usdcPay = obls.find((o) => o.asset === 'USDC' && o.direction === 'pay');
    const btcReceive = obls.find((o) => o.asset === 'BTC' && o.direction === 'receive');

    expect(usdcPay!.netAmount).toBe(640_000);
    expect(btcReceive!.netAmount).toBe(8);
  });

  it('produces no obligations for zero net', () => {
    // Buy and sell same quantity at same price → net zero on each asset
    const trades = [
      makeTrade('T1', 'BTC/USDC', 'buy',  5, 80_000),
      makeTrade('T2', 'BTC/USDC', 'sell', 5, 80_000),
    ];
    const obls = computeNetObligations(trades);
    // BTC nets to zero (5-5=0), USDC nets to zero (400k-400k=0)
    expect(obls.length).toBe(0);
  });

  it('handles sell-only producing a USDC receive and base pay', () => {
    const trades = [makeTrade('T1', 'ETH/USDC', 'sell', 10, 3_000)];
    const obls = computeNetObligations(trades);

    const usdcRec = obls.find((o) => o.asset === 'USDC' && o.direction === 'receive');
    const ethPay = obls.find((o) => o.asset === 'ETH' && o.direction === 'pay');

    expect(usdcRec!.netAmount).toBe(30_000);
    expect(ethPay!.netAmount).toBe(10);
  });

  it('missing trade scenario: excluding sell changes obligations', () => {
    const t1 = makeTrade('T1', 'BTC/USDC', 'buy',  10, 80_000);
    const t2 = makeTrade('T2', 'ETH/USDC', 'buy', 100,  3_000);
    // t3 (sell 2 BTC) excluded

    const oblsBefore = computeNetObligations([t1, t2]);
    const usdcBefore = oblsBefore.find((o) => o.asset === 'USDC')!;
    const btcBefore  = oblsBefore.find((o) => o.asset === 'BTC')!;

    expect(usdcBefore.netAmount).toBe(1_100_000);  // 800k + 300k
    expect(usdcBefore.direction).toBe('pay');
    expect(btcBefore.netAmount).toBe(10);           // only buys, no sell
    expect(btcBefore.direction).toBe('receive');

    const t3 = makeTrade('T3', 'BTC/USDC', 'sell', 2, 80_000);
    const oblsAfter = computeNetObligations([t1, t2, t3]);
    const usdcAfter = oblsAfter.find((o) => o.asset === 'USDC')!;
    const btcAfter  = oblsAfter.find((o) => o.asset === 'BTC')!;

    expect(usdcAfter.netAmount).toBe(940_000);
    expect(btcAfter.netAmount).toBe(8);
  });
});
