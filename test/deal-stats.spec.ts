import { describe, it } from 'mocha'
import { expect } from 'chai'

import {
  DEAL_STATS_BINS,
  compareReturnStats,
  dealStatsOf,
  returnStatsOf,
} from '../src/helper/dealStats'

/**
 * 1.29.0 — the saved summary of a run's deals is fixed-size: it never grows
 * with the number of deals, and it matches the dashboard's own math.
 */

const deal = (
  perc: number,
  duration = 3600e3,
  status: 'open' | 'closed' = 'closed',
) => ({ status, profit: { total: 0, totalUsd: 0, perc }, duration })

describe('dealStatsOf', () => {
  it('keeps the same size for 10 deals and 200,000', () => {
    const small = dealStatsOf(Array.from({ length: 10 }, (_, i) => deal(i - 5)))
    const big = dealStatsOf(
      Array.from({ length: 200_000 }, (_, i) => deal((i % 41) - 20)),
    )
    expect(small.histogram.counts).to.have.length(DEAL_STATS_BINS)
    expect(big.histogram.counts).to.have.length(DEAL_STATS_BINS)
    expect(JSON.stringify(big).length).to.be.lessThan(1000)
    expect(big.histogram.counts.reduce((a, b) => a + b, 0)).to.equal(200_000)
  })

  it('counts closed deals only and puts the max in the last bin', () => {
    const s = dealStatsOf([deal(-10), deal(0), deal(10), deal(99, 1, 'open')])
    expect(s.closed).to.equal(3)
    expect(s.winners).to.equal(1)
    expect(s.min).to.equal(-10)
    expect(s.max).to.equal(10)
    expect(s.p50).to.equal(0)
    expect(s.mean).to.equal(0)
    expect(s.sd).to.equal(10)
    expect(s.histogram.counts[0]).to.equal(1)
    expect(s.histogram.counts[DEAL_STATS_BINS - 1]).to.equal(1)
  })

  it('has one bin when every return is equal, none without deals', () => {
    expect(dealStatsOf([deal(2), deal(2)]).histogram.counts).to.deep.equal([2])
    const empty = dealStatsOf([])
    expect(empty.closed).to.equal(0)
    expect(empty.histogram.counts).to.deep.equal([])
    expect(JSON.stringify(empty)).to.not.include('null')
  })

  it('reports durations in ms', () => {
    const s = dealStatsOf([deal(1, 1000), deal(1, 3000), deal(1, 5000)])
    expect(s.duration).to.deep.equal({
      mean: 3000,
      p50: 3000,
      p95: 4800,
      max: 5000,
    })
  })
})

describe('compareReturnStats', () => {
  it('matches the dashboard verdict thresholds', () => {
    const a = returnStatsOf([1, 2, 3, 4, 5, 6, 7, 8])
    const b = returnStatsOf([-1, 0, 1, -2, 0, 1, -1, 0])
    expect(compareReturnStats(a, b)?.verdict).to.equal('beats')
    expect(compareReturnStats(b, a)?.verdict).to.equal('worse')
    expect(compareReturnStats(a, a)?.verdict).to.equal('same')
  })

  it('has no verdict under two deals a side', () => {
    expect(
      compareReturnStats(returnStatsOf([1]), returnStatsOf([1, 2])),
    ).to.equal(null)
  })
})
