/**
 * Fixed-size summary of a run's closed deals (1.29.0).
 *
 * A backtest can produce any number of deals, so the deal list itself is never
 * stored. This summary is what a saved backtest keeps instead: its size is the
 * same for 10 deals or 500,000, and it carries everything the return
 * distribution and the strategy-vs-random test need (count, mean, sd,
 * quantiles, a fixed-bin histogram, durations).
 *
 * Pure: the same deals give the same summary on the server and in the browser.
 */
import type { DealStats, PreparedDeal, ReturnStats } from '../types'

/** Bins in `histogram.counts`, whatever the number of deals. */
export const DEAL_STATS_BINS = 20

/** z for a two-sided 95% interval. */
const Z95 = 1.96

const r = (v: number, dp = 4) => (Number.isFinite(v) ? +v.toFixed(dp) : 0)

/** Linear-interpolated quantile of an ascending-sorted array. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Count, mean and sample sd; sd is 0 under two values. */
export function returnStatsOf(values: number[]): ReturnStats {
  const n = values.length
  if (!n) return { n: 0, mean: 0, sd: 0 }
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd =
    n < 2
      ? 0
      : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  return { n, mean: r(mean), sd: r(sd) }
}

/** The summary of the closed deals' profit % and durations. */
export function dealStatsOf(
  deals: Pick<PreparedDeal, 'status' | 'profit' | 'duration'>[],
): DealStats {
  const closed = deals.filter((d) => d.status === 'closed')
  const returns = closed
    .map((d) => d.profit?.perc)
    .filter((v): v is number => Number.isFinite(v))
    .sort((a, b) => a - b)
  const durations = closed
    .map((d) => d.duration)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
  const { n, mean, sd } = returnStatsOf(returns)
  const min = returns[0] ?? 0
  const max = returns[returns.length - 1] ?? 0
  const step = max > min ? (max - min) / DEAL_STATS_BINS : 0
  const counts = new Array<number>(n ? (step ? DEAL_STATS_BINS : 1) : 0).fill(0)
  for (const v of returns) {
    const i = step
      ? Math.min(DEAL_STATS_BINS - 1, Math.floor((v - min) / step))
      : 0
    counts[i]++
  }
  const durMean = durations.length
    ? durations.reduce((s, v) => s + v, 0) / durations.length
    : 0
  return {
    closed: n,
    winners: returns.filter((v) => v > 0).length,
    mean,
    sd,
    min: r(min),
    max: r(max),
    p5: r(quantile(returns, 0.05)),
    p25: r(quantile(returns, 0.25)),
    p50: r(quantile(returns, 0.5)),
    p75: r(quantile(returns, 0.75)),
    p95: r(quantile(returns, 0.95)),
    histogram: { from: r(min), step: r(step, 6), counts },
    duration: {
      mean: Math.round(durMean),
      p50: Math.round(quantile(durations, 0.5)),
      p95: Math.round(quantile(durations, 0.95)),
      max: Math.round(durations[durations.length - 1] ?? 0),
    },
  }
}

export type EdgeVerdict = 'beats' | 'worse' | 'same'

/**
 * Welch's two-sample t of `a` − `b` (positive: `a` above) and its verdict at
 * 95%; null when either side has fewer than two deals or no spread.
 */
export function compareReturnStats(
  a: ReturnStats,
  b: ReturnStats,
): { t: number; verdict: EdgeVerdict } | null {
  if (a.n < 2 || b.n < 2) return null
  const se = Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n)
  if (!(se > 0)) return null
  const t = (a.mean - b.mean) / se
  return {
    t: r(t, 3),
    verdict: t >= Z95 ? 'beats' : t <= -Z95 ? 'worse' : 'same',
  }
}
