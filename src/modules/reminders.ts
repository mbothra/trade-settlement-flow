/**
 * Settlement reminder derivation
 *
 * Reminders are DERIVED, never stored. `deriveReminders()` is a pure
 * function of (trades, batches, persona, demo clock), so:
 *
 *   - Re-renders, persona switches and page refreshes cannot create
 *     duplicates — there is no accumulating array to append to.
 *   - Every reminder id is a stable key built from the underlying state,
 *     so read/unread state (which IS stored, keyed by that id) survives
 *     refreshes and reattaches to the same underlying event.
 *   - There is exactly one active reminder per underlying event.
 *
 * The only reminder state the store persists is the set of ids the user
 * has marked read. Marking read never mutates trade, batch, approval,
 * payment or dispute state, so it can never resolve an obligation or
 * remove an item from an action queue.
 *
 * Resolved history is likewise derived — from terminal facts already in
 * the state (approvedAt, reconciledAt, dispute resolvedAt, completed
 * obligations) rather than from a separately maintained log.
 *
 * Concept demo — simulated data. No live trading or integrations.
 */

import type {
  Asset,
  Obligation,
  Persona,
  SettlementBatch,
  Trade,
  TradeFilters,
} from '../store/types';

// ────────────────────────────────────────────────────────────────
// Fictional org constants (demo only)
// ────────────────────────────────────────────────────────────────

/** The independent approver named by Northstar Capital's demo policy. */
export const APPROVER_NAME = 'Alex Chen';
export const PROVIDER_NAME = 'Wintermute';

// ────────────────────────────────────────────────────────────────
// Model
// ────────────────────────────────────────────────────────────────

export type ReminderKind =
  | 'trades-due-soon'
  | 'approval-required'
  | 'approval-pending'
  | 'payment-due'
  | 'payment-reported'
  | 'partial-settlement'
  | 'payment-complete-waiting'
  | 'incoming-awaiting-verification'
  | 'exception'
  | 'settled';

export type ReminderGroup = 'action-required' | 'processing' | 'resolved';

/**
 * Severity carries an explicit label and glyph so meaning never depends
 * on colour alone (WCAG 1.4.1).
 */
export type ReminderSeverity = 'critical' | 'action' | 'processing' | 'resolved';

export const SEVERITY_META: Record<
  ReminderSeverity,
  { label: string; glyph: string; rank: number }
> = {
  critical:   { label: 'Critical',  glyph: '!',  rank: 0 },
  action:     { label: 'Action',    glyph: '›',  rank: 1 },
  processing: { label: 'Processing', glyph: '⟳', rank: 2 },
  resolved:   { label: 'Resolved',  glyph: '✓',  rank: 3 },
};

/** A reminder's single primary action, expressed declaratively. */
export interface ReminderAction {
  label: string;
  kind: 'open-trades' | 'open-batch' | 'open-batch-payments' | 'open-exception';
  batchId?: string;
  /** Trade refs to highlight once the target view opens. */
  highlightTradeIds?: string[];
  /** Filters to apply when opening Settlements → Trades. */
  filters?: Partial<TradeFilters>;
}

export interface Reminder {
  /** Stable key derived from state — the read/unread anchor. */
  id: string;
  kind: ReminderKind;
  group: ReminderGroup;
  severity: ReminderSeverity;

  title: string;
  message: string;

  /** Related trade or batch reference. */
  reference: string | null;
  legalEntity: string;
  counterparty: string;

  /** Due time with timezone, and a human label for it. */
  dueTime: string | null;
  dueLabel: string | null;

  /** Remaining amount, where relevant. */
  remainingLabel: string | null;

  /** Current owner / responsible role for the next action. */
  owner: string;

  /** Personas this reminder is addressed to. */
  audience: Persona[];

  action: ReminderAction | null;

  /** Sort anchor. */
  occurredAt: string;

  isOverdue: boolean;
  overdueLabel: string | null;
}

// ────────────────────────────────────────────────────────────────
// Formatting
// ────────────────────────────────────────────────────────────────

export function fmtAmount(n: number, asset: Asset | string): string {
  const dp = asset === 'USDC' ? 2 : asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : 4;
  const opts: Intl.NumberFormatOptions =
    asset === 'USDC'
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { maximumFractionDigits: dp };
  return `${n.toLocaleString('en-US', opts)} ${asset}`;
}

function oblAmount(o: Obligation, n: number): string {
  return fmtAmount(n, o.asset);
}

/**
 * Coarse, readable duration — "30 minutes", "2h 15m", "3 days".
 *
 * Floors rather than rounds, so a countdown never overstates the time
 * remaining and "overdue by" never overstates the lateness. Rounding
 * would report 30 seconds overdue as a full minute.
 */
export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem === 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

function utcDayIndex(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/** "today at 17:00 UTC" / "tomorrow at 17:00 UTC" / "24 Sep at 17:00 UTC" */
export function fmtDueLabel(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  const delta = utcDayIndex(d.getTime()) - utcDayIndex(nowMs);
  if (delta === 0) return `today at ${time}`;
  if (delta === 1) return `tomorrow at ${time}`;
  if (delta === -1) return `yesterday at ${time}`;
  const day = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day} at ${time}`;
}

/** Bare "17:00 UTC", for cutoff phrasing. */
export function fmtCutoffTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

// ────────────────────────────────────────────────────────────────
// Payment-event reasoning
// ────────────────────────────────────────────────────────────────

/**
 * True when the fund reported a payment reference that no later verified
 * event has discharged. A reported reference is NOT proof of receipt:
 * it never advances the obligation, settles it, or releases credit.
 */
function hasUnverifiedReport(o: Obligation): boolean {
  let lastRef = -1;
  let lastVerified = -1;
  o.paymentEvents.forEach((ev, i) => {
    if (ev.type === 'reference_added') lastRef = i;
    if (ev.type === 'verified') lastVerified = i;
  });
  return lastRef > lastVerified;
}

function lastReport(o: Obligation) {
  for (let i = o.paymentEvents.length - 1; i >= 0; i--) {
    if (o.paymentEvents[i].type === 'reference_added') return o.paymentEvents[i];
  }
  return null;
}

const OPEN_BATCH_STATUSES: SettlementBatch['status'][] = [
  'awaiting-payment',
  'partially-settled',
];

// ────────────────────────────────────────────────────────────────
// Derivation input
// ────────────────────────────────────────────────────────────────

export interface ReminderContext {
  trades: Trade[];
  batches: SettlementBatch[];
  /** Demo clock — milliseconds since epoch. */
  nowMs: number;
  /** The 17:00 UTC settlement cutoff for unbatched trades. */
  cutoffIso: string;
}

/** Reminders fire for unbatched trades inside this window before cutoff. */
export const DUE_SOON_WINDOW_MS = 60 * 60 * 1000; // one hour

// ────────────────────────────────────────────────────────────────
// Active reminders
// ────────────────────────────────────────────────────────────────

function deriveActive(ctx: ReminderContext): Reminder[] {
  const { trades, batches, nowMs, cutoffIso } = ctx;
  const out: Reminder[] = [];

  // ── A. Trades approaching settlement cutoff ────────────────────
  //
  // Eligible = unbatched, unsettled, not reserved by an exception.
  const eligible = trades.filter(
    (t) => t.batchId === null && t.settlementStatus === 'unsettled' && !t.reconciliationReserved,
  );

  if (eligible.length > 0) {
    const cutoffMs = new Date(cutoffIso).getTime();
    const msToCutoff = cutoffMs - nowMs;
    const withinWindow = msToCutoff <= DUE_SOON_WINDOW_MS;
    const overdue = msToCutoff < 0;

    if (withinWindow) {
      const entity = eligible[0].legalEntity;
      const counterparty = eligible[0].counterparty;
      const n = eligible.length;
      const plural = n !== 1;

      out.push({
        id: `trades-due-soon:${entity}:${counterparty}:${cutoffIso}`,
        kind: 'trades-due-soon',
        group: 'action-required',
        severity: overdue ? 'critical' : 'action',
        title: overdue ? 'Trades past settlement cutoff' : 'Trades need to be batched',
        message: overdue
          ? `${n} unbatched trade${plural ? 's' : ''} passed the ${fmtCutoffTime(cutoffIso)} cutoff and ${plural ? 'are' : 'is'} still unsettled.`
          : `${n} unbatched trade${plural ? 's' : ''} need settlement today. Cutoff is ${fmtCutoffTime(cutoffIso)}.`,
        reference: eligible.map((t) => t.id).join(', '),
        legalEntity: entity,
        counterparty,
        dueTime: cutoffIso,
        dueLabel: fmtDueLabel(cutoffIso, nowMs),
        remainingLabel: `${n} trade${plural ? 's' : ''} · ${fmtAmount(
          eligible.reduce((s, t) => s + t.notionalUsdc, 0),
          'USDC',
        )} gross notional`,
        owner: 'Fund Operations',
        audience: ['fund-operations'],
        action: {
          label: 'Review trades',
          kind: 'open-trades',
          highlightTradeIds: eligible.map((t) => t.id),
          filters: {
            assignment: 'unbatched',
            settlementStatus: 'unsettled',
            legalEntity: entity,
            counterparty,
          },
        },
        occurredAt: cutoffIso,
        isOverdue: overdue,
        overdueLabel: overdue ? `Overdue by ${fmtDuration(-msToCutoff)}` : null,
      });
    }
  }

  // ── Per-batch reminders ────────────────────────────────────────
  for (const b of batches) {
    const dueMs = new Date(b.dueTime).getTime();
    const msToDue = dueMs - nowMs;
    const pastDue = msToDue < 0;
    const dueLabel = fmtDueLabel(b.dueTime, nowMs);
    const openDispute = b.disputeInfo != null && !b.disputeInfo.resolvedAt;

    // ── H. Disputed batches ──────────────────────────────────────
    //
    // An exception supersedes ordinary approval and payment reminders
    // for this batch: they are not emitted below while it is open.
    if (openDispute && b.disputeInfo) {
      out.push({
        id: `exception:${b.id}:${b.disputeInfo.reportedAt}`,
        kind: 'exception',
        group: 'action-required',
        severity: 'critical',
        title: 'Settlement exception requires review',
        message:
          `${b.id} is on hold: ${b.disputeInfo.reason}. ` +
          `Agreement and payment progression are blocked until the case is resolved.`,
        reference: b.disputeInfo.relatedTradeRef
          ? `${b.id} · ${b.disputeInfo.relatedTradeRef}`
          : b.id,
        legalEntity: b.legalEntity,
        counterparty: b.counterparty,
        dueTime: b.dueTime,
        dueLabel,
        remainingLabel: null,
        owner: b.disputeInfo.owner,
        audience: ['fund-operations', 'provider-operations', 'fund-approver'],
        action: { label: 'Review exception', kind: 'open-exception', batchId: b.id },
        occurredAt: b.disputeInfo.reportedAt,
        isOverdue: pastDue,
        overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
      });
      continue; // ordinary reminders suppressed while the case is open
    }

    // ── B. Approval required ─────────────────────────────────────
    //
    // Keyed on the revision so a revision change invalidates the stale
    // approval reminder and points the approver at the current amounts.
    if (b.status === 'pending-approval') {
      const dueIn = pastDue
        ? `Settlement is overdue by ${fmtDuration(-msToDue)}.`
        : `Settlement is due in ${fmtDuration(msToDue)}.`;

      out.push({
        id: `approval-required:${b.id}:r${b.revision}`,
        kind: 'approval-required',
        group: 'action-required',
        severity: pastDue ? 'critical' : 'action',
        title: 'Batch approval required',
        message: `Batch ${b.id} (revision ${b.revision}) requires approval. ${dueIn}`,
        reference: b.id,
        legalEntity: b.legalEntity,
        counterparty: b.counterparty,
        dueTime: b.dueTime,
        dueLabel,
        remainingLabel: summarisePayables(b),
        owner: `${APPROVER_NAME} (Fund Approver)`,
        // Only the assigned independent approver sees the approval action.
        audience: ['fund-approver'],
        action: { label: 'Review batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.submittedAt ?? b.createdAt,
        isOverdue: pastDue,
        overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
      });

      // The submitting Fund Operations user sees a processing notice and
      // has no approve action — self-approval is refused by the store.
      out.push({
        id: `approval-pending:${b.id}:r${b.revision}`,
        kind: 'approval-pending',
        group: 'processing',
        severity: 'processing',
        title: `Awaiting approval from ${APPROVER_NAME}`,
        message:
          `Batch ${b.id} was submitted by ${b.submittedBy ?? 'Fund Operations'} and is waiting for ` +
          `one independent approver. You cannot approve a batch you submitted.`,
        reference: b.id,
        legalEntity: b.legalEntity,
        counterparty: b.counterparty,
        dueTime: b.dueTime,
        dueLabel,
        remainingLabel: summarisePayables(b),
        owner: `${APPROVER_NAME} (Fund Approver)`,
        audience: ['fund-operations'],
        action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.submittedAt ?? b.createdAt,
        isOverdue: pastDue,
        overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
      });
    }

    // ── C–G. Payment obligations on an approved batch ────────────
    if (OPEN_BATCH_STATUSES.includes(b.status)) {
      const pays = b.obligations.filter((o) => o.direction === 'pay');
      const receives = b.obligations.filter((o) => o.direction === 'receive');
      const outstandingPays = pays.filter((o) => o.status !== 'complete');
      const outstandingRecs = receives.filter((o) => o.status !== 'complete');

      for (const o of outstandingPays) {
        const remaining = oblAmount(o, o.remainingAmount);
        const base = {
          reference: `${b.id} · ${o.asset} ${o.network}`,
          legalEntity: b.legalEntity,
          counterparty: b.counterparty,
          dueTime: b.dueTime,
          dueLabel,
          remainingLabel: `${remaining} outstanding`,
          owner: 'Fund Operations',
          audience: ['fund-operations'] as Persona[],
          isOverdue: pastDue,
          overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
        };

        // ── D. Reported but not verified ─────────────────────────
        if (hasUnverifiedReport(o)) {
          const rep = lastReport(o);
          out.push({
            ...base,
            id: `payment-reported:${b.id}:${o.id}:${rep?.id ?? 'ref'}`,
            kind: 'payment-reported',
            group: 'processing',
            severity: 'processing',
            title: 'Payment reported — awaiting verification',
            message:
              `Reference ${rep?.reference ?? '—'} was reported for ${remaining} on ${o.asset}. ` +
              `A reported reference is not proof of receipt: the obligation stays outstanding and ` +
              `credit is not released until the movement is verified.`,
            // No "Make payment" action while a report is pending verification.
            action: { label: 'View batch', kind: 'open-batch-payments', batchId: b.id },
            occurredAt: rep?.timestamp ?? b.approvedAt ?? b.createdAt,
          });
          continue;
        }

        // ── E. Partial settlement ────────────────────────────────
        if (o.verifiedAmount > 0) {
          out.push({
            ...base,
            id: `partial-settlement:${b.id}:${o.id}`,
            kind: 'partial-settlement',
            group: 'action-required',
            severity: pastDue ? 'critical' : 'action',
            title: pastDue
              ? `Settlement overdue by ${fmtDuration(-msToDue)}`
              : 'Partial settlement',
            message:
              `${oblAmount(o, o.verifiedAmount)} of ${oblAmount(o, o.netAmount)} verified. ` +
              `${remaining} remains outstanding.`,
            action: {
              label: 'View outstanding payments',
              kind: 'open-batch-payments',
              batchId: b.id,
            },
            occurredAt: b.approvedAt ?? b.createdAt,
          });
          continue;
        }

        // ── C. Payment due (and G. overdue variant) ──────────────
        out.push({
          ...base,
          id: `payment-due:${b.id}:${o.id}`,
          kind: 'payment-due',
          group: 'action-required',
          severity: pastDue ? 'critical' : 'action',
          title: pastDue ? `Settlement overdue by ${fmtDuration(-msToDue)}` : 'Payment due',
          message: pastDue
            ? `${remaining} remains outstanding.`
            : `${remaining} remains outstanding. Due ${dueLabel}.`,
          action: {
            label: 'View outstanding payments',
            kind: 'open-batch-payments',
            batchId: b.id,
          },
          occurredAt: b.approvedAt ?? b.createdAt,
        });
      }

      // ── F. Fund's pay side done, incoming assets still pending ──
      if (outstandingPays.length === 0 && outstandingRecs.length > 0) {
        const incoming = outstandingRecs
          .map((o) => oblAmount(o, o.remainingAmount))
          .join(' and ');

        out.push({
          id: `payment-complete-waiting:${b.id}`,
          kind: 'payment-complete-waiting',
          group: 'processing',
          severity: 'processing',
          title: `Your payment is complete — waiting for ${PROVIDER_NAME}`,
          message:
            `Everything you owe on ${b.id} is verified. ${incoming} is still inbound from ` +
            `${PROVIDER_NAME}. No further payment is required from you.`,
          reference: b.id,
          legalEntity: b.legalEntity,
          counterparty: b.counterparty,
          dueTime: b.dueTime,
          dueLabel,
          remainingLabel: `${incoming} inbound`,
          owner: `${PROVIDER_NAME} (Provider Operations)`,
          audience: ['fund-operations', 'fund-approver'],
          action: { label: 'View batch', kind: 'open-batch-payments', batchId: b.id },
          occurredAt: b.approvedAt ?? b.createdAt,
          isOverdue: pastDue,
          overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
        });
      }

      // Provider-side counterpart for outstanding incoming obligations.
      for (const o of outstandingRecs) {
        out.push({
          id: `incoming-awaiting:${b.id}:${o.id}`,
          kind: 'incoming-awaiting-verification',
          group: 'action-required',
          severity: pastDue ? 'critical' : 'action',
          title: 'Incoming settlement obligation awaiting verification',
          message:
            `${oblAmount(o, o.remainingAmount)} is owed to ${b.legalEntity} on ${b.id} ` +
            `(${o.network}) and has not been verified.`,
          reference: `${b.id} · ${o.asset} ${o.network}`,
          legalEntity: b.legalEntity,
          counterparty: b.counterparty,
          dueTime: b.dueTime,
          dueLabel,
          remainingLabel: `${oblAmount(o, o.remainingAmount)} outstanding`,
          owner: `${PROVIDER_NAME} (Provider Operations)`,
          audience: ['provider-operations'],
          action: {
            label: 'View outstanding payments',
            kind: 'open-batch-payments',
            batchId: b.id,
          },
          occurredAt: b.approvedAt ?? b.createdAt,
          isOverdue: pastDue,
          overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
        });
      }
    }

    // Held by an open case after every obligation was verified.
    if (b.status === 'awaiting-reconciliation') {
      out.push({
        id: `processing-reconciliation:${b.id}:c${b.settlementCycle}`,
        kind: 'payment-complete-waiting',
        group: 'processing',
        severity: 'processing',
        title: 'Processing settlement',
        message:
          `All obligations on ${b.id} are verified. Completion is held by an open case and ` +
          `will proceed automatically once it is resolved.`,
        reference: b.id,
        legalEntity: b.legalEntity,
        counterparty: b.counterparty,
        dueTime: b.dueTime,
        dueLabel,
        remainingLabel: null,
        owner: b.disputeInfo?.owner ?? 'Provider Operations',
        audience: ['fund-operations', 'provider-operations', 'fund-approver'],
        action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.lastUpdatedAt,
        isOverdue: pastDue,
        overdueLabel: pastDue ? `Overdue by ${fmtDuration(-msToDue)}` : null,
      });
    }
  }

  return out;
}

/** "940,000.00 USDC payable" — compact payable summary for a batch. */
function summarisePayables(b: SettlementBatch): string | null {
  const pays = b.obligations.filter((o) => o.direction === 'pay');
  if (pays.length === 0) return null;
  return pays.map((o) => oblAmount(o, o.netAmount)).join(' + ') + ' payable';
}

// ────────────────────────────────────────────────────────────────
// Resolved history — derived from terminal facts in state
// ────────────────────────────────────────────────────────────────

function deriveResolved(ctx: ReminderContext): Reminder[] {
  const { batches, nowMs } = ctx;
  const out: Reminder[] = [];

  for (const b of batches) {
    const dueLabel = fmtDueLabel(b.dueTime, nowMs);
    const common = {
      reference: b.id,
      legalEntity: b.legalEntity,
      counterparty: b.counterparty,
      dueTime: b.dueTime,
      dueLabel,
      group: 'resolved' as const,
      severity: 'resolved' as const,
      isOverdue: false,
      overdueLabel: null,
    };

    // Batching reminder resolved once the trades were batched.
    out.push({
      ...common,
      id: `resolved-batched:${b.id}`,
      kind: 'trades-due-soon',
      title: 'Trades batched',
      message: `${b.tradeIds.length} trade${b.tradeIds.length !== 1 ? 's' : ''} were batched into ${b.id}.`,
      remainingLabel: null,
      owner: 'Fund Operations',
      audience: ['fund-operations', 'fund-approver', 'provider-operations'],
      action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
      occurredAt: b.createdAt,
    });

    // Approval reminder resolved at approval.
    if (b.approvedAt) {
      out.push({
        ...common,
        id: `resolved-approval:${b.id}:r${b.approvedRevision ?? b.revision}`,
        kind: 'approval-required',
        title: 'Batch approved',
        message:
          `${b.id} revision ${b.approvedRevision ?? b.revision} was approved by ${b.approvedBy ?? APPROVER_NAME}.`,
        remainingLabel: null,
        owner: b.approvedBy ?? APPROVER_NAME,
        audience: ['fund-operations', 'fund-approver'],
        action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.approvedAt,
      });
    }

    // Each completed obligation.
    for (const o of b.obligations.filter((x) => x.status === 'complete')) {
      out.push({
        ...common,
        id: `resolved-obligation:${b.id}:${o.id}`,
        kind: o.direction === 'pay' ? 'payment-due' : 'incoming-awaiting-verification',
        title: o.direction === 'pay' ? 'Payment verified' : 'Incoming assets verified',
        message: `${oblAmount(o, o.netAmount)} on ${o.asset} (${o.network}) fully verified for ${b.id}.`,
        reference: `${b.id} · ${o.asset} ${o.network}`,
        remainingLabel: null,
        owner: o.direction === 'pay' ? 'Fund Operations' : `${PROVIDER_NAME} (Provider Operations)`,
        audience: ['fund-operations', 'fund-approver', 'provider-operations'],
        action: { label: 'View batch', kind: 'open-batch-payments', batchId: b.id },
        occurredAt:
          [...o.paymentEvents].reverse().find((e) => e.type === 'verified')?.timestamp ??
          b.lastUpdatedAt,
      });
    }

    // A resolved exception is preserved in history.
    if (b.disputeInfo?.resolvedAt) {
      out.push({
        ...common,
        id: `resolved-exception:${b.id}:${b.disputeInfo.reportedAt}`,
        kind: 'exception',
        title: 'Settlement exception resolved',
        message:
          `${b.id}: ${b.disputeInfo.reason} — resolved by ${b.disputeInfo.resolvedBy ?? 'Provider Operations'}.` +
          (b.disputeInfo.resolutionNote ? ` ${b.disputeInfo.resolutionNote}` : ''),
        remainingLabel: null,
        owner: b.disputeInfo.resolvedBy ?? 'Provider Operations',
        audience: ['fund-operations', 'provider-operations', 'fund-approver'],
        action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.disputeInfo.resolvedAt,
      });
    }

    // ── I. Completed settlement ──────────────────────────────────
    if (b.status === 'settled' && b.reconciledAt) {
      out.push({
        ...common,
        id: `resolved-settled:${b.id}:c${b.settlementCycle}`,
        kind: 'settled',
        title: 'Batch settled',
        message: `All obligations on ${b.id} reconciled. Credit capacity restored.`,
        remainingLabel: null,
        owner: 'System',
        audience: ['fund-operations', 'fund-approver', 'provider-operations', 'fund-trader'],
        action: { label: 'View batch', kind: 'open-batch', batchId: b.id },
        occurredAt: b.reconciledAt,
      });
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export interface DerivedReminders {
  /** Everything addressed to the current persona, active + resolved. */
  all: Reminder[];
  actionRequired: Reminder[];
  processing: Reminder[];
  resolved: Reminder[];
  /** Unread count across active groups only — history never nags. */
  unreadCount: number;
  /** True when any active reminder for this persona is critical/overdue. */
  hasCritical: boolean;
}

function sortReminders(list: Reminder[]): Reminder[] {
  // Operations queue ordering: severity, then overdue, then soonest due.
  return [...list].sort((a, b) => {
    const sev = SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank;
    if (sev !== 0) return sev;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    const ad = a.dueTime ? new Date(a.dueTime).getTime() : Infinity;
    const bd = b.dueTime ? new Date(b.dueTime).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
}

/**
 * Derive every reminder for the given state, then narrow to the personas
 * audience. The underlying set is shared — switching persona changes only
 * which slice is visible, never the shared state.
 */
export function deriveReminders(
  ctx: ReminderContext,
  persona: Persona,
  readIds: readonly string[],
): DerivedReminders {
  const read = new Set(readIds);

  const active = deriveActive(ctx);
  const activeIds = new Set(active.map((r) => r.id));

  // A resolved entry is suppressed while the same underlying event still
  // has an active reminder, so an item is never in two groups at once.
  const resolvedAll = deriveResolved(ctx).filter((r) => !activeIds.has(r.id));

  const forPersona = (r: Reminder) => r.audience.includes(persona);

  const actionRequired = sortReminders(
    active.filter((r) => r.group === 'action-required' && forPersona(r)),
  );
  const processing = sortReminders(
    active.filter((r) => r.group === 'processing' && forPersona(r)),
  );
  const resolved = [...resolvedAll.filter(forPersona)].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const unreadCount = [...actionRequired, ...processing].filter((r) => !read.has(r.id)).length;
  const hasCritical = actionRequired.some((r) => r.severity === 'critical' || r.isOverdue);

  return {
    all: [...actionRequired, ...processing, ...resolved],
    actionRequired,
    processing,
    resolved,
    unreadCount,
    hasCritical,
  };
}

export function isReminderRead(r: Reminder, readIds: readonly string[]): boolean {
  return readIds.includes(r.id);
}
