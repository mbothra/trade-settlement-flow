import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useStore } from '../store/store';
import { StatusBadge, TradeStatusBadge } from './StatusBadge';
import { obligationExplanation } from '../modules/netting';
import type { SettlementBatch, Obligation, Persona, Trade } from '../store/types';

// ── Formatting ────────────────────────────────────────────────────

function fmtUsdc(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC';
}

function fmtAsset(n: number, asset: string) {
  const dp = asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : asset === 'SOL' ? 4 : 2;
  return n.toLocaleString('en-US', { maximumFractionDigits: dp }) + ' ' + asset;
}

function fmtOblAmt(obl: Obligation) {
  return obl.asset === 'USDC' ? fmtUsdc(obl.netAmount) : fmtAsset(obl.netAmount, obl.asset);
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ── Payment instructions (demo) ───────────────────────────────────

function PaymentInstructions({ obl }: { obl: Obligation }) {
  const instructions = obl.direction === 'pay' ? {
    label:   'Destination (Wintermute)',
    address: obl.asset === 'USDC' ? '0xDEMO_WINTERMUTE_USDC_ADDR_PLACEHOLDER'
           : obl.asset === 'BTC'  ? 'bc1qDEMO_WINTERMUTE_BTC_ADDR_PLACEHOLDER'
           :                        '0xDEMO_WINTERMUTE_ETH_ADDR_PLACEHOLDER',
    network: obl.network,
    memo:    `STLBATCH ${obl.id} — DEMO ONLY`,
  } : {
    label:   'Your receiving address',
    address: obl.asset === 'USDC' ? '0xDEMO_NORTHSTAR_USDC_ADDR_PLACEHOLDER'
           : obl.asset === 'BTC'  ? 'bc1qDEMO_NORTHSTAR_BTC_ADDR_PLACEHOLDER'
           :                        '0xDEMO_NORTHSTAR_ETH_ADDR_PLACEHOLDER',
    network: obl.network,
    memo:    `Expected from Wintermute — DEMO ONLY`,
  };

  return (
    <div className="bg-wm-offwhite border border-wm-frost rounded-lg p-3 mt-2 text-xs">
      <p className="font-semibold text-slate-600 mb-1.5">Payment Instructions — Read Only</p>
      <div className="space-y-1">
        <div className="flex gap-2">
          <span className="text-slate-400 w-24 shrink-0">{instructions.label}</span>
          <span className="font-mono text-slate-700 break-all">{instructions.address}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-400 w-24 shrink-0">Network</span>
          <span className="text-slate-700">{instructions.network}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-400 w-24 shrink-0">Memo</span>
          <span className="font-mono text-slate-500">{instructions.memo}</span>
        </div>
      </div>
      <p className="text-orange-600 mt-2 font-medium">⚠ Demo addresses — no real payments</p>
    </div>
  );
}

// ── Obligation row ────────────────────────────────────────────────

function ObligationRow({
  obl, trades, batchStatus, batchId, highlightedTradeIds, onHighlight, persona, canVerify,
}: {
  obl: Obligation;
  trades: Trade[];
  batchStatus: SettlementBatch['status'];
  batchId: string;
  highlightedTradeIds: Set<string>;
  onHighlight: (ids: string[]) => void;
  persona: Persona;
  canVerify: boolean;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const [refInput,         setRefInput]         = useState('');
  const [verifyAmount,     setVerifyAmount]      = useState('');
  const [verifyError,      setVerifyError]       = useState('');

  const addPaymentReference = useStore((s) => s.addPaymentReference);
  const verifyPayment       = useStore((s) => s.verifyPayment);
  const addNotification     = useStore((s) => s.addNotification);

  const contribution  = trades.filter((t) => obl.contributingTradeIds.includes(t.id));
  const isHighlighted = obl.contributingTradeIds.some((id) => highlightedTradeIds.has(id));
  const explanation   = obligationExplanation(obl, contribution);

  const handleVerify = () => {
    const amount = parseFloat(verifyAmount);
    if (!isFinite(amount) || amount <= 0) { setVerifyError('Enter a valid positive amount.'); return; }
    const result = verifyPayment(batchId, obl.id, amount);
    if (!result.ok) { setVerifyError(result.reason ?? 'Verification failed.'); return; }
    setVerifyAmount('');
    setVerifyError('');
    addNotification({ type: 'success', title: `Payment verified: ${fmtAsset(amount, obl.asset)}` });
  };

  const statusColors: Record<Obligation['status'], string> = {
    outstanding: 'bg-amber-100 text-amber-700',
    partial:     'bg-indigo-100 text-indigo-700',
    complete:    'bg-emerald-100 text-emerald-700',
  };
  const statusLabels: Record<Obligation['status'], string> = {
    outstanding: 'Outstanding',
    partial:     'Partial',
    complete:    'Complete ✓',
  };

  return (
    <div className={clsx(
      'rounded-lg border p-4 transition-colors',
      isHighlighted ? 'border-blue-300 bg-blue-50' : 'border-wm-frost bg-white',
      obl.direction === 'pay' ? 'border-l-4 border-l-red-400' : 'border-l-4 border-l-[#00F554]',
    )}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            <span className={obl.direction === 'pay' ? 'text-red-600' : 'text-[#00C040]'}>
              {obl.direction === 'pay' ? '↑ Pay' : '↓ Receive'}
            </span>
            {' '}{fmtOblAmt(obl)}
          </p>
          <p className="text-xs text-slate-500">{obl.network} network · {obl.asset}</p>
        </div>
        <span className={clsx('badge text-xs', statusColors[obl.status])}>
          {statusLabels[obl.status]}
        </span>
      </div>

      <p className="text-xs text-slate-600 mb-2 italic">{explanation}</p>

      {(obl.verifiedAmount > 0 || obl.status === 'complete') && (
        <div className="mb-2 text-xs space-y-0.5">
          <div className="flex justify-between text-slate-600">
            <span>Verified</span>
            <span className="tabnum text-[#00C040] font-medium">{fmtAsset(obl.verifiedAmount, obl.asset)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Remaining</span>
            <span className="tabnum">{fmtAsset(obl.remainingAmount, obl.asset)}</span>
          </div>
          <div className="h-1.5 bg-wm-horizon rounded-full mt-1">
            <div
              className="h-full bg-[#00F554] rounded-full transition-all"
              style={{ width: `${Math.min(100, (obl.verifiedAmount / obl.netAmount) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {obl.paymentEvents.length > 0 && (
        <div className="mb-2 space-y-1">
          {obl.paymentEvents.map((ev) => (
            <div key={ev.id} className="text-xs bg-wm-offwhite rounded px-2 py-1 flex justify-between gap-2">
              <span className="text-slate-500">
                {ev.type === 'reference_added'
                  ? `Payment ref added: ${ev.reference}`
                  : `Verified: ${fmtAsset(ev.amount, obl.asset)}`}
                {' — '}{ev.actor}
              </span>
              <span className="tabnum text-slate-400 whitespace-nowrap">
                {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 mb-2"
        onClick={() => onHighlight(obl.contributingTradeIds)}
        title="Highlight contributing trades"
      >
        Contributing: {contribution.map((t) => t.id).join(', ')} ↗
      </div>

      <div className="flex flex-wrap gap-2">
        {batchStatus !== 'needs-review' && batchStatus !== 'pending-approval' && (
          <button onClick={() => setShowInstructions(!showInstructions)} className="btn-secondary btn btn-sm">
            {showInstructions ? 'Hide' : 'Payment Instructions'}
          </button>
        )}

        {canVerify && obl.status !== 'complete' && persona === 'fund-operations' && obl.direction === 'pay' && (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              placeholder="Payment ref (e.g. TXN-001)"
              className="border border-wm-frost rounded px-2 py-1 text-xs w-36"
            />
            <button
              onClick={() => {
                if (!refInput.trim()) return;
                addPaymentReference(batchId, obl.id, refInput.trim());
                setRefInput('');
                addNotification({ type: 'info', title: 'Payment reference added' });
              }}
              disabled={!refInput.trim()}
              className="btn-secondary btn btn-sm"
            >
              Add Ref
            </button>
          </div>
        )}
      </div>

      {canVerify && obl.status !== 'complete' && (
        <div className="mt-3 border-t border-wm-frost pt-3">
          <p className="text-xs font-medium text-slate-500 mb-2">
            Demo: Simulate verified {obl.direction === 'pay' ? 'outgoing' : 'incoming'} {obl.asset} payment
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={verifyAmount}
              onChange={(e) => { setVerifyAmount(e.target.value); setVerifyError(''); }}
              placeholder={`Max: ${fmtAsset(obl.remainingAmount, obl.asset)}`}
              className="border border-wm-frost rounded px-2 py-1 text-xs flex-1 tabnum"
            />
            <button onClick={handleVerify} className="btn-primary btn btn-sm">
              Verify {obl.direction === 'pay' ? 'Sent' : 'Received'}
            </button>
          </div>
          {verifyError && <p className="text-xs text-red-600 mt-1">{verifyError}</p>}
          <p className="text-[10px] text-slate-400 mt-1">
            Reported refs are not proof of receipt — only this demo control advances settlement.
          </p>
        </div>
      )}

      {showInstructions && <PaymentInstructions obl={obl} />}
    </div>
  );
}

// ── Discrepancy modal ─────────────────────────────────────────────

function DiscrepancyModal({ batch, onClose }: { batch: SettlementBatch; onClose: () => void }) {
  const [reason,  setReason]  = useState('');
  const [tradeRef, setTradeRef] = useState('');
  const [comment, setComment] = useState('');
  const [error,   setError]   = useState('');
  const reportDiscrepancy     = useStore((s) => s.reportDiscrepancy);
  const addNotification       = useStore((s) => s.addNotification);

  const handleSubmit = () => {
    if (!reason || !comment) { setError('Reason and comment are required.'); return; }
    const result = reportDiscrepancy(batch.id, { reason, relatedTradeRef: tradeRef, comment, owner: 'Fund Operations' });
    if (!result.ok) { setError(result.reason ?? 'Failed.'); return; }
    addNotification({ type: 'warning', title: 'Discrepancy reported', message: reason });
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Report Discrepancy</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-wm-frost rounded px-3 py-2 text-sm">
              <option value="">Select reason…</option>
              <option value="Missing trade">Missing trade in batch</option>
              <option value="Incorrect quantity">Incorrect quantity</option>
              <option value="Incorrect price">Incorrect price</option>
              <option value="Wrong asset">Wrong asset</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Related trade reference</label>
            <input type="text" value={tradeRef} onChange={(e) => setTradeRef(e.target.value)}
              placeholder="e.g. TRD-0001 (optional)"
              className="w-full border border-wm-frost rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Comment</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
              placeholder="Describe the discrepancy in detail…"
              className="w-full border border-wm-frost rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary btn">Cancel</button>
          <button onClick={handleSubmit} className="btn-danger btn">Report Discrepancy</button>
        </div>
      </div>
    </div>
  );
}

// ── Return for review modal ───────────────────────────────────────

function ReturnModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const returnBatch           = useStore((s) => s.returnBatchForReview);
  const addNotification       = useStore((s) => s.addNotification);

  const handleSubmit = () => {
    const result = returnBatch(batchId, comment);
    if (!result.ok) return;
    addNotification({ type: 'info', title: 'Batch returned for review', message: comment });
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-panel p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Return for Review</h2>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Comment (optional)</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
            placeholder="Reason for returning…"
            className="w-full border border-wm-frost rounded px-3 py-2 text-sm resize-none" />
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary btn">Cancel</button>
          <button onClick={handleSubmit} className="btn-danger btn">Return for Review</button>
        </div>
      </div>
    </div>
  );
}

// ── Provider resolution panel ─────────────────────────────────────

function ProviderResolutionPanel({ batch }: { batch: SettlementBatch }) {
  const [note,           setNote]           = useState('');
  const [includeMissing, setIncludeMissing] = useState(false);
  const [error,          setError]          = useState('');
  const resolveDiscrepancy = useStore((s) => s.resolveDiscrepancy);
  const addNotification    = useStore((s) => s.addNotification);
  const allTrades          = useStore((s) => s.trades);

  const missingTrade = batch.missingTradeId
    ? allTrades.find((t) => t.id === batch.missingTradeId)
    : null;

  const handleResolve = () => {
    if (!note.trim()) { setError('Please provide a resolution note.'); return; }
    const result = resolveDiscrepancy(
      batch.id, note,
      includeMissing && batch.missingTradeId ? batch.missingTradeId : undefined,
    );
    if (!result.ok) { setError(result.reason ?? 'Failed.'); return; }
    addNotification({ type: 'success', title: 'Discrepancy resolved', message: 'Corrected batch revision produced' });
  };

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-purple-900 mb-3">Provider Operations — Resolve Discrepancy</h3>
      <div className="bg-white border border-purple-100 rounded p-3 mb-3 text-xs space-y-1">
        <p className="font-semibold text-slate-700">Reported by: {batch.disputeInfo?.reportedBy}</p>
        <p className="text-slate-600">Reason: {batch.disputeInfo?.reason}</p>
        <p className="text-slate-600">Related trade: {batch.disputeInfo?.relatedTradeRef || '—'}</p>
        <p className="text-slate-600">Comment: {batch.disputeInfo?.comment}</p>
      </div>
      <div className="mb-3">
        <p className="text-xs font-semibold text-purple-700 mb-1">Current batch obligations:</p>
        <div className="space-y-0.5">
          {batch.obligations.map((o) => (
            <div key={o.id} className="text-xs text-slate-600">
              {o.direction === 'pay' ? '↑ Pay' : '↓ Receive'}{' '}
              {o.asset === 'USDC' ? fmtUsdc(o.netAmount) : fmtAsset(o.netAmount, o.asset)}
            </div>
          ))}
        </div>
      </div>
      {missingTrade && (
        <div className="mb-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={includeMissing} onChange={(e) => setIncludeMissing(e.target.checked)} className="mt-0.5" />
            <span className="text-xs text-slate-700">
              Include missing trade <strong>{missingTrade.id}</strong>:{' '}
              {missingTrade.side.toUpperCase()} {missingTrade.baseQuantity} {missingTrade.pair.split('/')[0]} @ {missingTrade.executedPrice.toLocaleString()} USDC
              {' '}(corrects obligations without creating a new trade)
            </span>
          </label>
        </div>
      )}
      <div className="mb-3">
        <label className="block text-xs font-medium text-purple-700 mb-1">Resolution note</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="Explain the resolution and any corrections made…"
          className="w-full border border-purple-200 rounded px-2 py-1.5 text-xs resize-none" />
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <button onClick={handleResolve} className="btn btn-sm bg-purple-600 text-white hover:bg-purple-700">
        Produce Corrected Batch
      </button>
    </div>
  );
}

// ── Main BatchDetail ──────────────────────────────────────────────

export function BatchDetail({ batchId }: { batchId: string }) {
  const navigate        = useNavigate();
  const batch           = useStore((s) => s.batches.find((b) => b.id === batchId));
  const trades          = useStore((s) => s.trades);
  const persona         = useStore((s) => s.persona);
  const submitBatch     = useStore((s) => s.submitBatchForApproval);
  const approveBatch    = useStore((s) => s.approveBatch);
  const addNotification = useStore((s) => s.addNotification);
  const removeFromBatch = useStore((s) => s.removeTradeFromBatch);
  const discardBatch    = useStore((s) => s.discardDraftBatch);

  const [highlightedTradeIds,    setHighlightedTradeIds]    = useState<Set<string>>(new Set());
  const [showDiscrepancyModal,   setShowDiscrepancyModal]   = useState(false);
  const [showReturnModal,        setShowReturnModal]        = useState(false);
  const [viewedRevision,         setViewedRevision]         = useState<number | null>(null);
  const [actionError,            setActionError]            = useState('');

  useEffect(() => {
    if (batch && viewedRevision === null) setViewedRevision(batch.revision);
  }, [batch?.id]);

  if (!batch) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p>Batch not found.</p>
        <button onClick={() => navigate('/settlements')} className="btn-secondary btn mt-4">← Back</button>
      </div>
    );
  }

  const batchTrades        = trades.filter((t) => batch.tradeIds.includes(t.id));
  const payObls            = batch.obligations.filter((o) => o.direction === 'pay');
  const recObls            = batch.obligations.filter((o) => o.direction === 'receive');
  const isStale            = viewedRevision !== null && batch.revision > viewedRevision;
  const canVerifyPayments  = ['awaiting-payment', 'partially-settled'].includes(batch.status);
  const isDisputed         = batch.status === 'disputed';

  const handleSubmit = () => {
    setActionError('');
    const result = submitBatch(batch.id);
    if (!result.ok) { setActionError(result.reason ?? 'Failed.'); return; }
    addNotification({ type: 'success', title: 'Batch submitted for approval', message: `Revision ${batch.revision} sealed` });
  };

  const handleApprove = () => {
    setActionError('');
    const result = approveBatch(batch.id);
    if (!result.ok) { setActionError(result.reason ?? 'Failed.'); return; }
    addNotification({ type: 'success', title: 'Batch approved', message: 'Awaiting payment' });
  };

  const handleRemoveTrade = (tradeId: string) => {
    const result = removeFromBatch(tradeId, batch.id);
    if (!result.ok) { addNotification({ type: 'error', title: result.reason ?? 'Failed to remove trade' }); }
    else { addNotification({ type: 'info', title: `Trade ${tradeId} removed from batch` }); }
  };

  const handleDiscard = () => {
    if (!confirm(`Discard batch ${batch.id}? All trades will become unbatched.`)) return;
    const result = discardBatch(batch.id);
    if (!result.ok) { addNotification({ type: 'error', title: result.reason ?? 'Failed to discard batch' }); return; }
    addNotification({ type: 'info', title: `Batch ${batch.id} discarded` });
    navigate('/settlements');
  };

  return (
    <>
      {showDiscrepancyModal && (
        <DiscrepancyModal batch={batch} onClose={() => setShowDiscrepancyModal(false)} />
      )}
      {showReturnModal && (
        <ReturnModal batchId={batch.id} onClose={() => setShowReturnModal(false)} />
      )}

      <div className="space-y-4 pb-24">
        {/* Back + Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate('/settlements')}
              className="text-xs text-slate-500 hover:text-slate-700 mb-2 flex items-center gap-1"
            >
              ← Settlements
            </button>
            <h1 className="text-xl font-semibold text-slate-900">
              {batch.id}
              {batch.name && <span className="ml-2 text-base font-normal text-slate-500">— {batch.name}</span>}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {batch.legalEntity} ↔ {batch.counterparty} · {batch.settlementWindow} ·
              Rev {batch.revision} · Due {fmtDate(batch.dueTime)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge status={batch.status} />
            {batch.isMissingTradeScenario && (
              <span className="badge bg-orange-100 text-orange-700">⚠ Missing trade scenario</span>
            )}
            {/* creditUpdatePending is now always false after auto-settlement */}
          </div>
        </div>

        {/* Actionable summary sentence */}
        {batch.status === 'needs-review' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-900">
            <strong>Action required:</strong> Review the net obligations below, then submit for approval or save as a draft.
          </div>
        )}
        {batch.status === 'pending-approval' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-900">
            <strong>Awaiting approval from Alex Chen</strong> (Fund Approver) · Submitted by {batch.submittedBy ?? '—'}.
            No payments should be made until this batch is approved.
          </div>
        )}
        {batch.status === 'awaiting-payment' && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3 text-sm text-emerald-900">
            <strong>Approved — make payments externally.</strong> Send the amounts shown below to Wintermute,
            then simulate payment evidence using the fields in each obligation. Settlement completes automatically.
          </div>
        )}
        {batch.status === 'partially-settled' && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
            <strong>Partially settled.</strong> Some obligations are still outstanding.
            Continue verifying incoming and outgoing payments — settlement will complete automatically.
          </div>
        )}
        {batch.status === 'settled' && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3 text-sm text-emerald-900">
            <strong>Fully settled.</strong> All obligations verified, reconciled and credit released — no further action required.
            Reconciled {batch.reconciledAt ? new Date(batch.reconciledAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}.
          </div>
        )}

        {/* Stale banner */}
        {isStale && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-800">
              <strong>This batch changed while you were reviewing it.</strong> Review the updated amounts before continuing.
            </p>
            <button
              onClick={() => setViewedRevision(batch.revision)}
              className="btn btn-sm bg-amber-600 text-white hover:bg-amber-700 shrink-0"
            >
              Acknowledge
            </button>
          </div>
        )}

        {/* Awaiting-reconciliation banner — brief auto state held by an open case */}
        {batch.status === 'awaiting-reconciliation' && (
          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 flex items-start gap-3">
            <span className="text-violet-500 text-xl animate-spin" aria-hidden>⟳</span>
            <div>
              <p className="text-sm font-semibold text-violet-800">Processing settlement…</p>
              <p className="text-sm text-violet-700 mt-0.5">
                All obligations verified. Settlement is held by an open discrepancy case —
                completion will proceed automatically once the case is resolved.
              </p>
              {batch.disputeInfo && !batch.disputeInfo.resolvedAt && (
                <p className="text-xs text-violet-600 mt-1">
                  Open case owner: <strong>{batch.disputeInfo.owner}</strong> ·{' '}
                  Reason: {batch.disputeInfo.reason}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Disputed banner */}
        {isDisputed && batch.disputeInfo && !batch.disputeInfo.resolvedAt && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3">
            <p className="text-sm font-semibold text-red-800 mb-1">⚠ Discrepancy reported — agreement and payments blocked</p>
            <p className="text-sm text-red-700">
              Reason: {batch.disputeInfo.reason} · Reported by {batch.disputeInfo.reportedBy}
            </p>
            {batch.disputeInfo.comment && (
              <p className="text-sm text-red-600 mt-1">{batch.disputeInfo.comment}</p>
            )}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Batch reference', value: batch.id },
            { label: 'Revision',        value: String(batch.revision) },
            { label: 'Submitted by',    value: batch.submittedBy ?? '—' },
            { label: 'Approved by',     value: batch.approvedBy  ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-3">
              <p className="text-xs text-slate-500 mb-0.5">{label}</p>
              <p className="text-sm font-medium text-slate-900 font-mono">{value}</p>
            </div>
          ))}
        </div>

        {/* Two-column: obligations + trades */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Obligations */}
          <div className="space-y-3">
            {payObls.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-2">You Pay</h2>
                <div className="space-y-2">
                  {payObls.map((obl) => (
                    <ObligationRow
                      key={obl.id}
                      obl={obl}
                      trades={batchTrades}
                      batchStatus={batch.status}
                      batchId={batch.id}
                      highlightedTradeIds={highlightedTradeIds}
                      onHighlight={(ids) => setHighlightedTradeIds(new Set(ids))}
                      persona={persona}
                      canVerify={canVerifyPayments && !isDisputed}
                    />
                  ))}
                </div>
              </div>
            )}

            {recObls.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-2">You Receive</h2>
                <div className="space-y-2">
                  {recObls.map((obl) => (
                    <ObligationRow
                      key={obl.id}
                      obl={obl}
                      trades={batchTrades}
                      batchStatus={batch.status}
                      batchId={batch.id}
                      highlightedTradeIds={highlightedTradeIds}
                      onHighlight={(ids) => setHighlightedTradeIds(new Set(ids))}
                      persona={persona}
                      canVerify={canVerifyPayments && !isDisputed}
                    />
                  ))}
                </div>
              </div>
            )}

            {batch.obligations.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No obligations computed yet.</p>
            )}
          </div>

          {/* Trades */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Underlying Trades ({batchTrades.length})
              </h2>
            </div>
            {batch.isMissingTradeScenario && batch.missingTradeId && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-2 text-xs">
                <p className="font-semibold text-orange-800 mb-0.5">⚠ Missing trade detected</p>
                <p className="text-orange-700">
                  Trade <strong>{batch.missingTradeId}</strong> exists in the trade ledger but is absent from this batch.
                </p>
              </div>
            )}
            <div className="card table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Time</th>
                    <th>Pair</th>
                    <th>Side</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Notional</th>
                    <th>Settlement</th>
                    {batch.status === 'needs-review' && !batch.obligations.some((o) => o.verifiedAmount > 0) && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {batchTrades.map((t) => {
                    const base        = t.pair.split('/')[0];
                    const isHighlighted = highlightedTradeIds.has(t.id);
                    const canRemove   = batch.status === 'needs-review' && !batch.obligations.some((o) => o.verifiedAmount > 0);
                    return (
                      <tr
                        key={t.id}
                        className={clsx(isHighlighted && 'bg-blue-50', 'cursor-pointer')}
                        onClick={() => setHighlightedTradeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                          return next;
                        })}
                      >
                        <td className="font-mono text-xs">{t.id}</td>
                        <td className="text-xs text-slate-500 tabnum whitespace-nowrap">
                          {new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                        </td>
                        <td className="text-xs">{t.pair}</td>
                        <td>
                          <span className={clsx('badge text-xs', t.side === 'buy' ? 'bg-buy-subtle text-wm-green' : 'bg-red-50 text-red-600')}>
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-right tabnum text-xs">{t.baseQuantity} {base}</td>
                        <td className="text-right tabnum text-xs font-medium">
                          {t.notionalUsdc.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                        <td>
                          <TradeStatusBadge status={t.settlementStatus} />
                        </td>
                        {canRemove && (
                          <td>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveTrade(t.id); }}
                              className="text-xs text-red-500 hover:text-red-700"
                              title="Remove from batch"
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Missing trade detail */}
            {batch.isMissingTradeScenario && batch.missingTradeId && (() => {
              const mt = trades.find((t) => t.id === batch.missingTradeId);
              return mt ? (
                <div className="mt-2 bg-orange-50 border border-dashed border-orange-300 rounded p-2 text-xs text-orange-700">
                  <strong>In ledger but not in batch:</strong> {mt.id} — {mt.side.toUpperCase()} {mt.baseQuantity} {mt.pair.split('/')[0]} @ {mt.executedPrice.toLocaleString()} USDC (notional: {mt.notionalUsdc.toLocaleString()} USDC)
                </div>
              ) : null;
            })()}
          </div>
        </div>

        {/* Provider resolution */}
        {persona === 'provider-operations' && isDisputed && batch.disputeInfo && !batch.disputeInfo.resolvedAt && (
          <ProviderResolutionPanel batch={batch} />
        )}

        {/* Action error */}
        {actionError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {/* Workflow actions */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Actions</h2>
          <div className="flex flex-wrap gap-2">
            {/* Fund Operations */}
            {persona === 'fund-operations' && batch.status === 'needs-review' && (
              <>
                <button
                  onClick={handleSubmit}
                  disabled={isStale || isDisputed || batch.tradeIds.length === 0}
                  className="btn-primary btn"
                >
                  Submit for Approval
                </button>
                {!batch.submittedBy && !batch.obligations.some((o) => o.verifiedAmount > 0) && (
                  <button
                    onClick={handleDiscard}
                    className="btn-ghost btn text-red-600 hover:bg-red-50"
                  >
                    Discard Draft Batch
                  </button>
                )}
                <button
                  onClick={() => setShowDiscrepancyModal(true)}
                  disabled={batch.obligations.some((o) => o.verifiedAmount > 0)}
                  className="btn-danger btn"
                >
                  Report Discrepancy
                </button>
              </>
            )}

            {/* Fund Approver */}
            {persona === 'fund-approver' && batch.status === 'pending-approval' && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={batch.submittedBy === 'Fund Approver'}
                  className="btn-primary btn"
                >
                  Approve Batch
                </button>
                <button onClick={() => setShowReturnModal(true)} className="btn-danger btn">
                  Return for Review
                </button>
                {batch.submittedBy === 'Fund Approver' && (
                  <p className="text-xs text-red-600 self-center">
                    You cannot approve a batch you submitted.
                  </p>
                )}
              </>
            )}

            {/* Awaiting reconciliation — auto state, no manual action needed */}
            {batch.status === 'awaiting-reconciliation' && (
              <span className="badge bg-violet-50 text-violet-700 text-sm py-1.5 px-3 animate-pulse">
                ⟳ Processing settlement…
              </span>
            )}

            {/* Read-only */}
            {persona === 'fund-trader' && (
              <p className="text-sm text-slate-500">Fund Trader has read-only access to settlements.</p>
            )}

            {batch.status === 'settled' && (
              <span className="badge bg-emerald-100 text-emerald-700 text-sm py-1.5 px-3">
                ✓ Settled — credit released automatically
              </span>
            )}
          </div>
        </div>

        {/* Activity timeline */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Activity Timeline</h2>
          {batch.activityTimeline.length === 0 ? (
            <p className="text-sm text-slate-400">No activity recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {[...batch.activityTimeline].reverse().map((ev) => (
                <div key={ev.id} className="timeline-item">
                  <div className={clsx(
                    'timeline-dot',
                    ev.action.includes('settled') || ev.action.includes('Settled') ? 'bg-[#00F554]' :
                    ev.action.includes('Discrepancy') ? 'bg-red-400' :
                    ev.action.includes('approved') || ev.action.includes('Approved') ? 'bg-blue-400' :
                    ev.action.includes('Risk update') ? 'bg-violet-400' :
                    ev.action.includes('Reconciliation') ? 'bg-violet-300' :
                    'bg-slate-400',
                  )} />
                  <div className="flex-1 pb-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{ev.action}</p>
                      <span className="text-xs text-slate-400 tabnum whitespace-nowrap">Rev {ev.revision}</span>
                    </div>
                    <p className="text-xs text-slate-500">{ev.actor} · {fmtTs(ev.timestamp)}</p>
                    {ev.detail && <p className="text-xs text-slate-600 mt-0.5 italic">{ev.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
