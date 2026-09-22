/**
 * Wintermute NODE — Zustand store
 *
 * Single shared state for Trading and Settlements screens.
 * Persisted via localStorage; use resetDemo() to return to initial state.
 *
 * Concept demo — simulated data. No live trading or integrations.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import type {
  AppState,
  Trade,
  SettlementBatch,
  Obligation,
  PendingQuote,
  AppNotification,
  Persona,
  GuidedStepKey,
  TimelineEvent,
  DiscrepancyInfo,
  PaymentEvent,
  TradeSettlementStatus,
} from './types';

import { computeNetObligations }                      from '../modules/netting';
import { initialPrices, resetPrices }                 from '../modules/priceSimulation';
import { nextStepKey, GUIDED_TRADE_FIXTURES }         from '../modules/demoFixtures';
import { computeAvailableCredit, computeUsedCredit, utilisationRatio, APPROVED_LIMIT } from '../modules/creditPolicy';
import { deriveTradeStatuses }                        from '../modules/tradeAllocation';
import type { Asset, Network }                        from './types';

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const LEGAL_ENTITY      = 'Northstar Capital';
const COUNTERPARTY      = 'Wintermute';
const SETTLEMENT_WINDOW = 'T+1 Daily';
const NETTING_ARRANGEMENT = 'Bilateral netting';

const NETWORK_FOR_ASSET: Record<Asset, Network> = {
  USDC: 'Ethereum',
  BTC:  'Bitcoin',
  ETH:  'Ethereum',
  SOL:  'Solana',
};

// ────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString();
}

function settlementDue(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function tradeRef(n: number): string {
  return `TRD-${String(n).padStart(4, '0')}`;
}

function batchRef(n: number): string {
  return `STLBATCH-${String(n).padStart(3, '0')}`;
}

function personaLabel(p: Persona): string {
  switch (p) {
    case 'fund-trader':      return 'Fund Trader';
    case 'fund-operations':  return 'Fund Operations';
    case 'fund-approver':    return 'Fund Approver';
    case 'provider-operations': return 'Provider Operations';
  }
}

function fmtUsdc(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' USDC';
}

function fmt(n: number, asset: Asset): string {
  if (asset === 'USDC') return fmtUsdc(n);
  if (asset === 'BTC')  return n.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC';
  if (asset === 'ETH')  return n.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ETH';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ` ${asset}`;
}

// ────────────────────────────────────────────────────────────────
// Initial state factory
// ────────────────────────────────────────────────────────────────

function makeInitialState(): AppState {
  return {
    trades:   [],
    batches:  [],
    prices:   initialPrices(),
    isQuoteFeedPaused: false,
    pendingQuote:  null,
    isExecuting:   false,
    persona:       'fund-trader',
    demoMode:      'free',
    guidedStepKey: 'step-buy-btc',
    blockedTradeAttempted: false,
    notifications: [],
    demoRunId:     uid(),
    _nextTradeNum: 1,
    _nextBatchNum: 1,
    _nextEventNum: 1,
  };
}

// ────────────────────────────────────────────────────────────────
// Timeline helper
// ────────────────────────────────────────────────────────────────

function makeEvent(
  get: () => AppState,
  action: string,
  revision: number,
  detail?: string,
): TimelineEvent {
  return {
    id: uid(),
    timestamp: isoNow(),
    actor: personaLabel(get().persona),
    persona: get().persona,
    action,
    revision,
    detail,
  };
}

// ────────────────────────────────────────────────────────────────
// Batch helpers
// ────────────────────────────────────────────────────────────────

function makeBatchSkeleton(batchId: string, now: string): SettlementBatch {
  return {
    id: batchId,
    name: null,
    revision: 1,
    status: 'needs-review',
    legalEntity: LEGAL_ENTITY,
    counterparty: COUNTERPARTY,
    settlementWindow: SETTLEMENT_WINDOW,
    nettingArrangement: NETTING_ARRANGEMENT,
    dueTime: settlementDue(),
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
    createdAt: now,
    lastUpdatedAt: now,
    isMissingTradeScenario: false,
    missingTradeId: null,
  };
}

/**
 * Recompute obligations for a batch after trade membership changed.
 * Preserves existing verifiedAmount/paymentEvents for unchanged obligations.
 */
function recomputeBatch(
  batch: SettlementBatch,
  allTrades: Trade[],
  reason: string,
): SettlementBatch {
  const tradeObjs = allTrades.filter((t) => batch.tradeIds.includes(t.id));
  const newObligations = computeNetObligations(tradeObjs, `${batch.id}-OBL`, 1);
  const newRevision = batch.revision + 1;

  // Preserve verified amounts for unchanged obligations
  const updatedObligations: Obligation[] = newObligations.map((newObl) => {
    const existing = batch.obligations.find(
      (o) => o.asset === newObl.asset && o.direction === newObl.direction,
    );
    if (existing && existing.verifiedAmount > 0) {
      const verified   = Math.min(existing.verifiedAmount, newObl.netAmount);
      const remaining  = newObl.netAmount - verified;
      const status: Obligation['status'] =
        remaining <= 0 ? 'complete' : verified > 0 ? 'partial' : 'outstanding';
      return {
        ...newObl,
        id: existing.id,
        verifiedAmount: verified,
        remainingAmount: remaining,
        status,
        paymentReference: existing.paymentReference,
        paymentEvents: existing.paymentEvents,
      };
    }
    return newObl;
  });

  return {
    ...batch,
    revision: newRevision,
    obligations: updatedObligations,
    revisionHistory: [
      ...batch.revisionHistory,
      {
        revision: newRevision,
        tradeIds: [...batch.tradeIds],
        obligations: updatedObligations,
        createdAt: isoNow(),
        reason,
      },
    ],
    lastUpdatedAt: isoNow(),
  };
}

// ────────────────────────────────────────────────────────────────
// Actions interface
// ────────────────────────────────────────────────────────────────

export interface AppActions {
  // Prices
  updatePrices: (prices: AppState['prices']) => void;
  pauseQuoteFeed: () => void;
  resumeQuoteFeed: () => void;

  // Trading — execution
  captureQuote: (pair: Trade['pair'], side: Trade['side'], quantity: number) => PendingQuote | { error: string };
  expireQuote: () => void;
  executeTrade: (quoteId: string) => { ok: boolean; reason?: string; tradeId?: string };

  // Guided walkthrough
  startGuidedMode: () => void;
  exitGuidedMode: () => void;
  executeGuidedStep: (stepKey: GuidedStepKey) => { ok: boolean; reason?: string; tradeId?: string };
  advanceGuidedStep: () => void;

  // Persona
  setPersona: (p: Persona) => void;

  // ── Manual batching ───────────────────────────────────────────
  /**
   * Create a new batch from a set of unbatched, unsettled trade IDs.
   * All trades must belong to the same entity/counterparty/window.
   */
  createBatch: (
    tradeIds: string[],
    options?: { name?: string; submitImmediately?: boolean },
  ) => { ok: boolean; batchId?: string; reason?: string };

  /** Add more unbatched trades to an existing needs-review batch. */
  addTradesToBatch: (
    tradeIds: string[],
    batchId: string,
  ) => { ok: boolean; reason?: string };

  /** Remove a trade from a needs-review batch (no payment activity). */
  removeTradeFromBatch: (
    tradeId: string,
    batchId: string,
  ) => { ok: boolean; reason?: string };

  /** Discard a draft batch (needs-review, no payment history). Sets all trade batchIds to null. */
  discardDraftBatch: (batchId: string) => { ok: boolean; reason?: string };

  // ── Settlement workflow ───────────────────────────────────────
  submitBatchForApproval: (batchId: string) => { ok: boolean; reason?: string };
  approveBatch:           (batchId: string) => { ok: boolean; reason?: string };
  returnBatchForReview:   (batchId: string, comment: string) => { ok: boolean; reason?: string };
  reportDiscrepancy:      (batchId: string, info: Omit<DiscrepancyInfo, 'reportedBy' | 'reportedAt'>) => { ok: boolean; reason?: string };
  resolveDiscrepancy:     (batchId: string, note: string, includeMissingTradeId?: string) => { ok: boolean; reason?: string };
  addPaymentReference:    (batchId: string, obligationId: string, ref: string) => { ok: boolean; reason?: string };
  verifyPayment:          (batchId: string, obligationId: string, amount: number) => { ok: boolean; reason?: string };

  /** Confirm all obligations reconciled → batch → 'settled', creditUpdatePending=true */
  triggerReconciliation:  (batchId: string) => { ok: boolean; reason?: string };

  /** Apply the queued Risk update → creditUpdatePending=false (credit already released at settled) */
  applyRiskUpdate:        (batchId: string) => { ok: boolean; reason?: string };

  // Demo helpers
  loadMissingTradeScenario: () => void;

  // Notifications
  addNotification:    (n: Omit<AppNotification, 'id' | 'timestamp'>) => void;
  dismissNotification:(id: string) => void;

  // Reset
  resetDemo: () => void;
}

// ────────────────────────────────────────────────────────────────
// Quote capture (standalone helper)
// ────────────────────────────────────────────────────────────────

function _captureQuote(
  get: () => AppState,
  pair: Trade['pair'],
  side: Trade['side'],
  quantity: number,
): PendingQuote | { error: string } {
  const state = get();
  const priceData = state.prices[pair];
  if (!priceData) return { error: 'No price data available.' };

  const staleThreshold = 10_000; // ms
  if (Date.now() - priceData.timestamp > staleThreshold)
    return { error: 'Price data is stale. Resume the quote feed to continue.' };

  const price        = side === 'buy' ? priceData.ask : priceData.bid;
  const notionalUsdc = quantity * price;
  const now          = Date.now();

  return {
    id: uid(),
    pair,
    side,
    quantity,
    price,
    notionalUsdc,
    capturedAt: now,
    expiresAt:  now + 5_000,
  };
}

// ────────────────────────────────────────────────────────────────
// Trade construction helper
// ────────────────────────────────────────────────────────────────

function buildTrade(
  tradeId: string,
  pair: Trade['pair'],
  side: Trade['side'],
  quantity: number,
  price: number,
  notionalUsdc: number,
): Trade {
  const base = pair.split('/')[0] as Asset;
  return {
    id: tradeId,
    timestamp: isoNow(),
    pair,
    side,
    baseQuantity:  quantity,
    executedPrice: price,
    notionalUsdc,
    legalEntity:      LEGAL_ENTITY,
    counterparty:     COUNTERPARTY,
    settlementWindow: SETTLEMENT_WINDOW,
    baseNetwork:  NETWORK_FOR_ASSET[base],
    quoteNetwork: NETWORK_FOR_ASSET['USDC'],
    batchId:           null,
    settlementStatus:  'unsettled',
    settlementNote:    null,
    reconciliationReserved: false,
  };
}

// ────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────

export const useStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      ...makeInitialState(),

      // ── Prices ───────────────────────────────────────────────────

      updatePrices(prices) {
        set({ prices });
      },

      pauseQuoteFeed() {
        set({ isQuoteFeedPaused: true });
      },

      resumeQuoteFeed() {
        set({ isQuoteFeedPaused: false });
      },

      // ── Trading ──────────────────────────────────────────────────

      captureQuote(pair, side, quantity) {
        if (quantity <= 0 || !isFinite(quantity))
          return { error: 'Invalid quantity.' };
        const result = _captureQuote(get, pair, side, quantity);
        if ('error' in result) return result;
        set({ pendingQuote: result });
        return result;
      },

      expireQuote() {
        set({ pendingQuote: null });
      },

      executeTrade(quoteId) {
        const state = get();

        if (state.isExecuting)
          return { ok: false, reason: 'Execution already in progress.' };
        set({ isExecuting: true });

        const quote = state.pendingQuote;
        if (!quote || quote.id !== quoteId) {
          set({ isExecuting: false });
          return { ok: false, reason: 'No valid quote. Please review the trade again.' };
        }

        if (Date.now() > quote.expiresAt) {
          set({ pendingQuote: null, isExecuting: false });
          return { ok: false, reason: 'Quote expired. Please request a new quote.' };
        }

        const available = computeAvailableCredit(state.trades, state.batches);
        if (quote.notionalUsdc > available) {
          set({ pendingQuote: null, isExecuting: false });
          return {
            ok: false,
            reason: `This trade requires ${fmtUsdc(quote.notionalUsdc)}. Available credit is ${fmtUsdc(available)}.`,
          };
        }

        const tradeId = tradeRef(state._nextTradeNum);
        const trade   = buildTrade(tradeId, quote.pair, quote.side, quote.quantity, quote.price, quote.notionalUsdc);

        set({
          trades:   [...state.trades, trade],
          pendingQuote:   null,
          isExecuting:    false,
          _nextTradeNum:  state._nextTradeNum + 1,
        });

        return { ok: true, tradeId };
      },

      // ── Guided Mode ──────────────────────────────────────────────

      startGuidedMode() {
        set({ demoMode: 'guided', guidedStepKey: 'step-buy-btc', blockedTradeAttempted: false });
      },

      exitGuidedMode() {
        set({ demoMode: 'free' });
      },

      executeGuidedStep(stepKey) {
        const fixture = GUIDED_TRADE_FIXTURES[stepKey];
        if (!fixture) return { ok: false, reason: 'No fixture for this step.' };

        const state     = get();
        const available = computeAvailableCredit(state.trades, state.batches);
        const notional  = fixture.quantity * fixture.price;

        if (stepKey === 'step-blocked') {
          if (notional > available) {
            set({ blockedTradeAttempted: true });
            return {
              ok: false,
              reason: `This trade requires ${fmtUsdc(notional)}. Available credit is ${fmtUsdc(available)}.`,
            };
          }
          return { ok: false, reason: 'Expected this trade to be blocked but credit is sufficient.' };
        }

        if (notional > available) {
          return {
            ok: false,
            reason: `This trade requires ${fmtUsdc(notional)}. Available credit is ${fmtUsdc(available)}.`,
          };
        }

        const tradeId = tradeRef(state._nextTradeNum);
        const trade   = buildTrade(tradeId, fixture.pair, fixture.side, fixture.quantity, fixture.price, notional);

        set({
          trades:        [...state.trades, trade],
          _nextTradeNum: state._nextTradeNum + 1,
        });

        return { ok: true, tradeId };
      },

      advanceGuidedStep() {
        const { guidedStepKey } = get();
        set({ guidedStepKey: nextStepKey(guidedStepKey) });
      },

      // ── Persona ──────────────────────────────────────────────────

      setPersona(p) {
        set({ persona: p });
      },

      // ── Manual batching ──────────────────────────────────────────

      createBatch(tradeIds, options = {}) {
        if (tradeIds.length === 0)
          return { ok: false, reason: 'Select at least one trade.' };

        const state    = get();
        const allTrades = state.trades;

        // Validate every trade
        const batchTrades: Trade[] = [];
        for (const id of tradeIds) {
          const t = allTrades.find((t) => t.id === id);
          if (!t) return { ok: false, reason: `Trade ${id} not found.` };
          if (t.batchId !== null)
            return { ok: false, reason: `Trade ${id} is already assigned to batch ${t.batchId}.` };
          if (t.settlementStatus !== 'unsettled')
            return { ok: false, reason: `Trade ${id} is not Unsettled (status: ${t.settlementStatus}).` };
          if (t.reconciliationReserved)
            return { ok: false, reason: `Trade ${id} is reserved for a reconciliation exception.` };
          batchTrades.push(t);
        }

        // All must share the same entity/counterparty/window
        const ref = batchTrades[0];
        for (const t of batchTrades.slice(1)) {
          if (t.legalEntity !== ref.legalEntity || t.counterparty !== ref.counterparty || t.settlementWindow !== ref.settlementWindow)
            return {
              ok: false,
              reason: `Trade ${t.id} has a different settlement scope (${t.legalEntity} / ${t.counterparty} / ${t.settlementWindow}).`,
            };
        }

        const now     = isoNow();
        const batchId = batchRef(state._nextBatchNum);
        const actorLabel = personaLabel(get().persona);
        const persona    = get().persona;

        // When submitImmediately = true the batch is created directly in
        // 'pending-approval', sealing trade IDs and recording submission in
        // the same atomic action (the "Create and submit for approval" flow).
        const submitNow = options.submitImmediately === true;

        const obligations = computeNetObligations(batchTrades, `${batchId}-OBL`, 1);
        const createAction = submitNow
          ? `Batch created and submitted for approval with ${tradeIds.length} trade${tradeIds.length !== 1 ? 's' : ''}`
          : `Batch created with ${tradeIds.length} trade${tradeIds.length !== 1 ? 's' : ''}`;

        const newBatch: SettlementBatch = {
          ...makeBatchSkeleton(batchId, now),
          name:           options.name ?? null,
          status:         submitNow ? 'pending-approval' : 'needs-review',
          tradeIds:       [...tradeIds],
          sealedTradeIds: submitNow ? [...tradeIds] : null,
          submittedBy:    submitNow ? actorLabel : null,
          submittedAt:    submitNow ? now : null,
          obligations,
          revisionHistory: [{
            revision: 1,
            tradeIds: [...tradeIds],
            obligations,
            createdAt: now,
            reason: submitNow ? 'Batch created and submitted for approval' : 'Batch created',
          }],
          activityTimeline: [
            {
              id: uid(),
              timestamp: now,
              actor: actorLabel,
              persona,
              action: createAction,
              revision: 1,
              detail: tradeIds.join(', '),
            },
          ],
        };

        // Assign batchId to each trade
        const updatedTrades = state.trades.map((t) =>
          tradeIds.includes(t.id) ? { ...t, batchId } : t,
        );

        set({
          trades:        updatedTrades,
          batches:       [...state.batches, newBatch],
          _nextBatchNum: state._nextBatchNum + 1,
        });

        return { ok: true, batchId };
      },

      addTradesToBatch(tradeIds, batchId) {
        if (tradeIds.length === 0) return { ok: false, reason: 'No trades specified.' };

        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'needs-review')
          return { ok: false, reason: 'Can only add trades to a Needs Review batch.' };

        const toAdd: Trade[] = [];
        for (const id of tradeIds) {
          const t = state.trades.find((t) => t.id === id);
          if (!t) return { ok: false, reason: `Trade ${id} not found.` };
          if (t.batchId !== null)
            return { ok: false, reason: `Trade ${id} is already assigned to batch ${t.batchId}.` };
          if (t.settlementStatus !== 'unsettled')
            return { ok: false, reason: `Trade ${id} is not Unsettled.` };
          if (t.reconciliationReserved)
            return { ok: false, reason: `Trade ${id} is reserved for a reconciliation exception.` };
          toAdd.push(t);
        }

        const now        = isoNow();
        const newTradeIds = [...batch.tradeIds, ...tradeIds];
        const allBatchTrades = state.trades.filter((t) => newTradeIds.includes(t.id));
        const newRevision = batch.revision + 1;
        const newObligations = computeNetObligations(allBatchTrades, `${batchId}-OBL`, 1);

        const updated: SettlementBatch = {
          ...batch,
          tradeIds: newTradeIds,
          revision: newRevision,
          obligations: newObligations,
          revisionHistory: [
            ...batch.revisionHistory,
            { revision: newRevision, tradeIds: newTradeIds, obligations: newObligations, createdAt: now, reason: `Added trades: ${tradeIds.join(', ')}` },
          ],
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, `Trades added: ${tradeIds.join(', ')}`, newRevision),
          ],
          lastUpdatedAt: now,
        };

        const updatedTrades = state.trades.map((t) =>
          tradeIds.includes(t.id) ? { ...t, batchId } : t,
        );

        set({
          trades:  updatedTrades,
          batches: state.batches.map((b) => (b.id === batchId ? updated : b)),
        });
        return { ok: true };
      },

      removeTradeFromBatch(tradeId, batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'needs-review')
          return { ok: false, reason: 'Can only remove trades from a Needs Review batch.' };
        if (!batch.tradeIds.includes(tradeId))
          return { ok: false, reason: `Trade ${tradeId} is not in this batch.` };
        if (batch.obligations.some((o) => o.verifiedAmount > 0))
          return { ok: false, reason: 'Cannot remove a trade after a payment has been verified.' };

        const now        = isoNow();
        const newTradeIds = batch.tradeIds.filter((id) => id !== tradeId);
        const allBatchTrades = state.trades.filter((t) => newTradeIds.includes(t.id));
        const newRevision = batch.revision + 1;
        const newObligations = newTradeIds.length > 0
          ? computeNetObligations(allBatchTrades, `${batchId}-OBL`, 1)
          : [];

        const updated: SettlementBatch = {
          ...batch,
          tradeIds: newTradeIds,
          revision: newRevision,
          obligations: newObligations,
          revisionHistory: [
            ...batch.revisionHistory,
            { revision: newRevision, tradeIds: newTradeIds, obligations: newObligations, createdAt: now, reason: `Trade ${tradeId} removed` },
          ],
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, `Trade ${tradeId} removed`, newRevision),
          ],
          lastUpdatedAt: now,
        };

        const updatedTrades = state.trades.map((t) =>
          t.id === tradeId ? { ...t, batchId: null } : t,
        );

        set({
          trades:  updatedTrades,
          batches: state.batches.map((b) => (b.id === batchId ? updated : b)),
        });
        return { ok: true };
      },

      discardDraftBatch(batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'needs-review')
          return { ok: false, reason: 'Can only discard a Needs Review batch.' };
        if (batch.submittedBy)
          return { ok: false, reason: 'Batch has already been submitted. Return it for review first.' };
        if (batch.obligations.some((o) => o.verifiedAmount > 0))
          return { ok: false, reason: 'Cannot discard after a payment has been verified.' };

        // Unassign all trades
        const updatedTrades = state.trades.map((t) =>
          batch.tradeIds.includes(t.id) ? { ...t, batchId: null } : t,
        );

        set({
          trades:  updatedTrades,
          batches: state.batches.filter((b) => b.id !== batchId),
        });
        return { ok: true };
      },

      // ── Settlement workflow ──────────────────────────────────────

      submitBatchForApproval(batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'needs-review')
          return { ok: false, reason: `Cannot submit a batch in status "${batch.status}".` };
        if (batch.tradeIds.length === 0)
          return { ok: false, reason: 'Batch has no trades.' };
        if (batch.disputeInfo && !batch.disputeInfo.resolvedAt)
          return { ok: false, reason: 'Resolve the discrepancy before submitting.' };
        if (state.persona !== 'fund-operations')
          return { ok: false, reason: 'Only Fund Operations can submit for approval.' };

        const now        = isoNow();
        const actorLabel = personaLabel(state.persona);

        const updated: SettlementBatch = {
          ...batch,
          status:        'pending-approval',
          sealedTradeIds: [...batch.tradeIds],
          submittedBy:   actorLabel,
          submittedAt:   now,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Submitted for approval', batch.revision),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      approveBatch(batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'pending-approval')
          return { ok: false, reason: 'Batch is not pending approval.' };
        if (state.persona !== 'fund-approver')
          return { ok: false, reason: 'Only Fund Approver can approve.' };

        const actorLabel = personaLabel(state.persona);
        if (batch.submittedBy === actorLabel)
          return { ok: false, reason: 'The approver cannot be the same person who submitted this batch.' };

        const now = isoNow();
        const updated: SettlementBatch = {
          ...batch,
          status:          'awaiting-payment',
          approvedBy:      actorLabel,
          approvedAt:      now,
          approvedRevision: batch.revision,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Batch approved — awaiting payment', batch.revision),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      returnBatchForReview(batchId, comment) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'pending-approval')
          return { ok: false, reason: 'Can only return a batch that is pending approval.' };
        if (state.persona !== 'fund-approver')
          return { ok: false, reason: 'Only Fund Approver can return for review.' };

        const now = isoNow();
        const updated: SettlementBatch = {
          ...batch,
          status:        'needs-review',
          submittedBy:   null,
          submittedAt:   null,
          sealedTradeIds: null,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Returned for review', batch.revision, comment),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      reportDiscrepancy(batchId, info) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };

        const anyVerified = batch.obligations.some((o) => o.verifiedAmount > 0);
        if (anyVerified)
          return { ok: false, reason: 'Cannot report a discrepancy after payments have been verified.' };
        if (state.persona !== 'fund-operations')
          return { ok: false, reason: 'Only Fund Operations can report a discrepancy.' };

        const now      = isoNow();
        const fullInfo: DiscrepancyInfo = { ...info, reportedBy: personaLabel(state.persona), reportedAt: now };

        const updated: SettlementBatch = {
          ...batch,
          status:        'disputed',
          sealedTradeIds: null,
          submittedBy:   null,
          submittedAt:   null,
          disputeInfo:   fullInfo,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Discrepancy reported', batch.revision, `Reason: ${info.reason}. Trade ref: ${info.relatedTradeRef}. ${info.comment}`),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      resolveDiscrepancy(batchId, note, includeMissingTradeId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'disputed')
          return { ok: false, reason: 'Batch is not disputed.' };
        if (state.persona !== 'provider-operations')
          return { ok: false, reason: 'Only Provider Operations can resolve a discrepancy.' };

        const now        = isoNow();
        const actorLabel = personaLabel(state.persona);

        let updatedBatch: SettlementBatch = {
          ...batch,
          disputeInfo: {
            ...batch.disputeInfo!,
            resolvedBy:    actorLabel,
            resolvedAt:    now,
            resolutionNote: note,
          },
        };

        let tradeUpdates: Partial<Record<string, string>> = {};

        if (includeMissingTradeId) {
          const missingTrade = state.trades.find((t) => t.id === includeMissingTradeId);
          if (missingTrade && !updatedBatch.tradeIds.includes(includeMissingTradeId)) {
            updatedBatch = {
              ...updatedBatch,
              tradeIds: [...updatedBatch.tradeIds, includeMissingTradeId],
            };
            tradeUpdates[includeMissingTradeId] = batchId;
          }
        }

        const reason    = includeMissingTradeId
          ? `Corrected batch — included trade ${includeMissingTradeId}`
          : `Corrected batch — ${note}`;
        const recomputed = recomputeBatch(updatedBatch, state.trades, reason);

        const finalBatch: SettlementBatch = {
          ...recomputed,
          status:        'needs-review',
          submittedBy:   null,
          submittedAt:   null,
          sealedTradeIds: null,
          activityTimeline: [
            ...recomputed.activityTimeline,
            {
              id: uid(),
              timestamp: now,
              actor:    actorLabel,
              persona:  state.persona,
              action:   'Discrepancy resolved — corrected batch revision produced',
              revision: recomputed.revision,
              detail:   note,
            },
          ],
          lastUpdatedAt: now,
        };

        // Assign batchId to any newly-included trade
        const updatedTrades = state.trades.map((t) =>
          tradeUpdates[t.id] ? { ...t, batchId: tradeUpdates[t.id]! } : t,
        );

        set({
          trades:  updatedTrades,
          batches: state.batches.map((b) => (b.id === batchId ? finalBatch : b)),
        });
        return { ok: true };
      },

      addPaymentReference(batchId, obligationId, ref) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (!['awaiting-payment', 'partially-settled'].includes(batch.status))
          return { ok: false, reason: 'Cannot add a reference in current batch status.' };

        const now   = isoNow();
        const event: PaymentEvent = {
          id: uid(),
          timestamp: now,
          type: 'reference_added',
          amount: 0,
          reference: ref,
          actor: personaLabel(state.persona),
        };

        const updatedObligations = batch.obligations.map((o) =>
          o.id === obligationId
            ? { ...o, paymentReference: ref, paymentEvents: [...o.paymentEvents, event] }
            : o,
        );

        const updated: SettlementBatch = {
          ...batch,
          obligations: updatedObligations,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, `Payment reference added: ${ref}`, batch.revision),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      verifyPayment(batchId, obligationId, amount) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (!['awaiting-payment', 'partially-settled'].includes(batch.status))
          return { ok: false, reason: 'Cannot verify payment in current batch status.' };

        const obl = batch.obligations.find((o) => o.id === obligationId);
        if (!obl) return { ok: false, reason: 'Obligation not found.' };
        if (amount <= 0) return { ok: false, reason: 'Amount must be greater than zero.' };
        if (amount > obl.remainingAmount + 0.000001)
          return { ok: false, reason: `Amount ${fmt(amount, obl.asset)} exceeds remaining ${fmt(obl.remainingAmount, obl.asset)}.` };

        const now     = isoNow();
        const eventId = uid();

        const newVerified  = obl.verifiedAmount + amount;
        const newRemaining = Math.max(0, obl.netAmount - newVerified);
        const newOblStatus: Obligation['status'] = newRemaining <= 0.000001 ? 'complete' : 'partial';

        const verifyEvent: PaymentEvent = {
          id: eventId,
          timestamp: now,
          type: 'verified',
          amount,
          actor: personaLabel(state.persona),
          note:  'Simulated verified payment',
        };

        const updatedObligations = batch.obligations.map((o) =>
          o.id === obligationId
            ? {
                ...o,
                verifiedAmount:  newVerified,
                remainingAmount: newRemaining,
                status:          newOblStatus,
                paymentEvents:   [...o.paymentEvents, verifyEvent],
              }
            : o,
        );

        // Determine new batch status.
        //
        // AUTOMATIC COMPLETION: when every external obligation is covered by
        // verified evidence, reconciliation, offset finalisation, trade
        // completion and credit release all happen in THIS single store
        // transition. There is deliberately no human "reconcile" or "release
        // credit" step in the ordinary journey — see §2/§5 of the spec.
        //
        // A blocking case (unresolved dispute) holds completion back; the
        // batch parks in 'awaiting-reconciliation' which the UI renders as
        // "Processing settlement" with the blocking reason and its owner.
        const allComplete   = updatedObligations.every((o) => o.status === 'complete');
        const blockingCase  = batch.disputeInfo != null && !batch.disputeInfo.resolvedAt;
        const autoSettles   = allComplete && !blockingCase;

        const newBatchStatus: SettlementBatch['status'] =
          autoSettles  ? 'settled'
          : allComplete ? 'awaiting-reconciliation' // held by a blocking case
          :               'partially-settled';

        const timelineAction =
          autoSettles
            ? 'All obligations verified — reconciled and settled automatically'
            : allComplete
            ? 'All obligations verified — completion held by an open case'
            : `Verified ${fmt(amount, obl.asset)} on ${obl.asset} ${obl.direction} obligation`;

        const updatedBatch: SettlementBatch = {
          ...batch,
          obligations: updatedObligations,
          status:      newBatchStatus,
          // Finalise offsets and release credit only on a real completion.
          reconciledAt:        autoSettles ? now : batch.reconciledAt,
          creditUpdatePending: false, // credit refreshes in this same transition
          settlementCycle:     autoSettles ? batch.settlementCycle + 1 : batch.settlementCycle,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, timelineAction, batch.revision),
          ],
          lastUpdatedAt: now,
        };

        // Derive per-trade settlement statuses from updated verified amounts
        const statusMap = deriveTradeStatuses(
          state.trades,
          { ...updatedBatch, obligations: updatedObligations },
          allComplete, // batchComplete: promote fully-netted trades if batch is now complete
        );

        const updatedTrades = state.trades.map((t) => {
          const derived = statusMap.get(t.id);
          if (!derived) return t;
          return {
            ...t,
            settlementStatus: derived.status as TradeSettlementStatus,
            settlementNote:   derived.note,
          };
        });

        set({
          trades:  updatedTrades,
          batches: state.batches.map((b) => (b.id === batchId ? updatedBatch : b)),
        });
        return { ok: true };
      },

      triggerReconciliation(batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (batch.status !== 'awaiting-reconciliation')
          return { ok: false, reason: `Batch is in status "${batch.status}", not awaiting-reconciliation.` };

        const now = isoNow();
        const updated: SettlementBatch = {
          ...batch,
          status:              'settled',
          reconciledAt:        now,
          creditUpdatePending: true,
          settlementCycle:     batch.settlementCycle + 1,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Reconciliation confirmed — batch settled; Risk update queued', batch.revision),
          ],
          lastUpdatedAt: now,
        };

        // Promote all trades in this batch to 'settled'
        const updatedTrades = state.trades.map((t) =>
          batch.tradeIds.includes(t.id)
            ? { ...t, settlementStatus: 'settled' as TradeSettlementStatus, settlementNote: t.settlementNote }
            : t,
        );

        set({
          trades:  updatedTrades,
          batches: state.batches.map((b) => (b.id === batchId ? updated : b)),
        });
        return { ok: true };
      },

      applyRiskUpdate(batchId) {
        const state = get();
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return { ok: false, reason: 'Batch not found.' };
        if (!batch.creditUpdatePending)
          return { ok: false, reason: 'No pending Risk update for this batch.' };
        if (batch.status !== 'settled')
          return { ok: false, reason: 'Risk update can only be applied to a settled batch.' };

        const now = isoNow();
        const updated: SettlementBatch = {
          ...batch,
          creditUpdatePending: false,
          activityTimeline: [
            ...batch.activityTimeline,
            makeEvent(get, 'Risk update applied — credit facility updated', batch.revision),
          ],
          lastUpdatedAt: now,
        };

        set({ batches: state.batches.map((b) => (b.id === batchId ? updated : b)) });
        return { ok: true };
      },

      // ── Missing trade scenario ────────────────────────────────────

      loadMissingTradeScenario() {
        const initial = makeInitialState();
        resetPrices();
        const now = isoNow();

        const t1: Trade = {
          ...buildTrade('TRD-0001', 'BTC/USDC', 'buy', 10, 80000, 800000),
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          batchId:   'STLBATCH-001',
        };
        const t2: Trade = {
          ...buildTrade('TRD-0002', 'ETH/USDC', 'buy', 100, 3000, 300000),
          timestamp: new Date(Date.now() - 3000000).toISOString(),
          batchId:   'STLBATCH-001',
        };
        // T3 is the "missing trade" — NOT in the batch, batchId null
        const t3: Trade = {
          ...buildTrade('TRD-0003', 'BTC/USDC', 'sell', 2, 80000, 160000),
          timestamp: new Date(Date.now() - 2400000).toISOString(),
          batchId:   null,
        };

        const batchTradeIds  = ['TRD-0001', 'TRD-0002'];
        const batchObligations = computeNetObligations([t1, t2], 'STLBATCH-001-OBL', 1);

        const batch: SettlementBatch = {
          ...makeBatchSkeleton('STLBATCH-001', now),
          tradeIds:   batchTradeIds,
          obligations: batchObligations,
          revisionHistory: [
            { revision: 1, tradeIds: batchTradeIds, obligations: batchObligations, createdAt: now, reason: 'Initial batch (missing TRD-0003)' },
          ],
          activityTimeline: [
            { id: uid(), timestamp: now, actor: 'System', persona: 'system', action: 'Batch created — TRD-0003 (Sell 2 BTC) is missing from this batch', revision: 1 },
          ],
          isMissingTradeScenario: true,
          missingTradeId:         'TRD-0003',
        };

        set({
          ...initial,
          trades:        [t1, t2, t3],
          batches:       [batch],
          _nextTradeNum: 4,
          _nextBatchNum: 2,
          prices:        initialPrices(),
          demoRunId:     uid(),
        });
      },

      // ── Notifications ────────────────────────────────────────────

      addNotification(n) {
        const id = uid();
        set((state) => ({
          notifications: [
            ...state.notifications.slice(-4),
            { ...n, id, timestamp: Date.now() },
          ],
        }));
      },

      dismissNotification(id) {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      // ── Demo Reset ──────────────────────────────────────────────

      resetDemo() {
        resetPrices();
        set(makeInitialState());
      },
    }),
    {
      name: 'wm-node-demo-v3',  // bumped: auto-settle + submit-immediately flow
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const { isExecuting, ...rest } = state as AppState & AppActions & { isExecuting: boolean };
        return rest;
      },
    },
  ),
);

// ── Selectors ────────────────────────────────────────────────────

export function selectUsedCredit(state: AppState): number {
  return computeUsedCredit(state.trades, state.batches);
}

export function selectAvailableCredit(state: AppState): number {
  return computeAvailableCredit(state.trades, state.batches);
}

export function selectUtilisation(state: AppState): number {
  return utilisationRatio(state.trades, state.batches);
}

export { APPROVED_LIMIT };

// ── Formatting helpers (re-exported for consumers) ───────────────

export function fmtUsdcDisplay(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' USDC';
}
