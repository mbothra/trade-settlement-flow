import { clsx } from 'clsx';
import { useStore } from '../store/store';
import { useNavigate } from 'react-router-dom';
import { TradeStatusBadge } from './StatusBadge';
import type { Trade } from '../store/types';

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function fmtUsdc(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number, asset: string): string {
  const dp = asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : 4;
  return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function TradeRow({ trade }: { trade: Trade }) {
  const navigate = useNavigate();
  const base     = trade.pair.split('/')[0];

  return (
    <tr>
      <td className="font-mono text-xs">{trade.id}</td>
      <td className="text-xs tabnum text-slate-500">{formatTs(trade.timestamp)}</td>
      <td className="font-medium">{trade.pair}</td>
      <td>
        <span className={clsx(
          'badge',
          trade.side === 'buy'
            ? 'bg-buy-subtle text-wm-green border border-[#00F55430]'
            : 'bg-red-50 text-red-600',
        )}>
          {trade.side.toUpperCase()}
        </span>
      </td>
      <td className="tabnum text-right">{fmtQty(trade.baseQuantity, base)} {base}</td>
      <td className="tabnum text-right">{fmtPrice(trade.executedPrice)}</td>
      <td className="tabnum text-right font-medium">{fmtUsdc(trade.notionalUsdc)} USDC</td>
      <td>
        <TradeStatusBadge status={trade.settlementStatus} />
        {trade.settlementNote && (
          <span className="ml-1 text-[10px] text-slate-400" title={trade.settlementNote}>ⓘ</span>
        )}
      </td>
      <td>
        {trade.batchId ? (
          <button
            onClick={() => navigate(`/settlements/${trade.batchId}`)}
            className="text-xs text-wm-green hover:underline font-mono"
          >
            {trade.batchId}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Unbatched</span>
        )}
      </td>
    </tr>
  );
}

export function TradeBlotter() {
  // Select raw array — do NOT spread/reverse inside the selector; that creates a
  // new reference on every call and triggers an infinite useSyncExternalStore loop.
  const trades        = useStore((s) => s.trades);
  const reversedTrades = [...trades].reverse(); // local copy, safe to mutate

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-wm-frost flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Trade Blotter</h2>
        <span className="text-xs text-slate-400">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
      </div>
      {trades.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">No trades yet. Execute a trade to populate the blotter.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Time</th>
                <th>Pair</th>
                <th>Side</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Price (USDC)</th>
                <th className="text-right">Notional (USDC)</th>
                <th>Settlement</th>
                <th>Batch</th>
              </tr>
            </thead>
            <tbody>
              {reversedTrades.map((t) => (
                <TradeRow key={t.id} trade={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
