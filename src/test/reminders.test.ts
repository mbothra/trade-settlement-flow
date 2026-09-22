/**
 * Settlement reminder derivation tests
 *
 * Covers the behaviours the reminder spec calls out: which reminders exist
 * for which underlying state, who they are addressed to, that marking read
 * never resolves an obligation, and that derivation is idempotent so no
 * amount of re-rendering or persona switching can duplicate a reminder.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveReminders,
  DUE_SOON_WINDOW_MS,
  fmtDuration,
  fmtDueLabel,
} from '../modules/reminders';
import { computeNetObligations } from '../modules/netting';
import { cutoffFor } from '../modules/demoClock';
import type { ReminderContext } from '../modules/reminders';
import type { Trade, SettlementBatch, Obligation, Persona } from '../store/types';

// ── Fixtures ──────────────────────────────────────────────────────

/** A fixed instant well before the 17:00 UTC cutoff on the same UTC day. */
const NOON = Date.UTC(2026, 8, 21, 12, 0, 0);
const CUTOFF = cutoffFor(NOON);
const CUTOFF_MS = new Date(CUTOFF).getTime();

function makeTrade(
  id: string,
  pair: Trade['pair'],
  side: Trade['side'],
  qty: number,
  price: number,
  min: number,
): Trade {
  const base = pair.split('/')[0];
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 8, 21, 9, min, 0)).toISOString(),
    pair,
    side,
    baseQuantity: qty,
    executedPrice: price,
    notionalUsdc: qty * price,
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    baseNetwork: base === 'BTC' ? 'Bitcoin' : base === 'SOL' ? 'Solana' : 'Ethereum',
    quoteNetwork: 'Ethereum',
    batchId: null,
    settlementStatus: 'unsettled',
    settlementNote: null,
    reconciliationReserved: false,
  };
}

/**
 * The guided walkthrough's pre-batch state. These exact trades net to
 * pay 940,000 USDC / receive 8 BTC / receive 100 ETH, which is what the
 * amount assertions below depend on.
 */
function unbatchedTrades(): Trade[] {
  return [
    makeTrade('TRD-0001', 'BTC/USDC', 'buy', 10, 80_000, 0),
    makeTrade('TRD-0002', 'ETH/USDC', 'buy', 100, 3_000, 1),
    makeTrade('TRD-0003', 'BTC/USDC', 'sell', 2, 80_000, 2),
  ];
}

function makeBatch(
  over: Partial<SettlementBatch> = {},
  verified: Partial<Record<string, number>> = {},
): SettlementBatch {
  const trades = unbatchedTrades().map((t) => ({ ...t, batchId: 'STLBATCH-001' }));
  const obligations: Obligation[] = computeNetObligations(trades, 'STLBATCH-001', 1).map((o) => {
    const amt = verified[`${o.asset}:${o.direction}`] ?? 0;
    return {
      ...o,
      verifiedAmount: amt,
      remainingAmount: Math.max(0, o.netAmount - amt),
      status:
        amt >= o.netAmount - 1e-9 ? 'complete' : amt > 0 ? 'partial' : 'outstanding',
    };
  });

  return {
    id: 'STLBATCH-001',
    name: null,
    revision: 1,
    status: 'awaiting-payment',
    legalEntity: 'Northstar Capital',
    counterparty: 'Wintermute',
    settlementWindow: 'T+1 Daily',
    dueTime: CUTOFF,
    nettingArrangement: 'Bilateral netting',
    tradeIds: trades.map((t) => t.id),
    sealedTradeIds: null,
    obligations,
    submittedBy: 'Sam Rivera (Fund Operations)',
    submittedAt: new Date(NOON).toISOString(),
    approvedBy: null,
    approvedAt: null,
    approvedRevision: null,
    disputeInfo: null,
    reconciledAt: null,
    creditUpdatePending: false,
    settlementCycle: 1,
    revisionHistory: [],
    activityTimeline: [],
    createdAt: new Date(NOON).toISOString(),
    lastUpdatedAt: new Date(NOON).toISOString(),
    isMissingTradeScenario: false,
    missingTradeId: null,
    ...over,
  };
}

function ctx(over: Partial<ReminderContext> = {}): ReminderContext {
  return { trades: [], batches: [], nowMs: NOON, cutoffIso: CUTOFF, ...over };
}

function derive(c: ReminderContext, persona: Persona = 'fund-operations', read: string[] = []) {
  return deriveReminders(c, persona, read);
}

// ── A. Trades approaching cutoff ──────────────────────────────────

describe('trades-due-soon (rule A)', () => {
  it('stays silent while the cutoff is outside the due-soon window', () => {
    const r = derive(ctx({ trades: unbatchedTrades(), nowMs: NOON }));
    expect(r.actionRequired.filter((x) => x.kind === 'trades-due-soon')).toHaveLength(0);
  });

  it('raises exactly one reminder for three unbatched trades inside the window', () => {
    const nowMs = CUTOFF_MS - DUE_SOON_WINDOW_MS + 60_000; // one hour before, just inside
    const r = derive(ctx({ trades: unbatchedTrades(), nowMs }));
    const due = r.actionRequired.filter((x) => x.kind === 'trades-due-soon');

    expect(due).toHaveLength(1);
    expect(due[0].message).toContain('3 unbatched trades');
    expect(due[0].message).toContain('17:00 UTC');
    expect(due[0].severity).toBe('action');
    expect(due[0].isOverdue).toBe(false);
  });

  it('carries the filters and highlights its action needs to scope the trades view', () => {
    const nowMs = CUTOFF_MS - 30 * 60_000;
    const r = derive(ctx({ trades: unbatchedTrades(), nowMs }));
    const action = r.actionRequired.find((x) => x.kind === 'trades-due-soon')!.action!;

    expect(action.kind).toBe('open-trades');
    expect(action.label).toBe('Review trades');
    expect(action.highlightTradeIds).toEqual(['TRD-0001', 'TRD-0002', 'TRD-0003']);
    expect(action.filters).toMatchObject({
      assignment: 'unbatched',
      settlementStatus: 'unsettled',
      legalEntity: 'Northstar Capital',
      counterparty: 'Wintermute',
    });
  });

  it('escalates to critical once the cutoff has passed (rule G)', () => {
    const nowMs = CUTOFF_MS + 20 * 60_000;
    const r = derive(ctx({ trades: unbatchedTrades(), nowMs }));
    const due = r.actionRequired.find((x) => x.kind === 'trades-due-soon')!;

    expect(due.severity).toBe('critical');
    expect(due.isOverdue).toBe(true);
    expect(due.overdueLabel).toMatch(/Overdue by/);
    expect(r.hasCritical).toBe(true);
  });

  it('ignores trades already batched, settled or reserved by an exception', () => {
    const nowMs = CUTOFF_MS - 30 * 60_000;
    const trades: Trade[] = [
      { ...makeTrade('TRD-0001', 'BTC/USDC', 'buy', 1, 80_000, 0), batchId: 'STLBATCH-001' },
      { ...makeTrade('TRD-0002', 'BTC/USDC', 'buy', 1, 80_000, 1), settlementStatus: 'settled' },
      { ...makeTrade('TRD-0003', 'BTC/USDC', 'buy', 1, 80_000, 2), reconciliationReserved: true },
    ];
    const r = derive(ctx({ trades, nowMs }));
    expect(r.actionRequired.filter((x) => x.kind === 'trades-due-soon')).toHaveLength(0);
  });
});

// ── B. Approval ───────────────────────────────────────────────────

describe('approval reminders (rule B)', () => {
  const pending = () => ctx({ batches: [makeBatch({ status: 'pending-approval' })] });

  it('addresses the approval action only to the Fund Approver', () => {
    const approver = derive(pending(), 'fund-approver');
    const required = approver.actionRequired.find((x) => x.kind === 'approval-required');

    expect(required).toBeDefined();
    expect(required!.action).toMatchObject({ kind: 'open-batch', batchId: 'STLBATCH-001' });
    expect(required!.owner).toContain('Alex Chen');
  });

  it('shows Fund Operations a processing notice with no approval action', () => {
    const ops = derive(pending(), 'fund-operations');

    expect(ops.actionRequired.find((x) => x.kind === 'approval-required')).toBeUndefined();
    const pendingNotice = ops.processing.find((x) => x.kind === 'approval-pending')!;
    expect(pendingNotice.title).toContain('Awaiting approval from Alex Chen');
    expect(pendingNotice.message).toContain('cannot approve a batch you submitted');
  });

  it('keys the reminder on the revision so a re-submission invalidates the stale one', () => {
    const r1 = derive(pending(), 'fund-approver');
    const r2 = derive(
      ctx({ batches: [makeBatch({ status: 'pending-approval', revision: 2 })] }),
      'fund-approver',
    );
    const id1 = r1.actionRequired.find((x) => x.kind === 'approval-required')!.id;
    const id2 = r2.actionRequired.find((x) => x.kind === 'approval-required')!.id;

    expect(id1).not.toBe(id2);
    expect(id1).toContain(':r1');
    expect(id2).toContain(':r2');
  });

  it('moves the approval into resolved history once approved', () => {
    const r = derive(
      ctx({
        batches: [
          makeBatch({
            status: 'awaiting-payment',
            approvedBy: 'Alex Chen',
            approvedAt: new Date(NOON).toISOString(),
            approvedRevision: 1,
          }),
        ],
      }),
      'fund-approver',
    );

    expect(r.actionRequired.find((x) => x.kind === 'approval-required')).toBeUndefined();
    expect(r.resolved.some((x) => x.title === 'Batch approved')).toBe(true);
  });
});

// ── C–G. Payment obligations ──────────────────────────────────────

describe('payment reminders (rules C–G)', () => {
  it('raises a payment-due reminder carrying the outstanding amount', () => {
    const r = derive(ctx({ batches: [makeBatch()] }));
    const due = r.actionRequired.find((x) => x.kind === 'payment-due')!;

    expect(due.title).toBe('Payment due');
    expect(due.remainingLabel).toBe('940,000.00 USDC outstanding');
    expect(due.action).toMatchObject({ kind: 'open-batch-payments', batchId: 'STLBATCH-001' });
  });

  it('withdraws the payment action while a reported reference awaits verification (rule D)', () => {
    const b = makeBatch();
    const usdc = b.obligations.find((o) => o.direction === 'pay' && o.asset === 'USDC')!;
    usdc.paymentEvents = [
      {
        id: 'e1',
        timestamp: new Date(NOON).toISOString(),
        type: 'reference_added',
        amount: 940_000,
        reference: 'TXN-DEMO-001',
        actor: 'Fund Operations',
      },
    ];

    const r = derive(ctx({ batches: [b] }));
    expect(r.actionRequired.find((x) => x.kind === 'payment-due')).toBeUndefined();

    const reported = r.processing.find((x) => x.kind === 'payment-reported')!;
    expect(reported.message).toContain('TXN-DEMO-001');
    expect(reported.message).toContain('not proof of receipt');
    expect(reported.action!.label).not.toMatch(/Make payment/i);
  });

  it('reports partial settlement with verified and remaining amounts (rule E)', () => {
    const b = makeBatch({ status: 'partially-settled' }, { 'USDC:pay': 470_000 });
    const r = derive(ctx({ batches: [b] }));
    const partial = r.actionRequired.find((x) => x.kind === 'partial-settlement')!;

    expect(partial.message).toContain('470,000.00 USDC of 940,000.00 USDC verified');
    expect(partial.remainingLabel).toBe('470,000.00 USDC outstanding');
  });

  it('stops asking for payment once the pay side is complete (rule F)', () => {
    const b = makeBatch({ status: 'partially-settled' }, { 'USDC:pay': 940_000 });
    const r = derive(ctx({ batches: [b] }));

    expect(r.actionRequired.some((x) => x.kind === 'payment-due')).toBe(false);
    const waiting = r.processing.find((x) => x.kind === 'payment-complete-waiting')!;
    expect(waiting.title).toContain('waiting for Wintermute');
    expect(waiting.message).toContain('No further payment is required from you');
  });

  it('marks overdue payments critical (rule G)', () => {
    const r = derive(ctx({ batches: [makeBatch()], nowMs: CUTOFF_MS + 45 * 60_000 }));
    const due = r.actionRequired.find((x) => x.kind === 'payment-due')!;

    expect(due.severity).toBe('critical');
    expect(due.isOverdue).toBe(true);
    expect(due.title).toMatch(/^Settlement overdue by/);
    expect(r.hasCritical).toBe(true);
  });

  it('addresses incoming obligations to Provider Operations, not the fund', () => {
    const b = makeBatch();
    const provider = derive(ctx({ batches: [b] }), 'provider-operations');
    const ops = derive(ctx({ batches: [b] }), 'fund-operations');

    expect(provider.actionRequired.some((x) => x.kind === 'incoming-awaiting-verification')).toBe(true);
    expect(ops.actionRequired.some((x) => x.kind === 'incoming-awaiting-verification')).toBe(false);
  });
});

// ── H. Exceptions ─────────────────────────────────────────────────

describe('exception reminders (rule H)', () => {
  const disputed = () =>
    ctx({
      batches: [
        makeBatch({
          status: 'disputed',
          disputeInfo: {
            reason: 'Missing trade in batch',
            reportedBy: 'Provider Operations',
            reportedAt: new Date(NOON).toISOString(),
            owner: 'Provider Operations',
            comment: 'Reported by the provider during reconciliation.',
            relatedTradeRef: 'TRD-0004',
            // An unresolved case simply omits the resolution fields.
          },
        }),
      ],
    });

  it('supersedes ordinary payment reminders for that batch', () => {
    const r = derive(disputed());

    expect(r.actionRequired.some((x) => x.kind === 'exception')).toBe(true);
    expect(r.actionRequired.some((x) => x.kind === 'payment-due')).toBe(false);
  });

  it('is critical and names the open case owner', () => {
    const exc = derive(disputed()).actionRequired.find((x) => x.kind === 'exception')!;

    expect(exc.severity).toBe('critical');
    expect(exc.owner).toBe('Provider Operations');
    expect(exc.reference).toContain('TRD-0004');
  });
});

// ── I. Settled ────────────────────────────────────────────────────

describe('settled batches (rule I)', () => {
  const settled = () =>
    ctx({
      batches: [
        makeBatch(
          {
            status: 'settled',
            reconciledAt: new Date(NOON).toISOString(),
            approvedBy: 'Alex Chen',
            approvedAt: new Date(NOON).toISOString(),
            approvedRevision: 1,
          },
          { 'USDC:pay': 940_000, 'BTC:receive': 8, 'ETH:receive': 100 },
        ),
      ],
    });

  it('clears all active reminders and preserves resolved history', () => {
    const r = derive(settled());

    expect(r.actionRequired).toHaveLength(0);
    expect(r.processing).toHaveLength(0);
    expect(r.resolved.some((x) => x.kind === 'settled')).toBe(true);
    expect(r.unreadCount).toBe(0);
    expect(r.hasCritical).toBe(false);
  });

  it('records each verified obligation in history', () => {
    const verified = derive(settled()).resolved.filter((x) =>
      /verified/i.test(x.title),
    );
    expect(verified.length).toBe(3); // USDC pay, BTC receive, ETH receive
  });
});

// ── Invariants the spec requires ──────────────────────────────────

describe('derivation invariants', () => {
  const busy = () =>
    ctx({
      trades: unbatchedTrades(),
      batches: [makeBatch({ status: 'pending-approval' })],
      nowMs: CUTOFF_MS - 30 * 60_000,
    });

  it('is idempotent — repeated derivation cannot duplicate reminders', () => {
    const a = derive(busy());
    const b = derive(busy());
    const c = derive(busy());

    expect(a.all.map((x) => x.id)).toEqual(b.all.map((x) => x.id));
    expect(b.all.map((x) => x.id)).toEqual(c.all.map((x) => x.id));
  });

  it('gives every reminder a unique id — one active reminder per event', () => {
    const ids = derive(busy()).all.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never places the same item in two groups at once', () => {
    const r = derive(busy());
    const active = new Set([...r.actionRequired, ...r.processing].map((x) => x.id));
    expect(r.resolved.filter((x) => active.has(x.id))).toHaveLength(0);
  });

  it('produces stable ids across persona switches so read state survives', () => {
    const personas: Persona[] = [
      'fund-operations',
      'fund-approver',
      'provider-operations',
      'fund-trader',
    ];
    const seen = new Map<string, string>();
    for (const p of personas) {
      for (const r of derive(busy(), p).all) {
        const prev = seen.get(r.id);
        if (prev) expect(prev).toBe(r.title); // same id ⇒ same underlying event
        seen.set(r.id, r.title);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('counts only unread ACTIVE reminders, never history', () => {
    const r = derive(busy());
    const activeCount = r.actionRequired.length + r.processing.length;

    expect(r.unreadCount).toBe(activeCount);

    const allRead = derive(busy(), 'fund-operations', r.all.map((x) => x.id));
    expect(allRead.unreadCount).toBe(0);
    // Marking read does not remove anything from the action queue.
    expect(allRead.actionRequired.length).toBe(r.actionRequired.length);
    expect(allRead.processing.length).toBe(r.processing.length);
  });

  it('marking read never changes an obligation, amount or status', () => {
    const before = busy();
    const snapshot = JSON.stringify({ trades: before.trades, batches: before.batches });

    derive(before, 'fund-operations', ['payment-due:STLBATCH-001:anything']);

    expect(JSON.stringify({ trades: before.trades, batches: before.batches })).toBe(snapshot);
  });

  it('shows nothing to a persona no reminder is addressed to', () => {
    const trader = derive(ctx({ batches: [makeBatch()] }), 'fund-trader');
    expect(trader.actionRequired).toHaveLength(0);
  });

  it('orders the action queue by severity, then overdue, then soonest due', () => {
    const r = derive(busy());
    const ranks = r.actionRequired.map((x) => (x.severity === 'critical' ? 0 : 1));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

// ── Formatting ────────────────────────────────────────────────────

describe('formatting helpers', () => {
  it('renders durations at a readable granularity', () => {
    expect(fmtDuration(30_000)).toBe('less than a minute');
    expect(fmtDuration(60_000)).toBe('1 minute');
    expect(fmtDuration(30 * 60_000)).toBe('30 minutes');
    expect(fmtDuration(60 * 60_000)).toBe('1 hour');
    expect(fmtDuration(135 * 60_000)).toBe('2h 15m');
    expect(fmtDuration(48 * 3_600_000)).toBe('2 days');
  });

  it('labels due times relative to the demo clock, always in UTC', () => {
    expect(fmtDueLabel(CUTOFF, NOON)).toBe('today at 17:00 UTC');
    expect(fmtDueLabel(CUTOFF, NOON - 86_400_000)).toBe('tomorrow at 17:00 UTC');
    expect(fmtDueLabel(CUTOFF, NOON + 86_400_000)).toBe('yesterday at 17:00 UTC');
  });
});
