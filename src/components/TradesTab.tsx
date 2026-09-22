/**
 * Settlements → Trades tab
 *
 * Filter, checkbox-select, and batch unbatched trades.
 * Concept demo — simulated data.
 */

import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { TradeStatusBadge } from './StatusBadge';
import { computeNetObligations } from '../modules/netting';
import type { Trade, TradingPair, Side, TradeSettlementStatus } from '../store/types';

// ── Formatting ────────────────────────────────────────────────────

function fmtUsdc(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAsset(n: number, asset: string) {
  const dp = asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : 4;
  return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ── Create Batch Modal ────────────────────────────────────────────

function CreateBatchModal({
  selectedTrades,
  onClose,
}: {
  selectedTrades: Trade[];
  onClose: () => void;
}) {
  const [batchName, setBatchName] = useState('');
  const [error, setError]         = useState('');
  const createBatch               = useStore((s) => s.createBatch);
  const addNotification           = useStore((s) => s.addNotification);
  const navigate                  = useNavigate();

  const obligations = useMemo(
    () => computeNetObligations(selectedTrades, 'PREVIEW', 1),
    [selectedTrades],
  );

  const payObls = obligations.filter((o) => o.direction === 'pay');
  const recObls = obligations.filter((o) => o.direction === 'receive');

  const grossNotional = selectedTrades.reduce((s, t) => s + t.notionalUsdc, 0);

  const handleCreate = (submitImmediately: boolean) => {
    setError('');
    const tradeIds = selectedTrades.map((t) => t.id);
    const result   = createBatch(tradeIds, { name: batchName.trim() || undefined, submitImmediately });
    if (!result.ok) { setError(result.reason ?? 'Failed.'); return; }
    addNotification({
      type: 'success',
      title: submitImmediately
        ? `Batch ${result.batchId} created and submitted for approval`
        : `Draft batch ${result.batchId} saved`,
    });
    onClose();
    navigate(`/settlements/${result.batchId}`);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Create Settlement Batch</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        {/* Batch name */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Batch name (optional)</label>
          <input
            type="text"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="e.g. Morning batch 21 Sep"
            className="w-full border border-wm-frost rounded px-3 py-2 text-sm"
          />
        </div>

        {/* Entity / scope */}
        {selectedTrades.length > 0 && (
          <div className="mb-4 bg-wm-offwhite rounded-lg p-3 text-xs space-y-1">
            <div className="flex gap-2">
              <span className="text-slate-400 w-28 shrink-0">Legal entity</span>
              <span className="text-slate-700 font-medium">{selectedTrades[0].legalEntity}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-slate-400 w-28 shrink-0">Counterparty</span>
              <span className="text-slate-700 font-medium">{selectedTrades[0].counterparty}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-slate-400 w-28 shrink-0">Settlement window</span>
              <span className="text-slate-700">{selectedTrades[0].settlementWindow}</span>
            </div>
          </div>
        )}

        {/* Trade list */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-600 mb-1.5">{selectedTrades.length} trade{selectedTrades.length !== 1 ? 's' : ''} included</p>
          <div className="max-h-36 overflow-y-auto border border-wm-frost rounded">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th className="text-right">Notional</th>
                </tr>
              </thead>
              <tbody>
                {selectedTrades.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.id}</td>
                    <td className="text-xs">{t.pair}</td>
                    <td>
                      <span className={clsx('badge text-xs', t.side === 'buy' ? 'bg-buy-subtle text-wm-green' : 'bg-red-50 text-red-600')}>
                        {t.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-right text-xs tabnum">{fmtUsdc(t.notionalUsdc)} USDC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Netting preview */}
        <div className="mb-4 bg-wm-night rounded-lg p-4 text-sm">
          <p className="text-wm-ash text-xs font-semibold uppercase tracking-wide mb-3">Net Obligations Preview</p>
          <div className="space-y-2">
            {payObls.map((o) => (
              <div key={o.id} className="flex items-center justify-between">
                <span className="text-red-300 text-xs font-medium">↑ You pay</span>
                <span className="font-mono text-sm font-semibold text-red-300 tabnum">
                  {o.asset === 'USDC' ? fmtUsdc(o.netAmount) + ' USDC' : fmtAsset(o.netAmount, o.asset) + ' ' + o.asset}
                </span>
              </div>
            ))}
            {recObls.map((o) => (
              <div key={o.id} className="flex items-center justify-between">
                <span className="text-wm-green text-xs font-medium">↓ You receive</span>
                <span className="font-mono text-sm font-semibold text-wm-green tabnum">
                  {fmtAsset(o.netAmount, o.asset)} {o.asset}
                </span>
              </div>
            ))}
            {obligations.length === 0 && (
              <p className="text-wm-ash text-xs italic">Fully netted — no external transfers required.</p>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-wm-graphite flex justify-between text-xs text-wm-ash">
            <span>Gross notional (both sides)</span>
            <span className="tabnum">{fmtUsdc(grossNotional)} USDC</span>
          </div>
        </div>

        {/* Approval policy notice */}
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          <p className="font-semibold mb-0.5">Approval required before payment</p>
          <p>One independent approver required — Northstar Capital policy.</p>
          <p className="mt-1 text-blue-600">Awaiting approval from <strong>Alex Chen</strong> (Fund Approver).</p>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary btn">Cancel</button>
          <button
            onClick={() => handleCreate(false)}
            className="btn-secondary btn"
            title="Save as a draft for later review — batch stays in Needs Review"
          >
            Save draft
          </button>
          <button
            onClick={() => handleCreate(true)}
            className="btn-primary btn"
            title="Create batch and immediately submit for approval"
          >
            Create and submit for approval ({selectedTrades.length})
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trades Tab ────────────────────────────────────────────────────

type StatusFilter = 'all' | TradeSettlementStatus;
type AssignmentFilter = 'all' | 'unbatched' | 'batched';

export function TradesTab() {
  const trades  = useStore((s) => s.trades);
  const batches = useStore((s) => s.batches);

  // Filters
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [pairFilter,       setPairFilter]       = useState<'all' | TradingPair>('all');
  const [sideFilter,       setSideFilter]       = useState<'all' | Side>('all');
  const [search,           setSearch]           = useState('');

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);

  const pairs: TradingPair[] = ['BTC/USDC', 'ETH/USDC', 'SOL/USDC'];

  // Filtered list
  const filtered = useMemo(() => {
    let list = [...trades].reverse(); // newest first
    if (statusFilter !== 'all')     list = list.filter((t) => t.settlementStatus === statusFilter);
    if (assignmentFilter === 'unbatched') list = list.filter((t) => t.batchId === null);
    if (assignmentFilter === 'batched')   list = list.filter((t) => t.batchId !== null);
    if (pairFilter !== 'all')       list = list.filter((t) => t.pair === pairFilter);
    if (sideFilter !== 'all')       list = list.filter((t) => t.side === sideFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.id.toLowerCase().includes(q) || (t.batchId ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [trades, statusFilter, assignmentFilter, pairFilter, sideFilter, search]);

  // Count chips
  const unbatchedCount    = trades.filter((t) => t.batchId === null).length;
  const unsettledCount    = trades.filter((t) => t.settlementStatus === 'unsettled').length;
  const partialCount      = trades.filter((t) => t.settlementStatus === 'partially-settled').length;
  const settledCount      = trades.filter((t) => t.settlementStatus === 'settled').length;

  const allFilteredIds     = filtered.map((t) => t.id);
  const allFilteredSelected = allFilteredIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...allFilteredIds]));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // Selected trade objects (only those that are unbatched — eligible for batching)
  const selectedTrades      = trades.filter((t) => selected.has(t.id));
  const eligibleForBatching = selectedTrades.filter((t) => t.batchId === null && t.settlementStatus === 'unsettled');

  const batchForTrade = (t: Trade) => batches.find((b) => b.id === t.batchId);

  return (
    <div>
      {showModal && eligibleForBatching.length > 0 && (
        <CreateBatchModal
          selectedTrades={eligibleForBatching}
          onClose={() => { setShowModal(false); clearSelection(); }}
        />
      )}

      {/* Header row: filter chips + "Batch all eligible" action */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setAssignmentFilter(assignmentFilter === 'unbatched' ? 'all' : 'unbatched')}
          className={clsx(
            'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
            assignmentFilter === 'unbatched'
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white border-wm-frost text-slate-600 hover:bg-wm-horizon',
          )}
        >
          Unbatched <span className="ml-1 opacity-70">{unbatchedCount}</span>
        </button>
        {(['all', 'unsettled', 'partially-settled', 'settled'] as const).map((s) => {
          const count = s === 'all' ? trades.length : s === 'unsettled' ? unsettledCount : s === 'partially-settled' ? partialCount : settledCount;
          const label = s === 'all' ? 'All' : s === 'unsettled' ? 'Unsettled' : s === 'partially-settled' ? 'Partial' : 'Settled';
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                statusFilter === s
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white border-wm-frost text-slate-600 hover:bg-wm-horizon',
              )}
            >
              {label} <span className="ml-1 opacity-70">{count}</span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {/* Pair filter */}
          <select
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value as any)}
            className="border border-wm-frost rounded px-2 py-1 text-xs text-slate-600 bg-white"
          >
            <option value="all">All pairs</option>
            {pairs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* Side filter */}
          <select
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value as any)}
            className="border border-wm-frost rounded px-2 py-1 text-xs text-slate-600 bg-white"
          >
            <option value="all">Both sides</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref / batch…"
            className="border border-wm-frost rounded px-2.5 py-1 text-xs w-36"
          />

          {/* Persistent "Batch all eligible" action */}
          {(() => {
            const allUnbatched = trades.filter((t) => t.batchId === null && t.settlementStatus === 'unsettled');
            const disabled = allUnbatched.length === 0;
            return (
              <button
                onClick={() => {
                  // Pre-select all eligible unbatched trades and open the modal
                  setSelected(new Set(allUnbatched.map((t) => t.id)));
                  setShowModal(true);
                }}
                disabled={disabled}
                title={disabled ? 'No eligible unbatched trades' : `Batch all ${allUnbatched.length} eligible trades`}
                className={clsx(
                  'btn btn-sm whitespace-nowrap',
                  disabled
                    ? 'bg-wm-frost text-slate-400 cursor-not-allowed'
                    : 'btn-primary',
                )}
              >
                Batch all eligible ({allUnbatched.length})
              </button>
            );
          })()}
        </div>
      </div>

      {/* Trade table */}
      {filtered.length === 0 ? (
        <div className="card px-4 py-12 text-center text-sm text-slate-400">
          {trades.length === 0
            ? 'No trades yet. Execute trades on the Trading screen.'
            : 'No trades match the current filters.'}
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected && filtered.length > 0}
                    onChange={toggleAll}
                    className="cursor-pointer accent-wm-green"
                    aria-label="Select all visible"
                  />
                </th>
                <th>Reference</th>
                <th>Time</th>
                <th>Pair</th>
                <th>Side</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Price</th>
                <th className="text-right">Notional</th>
                <th>Settlement</th>
                <th>Batch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const base  = t.pair.split('/')[0];
                const batch = batchForTrade(t);
                return (
                  <tr
                    key={t.id}
                    className={clsx(selected.has(t.id) && 'bg-[#00F55408]')}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                        className="cursor-pointer accent-wm-green"
                      />
                    </td>
                    <td className="font-mono text-xs">{t.id}</td>
                    <td className="text-xs tabnum text-slate-500">{fmtTs(t.timestamp)}</td>
                    <td className="font-medium text-xs">{t.pair}</td>
                    <td>
                      <span className={clsx('badge text-xs', t.side === 'buy' ? 'bg-buy-subtle text-wm-green' : 'bg-red-50 text-red-600')}>
                        {t.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="tabnum text-right text-xs">
                      {fmtAsset(t.baseQuantity, base)} {base}
                    </td>
                    <td className="tabnum text-right text-xs">
                      {t.executedPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="tabnum text-right text-xs font-medium">
                      {fmtUsdc(t.notionalUsdc)} USDC
                    </td>
                    <td>
                      <TradeStatusBadge status={t.settlementStatus} />
                    </td>
                    <td>
                      {batch ? (
                        <a href={`/settlements/${batch.id}`} className="text-xs text-wm-green hover:underline font-mono">
                          {batch.id}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">Unbatched</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky selection bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-wm-night border border-wm-graphite rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 z-40">
          <span className="text-sm text-wm-frost">
            {selected.size} trade{selected.size !== 1 ? 's' : ''} selected
            {' · '}
            <span className="text-wm-ash tabnum">
              {fmtUsdc(selectedTrades.reduce((s, t) => s + t.notionalUsdc, 0))} USDC gross notional
            </span>
          </span>
          {eligibleForBatching.length > 0 && (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary btn btn-sm"
            >
              Create batch ({eligibleForBatching.length} eligible)
            </button>
          )}
          {eligibleForBatching.length < selected.size && (
            <span className="text-xs text-amber-400">
              {selected.size - eligibleForBatching.length} already batched or ineligible
            </span>
          )}
          <button
            onClick={clearSelection}
            className="text-xs text-wm-ash hover:text-wm-frost"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
