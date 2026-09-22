import { useState } from 'react';
import { clsx } from 'clsx';
import { useStore, selectUsedCredit, selectAvailableCredit, selectUtilisation, APPROVED_LIMIT } from '../store/store';

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal aria-labelledby="credit-info-title">
      <div className="modal-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="credit-info-title" className="text-lg font-semibold text-slate-900">Demo Credit Rule</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="space-y-4 text-sm text-slate-700">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs">
            ⚠ Prototype rule only — not a claim about any provider's real risk methodology.
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Used Credit</h3>
            <p>Sum of the executed USDC notionals of all accepted trades that have <strong>not</strong> been released after completed settlement. Unbatched trades also consume credit.</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Available Credit</h3>
            <p>2,000,000 USDC approved limit minus used credit.</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Gross-Notional Model</h3>
            <p>Both buys <em>and</em> sells consume credit. A sell does not automatically replenish credit. Subsequent quote movements do not revalue used credit.</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Credit Release</h3>
            <p>Credit is released batch-by-batch after all payment obligations are reconciled, the batch settles, and the Risk update is applied. Partial payments, approval, or a reference do <em>not</em> release credit.</p>
          </div>
          <div className="bg-wm-horizon rounded-lg p-3 text-xs text-slate-500">
            A production implementation would consume Wintermute's authoritative Risk calculations and release rules.
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-secondary btn-sm btn">Close</button>
        </div>
      </div>
    </div>
  );
}

export function CreditMetrics() {
  const [showInfo, setShowInfo] = useState(false);
  const used        = useStore(selectUsedCredit);
  const available   = useStore(selectAvailableCredit);
  const utilisation = useStore(selectUtilisation);

  // Check if any settled batch has creditUpdatePending
  const batches             = useStore((s) => s.batches);
  const hasPendingRiskUpdate = batches.some((b) => b.creditUpdatePending);

  const utilisationPct = Math.min(1, utilisation) * 100;
  const isWarning      = utilisationPct >= 80;
  const isCritical     = utilisationPct >= 95;

  const barColor = isCritical
    ? 'bg-red-500'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-[#00F554]'; // Gibson green

  const fmtN = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USDC';

  return (
    <>
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Credit Facility — Northstar Capital ↔ Wintermute
            </h2>
            <button
              onClick={() => setShowInfo(true)}
              className="text-slate-400 hover:text-slate-600 w-5 h-5 rounded-full border border-wm-frost text-xs flex items-center justify-center"
              title="About this credit rule"
              aria-label="Credit rule info"
            >
              i
            </button>
          </div>
          <div className="flex items-center gap-2">
            {hasPendingRiskUpdate && (
              <span className="badge bg-violet-50 text-violet-700 border border-violet-200 text-xs animate-pulse">
                ⚙ Risk update pending
              </span>
            )}
            {isWarning && (
              <span className={clsx('badge text-xs', isCritical ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                {isCritical ? '🚨 Near limit' : '⚠ 80% utilised'}
              </span>
            )}
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Approved Limit</p>
            <p className="text-lg font-semibold text-slate-900 tabnum">
              {fmtN(APPROVED_LIMIT)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Used Credit</p>
            <p className={clsx('text-lg font-semibold tabnum', used > 0 ? 'text-slate-900' : 'text-slate-400')}>
              {fmtN(used)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Available Credit</p>
            <p className={clsx(
              'text-lg font-semibold tabnum',
              isCritical ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-[#00C040]',
            )}>
              {fmtN(available)}
            </p>
          </div>
        </div>

        {/* Utilisation bar */}
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Utilisation</span>
            <span className="tabnum font-medium">{utilisationPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-wm-horizon rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full util-bar-fill', barColor)}
              style={{ width: `${utilisationPct}%` }}
              role="progressbar"
              aria-valuenow={utilisationPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {isWarning && (
            <p className={clsx('text-xs mt-1', isCritical ? 'text-red-600' : 'text-amber-600')}>
              {isCritical
                ? 'Credit nearly exhausted. New trades may be blocked.'
                : 'Credit utilisation above 80%. Monitor closely.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
