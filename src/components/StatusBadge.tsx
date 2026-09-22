import { clsx } from 'clsx';
import type { BatchStatus, TradeSettlementStatus } from '../store/types';

// ── Batch workflow status badges ──────────────────────────────────

const BATCH_CONFIG: Record<BatchStatus, { label: string; className: string; icon: string }> = {
  'needs-review':            { label: 'Needs Review',            className: 'bg-amber-50 text-amber-700 border border-amber-200',       icon: '⏳' },
  'pending-approval':        { label: 'Pending Approval',        className: 'bg-blue-50 text-blue-700 border border-blue-200',           icon: '🔍' },
  'awaiting-payment':        { label: 'Awaiting Payment',        className: 'bg-purple-50 text-purple-700 border border-purple-200',     icon: '💳' },
  'partially-settled':       { label: 'Partially Settled',       className: 'bg-indigo-50 text-indigo-700 border border-indigo-200',     icon: '⟳' },
  'awaiting-reconciliation': { label: 'Awaiting Reconciliation', className: 'bg-violet-50 text-violet-700 border border-violet-200',     icon: '⚙' },
  'settled':                 { label: 'Settled',                 className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  icon: '✓' },
  'disputed':                { label: 'Disputed',                className: 'bg-red-50 text-red-700 border border-red-200',              icon: '⚠' },
};

interface BatchBadgeProps {
  status: BatchStatus;
  className?: string;
  showIcon?: boolean;
}

export function StatusBadge({ status, className, showIcon = true }: BatchBadgeProps) {
  const { label, className: cls, icon } = BATCH_CONFIG[status] ?? BATCH_CONFIG['needs-review'];
  return (
    <span className={clsx('badge font-medium', cls, className)}>
      {showIcon && <span aria-hidden>{icon}</span>}
      {label}
    </span>
  );
}

// ── Trade settlement status badges ────────────────────────────────

const TRADE_CONFIG: Record<TradeSettlementStatus, { label: string; className: string }> = {
  'unsettled':         { label: 'Unsettled',         className: 'bg-slate-100 text-slate-500 border border-slate-200' },
  'partially-settled': { label: 'Partial',           className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  'settled':           { label: 'Settled',           className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
};

interface TradeStatusBadgeProps {
  status: TradeSettlementStatus;
  className?: string;
}

export function TradeStatusBadge({ status, className }: TradeStatusBadgeProps) {
  const { label, className: cls } = TRADE_CONFIG[status] ?? TRADE_CONFIG['unsettled'];
  return (
    <span className={clsx('badge font-medium', cls, className)}>
      {label}
    </span>
  );
}
