import { useEffect } from 'react';
import { clsx } from 'clsx';
import { useStore } from '../store/store';
import type { AppNotification } from '../store/types';

const ICONS: Record<AppNotification['type'], string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS: Record<AppNotification['type'], string> = {
  success: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  error:   'bg-red-50 border-red-300 text-red-900',
  warning: 'bg-amber-50 border-amber-300 text-amber-900',
  info:    'bg-blue-50 border-blue-300 text-blue-900',
};

const ICON_COLORS: Record<AppNotification['type'], string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error:   'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info:    'bg-blue-100 text-blue-700',
};

function ToastItem({ n }: { n: AppNotification }) {
  const dismiss = useStore((s) => s.dismissNotification);

  useEffect(() => {
    const t = setTimeout(() => dismiss(n.id), n.type === 'error' ? 8000 : 4500);
    return () => clearTimeout(t);
  }, [n.id, n.type, dismiss]);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg max-w-sm w-full',
        COLORS[n.type],
      )}
      role="alert"
    >
      <span className={clsx('rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5', ICON_COLORS[n.type])}>
        {ICONS[n.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{n.title}</p>
        {n.message && <p className="text-xs mt-0.5 opacity-80">{n.message}</p>}
      </div>
      <button
        onClick={() => dismiss(n.id)}
        className="opacity-60 hover:opacity-100 text-lg leading-none shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const notifications = useStore((s) => s.notifications);
  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <ToastItem n={n} />
        </div>
      ))}
    </div>
  );
}
