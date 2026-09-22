/**
 * Notification centre — settlement reminder queue
 *
 * Reads the DERIVED reminder list (modules/reminders.ts). Nothing here
 * accumulates state, so re-renders, persona switches and refreshes cannot
 * duplicate a reminder. Marking read only records an id.
 *
 * Presented as an operations queue: severity, ownership, due time,
 * remaining amount, next action — not a social feed.
 *
 * Concept demo — simulated data.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useStore, deriveRemindersForState } from '../store/store';
import { SEVERITY_META } from '../modules/reminders';
import type { Reminder, ReminderSeverity } from '../modules/reminders';

// ── Severity chip ─────────────────────────────────────────────────

/**
 * Severity is conveyed by glyph + word + colour together, so the meaning
 * survives greyscale, colour-blindness and high-contrast modes.
 */
function SeverityChip({ severity, overdue }: { severity: ReminderSeverity; overdue: boolean }) {
  const meta = SEVERITY_META[severity];
  const styles: Record<ReminderSeverity, string> = {
    critical:   'bg-red-100 text-red-800 border-red-300',
    action:     'bg-amber-100 text-amber-800 border-amber-300',
    processing: 'bg-violet-100 text-violet-800 border-violet-300',
    resolved:   'bg-slate-100 text-slate-600 border-slate-300',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
        styles[severity],
      )}
    >
      <span aria-hidden>{meta.glyph}</span>
      {overdue && severity === 'critical' ? 'Overdue' : meta.label}
    </span>
  );
}

// ── One row in the queue ──────────────────────────────────────────

function ReminderRow({
  reminder,
  isRead,
  onAct,
  onToggleRead,
}: {
  reminder: Reminder;
  isRead: boolean;
  onAct: (r: Reminder) => void;
  onToggleRead: (r: Reminder) => void;
}) {
  const r = reminder;

  return (
    <li
      className={clsx(
        'border-b border-wm-frost px-4 py-3 last:border-b-0',
        !isRead && 'bg-[#00F5540A]',
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Unread marker — paired with the bold title so it is not colour-only */}
        <span
          className={clsx(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            isRead ? 'bg-transparent border border-wm-frost' : 'bg-wm-green',
          )}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          {/* Title + severity */}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className={clsx('text-sm text-slate-900', isRead ? 'font-medium' : 'font-semibold')}>
              {r.title}
            </p>
            <SeverityChip severity={r.severity} overdue={r.isOverdue} />
            {!isRead && <span className="sr-only">Unread</span>}
          </div>

          <p className="mb-2 text-xs leading-relaxed text-slate-600">{r.message}</p>

          {/* Structured facts */}
          <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            {r.reference && (
              <>
                <dt className="text-slate-400">Reference</dt>
                <dd className="truncate font-mono text-slate-600">{r.reference}</dd>
              </>
            )}
            <dt className="text-slate-400">Entity</dt>
            <dd className="text-slate-600">
              {r.legalEntity} ↔ {r.counterparty}
            </dd>
            {r.dueLabel && (
              <>
                <dt className="text-slate-400">Due</dt>
                <dd className={clsx('tabnum', r.isOverdue ? 'font-medium text-red-700' : 'text-slate-600')}>
                  {r.dueLabel}
                  {r.overdueLabel && ` · ${r.overdueLabel}`}
                </dd>
              </>
            )}
            {r.remainingLabel && (
              <>
                <dt className="text-slate-400">Remaining</dt>
                <dd className="tabnum font-medium text-slate-700">{r.remainingLabel}</dd>
              </>
            )}
            <dt className="text-slate-400">Owner</dt>
            <dd className="text-slate-600">{r.owner}</dd>
          </dl>

          {/* One primary action + read toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {r.action && (
              <button
                onClick={() => onAct(r)}
                className={clsx(
                  'btn btn-sm',
                  r.group === 'action-required' ? 'btn-primary' : 'btn-secondary',
                )}
              >
                {r.action.label}
              </button>
            )}
            <button
              onClick={() => onToggleRead(r)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              {isRead ? 'Mark unread' : 'Mark read'}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Group section ─────────────────────────────────────────────────

function Group({
  title,
  hint,
  items,
  readIds,
  onAct,
  onToggleRead,
}: {
  title: string;
  hint?: string;
  items: Reminder[];
  readIds: string[];
  onAct: (r: Reminder) => void;
  onToggleRead: (r: Reminder) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-wm-frost bg-wm-horizon px-4 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {title} <span className="tabnum text-slate-400">({items.length})</span>
        </h3>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </div>
      <ul>
        {items.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            isRead={readIds.includes(r.id)}
            onAct={onAct}
            onToggleRead={onToggleRead}
          />
        ))}
      </ul>
    </section>
  );
}

// ── Notification centre ───────────────────────────────────────────

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);

  const persona = useStore((s) => s.persona);
  const trades = useStore((s) => s.trades);
  const batches = useStore((s) => s.batches);
  const readReminderIds = useStore((s) => s.readReminderIds);
  const clockOffset = useStore((s) => s.demoClockOffsetMs);

  const markRead = useStore((s) => s.markReminderRead);
  const markUnread = useStore((s) => s.markReminderUnread);
  const markAllRead = useStore((s) => s.markAllRemindersRead);
  const setReminderFocus = useStore((s) => s.setReminderFocus);

  // A single ticking instant shared by the whole render. The demo clock is
  // an offset from real time, so this advances naturally; ticking once a
  // second keeps "due in 30 minutes" and overdue flips honest without
  // making the derivation depend on render timing.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nowMs = tick + clockOffset;

  const derived = useMemo(
    () =>
      deriveRemindersForState(
        { trades, batches, persona, readReminderIds, demoClockOffsetMs: clockOffset },
        nowMs,
      ),
    [trades, batches, persona, readReminderIds, clockOffset, nowMs],
  );

  const { actionRequired, processing, resolved, unreadCount, hasCritical } = derived;

  // Close on Escape, and on a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || bellRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Move focus into the panel when it opens, for keyboard users.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  /**
   * Run a reminder's single primary action. Marking read happens here as a
   * side effect of acting — it still does not touch settlement state.
   */
  const handleAct = (r: Reminder) => {
    if (!r.action) return;
    markRead(r.id);
    const a = r.action;

    switch (a.kind) {
      case 'open-trades':
        setReminderFocus({
          filters: a.filters,
          highlightTradeIds: a.highlightTradeIds,
        });
        navigate('/settlements');
        break;
      case 'open-batch':
      case 'open-exception':
        setReminderFocus({ highlightTradeIds: a.highlightTradeIds });
        navigate(`/settlements/${a.batchId}`);
        break;
      case 'open-batch-payments':
        setReminderFocus({ scrollToPayments: true });
        navigate(`/settlements/${a.batchId}`);
        break;
    }
    setOpen(false);
  };

  const handleToggleRead = (r: Reminder) => {
    if (readReminderIds.includes(r.id)) markUnread(r.id);
    else markRead(r.id);
  };

  const activeCount = actionRequired.length + processing.length;

  const bellLabel = `Notifications: ${unreadCount} unread of ${activeCount} active${
    hasCritical ? ', including overdue items' : ''
  }`;

  return (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={bellLabel}
        className={clsx(
          'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          open ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
        )}
      >
        {/* Bell glyph */}
        <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden>
          <path d="M10 2a5 5 0 0 0-5 5v3.6l-1.3 2.2A.8.8 0 0 0 4.4 14h11.2a.8.8 0 0 0 .7-1.2L15 10.6V7a5 5 0 0 0-5-5Zm0 15a2.4 2.4 0 0 0 2.3-1.7H7.7A2.4 2.4 0 0 0 10 17Z" />
        </svg>

        {/* Unread count */}
        {unreadCount > 0 && (
          <span
            className={clsx(
              'absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabnum',
              hasCritical ? 'bg-red-500 text-white' : 'bg-amber-500 text-white',
            )}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}

        {/* Critical/overdue indicator — a glyph, not just a colour */}
        {hasCritical && (
          <span
            className="absolute -bottom-0.5 -right-1 rounded-full bg-red-600 px-1 text-[8px] font-bold leading-[13px] text-white"
            title="Overdue or critical items"
          >
            !
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-label="Settlement reminders"
          className={clsx(
            'absolute right-0 z-50 mt-2 flex max-h-[min(34rem,calc(100vh-5rem))] w-[min(26rem,calc(100vw-1.5rem))] flex-col',
            'overflow-hidden rounded-xl border border-wm-frost bg-white shadow-2xl',
            // Narrow screens: anchor to the viewport rather than the bell
            'max-sm:fixed max-sm:right-3 max-sm:left-3 max-sm:w-auto',
          )}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2 border-b border-wm-frost bg-wm-offwhite px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Settlement reminders</h2>
              <p className="text-[11px] text-slate-500">
                {activeCount === 0
                  ? 'No active reminders'
                  : `${activeCount} active · ${unreadCount} unread`}
                {' · '}
                <span className="text-slate-400">{personaLabel(persona)} view</span>
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() =>
                  markAllRead([...actionRequired, ...processing].map((r) => r.id))
                }
                className="shrink-0 text-[11px] text-slate-500 hover:text-slate-800"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Queue */}
          <div className="flex-1 overflow-y-auto">
            {activeCount === 0 && resolved.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-slate-400">
                Nothing needs attention in this view. Execute trades, or switch persona to see
                reminders addressed to another role.
              </p>
            ) : (
              <>
                <Group
                  title="Action required"
                  hint="You own the next step"
                  items={actionRequired}
                  readIds={readReminderIds}
                  onAct={handleAct}
                  onToggleRead={handleToggleRead}
                />
                <Group
                  title="Processing"
                  hint="Waiting on someone else"
                  items={processing}
                  readIds={readReminderIds}
                  onAct={handleAct}
                  onToggleRead={handleToggleRead}
                />
                <Group
                  title="Resolved history"
                  items={resolved}
                  readIds={readReminderIds}
                  onAct={handleAct}
                  onToggleRead={handleToggleRead}
                />
              </>
            )}
          </div>

          {/* Footer — standing disclaimer */}
          <div className="border-t border-wm-frost bg-wm-offwhite px-4 py-2">
            <p className="text-[10px] leading-relaxed text-slate-400">
              Concept demo — simulated data. In-app reminders only: no email, push, wallet or
              payment integrations. Marking a reminder read does not settle an obligation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function personaLabel(p: string): string {
  switch (p) {
    case 'fund-trader':
      return 'Fund Trader';
    case 'fund-operations':
      return 'Fund Operations';
    case 'fund-approver':
      return 'Fund Approver';
    case 'provider-operations':
      return 'Provider Operations';
    default:
      return p;
  }
}
