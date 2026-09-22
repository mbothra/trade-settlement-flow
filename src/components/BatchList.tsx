import { useState } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { StatusBadge } from './StatusBadge';
import type { BatchStatus, SettlementBatch } from '../store/types';

const STATUS_FILTERS: { label: string; value: BatchStatus | 'all' }[] = [
  { label: 'All',                    value: 'all' },
  { label: 'Needs Review',           value: 'needs-review' },
  { label: 'Pending Approval',       value: 'pending-approval' },
  { label: 'Awaiting Payment',       value: 'awaiting-payment' },
  { label: 'Partially Settled',      value: 'partially-settled' },
  { label: 'Awaiting Reconciliation',value: 'awaiting-reconciliation' },
  { label: 'Settled',                value: 'settled' },
  { label: 'Disputed',               value: 'disputed' },
];

function fmtUsdc(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAsset(n: number, asset: string): string {
  const dp = asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : 2;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: dp })} ${asset}`;
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function nextAction(batch: SettlementBatch): string {
  switch (batch.status) {
    case 'needs-review':            return batch.disputeInfo && !batch.disputeInfo.resolvedAt ? 'Awaiting provider resolution' : 'Review & submit';
    case 'pending-approval':        return 'Awaiting approval';
    case 'awaiting-payment':        return 'Initiate payment';
    case 'partially-settled':       return 'Confirm remaining';
    case 'awaiting-reconciliation': return 'Trigger reconciliation';
    case 'settled':                 return batch.creditUpdatePending ? 'Apply Risk update' : '—';
    case 'disputed':                return 'Resolve discrepancy';
  }
}

function exportCsv(batch: SettlementBatch, allTrades: any[]) {
  const header = ['Batch', 'Trade Ref', 'Timestamp', 'Pair', 'Side', 'Quantity', 'Price (USDC)', 'Notional (USDC)'];
  const rows   = allTrades
    .filter((t: any) => batch.tradeIds.includes(t.id))
    .map((t: any) => [
      batch.id,
      t.id,
      t.timestamp,
      t.pair,
      t.side.toUpperCase(),
      t.baseQuantity,
      t.executedPrice,
      t.notionalUsdc,
    ]);
  const csv  = [header, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${batch.id}-trades.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BatchList() {
  const [filter, setFilter] = useState<BatchStatus | 'all'>('all');
  // Select raw arrays — do NOT spread/reverse inside the selector (useSyncExternalStore stability)
  const batches = useStore((s) => s.batches);
  const trades  = useStore((s) => s.trades);
  const navigate = useNavigate();

  const reversedBatches = [...batches].reverse();
  const filtered = filter === 'all' ? reversedBatches : reversedBatches.filter((b) => b.status === filter);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-wm-night text-wm-green border border-wm-graphite'
                : 'bg-white border border-wm-frost text-slate-600 hover:bg-wm-horizon',
            )}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className="ml-1.5 text-[10px] opacity-60">
                {batches.filter((b) => b.status === f.value).length}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => { if (filtered.length > 0) exportCsv(filtered[0], trades); }}
            disabled={filtered.length === 0}
            className="btn-secondary btn btn-sm"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card px-4 py-12 text-center text-sm text-slate-400">
          {batches.length === 0
            ? 'No settlement batches yet. Go to Settlements → Trades and batch your trades.'
            : 'No batches match this filter.'}
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Entity</th>
                <th>Window</th>
                <th>Due</th>
                <th className="text-right">Trades</th>
                <th>You Pay</th>
                <th>You Receive</th>
                <th>Status</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((batch) => {
                const payObls = batch.obligations.filter((o) => o.direction === 'pay');
                const recObls = batch.obligations.filter((o) => o.direction === 'receive');
                return (
                  <tr
                    key={batch.id}
                    onClick={() => navigate(`/settlements/${batch.id}`)}
                    className="cursor-pointer"
                  >
                    <td>
                      <span className="font-mono text-xs font-medium text-wm-green">{batch.id}</span>
                      {batch.name && (
                        <span className="ml-1.5 text-xs text-slate-500">{batch.name}</span>
                      )}
                      {batch.revision > 1 && (
                        <span className="ml-1.5 text-[10px] text-slate-400">rev {batch.revision}</span>
                      )}
                      {batch.isMissingTradeScenario && (
                        <span className="ml-1.5 badge bg-orange-100 text-orange-700 text-[10px]">⚠ missing trade</span>
                      )}
                      {batch.creditUpdatePending && (
                        <span className="ml-1.5 badge bg-violet-50 text-violet-700 text-[10px]">⚙ risk update</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-600">{batch.legalEntity}</td>
                    <td className="text-xs text-slate-500">{batch.settlementWindow}</td>
                    <td className="text-xs tabnum text-slate-500 whitespace-nowrap">{formatDue(batch.dueTime)}</td>
                    <td className="text-right tabnum">{batch.tradeIds.length}</td>
                    <td>
                      {payObls.map((o) => (
                        <div key={o.id} className="text-xs tabnum">
                          {o.asset === 'USDC' ? fmtUsdc(o.netAmount) + ' USDC' : fmtAsset(o.netAmount, o.asset)}
                        </div>
                      ))}
                    </td>
                    <td>
                      {recObls.map((o) => (
                        <div key={o.id} className="text-xs tabnum text-[#00C040]">
                          {fmtAsset(o.netAmount, o.asset)}
                        </div>
                      ))}
                    </td>
                    <td><StatusBadge status={batch.status} /></td>
                    <td className="text-xs text-slate-500">{nextAction(batch)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
