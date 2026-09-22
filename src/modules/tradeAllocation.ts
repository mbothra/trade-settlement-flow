/**
 * Trade-level Settlement Allocation
 *
 * Derives per-trade settlement status from batch-level verified payments,
 * using FIFO netting offset computation and FIFO payment allocation.
 *
 * Algorithm
 * ─────────
 * 1. For each (asset, gross-direction) bucket across all trades in the batch:
 *    - Sort paying trades by timestamp (FIFO = earliest first)
 *    - Sort receiving trades by timestamp (FIFO = earliest first)
 *    - If net direction is "pay": all receiving trades are fully netted;
 *      absorb their total into the first paying trade(s) FIFO → external_pay
 *    - If net direction is "receive": all paying trades are fully netted;
 *      absorb their total into the first receiving trade(s) FIFO → external_receive
 *    - If net is exactly zero: all trades for this asset are fully netted
 *
 * 2. For each external obligation, allocate the batch-level verifiedAmount
 *    FIFO (by trade timestamp) to each trade's external portion.
 *
 * 3. A trade is:
 *    - 'settled':           all its external legs are fully covered
 *    - 'partially-settled': some but not all coverage
 *    - 'unsettled':         no coverage yet (or no external legs & batch pending)
 *
 * 4. Trades with NO external legs (fully netted) remain 'unsettled' with a
 *    note until the batch reaches 'awaiting-reconciliation' / 'settled', at
 *    which point they are promoted to 'settled' by the store finaliseTradeStatuses().
 *
 * Concept demo — simulated data. No live positions or payments.
 */

import type { Trade, SettlementBatch, Asset, TradeSettlementStatus } from '../store/types';

export interface TradeStatusResult {
  status: TradeSettlementStatus;
  note: string | null;
}

interface PerTradeExternal {
  tradeId: string;
  asset: Asset;
  direction: 'pay' | 'receive';
  externalAmount: number; // gross − netting offset
  isFullyNetted: boolean;
}

// ── Step 1: compute per-trade external amounts after netting offsets ─

export function computePerTradeExternals(trades: Trade[]): PerTradeExternal[] {
  const result: PerTradeExternal[] = [];

  // Gather contributions per asset
  type Entry = { tradeId: string; gross: number; side: 'pay' | 'receive'; ts: string };
  const assetBuckets = new Map<Asset, Entry[]>();

  const add = (asset: Asset, e: Entry) => {
    if (!assetBuckets.has(asset)) assetBuckets.set(asset, []);
    assetBuckets.get(asset)!.push(e);
  };

  for (const t of trades) {
    const base = t.pair.split('/')[0] as Asset;
    if (t.side === 'buy') {
      add('USDC', { tradeId: t.id, gross: t.notionalUsdc, side: 'pay',     ts: t.timestamp });
      add(base,   { tradeId: t.id, gross: t.baseQuantity, side: 'receive', ts: t.timestamp });
    } else {
      add('USDC', { tradeId: t.id, gross: t.notionalUsdc, side: 'receive', ts: t.timestamp });
      add(base,   { tradeId: t.id, gross: t.baseQuantity, side: 'pay',     ts: t.timestamp });
    }
  }

  for (const [asset, entries] of assetBuckets) {
    const payers    = entries.filter((e) => e.side === 'pay')    .sort((a, b) => a.ts.localeCompare(b.ts));
    const receivers = entries.filter((e) => e.side === 'receive').sort((a, b) => a.ts.localeCompare(b.ts));

    const totalPay     = payers.reduce((s, e) => s + e.gross, 0);
    const totalReceive = receivers.reduce((s, e) => s + e.gross, 0);
    const net          = totalReceive - totalPay; // positive = net receive

    if (Math.abs(net) < 1e-9) {
      // Fully netted on this asset — all trades get external = 0
      for (const e of entries) {
        result.push({ tradeId: e.tradeId, asset, direction: e.side, externalAmount: 0, isFullyNetted: true });
      }
      continue;
    }

    if (net < 0) {
      // Net PAY: receivers are fully netted into paying trades FIFO
      let remainingOffset = totalReceive;
      for (const p of payers) {
        const absorbed = Math.min(p.gross, remainingOffset);
        remainingOffset -= absorbed;
        const ext = p.gross - absorbed;
        result.push({ tradeId: p.tradeId, asset, direction: 'pay', externalAmount: ext, isFullyNetted: ext < 1e-9 });
      }
      for (const r of receivers) {
        result.push({ tradeId: r.tradeId, asset, direction: 'receive', externalAmount: 0, isFullyNetted: true });
      }
    } else {
      // Net RECEIVE: payers are fully netted into receiving trades FIFO
      let remainingOffset = totalPay;
      for (const r of receivers) {
        const absorbed = Math.min(r.gross, remainingOffset);
        remainingOffset -= absorbed;
        const ext = r.gross - absorbed;
        result.push({ tradeId: r.tradeId, asset, direction: 'receive', externalAmount: ext, isFullyNetted: ext < 1e-9 });
      }
      for (const p of payers) {
        result.push({ tradeId: p.tradeId, asset, direction: 'pay', externalAmount: 0, isFullyNetted: true });
      }
    }
  }

  return result;
}

// ── Step 2 + 3: allocate verified amounts and derive trade statuses ──

/**
 * Derive trade settlement statuses from batch-level verified obligation amounts.
 * Trades not in this batch are not touched.
 *
 * Set batchComplete=true (awaiting-reconciliation / settled) to promote
 * fully-netted trades to 'settled'.
 */
export function deriveTradeStatuses(
  trades: Trade[],
  batch: SettlementBatch,
  batchComplete = false,
): Map<string, TradeStatusResult> {
  const batchTrades = trades.filter((t) => batch.tradeIds.includes(t.id));
  const externals   = computePerTradeExternals(batchTrades);

  // Group external obligations by (asset, direction)
  type GroupKey = string; // `${asset}:${direction}`
  type AllocEntry = { tradeId: string; externalAmount: number; allocatedAmount: number };

  interface Group {
    asset: Asset;
    direction: 'pay' | 'receive';
    entries: AllocEntry[];
    verifiedAmount: number;
  }

  const groups = new Map<GroupKey, Group>();

  for (const ext of externals) {
    if (ext.isFullyNetted) continue;
    const key: GroupKey = `${ext.asset}:${ext.direction}`;
    if (!groups.has(key)) {
      const obl = batch.obligations.find(
        (o) => o.asset === ext.asset && o.direction === ext.direction,
      );
      groups.set(key, {
        asset: ext.asset,
        direction: ext.direction,
        entries: [],
        verifiedAmount: obl?.verifiedAmount ?? 0,
      });
    }
    groups.get(key)!.entries.push({ tradeId: ext.tradeId, externalAmount: ext.externalAmount, allocatedAmount: 0 });
  }

  // Sort each group FIFO (earliest trade first) and allocate verified amount
  for (const group of groups.values()) {
    group.entries.sort((a, b) => {
      const ta = batchTrades.find((t) => t.id === a.tradeId);
      const tb = batchTrades.find((t) => t.id === b.tradeId);
      return (ta?.timestamp ?? '').localeCompare(tb?.timestamp ?? '');
    });

    let remaining = group.verifiedAmount;
    for (const entry of group.entries) {
      const alloc = Math.min(entry.externalAmount, remaining);
      entry.allocatedAmount = alloc;
      remaining = Math.max(0, remaining - alloc);
    }
  }

  // Per-trade: collect all external legs and their allocations
  const result = new Map<string, TradeStatusResult>();

  for (const trade of batchTrades) {
    const tradeExternals = externals.filter((e) => e.tradeId === trade.id);

    if (tradeExternals.length === 0) {
      // No external info (shouldn't happen for trades in a batch)
      result.set(trade.id, { status: 'unsettled', note: null });
      continue;
    }

    const hasAnyExternal = tradeExternals.some((e) => !e.isFullyNetted);

    if (!hasAnyExternal) {
      // All legs of this trade are fully netted
      if (batchComplete) {
        result.set(trade.id, { status: 'settled', note: 'Settled via netting.' });
      } else {
        result.set(trade.id, { status: 'unsettled', note: 'Fully netted within batch — awaiting batch settlement.' });
      }
      continue;
    }

    // Tally allocations for this trade's external legs
    let totalExternal  = 0;
    let totalAllocated = 0;

    for (const group of groups.values()) {
      for (const entry of group.entries) {
        if (entry.tradeId === trade.id) {
          totalExternal  += entry.externalAmount;
          totalAllocated += entry.allocatedAmount;
        }
      }
    }

    if (totalExternal < 1e-9) {
      result.set(trade.id, { status: 'unsettled', note: null });
    } else if (totalAllocated >= totalExternal - 1e-9) {
      result.set(trade.id, { status: 'settled', note: null });
    } else if (totalAllocated > 1e-9) {
      result.set(trade.id, { status: 'partially-settled', note: null });
    } else {
      result.set(trade.id, { status: 'unsettled', note: null });
    }
  }

  return result;
}
