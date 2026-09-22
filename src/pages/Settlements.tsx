import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { BatchList } from '../components/BatchList';
import { BatchDetail } from '../components/BatchDetail';
import { TradesTab } from '../components/TradesTab';
import { useStore } from '../store/store';

type Tab = 'trades' | 'batches';

export function Settlements() {
  const { batchId } = useParams<{ batchId?: string }>();

  // Default to Trades tab when no batch is selected
  const [tab, setTab] = useState<Tab>('trades');

  const trades  = useStore((s) => s.trades);
  const batches = useStore((s) => s.batches);

  // Tab badge counts
  const unbatchedCount   = trades.filter((t) => t.batchId === null).length;
  const pendingBatches   = batches.filter((b) => b.status === 'needs-review' || b.status === 'disputed').length;

  // Action-count strip counts
  const readyToBatch     = trades.filter((t) => t.batchId === null && t.settlementStatus === 'unsettled').length;
  const awaitingApproval = batches.filter((b) => b.status === 'pending-approval').length;
  const paymentDue       = batches.filter((b) => b.status === 'awaiting-payment' || b.status === 'partially-settled').length;
  const exceptions       = batches.filter((b) => b.status === 'disputed').length;

  if (batchId) {
    return (
      <div className="space-y-4">
        <BatchDetail batchId={batchId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Settlement Operations</h1>
        <span className="text-xs text-slate-400">Concept demo — simulated data</span>
      </div>

      {/* Action-count strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <ActionCount
          label="Ready to batch"
          count={readyToBatch}
          unit="trade"
          onClick={() => setTab('trades')}
          color="amber"
        />
        <ActionCount
          label="Awaiting approval"
          count={awaitingApproval}
          unit="batch"
          onClick={() => setTab('batches')}
          color="blue"
        />
        <ActionCount
          label="Payment due"
          count={paymentDue}
          unit="batch"
          onClick={() => setTab('batches')}
          color="orange"
        />
        <ActionCount
          label="Exceptions"
          count={exceptions}
          unit="case"
          onClick={() => setTab('batches')}
          color="red"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-wm-frost">
        <TabButton
          active={tab === 'trades'}
          onClick={() => setTab('trades')}
          label="Trades"
          badge={unbatchedCount > 0 ? unbatchedCount : undefined}
          badgeTitle="Unbatched trades"
        />
        <TabButton
          active={tab === 'batches'}
          onClick={() => setTab('batches')}
          label="Batches"
          badge={pendingBatches > 0 ? pendingBatches : undefined}
          badgeTitle="Needs attention"
        />
      </div>

      {/* Tab content */}
      {tab === 'trades'   && <TradesTab />}
      {tab === 'batches'  && <BatchList />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
  badgeTitle,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  badgeTitle?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
        active
          ? 'border-wm-green text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-wm-frost',
      )}
    >
      {label}
      {badge !== undefined && (
        <span
          title={badgeTitle}
          className="bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

type CountColor = 'amber' | 'blue' | 'orange' | 'red';

function ActionCount({
  label,
  count,
  unit,
  onClick,
  color,
}: {
  label: string;
  count: number;
  unit: string;
  onClick: () => void;
  color: CountColor;
}) {
  const colorMap: Record<CountColor, { bg: string; num: string; border: string }> = {
    amber:  { bg: 'bg-amber-50',  num: 'text-amber-700',  border: 'border-amber-200' },
    blue:   { bg: 'bg-blue-50',   num: 'text-blue-700',   border: 'border-blue-200' },
    orange: { bg: 'bg-orange-50', num: 'text-orange-700', border: 'border-orange-200' },
    red:    { bg: 'bg-red-50',    num: 'text-red-700',    border: 'border-red-200' },
  };
  const c = colorMap[color];
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-lg border p-3 text-left transition-colors hover:brightness-95',
        c.bg, c.border,
        count === 0 && 'opacity-50',
      )}
    >
      <p className={clsx('text-2xl font-bold tabnum', c.num)}>{count}</p>
      <p className="text-xs text-slate-600 mt-0.5">{label} {count !== 1 ? unit + 's' : unit}</p>
    </button>
  );
}
