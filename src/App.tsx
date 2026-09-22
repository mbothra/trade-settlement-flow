import { useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Trading } from './pages/Trading';
import { Settlements } from './pages/Settlements';
import { DemoToolbar } from './components/DemoToolbar';
import { NotificationCenter } from './components/NotificationCenter';
import { ToastContainer } from './components/Toast';
import { useStore } from './store/store';
import { tickPrices, nextTickInterval } from './modules/priceSimulation';

// ── Price streaming hook ──────────────────────────────────────────

function usePriceStreaming() {
  const updatePrices = useStore((s) => s.updatePrices);
  const isQuoteFeedPaused = useStore((s) => s.isQuoteFeedPaused);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isQuoteFeedPaused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    function schedule() {
      timerRef.current = setTimeout(() => {
        const latest = useStore.getState().prices;
        const newPrices = tickPrices(latest);
        updatePrices(newPrices);
        schedule();
      }, nextTickInterval());
    }

    schedule();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isQuoteFeedPaused, updatePrices]);
}

// ── Navigation link ───────────────────────────────────────────────

function NavItem({ to, label, count }: { to: string; label: string; count?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
          isActive
            ? 'bg-white/10 text-white'
            : 'text-slate-400 hover:text-white hover:bg-white/5',
        )
      }
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="bg-amber-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
          {count}
        </span>
      )}
    </NavLink>
  );
}

// ── App ───────────────────────────────────────────────────────────

export default function App() {
  usePriceStreaming();

  const persona = useStore((s) => s.persona);
  const batches = useStore((s) => s.batches);
  const pendingCount = batches.filter((b) => b.status === 'needs-review' || b.status === 'disputed').length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top navigation */}
      <nav className="bg-nav sticky top-0 z-40 border-b border-nav-border">
        <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center gap-6">
          {/* Brand — Wintermute NODE */}
          <div className="flex items-center gap-2.5">
            {/* Wintermute hexagon symbol (simplified SVG inline) */}
            <svg
              viewBox="0 0 28 28"
              width="28"
              height="28"
              fill="none"
              aria-label="Wintermute"
              xmlns="http://www.w3.org/2000/svg"
            >
              <polygon
                points="14,2 25,8 25,20 14,26 3,20 3,8"
                fill="#00F554"
              />
              <text
                x="14"
                y="18"
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="#070B09"
                fontFamily="monospace"
              >W</text>
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-wm-green text-[10px] font-semibold tracking-[0.2em] uppercase">Wintermute</span>
              <span className="text-white font-bold text-sm tracking-widest uppercase">NODE</span>
            </div>
            <div className="ml-1 w-px h-6 bg-wm-graphite" />
            <span className="text-wm-ash text-xs">Northstar Capital</span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-1 ml-4">
            <NavItem to="/trading" label="Trading" />
            <NavItem to="/settlements" label="Settlements" count={pendingCount} />
          </div>

          {/* Right: persona indicator + notification centre */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{
                persona === 'fund-trader' ? 'Fund Trader' :
                persona === 'fund-operations' ? 'Fund Operations' :
                persona === 'fund-approver' ? 'Fund Approver' :
                'Provider Operations'
              }</span>
            </div>
            <NotificationCenter />
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 pb-28">
        <Routes>
          <Route path="/" element={<Navigate to="/trading" replace />} />
          <Route path="/trading" element={<Trading />} />
          <Route path="/settlements" element={<Settlements />} />
          <Route path="/settlements/:batchId" element={<Settlements />} />
        </Routes>
      </main>

      {/* Toast notifications */}
      <ToastContainer />

      {/* Demo toolbar (always visible) */}
      <DemoToolbar />
    </div>
  );
}
