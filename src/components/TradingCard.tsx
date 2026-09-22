import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { useStore, selectAvailableCredit } from '../store/store';
import type { TradingPair, Side } from '../store/types';

const PAIRS: TradingPair[] = ['BTC/USDC', 'ETH/USDC', 'SOL/USDC'];

const ASSET_PRECISION: Record<string, number> = {
  BTC: 8, ETH: 6, SOL: 4,
};

const PRICE_PRECISION: Record<TradingPair, number> = {
  'BTC/USDC': 2,
  'ETH/USDC': 2,
  'SOL/USDC': 4,
};

function fmtPrice(n: number, pair: TradingPair): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: PRICE_PRECISION[pair],
    maximumFractionDigits: PRICE_PRECISION[pair],
  });
}

function fmtUsdc(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number, asset: string): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: ASSET_PRECISION[asset] ?? 6 });
}

export function TradingCard({ onTradeExecuted }: { onTradeExecuted?: (tradeId: string) => void }) {
  const [pair, setPair] = useState<TradingPair>('BTC/USDC');
  const [side, setSide] = useState<Side>('buy');
  const [quantityStr, setQuantityStr] = useState('');
  const [validationMsg, setValidationMsg] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [execError, setExecError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const prices = useStore((s) => s.prices);
  const pendingQuote = useStore((s) => s.pendingQuote);
  const isExecuting = useStore((s) => s.isExecuting);
  const isFeedPaused = useStore((s) => s.isQuoteFeedPaused);
  const available = useStore(selectAvailableCredit);
  const captureQuote = useStore((s) => s.captureQuote as (pair: TradingPair, side: Side, qty: number) => any);
  const expireQuote = useStore((s) => s.expireQuote);
  const executeTrade = useStore((s) => s.executeTrade);
  const addNotification = useStore((s) => s.addNotification);

  const baseAsset = pair.split('/')[0];
  const priceData = prices[pair];
  const displayPrice = side === 'buy' ? priceData?.ask : priceData?.bid;
  const flashClass = priceData?.flash === 'up' ? 'flash-up' : priceData?.flash === 'down' ? 'flash-down' : '';

  const quantity = parseFloat(quantityStr);
  const isValidQty = quantityStr !== '' && isFinite(quantity) && quantity > 0;
  const notional = isValidQty && displayPrice ? quantity * displayPrice : null;
  const creditRequired = notional ?? 0;
  const availableAfter = available - creditRequired;

  // Freshness indicator
  const [freshAge, setFreshAge] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setFreshAge(priceData ? Math.floor((Date.now() - priceData.timestamp) / 1000) : 0);
    }, 500);
    return () => clearInterval(t);
  }, [priceData]);

  // Quote countdown
  useEffect(() => {
    if (!pendingQuote) { setCountdown(0); return; }
    const t = setInterval(() => {
      const left = Math.max(0, (pendingQuote.expiresAt - Date.now()) / 1000);
      setCountdown(left);
      if (left <= 0) {
        expireQuote();
        setQuoteError('Quote expired — request a new quote before executing.');
      }
    }, 100);
    return () => clearInterval(t);
  }, [pendingQuote?.id, expireQuote]);

  // Validation
  useEffect(() => {
    if (quantityStr === '') { setValidationMsg(''); return; }
    if (!isValidQty) { setValidationMsg('Enter a valid positive quantity.'); return; }
    if (isFeedPaused && !pendingQuote) { setValidationMsg('Quote feed is paused — resume to get a fresh price.'); return; }
    setValidationMsg('');
  }, [quantityStr, isValidQty, isFeedPaused, pendingQuote]);

  const handleReviewTrade = () => {
    setQuoteError('');
    setExecError('');
    if (!isValidQty) { setValidationMsg('Enter a valid positive quantity.'); return; }
    const result = captureQuote(pair, side, quantity);
    if ('error' in result) {
      setQuoteError(result.error);
    }
  };

  const handleExecute = () => {
    if (!pendingQuote) return;
    setExecError('');
    const result = executeTrade(pendingQuote.id);
    if (!result.ok) {
      setExecError(result.reason ?? 'Execution failed.');
      if (result.reason?.includes('requires') && result.reason?.includes('Available')) {
        addNotification({ type: 'error', title: 'Over credit limit', message: result.reason });
      }
      return;
    }
    addNotification({
      type: 'success',
      title: `Trade executed — ${result.tradeId}`,
      message: `${side.toUpperCase()} ${fmtQty(pendingQuote.quantity, baseAsset)} ${baseAsset} @ ${fmtPrice(pendingQuote.price, pair)} USDC`,
    });
    setQuantityStr('');
    onTradeExecuted?.(result.tradeId!);
  };

  const canReview = isValidQty && !isFeedPaused && !isExecuting && !validationMsg;
  const hasActiveQuote = pendingQuote && countdown > 0;
  const canExecute = hasActiveQuote && !isExecuting;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700">Spot Trading — Northstar Capital</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {isFeedPaused ? (
            <span className="badge bg-amber-100 text-amber-700">⏸ Feed paused</span>
          ) : (
            <span className={clsx('tabnum', freshAge > 5 ? 'text-amber-500' : 'text-emerald-600')}>
              ● {freshAge}s ago
            </span>
          )}
        </div>
      </div>

      {/* Pair selector */}
      <div className="flex gap-2 mb-4">
        {PAIRS.map((p) => (
          <button
            key={p}
            onClick={() => { setPair(p); setQuantityStr(''); setQuoteError(''); setExecError(''); expireQuote(); }}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              pair === p
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Streaming prices */}
      <div className={clsx('flex gap-4 mb-5 p-3 rounded-lg bg-slate-900', flashClass)}>
        <div className="flex-1">
          <p className="text-xs text-slate-400 mb-1">Bid</p>
          <p className={clsx(
            'text-2xl font-bold tabnum font-mono',
            side === 'sell' ? 'text-emerald-400' : 'text-slate-300',
          )}>
            {priceData ? fmtPrice(priceData.bid, pair) : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{pair.split('/')[0]} → USDC</p>
        </div>
        <div className="w-px bg-slate-700" />
        <div className="flex-1 text-right">
          <p className="text-xs text-slate-400 mb-1">Ask</p>
          <p className={clsx(
            'text-2xl font-bold tabnum font-mono',
            side === 'buy' ? 'text-emerald-400' : 'text-slate-300',
          )}>
            {priceData ? fmtPrice(priceData.ask, pair) : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">USDC → {pair.split('/')[0]}</p>
        </div>
      </div>

      {/* Side selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setSide('buy'); setQuantityStr(''); expireQuote(); setExecError(''); }}
          className={clsx(
            'flex-1 py-2 rounded-md text-sm font-semibold transition-colors',
            side === 'buy'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          Buy {baseAsset}
        </button>
        <button
          onClick={() => { setSide('sell'); setQuantityStr(''); expireQuote(); setExecError(''); }}
          className={clsx(
            'flex-1 py-2 rounded-md text-sm font-semibold transition-colors',
            side === 'sell'
              ? 'bg-red-500 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          Sell {baseAsset}
        </button>
      </div>

      {/* Quantity input */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          Quantity ({baseAsset})
        </label>
        <input
          type="number"
          min="0"
          step="any"
          value={quantityStr}
          onChange={(e) => { setQuantityStr(e.target.value); setExecError(''); expireQuote(); setQuoteError(''); }}
          placeholder={`e.g. ${baseAsset === 'BTC' ? '0.5' : baseAsset === 'ETH' ? '10' : '100'}`}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 tabnum"
          disabled={isExecuting}
        />
        {validationMsg && <p className="text-xs text-red-600 mt-1">{validationMsg}</p>}
      </div>

      {/* Trade preview */}
      {isValidQty && displayPrice && (
        <div className="bg-slate-50 rounded-lg p-3 mb-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Unit price</span>
            <span className="tabnum font-medium">{fmtPrice(displayPrice, pair)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total notional</span>
            <span className="tabnum font-medium">{fmtUsdc(notional!)} USDC</span>
          </div>
          <div className="border-t border-slate-200 pt-1.5 mt-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Credit required</span>
              <span className={clsx('tabnum font-medium', creditRequired > available ? 'text-red-600' : 'text-slate-700')}>
                {fmtUsdc(creditRequired)} USDC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Available after</span>
              <span className={clsx('tabnum font-medium', availableAfter < 0 ? 'text-red-600 font-bold' : 'text-emerald-700')}>
                {fmtUsdc(availableAfter)} USDC
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Active quote panel */}
      {hasActiveQuote && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-blue-800">Firm Quote Captured</span>
            <span className={clsx('text-xs font-mono font-bold tabnum', countdown < 2 ? 'text-red-600' : 'text-blue-700')}>
              {countdown.toFixed(1)}s
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 text-xs text-blue-800 space-y-0.5">
            <span className="text-slate-500">Side</span>
            <span className={clsx('font-semibold', pendingQuote.side === 'buy' ? 'text-emerald-600' : 'text-red-500')}>
              {pendingQuote.side.toUpperCase()}
            </span>
            <span className="text-slate-500">Quantity</span>
            <span className="tabnum">{fmtQty(pendingQuote.quantity, baseAsset)} {baseAsset}</span>
            <span className="text-slate-500">Price</span>
            <span className="tabnum font-mono">{fmtPrice(pendingQuote.price, pair)} USDC</span>
            <span className="text-slate-500">Total</span>
            <span className="tabnum font-semibold">{fmtUsdc(pendingQuote.notionalUsdc)} USDC</span>
          </div>
        </div>
      )}

      {/* Error messages */}
      {quoteError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-sm text-red-700">
          {quoteError}
        </div>
      )}
      {execError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-sm text-red-700">
          {execError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {!hasActiveQuote ? (
          <button
            onClick={handleReviewTrade}
            disabled={!canReview}
            className="btn-primary btn flex-1"
          >
            Review Trade
          </button>
        ) : (
          <>
            <button
              onClick={() => { expireQuote(); setQuoteError(''); setExecError(''); }}
              className="btn-secondary btn flex-1"
            >
              Cancel
            </button>
            <button
              onClick={handleExecute}
              disabled={!canExecute}
              className="btn-primary btn flex-1"
            >
              {isExecuting ? 'Executing…' : 'Execute Trade'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
