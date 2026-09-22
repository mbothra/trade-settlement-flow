// ============================================================
// Wintermute NODE — shared type definitions
//
// Concept demo — simulated data. No live trading or integrations.
// ============================================================

export type TradingPair = 'BTC/USDC' | 'ETH/USDC' | 'SOL/USDC';
export type Side = 'buy' | 'sell';
export type Persona =
  | 'fund-trader'
  | 'fund-operations'
  | 'fund-approver'
  | 'provider-operations';

/**
 * Batch workflow status — the approval/settlement lifecycle of a batch.
 * Kept deliberately distinct from a trade's settlement status and from
 * whether a trade is assigned to a batch at all.
 */
export type BatchStatus =
  | 'needs-review'
  | 'pending-approval'
  | 'awaiting-payment'
  | 'partially-settled'
  | 'awaiting-reconciliation'
  | 'settled'
  | 'disputed';

/**
 * Trade-level settlement status. This is a SEPARATE dimension from
 * batch assignment (batchId) and from the batch's workflow status.
 * It describes settlement of an executed trade — never partial fill.
 */
export type TradeSettlementStatus = 'unsettled' | 'partially-settled' | 'settled';

export type ObligationDirection = 'pay' | 'receive';
export type Asset = 'USDC' | 'BTC' | 'ETH' | 'SOL';
export type Network = 'Ethereum' | 'Bitcoin' | 'Solana';

// ----------------------------------------------------------
// Price streaming
// ----------------------------------------------------------
export interface PriceSnapshot {
  bid: number;
  ask: number;
  timestamp: number; // epoch ms
  flash: 'up' | 'down' | null;
}

export type PriceMap = Record<TradingPair, PriceSnapshot>;

// ----------------------------------------------------------
// Pending quote (captured at "Review trade")
// ----------------------------------------------------------
export interface PendingQuote {
  id: string;
  pair: TradingPair;
  side: Side;
  quantity: number;
  price: number; // ask for buy, bid for sell
  notionalUsdc: number;
  capturedAt: number; // epoch ms
  expiresAt: number;  // capturedAt + 5000
}

// ----------------------------------------------------------
// Executed trade
//
// Execution facts (timestamp, pair, side, quantity, price, notional,
// networks, scope) are IMMUTABLE after creation. Membership
// (batchId) and derived settlement state are mutable.
// ----------------------------------------------------------
export interface Trade {
  id: string;            // e.g. TRD-0001
  timestamp: string;     // ISO string — never mutated
  pair: TradingPair;
  side: Side;
  baseQuantity: number;  // base asset amount
  executedPrice: number; // USDC per unit — immutable
  notionalUsdc: number;  // baseQuantity * executedPrice — immutable

  // Settlement scope, captured at execution and immutable
  legalEntity: string;
  counterparty: string;
  settlementWindow: string;
  baseNetwork: Network;   // network of the base asset
  quoteNetwork: Network;  // network of USDC

  // Membership — null means Unbatched. A trade belongs to at most
  // one active batch.
  batchId: string | null;

  // Derived settlement state, recomputed from verified payment
  // allocations and finalised net offsets.
  settlementStatus: TradeSettlementStatus;
  /** Short human-readable qualifier, e.g. "Netted within batch — awaiting batch completion." */
  settlementNote: string | null;

  /**
   * Reconciliation reservation: set while an exception workflow owns
   * this trade, preventing it from being batched elsewhere.
   */
  reconciliationReserved: boolean;
}

// ----------------------------------------------------------
// Payment events and obligations
// ----------------------------------------------------------
export type PaymentEventType =
  | 'reference_added'   // fund reported a reference — NOT proof of receipt
  | 'verified'          // simulated source verified an actual movement
  | 'reversed';         // a previously verified movement was reversed

export interface PaymentEvent {
  id: string;
  timestamp: string;
  type: PaymentEventType;
  amount: number;
  reference?: string;
  actor: string;
  note?: string;
  /** Links a reported reference to the verified event that discharged it. */
  linkedEventId?: string;
}

export interface Obligation {
  id: string;
  direction: ObligationDirection;
  asset: Asset;
  network: Network;
  netAmount: number;
  verifiedAmount: number;
  remainingAmount: number;
  status: 'outstanding' | 'partial' | 'complete';
  paymentReference: string | null;
  paymentEvents: PaymentEvent[];
  contributingTradeIds: string[];
  // Gross movements, for the netting explanation
  grossReceives: number;
  grossPays: number;
  /** Receipts beyond the amount due — preserved, never silently erased. */
  unappliedExcess: number;
}

// ----------------------------------------------------------
// Discrepancy / dispute
// ----------------------------------------------------------
export interface DiscrepancyInfo {
  reportedBy: string;
  reportedAt: string;
  reason: string;
  relatedTradeRef: string;
  comment: string;
  owner: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

// ----------------------------------------------------------
// Activity timeline
// ----------------------------------------------------------
export interface TimelineEvent {
  id: string;
  timestamp: string;
  actor: string;
  persona: Persona | 'system';
  action: string;
  revision: number;
  detail?: string;
}

// ----------------------------------------------------------
// Settlement batch
// ----------------------------------------------------------
export interface BatchRevision {
  revision: number;
  tradeIds: string[];
  obligations: Obligation[];
  createdAt: string;
  reason: string;
}

export interface SettlementBatch {
  id: string;
  /** Optional user-supplied name; the id is the immutable reference. */
  name: string | null;
  revision: number;

  status: BatchStatus;
  legalEntity: string;
  counterparty: string;
  settlementWindow: string;
  dueTime: string;          // ISO string
  nettingArrangement: string;

  // Trade membership
  tradeIds: string[];
  sealedTradeIds: string[] | null; // locked at submission

  obligations: Obligation[];

  // Workflow state
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedRevision: number | null; // the exact revision that was approved

  disputeInfo: DiscrepancyInfo | null;

  /**
   * Set once every external obligation is reconciled and offsets are
   * finalised. Credit is released only when the Risk update applies.
   */
  reconciledAt: string | null;
  creditUpdatePending: boolean;
  /** Monotonic cycle counter — rejects stale Risk updates from an earlier cycle. */
  settlementCycle: number;

  // History
  revisionHistory: BatchRevision[];
  activityTimeline: TimelineEvent[];

  createdAt: string;
  lastUpdatedAt: string;

  // Demo fixture flags
  isMissingTradeScenario: boolean;
  missingTradeId: string | null;
}

// ----------------------------------------------------------
// UI notifications / toasts
// ----------------------------------------------------------
export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  timestamp: number;
}

// ----------------------------------------------------------
// Guided walkthrough
// ----------------------------------------------------------
export type GuidedStepKey =
  | 'idle'
  | 'step-buy-btc'
  | 'step-buy-eth'
  | 'step-sell-btc'
  | 'step-blocked'
  | 'step-settlements'
  | 'step-batch'
  | 'step-submit'
  | 'step-approve'
  | 'step-pay-ref'
  | 'step-pay1'
  | 'step-pay2'
  | 'step-receive-btc'
  | 'step-receive-eth'
  | 'step-reconcile'
  | 'step-risk-update'
  | 'step-done';

export interface GuidedStep {
  key: GuidedStepKey;
  title: string;
  description: string;
  screen: 'trading' | 'settlements';
  requiredPersona?: Persona;
}

// ----------------------------------------------------------
// Settlements > Trades tab filter state
// ----------------------------------------------------------
export type BatchAssignmentFilter = 'all' | 'unbatched' | 'assigned' | string;

export interface TradeFilters {
  settlementStatus: 'all' | TradeSettlementStatus;
  assignment: BatchAssignmentFilter;
  pair: 'all' | TradingPair;
  side: 'all' | Side;
  search: string;
  legalEntity: 'all' | string;
  counterparty: 'all' | string;
}

// ----------------------------------------------------------
// Full app state (persisted)
// ----------------------------------------------------------
export const SCHEMA_VERSION = 2;

export interface AppState {
  trades: Trade[];
  batches: SettlementBatch[];

  prices: PriceMap;
  isQuoteFeedPaused: boolean;

  pendingQuote: PendingQuote | null;
  isExecuting: boolean;

  persona: Persona;
  demoMode: 'free' | 'guided';
  guidedStepKey: GuidedStepKey;
  blockedTradeAttempted: boolean;

  notifications: AppNotification[];

  /** New run ID on every reset — late events from an old run are ignored. */
  demoRunId: string;

  _nextTradeNum: number;
  _nextBatchNum: number;
  _nextEventNum: number;
}
