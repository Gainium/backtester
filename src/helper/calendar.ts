/**
 * Calendar boundaries (start of a day, month or year) in a named time zone,
 * never in the zone of the machine running the backtest.
 *
 * The stats that group closed deals by day, month or year (CWR, Sharpe,
 * Sortino, profit by period, periodic stats) used the host's local midnight,
 * so the same backtest gave different stats on a server than in a browser in
 * another zone. They now use the backtest's `timezone` input when it is a
 * valid IANA zone, and UTC otherwise. A browser that passes its own zone gets
 * exactly the boundaries `Date#setHours(0, 0, 0, 0)` gave it before.
 */

const UTC = 'UTC'

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatter = (zone: string): Intl.DateTimeFormat => {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, f)
  }
  return f
}

/** The zone the stats are bucketed in: `timezone` if valid, else UTC. */
export const calendarZone = (timezone?: string | null): string => {
  if (!timezone) {
    return UTC
  }
  try {
    formatter(timezone)
    return timezone
  } catch {
    return UTC
  }
}

type Wall = { y: number; m: number; d: number }

/** Year, month (0-based) and day of `time` on the wall clock of `zone`. */
const wall = (time: number, zone: string): Wall & { ms: number } => {
  if (zone === UTC) {
    const d = new Date(time)
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth(),
      d: d.getUTCDate(),
      ms: time,
    }
  }
  const p: Record<string, number> = {}
  for (const part of formatter(zone).formatToParts(time)) {
    if (part.type !== 'literal') {
      p[part.type] = +part.value
    }
  }
  return {
    y: p.year,
    m: p.month - 1,
    d: p.day,
    // the wall-clock time read as if it were UTC, to the second
    ms: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  }
}

/** How far `zone`'s wall clock is ahead of UTC at `time`, in ms. */
const offset = (time: number, zone: string): number =>
  zone === UTC ? 0 : wall(time, zone).ms - Math.floor(time / 1000) * 1000

/**
 * The instant of 00:00 on y-m-d in `zone` (month 0-based; Date.UTC rolls an
 * overflowing day or month over). Measured twice, so a DST change between
 * the guess and the answer is accounted for.
 */
const midnight = (y: number, m: number, d: number, zone: string): number => {
  const asUtc = Date.UTC(y, m, d)
  if (zone === UTC) {
    return asUtc
  }
  const first = asUtc - offset(asUtc, zone)
  return asUtc - offset(first, zone)
}

export const startOfDay = (time: number, zone: string): number => {
  const w = wall(time, zone)
  return midnight(w.y, w.m, w.d, zone)
}

/** The next midnight after the day that starts at `dayStart`. */
export const nextDay = (dayStart: number, zone: string): number => {
  const w = wall(dayStart, zone)
  return midnight(w.y, w.m, w.d + 1, zone)
}

export const startOfMonth = (time: number, zone: string): number => {
  const w = wall(time, zone)
  return midnight(w.y, w.m, 1, zone)
}

/** The first of the month after the one `time` falls in. */
export const nextMonth = (time: number, zone: string): number => {
  const w = wall(time, zone)
  return midnight(w.y, w.m + 1, 1, zone)
}

export const startOfYear = (time: number, zone: string): number => {
  const w = wall(time, zone)
  return midnight(w.y, 0, 1, zone)
}

/** 1 January of the year after the one `time` falls in. */
export const nextYear = (time: number, zone: string): number => {
  const w = wall(time, zone)
  return midnight(w.y + 1, 0, 1, zone)
}
