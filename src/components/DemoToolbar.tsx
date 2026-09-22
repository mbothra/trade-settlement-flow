import { useState } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useStore, selectAvailableCredit } from '../store/store';
import type { Persona } from '../store/types';
import { GUIDED_STEPS, GUIDED_TRADE_FIXTURES, getStepByKey } from '../modules/demoFixtures';

const PERSONAS: { value: Persona; label: string; abbrev: string; color: string }[] = [
  { value: 'fund-trader',      label: 'Fund Trader',       abbrev: 'FT',  color: 'bg-emerald-600' },
  { value: 'fund-operations',  label: 'Fund Operations',   abbrev: 'FO',  color: 'bg-blue-600' },
  { value: 'fund-approver',    label: 'Fund Approver',     abbrev: 'FA',  color: 'bg-purple-600' },
  { value: 'provider-operations', label: 'Provider Ops',  abbrev: 'PO',  color: 'bg-orange-600' },
];

function GuidedPanel() {
  const navigate = useNavigate();
  const guidedStepKey = useStore((s) => s.guidedStepKey);
  const demoMode = useStore((s) => s.demoMode);
  const executeGuidedStep = useStore((s) => s.executeGuidedStep);
  const advanceGuidedStep = useStore((s) => s.advanceGuidedStep);
  const exitGuidedMode = useStore((s) => s.exitGuidedMode);
  const addNotification = useStore((s) => s.addNotification);
  const setPersona = useStore((s) => s.setPersona);
  const approveBatch       = useStore((s) => s.approveBatch);
  const verifyPayment      = useStore((s) => s.verifyPayment);
  const createBatch        = useStore((s) => s.createBatch);
  const batches            = useStore((s) => s.batches);
  const trades             = useStore((s) => s.trades);
  const available          = useStore(selectAvailableCredit);

  const step = getStepByKey(guidedStepKey);
  if (!step || !demoMode) return null;

  const fixture = guidedStepKey in GUIDED_TRADE_FIXTURES
    ? GUIDED_TRADE_FIXTURES[guidedStepKey as keyof typeof GUIDED_TRADE_FIXTURES]
    : null;

  const stepIndex = GUIDED_STEPS.findIndex((s) => s.key === guidedStepKey) + 1;

  const handleExecuteStep = () => {
    if (!fixture) return;

    const result = executeGuidedStep(guidedStepKey);
    if (!result.ok) {
      if (guidedStepKey === 'step-blocked') {
        addNotification({
          type: 'error',
          title: 'Trade blocked — over credit limit',
          message: result.reason,
        });
        advanceGuidedStep();
      } else {
        addNotification({ type: 'error', title: 'Step failed', message: result.reason });
      }
      return;
    }
    addNotification({
      type: 'success',
      title: `${fixture.side.toUpperCase()} ${fixture.quantity} ${fixture.pair.split('/')[0]}`,
      message: `Executed at ${fixture.price.toLocaleString()} USDC`,
    });
    advanceGuidedStep();
  };

  const handleSettlementsStep = () => {
    setPersona('fund-operations');
    navigate('/settlements');
    advanceGuidedStep();
  };

  const handleApproveStep = () => {
    setPersona('fund-approver');
    const pendingBatch = batches.find((b) => b.status === 'pending-approval');
    if (!pendingBatch) { addNotification({ type: 'error', title: 'No batch pending approval' }); return; }
    const result = approveBatch(pendingBatch.id);
    if (!result.ok) { addNotification({ type: 'error', title: result.reason ?? 'Failed' }); return; }
    addNotification({ type: 'success', title: 'Batch approved' });
    advanceGuidedStep();
  };

  const handleBatchStep = () => {
    setPersona('fund-operations');
    const eligible = trades.filter(
      (t) => t.batchId === null && t.settlementStatus === 'unsettled' && !t.reconciliationReserved,
    );
    if (eligible.length === 0) {
      addNotification({ type: 'error', title: 'No eligible unbatched trades to batch' });
      return;
    }
    // Create AND immediately submit for approval — single atomic step per spec
    const result = createBatch(eligible.map((t) => t.id), { submitImmediately: true });
    if (!result.ok) { addNotification({ type: 'error', title: result.reason ?? 'Failed to create batch' }); return; }
    addNotification({
      type: 'success',
      title: `Batch ${result.batchId} created and submitted for approval`,
      message: `${eligible.length} trade${eligible.length !== 1 ? 's' : ''} · awaiting approval from Alex Chen`,
    });
    advanceGuidedStep();
    navigate(`/settlements/${result.batchId}`);
  };

  const handleVerifyStep = (oblAsset: string, oblDir: 'pay' | 'receive', amount: number) => {
    setPersona('fund-operations');
    const targetBatch = batches.find((b) =>
      b.status === 'awaiting-payment' || b.status === 'partially-settled'
    );
    if (!targetBatch) { addNotification({ type: 'error', title: 'No batch awaiting payment' }); return; }
    const obl = targetBatch.obligations.find(
      (o) => o.asset === oblAsset && o.direction === oblDir && o.status !== 'complete'
    );
    if (!obl) { addNotification({ type: 'error', title: `No outstanding ${oblAsset} ${oblDir} obligation` }); return; }
    const result = verifyPayment(targetBatch.id, obl.id, amount);
    if (!result.ok) { addNotification({ type: 'error', title: result.reason ?? 'Failed' }); return; }
    addNotification({ type: 'success', title: `Verified ${amount.toLocaleString()} ${oblAsset}` });
    advanceGuidedStep();
  };

  const renderAction = () => {
    switch (guidedStepKey) {
      case 'step-buy-btc':
      case 'step-buy-eth':
      case 'step-sell-btc':
        return (
          <button onClick={handleExecuteStep} className="btn btn-sm bg-emerald-500 text-white hover:bg-emerald-600">
            Execute: {fixture?.side?.toUpperCase()} {fixture?.quantity} {fixture?.pair?.split('/')[0]} @ {fixture?.price?.toLocaleString()}
          </button>
        );
      case 'step-blocked':
        return (
          <button
            onClick={handleExecuteStep}
            className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
          >
            Attempt Blocked Trade (800,000 USDC, only {available.toLocaleString()} available)
          </button>
        );
      case 'step-settlements':
        return (
          <button onClick={handleSettlementsStep} className="btn btn-sm bg-blue-600 text-white hover:bg-blue-700">
            → Go to Settlements (as Fund Operations)
          </button>
        );
      case 'step-batch': {
        const unbatched = trades.filter(
          (t) => t.batchId === null && t.settlementStatus === 'unsettled' && !t.reconciliationReserved,
        );
        return (
          <button onClick={handleBatchStep} className="btn btn-sm bg-blue-600 text-white hover:bg-blue-700">
            Batch all eligible trades ({unbatched.length} trade{unbatched.length !== 1 ? 's' : ''})
          </button>
        );
      }
      case 'step-approve':
        return (
          <button onClick={handleApproveStep} className="btn btn-sm bg-purple-600 text-white hover:bg-purple-700">
            Approve Batch (as Fund Approver)
          </button>
        );
      case 'step-pay1':
        return (
          <button onClick={() => handleVerifyStep('USDC', 'pay', 470000)} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700">
            Verify 470,000 USDC sent
          </button>
        );
      case 'step-pay2':
        return (
          <button onClick={() => handleVerifyStep('USDC', 'pay', 470000)} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700">
            Verify remaining 470,000 USDC sent
          </button>
        );
      case 'step-receive-btc':
        return (
          <button onClick={() => handleVerifyStep('BTC', 'receive', 8)} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700">
            Verify receipt of 8 BTC
          </button>
        );
      case 'step-receive-eth':
        return (
          <button onClick={() => handleVerifyStep('ETH', 'receive', 100)} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700">
            Verify receipt of 100 ETH → Complete
          </button>
        );
      case 'step-done':
        return (
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-sm">✓ Walkthrough complete — credit restored to 2,000,000 USDC</span>
            <button
              onClick={() => { navigate('/trading'); exitGuidedMode(); }}
              className="btn btn-sm bg-slate-600 text-white hover:bg-slate-500"
            >
              Back to Trading (free mode)
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="border-t border-slate-700 pt-2 mt-1">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-400 mb-0.5">
            Guided Walkthrough — Step {stepIndex}/{GUIDED_STEPS.length}: {step.title}
          </p>
          <p className="text-xs text-slate-400 mb-1.5 leading-relaxed">{step.description}</p>
          <div className="flex flex-wrap gap-2">{renderAction()}</div>
        </div>
        <button
          onClick={exitGuidedMode}
          className="text-xs text-slate-400 hover:text-slate-200 shrink-0"
        >
          Exit guide
        </button>
      </div>
    </div>
  );
}

export function DemoToolbar() {
  const [expanded, setExpanded] = useState(true);
  const persona = useStore((s) => s.persona);
  const demoMode = useStore((s) => s.demoMode);
  const isQuoteFeedPaused = useStore((s) => s.isQuoteFeedPaused);
  const setPersona = useStore((s) => s.setPersona);
  const startGuidedMode = useStore((s) => s.startGuidedMode);
  const exitGuidedMode = useStore((s) => s.exitGuidedMode);
  const pauseQuoteFeed = useStore((s) => s.pauseQuoteFeed);
  const resumeQuoteFeed = useStore((s) => s.resumeQuoteFeed);
  const resetDemo = useStore((s) => s.resetDemo);
  const loadMissingTradeScenario = useStore((s) => s.loadMissingTradeScenario);
  const verifyPaymentAction  = useStore((s) => s.verifyPayment);
  const addNotification    = useStore((s) => s.addNotification);

  const batches             = useStore((s) => s.batches);
  const currentPersona      = PERSONAS.find((p) => p.value === persona)!;

  // "Simulate remaining payments" — verifies every outstanding obligation in
  // every active batch in one click. Useful in free-exploration mode.
  const handleSimulateAllPayments = () => {
    let count = 0;
    for (const b of batches) {
      if (!['awaiting-payment', 'partially-settled'].includes(b.status)) continue;
      for (const obl of b.obligations) {
        if (obl.status === 'complete') continue;
        const result = verifyPaymentAction(b.id, obl.id, obl.remainingAmount);
        if (result.ok) count++;
      }
    }
    if (count === 0) {
      addNotification({ type: 'info', title: 'No outstanding obligations to simulate' });
    } else {
      addNotification({
        type: 'success',
        title: `Simulated ${count} payment${count !== 1 ? 's' : ''}`,
        message: 'Batches with all obligations covered will settle automatically.',
      });
    }
  };

  return (
    <div className="demo-toolbar">
      <div className="px-4 py-2">
        {/* Top row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Demo label */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-semibold text-amber-400">Concept demo — simulated data</span>
          </div>

          <div className="w-px h-4 bg-slate-700" />

          {/* Persona selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Persona:</span>
            <div className="flex gap-1">
              {PERSONAS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPersona(p.value)}
                  title={p.label}
                  className={clsx(
                    'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                    persona === p.value
                      ? `${p.color} text-white`
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
                  )}
                >
                  {p.abbrev}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">({currentPersona.label})</span>
          </div>

          <div className="w-px h-4 bg-slate-700" />

          {/* Demo controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {demoMode === 'free' ? (
              <button
                onClick={startGuidedMode}
                className="btn btn-sm bg-amber-600 text-white hover:bg-amber-500"
              >
                ▶ Start Guided Walkthrough
              </button>
            ) : (
              <button
                onClick={exitGuidedMode}
                className="btn btn-sm bg-slate-600 text-white hover:bg-slate-500"
              >
                ✕ Exit Guided Mode
              </button>
            )}

            {/* Simulate all remaining payments — shortcut for free-exploration */}
            {demoMode === 'free' && batches.some((b) =>
              ['awaiting-payment', 'partially-settled'].includes(b.status) &&
              b.obligations.some((o) => o.status !== 'complete'),
            ) && (
              <button
                onClick={handleSimulateAllPayments}
                className="btn btn-sm bg-emerald-700 text-white hover:bg-emerald-600"
              >
                ⚡ Simulate remaining payments
              </button>
            )}

            <button
              onClick={() => {
                loadMissingTradeScenario();
                addNotification({ type: 'info', title: 'Missing trade scenario loaded', message: 'Batch STLBATCH-001 is missing trade TRD-0003' });
              }}
              className="btn btn-sm bg-orange-700 text-white hover:bg-orange-600"
            >
              ⚠ Missing Trade Scenario
            </button>

            <button
              onClick={isQuoteFeedPaused ? resumeQuoteFeed : pauseQuoteFeed}
              className={clsx(
                'btn btn-sm',
                isQuoteFeedPaused
                  ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                  : 'bg-slate-600 text-white hover:bg-slate-500',
              )}
            >
              {isQuoteFeedPaused ? '▶ Resume Feed' : '⏸ Pause Feed'}
            </button>

            <button
              onClick={() => {
                if (confirm('Reset the demo? This clears all trades, batches and credit.')) {
                  resetDemo();
                  addNotification({ type: 'info', title: 'Demo reset', message: 'All state cleared' });
                }
              }}
              className="btn btn-sm bg-red-900 text-red-200 hover:bg-red-800"
            >
              ↺ Reset Demo
            </button>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-xs text-slate-500 hover:text-slate-300"
          >
            {expanded ? '▾ collapse' : '▴ expand'}
          </button>
        </div>

        {/* Guided walkthrough panel */}
        {expanded && demoMode === 'guided' && <GuidedPanel />}
      </div>
    </div>
  );
}
