import { describe, it, expect } from 'vitest';
import { computeUsedCredit, computeAvailableCredit, APPROVED_LIMIT } from '../modules/creditPolicy';
import type { Trade, SettlementBatch } from '../store/types';

// ── Minimal mock helpers matching the current type shapes ─────────

function mockTrade(id: string, notional: number, batchId: string | null): Trade {
  return {
    id,
    timestamp: new Date().toISOString(),
    pair: 'BTC/USDC',
    side: 'buy',
    baseQuantity: 1,
    executedPrice: notional,
    notionalUsdc: notional,
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    baseNetwork: 'Bitcoin',
    quoteNetwork: 'Ethereum',
    batchId,
    settlementStatus: 'unsettled',
    settlementNote: null,
    reconciliationReserved: false,
  };
}

function mockBatch(id: string, status: SettlementBatch['status']): SettlementBatch {
  return {
    id,
    name: null,
    revision: 1,
    status,
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    dueTime: new Date(Date.now() + 86_400_000).toISOString(),
    nettingArrangement: 'Bilateral netting',
    tradeIds: [],
    sealedTradeIds: null,
    obligations: [],
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    approvedRevision: null,
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

// ── Tests ─────────────────────────────────────────────────────────

describe('creditPolicy', () => {
  it('starts at zero used credit with no trades', () => {
    expect(computeUsedCredit([], [])).toBe(0);
    expect(computeAvailableCredit([], [])).toBe(APPROVED_LIMIT);
  });

  it('accumulates credit from multiple batched trades', () => {
    const trades = [
      mockTrade('T1', 800_000, 'B1'),
      mockTrade('T2', 300_000, 'B1'),
      mockTrade('T3', 160_000, 'B1'),
    ];
    const batches = [mockBatch('B1', 'needs-review')];

    expect(computeUsedCredit(trades, batches)).toBe(1_260_000);
    expect(computeAvailableCredit(trades, batches)).toBe(740_000);
  });

  it('unbatched trades (batchId: null) consume credit', () => {
    const trades = [
      mockTrade('T1', 800_000, null),
      mockTrade('T2', 300_000, null),
    ];
    expect(computeUsedCredit(trades, [])).toBe(1_100_000);
    expect(computeAvailableCredit(trades, [])).toBe(900_000);
  });

  it('releases credit only when batch is settled', () => {
    const trades = [mockTrade('T1', 800_000, 'B1')];

    for (const status of ['needs-review', 'pending-approval', 'awaiting-payment', 'partially-settled', 'awaiting-reconciliation', 'disputed'] as SettlementBatch['status'][]) {
      const b = mockBatch('B1', status);
      expect(computeUsedCredit(trades, [b])).toBe(800_000);
    }

    const batchSettled = mockBatch('B1', 'settled');
    expect(computeUsedCredit(trades, [batchSettled])).toBe(0);
    expect(computeAvailableCredit(trades, [batchSettled])).toBe(APPROVED_LIMIT);
  });

  it('retains credit from unsettled batches when one settles', () => {
    const trades = [
      mockTrade('T1', 500_000, 'B1'),
      mockTrade('T2', 300_000, 'B2'),
    ];
    const batches = [mockBatch('B1', 'settled'), mockBatch('B2', 'awaiting-payment')];
    expect(computeUsedCredit(trades, batches)).toBe(300_000);
    expect(computeAvailableCredit(trades, batches)).toBe(APPROVED_LIMIT - 300_000);
  });

  it('guided fixture totals match brief', () => {
    // Step 1: Buy 10 BTC @ 80,000 = 800,000
    // Step 2: Buy 100 ETH @ 3,000 = 300,000
    // Step 3: Sell 2 BTC @ 80,000 = 160,000
    // Total used = 1,260,000, available = 740,000
    const trades = [
      mockTrade('T1', 800_000, 'B1'),
      mockTrade('T2', 300_000, 'B1'),
      mockTrade('T3', 160_000, 'B1'),
    ];
    expect(computeUsedCredit(trades, [mockBatch('B1', 'needs-review')])).toBe(1_260_000);
    expect(computeAvailableCredit(trades, [mockBatch('B1', 'needs-review')])).toBe(740_000);
  });

  it('blocked trade does not increase used credit', () => {
    // After block, credit stays the same — no new trade is recorded
    const trades = [
      mockTrade('T1', 800_000, 'B1'),
      mockTrade('T2', 300_000, 'B1'),
      mockTrade('T3', 160_000, 'B1'),
    ];
    const batches = [mockBatch('B1', 'needs-review')];
    // 800,000 buy attempt is blocked — credit stays at 1,260,000
    expect(computeUsedCredit(trades, batches)).toBe(1_260_000);
  });

  it('awaiting-reconciliation status still blocks credit release', () => {
    const trades = [mockTrade('T1', 400_000, 'B1')];
    const batch  = mockBatch('B1', 'awaiting-reconciliation');
    expect(computeUsedCredit(trades, [batch])).toBe(400_000);
  });

  it('mixed unbatched + batched: unbatched always consume credit', () => {
    const trades = [
      mockTrade('T1', 200_000, 'B1'),  // batched + settled → released
      mockTrade('T2', 100_000, null),  // unbatched → always consumed
    ];
    const batches = [mockBatch('B1', 'settled')];
    expect(computeUsedCredit(trades, batches)).toBe(100_000);
  });
});
