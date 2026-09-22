/**
 * Credit Policy Module
 *
 * DEMO RULE (prototype only — not a real risk methodology):
 *
 *   Used credit  = sum of USDC notionals of all accepted trades
 *                  that belong to a batch that has NOT reached "settled".
 *
 *   Available credit = APPROVED_LIMIT − used credit
 *
 * Both buys and sells consume credit (gross-notional model).
 * Credit is released batch-by-batch only when ALL obligations in that
 * batch are fully reconciled AND the Risk update has been applied.
 * Partial payments, approval, or a single direction completing do NOT
 * release credit.
 *
 * Unbatched trades (batchId === null) consume credit until they are
 * included in a batch that settles.
 *
 * A production implementation would consume the provider's authoritative
 * Risk calculations and release rules from its API.
 */

import type { Trade, SettlementBatch } from '../store/types';

export const APPROVED_LIMIT = 2_000_000; // USDC

/**
 * Returns the set of batch IDs whose credit has been released
 * (all obligations reconciled, Risk update applied → status === 'settled').
 */
function settledBatchIds(batches: SettlementBatch[]): Set<string> {
  return new Set(batches.filter((b) => b.status === 'settled').map((b) => b.id));
}

/**
 * Gross sum of USDC notionals for trades whose batch has not settled.
 *
 * Unbatched trades (batchId === null) are always counted as consuming
 * credit because no settlement has occurred for them.
 */
export function computeUsedCredit(
  trades: Trade[],
  batches: SettlementBatch[],
): number {
  const released = settledBatchIds(batches);
  return trades
    .filter((t) => t.batchId === null || !released.has(t.batchId))
    .reduce((sum, t) => sum + t.notionalUsdc, 0);
}

/**
 * Available credit after deducting used credit from the approved limit.
 */
export function computeAvailableCredit(
  trades: Trade[],
  batches: SettlementBatch[],
): number {
  return APPROVED_LIMIT - computeUsedCredit(trades, batches);
}

/** Utilisation ratio 0–1 */
export function utilisationRatio(
  trades: Trade[],
  batches: SettlementBatch[],
): number {
  return computeUsedCredit(trades, batches) / APPROVED_LIMIT;
}
