import { CreditMetrics } from '../components/CreditMetrics';
import { TradingCard } from '../components/TradingCard';
import { TradeBlotter } from '../components/TradeBlotter';
import { useStore } from '../store/store';
import { clsx } from 'clsx';

export function Trading() {
  const persona = useStore((s) => s.persona);
  const isReadOnly = persona !== 'fund-trader';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Trading</h1>
        {isReadOnly && (
          <span className="badge bg-slate-100 text-slate-600 text-xs">
            View only — switch to Fund Trader to execute
          </span>
        )}
      </div>

      {/* Credit metrics */}
      <CreditMetrics />

      {/* Trading card + blotter */}
      <div className="grid grid-cols-1 xl:grid-cols-[420px,1fr] gap-4 items-start">
        <div className={clsx(isReadOnly && 'opacity-60 pointer-events-none')}>
          <TradingCard />
        </div>
        <TradeBlotter />
      </div>
    </div>
  );
}
