/**
 * Demo clock
 *
 * The guided walkthrough must be deterministic and reproducible, so
 * reminder timing is driven by an explicit demo clock rather than real
 * wall-clock time alone. The clock is stored as an OFFSET from real time:
 *
 *   demoNow = Date.now() + offsetMs
 *
 * Storing an offset (not an absolute instant) means the clock keeps
 * advancing naturally between interactions, survives a page refresh, and
 * still lands exactly on a chosen point relative to the cutoff.
 *
 * This is a labelled demonstration control. It is not authentication, and
 * it is not production scheduling.
 *
 * Concept demo — simulated data.
 */

/** Settlement cutoff hour, UTC. */
export const CUTOFF_HOUR_UTC = 17;

/**
 * The cutoff instant for a given moment: today at 17:00 UTC if that is
 * still ahead, otherwise tomorrow at 17:00 UTC.
 */
export function cutoffFor(nowMs: number): string {
  const d = new Date(nowMs);
  const todayCutoff = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    CUTOFF_HOUR_UTC,
    0,
    0,
    0,
  );
  if (nowMs <= todayCutoff) return new Date(todayCutoff).toISOString();
  return new Date(todayCutoff + 86_400_000).toISOString();
}

/**
 * Today's 17:00 UTC cutoff regardless of whether it has passed — used by
 * the presets so "after cutoff" can place the clock past today's cutoff
 * rather than rolling to tomorrow.
 */
function todayCutoffMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    CUTOFF_HOUR_UTC,
    0,
    0,
    0,
  );
}

export type ClockPreset = 'one-hour-before' | 'thirty-min-before' | 'after-cutoff';

export const CLOCK_PRESETS: { key: ClockPreset; label: string; description: string }[] = [
  {
    key: 'one-hour-before',
    label: 'One hour before cutoff',
    description: 'Due-soon reminders become active',
  },
  {
    key: 'thirty-min-before',
    label: 'Thirty minutes before cutoff',
    description: 'Approval urgency increases',
  },
  {
    key: 'after-cutoff',
    label: 'After cutoff',
    description: 'Outstanding obligations show as overdue',
  },
];

const PRESET_DELTA_MS: Record<ClockPreset, number> = {
  'one-hour-before': -60 * 60 * 1000,
  'thirty-min-before': -30 * 60 * 1000,
  'after-cutoff': +20 * 60 * 1000,
};

/**
 * The offset that places the demo clock at a preset position relative to
 * today's 17:00 UTC cutoff.
 */
export function offsetForPreset(preset: ClockPreset, realNowMs: number): number {
  const target = todayCutoffMs(realNowMs) + PRESET_DELTA_MS[preset];
  return target - realNowMs;
}

/** Current demo time given a stored offset. */
export function demoNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}

/** "14:32:05 UTC" */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/** "22 Sep, 14:32 UTC" */
export function fmtClockLong(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const p = (n: number) => String(n).padStart(2, '0');
  return `${day}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** True when the offset is far enough from real time to be worth flagging. */
export function isClockShifted(offsetMs: number): boolean {
  return Math.abs(offsetMs) > 60_000;
}

/** Signed human description of the shift, e.g. "2h 15m ahead". */
export function describeShift(offsetMs: number): string | null {
  if (!isClockShifted(offsetMs)) return null;
  const mins = Math.round(Math.abs(offsetMs) / 60_000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const amount =
    hrs === 0 ? `${mins}m` : rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
  return `${amount} ${offsetMs > 0 ? 'ahead of' : 'behind'} real time`;
}
